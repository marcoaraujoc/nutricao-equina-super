// backend/src/lib/faturaUtils.js
// Utilitários de fatura compartilhados entre controllers clínicos
'use strict';

const itemOrigens = require('./faturaItemOrigens');
// Fechamento POR ANIMAL — quais itens da fatura já foram encerrados à parte.
// É ele que separa `total` (o que esta fatura cobra) de `totalFechado`.
const fechamentoAnimal = require('./faturaFechamentoAnimal');

/**
 * Formata o número do atendimento: 'AG', 3 → 'AG-0003'
 */
function formatAtendimentoNum(tipo, numero) {
  if (!tipo || numero == null) return null;
  return `${tipo}-${String(numero).padStart(4, '0')}`;
}

/**
 * Busca ou cria a fatura ABERTA do proprietário DENTRO DE UMA EMPRESA.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * ⚠️ O escopo por empresa NÃO é opcional. O mesmo cliente é atendido por várias
 * clínicas; sem `empresaId` no filtro, o lançamento da clínica B caía na fatura
 * ABERTA da clínica A e cada uma passava a ver os itens da outra. Modelo correto:
 * EmpresaA-Cliente-Fatura e EmpresaB-Cliente-Fatura, independentes.
 *
 * `empresaId` null casa SÓ com faturas legadas sem tenancy (anteriores à migration
 * 20260812000000) — nunca com a fatura de uma empresa identificada.
 *
 * @param {object}  tx             - prisma transaction client
 * @param {number}  proprietarioId - userId do proprietário (pode ser null)
 * @param {number}  empresaId      - empresa do contexto (`req.empresaId`)
 * @returns {object} fatura Prisma record
 */
async function getOrCreateFatura(tx, proprietarioId, empresaId = null) {
  const mesAtual = new Date().toISOString().slice(0, 7); // '2026-06'
  const empresa  = empresaId ? Number(empresaId) : null;
  // ⚠️ SÓ `ABERTA` — nunca `REABERTA`. A fatura reaberta é um documento ANTIGO
  // destravado para correção; jogar o lançamento de hoje dentro dela misturaria o
  // mês corrente com um mês já entregue ao cliente. Ver STATUS_FATURA_ABERTOS.
  let fatura = await tx.fatura.findFirst({
    where: { proprietarioId, status: 'ABERTA', empresaId: empresa },
  });
  if (!fatura) {
    fatura = await tx.fatura.create({
      data: { proprietarioId, empresaId: empresa, mesReferencia: mesAtual, status: 'ABERTA', total: 0 },
    });
  }
  return fatura;
}

/**
 * Adiciona um item na fatura e incrementa o total.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * @param {object} tx
 * @param {object} opts
 * @param {number}  opts.faturaId
 * @param {number}  opts.animalId
 * @param {string}  opts.tipo         - 'MEDICAMENTO' | 'PROCEDIMENTO' | 'VACINA' | 'ENCAMINHAMENTO'
 * @param {string}  opts.descricao
 * @param {number}  opts.valor
 * @param {number}  opts.quantidade
 * @param {number|null} opts.veterinarioId
 * @param {number|null} opts.exameClinicoId          - origem: ExameClinico.id
 * @param {number|null} opts.prescricaoId            - origem: Prescricao.id (item do grupo)
 * @param {number|null} opts.vacinaClinicaId         - origem: VacinaClinica.id
 * @param {number|null} opts.encaminhamentoClinicoId - origem: EncaminhamentoClinico.id
 */
async function adicionarFaturaItem(tx, {
  faturaId, animalId, tipo, descricao, valor, quantidade, veterinarioId,
  exameClinicoId, prescricaoId, vacinaClinicaId, encaminhamentoClinicoId,
  ocorridoEm,
}) {
  const criado = await tx.faturaItem.create({
    data: {
      faturaId, animalId, tipo, descricao,
      valor: valor ?? 0, quantidade: quantidade ?? 1, veterinarioId: veterinarioId ?? null,
      exameClinicoId: exameClinicoId ?? null,
      prescricaoId: prescricaoId ?? null,
      vacinaClinicaId: vacinaClinicaId ?? null,
      encaminhamentoClinicoId: encaminhamentoClinicoId ?? null,
    },
  });
  // A 1ª contribuição da linha. É ela que faz `quantidade` continuar sendo a SOMA das
  // origens mesmo quando a linha nasce por aqui — sem isso, um item lançado por
  // `adicionarFaturaItem` e depois somado por `adicionarOuSomarFaturaItem` teria
  // quantidade 3 com só 2 contribuições, e o estorno subtrairia menos do que devia.
  await itemOrigens.registrarOrigem(tx, {
    faturaItemId: criado.id,
    quantidade:   quantidade ?? 1,
    ocorridoEm:   ocorridoEm ?? null,
    exameClinicoId, prescricaoId, vacinaClinicaId, encaminhamentoClinicoId,
  });
  if ((valor ?? 0) > 0) {
    await tx.fatura.update({
      where: { id: faturaId },
      data:  { total: { increment: (valor ?? 0) * (quantidade ?? 1) } },
    });
  }
  return criado;
}

