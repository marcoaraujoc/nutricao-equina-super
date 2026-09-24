// backend/src/controllers/FaturaController.js

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const {
  recalcularTotal: recalcularTotalCompartilhado,
  registrarCorrecaoFatura,
  normalizarDesconto,
  formatAtendimentoNum,
  STATUS_FATURA_ABERTOS,
  statusAoReabrir,
  proximoMesReferencia,
  abreProximoCiclo,
  faturaAbertaNoMes,
  faturaEditavel,
} = require('../lib/faturaUtils');
const { origensPorItem } = require('../lib/faturaItemOrigens');
// Fechamento POR ANIMAL: quais itens da fatura já foram encerrados à parte.
// Colunas novas lidas/gravadas por SQL cru (o client Prisma pode não conhecê-las).
const fechamentoAnimal = require('../lib/faturaFechamentoAnimal');
const { resolverLogoPorProprietario } = require('../lib/logoEmpresaUtils');
const { ehClienteDaEmpresa } = require('../lib/clienteEmpresa');
const { lerDadosRecebimento } = require('../lib/dadosRecebimento');
const { registrarAuditoria } = require('../lib/auditoria');
const { ehGestorNoContexto } = require('../middlewares/permissao.middleware');
const { escopoCatalogoEmpresa } = require('../middlewares/empresaAtiva.middleware');
const {
  aplicarPerfil: aplicarPerfilProprietario,
  aplicarPerfilEmLista: aplicarPerfilProprietarioEmLista,
} = require('../lib/proprietarioPerfil');
// COMO o cliente quer receber a fatura (e-mail / WhatsApp / impresso) — é o que
// decide quais botões de envio a tela habilita para CADA cliente.
const formasFatura = require('../lib/formasRecebimentoFatura');
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
  // `fechadoEm` vem à parte porque o `include` tipado não traz coluna que o client
  // Prisma ainda não conhece — e sem ela a tela mostraria como ABERTO um bloco de
  // paciente já encerrado (com o botão "Fechar" de volta e o valor contando duas vezes).
  const comFechamento = await fechamentoAnimal.anexarFechamento(fatura);
  const comOrigem = await comOrigensDetalhadas(comOrigemDosItens(comFechamento));
  return comOrigem.proprietario && empresaId
    ? { ...comOrigem, proprietario: await aplicarPerfilProprietario(comOrigem.proprietario, empresaId) }
    : comOrigem;
}

/**
 * Anexa a cada item a lista de CONTRIBUIÇÕES que formaram a quantidade dele — a
 * observação da linha: nº do atendimento/vacina, data e quantidade de cada execução.
 *
 * POR QUÊ existe, e por que é uma consulta à parte: desde 2026-09-17 a linha da fatura
 * consolida origens DIFERENTES (o mesmo medicamento aplicado em dois atendimentos é
 * uma linha só, com "Quant.: 5"). A FK de origem do item responde por UMA delas — a
 * principal —, então sem esta lista o financeiro veria a quantidade somada e não teria
 * como saber de onde ela veio.
 *
 * ⚠️ UMA consulta para a fatura inteira (`origensPorItem` recebe a lista de ids), nunca
 * uma por item: a fatura de um mês tem dezenas de linhas, e uma ida ao banco por linha
 * derrubaria a tela — o mesmo motivo que fez o lookup de multidose nascer em bloco.
 * ⚠️ Item sem contribuição (assistência mensal, lançamento manual do financeiro, linha
 * LEGADA anterior à migration) sai com lista vazia, e a tela cai no formato de sempre.
 */
