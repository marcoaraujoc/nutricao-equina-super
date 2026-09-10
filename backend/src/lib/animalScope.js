// backend/src/lib/animalScope.js
// Escopo de LISTAGEM de animais no contexto ativo. Fonte ÚNICA usada por
// `AnimalController.listar`, pela execução de prescrição e pelo Painel Principal.
//
// REGRA (fase 3 do multi-tenancy): **o paciente é da EMPRESA**. Quem trabalha nela o
// enxerga; quem não, não. Um profissional que atende em duas clínicas vê o conjunto de
// cada uma ao trocar o contexto — nunca os dois somados.
//
// Exceção única: PRESTADOR (e vet atuando como prestador) enxerga só o que lhe foi
// designado — `DesignacaoPrestador`, que é concessão do gestor dentro da empresa, e não
// um vínculo entre partes (decisão D1).

const prisma = require('./prisma').default;
const { ehCargoPrestador } = require('./cargosPrestador');
const { getEquipeScopeDoUsuario } = require('./vetUtils');

// Fallback: tipo GLOBAL do login. Só entra quando o request não traz o tipo do
// contexto (chamada fora do `authenticate`, script, teste).
async function obterUserType(userId) {
  const u = await prisma.user.findUnique({
    where:  { id: Number(userId) },
    select: { userType: true, role: true },
  });
  return { userType: u?.userType ?? 'PROPRIETARIO', role: u?.role ?? 'USER' };
}

// ⚠️ NUNCA `new Date().toISOString()` para "dia da semana de hoje" — vira UTC e já é o
// dia seguinte a partir das 21h em Brasília (mesma armadilha documentada em vários
// pontos do sistema, ex. `hojeLocalStr`). `getDay()` já lê no fuso local do servidor.
function diaDaSemanaLocal() {
  return new Date().getDay(); // 0=Dom … 6=Sáb
}

/**
 * "Atender somente no local de trabalho" (checkbox de Incluir/Editar Membro,
 * `MembroEquipe.restringirPorLocal`). Desligada (padrão) → `null`, sem restrição
 * nenhuma — é o comportamento de sempre.
 *
 * Ligada → devolve os IDs de `LocalizacaoAnimal` em que o profissional atende HOJE,
 * segundo os `MembroLocalTrabalho` cadastrados para ele NESTA equipe (dias CSV 0-6).
 * Pode devolver `[]` (restrição ligada, mas nenhum local configurado para hoje) — é
 * "não atende hoje", não "sem restrição"; `localizacaoId: { in: [] }` corretamente não
 * bate com nenhum animal.
 *
 * Escopo: só a equipe INFORMADA (`equipeId`) — o mesmo profissional pode ter vínculos
 * em várias equipes/empresas, cada um com sua própria configuração; misturar os locais
 * de uma equipe com a restrição de outra não faz sentido nenhum.
 */
async function localizacoesRestritasDeHoje(userId, equipeId) {
  if (!equipeId) return null;
  const membro = await prisma.membroEquipe.findUnique({
    where:  { equipeId_userId: { equipeId: Number(equipeId), userId: Number(userId) } },
    select: {
      restringirPorLocal: true,
      locaisTrabalho: { select: { localizacaoId: true, diasTrabalho: true } },
    },
  });
  if (!membro?.restringirPorLocal) return null;

  return doDiaDeHoje(membro.locaisTrabalho);
}

/** Locais cujo `diasTrabalho` inclui o dia da semana de hoje. */
function doDiaDeHoje(locais) {
  const hoje = String(diaDaSemanaLocal());
  return (locais ?? [])
    .filter(l => (l.diasTrabalho ?? '').split(',').map(d => d.trim()).includes(hoje))
    .map(l => l.localizacaoId);
}