/**
 * Lança um item na fatura CONSOLIDANDO com a linha equivalente que já exista:
 * em vez de uma linha nova por dose aplicada, soma na QUANTIDADE da linha anterior.
 *
 * POR QUÊ: cada execução de prescrição gera uma cobrança (regra do produto, não muda —
 * a fatura nasce da APLICAÇÃO). Um curso de "2x ao dia por 7 dias" produzia 14 linhas
 * idênticas do mesmo medicamento na fatura do mês, e o financeiro tinha de somar a olho
 * para saber quantas doses foram cobradas. Consolidado, é 1 linha com "Quant.: 14".
 *
 * 🔴 A CHAVE DEIXOU DE INCLUIR A ORIGEM (2026-09-17, a pedido). Até aqui ela incluía
 * `prescricaoId`/`vacinaClinicaId`/…, e a descrição carregava o número do atendimento
 * (`[AG-0012] Amoxicilina — …`) — então o MESMO medicamento, na MESMA dose e pelo
 * MESMO preço, aplicado em dois atendimentos do mês, virava DUAS linhas idênticas
 * fora o número. Agora a chave é **(tipo, descrição, animal, valor unitário)** e o
 * número do atendimento saiu da descrição: ele vira OBSERVAÇÃO da linha, com data e
 * quantidade de cada contribuição (`lib/faturaItemOrigens.js`).
 *
 * ⚠️ **O ESTORNO SÓ CONTINUA CERTO POR CAUSA DAS CONTRIBUIÇÕES.** Era a FK de origem
 * na chave que impedia "cancelar uma prescrição levar embora a cobrança da outra";
 * quem garante isso agora é `tb_fatura_item_origens` — `removerFaturaItensDaOrigem`
 * SUBTRAI o que era daquela origem e só apaga a linha quando não sobra nenhuma. NÃO
 * reintroduzir a origem na chave sem desfazer aquilo junto, e não remover as
 * contribuições sem devolver a origem à chave: uma coisa depende da outra.
 *
 * ⚠️ Base ainda NÃO migrada (sem a tabela de contribuições) continua consolidando —
 * o que ela perde é a observação e a subtração fina no estorno, caindo no
 * comportamento antigo de apagar a linha inteira. É o mesmo grau de estorno que já
 * existia; o que não pode acontecer é a cobrança ficar errada.
 *
 * 🔴 CONSOLIDA TAMBÉM EM LINHA COM DESCONTO, de propósito: **o desconto é do
 * MEDICAMENTO, não da dose**. Dado 10% na ivermectina de 4/4h por 3 dias, o desconto
 * vale para a ivermectina inteira — as doses seguintes têm de cair NA MESMA linha e
 * herdar o desconto. Criar linha nova para elas (como esta função fazia até
 * 2026-08-25) partia a cobrança em "com desconto" e "sem desconto", e o cliente
 * pagava cheio o resto do curso que já tinha sido negociado.
 * PERCENTUAL acompanha sozinho — incide sobre o bruto (valor × qtd), então cresce com
 * a quantidade. VALOR é abatimento absoluto DA LINHA e continua absoluto: R$ 5,00 de
 * desconto na ivermectina são R$ 5,00 na ivermectina, não R$ 5,00 por dose.
 *
 * ⚠️ Por isso o total da fatura aqui é RECALCULADO (`recalcularTotal`), nunca
 * incrementado por aritmética: com desconto na linha, o líquido acrescentado por uma
 * dose NÃO é `valor × qtd`, e somar isso faria o total da fatura derivar do que a
 * soma dos itens realmente dá.
 *
 * ⚠️ A DESCRIÇÃO faz parte da chave, e precisa fazer: a seringa e a agulha de uma
 * aplicação injetável compartilham `prescricaoId` e tipo com a dose, e é só a
 * descrição que as separa. Consequência a conhecer: se o financeiro RENOMEAR a linha
 * na tela de Faturamento, as doses seguintes deixam de reconhecê-la e abrem linha
 * nova. Mexer no VALOR unitário tem o mesmo efeito, e aí é o comportamento certo —
 * quantidades com preços diferentes não se somam.
 *
 * Deve ser chamado dentro de uma transaction (tx). Mesmos campos de
 * `adicionarFaturaItem` — é ele quem cria a linha quando não há o que consolidar.
 */
