// backend/src/lib/auditoria.js
// Auditoria central de exclusões/cancelamentos — grava no AuditLog (tb_audit_logs).
//
// Todo endpoint de exclusão/cancelamento DEVE exigir `motivo` no body e registrar
// aqui. Passe o `tx` quando a operação já roda dentro de uma transaction — o log
// entra na mesma atomicidade (se a operação falha, o log não fica órfão; se o log
// falha, a operação inteira faz rollback — a justificativa nunca se perde).
//
// INSERT via SQL parametrizado (não usa o client tipado) — resiliente a client
// desatualizado logo após migration, antes do `npx prisma generate`.
'use strict';

const prisma = require('./prisma').default;
// Escopo de plataforma para a escrita da trilha de acesso (fase 7c)
const { comEscopoPlataforma } = require('./prismaTenant');

// TRANSFERENCIA → troca de responsável (assumir / transferir / reatribuir agenda).
//                 O `detalhes` DEVE dizer quem era o dono anterior e quem passou a ser.
// ALTERACAO      → edição de registro do atendimento, com o antes → depois.
// CRIACAO        → nasceu um registro. Sem ela a trilha tem buraco: dá para ver que um
//                  agendamento foi cancelado, mas não que ele existiu nem quem o marcou.
// EXECUCAO       → execução de UMA dose de prescrição (paciente, medicamento, horário
//                  previsto x executado, quem executou) — toda dose é auditada, não só
//                  as fora do horário (ver PrescricaoGrupoController.executar).
// ACESSO_NEGADO  → TENTATIVA bloqueada — login com senha errada/conta sem acesso, rota
//                  de módulo sem permissão (checkPermission/checkPermissaoProprietario)
//                  ou paciente fora do escopo (exigirAcessoAnimal/garantirAcessoAnimal).
//                  Até 2026-08-22 só ação BEM-SUCEDIDA deixava rastro — um 403 nunca
//                  era gravado, e o ADMIN não tinha como ver quem tentou o quê.
// EXPORTACAO     → extração em massa de dado clínico (Administração > Exportação) —
//                  quem/quando/quantos pacientes, sem duplicar aqui a lista de nomes
//                  já gravada em `motivo` pelo controller.
// ACESSO_PUBLICO → o OPOSTO de ACESSO_NEGADO: alguém SEM sessão abriu um recurso por
//                  capability URL (ex.: link público de fatura) e o token era válido.
//                  Registrado por `registrarAcessoPublico`, mesmo molde fire-and-forget
//                  em escopo de plataforma — não há req.user/req.empresaId aqui.
const CATEGORIAS = ['EXCLUSAO', 'CANCELAMENTO', 'AJUSTE', 'CONFIGURACAO', 'TRANSFERENCIA', 'ALTERACAO', 'CRIACAO', 'EXECUCAO', 'ACESSO_NEGADO', 'EXPORTACAO', 'ACESSO_PUBLICO'];

/**
 * Extrai o IP de origem do request de forma consistente com o `trust proxy`
 * configurado no server (req.ip já respeita X-Forwarded-For nos hops confiáveis).
 * Normaliza o formato IPv6-mapeado (::ffff:1.2.3.4 → 1.2.3.4).
 */
