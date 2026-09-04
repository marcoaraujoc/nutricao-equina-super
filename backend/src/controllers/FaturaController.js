// backend/src/controllers/FaturaController.js

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const {
  recalcularTotal: recalcularTotalCompartilhado,
  registrarCorrecaoFatura,
  normalizarDesconto,
  formatAtendimentoNum,
} = require('../lib/faturaUtils');
const { resolverLogoPorProprietario } = require('../lib/logoEmpresaUtils');
const { ehClienteDaEmpresa } = require('../lib/clienteEmpresa');
const { registrarAuditoria } = require('../lib/auditoria');
const { ehGestorNoContexto } = require('../middlewares/permissao.middleware');
const { escopoCatalogoEmpresa } = require('../middlewares/empresaAtiva.middleware');
const {
  aplicarPerfil: aplicarPerfilProprietario,
  aplicarPerfilEmLista: aplicarPerfilProprietarioEmLista,
} = require('../lib/proprietarioPerfil');
const { htmlParaPdf } = require('../services/documentoWhatsappService');
const { storage, chaveDaUrl } = require('../storage');
const { criarLink: criarLinkFaturaPublico, revogar: revogarLinkFaturaPublico } = require('../lib/faturaLinkPublico');
const { enfileirarEnvioFatura } = require('../lib/notificationDispatch');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');

// Aplica à fatura o cadastro que a EMPRESA ATIVA mantém do proprietário
// (nome, telefone e condição comercial são por empresa — ver lib/proprietarioPerfil).
// O envio (WhatsApp/e-mail/impressão) usa sempre o contato do PRÓPRIO proprietário —
// não existe mais a noção de "responsável financeiro" diferente do dono do animal
// (removida: gerava fatura endereçada a quem não é o titular do débito e nenhuma
// tela cobria o caso de pagamento parcial que isso exigiria).
async function comPerfilDaEmpresa(fatura, empresaId) {
  if (!fatura) return fatura;
  const comOrigem = comOrigemDosItens(fatura);
  return comOrigem.proprietario && empresaId
    ? { ...comOrigem, proprietario: await aplicarPerfilProprietario(comOrigem.proprietario, empresaId) }
    : comOrigem;
}

// A evolução é o ATENDIMENTO ao qual a cobrança pertence — é dela que sai o número
// `[AG-0012]`/`[EV-0007]` já gravado na descrição do item, e é para ela (ou para o
// agendamento que a originou) que o financeiro precisa conseguir ir a partir da fatura.
const EVOLUCAO_ORIGEM_SELECT = {
  id: true, numero: true, tipoAtendimento: true, animalId: true, agendamentoId: true,
};

const ITEM_INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
  animal:      {
    select: {
      id: true, nome: true, especie: { select: { nome: true } }, raca: { select: { nome: true } }, photoUrl: true,
    },
  },
  // Origem clínica do item — só o suficiente para montar o link do número do
  // atendimento. `FaturaItem` guarda a FK de cada origem possível (migration
  // 20260701000001) e no máximo UMA delas é preenchida por linha.
  // ⚠️ A prescrição chega pelo ITEM (`prescricaoId`), e a evolução mora no GRUPO —
  // por isso o salto a mais aqui.
  prescricao:            { select: { id: true, tipo: true, medicamento: true, grupo: { select: { id: true, evolucao: { select: EVOLUCAO_ORIGEM_SELECT } } } } },
  exameClinico:          { select: { id: true, evolucao: { select: EVOLUCAO_ORIGEM_SELECT } } },
  vacinaClinica:         { select: { id: true, evolucao: { select: EVOLUCAO_ORIGEM_SELECT } } },
  encaminhamentoClinico: { select: { id: true, evolucao: { select: EVOLUCAO_ORIGEM_SELECT } } },
};

// Achata a origem de cada item em `item.origem` e DESCARTA as relações cruas do
// payload: a tela precisa de 4 campos, não da prescrição/exame/vacina inteiros —
// e a fatura de um mês inteiro carregaria isso em toda listagem.
// `origem` fica null quando o item não tem origem clínica (assistência mensal,
// lançamento manual do financeiro, item OUTROS do orçamento) — nesses não há
// atendimento nenhum para onde ir, e a tela simplesmente não mostra o link.
function comOrigemDoItem(item) {
  if (!item) return item;
  const { prescricao, exameClinico, vacinaClinica, encaminhamentoClinico, ...resto } = item;
  const evolucao = prescricao?.grupo?.evolucao
    ?? exameClinico?.evolucao
    ?? vacinaClinica?.evolucao
    ?? encaminhamentoClinico?.evolucao
    ?? null;

  // INSUMO DE APLICAÇÃO (seringa/agulha da via injetável) — é FILHO da dose, e a tela
  // precisa saber disso para exibi-lo embaixo do medicamento que o consumiu.
  //
  // Como se reconhece, sem coluna nova: o insumo é lançado com `prescricaoId` do ITEM
  // DE MEDICAMENTO que o gerou, mas com tipo PROCEDIMENTO (é serviço/material, não
  // remédio). Ou seja, `FaturaItem.tipo === 'PROCEDIMENTO'` sobre uma
  // `Prescricao.tipo === 'MEDICAMENTO'` só acontece nesse caso — o procedimento
  // PRESCRITO aponta para uma `Prescricao.tipo === 'PROCEDIMENTO'`.
  // ⚠️ Mantenha essa invariante ao lançar qualquer material novo por dose: se um
  // insumo passar a nascer com tipo MEDICAMENTO, ele vira linha solta na fatura.
  const ehInsumo = resto.tipo === 'PROCEDIMENTO' && prescricao?.tipo === 'MEDICAMENTO';

  return {
    ...resto,
    // `prescricaoItemId` é o que agrupa dose + seringa + agulha: os três compartilham
    // o mesmo item de prescrição. `insumoDe` diz qual das três linhas é filha.
    prescricaoItemId: prescricao?.id ?? null,
    insumoDe:         ehInsumo ? (prescricao?.id ?? null) : null,
    medicamentoPai:   ehInsumo ? (prescricao?.medicamento ?? null) : null,
    origem: evolucao
      ? {
          evolucaoId:        evolucao.id,
          animalId:          evolucao.animalId,
          agendamentoId:     evolucao.agendamentoId ?? null,
          // Mesmo formato que a descrição do item já carrega ("AG-0012"), montado
          // pelo helper compartilhado — nunca à mão (CLAUDE.md, nº do atendimento).
          atendimentoNumero: formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero),
        }
      : null,
  };
}