async function adicionarOuSomarFaturaItem(tx, opts) {
  const {
    faturaId, animalId, tipo, descricao, valor, quantidade, ocorridoEm,
    exameClinicoId, prescricaoId, vacinaClinicaId, encaminhamentoClinicoId,
  } = opts;

  // Sem origem rastreável não há como garantir que a linha antiga é "a mesma coisa"
  // (lançamento manual do financeiro, assistência mensal…). Cria linha nova.
  if (!itemOrigens.origemDoPayload(opts)) return adicionarFaturaItem(tx, opts);

  const valorNovo = valor ?? 0;
  const qtdNova   = quantidade ?? 1;

  const candidatos = await tx.faturaItem.findMany({
    where: { faturaId, tipo, descricao, animalId: animalId ?? null },
    orderBy: { id: 'asc' },
  });
  // `valor` é Float: compara por tolerância de centavo, nunca por igualdade exata
  // (o preço da dose sai de regra de 3 sobre o preço do lote e pode variar no último
  // dígito entre duas execuções do MESMO lote). Preço unitário DIFERENTE é outra
  // coisa e vira linha própria — não dá para somar quantidades com valores distintos.
  const alvo = candidatos.find(c => Math.abs((c.valor ?? 0) - valorNovo) < 0.005);
  if (!alvo) return adicionarFaturaItem(tx, opts);

  // O CONTADOR da linha sobe de `qtdNova` (1 por execução) — o curso inteiro nunca é
  // lançado de uma vez. Uma prescrição de 14 doses chega a "Quant.: 14" só depois da
  // 14ª aplicação; parado na 3ª dose, a fatura mostra e cobra 3.
  await tx.faturaItem.update({
    where: { id: alvo.id },
    data:  { quantidade: { increment: qtdNova } },
  });
  // A observação da linha: de qual registro veio ESTA dose, quando e quanto. É o que
  // o financeiro lê para saber que "Quant.: 5" são 3 de um atendimento e 2 de outro.
  await itemOrigens.registrarOrigem(tx, {
    faturaItemId: alvo.id,
    quantidade:   qtdNova,
    ocorridoEm:   ocorridoEm ?? null,
    exameClinicoId, prescricaoId, vacinaClinicaId, encaminhamentoClinicoId,
  });
  await recalcularTotal(tx, faturaId);
}

/**
 * Lança um exame clínico na fatura ABERTA do proprietário, de forma IDEMPOTENTE: se já
 * houver um FaturaItem vinculado a este exame (exameClinicoId), não duplica. Usado ao
 * finalizar a evolução (exames solicitados) e ao concluir o exame.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * 🔴 VALOR (2026-09-09): usa `exame.valorCobrado` quando ele existe — o preço do exame
 * de imagem, resolvido e congelado no PEDIDO (`lib/exameImagemValor.js`) a partir do
 * vínculo do prestador ou do valor padrão da empresa.
 * ⚠️ Sem ele a linha nasce ZERADA, como sempre nasceu: é o que vale para todo exame
 * laboratorial, para base sem preço cadastrado e para todo exame anterior a esta leva.
 * `null` aqui é "não sei o preço", nunca "é de graça" — por isso o `??` e não `||`
 * (com `||`, um exame legitimamente gratuito viraria... também 0, mas por acidente).
 *
 * @param {object} tx
 * @param {object} exame               - { id, animalId, veterinarioId, tipo, descricao, numero, valorCobrado? }
 * @param {number|null} proprietarioUserId - Animal.userId (dono do animal)
 * @param {number|null} empresaId          - empresa do contexto (`req.empresaId`) — Fatura é POR EMPRESA
 * @returns {Promise<boolean>} true se lançou; false se já estava faturado ou sem proprietário
 */