function ipDoRequest(req) {
  const raw = req?.ip || req?.socket?.remoteAddress || null;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * @param {object|null} client  prisma ou tx (transaction aberta) — null usa o prisma global
 * @param {object} req          request Express autenticado (req.user, req.empresaId, req.ip)
 * @param {object} dados        { categoria, entidade, entidadeId?, animalId?, motivo?, detalhes? }
 */
async function registrarAuditoria(client, req, { categoria, entidade, entidadeId = null, animalId = null, motivo = null, detalhes = null }) {
  if (!CATEGORIAS.includes(categoria)) throw new Error(`categoria de auditoria inválida: ${categoria}`);
  const c = client ?? prisma;
  // Sem o id no texto: ele já é a coluna `entidadeId` (filtrável e preservada), e a
  // tela de Auditoria não exibe referência numérica. Repeti-lo aqui só reintroduzia
  // o "#65" no rótulo da ação.
  const action = `${categoria} ${entidade}`;
  await c.$executeRawUnsafe(
    `INSERT INTO schs2vet.tb_audit_logs
       ("userId", "userName", "email", "action", "empresaId", "categoria", "entidade", "entidadeId", "animalId", "motivo", "detalhes", "ip")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    req.user?.id ?? null,
    req.user?.fullName ?? '',
    req.user?.email ?? '',
    action,
    req.empresaId ?? null,
    categoria,
    entidade,
    entidadeId != null ? Number(entidadeId) : null,
    animalId   != null ? Number(animalId)   : null,
    motivo?.trim() || null,
    detalhes || null,
    ipDoRequest(req),
  );
}

/**
 * Registra ACESSO (LOGIN / LOGOUT) — a trilha de quem entrou e saiu.
 *
 * 🔴 POR QUE ELE EXISTE (2026-08-05): isto era gravado pelo FRONTEND, chamando
 * `POST /api/audit/log`, uma rota **pública** que aceitava `userId`, `userName`, `email`,
 * `action` e `empresaId` **do corpo da requisição**. Ou seja: qualquer um na internet
 * podia injetar registro de auditoria atribuindo qualquer ação a qualquer pessoa, em
 * qualquer empresa — e auditoria é justamente o que precisa ser inquestionável.
 * (O controller antigo até protegia o IP contra spoofing, com comentário explicando, e
 * aceitava todo o resto do cliente.)
 *
 * Agora quem grava é o SERVIDOR, nos três pontos que criam ou encerram sessão:
 * `emitirSessao` (login por senha e 2º fator), `GoogleController` (OAuth) e o `logout`.
 * A identidade vem do usuário que o próprio backend acabou de autenticar — nunca do corpo.
 *
 * ⚠️ `empresaId` fica NULL de propósito: LOGIN/LOGOUT são eventos de PLATAFORMA, e a
 * resolução da empresa ativa mora inline no `middlewares/auth.js` (≈90 linhas de
 * prioridade: header → dono/gestor → vínculo mais recente). Duplicá-la aqui seria pior do
 * que não carimbar. Quando a migração de multi-tenancy extrair esse resolvedor para uma
 * função reusável, é só plugá-lo aqui — ver docs/MULTI-TENANCY-PLANO.md §10.6/§10.7.
 *
 * Fire-and-forget: falha de auditoria NUNCA derruba o login nem o logout.
 */
async function registrarAcesso(req, user, action) {
  if (!user?.id || !['LOGIN', 'LOGOUT'].includes(action)) return;
  try {
    // ⚠️ FASE 7c — A EMPRESA PASSOU A SER CARIMBADA, e não é cosmética.
    //
    // Gravar `empresaId: null` era aceitável enquanto o RLS tinha escape. Sem o escape,
    // a policy de `tb_audit_logs` é `empresa_id = app_empresa_id()`: linha com empresa
    // nula não casa com NINGUÉM e fica invisível para todos, inclusive para o gestor da
    // clínica onde o login aconteceu. A trilha de acesso viraria lixo inalcançável — foi
    // exatamente assim que as 911 linhas apagadas na fase 4 se acumularam.
    //
    // É também o que o §10.6 do plano prometeu ao rejeitar a opção (c): "quando o audit
    // de login for escrito no servidor, ele nasce com a empresa correta e cai sozinho
    // dentro da policy (b)".
    //
    // ⚠️ `req.empresaId` NULO ainda é possível e legítimo: ADMIN de plataforma e usuário
    // sem vínculo. Continua indo nulo — é EVENTO DE PLATAFORMA, visível só em escopo de
    // plataforma. O que mudou é que o login DE UMA CLÍNICA agora fica com ela.
    const empresaId = req?.empresaId ?? null;

    // O INSERT roda em escopo de PLATAFORMA de propósito: no LOGOUT o contexto da
    // requisição já pode ter sido derrubado, e no LOGIN a empresa acaba de ser
    // resolvida. Sem isso o `WITH CHECK` da policy recusaria a própria escrita da
    // auditoria — e a auditoria falharia calada (é fire-and-forget).
    await comEscopoPlataforma(() => prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_audit_logs ("userId", "userName", "email", "action", "empresaId", "ip")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      user.id,
      user.fullName ?? '',
      user.email ?? '',
      action,
      empresaId,
      ipDoRequest(req),
    ));
  } catch (err) {
    console.warn(`[auditoria] falha ao registrar ${action} do usuário ${user.id}:`, err.message);
  }
}

/**
 * Registra uma TENTATIVA DE ACESSO NÃO AUTORIZADA — módulo/funcionalidade sem
 * permissão, paciente fora do escopo, ou login/2FA recusado.
 *
 * Fire-and-forget (nunca lança — o caller já está no meio de devolver 401/403/404 e
 * não pode ter essa resposta atrasada nem derrubada por falha de auditoria) e roda em
 * ESCOPO DE PLATAFORMA de propósito: a tentativa pode acontecer ANTES de o tenant
 * estar resolvido (login, antes de `authenticate`) ou ser justamente FORA do tenant
 * a que o usuário pertence — escrever com o escopo carimbado do PRÓPRIO usuário
 * esconderia a tentativa da auditoria da empresa visada (`app_empresa_id()` dela
 * nunca bateria com a do atacante). `empresaId` é gravado só como DADO (coluna) —
 * é o que permite ao gestor daquela empresa ver "alguém tentou acessar X aqui".
 *
 * @param {object} req     request (pode ser pré-autenticação — sem req.user)
 * @param {object} dados   { motivo, entidade?, entidadeId?, animalId?, emailTentativa? }
 *   `entidade` categoriza o alvo: 'LOGIN' | 'MODULO' | 'ANIMAL' (default 'ACESSO').
 *   `emailTentativa` — e-mail digitado no login, quando ainda não há usuário resolvido.
 */
async function registrarAcessoNegado(req, { motivo, entidade = 'ACESSO', entidadeId = null, animalId = null, emailTentativa = null }) {
  try {
    const detalhes = [`rota: ${req?.method ?? '?'} ${req?.originalUrl || req?.url || '?'}`];
    if (emailTentativa && !req?.user?.email) detalhes.push(`email tentado: ${emailTentativa}`);

    await comEscopoPlataforma(() => prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_audit_logs
         ("userId", "userName", "email", "action", "empresaId", "categoria", "entidade", "entidadeId", "animalId", "motivo", "detalhes", "ip")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      req?.user?.id ?? null,
      req?.user?.fullName ?? '',
      req?.user?.email ?? emailTentativa ?? '',
      `ACESSO_NEGADO ${entidade}`,
      req?.empresaId ?? null,
      'ACESSO_NEGADO',
      entidade,
      entidadeId != null ? Number(entidadeId) : null,
      animalId   != null ? Number(animalId)   : null,
      motivo?.trim() || null,
      detalhes.join(' | '),
      ipDoRequest(req),
    ));
  } catch (err) {
    console.warn('[auditoria] falha ao registrar ACESSO_NEGADO:', err.message);
  }
}

/**
 * Registra um acesso PÚBLICO bem-sucedido (capability URL — sem sessão, sem
 * `req.user`/`req.empresaId`). Fire-and-forget: nunca lança, nunca atrasa a
 * resposta ao cliente que abriu o link. `empresaId` é gravado como DADO (o
 * tenant dono do recurso acessado), não como escopo de RLS — a escrita roda em
 * `comEscopoPlataforma`, mesmo mecanismo de `registrarAcessoNegado`.
 *
 * @param {{ entidade:string, entidadeId?:number|null, empresaId?:number|null,
 *           motivo?:string|null, ip?:string|null }} p
 */
async function registrarAcessoPublico({ entidade, entidadeId = null, empresaId = null, motivo = null, ip = null }) {
  try {
    await comEscopoPlataforma(() => prisma.$executeRawUnsafe(
      `INSERT INTO schs2vet.tb_audit_logs
         ("userId", "userName", "email", "action", "empresaId", "categoria", "entidade", "entidadeId", "animalId", "motivo", "detalhes", "ip")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      null, '', '',
      `ACESSO_PUBLICO ${entidade}`,
      empresaId != null ? Number(empresaId) : null,
      'ACESSO_PUBLICO',
      entidade,
      entidadeId != null ? Number(entidadeId) : null,
      null,
      motivo?.trim() || null,
      null,
      ip,
    ));
  } catch (err) {
    console.warn('[auditoria] falha ao registrar ACESSO_PUBLICO:', err.message);
  }
}

