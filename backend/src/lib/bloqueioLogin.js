// backend/src/lib/bloqueioLogin.js
'use strict';

/**
 * BLOQUEIO DE CONTA POR SENHA ERRADA.
 *
 * POR QUE EXISTE: o rate limit de `/auth` é por IP (20 req/15min) — protege o SERVIDOR
 * de força bruta em volume, mas não protege UMA CONTA. Um ataque distribuído troca de
 * IP; e o caso mais comum não é nem ataque, é alguém da própria clínica tentando a
 * senha do colega, que nunca estoura o balde de IP porque são poucas tentativas. Contar
 * a falha por USUÁRIO e travar a conta é a proteção que faltava.
 *
 * ONDE O CONTADOR VIVE: em `users`, porque a credencial é GLOBAL — e-mail e senha são a
 * identidade da pessoa em todas as empresas (o que é POR EMPRESA é o cadastro:
 * `ProprietarioPerfil` / `ProfissionalPerfil` / `UsuarioEmpresa`, CLAUDE.md §5).
 * Contar por empresa daria 6 tentativas em CADA uma.
 *
 * 🔴 QUEM DESBLOQUEIA — a regra que este arquivo existe para guardar:
 *
 *   alvo NÃO é gestor  →  GESTOR de uma empresa à qual o alvo pertence  (ou ADMIN)
 *   alvo É gestor      →  SOMENTE o ADMIN da plataforma
 *
 * A escalada para o ADMIN quando o alvo é gestor não é burocracia: gestor destravando
 * gestor é ação LATERAL entre iguais em poder, e sem ela dois gestores da mesma empresa
 * poderiam se destravar em círculo, esvaziando a trava. Como o gestor é justamente quem
 * tem bypass total no controle de acesso (CLAUDE.md §4), a conta dele travada é o caso
 * em que a trava mais vale.
 *
 * ⚠️ SEM EXPIRAÇÃO AUTOMÁTICA, de propósito. Trava que se solta sozinha depois de N
 * minutos não avisa ninguém de que houve tentativa — e o valor desta trava é
 * justamente alguém FICAR SABENDO. O desbloqueio é um ato, e vai para a auditoria.
 */

const prisma = require('./prisma').default;

/** Tentativas antes de travar. Env só para ambiente de teste — não expor na UI: mudar
 *  isso é decisão de segurança, não configuração de clínica. */
const MAX_TENTATIVAS = Math.max(1, Number(process.env.LOGIN_MAX_TENTATIVAS || 6));

const MSG_BLOQUEADO =
  'Conta bloqueada por tentativas de senha inválidas. Procure o gestor da sua equipe para desbloquear.';
const MSG_BLOQUEADO_GESTOR =
  'Conta bloqueada por tentativas de senha inválidas. Procure o administrador do sistema para desbloquear.';

/** Colunas mínimas para decidir bloqueio — inclua no `select` de quem for chamar. */
const SELECT_BLOQUEIO = { tentativasLogin: true, bloqueadoEm: true };

function estaBloqueado(user) {
  return !!user?.bloqueadoEm;
}

function ehAdminPlataforma(req) {
  return req?.user?.role === 'ADMIN' || req?.user?.userTypeGlobal === 'ADMIN';
}

/**
 * O usuário é GESTOR em ALGUMA empresa? (dono de empresa, ou GESTOR entre os cargos)
 *
 * 🔴 NA DISPUTA ENTRE CARGOS, GESTOR VENCE — regra de produto explícita. Um membro pode
 * acumular cargos (`MembroEquipe.cargos`, e as permissões dele são a UNIÃO de todos),
 * então "gestora e veterinária" é gestora para efeito de desbloqueio: o poder que
 * importa aqui é o maior que a pessoa tem, nunca o rótulo principal.
 *
 * ⚠️ Por isso a consulta olha `cargo` **e** `cargos`. `alterarCargos` promove GESTOR a
 * cargo primário quando ele está na lista (`cargoPrimario`), o que já cobriria o caso
 * comum — mas depender disso deixaria escapar qualquer linha criada por outro caminho
 * ou anterior a essa regra, e o modo de falhar seria um gestor sendo destravado por
 * outro gestor, em silêncio.
 *
 * ⚠️ A pergunta é "em ALGUMA empresa", não "na empresa do contexto", e isso é
 * deliberado: a mesma pessoa pode ser estagiária aqui e gestora da própria clínica ali.
 * Se o gestor desta empresa pudesse destravá-la por ela ser estagiária AQUI, estaria
 * destravando o acesso de uma gestora LÁ — a credencial é uma só.
 */