// Um item só, com as contribuições dele — usado pelas respostas de lançar/editar item.
// ⚠️ A resposta do PUT SUBSTITUI a linha no estado da tela (`itens.map(... ? r.data.dados : i)`),
// então devolver o item SEM `origens` faria a observação sumir da linha consolidada até
// alguém recarregar a fatura. A API devolve o item inteiro, nunca a metade dele.
async function comOrigensDoItem(item) {
  if (!item) return item;
  const mapa = await origensPorItem(prisma, [item.id]);
  // Mesmo motivo de `comPerfilDaEmpresa`: a resposta do POST/PUT SUBSTITUI a linha no
  // estado da tela. Devolvê-la sem `fechadoEm` faria uma linha de bloco fechado voltar
  // a parecer aberta logo depois de ser editada.
  const fechados = await fechamentoAnimal.fechadosDaFatura(prisma, item.faturaId);
  const f = fechados.get(Number(item.id));
  return {
    ...item,
    origens:      mapa.get(item.id) ?? [],
    fechadoEm:    f?.fechadoEm ?? null,
    fechadoPorId: f?.fechadoPorId ?? null,
  };
}

async function comOrigensDetalhadas(fatura) {
  if (!fatura?.itens?.length) return fatura;
  const mapa = await origensPorItem(prisma, fatura.itens.map(i => i.id));
  if (mapa.size === 0) return fatura;
  return { ...fatura, itens: fatura.itens.map(i => ({ ...i, origens: mapa.get(i.id) ?? [] })) };
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

/**
 * 🔴 FECHAR UMA FATURA ABRE A SEGUINTE (2026-09-06, a pedido).
 *
 * Até aqui o ciclo seguinte só nascia quando ALGUÉM tocava naquele cliente: abrindo a
 * tela dele (`obterFaturaProprietario` cria a ABERTA do mês) ou lançando o primeiro
 * item clínico (`getOrCreateFatura`). No fechamento automático da madrugada isso
 * deixava o cliente SEM fatura corrente até o próximo atendimento — e a **Assistência
 * Veterinária Mensal**, que é cobrança RECORRENTE e não depende de atendimento nenhum,
 * só entrava quando alguém abrisse a tela. Cliente mensalista sem consulta no mês
 * simplesmente não era cobrado.
 *
 * A fatura nova nasce com os itens PADRÃO — hoje só a assistência, pela MESMA
 * `adicionarAssistenciaMensal` do fechamento. Uma segunda cópia da regra do valor
 * divergiria na primeira correção; item padrão novo entra LÁ e vale para os dois.
 *
 * ⚠️ **NÃO cria se o cliente já tem outra fatura em aberto NESTA empresa** (ABERTA ou
 * REABERTA, fora a que acabou de fechar). Duas correntes ao mesmo tempo partem o mês em
 * duas: `getOrCreateFatura` pega a primeira que achar e metade dos lançamentos vai
 * parar na outra. É essa guarda que torna a chamada IDEMPOTENTE — e é o que permite
 * chamá-la do fechamento em LOTE e do cron sem contar quantas vezes ela rodou.
 *
 * ⚠️ O `mesReferencia` é o do mês SEGUINTE ao da fechada (`proximoMesReferencia`), não
 * o mês atual: quem fecha no dia 23 abre um ciclo que será cobrado no mês que vem, e
 * repetir o rótulo deixaria duas linhas idênticas no seletor de mês da tela.
 *
 * ⚠️ Fatura LEGADA por ANIMAL (sem `proprietarioId`) não tem ciclo mensal — não há o
 * que abrir depois dela. Sem `empresaId` também não: a fatura nova precisa de tenant.
 *
 * @param fechada  a fatura que ACABOU de fechar (id, proprietarioId, empresaId, mesReferencia)
 * @param db       🔴 o `tx` da empresa da vez quando vier do CRON — com o `prisma`
 *   global o RLS esconde tudo e a criação morre na policy (ver `lib/cronTenant.js`).
 * @returns a fatura criada, ou `null` quando não havia o que abrir.
 */
async function abrirProximaFatura(fechada, { veterinarioId = null, db = prisma, statusAnterior = null } = {}) {
  const proprietarioId = fechada?.proprietarioId ?? null;
  const empresaId      = fechada?.empresaId ?? null;
  if (!proprietarioId || empresaId == null) return null;

  // 🔴 REABERTA fechada NÃO abre ciclo, e não se abre fatura de mês FUTURO — as duas
  // regras vivem em `faturaUtils.abreProximoCiclo`, para valerem por QUALQUER porta de
  // fechamento (esta rota, `atualizarStatus`, o lote e o cron). Ver o porquê lá.
  if (!abreProximoCiclo(statusAnterior, fechada?.mesReferencia ?? null)) return null;

  const jaEmAberto = await db.fatura.findFirst({
    where:  {
      proprietarioId,
      empresaId,
      status: { in: STATUS_FATURA_ABERTOS },
      id:     { not: fechada.id },
    },
    select: { id: true },
  });
  if (jaEmAberto) return null;

  const nova = await db.fatura.create({
    data: {
      proprietarioId,
      empresaId,
      mesReferencia: proximoMesReferencia(fechada.mesReferencia),
      status:        'ABERTA',
      total:         0,
    },
  });

  // A assistência é a da EMPRESA DA FATURA (não a do contexto de quem fechou), e `db`
  // precisa ser o `tx` no cron — sem ele o RLS esconde o ProprietarioPerfil e o
  // mensalista deixa de ser cobrado, sem erro nenhum.
  await adicionarAssistenciaMensal(nova.id, proprietarioId, veterinarioId, empresaId, db);

  // Relê: `adicionarAssistenciaMensal` recalcula o total, e devolver o registro de
  // antes faria o caller anunciar uma fatura nova com total zero.
  return db.fatura.findUnique({ where: { id: nova.id } });
}

/**
 * Mesma coisa, mas SEM derrubar a resposta HTTP. Falhar em ABRIR a seguinte não pode
 * transformar um fechamento BEM-SUCEDIDO em "erro ao fechar" na tela: a fatura já
 * fechou, e o ciclo novo ainda nasce sozinho no primeiro lançamento clínico
 * (`getOrCreateFatura`) ou ao abrir a tela do cliente. No CRON este atalho NÃO é
 * usado — lá a falha tem de aparecer no diário da execução, que é onde se investiga.
 */
async function abrirProximaFaturaSemQuebrar(fechada, opts) {
  try {
    return await abrirProximaFatura(fechada, opts);
  } catch (err) {
    console.error('Erro ao abrir a fatura seguinte à #' + fechada?.id + ':', err);
    return null;
  }
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

/**
 * Fecha ou reabre o bloco de UM animal dentro da fatura. Os dois sentidos compartilham
 * TODA a validação (escopo da empresa, status da fatura, existência do bloco) — separá-los
 * em duas funções faria a guarda divergir na primeira correção que tocasse só uma delas.
 *
 * Responde com a fatura inteira: a tela precisa do total novo E do estado de cada bloco,
 * e devolver só o contador obrigaria a um segundo GET para não exibir valor desatualizado.
 */
async function alterarFechamentoDoAnimal(req, res, { acao }) {
  const fechando = acao === 'fechar';
  const faturaId = Number(req.params.faturaId);
  const animalId = Number(req.params.animalId);
  const { motivo } = req.body ?? {};

  if (!Number.isInteger(faturaId) || !Number.isInteger(animalId)) {
    return res.status(400).json({ error: 'Fatura ou paciente inválido' });
  }

  try {
    const alvo = await prisma.fatura.findUnique({
      where:  { id: faturaId },
      select: { id: true, empresaId: true, status: true, mesReferencia: true },
    });
    // Fatura de outra clínica responde 404 (e não 403): não se confirma que ela existe.
    if (!alvo || faturaForaDoEscopo(alvo, req)) {
      return res.status(404).json({ error: 'Fatura não encontrada' });
    }
    // 🔴 FATURA PAGA É SOMENTE LEITURA — a mesma regra de `adicionarItem`/`atualizarItem`.
    // Mover valor para dentro ou para fora do total de uma cobrança já quitada mudaria
    // o que o cliente pagou.
    if (alvo.status === 'PAGA') {
      return res.status(400).json({ error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' });
    }
    if (alvo.status === 'CANCELADA') {
      return res.status(400).json({ error: 'Fatura cancelada não pode ser alterada.', code: 'FATURA_CANCELADA' });
    }

    // Sem a migration aplicada o fechamento por animal simplesmente não existe — e é
    // melhor dizer isso do que gravar nada e responder "fechado" com o total intacto.
    if (!(await fechamentoAnimal.temColunas())) {
      return res.status(503).json({
        error: 'Fechamento por paciente indisponível: migração do banco pendente.',
        code:  'FECHAMENTO_ANIMAL_INDISPONIVEL',
      });
    }
    // O PAGAMENTO por paciente chegou numa migration posterior (20261021000000): a
    // base pode ter uma e não a outra, e responder "pago" sem gravar nada seria o
    // pior resultado possível numa baixa de dinheiro.
    if ((acao === 'pagar' || acao === 'estornar') && !(await fechamentoAnimal.temColunasPagamento())) {
      return res.status(503).json({
        error: 'Pagamento por paciente indisponível: migração do banco pendente.',
        code:  'PAGAMENTO_ANIMAL_INDISPONIVEL',
      });
    }

    // 🔴 ESTORNAR é ato de GESTOR — mesmo critério de reabrir uma fatura PAGA: desfazer
    // uma baixa devolve à cobrança um valor que alguém registrou como recebido.
    if (acao === 'estornar' && !ehGestorNoContexto(req)) {
      return res.status(403).json({
        error: 'Estornar o pagamento de um paciente é ação do gestor.',
        code:  'SOMENTE_GESTOR',
      });
    }

    const CONTAGEM = {
      fechar:   () => fechamentoAnimal.contarAbertosDoAnimal(prisma, faturaId, animalId),
      reabrir:  () => fechamentoAnimal.contarFechadosDoAnimal(prisma, faturaId, animalId),
      pagar:    () => fechamentoAnimal.contarNaoPagosDoAnimal(prisma, faturaId, animalId),
      estornar: () => fechamentoAnimal.contarPagosDoAnimal(prisma, faturaId, animalId),
    };
    const VAZIO = {
      fechar:   { error: 'Não há lançamentos em aberto deste paciente nesta fatura.',   code: 'NADA_A_FECHAR'   },
      reabrir:  { error: 'Não há lançamentos fechados deste paciente nesta fatura.',    code: 'NADA_A_REABRIR'  },
      pagar:    { error: 'Não há lançamentos a receber deste paciente nesta fatura.',   code: 'NADA_A_PAGAR'    },
      estornar: { error: 'Não há pagamento deste paciente para estornar nesta fatura.', code: 'NADA_A_ESTORNAR' },
    };
    const afetaveis = await CONTAGEM[acao]();
    if (afetaveis === 0) return res.status(400).json(VAZIO[acao]);

    // Marcar os itens, recalcular os dois totais e registrar o rastro na MESMA
    // transaction: ou a fatura muda de valor com a auditoria junto, ou nada acontece.
    const EXECUTAR = {
      fechar:   tx => fechamentoAnimal.fecharAnimal(tx, { faturaId, animalId, userId: req.user.id }),
      reabrir:  tx => fechamentoAnimal.reabrirAnimal(tx, { faturaId, animalId }),
      pagar:    tx => fechamentoAnimal.pagarAnimal(tx, { faturaId, animalId, userId: req.user.id }),
      estornar: tx => fechamentoAnimal.desfazerPagamentoAnimal(tx, { faturaId, animalId }),
    };
    const ROTULO = {
      fechar:   'Fechamento',
      reabrir:  'Reabertura',
      pagar:    'Baixa de pagamento',
      estornar: 'Estorno de pagamento',
    };
    const afetados = await prisma.$transaction(async (tx) => {
      const n = await EXECUTAR[acao](tx);
      await recalcularTotalCompartilhado(tx, faturaId);
      await registrarAuditoria(tx, req, {
        categoria:  'ALTERACAO',
        entidade:   'FATURA',
        entidadeId: faturaId,
        animalId,
        motivo:     motivo?.trim() || null,
        detalhes:   `${ROTULO[acao]} do bloco do paciente na fatura`
                    + `${alvo.mesReferencia ? ` · ${alvo.mesReferencia}` : ''}`
                    + ` (${n} ${n === 1 ? 'lançamento' : 'lançamentos'})`,
      });
      return n;
    });

    const fatura = await prisma.fatura.findUnique({ where: { id: faturaId }, include: FATURA_INCLUDE });
    return res.json({
      dados: await comPerfilDaEmpresa(fatura, req.empresaId),
      afetados,
    });
  } catch (err) {
    console.error('Erro ao alterar fechamento do paciente na fatura:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}

/**
 * 🔴 SÓ FATURA EM ABERTO ACEITA ESCRITA DE ITEM (2026-09-23, a pedido).
 *
 * Até aqui o backend só barrava a PAGA, e a tela é que escondia os botões nas demais
 * (`canEdit = ABERTA || REABERTA`). Ou seja: a regra existia na interface e não no
 * servidor — `PUT /itens/:id` numa fatura FECHADA passava. Agora fechada é fechada
 * dos dois lados, e quem quiser corrigir usa **Reabrir**, que deixa rastro.
 *
 * ⚠️ O lançamento CLÍNICO não passa por aqui: ele entra por `getOrCreateFatura`, que
 * só devolve fatura em aberto (ou cria uma). Nenhuma cobrança automática é perdida.
 */
function bloqueioDeEscritaNaFatura(fatura) {
  if (!fatura) return null;
  if (fatura.status === 'PAGA') {
    return { error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' };
  }
  if (!faturaEditavel(fatura.status)) {
    return {
      error: `Fatura ${String(fatura.status).toLowerCase()} é somente leitura. Reabra-a para alterar os itens.`,
      code:  'FATURA_NAO_EDITAVEL',
    };
  }
  return null;
}

/**
 * 🔴 BLOCO DE PACIENTE FECHADO/PAGO TAMBÉM É SOMENTE LEITURA (2026-09-23, a pedido:
 * "a regra de fechar somente o paciente deve ser a mesma para a fatura").
 *
 * Fechar o bloco apartou aquele valor do total da fatura; pagar registrou que o
 * cliente o acertou. Editar ou remover a linha depois disso mudaria um documento já
 * encerrado — exatamente o que o fechamento da fatura inteira impede.
 *
 * ⚠️ A saída é **Reabrir paciente** / **Estornar pagamento**, que ficam na barra do
 * próprio bloco e deixam rastro na auditoria.
 */
async function bloqueioDoBlocoDoPaciente(itemId) {
  const { fechadoEm, pagoEm } = await fechamentoAnimal.estadoDoItem(prisma, itemId);
  if (pagoEm) {
    return { error: 'Este lançamento já foi pago com o bloco do paciente. Estorne o pagamento para alterá-lo.',
             code: 'BLOCO_PACIENTE_PAGO' };
  }
  if (fechadoEm) {
    return { error: 'Este lançamento está no bloco fechado deste paciente. Reabra o paciente para alterá-lo.',
             code: 'BLOCO_PACIENTE_FECHADO' };
  }
  return null;
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
              where:   { status: { in: ['ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA', 'PAGA'] } },
              orderBy: { criadoEm: 'desc' },
              // 10, não 6: com REABERTA são CINCO estados possíveis, e um `take` curto
              // podia devolver seis faturas fechadas e nenhuma das outras — a aba
              // sumiria da tela por causa do corte, não por não existir.
              take:    10,
              select:  { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
            },
          },
        });
        if (!prop) return res.json({ dados: [] });
        // ⚠️ `faturaAtiva` é SÓ a ABERTA. A reaberta tem casa própria (`faturaReaberta`)
        // porque é outro documento: as duas podem existir ao mesmo tempo, e cair na
        // mesma aba faria uma esconder a outra.
        const faturaAberta   = prop.faturas.find(f => f.status === 'ABERTA')   ?? null;
        const faturaReaberta = prop.faturas.find(f => f.status === 'REABERTA') ?? null;
        const faturaFechada  = prop.faturas.find(f => f.status === 'FECHADA')  ?? null;
        const faturaAtrasada = prop.faturas.find(f => f.status === 'ATRASADA') ?? null;
        const faturaPaga     = prop.faturas.find(f => f.status === 'PAGA')     ?? null;
        const dados = await formasFatura.anexarFormas(
          [{ ...prop, faturaAtiva: faturaAberta ?? null, faturaReaberta, faturaFechada, faturaAtrasada, faturaPaga, faturas: undefined }],
          empresaId,
        );
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
          where:  { empresaId, status: { in: ['ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA'] }, proprietarioId: { not: null } },
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
            where: { status: { in: ['ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA'] } },
            orderBy: { criadoEm: 'desc' },
            // Ver a nota do `take` no ramo do proprietário: são cinco estados agora.
            take: 10,
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
      // Preferência de recebimento do cadastro DESTA empresa. Cliente sem escolha
      // declarada volta com TODAS — é o comportamento que a tela sempre teve.
      const comFormas = await formasFatura.anexarFormas(comPerfil, req.empresaId);

      const dados = comFormas
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
          faturaReaberta: p.faturas.find(f => f.status === 'REABERTA') ?? null,
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
      // Os dados de recebimento saem PELA MESMA rota da logo (a pedido, 2026-09-08):
      // as duas são identidade da clínica na folha, buscadas no mesmo ponto do
      // carregamento da fatura. Uma rota nova só para cinco campos custaria uma ida a
      // mais ao servidor a cada abertura da tela.
      // ⚠️ Empresa do CONTEXTO, nunca a do proprietário: o mesmo cliente atendido por
      // duas clínicas receberia o PIX da outra.
      const recebimento = await lerDadosRecebimento(empresaId);
      res.json({ dados: { logoUrl, recebimento } });
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
      const bloqueio = bloqueioDeEscritaNaFatura(fatura);
      if (bloqueio) return res.status(400).json(bloqueio);

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
      res.status(201).json({ dados: await comOrigensDoItem(comOrigemDoItem(item)), totalFatura: total });
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
      const bloqueio = bloqueioDeEscritaNaFatura(item.fatura)
                    ?? await bloqueioDoBlocoDoPaciente(item.id);
      if (bloqueio) return res.status(400).json(bloqueio);

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
      res.json({ dados: await comOrigensDoItem(comOrigemDoItem(updated)), totalFatura: total });
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
      const bloqueio = bloqueioDeEscritaNaFatura(item.fatura)
                    ?? await bloqueioDoBlocoDoPaciente(item.id);
      if (bloqueio) return res.status(400).json(bloqueio);

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

    // REABERTA é aceita para o cliente que já a conhece; o botão "Reabrir" da tela
    // continua mandando ABERTA e é `statusAoReabrir` que a converte (abaixo).
    const VALIDOS = ['ABERTA', 'REABERTA', 'PAGA', 'CANCELADA', 'FECHADA'];
    if (!VALIDOS.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${VALIDOS.join(', ')}` });
    }

    try {
      // Confere o tenant ANTES de gravar: como o update ia direto pelo id, dava para
      // marcar como PAGA (ou CANCELADA) a fatura de outra clínica.
      const alvo = await prisma.fatura.findUnique({
        where:  { id: Number(faturaId) },
        // `mesReferencia` entra por causa de `abrirProximaFatura`: é dele que sai o
        // mês da fatura seguinte quando esta rota é o caminho do FECHAMENTO.
        select: { id: true, empresaId: true, status: true, proprietarioId: true, mesReferencia: true },
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

      // 🔴 REABRIR NÃO DEVOLVE A FATURA A "ABERTA" (2026-09-06, a pedido).
      //
      // Fatura que já foi FECHADA/ATRASADA/PAGA e volta a ser editável grava
      // **REABERTA**. Ela continua editável — o que muda é que a tela, o relatório e
      // `getOrCreateFatura` param de confundi-la com a fatura CORRENTE do mês: quem
      // reabre agosto para corrigir uma linha não quer que a cobrança de setembro
      // caia lá dentro. A conversão é do BACKEND (`statusAoReabrir`), então o botão
      // "Reabrir" da tela não precisou mudar o que envia.
      const statusFinal = statusAoReabrir(alvo.status, status);

      // 🔴 UMA FATURA ABERTA NÃO CONVIVE COM UMA REABERTA DO MESMO MÊS (2026-09-23).
      //
      // Duas faturas do mesmo mês partem a cobrança em dois documentos, e
      // `getOrCreateFatura` pega a primeira que encontra — metade dos lançamentos do
      // mês vai parar na outra, sem erro e sem log. Por isso a reabertura PARA aqui,
      // dizendo o que fazer: feche a fatura aberta daquele mês primeiro.
      //
      // ⚠️ Na prática isto quase não dispara desde que `getOrCreateFatura` passou a
      // ADOTAR a reaberta do mês corrente em vez de criar outra ao lado dela. A guarda
      // fica para a base que já tenha o par formado antes desta regra.
      if (statusFinal === 'REABERTA') {
        const concorrente = await faturaAbertaNoMes(prisma, {
          proprietarioId: alvo.proprietarioId,
          empresaId:      alvo.empresaId,
          mesReferencia:  alvo.mesReferencia,
          exceto:         alvo.id,
        });
        if (concorrente) {
          return res.status(400).json({
            error: `Já existe uma fatura ABERTA de ${alvo.mesReferencia} para este cliente `
                 + '(#' + concorrente.id + '). Feche-a antes de reabrir esta.',
            code:  'FATURA_ABERTA_NO_MES',
          });
        }
      }

      // Esta rota também é um caminho de FECHAMENTO (o botão "Fechar Fatura" usa
      // `/fechar`, mas o status pode chegar por aqui). Fechar por qualquer porta abre
      // a fatura seguinte — mas só quando de fato veio de uma fatura em ABERTO;
      // PAGA → FECHADA é acerto de status, não um ciclo que terminou.
      const estaFechando = statusFinal === 'FECHADA' && STATUS_FATURA_ABERTOS.includes(alvo.status);

      const fatura = await prisma.$transaction(async (tx) => {
        const atualizada = await tx.fatura.update({
          where:   { id: Number(faturaId) },
          data:    { status: statusFinal },
          include: FATURA_INCLUDE,
        });
        if (saindoDePaga) {
          await registrarAuditoria(tx, req, {
            categoria:  'ALTERACAO',
            entidade:   'FATURA',
            entidadeId: alvo.id,
            detalhes:   `Fatura PAGA reaberta como ${statusFinal}`,
          });
        }
        return atualizada;
      });

      const proxima = estaFechando
        ? await abrirProximaFaturaSemQuebrar(fatura, { veterinarioId: req.user.id, statusAnterior: alvo.status })
        : null;

      res.json({
        dados:   await comPerfilDaEmpresa(fatura, req.empresaId),
        proxima: proxima ? { id: proxima.id, mesReferencia: proxima.mesReferencia, total: proxima.total } : null,
      });
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
      // REABERTA fecha de novo pelo MESMO caminho: ela é uma fatura em aberto que já
      // passou por aqui uma vez, e sem isto ficaria presa em aberto para sempre.
      if (!STATUS_FATURA_ABERTOS.includes(fatura.status)) {
        return res.status(400).json({ error: 'Apenas faturas ABERTA ou REABERTA podem ser fechadas' });
      }

      // A assistência é a da EMPRESA DA FATURA (não a do contexto de quem fecha)
      await adicionarAssistenciaMensal(Number(faturaId), fatura.proprietarioId, req.user.id, fatura.empresaId ?? req.empresaId);

      const faturaFechada = await prisma.fatura.update({
        where:   { id: Number(faturaId) },
        data:    { status: 'FECHADA' },
        include: FATURA_INCLUDE,
      });

      // Fechou uma, abre a seguinte já com os itens padrão — ver `abrirProximaFatura`.
      const proxima = await abrirProximaFaturaSemQuebrar(
        faturaFechada, { veterinarioId: req.user.id, statusAnterior: fatura.status });

      res.json({
        dados:   await comPerfilDaEmpresa(faturaFechada, req.empresaId),
        proxima: proxima ? { id: proxima.id, mesReferencia: proxima.mesReferencia, total: proxima.total } : null,
      });
    } catch (err) {
      console.error('Erro ao fechar fatura:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PATCH /:faturaId/animais/:animalId/fechar     { motivo? }
  // PATCH /:faturaId/animais/:animalId/reabrir
  //
  // 🔴 FECHAR A FATURA POR ANIMAL (2026-09-22). A fatura é do PROPRIETÁRIO e junta
  // todos os pacientes dele; isto encerra o bloco de UM deles dentro dela. Os itens
  // daquele animal ficam marcados (`fechado_em`) e SAEM do total da fatura — que é o
  // que permite acertar o cavalo vendido/transferido no meio do ciclo sem cobrar junto
  // o que ainda está aberto dos outros pacientes, e sem remover item (remover APAGA a
  // cobrança; fechar a preserva e só a tira desta conta).
  //
  // ⚠️ NÃO é "pago" nem "cancelado": o bloco continua DEVIDO, só é acertado à parte —
  // por isso o valor vai para `Fatura.totalFechado` em vez de sumir.
  // ⚠️ NÃO congela os itens. Fatura FECHADA no S2Vet segue aceitando correção de item
  // (CLAUDE.md §12, "Fatura fechada vs paga"); bloquear só aqui criaria uma regra que
  // o resto do financeiro não tem. Quem congela é o status PAGA, e ele é conferido.
  // ⚠️ Fechar de novo depois de novas cobranças é ESPERADO: só o que está aberto é
  // marcado, e a data do fechamento anterior fica de pé.
  fecharAnimal: async (req, res) => {
    return alterarFechamentoDoAnimal(req, res, { acao: 'fechar' });
  },

  reabrirAnimal: async (req, res) => {
    return alterarFechamentoDoAnimal(req, res, { acao: 'reabrir' });
  },

  // PATCH /:faturaId/animais/:animalId/pagar      { motivo? }
  // PATCH /:faturaId/animais/:animalId/estornar   { motivo? }
  //
  // 🔴 PAGAR A FATURA POR ANIMAL (2026-09-23) — a outra metade do fechamento por
  // paciente. Fechar tirou o bloco do `total` mas o manteve DEVIDO (`total_fechado`),
  // porque fechar não é receber; isto registra que o acerto à parte ACONTECEU, e o
  // valor sai de "contas a receber" (Dashboard, Relatórios, devedores) para
  // `total_pago_animal`.
  //
  // ⚠️ PAGAR FECHA o que ainda estiver aberto do paciente (ver `pagarAnimal`): item
  // pago e aberto seria o mesmo valor cobrado e recebido ao mesmo tempo.
  // ⚠️ NÃO mexe no status da FATURA. A fatura segue ABERTA cobrando os outros
  // pacientes — é exatamente isso que o pagamento por paciente veio permitir; marcar
  // a fatura como PAGA aqui congelaria a cobrança dos demais.
  // ⚠️ Cobrança que chegar DEPOIS do acerto nasce aberta e volta a contar, como no
  // fechamento — a marca é do ITEM.
  pagarAnimal: async (req, res) => {
    return alterarFechamentoDoAnimal(req, res, { acao: 'pagar' });
  },

  estornarPagamentoAnimal: async (req, res) => {
    return alterarFechamentoDoAnimal(req, res, { acao: 'estornar' });
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
        if (!fatura || !STATUS_FATURA_ABERTOS.includes(fatura.status)) continue;
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

        // Cada fatura fechada abre a sua seguinte. A guarda de "já tem uma em aberto"
        // mora dentro do helper, então fechar o lote inteiro não cria duas para o
        // mesmo cliente nem quando ele aparece duas vezes na lista.
        await abrirProximaFaturaSemQuebrar(
          { id, proprietarioId: fatura.proprietarioId, empresaId: fatura.empresaId, mesReferencia: atualizada.mesReferencia },
          { veterinarioId: req.user.id, statusAnterior: fatura.status },
        );

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
module.exports.abrirProximaFatura              = abrirProximaFatura;
module.exports.diaVencimentoDoProprietario     = diaVencimentoDoProprietario;
module.exports.recalcularTotal            = recalcularTotal;
module.exports.alterarFechamentoDoAnimal  = alterarFechamentoDoAnimal;