/**
 * Encurta campo longo (texto de evolução, observação) para o antes → depois.
 * O AuditLog é um LEDGER, não um versionador de conteúdo: guardar o corpo inteiro de
 * cada evolução a cada "Salvar" inflaria a tabela sem responder nada que o registro
 * atual + o rastro de responsável já não respondam.
 */
function resumoTexto(valor, max = 180) {
  if (valor == null) return null;
  const s = String(valor).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length} caracteres)`;
}

/**
 * Nome legível de um usuário para o texto da auditoria.
 * Aceita o client/tx para respeitar a transaction em curso.
 *
 * ⚠️ Devolve SÓ O NOME, sem id (decisão de 2026-08-04: a auditoria não exibe
 * referência numérica). Efeito colateral aceito: dois profissionais homônimos ficam
 * indistinguíveis DENTRO do texto de `detalhes`. Quem executou a ação continua
 * identificado pelas colunas `userId`/`email` da própria linha; o que se perde é o id
 * do "de quem → para quem" numa transferência. Sem nome (usuário apagado), devolve
 * "usuário não identificado" em vez do id.
 */
async function nomeDoUsuario(client, userId) {
  if (userId == null) return '—';
  try {
    const c = client ?? prisma;
    const [u] = await c.$queryRawUnsafe(
      'SELECT "fullName" FROM schs2vet.users WHERE id = $1',
      Number(userId),
    );
    return u?.fullName || 'usuário não identificado';
  } catch {
    return 'usuário não identificado';
  }
}

/**
 * Registra uma TROCA DE RESPONSÁVEL sobre um registro do atendimento.
 *
 * Sempre grava QUEM ERA o dono anterior e QUEM PASSOU A SER — é o que a auditoria
 * precisa responder quando um atendimento muda de mãos (assumir, transferir agenda,
 * reatribuir profissional) e o que o arrasto em cascata torna obrigatório: sem isto,
 * prescrição/exame/encaminhamento mudam de dono sem rastro nenhum.
 *
 * @param {object} dados { entidade, entidadeId, animalId?, deVetId, paraVetId, motivo?, origem? }
 *   `origem` = o que disparou a cascata (ex.: 'EVOLUCAO #12 assumida').
 */
async function registrarTransferencia(client, req, { entidade, entidadeId, animalId = null, deVetId, paraVetId, motivo = null, origem = null }) {
  const [de, para] = await Promise.all([
    nomeDoUsuario(client, deVetId),
    nomeDoUsuario(client, paraVetId),
  ]);
  await registrarAuditoria(client, req, {
    categoria: 'TRANSFERENCIA',
    entidade,
    entidadeId,
    animalId,
    motivo,
    detalhes: `responsável anterior: ${de} → novo responsável: ${para}`
            + (origem ? ` | origem: ${origem}` : ''),
  });
}

/**
 * Registra ALTERAÇÃO de um registro com o antes → depois por campo.
 *
 * `campos` = { campo: { de, para } }. Campos sem mudança real são descartados aqui
 * mesmo — auditoria de "nada mudou" só faz ruído, e o CALLER não precisa filtrar
 * antes de montar o objeto. Nada é gravado se a lista ficar vazia.
 *
 * `donoAnteriorId`/`donoAtualId` são OPCIONAIS e específicos de registro do
 * ATENDIMENTO (evolução, prescrição...), onde "quem conduz" muda o que a mesma
 * edição significa. Cadastro (Proprietário, Tratador, Fornecedor, Prestador,
 * Localização) não tem essa noção — omitir os dois pula o prefixo "responsável:"
 * e o texto fica só com os campos alterados.
 */
async function registrarAlteracao(client, req, { entidade, entidadeId, animalId = null, campos = {}, donoAnteriorId = null, donoAtualId = null, motivo = null }) {
  const mudancas = Object.entries(campos)
    .filter(([, v]) => v && String(v.de ?? '') !== String(v.para ?? ''))
    .map(([campo, v]) => `${campo}: "${v.de ?? '—'}" → "${v.para ?? '—'}"`);

  if (mudancas.length === 0) return;

  let prefixo = '';
  if (donoAnteriorId != null || donoAtualId != null) {
    const donoDe   = await nomeDoUsuario(client, donoAnteriorId ?? donoAtualId);
    const donoPara = donoAnteriorId != null && donoAtualId != null && Number(donoAnteriorId) !== Number(donoAtualId)
      ? await nomeDoUsuario(client, donoAtualId)
      : null;
    prefixo = `responsável: ${donoDe}${donoPara ? ` → ${donoPara}` : ''} | `;
  }

  await registrarAuditoria(client, req, {
    categoria: 'ALTERACAO',
    entidade,
    entidadeId,
    animalId,
    motivo,
    detalhes: `${prefixo}${mudancas.join(' ; ')}`,
  });
}

/**
 * Registra a TRANSFERÊNCIA DE PROPRIEDADE de um animal — quem transferiu, quando,
 * o motivo (Doação/Venda/Aluguel) e quem era o proprietário anterior/novo. Mesmo
 * espírito de `registrarTransferencia`, com o texto certo para o domínio (é o
 * DONO do animal que muda, não o condutor de um atendimento).
 *
 * @param {object} dados { animalId, deProprietarioId, paraProprietarioId, motivo }
 */
async function registrarTransferenciaPropriedade(client, req, { animalId, deProprietarioId, paraProprietarioId, motivo }) {
  const [de, para] = await Promise.all([
    nomeDoUsuario(client, deProprietarioId),
    nomeDoUsuario(client, paraProprietarioId),
  ]);
  await registrarAuditoria(client, req, {
    categoria: 'TRANSFERENCIA',
    entidade:  'ANIMAL_PROPRIEDADE',
    entidadeId: animalId,
    animalId,
    motivo,
    detalhes: `proprietário anterior: ${de} → novo proprietário: ${para}`,
  });
}

/**
 * Nome legível de uma localização para o texto da auditoria — mesmo espírito de
 * `nomeDoUsuario`: a auditoria não exibe id cru (decisão de 2026-08-04, ver CLAUDE.md
 * §12 "Nenhuma referência NUMÉRICA na tela de auditoria").
 */
async function nomeLocalizacao(client, localizacaoId) {
  if (localizacaoId == null) return '—';
  try {
    const c = client ?? prisma;
    const [l] = await c.$queryRawUnsafe(
      'SELECT nome FROM schs2vet.tb_localizacoes_animal WHERE id = $1',
      Number(localizacaoId),
    );
    return l?.nome || 'localização não identificada';
  } catch {
    return 'localização não identificada';
  }
}

module.exports = {
  registrarAuditoria,
  registrarAcesso,
  registrarAcessoNegado,
  registrarAcessoPublico,
  registrarTransferencia,
  registrarTransferenciaPropriedade,
  registrarAlteracao,
  nomeDoUsuario,
  nomeLocalizacao,
  resumoTexto,
  ipDoRequest,
};