async function ehGestorEmAlgumaEmpresa(userId, db = prisma) {
  const id = Number(userId);
  const [donoDeEmpresa, cargoGestor] = await Promise.all([
    db.empresa.count({ where: { ownerId: id } }),
    db.membroEquipe.count({
      where: { userId: id, OR: [{ cargo: 'GESTOR' }, { cargos: { has: 'GESTOR' } }] },
    }),
  ]);
  return donoDeEmpresa > 0 || cargoGestor > 0;
}

/**
 * Empresas em que o usuário é GESTOR — dono da empresa ou cargo GESTOR numa equipe dela.
 *
 * ⚠️ Consulta o BANCO em vez de confiar em `req.membroCargo`. As rotas de
 * `routes/equipes.js` não passam por `checkPermission`, então aquele campo simplesmente
 * não existe ali — uma regra de autorização que dependesse dele estaria lendo
 * `undefined` e negando (ou, pior num refactor futuro, liberando) sem perceber.
 */
async function empresasOndeEhGestor(userId, db = prisma) {
  const id = Number(userId);
  const [proprias, porCargo] = await Promise.all([
    db.empresa.findMany({ where: { ownerId: id }, select: { id: true } }),
    db.membroEquipe.findMany({
      // Mesma regra de `ehGestorEmAlgumaEmpresa`: GESTOR entre os cargos conta.
      where:  { userId: id, OR: [{ cargo: 'GESTOR' }, { cargos: { has: 'GESTOR' } }] },
      select: { equipe: { select: { empresaId: true } } },
    }),
  ]);
  return new Set([
    ...proprias.map(e => e.id),
    ...porCargo.map(m => m.equipe?.empresaId).filter(v => v != null),
  ]);
}

/** Empresas às quais o usuário está ligado — por equipe ou por vínculo direto. */
async function empresasDoUsuario(userId, db = prisma) {
  const id = Number(userId);
  const [porEquipe, porVinculo] = await Promise.all([
    db.membroEquipe.findMany({ where: { userId: id }, select: { equipe: { select: { empresaId: true } } } }),
    db.usuarioEmpresa.findMany({ where: { userId: id }, select: { empresaId: true } }),
  ]);
  return new Set([
    ...porEquipe.map(m => m.equipe?.empresaId).filter(v => v != null),
    ...porVinculo.map(v => v.empresaId).filter(v => v != null),
  ]);
}

/**
 * Registra UMA falha de senha. Ao atingir o teto, trava a conta.
 * @returns {Promise<{bloqueado: boolean, tentativas: number, restantes: number}>}
 */
async function registrarFalha(userId, db = prisma) {
  const atualizado = await db.user.update({
    where:  { id: Number(userId) },
    data:   { tentativasLogin: { increment: 1 } },
    select: SELECT_BLOQUEIO,
  });

  // Já estava bloqueado (corrida entre duas tentativas simultâneas): não reescreve o
  // `bloqueadoEm`, senão o horário do bloqueio andaria a cada tentativa nova e a
  // auditoria perderia o instante em que a conta travou de verdade.
  if (atualizado.bloqueadoEm) {
    return { bloqueado: true, tentativas: atualizado.tentativasLogin, restantes: 0 };
  }

  if (atualizado.tentativasLogin >= MAX_TENTATIVAS) {
    await db.user.update({
      where: { id: Number(userId) },
      data:  { bloqueadoEm: new Date() },
    });
    return { bloqueado: true, tentativas: atualizado.tentativasLogin, restantes: 0 };
  }

  return {
    bloqueado:  false,
    tentativas: atualizado.tentativasLogin,
    restantes:  MAX_TENTATIVAS - atualizado.tentativasLogin,
  };
}