function comOrigemDosItens(fatura) {
  if (!fatura?.itens) return fatura;
  return { ...fatura, itens: fatura.itens.map(comOrigemDoItem) };
}

const FATURA_INCLUDE = {
  itens: {
    where:   { },
    include: ITEM_INCLUDE,
    orderBy: [{ animalId: 'asc' }, { criadoEm: 'asc' }],
  },
  proprietario: { select: { id: true, fullName: true, email: true, phone: true, valorAssistencia: true, mensalista: true } },
};

/**
 * @param {number} faturaId
 * @param {object} [db] cliente a usar. 🔴 OBRIGATÓRIO no CRON: dentro de
 *   `paraCadaEmpresa` o tenant está carimbado no `tx`, e o `prisma` global chega ao
 *   banco sem `app.empresa_id` — com o RLS fail-closed isso significa somar ZERO item e
 *   falhar o UPDATE com "Record to update not found". Ver `lib/cronTenant.js`.
 *   Numa requisição HTTP o padrão continua certo: `comEmpresa` já pôs o tenant no
 *   contexto e a extensão do client o carimba sozinha.
 */
function recalcularTotal(faturaId, db = prisma) {
  return recalcularTotalCompartilhado(db, faturaId);
}

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

// Retorna o mês seguinte no formato "YYYY-MM"
function proximoMesRef(mesRef) {
  if (!mesRef) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 7);
  }
  const [ano, mes] = mesRef.split('-').map(Number);
  // mes é 1-based; new Date(ano, mes, 1) avança um mês (junho=6 → Date(2026,6,1) = julho)
  const d = new Date(ano, mes, 1);
  return d.toISOString().slice(0, 7);
}

/**
 * Resolve o valor da assistência veterinária do proprietário.
 *
 * ⚠️ NUNCA ler `mensalista`/`valorAssistencia` do `users` aqui. Desde a migration
 * `20260724000000` a tela do proprietário grava esses campos em `ProprietarioPerfil`
 * (por empresa) e NUNCA MAIS no User — o User ficou só como identidade. Ler do User
 * fazia a assistência sumir da fatura de todo cliente cadastrado após a migration, e
 * (pior, silenciosamente) faturar o VALOR ANTIGO dos cadastros anteriores, cujo valor
 * duplicado ficou congelado no User.
 *
 * A empresa vem da PRÓPRIA FATURA (`Fatura.empresaId`, migration 20260812000000).
 * A dedução pelos perfis do proprietário virou fallback exclusivo das faturas legadas
 * anteriores a essa migration, que não têm tenancy gravada.
 */
async function resolverAssistencia(proprietarioId, empresaId = null, db = prisma) {
  const userId = Number(proprietarioId);
  if (!userId) return null;

  // Legado: cliente anterior à migration, que não tem perfil em empresa nenhuma —
  // o valor ficou no User. É o ÚNICO caso em que o User ainda vale.
  const doUsuarioLegado = async () => {
    const user = await db.user.findUnique({ where: { id: userId }, select: { valorAssistencia: true } });
    return user?.valorAssistencia ?? null;
  };

  // 1) COM empresa no contexto: o perfil dela é a autoridade e o escopo é FECHADO.
  //    Não varrer outras empresas aqui — o mesmo cliente pode ser mensalista na
  //    clínica A e não ser na B; cair no perfil de A faria a B cobrar o valor de A.
  if (empresaId) {
    const perfil = await db.proprietarioPerfil.findUnique({
      where:  { userId_empresaId: { userId, empresaId: Number(empresaId) } },
      select: { valorAssistencia: true },
    });
    // Perfil existente manda mesmo com valor null ("não é mensalista NESTA empresa")
    return perfil ? perfil.valorAssistencia : doUsuarioLegado();
  }

  // 2) SEM empresa no contexto (cron de fechamento, ADMIN global): a fatura não
  //    carrega empresa, então deduz-se pelos perfis do próprio proprietário.
  const perfis = await db.proprietarioPerfil.findMany({
    where:   { userId, valorAssistencia: { gt: 0 } },
    select:  { empresaId: true, valorAssistencia: true },
    orderBy: { empresaId: 'asc' },
  });
  if (perfis.length === 0) return doUsuarioLegado();
  if (perfis.length > 1) {
    // Cliente mensalista em mais de uma clínica com UMA fatura só: ambiguidade real,
    // que só some quando `Fatura` ganhar `empresaId` (pendência do multi-tenant).
    console.warn(
      `[Assistencia] Proprietário ${userId} tem assistência em ${perfis.length} empresas ` +
      `(${perfis.map(p => p.empresaId).join(', ')}) e a fatura não tem empresaId. ` +
      `Usando a empresa ${perfis[0].empresaId}.`,
    );
  }
  return perfis[0].valorAssistencia;
}

/**
 * Dia de vencimento da fatura — `ProprietarioPerfil.diaVencimentoFatura` da EMPRESA
 * da fatura (campo "Dia de vencimento da fatura" da tela de Proprietários).
 *
 * ⚠️ Mesma armadilha do valor da assistência: NÃO ler de `users`. O cadastro é por
 * empresa desde a migration 20260724000000 — o mesmo cliente pode vencer dia 5 numa
 * clínica e dia 20 na outra. Fallback ao User só para cadastro legado sem perfil.
 *
 * Não confundir com o FECHAMENTO da fatura, que é outra data e outra fonte:
 * `EmpresaConfiguracao.tipoFechamento`/`diaFechamentoFatura` (tela de Configurações
 * da empresa), aplicada por `deveFecharHoje` em `lib/faturaUtils.js`.
 */
async function diaVencimentoDoProprietario(proprietarioId, empresaId = null, db = prisma) {
  const userId = Number(proprietarioId);
  if (!userId) return null;

  if (empresaId) {
    const perfil = await db.proprietarioPerfil.findUnique({
      where:  { userId_empresaId: { userId, empresaId: Number(empresaId) } },
      select: { diaVencimentoFatura: true },
    });
    if (perfil) return perfil.diaVencimentoFatura;
  }

  // Fatura legada sem empresa: aceita o perfil quando ele é único e não ambíguo
  const perfis = await db.proprietarioPerfil.findMany({
    where:    { userId, diaVencimentoFatura: { not: null } },
    select:   { diaVencimentoFatura: true },
    distinct: ['diaVencimentoFatura'],
  });
  if (perfis.length === 1) return perfis[0].diaVencimentoFatura;

  const user = await db.user.findUnique({ where: { id: userId }, select: { diaVencimentoFatura: true } });
  return user?.diaVencimentoFatura ?? null;
}