async function lancarExameNaFatura(tx, exame, proprietarioUserId, empresaId = null) {
  if (!proprietarioUserId) return false;
  // Idempotência do lançamento: pela FK só, a linha compartilhada (2026-09-17)
  // esconderia um exame cuja cobrança caiu numa linha criada por outro registro.
  // Exame não consolida hoje (a descrição carrega o `[EX-0004]`), mas a pergunta é a
  // mesma e a resposta certa tem de vir do mesmo lugar em todos os caminhos.
  if (await itemOrigens.origemJaFaturada(tx, 'exameClinicoId', exame.id)) return false;

  // Quem chama a partir de um exame LIDO do banco (finalização da evolução, conclusão
  // do exame) não tem `valorCobrado` no objeto: a coluna é nova e o client pode não
  // conhecê-la. Buscar aqui é o que faz os quatro gatilhos cobrarem o mesmo valor —
  // require LOCAL para não criar ciclo de import entre as duas libs.
  let valorCobrado = exame.valorCobrado ?? null;
  if (valorCobrado == null) {
    try {
      const { lerPrestadorEValor } = require('./exameImagemValor');
      valorCobrado = (await lerPrestadorEValor(tx, exame.id)).get(exame.id)?.valorCobrado ?? null;
    } catch { /* base sem as colunas — segue com a linha zerada, como antes */ }
  }

  const exNum     = `EX-${String(exame.numero).padStart(4, '0')}`;
  const descricao = `[${exNum}] ${exame.tipo}: ${exame.descricao}`;
  const fatura    = await getOrCreateFatura(tx, proprietarioUserId, empresaId);
  await adicionarFaturaItem(tx, {
    faturaId:       fatura.id,
    animalId:       exame.animalId,
    tipo:           'EXAME',
    descricao,
    valor:          valorCobrado ?? 0,
    quantidade:     1,
    veterinarioId:  exame.veterinarioId,
    exameClinicoId: exame.id,
  });
  return true;
}

const TIPOS_DESCONTO_VALIDOS = ['PERCENTUAL', 'VALOR'];

/**
 * Desconto (em R$) de um item de fatura. PERCENTUAL incide sobre o bruto (valor × qtd);
 * VALOR é o abatimento direto. Nunca passa do bruto nem fica negativo.
 *
 * @param {{valor?:number, quantidade?:number, descontoTipo?:string|null, descontoValor?:number}} item
 */
function descontoDoItem(item) {
  const bruto = (item.valor ?? 0) * (item.quantidade ?? 1);
  const d     = Number(item.descontoValor ?? 0);
  if (!d || d <= 0) return 0;
  const abatimento = item.descontoTipo === 'PERCENTUAL' ? bruto * (Math.min(d, 100) / 100) : d;
  return Math.min(Math.max(abatimento, 0), Math.max(bruto, 0));
}

/**
 * Valor líquido de um item de fatura: bruto (valor × qtd) menos o desconto.
 * É este valor que compõe o total da fatura — usar SEMPRE que somar itens.
 */
function valorLiquidoItem(item) {
  return (item.valor ?? 0) * (item.quantidade ?? 1) - descontoDoItem(item);
}

/**
 * Normaliza o par (tipo, valor) de desconto vindo do request. Retorna null quando o
 * desconto deve ser zerado (sem desconto) e lança Error em entrada inválida.
 *
 * @returns {{descontoTipo: string|null, descontoValor: number}}
 */
function normalizarDesconto(descontoTipo, descontoValor) {
  const valor = Number(descontoValor ?? 0);
  if (!descontoTipo || !valor || valor <= 0) return { descontoTipo: null, descontoValor: 0 };
  if (!TIPOS_DESCONTO_VALIDOS.includes(descontoTipo)) {
    throw new Error(`Tipo de desconto inválido. Use: ${TIPOS_DESCONTO_VALIDOS.join(' ou ')}`);
  }
  if (descontoTipo === 'PERCENTUAL' && valor > 100) {
    throw new Error('Desconto percentual não pode passar de 100%.');
  }
  return { descontoTipo, descontoValor: valor };
}

/**
 * Recalcula os totais da fatura a partir da soma dos valores LÍQUIDOS dos itens
 * (valor × quantidade − desconto). Aceita tanto o client `prisma` quanto um `tx`.
 *
 * 🔴 SÃO DOIS TOTAIS desde o FECHAMENTO POR ANIMAL (2026-09-22):
 *
 *   total         → o que ESTA fatura cobra: só os itens ABERTOS.
 *   totalFechado  → o que saiu dela por fechamento de bloco de paciente.
 *
 * Esta função é a FONTE ÚNICA dos dois — é por isso que o fechamento por animal não
 * precisou tocar em nenhum dos ~10 pontos que lançam cobrança: todos passam por aqui.
 *
 * ⚠️ O bloco fechado NÃO deixou de ser devido — ele é acertado à parte. Indicador de
 * "contas a receber"/"devedores" soma `total + totalFechado`; somar só `total` faria o
 * fechamento por animal apagar dinheiro do relatório em silêncio.
 *
 * ⚠️ O retorno continua sendo só o `total` (o que a fatura cobra): é o que os callers
 * devolvem à tela como `totalFatura`, e mudar isso reescreveria o contrato de 4 rotas.
 *
 * @param {object} client
 * @param {number} faturaId
 * @returns {number} total recalculado (itens ABERTOS)
 */