/**
 * Zera o contador após autenticação bem-sucedida.
 *
 * ⚠️ Só escreve quando há o que zerar. Sem esse guard, TODO login faria um UPDATE em
 * `users` — escrita inútil no caminho mais quente da aplicação.
 * ⚠️ NÃO limpa `bloqueadoEm`: quem está bloqueado não chega aqui (o login recusa
 * antes), e limpar seria um caminho de autodesbloqueio.
 */
async function limparTentativas(user, db = prisma) {
  if (!user?.id || !user.tentativasLogin) return;
  await db.user.update({
    where: { id: Number(user.id) },
    data:  { tentativasLogin: 0 },
  });
}

/**
 * Quem está pedindo pode desbloquear o alvo? Ver a regra no topo do arquivo.
 * @returns {Promise<{pode: boolean, motivo?: string, code?: string}>}
 */
async function podeDesbloquear(req, alvoId, db = prisma) {
  const alvo = Number(alvoId);
  if (!alvo) return { pode: false, motivo: 'Usuário inválido.', code: 'ALVO_INVALIDO' };
  if (alvo === req?.user?.id) {
    // Não é só teoria: sem isto, bastaria uma sessão ainda válida em outro dispositivo
    // para a pessoa contornar o próprio bloqueio.
    return { pode: false, motivo: 'Ninguém desbloqueia a própria conta.', code: 'AUTO_DESBLOQUEIO' };
  }

  if (ehAdminPlataforma(req)) return { pode: true };

  // Alvo GESTOR escala para o ADMIN — ver a regra no topo do arquivo. Checado ANTES da
  // relação de empresa: o motivo da recusa é o que o alvo É, não onde ele está, e
  // inverter a ordem devolveria "não pertence à sua empresa" para o gestor de outra
  // clínica, escondendo a razão verdadeira.
  if (await ehGestorEmAlgumaEmpresa(alvo, db)) {
    return {
      pode:   false,
      motivo: 'Esta conta é de um gestor — só o administrador do sistema pode desbloqueá-la.',
      code:   'ALVO_GESTOR',
    };
  }

  // Quem pede tem de ser GESTOR de uma empresa à qual o ALVO também pertence. Sem essa
  // interseção, o gestor da clínica A destravaria o profissional/cliente da clínica B —
  // a credencial é global, o poder sobre ela não é.
  const [gestorDe, empresasDoAlvo] = await Promise.all([
    empresasOndeEhGestor(req?.user?.id, db),
    empresasDoUsuario(alvo, db),
  ]);
  if (gestorDe.size === 0) {
    return { pode: false, motivo: 'Apenas o gestor da equipe pode desbloquear uma conta.', code: 'SEM_PERMISSAO' };
  }
  const emComum = [...gestorDe].some(id => empresasDoAlvo.has(id));
  if (!emComum) {
    return { pode: false, motivo: 'Esta conta não pertence à sua empresa.', code: 'FORA_DA_EMPRESA' };
  }

  return { pode: true };
}

/** Libera a conta e zera o contador. A autorização é do chamador (`podeDesbloquear`). */
async function desbloquear(alvoId, db = prisma) {
  return db.user.update({
    where:  { id: Number(alvoId) },
    data:   { bloqueadoEm: null, tentativasLogin: 0 },
    select: { id: true, email: true, fullName: true, ...SELECT_BLOQUEIO },
  });
}

/** Mensagem para o usuário travado — muda conforme quem precisa destravá-lo. */
async function mensagemBloqueio(userId, db = prisma) {
  return (await ehGestorEmAlgumaEmpresa(userId, db)) ? MSG_BLOQUEADO_GESTOR : MSG_BLOQUEADO;
}

module.exports = {
  MAX_TENTATIVAS,
  MSG_BLOQUEADO,
  MSG_BLOQUEADO_GESTOR,
  SELECT_BLOQUEIO,
  estaBloqueado,
  ehGestorEmAlgumaEmpresa,
  empresasOndeEhGestor,
  registrarFalha,
  limparTentativas,
  podeDesbloquear,
  desbloquear,
  mensagemBloqueio,
};