/**
 * Mesma regra, para o PRESTADOR — que não tem `MembroEquipe` (o cadastro dele não
 * cria um; ver `PrestadorController#provisionarLogin`), e por isso guarda o flag em
 * `tb_prestadores.restringir_por_local`.
 *
 * ⚠️ Ela ESTREITA o que a DESIGNAÇÃO já liberou, nunca amplia: o prestador continua
 * vendo só o que o gestor lhe designou (deny-by-default do `DesignacaoPrestador`), e
 * com o flag ligado, dentro disso, só o que está hoje num local de trabalho dele.
 * Inverter essa ordem daria acesso a paciente que ninguém designou.
 *
 * ⚠️ Lido por SQL cru (§11): a coluna é nova (`20260929000000`) e o client pode não
 * estar regenerado — pelo `select` tipado, a LISTA DE PACIENTES do prestador quebraria
 * inteira numa base ainda não migrada. Sem a coluna, devolve `null` = sem restrição,
 * que é o comportamento anterior.
 */
async function localizacoesRestritasDoPrestador(userId) {
  if (!userId) return null;
  const linhas = await prisma.$queryRaw`
    SELECT p."restringir_por_local" AS restringir,
           l."localizacao_id"       AS "localizacaoId",
           l."dias_trabalho"        AS "diasTrabalho"
      FROM "schs2vet"."tb_prestadores" p
      LEFT JOIN "schs2vet"."tb_prestador_locais_trabalho" l ON l."prestador_id" = p."id"
     WHERE p."user_id" = ${Number(userId)} AND p."ativo" = true
  `.catch(() => []);

  if (!linhas.length || !linhas[0].restringir) return null;
  return doDiaDeHoje(linhas.filter(l => l.localizacaoId != null));
}

/**
 * Constrói o filtro Prisma de Animal que o usuário pode LISTAR no contexto ativo.
 * Requer que o middleware checkPermission já tenha rodado (define req.membroCargo/equipeId)
 * e o auth (req.empresaId/req.user).
 *
 * @returns {Promise<{ where: object, isAdmin: boolean, userType: string, role: string }>}
 *   `where` NÃO inclui `ativo` — o caller adiciona conforme o uso.
 */
