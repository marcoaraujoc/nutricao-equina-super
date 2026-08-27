// backend/src/lib/faturaUtils.js
// Utilitários de fatura compartilhados entre controllers clínicos
'use strict';

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
}) {
  await tx.faturaItem.create({
    data: {
      faturaId, animalId, tipo, descricao,
      valor: valor ?? 0, quantidade: quantidade ?? 1, veterinarioId: veterinarioId ?? null,
      exameClinicoId: exameClinicoId ?? null,
      prescricaoId: prescricaoId ?? null,
      vacinaClinicaId: vacinaClinicaId ?? null,
      encaminhamentoClinicoId: encaminhamentoClinicoId ?? null,
    },
  });
  if ((valor ?? 0) > 0) {
    await tx.fatura.update({
      where: { id: faturaId },
      data:  { total: { increment: (valor ?? 0) * (quantidade ?? 1) } },
    });
  }
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
 * ⚠️ A chave de consolidação inclui a ORIGEM (`prescricaoId`/`vacinaClinicaId`/…), e isso
 * NÃO é opcional: `removerFaturaItensDaOrigem`/`atualizarFaturaItensDaOrigem` sincronizam
 * a fatura pela FK de origem, então fundir doses de origens diferentes numa linha só
 * quebraria o estorno (cancelar uma prescrição levaria embora a cobrança da outra).
 * Na prática isso nunca aparece como duplicata para o usuário: a descrição carrega o
 * número do atendimento (`[AG-0012]`), então itens de documentos distintos já são
 * linhas distintas de qualquer forma.
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
    faturaId, animalId, tipo, descricao, valor, quantidade,
    exameClinicoId, prescricaoId, vacinaClinicaId, encaminhamentoClinicoId,
  } = opts;

  const origem = {
    exameClinicoId:          exameClinicoId ?? null,
    prescricaoId:            prescricaoId ?? null,
    vacinaClinicaId:         vacinaClinicaId ?? null,
    encaminhamentoClinicoId: encaminhamentoClinicoId ?? null,
  };
  const temOrigem = Object.values(origem).some(v => v != null);
  // Sem origem rastreável não há como garantir que a linha antiga é "a mesma coisa"
  // (lançamento manual do financeiro, assistência mensal…). Cria linha nova.
  if (!temOrigem) return adicionarFaturaItem(tx, opts);

  const valorNovo = valor ?? 0;
  const qtdNova   = quantidade ?? 1;

  const candidatos = await tx.faturaItem.findMany({
    where: { faturaId, tipo, descricao, animalId: animalId ?? null, ...origem },
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
  await recalcularTotal(tx, faturaId);
}

/**
 * Lança um exame clínico na fatura ABERTA do proprietário com VALOR ZERADO, de forma
 * IDEMPOTENTE: se já houver um FaturaItem vinculado a este exame (exameClinicoId), não
 * duplica. Usado ao finalizar a evolução (exames solicitados) e ao concluir o exame.
 * Deve ser chamado dentro de uma transaction (tx).
 *
 * @param {object} tx
 * @param {object} exame               - { id, animalId, veterinarioId, tipo, descricao, numero }
 * @param {number|null} proprietarioUserId - Animal.userId (dono do animal)
 * @param {number|null} empresaId          - empresa do contexto (`req.empresaId`) — Fatura é POR EMPRESA
 * @returns {Promise<boolean>} true se lançou; false se já estava faturado ou sem proprietário
 */
async function lancarExameNaFatura(tx, exame, proprietarioUserId, empresaId = null) {
  if (!proprietarioUserId) return false;
  const jaFaturado = await tx.faturaItem.findFirst({ where: { exameClinicoId: exame.id } });
  if (jaFaturado) return false;

  const exNum     = `EX-${String(exame.numero).padStart(4, '0')}`;
  const descricao = `[${exNum}] ${exame.tipo}: ${exame.descricao}`;
  const fatura    = await getOrCreateFatura(tx, proprietarioUserId, empresaId);
  await adicionarFaturaItem(tx, {
    faturaId:       fatura.id,
    animalId:       exame.animalId,
    tipo:           'EXAME',
    descricao,
    valor:          0,
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
 * Recalcula o total da fatura a partir da soma dos valores LÍQUIDOS dos itens
 * (valor × quantidade − desconto). Aceita tanto o client `prisma` quanto um `tx`.
 *
 * @param {object} client
 * @param {number} faturaId
 * @returns {number} total recalculado
 */
async function recalcularTotal(client, faturaId) {
  const itens = await client.faturaItem.findMany({ where: { faturaId } });
  const total = itens.reduce((acc, i) => acc + valorLiquidoItem(i), 0);
  await client.fatura.update({ where: { id: faturaId }, data: { total } });
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
 * Remove os FaturaItem vinculados a um registro de origem e recalcula os totais das faturas
 * afetadas. Lança FaturaPagaError (sem alterar nada) se algum item pertencer a fatura PAGA.
 * Deve ser chamado dentro de uma transaction (tx), antes de excluir o registro de origem.
 */
async function removerFaturaItensDaOrigem(tx, campo, origemId) {
  const itens = await buscarFaturaItensDaOrigem(tx, campo, origemId);
  if (itens.length === 0) return;
  if (itens.some(i => i.fatura.status === 'PAGA')) throw new FaturaPagaError();

  await tx.faturaItem.deleteMany({ where: { id: { in: itens.map(i => i.id) } } });
  const faturaIds = [...new Set(itens.map(i => i.faturaId))];
  for (const faturaId of faturaIds) await recalcularTotal(tx, faturaId);
  await registrarCorrecaoFatura(tx, faturaIds);
}

/**
 * Atualiza a descrição (e opcionalmente valor/quantidade) dos FaturaItem vinculados a um
 * registro de origem e recalcula os totais das faturas afetadas. Lança FaturaPagaError
 * (sem alterar nada) se algum item pertencer a fatura PAGA.
 * Deve ser chamado dentro de uma transaction (tx).
 */
async function atualizarFaturaItensDaOrigem(tx, campo, origemId, { descricao, valor, quantidade }) {
  const itens = await buscarFaturaItensDaOrigem(tx, campo, origemId);
  if (itens.length === 0) return;
  if (itens.some(i => i.fatura.status === 'PAGA')) throw new FaturaPagaError();

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

module.exports = {
  formatAtendimentoNum,
  getOrCreateFatura,
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
};