/**
 * Adiciona o item de assistência veterinária mensal à fatura. Idempotente DENTRO da
 * fatura — como há uma fatura por `mesReferencia`, o efeito é a cobrança recorrente:
 * exatamente um item por mês.
 *
 * O gatilho é o VALOR (> 0), não o flag `mensalista`: na tela, desmarcar "mensalista"
 * limpa o campo e envia `valorAssistencia: null`, então valor > 0 já implica mensalista.
 * Depender do flag só acrescentaria uma segunda fonte de verdade capaz de divergir.
 *
 * @param proprietario id do proprietário (aceita também o objeto, por compatibilidade)
 * @param empresaId    empresa da FATURA (`Fatura.empresaId`); null só em fatura legada
 * @param db           🔴 OBRIGATÓRIO no CRON: o `tx` da empresa da vez. Com o `prisma`
 *   global, o cron não achava o `ProprietarioPerfil` (RLS sem tenant) e o mensalista
 *   simplesmente deixava de ser cobrado no fechamento — sem erro nenhum, porque "não
 *   achei perfil" e "não é mensalista" produzem o mesmo `return false`.
 */
async function adicionarAssistenciaMensal(faturaId, proprietario, veterinarioId = null, empresaId = null, db = prisma) {
  const proprietarioId = typeof proprietario === 'object' ? proprietario?.id : proprietario;
  const valor = await resolverAssistencia(proprietarioId, empresaId, db);
  if (!valor || valor <= 0) return false;

  const existeAssistencia = await db.faturaItem.findFirst({
    where: { faturaId, tipo: 'ASSISTENCIA', descricao: 'Assistência Veterinária Mensal' },
  });
  if (existeAssistencia) return false;
  await db.faturaItem.create({
    data: {
      faturaId,
      tipo:         'ASSISTENCIA',
      descricao:    'Assistência Veterinária Mensal',
      valor,
      quantidade:   1,
      veterinarioId: veterinarioId ?? null,
    },
  });
  await recalcularTotal(faturaId, db);
  return true;
}

// ISOLAMENTO ENTRE EMPRESAS na fatura alcançada por ID.
//
// `checkPermission('financeiro.faturas.*')` diz que a pessoa mexe em fatura — não em
// QUAL fatura. `adicionarItem`, `atualizarItem`, `removerItem` e `atualizarStatus`
// chegavam ao documento só pelo id: dava para lançar cobrança, alterar valor e marcar
// como PAGA a fatura de OUTRA clínica trocando o número na URL.
//
// `fecharFatura` já fazia esta checagem — aqui ela vira função única para os quatro.
// Fatura legada sem `empresaId` (anterior ao multi-tenant) NÃO é bloqueada: travá-la
// deixaria o financeiro dessas bases sem conserto. Quem tem tenant definido é comparado.
function faturaForaDoEscopo(fatura, req) {
  return Boolean(req.empresaId && fatura?.empresaId && fatura.empresaId !== Number(req.empresaId));
}

// Gera o PDF da fatura, salva no storage (`storage.upload()` — hoje bytea no
// banco; `STORAGE_DRIVER=s3` troca o driver sem tocar aqui, ver CLAUDE.md §8) e
// cria o link público. Compartilhado por `enviarLinkWhatsapp`/`enviarLinkEmail`
// para não gerar um PDF (e uma linha em `tb_fatura_links_publicos`) por canal
// quando o vet manda pelos dois — mas como cada clique é uma ação SEPARADA do
// usuário, um link novo por envio é aceitável (e mais simples que rastrear se o
// conteúdo mudou desde o último).
async function gerarLinkPublicoDaFatura({ fatura, req, html, nomeArquivo, canal, destino }) {
  const pdf = await htmlParaPdf(html);
  const url = await storage.upload(
    { buffer: pdf, mimetype: 'application/pdf', originalname: nomeArquivo, size: pdf.length },
    'faturas',
    { empresaId: req.empresaId, criadoPorId: req.user.id },
  );
  const midiaChave = chaveDaUrl(url);

  return criarLinkFaturaPublico({
    faturaId:       fatura.id,
    empresaId:      req.empresaId,
    proprietarioId: fatura.proprietarioId,
    midiaChave,
    criadoPorId:    req.user.id,
    canal,
    destino,
  });
}