async function buildAnimalScopeWhere(req) {
  const userId = req.user?.id;
  // TIPO POR EMPRESA (armadilha 36-e): quem manda é o tipo do CONTEXTO ATIVO, que o
  // `authenticate` já resolveu em `req.user.userType` (lib/tipoContexto). O `userType`
  // da tabela `users` é o GLOBAL/legado e NÃO serve para decidir escopo.
  //
  // Era o bug de 2026-07-30: profissional com `users.userType = PROPRIETARIO` mas cargo
  // VETERINARIO na empresa caía no ramo de proprietário e o `where` virava
  // `{ userId }` — 0 animais, tela de pacientes vazia, mesmo com a matriz dando FULL.
  // Só não quebrava sempre porque `isProprietarioMulticargo` a resgatava QUANDO
  // `req.membroCargo` vinha preenchido; nos caminhos em que ele é null (veterinário
  // sem equipe resolvida no checkPermission) a lista zerava.
  const doBanco = await obterUserType(userId);
  const userType = req.user?.userType ?? doBanco.userType;
  const role     = req.user?.role     ?? doBanco.role;
  const isAdmin = role === 'ADMIN' && userType !== 'PROPRIETARIO';

  const CARGOS_EQUIPE = ['VETERINARIO', 'ESTAGIARIO', 'GESTOR'];
  const isProprietarioMulticargo = userType === 'PROPRIETARIO'
    && req.membroCargo && CARGOS_EQUIPE.includes(req.membroCargo);
  const isFornecedorGestorContexto = userType === 'FORNECEDOR' && req.membroCargo === 'GESTOR';
  // Cargo FORNECEDOR **ou** PRESTADOR — os dois são o prestador externo; ver
  // `lib/cargosPrestador.js` (o segundo nasceu em 2026-09-09 e nada foi migrado).
  const isVetPrestadorContexto = userType === 'VETERINARIO' && ehCargoPrestador(req.membroCargo);
  const isDonoOuGestorContexto = req.membroCargo === 'GESTOR';

  const designacaoContextoFiltro = req.equipeId
    ? { equipeId: Number(req.equipeId) }
    : (req.empresaId ? { equipe: { empresaId: Number(req.empresaId) } } : {});

  const designacoesBase = { designacoes: { some: {
    prestadorId: Number(userId),
    ativo:       true,
    OR: [{ dataFim: null }, { dataFim: { gte: new Date() } }],
    ...designacaoContextoFiltro,
  } } };

  const isMembroEquipe = !!req.empresaId && !isAdmin;

  const equipeScope = isMembroEquipe
    ? await getEquipeScopeDoUsuario(userId, req.empresaId, req.equipeId)
    : null;
  const scopeOR = equipeScope
    ? [
        { equipeId: { in: equipeScope } },
        { empresaId: req.empresaId, equipeId: null },
      ]
    : [{ empresaId: req.empresaId }];

  // "Atender somente no local de trabalho" (MembroEquipe.restringirPorLocal) — só
  // avalia com uma equipe ATIVA resolvida (req.equipeId): sem ela não há "o local de
  // trabalho dele NESTA equipe" para consultar, e a restrição fica de fora (permissiva)
  // em vez de arriscar aplicar a configuração errada. Desligada → `null`, `scopeOR`
  // segue igual (nada muda, é o padrão).
  const restricaoLocalIds = isMembroEquipe
    ? await localizacoesRestritasDeHoje(userId, req.equipeId)
    : null;
  // O PRESTADOR tem o flag no cadastro dele, não em MembroEquipe — ver a função.
  const restricaoPrestador = userType === 'FORNECEDOR' && !isFornecedorGestorContexto
    ? await localizacoesRestritasDoPrestador(userId)
    : null;
  const scopeOREfetivo = restricaoLocalIds
    ? scopeOR.map(clausula => ({ ...clausula, localizacaoId: { in: restricaoLocalIds } }))
    : scopeOR;

  // ⚠️ A restrição por local do prestador ESTREITA a designação (AND), nunca a
  // substitui: trocar um pelo outro daria acesso a paciente que ninguém designou.
  // `[]` (marcou a opção e hoje não trabalha em lugar nenhum) resulta em lista vazia
  // — que é a resposta correta, não um bug.
  const designacoesWhere = restricaoPrestador
    ? { AND: [designacoesBase, { localizacaoId: { in: restricaoPrestador } }] }
    : designacoesBase;

  // ⚠️ REGRA BASE × CONVIDADO REMOVIDA (fase 3 do multi-tenancy).
  //
  // Aqui existiam `vetSolicitacoesWhere` (vínculos do vet em QUALQUER empresa) e
  // `vetVinculoNaEmpresa` (os mesmos, limitados à empresa ativa), e o `where` escolhia
  // entre os dois conforme o profissional fosse "base própria" (gestor/dono) ou
  // "convidado". Era a leitura cross-tenant INTENCIONAL documentada no CLAUDE.md §5 — e a
  // única exceção que não caberia no isolamento por empresa.
  //
  // Com o fim dos vínculos e aprovações, ela deixou de existir: o paciente é da EMPRESA, e
  // quem enxerga é quem trabalha nela. Um profissional que atende em duas clínicas vê os
  // pacientes de cada uma ao trocar o contexto — nunca os dois conjuntos ao mesmo tempo.
  //
  // NÃO reintroduzir "meus pacientes independente de empresa": era o que fazia o vet
  // enxergar, na base própria, animal pertencente a outra clínica.
  const where = isAdmin
    ? {}
    : userType === 'PROPRIETARIO'
      ? isProprietarioMulticargo
        ? { OR: [{ userId: Number(userId) }, ...scopeOREfetivo] }
        : { userId: Number(userId) }
      : userType === 'FORNECEDOR'
        ? isFornecedorGestorContexto
          ? { OR: scopeOREfetivo }
          : designacoesWhere
        : userType === 'VETERINARIO'
          // Vet atuando como PRESTADOR no contexto: só o que lhe foi designado (D1 —
          // `DesignacaoPrestador` permanece; é concessão do gestor, não vínculo entre partes).
          ? isVetPrestadorContexto
            ? designacoesWhere
            : isMembroEquipe
              ? { OR: scopeOREfetivo }
              // Sem empresa resolvida (vet autônomo/legado): só os animais que ele mesmo
              // cadastrou. Antes caía nos vínculos, que não existem mais.
              : { userId: Number(userId) }
          : isMembroEquipe
            ? { OR: scopeOREfetivo }
            : {};

  return { where, isAdmin, userType, role };
}

module.exports = { buildAnimalScopeWhere };