async function recalcularTotal(client, faturaId) {
  const itens    = await client.faturaItem.findMany({ where: { faturaId } });
  // Leitura à parte, em SQL cru: o `findMany` tipado não traz `fechadoEm` enquanto o
  // client Prisma não for regenerado, e sem ela TODO item pareceria aberto — o bloco
  // fechado voltaria calado para o total. Ver lib/faturaFechamentoAnimal.js.
  const fechados = await fechamentoAnimal.fechadosDaFatura(client, faturaId);

  let total = 0, totalFechado = 0;
  for (const i of itens) {
    const liquido = valorLiquidoItem(i);
    if (fechados.has(Number(i.id))) totalFechado += liquido;
    else                            total        += liquido;
  }
  await fechamentoAnimal.gravarTotais(client, faturaId, { total, totalFechado });
  return total;
}

/**
 * Registra uma correção na(s) fatura(s): incrementa qtdCorrecoes e marca ultimaCorrecaoEm.
 * Chamado sempre que um item EXISTENTE é alterado ou removido (lançar item novo não conta).
 * Aceita tanto o client `prisma` quanto um client de transaction (`tx`).
 */
async function registrarCorrecaoFatura(client, faturaIds) {
  const ids = Array.isArray(faturaIds) ? faturaIds : [faturaIds];
  if (ids.length === 0) return;
  await client.fatura.updateMany({
    where: { id: { in: ids } },
    data:  { qtdCorrecoes: { increment: 1 }, ultimaCorrecaoEm: new Date() },
  });
}

/** Erro lançado quando a sincronização esbarra numa fatura já paga. */
class FaturaPagaError extends Error {
  constructor(message = 'Não é possível alterar: item já está em uma fatura paga.') {
    super(message);
    this.code = 'FATURA_PAGA';
  }
}

/**
 * Busca os FaturaItem vinculados a um registro de origem (exame, prescrição, vacina, encaminhamento).
 *
 * @param {object} tx
 * @param {string} campo - nome da FK no FaturaItem (ex: 'exameClinicoId')
 * @param {number} origemId
 */
async function buscarFaturaItensDaOrigem(tx, campo, origemId) {
  return tx.faturaItem.findMany({
    where:   { [campo]: origemId },
    include: { fatura: { select: { id: true, status: true } } },
  });
}

/**
 * Estorna da fatura o que um registro de origem cobrou, e recalcula os totais das
 * faturas afetadas. Lança FaturaPagaError (sem alterar nada) se algum item pertencer a
 * fatura PAGA. Deve ser chamado dentro de uma transaction (tx), antes de excluir o
 * registro de origem.
 *
 * 🔴 SUBTRAI, não apaga — desde que a linha passou a ser COMPARTILHADA (2026-09-17).
 * A mesma linha pode juntar doses de duas prescrições; apagá-la inteira ao cancelar
 * uma delas levaria embora a cobrança da outra, sem nada acusar. Então:
 *
 *   contribuições da origem  →  desconta da quantidade da linha
 *   linha ficou sem nenhuma  →  aí sim a linha é apagada
 *   linha sobreviveu         →  a FK de origem principal é reapontada para quem ficou
 *
 * ⚠️ A linha é procurada pelas CONTRIBUIÇÕES e também pela FK (`buscarFaturaItensDaOrigem`):
 * linha LEGADA (lançada antes da migration) não tem contribuição nenhuma, e sem o
 * segundo caminho ela deixaria de ser estornada — o cancelamento passaria a não
 * devolver dinheiro, em silêncio. Legado cai no comportamento antigo: apaga a linha.
 */