const FaturaController = {

  // GET /proprietarios
  // Lista todos os proprietários cujos animais estão vinculados ao vet logado
  // OU pertencem à empresa do vet (acesso compartilhado entre gestores da equipe).
  // Quando chamado por um PROPRIETÁRIO, retorna os próprios dados (ver fatura própria).
  listarProprietarios: async (req, res) => {
    const vetId     = req.user.id;
    const empresaId = req.empresaId ?? null;
    try {
      // PROPRIETÁRIO visualizando a própria fatura
      const caller = await prisma.user.findUnique({
        where:  { id: vetId },
        select: { userType: true },
      });
      if (caller?.userType === 'PROPRIETARIO') {
        const ANIMAL_SELECT = {
          id: true, nome: true,
          especie: { select: { nome: true } },
          raca:    { select: { nome: true } },
          photoUrl: true,
        };
        const prop = await prisma.user.findUnique({
          where:  { id: vetId },
          select: {
            id: true, fullName: true, email: true, phone: true,
            animais: { where: { ativo: true }, select: ANIMAL_SELECT },
            faturas: {
              where:   { status: { in: ['ABERTA', 'FECHADA', 'ATRASADA', 'PAGA'] } },
              orderBy: { criadoEm: 'desc' },
              take:    6,
              select:  { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
            },
          },
        });
        if (!prop) return res.json({ dados: [] });
        const faturaAberta   = prop.faturas.find(f => f.status === 'ABERTA')   ?? null;
        const faturaFechada  = prop.faturas.find(f => f.status === 'FECHADA')  ?? null;
        const faturaAtrasada = prop.faturas.find(f => f.status === 'ATRASADA') ?? null;
        const faturaPaga     = prop.faturas.find(f => f.status === 'PAGA')     ?? null;
        const dados = [{ ...prop, faturaAtiva: faturaAberta ?? null, faturaFechada, faturaAtrasada, faturaPaga, faturas: undefined }];
        return res.json({ dados });
      }

      // Escopo por equipe dentro da empresa ativa (segregação entre equipes do gestor)
      const equipeScope = empresaId
        ? await getEquipeScopeDoUsuario(vetId, empresaId, req.equipeId)
        : null;

      // ⚠️ REMOVIDO (fase 3 do multi-tenancy): aqui os proprietários também vinham dos
      // VÍNCULOS diretos do vet (`VetAnimalSolicitacao`), que traziam cliente de animal de
      // QUALQUER empresa para a lista de faturamento — dinheiro de outra clínica na tela
      // desta. Com o fim dos vínculos, os clientes saem só dos animais da empresa ativa,
      // logo abaixo.
      let proprietarioIds = [];

      // Proprietários via animais da(s) equipe(s) do vet na empresa ativa
      if (empresaId) {
        const animaisEmpresa = await prisma.animal.findMany({
          where: {
            empresaId,
            ativo: true,
            ...(equipeScope ? { OR: [{ equipeId: { in: equipeScope } }, { equipeId: null }] } : {}),
          },
          select: { userId: true },
        });
        const idsEmpresa = animaisEmpresa.map(a => a.userId);
        proprietarioIds = [...new Set([...proprietarioIds, ...idsEmpresa])];

        // Proprietário INATIVADO (removido da empresa) some dos animais ativos acima,
        // mas não pode sumir da tela enquanto tiver fatura pendente de pagamento —
        // senão o financeiro perde de vista uma cobrança em aberto só porque o
        // cliente foi desligado. Cobre ABERTA/FECHADA/ATRASADA (qualquer uma ainda
        // não paga); fatura já PAGA não precisa reter o proprietário na lista.
        const faturasPendentes = await prisma.fatura.findMany({
          where:  { empresaId, status: { in: ['ABERTA', 'FECHADA', 'ATRASADA'] }, proprietarioId: { not: null } },
          select: { proprietarioId: true },
        });
        proprietarioIds = [...new Set([...proprietarioIds, ...faturasPendentes.map(f => f.proprietarioId)])];
      }

      if (proprietarioIds.length === 0) return res.json({ dados: [] });

      // O MESMO animal pode ter um cadastro em cada clínica (registro isolado por
      // empresa). Sem este filtro, a fatura listava as duas cópias e repetia a seção
      // "Informação do Cavalo". Animal legado sem empresa continua aparecendo.
      const whereAnimaisDoEscopo = {
        ativo: true,
        // FAIL-CLOSED: sem empresa, `-1` não casa com clínica alguma.
        //
        // ⚠️ Aqui NÃO cabe `escopoCatalogoEmpresa`. Aquele helper é de CATÁLOGO — devolve
        // `OR: [{empresaId: id}, {empresaId: null}]`, onde o nulo é a LINHA GLOBAL
        // compartilhada (medicamento, procedimento, localização). `Animal` não tem linha
        // global: `tb_animais.empresaId` virou NOT NULL na fase 5, e o ramo `empresaId:
        // null` passou a fazer o Prisma RECUSAR a consulta inteira — a tela de
        // Faturamento devolvia HTTP 500 ("Argument `empresaId` is missing").
        empresaId: empresaId ? Number(empresaId) : -1,
      };

      const proprietarios = await prisma.user.findMany({
        where: { id: { in: proprietarioIds } },
        select: {
          id: true, fullName: true, email: true, phone: true, ativo: true,
          valorAssistencia: true, mensalista: true,
          animais: {
            where: whereAnimaisDoEscopo,
            select: {
              id: true, nome: true,
              especie: { select: { nome: true } },
              raca:    { select: { nome: true } },
              photoUrl: true,
            },
          },
          faturas: {
            where: { status: { in: ['ABERTA', 'FECHADA', 'ATRASADA'] } },
            orderBy: { criadoEm: 'desc' },
            take: 6,
            select: { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
          },
        },
        orderBy: { fullName: 'asc' },
      });

      // Busca a fatura PAGA mais recente por proprietário
      const faturasPagas = proprietarioIds.length > 0
        ? await prisma.fatura.findMany({
            // Escopo por empresa: a clínica não vê a fatura paga na outra clínica
            where: { proprietarioId: { in: proprietarioIds }, status: 'PAGA', empresaId: req.empresaId ? Number(req.empresaId) : null },
            orderBy: { criadoEm: 'desc' },
            select: { id: true, total: true, status: true, mesReferencia: true, proprietarioId: true },
          })
        : [];

      const faturaPagaPorProp = faturasPagas.reduce((acc, f) => {
        if (!acc[f.proprietarioId]) acc[f.proprietarioId] = f;
        return acc;
      }, {});

      // Nome/telefone/condição comercial conforme o cadastro DESTA empresa
      const comPerfil = await aplicarPerfilProprietarioEmLista(proprietarios, req.empresaId);

      const dados = comPerfil
        // 🔴 CLIENTE SEM PACIENTE NÃO ENTRA NA LISTA (a pedido, 2026-09-02). A tela de
        // Faturamento é por PACIENTE — o lançamento, o rateio e a seção "Informação do
        // Cavalo" da fatura partem dele —, então um cliente sem nenhum animal no escopo
        // é uma linha em que não há o que cobrar.
        //
        // ⚠️ QUEM ISTO REMOVE, na prática, é o cliente retido pela regra da fatura
        // PENDENTE logo acima (o desligado da empresa, ou aquele cujos pacientes foram
        // todos excluídos): sem paciente e sem fatura pendente ele já não aparecia.
        // CONSEQUÊNCIA ACEITA: uma fatura ABERTA/FECHADA/ATRASADA desse cliente deixa de
        // ser alcançável por esta tela. Para trazê-lo de volta, o caminho é reativar um
        // paciente dele — ou trocar este filtro por "sem paciente E sem fatura pendente".
        .filter(p => p.animais.length > 0)
        .map(p => ({
          ...p,
          faturaAtiva:    p.faturas.find(f => f.status === 'ABERTA')   ?? null,
          faturaFechada:  p.faturas.find(f => f.status === 'FECHADA')  ?? null,
          faturaAtrasada: p.faturas.find(f => f.status === 'ATRASADA') ?? null,
          faturaPaga:     faturaPagaPorProp[p.id] ?? null,
          faturas: undefined,
        }));

      res.json({ dados });
    } catch (err) {
      console.error('Erro ao listar proprietários:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /proprietario/:proprietarioId?faturaId=N&mes=YYYY-MM
  // Sem faturaId/mes → retorna (ou cria) a fatura ABERTA do mês atual.
  // Com faturaId      → retorna a fatura específica pelo ID (sem criar).
  // Com mes           → retorna a fatura do proprietário no mês (sem criar; null se não houver).
  // Sempre inclui `meses` — lista de faturas do proprietário para o seletor de mês/ano.
  obterFaturaProprietario: async (req, res) => {
    const { proprietarioId } = req.params;
    const { faturaId, mes }  = req.query;
    const mesRef = mesReferenciaAtual();

    try {
      // ESCOPO POR EMPRESA em todas as buscas: a clínica só enxerga as faturas que ela
      // mesma emitiu para este cliente. `empresaId` entra em TODO `where` daqui —
      // omiti-lo em qualquer um deles reabre o vazamento entre clínicas.
      const empresaId = req.empresaId ? Number(req.empresaId) : null;

      // 🔒 AUTORIZAÇÃO A NÍVEL DE OBJETO: o `:proprietarioId` da URL precisa ser cliente
      // DESTA empresa. Sem isto, enumerar ids devolvia PII (nome/e-mail/telefone via
      // `include.proprietario`, lido de `users` — sem RLS) e criava fatura para cliente
      // alheio. 404 (não 403): não confirma que o usuário existe. Só quando há empresa
      // no contexto (ADMIN de plataforma / legado sem empresa mantêm o comportamento).
      if (empresaId && !(await ehClienteDaEmpresa(proprietarioId, empresaId))) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      const doProprietario = { proprietarioId: Number(proprietarioId), empresaId };

      // Meses/faturas existentes do proprietário NESTA empresa — alimenta o seletor.
      const meses = await prisma.fatura.findMany({
        where:   doProprietario,
        select:  { id: true, mesReferencia: true, status: true },
        orderBy: { mesReferencia: 'desc' },
      });

      if (mes) {
        const fatura = await prisma.fatura.findFirst({
          where:   { ...doProprietario, mesReferencia: String(mes) },
          include: FATURA_INCLUDE,
          orderBy: { criadoEm: 'desc' },
        });
        return res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId) ?? null, meses });
      }

      if (faturaId) {
        const fatura = await prisma.fatura.findFirst({
          where:   { ...doProprietario, id: Number(faturaId) },
          include: FATURA_INCLUDE,
        });
        if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
        return res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId), meses });
      }

      let fatura = await prisma.fatura.findFirst({
        where:   { ...doProprietario, status: 'ABERTA' },
        include: FATURA_INCLUDE,
        orderBy: { criadoEm: 'desc' },
      });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { ...doProprietario, mesReferencia: mesRef, total: 0, status: 'ABERTA' },
          include: FATURA_INCLUDE,
        });
      }

      // Adiciona assistência mensal automaticamente ao abrir (idempotente — não duplica).
      // `req.empresaId` é obrigatório aqui: o valor vem do ProprietarioPerfil da empresa.
      const adicionou = await adicionarAssistenciaMensal(fatura.id, fatura.proprietarioId, null, req.empresaId);
      if (adicionou) {
        fatura = await prisma.fatura.findUnique({ where: { id: fatura.id }, include: FATURA_INCLUDE });
      }

      // Inclui a fatura recém-criada/aberta na lista de meses, se ainda não estiver.
      if (fatura && !meses.some(m => m.id === fatura.id)) {
        meses.unshift({ id: fatura.id, mesReferencia: fatura.mesReferencia, status: fatura.status });
      }
      res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId), meses });
    } catch (err) {
      console.error('Erro ao obter fatura do proprietário:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /proprietario/:proprietarioId/logo-empresa
  // Logo da empresa/equipe do proprietário — usado na impressão/PDF/compartilhamento
  // da fatura em vez da marca S2Vet.
  obterLogoEmpresaProprietario: async (req, res) => {
    try {
      // Mesmo guard de objeto do `obterFaturaProprietario`: proprietário fora da
      // empresa do contexto não deve nem revelar a logo/empresa vinculada a ele.
      const empresaId = req.empresaId ? Number(req.empresaId) : null;
      if (empresaId && !(await ehClienteDaEmpresa(req.params.proprietarioId, empresaId))) {
        return res.status(404).json({ error: 'Proprietário não encontrado' });
      }
      const logoUrl = await resolverLogoPorProprietario(req.params.proprietarioId);
      res.json({ dados: { logoUrl } });
    } catch (err) {
      console.error('Erro ao obter logo do proprietário:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /:faturaId/itens
  adicionarItem: async (req, res) => {
    const { faturaId }  = req.params;
    const { tipo, descricao, valor, quantidade = 1, animalId, descontoTipo, descontoValor } = req.body;
    const veterinarioId = req.user.id;

    if (!tipo || !descricao || valor === undefined || valor === null) {
      return res.status(400).json({ error: 'tipo, descricao e valor são obrigatórios' });
    }

    let desconto;
    try {
      desconto = normalizarDesconto(descontoTipo, descontoValor);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const fatura = await prisma.fatura.findUnique({ where: { id: Number(faturaId) }, select: { status: true, empresaId: true } });
      if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
      // Fatura de outra clínica responde 404 (e não 403): não confirma que ela existe.
      if (faturaForaDoEscopo(fatura, req)) return res.status(404).json({ error: 'Fatura não encontrada' });
      if (fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode receber novos itens.', code: 'FATURA_PAGA' });
      }

      const item = await prisma.faturaItem.create({
        data: {
          faturaId:     Number(faturaId),
          animalId:     animalId ? Number(animalId) : null,
          tipo,
          descricao,
          valor:        Number(valor),
          quantidade:   Number(quantidade),
          veterinarioId,
          ...desconto,
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(Number(faturaId));
      res.status(201).json({ dados: comOrigemDoItem(item), totalFatura: total });
    } catch (err) {
      console.error('Erro ao adicionar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PUT /itens/:itemId
  atualizarItem: async (req, res) => {
    const { itemId } = req.params;
    const { tipo, descricao, valor, quantidade, descontoTipo, descontoValor } = req.body;

    // O desconto só é tocado quando o request menciona algum dos dois campos —
    // assim um PATCH parcial (ex: só a descrição) não zera um desconto existente.
    const mexeuNoDesconto = descontoTipo !== undefined || descontoValor !== undefined;
    let desconto = null;
    if (mexeuNoDesconto) {
      try {
        desconto = normalizarDesconto(descontoTipo, descontoValor);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    try {
      const item = await prisma.faturaItem.findUnique({
        where:   { id: Number(itemId) },
        include: { fatura: { select: { status: true, empresaId: true } } },
      });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (faturaForaDoEscopo(item.fatura, req)) return res.status(404).json({ error: 'Item não encontrado' });
      if (item.fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' });
      }

      const updated = await prisma.faturaItem.update({
        where: { id: Number(itemId) },
        data: {
          ...(tipo       !== undefined && { tipo }),
          ...(descricao  !== undefined && { descricao }),
          ...(valor      !== undefined && { valor: Number(valor) }),
          ...(quantidade !== undefined && { quantidade: Number(quantidade) }),
          ...(desconto ?? {}),
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(item.faturaId);
      await registrarCorrecaoFatura(prisma, item.faturaId);
      res.json({ dados: comOrigemDoItem(updated), totalFatura: total });
    } catch (err) {
      console.error('Erro ao atualizar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // DELETE /itens/:itemId
  removerItem: async (req, res) => {
    const { itemId } = req.params;
    const { motivo } = req.body ?? {};

    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const item = await prisma.faturaItem.findUnique({
        where:   { id: Number(itemId) },
        include: { fatura: { select: { status: true, mesReferencia: true, empresaId: true } } },
      });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (faturaForaDoEscopo(item.fatura, req)) return res.status(404).json({ error: 'Item não encontrado' });
      if (item.fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.faturaItem.delete({ where: { id: Number(itemId) } });
        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'FATURA_ITEM',
          entidadeId: Number(itemId),
          animalId:   item.animalId ?? null,
          motivo,
          detalhes:   `${item.descricao ?? 'Item de fatura'} (fatura #${item.faturaId}${item.fatura.mesReferencia ? ` · ${item.fatura.mesReferencia}` : ''})`,
        });
      });
      const total = await recalcularTotal(item.faturaId);
      await registrarCorrecaoFatura(prisma, item.faturaId);

      res.json({ mensagem: 'Item removido', totalFatura: total });
    } catch (err) {
      console.error('Erro ao remover item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PATCH /:faturaId/status
  atualizarStatus: async (req, res) => {
    const { faturaId } = req.params;
    const { status }   = req.body;

    const VALIDOS = ['ABERTA', 'PAGA', 'CANCELADA', 'FECHADA'];
    if (!VALIDOS.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${VALIDOS.join(', ')}` });
    }

    try {
      // Confere o tenant ANTES de gravar: como o update ia direto pelo id, dava para
      // marcar como PAGA (ou CANCELADA) a fatura de outra clínica.
      const alvo = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        select: { id: true, empresaId: true, status: true, proprietarioId: true },
      });
      if (!alvo || faturaForaDoEscopo(alvo, req)) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }

      // 🔴 FATURA PAGA É SOMENTE LEITURA (2026-09-02).
      //
      // Item de fatura paga já não podia ser incluído, alterado nem removido — mas o
      // STATUS podia voltar para ABERTA por esta rota, e a partir daí tudo voltava a
      // ser editável. Era a porta dos fundos do bloqueio inteiro: bastava reabrir para
      // reescrever uma cobrança que o cliente já quitou.
      //
      // ⚠️ REABRIR continua POSSÍVEL, mas só para o GESTOR — mesma escolha da
      // reativação do paciente (`AnimalController.ativar`). Sem nenhuma saída, um
      // clique errado em "Marcar como Pago" congelaria a fatura para sempre, o que é
      // pior que o problema. E a reabertura vai para a AUDITORIA, porque é ela que
      // responde "quem destravou uma fatura quitada, e quando".
      const saindoDePaga = alvo.status === 'PAGA' && status !== 'PAGA';
      if (saindoDePaga && !ehGestorNoContexto(req)) {
        return res.status(400).json({
          error: 'Fatura paga fica em SOMENTE LEITURA. Só o gestor pode reabri-la.',
          code:  'FATURA_PAGA',
        });
      }

      const fatura = await prisma.$transaction(async (tx) => {
        const atualizada = await tx.fatura.update({
          where:   { id: Number(faturaId) },
          data:    { status },
          include: FATURA_INCLUDE,
        });
        if (saindoDePaga) {
          await registrarAuditoria(tx, req, {
            categoria:  'ALTERACAO',
            entidade:   'FATURA',
            entidadeId: alvo.id,
            detalhes:   `Fatura PAGA reaberta como ${status}`,
          });
        }
        return atualizada;
      });
      res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId) });
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /:faturaId/enviar-whatsapp { html, nomeArquivo, texto, telefone? }
  //
  // Gera o PDF (Puppeteer, mesmo pipeline do botão Imprimir), salva no storage
  // e manda uma mensagem de WhatsApp com o LINK público — nunca mais o PDF
  // anexado direto. Ver lib/faturaLinkPublico.js para o porquê (o anexo
  // dependia do Puppeteer + upload terminarem dentro da janela de espera do
  // navegador do vet; o link desacopla isso — a mensagem em si é só texto).
  enviarLinkWhatsapp: async (req, res) => {
    const { faturaId } = req.params;
    const { html, nomeArquivo, texto, telefone: telefoneBody } = req.body ?? {};
    if (!html || !nomeArquivo) return res.status(400).json({ error: 'html e nomeArquivo são obrigatórios.' });
    if (!req.empresaId) return res.status(400).json({ error: 'Sem empresa no contexto.', code: 'SEM_EMPRESA' });

    try {
      const fatura = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        select: {
          id: true, empresaId: true, proprietarioId: true,
          proprietario: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      });
      if (!fatura || faturaForaDoEscopo(fatura, req)) return res.status(404).json({ error: 'Fatura não encontrada' });
      if (!fatura.proprietario) return res.status(400).json({ error: 'Fatura sem proprietário.' });

      const proprietario = await aplicarPerfilProprietario(fatura.proprietario, req.empresaId);
      const telefone = (telefoneBody || '').trim() || proprietario.phone;
      if (!telefone) return res.status(400).json({ error: 'Proprietário sem telefone cadastrado.', code: 'SEM_TELEFONE' });

      const link = await gerarLinkPublicoDaFatura({ fatura, req, html, nomeArquivo, canal: 'WHATSAPP', destino: telefone });

      const mensagem = [texto, `📄 Abra a fatura pelo link: ${link.url}`].filter(Boolean).join('\n\n');
      // enfileirarEnvioFatura: tenta na hora e grava o resultado no link (status/
      // tentativas/proximaTentativaEm) — falha aqui NÃO é erro de requisição, o
      // cron de reenvio (services/faturaLinkCronService.js) tenta de novo sozinho.
      const envio = await enfileirarEnvioFatura(link.id, async () => {
        const res = await whatsappService.sendMessage(
          { empresaId: req.empresaId, equipeId: req.equipeId ?? null }, telefone, mensagem,
        );
        return res?.sucesso
          ? { sucesso: true, simulado: !!res.simulado }
          : { sucesso: false, erro: res?.erro ?? 'ERRO_ENVIO' };
      });

      return res.json({
        dados: {
          enviado:  !!envio?.sucesso,
          simulado: !!envio?.simulado,
          status:   envio?.sucesso ? 'ENVIADO' : 'PENDENTE_REENVIO',
          url: link.url, telefone,
        },
      });
    } catch (err) {
      console.error('FaturaController.enviarLinkWhatsapp:', err);
      return res.status(500).json({ error: 'Erro ao enviar a fatura por WhatsApp.' });
    }
  },

  // POST /:faturaId/enviar-email { html, nomeArquivo, texto, titulo, email? }
  // Mesma lógica do WhatsApp: PDF salvo + LINK por e-mail, nunca anexo.
  enviarLinkEmail: async (req, res) => {
    const { faturaId } = req.params;
    const { html, nomeArquivo, texto, titulo, email: emailBody } = req.body ?? {};
    if (!html || !nomeArquivo) return res.status(400).json({ error: 'html e nomeArquivo são obrigatórios.' });
    if (!req.empresaId) return res.status(400).json({ error: 'Sem empresa no contexto.', code: 'SEM_EMPRESA' });

    try {
      const fatura = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        select: {
          id: true, empresaId: true, proprietarioId: true,
          proprietario: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      });
      if (!fatura || faturaForaDoEscopo(fatura, req)) return res.status(404).json({ error: 'Fatura não encontrada' });
      if (!fatura.proprietario) return res.status(400).json({ error: 'Fatura sem proprietário.' });

      const proprietario = await aplicarPerfilProprietario(fatura.proprietario, req.empresaId);
      const destino = (emailBody || '').trim() || proprietario.email;
      if (!destino) return res.status(400).json({ error: 'Proprietário sem e-mail cadastrado.', code: 'SEM_EMAIL' });

      const link = await gerarLinkPublicoDaFatura({ fatura, req, html, nomeArquivo, canal: 'EMAIL', destino });

      if (!emailService.estaConfigurado()) {
        return res.json({ dados: { enviado: false, status: 'SEM_PROVEDOR', url: link.url } });
      }

      const envio = await enfileirarEnvioFatura(link.id, async () => {
        try {
          await emailService.enviarLinkFatura({
            proprietarioEmail: destino,
            proprietarioNome:  proprietario.fullName ?? 'Cliente',
            assunto:            titulo || nomeArquivo,
            corpo:              texto || '',
            url:                link.url,
          });
          return { sucesso: true };
        } catch (err) {
          return { sucesso: false, erro: err.message };
        }
      });

      return res.json({
        dados: {
          enviado: !!envio?.sucesso,
          status:  envio?.sucesso ? 'ENVIADO' : 'PENDENTE_REENVIO',
          url: link.url,
        },
      });
    } catch (err) {
      console.error('FaturaController.enviarLinkEmail:', err);
      return res.status(500).json({ error: 'Erro ao enviar a fatura por e-mail.' });
    }
  },

  // GET /:faturaId/links — histórico de links enviados desta fatura (canal,
  // destino, status, tentativas, acessos, revogação). Escopado pela mesma
  // checagem de tenant que os demais endpoints de fatura.
  listarLinks: async (req, res) => {
    const { faturaId } = req.params;
    try {
      const fatura = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        select: { id: true, empresaId: true },
      });
      if (!fatura || faturaForaDoEscopo(fatura, req)) return res.status(404).json({ error: 'Fatura não encontrada' });

      const links = await prisma.faturaLinkPublico.findMany({
        where:   { faturaId: Number(faturaId) },
        orderBy: { criadoEm: 'desc' },
        select: {
          id: true, canal: true, destino: true, status: true, tentativas: true,
          ultimoErro: true, enviadoEm: true, proximaTentativaEm: true,
          revogadoEm: true, ultimoAcessoEm: true, qtdAcessos: true, expiraEm: true, criadoEm: true,
        },
      });
      return res.json({ dados: links });
    } catch (err) {
      console.error('FaturaController.listarLinks:', err);
      return res.status(500).json({ error: 'Erro ao listar os links da fatura.' });
    }
  },

  // PATCH /:faturaId/links/:linkId/revogar — encerra o link IMEDIATAMENTE
  // (diferente de deixar expirar em 30 dias). Mesmo gate de permissão dos
  // demais endpoints de envio da fatura (financeiro.faturas.editar).
  revogarLink: async (req, res) => {
    const { faturaId, linkId } = req.params;
    try {
      const fatura = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        select: { id: true, empresaId: true },
      });
      if (!fatura || faturaForaDoEscopo(fatura, req)) return res.status(404).json({ error: 'Fatura não encontrada' });

      const link = await prisma.faturaLinkPublico.findUnique({ where: { id: Number(linkId) } });
      if (!link || link.faturaId !== fatura.id) return res.status(404).json({ error: 'Link não encontrado' });
      if (link.revogadoEm) return res.json({ dados: link }); // idempotente

      const revogado = await revogarLinkFaturaPublico(link.id, req.user.id);
      await registrarAuditoria(null, req, {
        categoria: 'CANCELAMENTO', entidade: 'FATURA_LINK', entidadeId: link.id,
        motivo: `Link de fatura (${link.canal ?? '—'} para ${link.destino ?? '—'}) revogado manualmente.`,
      });
      return res.json({ dados: revogado });
    } catch (err) {
      console.error('FaturaController.revogarLink:', err);
      return res.status(500).json({ error: 'Erro ao revogar o link.' });
    }
  },

  // PATCH /:faturaId/fechar
  // Fecha a fatura: adiciona assistência veterinária mensal (se aplicável) e muda status para FECHADA.
  // Idempotente: não duplica o item de assistência se já existir.
  fecharFatura: async (req, res) => {
    const { faturaId } = req.params;

    try {
      const fatura = await prisma.fatura.findUnique({
        where:   { id: Number(faturaId) },
        include: { proprietario: { select: { id: true, valorAssistencia: true, mensalista: true } } },
      });

      if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
      // Isolamento entre clínicas: não se fecha fatura emitida por outra empresa
      if (req.empresaId && fatura.empresaId && fatura.empresaId !== Number(req.empresaId)) {
        return res.status(404).json({ error: 'Fatura não encontrada' });
      }
      if (fatura.status !== 'ABERTA') {
        return res.status(400).json({ error: 'Apenas faturas com status ABERTA podem ser fechadas' });
      }

      // A assistência é a da EMPRESA DA FATURA (não a do contexto de quem fecha)
      await adicionarAssistenciaMensal(Number(faturaId), fatura.proprietarioId, req.user.id, fatura.empresaId ?? req.empresaId);

      const faturaFechada = await prisma.fatura.update({
        where:   { id: Number(faturaId) },
        data:    { status: 'FECHADA' },
        include: FATURA_INCLUDE,
      });

      res.json({ dados: await comPerfilDaEmpresa(faturaFechada, req.empresaId) });
    } catch (err) {
      console.error('Erro ao fechar fatura:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /fechar-lote  { faturaIds: number[] }
  // Fecha em lote as faturas ABERTAS informadas (IDs vêm da lista já escopada por
  // listarProprietarios). Aplica a mesma regra de fecharFatura (assistência mensal
  // + status FECHADA). Ignora IDs inexistentes, não-ABERTA ou de outra empresa.
  fecharFaturasLote: async (req, res) => {
    const { faturaIds } = req.body;
    if (!Array.isArray(faturaIds) || faturaIds.length === 0) {
      return res.status(400).json({ error: 'Informe as faturas a fechar' });
    }
    try {
      const fechadas = [];
      for (const rawId of faturaIds) {
        const id = Number(rawId);
        if (!Number.isInteger(id)) continue;
        const fatura = await prisma.fatura.findUnique({
          where:   { id },
          include: {
            proprietario: { select: { id: true, fullName: true, phone: true, email: true, empresaId: true, valorAssistencia: true, mensalista: true } },
          },
        });
        if (!fatura || fatura.status !== 'ABERTA') continue;
        // Guarda de escopo: a fatura precisa ser DESTA empresa. Antes o teste era pelo
        // `empresaId` do PROPRIETÁRIO (que é global e não diz de quem é a fatura) —
        // agora é pelo da própria fatura, que é a tenancy real do documento.
        if (req.empresaId && fatura.empresaId && fatura.empresaId !== Number(req.empresaId)) continue;

        await adicionarAssistenciaMensal(id, fatura.proprietarioId, req.user.id, fatura.empresaId ?? req.empresaId);
        const atualizada = await prisma.fatura.update({
          where:  { id },
          data:   { status: 'FECHADA' },
          select: { id: true, total: true, mesReferencia: true },
        });
        fechadas.push({
          faturaId:      atualizada.id,
          total:         atualizada.total,
          mesReferencia: atualizada.mesReferencia,
          proprietario:  {
            id:       fatura.proprietario.id,
            fullName: fatura.proprietario.fullName,
            phone:    fatura.proprietario.phone,
            email:    fatura.proprietario.email,
          },
        });
      }
      res.json({ dados: { fechadas, total: fechadas.length } });
    } catch (err) {
      console.error('Erro ao fechar faturas em lote:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /catalogo-itens — itens frequentes da empresa (dropdown de nova fatura)
  listarCatalogo: async (req, res) => {
    try {
      const empresaId = req.empresaId ?? null;
      const itens = await prisma.faturaItemCatalogo.findMany({
        // `tb_fatura_item_catalogo.empresa_id` é NOT NULL desde a fase 5.
        where:   { ativo: true, empresaId },
        orderBy: { descricao: 'asc' },
        select:  { id: true, tipo: true, descricao: true, valor: true },
      });
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar catálogo de itens:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /catalogo-itens { tipo, descricao, valor } — cria item frequente
  // `tipo` é texto livre (igual FaturaItem.tipo, ver adicionarItem) — NÃO validar
  // contra uma lista fixa. Já existiu uma whitelist só com ASSISTENCIA/MEDICAMENTO/
  // PROCEDIMENTO que rebaixava silenciosamente qualquer outro tipo (TRANSPORTE, ou
  // qualquer tipo novo digitado no modal "+ Novo tipo…" da tela de Faturamento)
  // para ASSISTENCIA — o item entrava no catálogo, só que arquivado no tipo errado
  // e inalcançável de novo pelo tipo escolhido.
  criarItemCatalogo: async (req, res) => {
    const { tipo, descricao, valor } = req.body;
    if (!descricao || !String(descricao).trim()) {
      return res.status(400).json({ error: 'Informe a descrição do item' });
    }
    const tipoFinal = (tipo && String(tipo).trim()) ? String(tipo).trim().toUpperCase() : 'ASSISTENCIA';
    try {
      const item = await prisma.faturaItemCatalogo.create({
        data: {
          empresaId:   req.empresaId ?? null,
          tipo:        tipoFinal,
          descricao:   String(descricao).trim(),
          valor:       Number(valor) || 0,
          criadoPorId: req.user.id,
        },
        select: { id: true, tipo: true, descricao: true, valor: true },
      });
      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar item de catálogo:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // DELETE /catalogo-itens/:id — remove item frequente do próprio escopo
  excluirItemCatalogo: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const item = await prisma.faturaItemCatalogo.findUnique({ where: { id } });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (req.empresaId && item.empresaId && item.empresaId !== req.empresaId) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
      await prisma.faturaItemCatalogo.delete({ where: { id } });
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao excluir item de catálogo:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // Legado — mantido para compatibilidade
  obterFaturaAberta: async (req, res) => {
    const { animalId } = req.params;
    try {
      // O acesso ao ANIMAL é garantido pelo middleware da rota. Falta o tenant do
      // DOCUMENTO: o mesmo paciente pode ser atendido por duas clínicas, e sem este
      // filtro uma via (e criava item n)a fatura aberta da outra.
      const empresaId = req.empresaId ? Number(req.empresaId) : null;

      let fatura = await prisma.fatura.findFirst({
        where:   { animalId: Number(animalId), status: 'ABERTA', empresaId },
        include: { itens: { include: { veterinario: { select: { fullName: true } } }, orderBy: { criadoEm: 'asc' } } },
      });
      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { animalId: Number(animalId), status: 'ABERTA', empresaId },
          include: { itens: { include: { veterinario: { select: { fullName: true } } } } },
        });
      }
      res.json({ sucesso: true, dados: fatura });
    } catch (err) {
      console.error(err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
};

module.exports = FaturaController;
module.exports.adicionarAssistenciaMensal      = adicionarAssistenciaMensal;
module.exports.diaVencimentoDoProprietario     = diaVencimentoDoProprietario;
module.exports.recalcularTotal            = recalcularTotal;