async function removerFaturaItensDaOrigem(tx, campo, origemId) {
  const porFk          = await buscarFaturaItensDaOrigem(tx, campo, origemId);
  const contribuicoes  = await itemOrigens.contribuicoesDaOrigem(tx, campo, origemId);
  const idsEnvolvidos  = [...new Set([...porFk.map(i => i.id), ...contribuicoes.map(c => c.faturaItemId)])];
  if (idsEnvolvidos.length === 0) return;

  const itens = await tx.faturaItem.findMany({
    where:   { id: { in: idsEnvolvidos } },
    include: { fatura: { select: { id: true, status: true } } },
  });
  if (itens.length === 0) return;
  if (itens.some(i => i.fatura.status === 'PAGA')) throw new FaturaPagaError();

  await itemOrigens.apagarContribuicoes(tx, campo, origemId);

  const apagar = [];
  for (const item of itens) {
    const restante = await itemOrigens.resumoDaLinha(tx, item.id);
    // `restante === null` = base sem a tabela ("não sei"), e "não sei" NUNCA autoriza
    // manter a cobrança: cai no comportamento antigo e apaga a linha inteira.
    if (restante == null || restante.total === 0) { apagar.push(item.id); continue; }

    // A quantidade passa a ser a SOMA do que sobrou, não `quantidade − descontado`:
    // a soma é a verdade da linha (invariante de `faturaItemOrigens`) e se autocorrige;
    // subtrair propagaria qualquer divergência que já existisse.
    const qtdRestante = restante.quantidade;
    if (qtdRestante <= 0) { apagar.push(item.id); continue; }
    await tx.faturaItem.update({ where: { id: item.id }, data: { quantidade: qtdRestante } });
    await itemOrigens.reapontarOrigemPrincipal(tx, item.id);
  }
  if (apagar.length > 0) await tx.faturaItem.deleteMany({ where: { id: { in: apagar } } });

  const faturaIds = [...new Set(itens.map(i => i.faturaId))];
  for (const faturaId of faturaIds) await recalcularTotal(tx, faturaId);
  await registrarCorrecaoFatura(tx, faturaIds);
}

/**
 * Atualiza a descrição (e opcionalmente valor/quantidade) dos FaturaItem vinculados a um
 * registro de origem e recalcula os totais das faturas afetadas. Lança FaturaPagaError
 * (sem alterar nada) se algum item pertencer a fatura PAGA.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * ⚠️ LINHA COMPARTILHADA NÃO É REESCRITA (2026-09-17). Desde que a consolidação passou
 * a juntar origens diferentes na mesma linha, renomear ou reprecificar por conta de UMA
 * delas mudaria o que as OUTRAS já cobraram — a descrição e o valor da linha são de
 * todas. Quem chama hoje (exame e encaminhamento) tem descrição própria e nunca
 * compartilha, então na prática nada muda; a guarda existe para o caso novo que um dia
 * compartilhe, e o efeito dela é não fazer nada, nunca corromper a linha alheia.
 */
async function atualizarFaturaItensDaOrigem(tx, campo, origemId, { descricao, valor, quantidade }) {
  const todos = await buscarFaturaItensDaOrigem(tx, campo, origemId);
  if (todos.length === 0) return;
  if (todos.some(i => i.fatura.status === 'PAGA')) throw new FaturaPagaError();

  const itens = [];
  for (const item of todos) {
    // `null` (base sem a tabela) conta como "pode ser compartilhada"? Não: ali NENHUMA
    // linha é compartilhada, porque a consolidação por origem só existe com a tabela.
    if ((await itemOrigens.temOutraOrigem(tx, item.id, campo, origemId)) === true) continue;
    itens.push(item);
  }
  if (itens.length === 0) return;

  const data = {};
  if (descricao  !== undefined) data.descricao  = descricao;
  if (valor      !== undefined) data.valor      = valor;
  if (quantidade !== undefined) data.quantidade = quantidade;

  await tx.faturaItem.updateMany({ where: { id: { in: itens.map(i => i.id) } }, data });
  const faturaIds = [...new Set(itens.map(i => i.faturaId))];
  for (const faturaId of faturaIds) await recalcularTotal(tx, faturaId);
  await registrarCorrecaoFatura(tx, faturaIds);
}

// ─── Regras de fechamento de fatura (dia fixo | dia útil | último dia do mês) ─────────────

const TIPOS_FECHAMENTO_VALIDOS = ['DIA_FIXO', 'DIA_UTIL', 'ULTIMO_DIA_MES'];

/** Chave "AAAA-MM-DD" em horário local — evita bug de fuso ao comparar com .toISOString() (UTC). */
function chaveData(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ehFimDeSemana(data) {
  const dia = data.getDay(); // 0=domingo, 6=sábado
  return dia === 0 || dia === 6;
}

/** Domingo de Páscoa do ano (algoritmo de Gauss/Meeus) — usado para achar a Sexta-feira Santa. */
function calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

/**
 * Feriados nacionais obrigatórios por lei federal (sem estaduais/municipais, sem pontos
 * facultativos como Carnaval e Corpus Christi). Calculado algoritmicamente — não precisa
 * de tabela mantida ano a ano.
 */
function feriadosNacionais(ano) {
  const pascoa = calcularPascoa(ano);
  const sextaSanta = new Date(pascoa);
  sextaSanta.setDate(pascoa.getDate() - 2);

  return new Set([
    chaveData(new Date(ano, 0, 1)),    // Confraternização Universal
    chaveData(sextaSanta),             // Sexta-feira Santa
    chaveData(new Date(ano, 3, 21)),   // Tiradentes
    chaveData(new Date(ano, 4, 1)),    // Dia do Trabalhador
    chaveData(new Date(ano, 8, 7)),    // Independência do Brasil
    chaveData(new Date(ano, 9, 12)),   // Nossa Senhora Aparecida
    chaveData(new Date(ano, 10, 2)),   // Finados
    chaveData(new Date(ano, 10, 15)),  // Proclamação da República
    chaveData(new Date(ano, 10, 20)),  // Consciência Negra (federal desde 2024)
    chaveData(new Date(ano, 11, 25)),  // Natal
  ]);
}

function ehDiaUtil(data) {
  if (ehFimDeSemana(data)) return false;
  return !feriadosNacionais(data.getFullYear()).has(chaveData(data));
}

/** Retorna a Date do Nº-ésimo dia útil do mês/ano de `referencia`, ou null se o mês não tiver N dias úteis. */
function nEsimoDiaUtil(n, referencia) {
  const d = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
  let contagem = 0;
  while (d.getMonth() === referencia.getMonth()) {
    if (ehDiaUtil(d)) {
      contagem++;
      if (contagem === n) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

function ehUltimoDiaDoMes(hoje) {
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);
  return amanha.getDate() === 1;
}

/**
 * Verifica se um dia fixo configurado (1–31) "bate" com uma data de referência.
 * Clamp: se o dia configurado é maior que o total de dias do mês, bate no último dia do mês
 * (ex: dia 31 configurado, fevereiro tem 28 → fecha no dia 28).
 */
function diaFixoBateHoje(dia, hoje) {
  if (hoje.getDate() === dia) return true;
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  return ehUltimoDiaDoMes(hoje) && dia > diasNoMes;
}

/**
 * Decide se uma fatura deve fechar hoje, dada a configuração de fechamento da empresa/equipe.
 *
 * @param {object} config
 * @param {string|null} config.tipoFechamento      - 'DIA_FIXO' | 'DIA_UTIL' | 'ULTIMO_DIA_MES' | null
 * @param {number|null} config.diaFechamentoFatura - dia do mês (DIA_FIXO) ou Nº dia útil (DIA_UTIL)
 * @param {Date} hoje
 */
function deveFecharHoje(config, hoje) {
  // Compat: linhas antigas sem tipoFechamento — se tinham um dia setado, é DIA_FIXO;
  // senão, comportamento original (fecha no último dia do mês).
  const tipo = config.tipoFechamento ?? (config.diaFechamentoFatura != null ? 'DIA_FIXO' : 'ULTIMO_DIA_MES');

  if (tipo === 'DIA_FIXO') {
    if (config.diaFechamentoFatura == null) return ehUltimoDiaDoMes(hoje);
    return diaFixoBateHoje(config.diaFechamentoFatura, hoje);
  }
  if (tipo === 'DIA_UTIL') {
    if (config.diaFechamentoFatura == null) return ehUltimoDiaDoMes(hoje);
    const data = nEsimoDiaUtil(config.diaFechamentoFatura, hoje);
    return data != null && chaveData(data) === chaveData(hoje);
  }
  return ehUltimoDiaDoMes(hoje);
}

// ─── CICLO DE VIDA DA FATURA ─────────────────────────────────────────────────
//
// 🔴 REABERTA NÃO É ABERTA (2026-09-06, a pedido). Fatura FECHADA/ATRASADA/PAGA que
// volta a ser editável passa a gravar **REABERTA** — nunca ABERTA de novo. As duas
// são editáveis, mas só a ABERTA é a fatura CORRENTE: é ela que `getOrCreateFatura`
// encontra para receber o lançamento clínico de hoje. Sem a distinção, reabrir a
// fatura de agosto para corrigir uma linha fazia a cobrança de setembro cair dentro
// dela — e ninguém na tela tinha como saber que aquele documento já tinha sido
// entregue ao cliente uma vez.
const STATUS_FATURA_ABERTOS  = ['ABERTA', 'REABERTA'];
const STATUS_FATURA_FECHADOS = ['FECHADA', 'ATRASADA', 'PAGA'];

/** A fatura aceita inclusão/alteração de item? (PAGA e CANCELADA nunca aceitam.) */
function faturaEditavel(status) {
  return STATUS_FATURA_ABERTOS.includes(status);
}

/**
 * Status a GRAVAR quando alguém pede para levar a fatura de volta a ABERTA.
 *
 * ⚠️ A conversão é do BACKEND, não da tela: o botão "Reabrir" continua mandando
 * `ABERTA` (cliente antigo não muda de comportamento) e é AQUI que ela vira
 * REABERTA. Pôr a decisão no front deixaria cada chamador com uma regra própria.
 */
function statusAoReabrir(statusAtual, statusPedido) {
  if (statusPedido !== 'ABERTA') return statusPedido;
  // ⚠️ REABERTA também vira REABERTA: uma fatura que JÁ passou por um fechamento não
  // volta a ser "aberta" nunca mais. Sem esta linha, reabrir duas vezes a rebaixava
  // para ABERTA e ela voltava a ser a fatura CORRENTE do mês — apagando, em silêncio,
  // o fato de o cliente já ter recebido aquele documento uma vez.
  if (statusAtual === 'REABERTA') return 'REABERTA';
  // CANCELADA fica de fora de propósito: desfazer um cancelamento é um UNDO (a fatura
  // nunca chegou a fechar), não uma reabertura.
  return STATUS_FATURA_FECHADOS.includes(statusAtual) ? 'REABERTA' : statusPedido;
}

/**
 * 'YYYY-MM' + 1 mês — o `mesReferencia` da fatura que NASCE quando a anterior fecha.
 *
 * O ciclo seguinte começa no DIA do fechamento (que pode ser o 23, não o último dia
 * do mês), então ele é cobrado no mês seguinte. Repetir o mês da fechada deixaria
 * duas faturas com o MESMO rótulo no seletor de mês da tela, e `?mes=` devolveria
 * sempre a mais recente — a fechada ficaria inalcançável.
 *
 * Sem mês de referência (ou em formato que não seja 'YYYY-MM'), cai no mês ATUAL —
 * que é o que `getOrCreateFatura` sempre usou ao criar do zero.
 */
function proximoMesReferencia(mesRef) {
  const texto  = String(mesRef ?? '');
  const partes = texto.split('-');
  const ano = Number(partes[0]);
  const mes = Number(partes[1]); // 1-12
  const valido = texto.length === 7 && partes.length === 2
    && Number.isInteger(ano) && ano > 0
    && Number.isInteger(mes) && mes >= 1 && mes <= 12;
  if (!valido) return new Date().toISOString().slice(0, 7);
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  return `${proxAno}-${String(proxMes).padStart(2, '0')}`;
}

module.exports = {
  formatAtendimentoNum,
  // Fechamento por animal — reexportado para quem já importa `faturaUtils` não ter
  // de conhecer duas libs para a mesma coisa (o controller usa as duas formas).
  fechamentoAnimal,
  getOrCreateFatura,
  STATUS_FATURA_ABERTOS,
  STATUS_FATURA_FECHADOS,
  faturaEditavel,
  statusAoReabrir,
  proximoMesReferencia,
  adicionarFaturaItem,
  adicionarOuSomarFaturaItem,
  lancarExameNaFatura,
  recalcularTotal,
  descontoDoItem,
  valorLiquidoItem,
  normalizarDesconto,
  TIPOS_DESCONTO_VALIDOS,
  registrarCorrecaoFatura,
  removerFaturaItensDaOrigem,
  atualizarFaturaItensDaOrigem,
  FaturaPagaError,
  TIPOS_FECHAMENTO_VALIDOS,
  deveFecharHoje,
  ehDiaUtil,
  // Exportados para `lib/vencimentoCredor.js` (2026-09-22): o vencimento da CONTA A
  // PAGAR usa a MESMA forma do fechamento da fatura, e uma segunda conta de dia útil
  // daria datas diferentes para a mesma regra em duas telas.
  nEsimoDiaUtil,
  ehUltimoDiaDoMes,
};
