// backend/src/controllers/PrescricaoGrupoController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { escopoPrescricaoGrupoWhere } = require('../lib/clinicalScope');
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { ANIMAL_VISIVEL } = require('../lib/visibilidade');
const { getOrCreateFatura, adicionarOuSomarFaturaItem, removerFaturaItensDaOrigem, recalcularTotal } = require('../lib/faturaUtils');
const itemOrigens = require('../lib/faturaItemOrigens');
// CONTA A PAGAR — o outro lado do balcão da fatura (2026-09-10). O que a clínica
// DEVE ao fornecedor do medicamento e ao prestador do procedimento.
const contasPagar      = require('../lib/contasPagar');
const produtoFornecedor = require('../lib/produtoFornecedor');
// FORMA DE CÁLCULO do item (2026-09-16): a unidade em que o estoque dele é contado.
const catalogoEmpresa = require('../lib/catalogoEmpresa');
// 'Un.' — a unidade do produto que NÃO é multidose (a embalagem é a própria
// unidade). Ver `unidadeDoEstoque` e `lib/formaCalculo.js`.
const {
  UNIDADE_AVULSA, unidadeOperativa, conteudoDaEmbalagem, embalagensPara,
} = require('../lib/formaCalculo');
const { mesmaUnidade } = require('../lib/unidadeMedicamento');
const formaCobranca     = require('../lib/formaCobrancaEstoque');
const { garantirMedicamentoDaEmpresa, garantirProcedimentoDaEmpresa } = require('../lib/catalogoManual');
const vinculoPrestador = require('../lib/procedimentoPrestador');
// Etapa de Execução de Prescrição OPCIONAL por empresa (2026-09-24) — ver
// `encerrarGrupoSemExecucao`.
const etapaExecucao = require('../lib/etapaExecucaoPrescricao');
const { registrarAuditoria, registrarAlteracao, registrarTransferencia, resumoTexto } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');
// Concorrência de edição: a versão do DOCUMENTO (grupo) é a trava — ver §12.
const {
  ConflitoEdicaoError, descreverEditor, reservarVersao, anexarControle,
  versaoDoBody, responderConflito,
} = require('../lib/concorrenciaRegistro');
const { orderByDaQuery, opcional, simples, daRelacao } = require('../lib/ordenacaoLista');
const { animalEstaInativo, bloquearSeAnimalInativo, lerInativosEmLote } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { cursoTodoDoProprietario } = require('../lib/prescricaoProprietario');
const {
  DOSES_POR_DIA, elegivelParaFluxoNovo, semAncoraDeHorario, dosesTotaisEsperadas, primeiraDoseEsperada,
  calcularProximaDose, classificarExecucao, diferencaEmMinutos, itemPrevistoParaDataFutura,
  horarioPrevistoDoItem, dentroDaJanelaDoCurso,
} = require('../lib/agendaDoses');
// FUSO DA CLÍNICA — a aplicação roda nos 4 fusos do Brasil e o processo Node roda
// fixo em America/Sao_Paulo (server.ts). "Que dia é hoje" na fila do plantão TEM de
// ser o dia da clínica: em Rio Branco (UTC−5) a dose das 22h cairia no dia seguinte
// pela conta do servidor. Ver lib/fusoEmpresa.js.
const { fusoDaEmpresa, hojeNaEmpresa, diaNaEmpresa, formatarNaEmpresa } = require('../lib/fusoEmpresa');

// Frequências "conforme necessário" — sem agenda prevista, então não pertencem
// à fila de execução do plantão (ninguém "deve" aplicar uma dose que só
// acontece se/quando for preciso). Some só da LISTAGEM: o item continua
// existindo no documento e pode ser editado/cancelado como qualquer outro.
const FREQUENCIAS_FORA_DA_EXECUCAO = new Set(['seNecessario', 'SOS']);

const MSG_PACIENTE_INATIVO = 'Paciente inativo — reative com o gestor antes de registrar algo novo.';

// ─── Include padrão ───────────────────────────────────────────────────────────

const GRUPO_INCLUDE = {
  veterinario: { select: { id: true, fullName: true, userType: true } },
  evolucao: { select: { id: true, numero: true, tipoAtendimento: true } },
  itens: {
    where:   { ativo: true },
    include: {
      veterinario:    { select: { id: true, fullName: true } },
      medicamentoCat: { select: { id: true, nome: true, formaFarmaceutica: true, unidade: true, controlado: true } },
    },
    orderBy: { id: 'asc' },
  },
};

// ─── Helper: numero formatado ─────────────────────────────────────────────────

const formatNumero = (n) => String(n).padStart(3, '0');

// ─── Helper: próximo número de prescrição para um animal ─────────────────────

const proximoNumero = async (tx, animalId) => {
  const ultimo = await tx.prescricaoGrupo.findFirst({
    where:   { animalId },
    orderBy: { numero: 'desc' },
    select:  { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
};

// ─── Helpers: cálculo, reserva e baixa de estoque ────────────────────────────
// `DOSES_POR_DIA` mora em lib/agendaDoses.js — fonte única com o cron de WhatsApp.

// ─── Conversão de unidades ────────────────────────────────────────────────────
// Estratégia: converter TUDO para a unidade base (g para massa, mL para volume),
// fazer a conta na base e converter de volta para a unidade do estoque.
// Kg → g (×1000) | mg → g (×0.001) | L → mL (×1000)
// Se as unidades são incompatíveis (ex: g vs mL) ou desconhecidas, usa o valor bruto.

const FATOR_PARA_BASE = {
  // Massa → gramas
  'g': 1, 'mg': 0.001, 'kg': 1000, 'mcg': 0.000001, 'µg': 0.000001,
  // Volume → mL
  'ml': 1, 'l': 1000,
};

const GRUPO_UNIDADE = {
  'g': 'm', 'mg': 'm', 'kg': 'm', 'mcg': 'm', 'µg': 'm',
  'ml': 'v', 'l': 'v',
};

// qty (em `unidade`) → unidade base (g ou mL)
function paraBase(qty, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qty * f : qty;
}

// qty (em unidade base) → unidade original
function deBase(qtyBase, unidade) {
  const f = FATOR_PARA_BASE[(unidade ?? '').trim().toLowerCase()];
  return f != null ? qtyBase / f : qtyBase;
}

// Preço UNITÁRIO (R$ por unidade base — g/mL, ou por unidade quando não conversível)
// de uma entrada do estoque. Fonte única das duas regras que já existiam espalhadas:
// `precoUnitarioBase` é gravado na ENTRADA e permanece fixo; o cálculo dinâmico é o
// caminho legado (itens sem o campo) e tem o defeito conhecido de o preço subir
// conforme o estoque baixa — só continua aqui para não mudar a cobrança do que já
// está cadastrado assim.
function precoUnitarioDoEstoque(estoque, unidadeEstoque) {
  if (estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0) {
    return estoque.precoUnitarioBase;
  }
  const precoVenda = estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0);
  // ⚠️ Divide pelo CONTEÚDO DA EMBALAGEM, nunca pelo saldo (2026-09-17): o valor gravado
  // é o de uma embalagem, e usar `qtdEstoque` fazia o preço SUBIR a cada dose aplicada —
  // o defeito conhecido deste caminho legado. Sem conteúdo declarado a embalagem é a
  // própria unidade, e o valor dela já é o preço unitário.
  const conteudo = Number(estoque.pesoPorEmbalagem) > 0 ? Number(estoque.pesoPorEmbalagem) : 1;
  const base     = paraBase(conteudo, unidadeEstoque);
  return base > 0 ? precoVenda / base : 0;
}

// Retrato do estoque ANTES da baixa, no formato que `precoDeVenda` consome —
// é dele que saem MAIOR_VALOR e CUSTO_MEDIO.
function entradasParaCobranca(estoques, unidadeEstoque) {
  return estoques.map(e => ({
    preco: precoUnitarioDoEstoque(e, unidadeEstoque),
    qtd:   paraBase(e.qtdEstoque, unidadeEstoque),
  }));
}

function mesmoGrupo(u1, u2) {
  const g1 = GRUPO_UNIDADE[(u1 ?? '').trim().toLowerCase()];
  const g2 = GRUPO_UNIDADE[(u2 ?? '').trim().toLowerCase()];
  return g1 != null && g1 === g2;
}


/** 'Un.', 'un', 'unidade' — a unidade do produto que NÃO declara conteúdo. */
function ehAvulsa(u) {
  return mesmaUnidade(u, UNIDADE_AVULSA);
}

// ─── Quantidade total do curso ────────────────────────────────────────────────

function calcularQuantidadeTotal(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  const dias       = Math.max(Number(item.duracaoDias) || 1, 1);
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia * dias;
}

// ─── Quantidade de 1 dia (sem multiplicar por duracaoDias) ───────────────────

function calcularQuantidadeDiaria(item) {
  const qtdPorDose = parseFloat(item.dosagem) || 1;
  if (item.frequencia === 'agora') return qtdPorDose;
  const dosesPorDia = DOSES_POR_DIA[item.frequencia] ?? 1;
  return qtdPorDose * dosesPorDia;
}

// ⚠️ `dosesDoDia`/`dosesDoCurso` (a CONTAGEM de aplicações) foram REMOVIDAS em
// 2026-09-16 junto com a semântica antiga de multidose: elas existiam só para dividir
// a contagem pelas N doses do frasco, e essa divisão deixou de existir quando o produto
// passou a declarar a FORMA DE CÁLCULO — receita e estoque falam a mesma unidade, e não
// há o que contar nem o que converter. `DOSES_POR_DIA` continua sendo a fonte da
// cadência (é dela que `calcularQuantidadeDiaria` sai).

/**
 * 🔴 A PRESCRIÇÃO ESCRITA EM CONTEÚDO CONSOME **UMA EMBALAGEM**, no curso inteiro.
 *
 * Vale quando o estoque é contado em EMBALAGENS ('Un.' — produto sem multidose) e a
 * receita foi escrita em outra unidade (mL, g, %, UI…), que é o caso normal desde
 * 2026-09-18: o campo Dosagem passou a mostrar a Unidade cadastrada no produto, porque
 * ninguém prescreve "0,1 frasco de xarope".
 *
 * Sem multidose o produto NÃO declara quanto cabe na embalagem — é isso que "não é
 * multidose" significa —, então não existe conversão possível entre os dois lados. O
 * que existe é o fato: a clínica ENTREGA o frasco, uma vez. O curso inteiro consome
 * essa embalagem, e é ela que sai do estoque e entra na fatura:
 *
 *     Xarope 50 mL, R$ 60,00 o frasco · receita 5 mL 1x/dia por 10 dias
 *       estoque : −1 frasco   (na 1ª execução)
 *       fatura  : 1 × R$ 60,00
 *
 * 🔴 E "UMA" EMBALAGEM VIROU "AS QUE COUBEREM" (2026-09-19, a pedido). O curso que não
 * cabe num frasco consome mais de um, e é isso que sai do estoque e entra na fatura:
 *
 *     Frasco de 100 mL · receita 25 mL × 5 doses = 125 mL
 *       estoque : −2 frascos   (o 1º na 1ª dose, o 2º na 5ª)
 *       fatura  : 2 × R$ 200,00
 *
 * Quem sabe os 100 mL é o CADASTRO DO PRODUTO (`lib/formaCalculo.conteudoDaEmbalagem`).
 * Sem o conteúdo declarado — que é o estado de toda base existente — continua sendo UMA
 * embalagem para o curso, exatamente como antes.
 *
 * ⚠️ NÃO é "1 embalagem por APLICAÇÃO", que foi a regra entre 2026-09-17 e 2026-09-18:
 * aquela cobrava DEZ frascos pelo exemplo acima. Quem garante que o segundo frasco só
 * sai quando o primeiro acaba é a conta INCREMENTAL de `debitarEstoqueDia` (o acumulado
 * do curso, não a dose de hoje) — a quantidade daqui é a do curso INTEIRO, e é ela que
 * dimensiona a RESERVA e as três verificações de estoque.
 *
 * ⚠️ Receita na MESMA unidade do estoque ("2 Un.") NÃO entra aqui: ali o veterinário
 * está prescrevendo EMBALAGENS, e 2 por dia durante 5 dias são 10 embalagens de
 * verdade. É a distinção entre a ampola prescrita por unidade e o frasco prescrito
 * pelo conteúdo — e é por isso que o produto aplicado dose a dose pela clínica deve
 * ser cadastrado como multidose (declarando o conteúdo) ou prescrito em 'Un.'.
 */
function entregaPorEmbalagem(unidadePrescrita, unidadeEstoque) {
  if (!ehAvulsa(unidadeEstoque)) return false;
  const u = String(unidadePrescrita ?? '').trim();
  // Unidade VAZIA continua no valor bruto: sem rótulo, "2" já se lê como 2 unidades.
  if (u === '' || ehAvulsa(u)) return false;
  return !mesmoGrupo(u, unidadeEstoque);
}

/**
 * Quanto SAI DO ESTOQUE, na unidade do estoque.
 *
 * 🔴 A DIVISÃO POR DOSES SAIU DAQUI EM 2026-09-16, e é uma SIMPLIFICAÇÃO, não uma
 * perda. Enquanto o frasco de 20 mL era cadastrado como "1 Un.", prescrição e estoque
 * falavam línguas diferentes: `mesmoGrupo('mL','Un.')` é falso, e a saída era dividir
 * a CONTAGEM de aplicações pelas N doses do frasco. Agora o produto MULTIDOSE declara a
 * FORMA DE CÁLCULO, o estoque é contado nela e a receita é escrita nela — então não há
 * o que converter nem o que dividir: 5 mL saem de 60 mL e sobram 55.
 *
 * A fatura sai certa sozinha, porque o valor da linha sempre foi
 * `qtd debitada × preço unitário`, e o preço unitário é o da embalagem ÷ conteúdo:
 *     3 × R$ 100 = R$ 300 por 60 mL  →  R$ 5/mL  →  5 mL = R$ 25,00
 * que é exatamente `qtd × valorUnitárioCobrado ÷ qtdPorEmbalagem`.
 *
 * 🔴 E o produto SEM multidose devolve **1**: a embalagem inteira, uma vez no curso —
 * ver `entregaPorEmbalagem`.
 */
function qtdDoEstoque(qtdPrescrita, unidadePrescrita, unidadeEstoque, conteudoEmbalagem = null) {
  if (mesmoGrupo(unidadePrescrita, unidadeEstoque)) {
    return deBase(paraBase(qtdPrescrita, unidadePrescrita), unidadeEstoque);
  }
  // ⚠️ `embalagensPara` devolve 1 quando o conteúdo não foi declarado — o argumento é
  // opcional para que TODO chamador que ainda não o passa mantenha o comportamento
  // anterior em vez de cair em zero.
  if (entregaPorEmbalagem(unidadePrescrita, unidadeEstoque)) {
    return embalagensPara(qtdPrescrita, conteudoEmbalagem);
  }
  return qtdPrescrita;
}

/**
 * 🔴 QUANTAS EMBALAGENS **ESTA** EXECUÇÃO ABRE (2026-09-19).
 *
 * A conta é ACUMULADA, não por dose: compara quantas embalagens o curso já tinha
 * abertas com quantas passa a ter depois desta aplicação, e entrega a diferença. Frasco
 * de 100 mL, 5 doses de 25 mL:
 *
 *     dose 1   acum  25  ->  1 aberta   (antes 0)   entrega 1
 *     dose 2   acum  50  ->  1 aberta   (antes 1)   entrega 0
 *     dose 3   acum  75  ->  1 aberta   (antes 1)   entrega 0
 *     dose 4   acum 100  ->  1 aberta   (antes 1)   entrega 0
 *     dose 5   acum 125  ->  2 abertas  (antes 1)   entrega 1
 *                                         CURSO: 2 frascos
 *
 * ⚠️ É isto que faz o curso INTERROMPIDO não cobrar frasco que ninguém abriu. A
 * alternativa — cobrar `ceil(curso inteiro)` já na 1ª dose — deixaria dois frascos
 * cobrados numa prescrição cancelada na segunda aplicação.
 *
 * ⚠️ O "antes" da PRIMEIRA dose é 0 EXPLÍCITO: `embalagensPara` tem piso 1 (é a entrega
 * única de quem não declara conteúdo), e passar zero por ela devolveria 1 — a primeira
 * entrega sairia 1 − 1 = 0 e o item nunca seria debitado nem cobrado.
 *
 * ⚠️ Sem conteúdo declarado a conta degenera exatamente no comportamento anterior: 1 na
 * primeira execução e 0 nas seguintes. Nenhuma base existente muda.
 */
function embalagensDaExecucao({ jaConsumido, qtdAgora, conteudo }) {
  const antes  = Number(jaConsumido) > 0 ? embalagensPara(jaConsumido, conteudo) : 0;
  const depois = embalagensPara(Number(jaConsumido) + Number(qtdAgora), conteudo);
  return Math.max(0, depois - antes);
}

/**
 * `Map<medicamentoCatId, formaCalculo>` dos itens do documento.
 *
 * 🔴 É ELA a unidade em que o estoque daquele item é contado, e não a `unidade` do
 * catálogo (que é a da EMBALAGEM: "Frasco", "Un."). Ler a errada é o que faz 2 L
 * serem convertidos em 2.000 mL contra um saldo de 6 — sem erro nenhum na tela.
 *
 * ⚠️ Uma consulta por LOTE de itens, nunca por item — e com o `client` da transação,
 * senão o `prisma` global chega ao banco sem o carimbo de tenant e o RLS devolve
 * ZERO linha em silêncio (armadilha de 2026-08-23, parte 4).
 */
async function mapaFormaCalculo(client, itens) {
  const ids = itens
    .filter(i => i.tipo === 'MEDICAMENTO' && i.medicamentoCatId)
    .map(i => i.medicamentoCatId);
  const mapa = await catalogoEmpresa.multidosePorItem(client, ids);
  const forma = new Map();
  // ⚠️ Quem decide é `lib/formaCalculo.unidadeOperativa`, não uma cópia da regra aqui:
  // ela conhece os quatro estados do cadastro (declara conteúdo, LEGADO sem forma,
  // marcado sem quantidade, não-multidose) e é a MESMA que o estoque e as telas leem.
  for (const [id, info] of mapa) {
    forma.set(id, unidadeOperativa(info));
  }
  return forma;
}

/**
 * `Map<medicamentoCatId, conteudoDaEmbalagem>` dos itens do documento.
 *
 * 🔴 SÓ do produto SEM multidose, e é o que permite o curso consumir mais de uma
 * embalagem (2026-09-19). Ver `lib/formaCalculo.conteudoDaEmbalagem` para a razão de
 * ele ser separado de `qtdPorEmbalagemDe`: este NÃO muda a unidade operativa.
 *
 * ⚠️ É uma segunda leitura das MESMAS linhas que `mapaFormaCalculo` lê, e isso é
 * deliberado: aquela função aparece por nome nos gates estruturais de `unidadeDoEstoque`
 * (a unidade tem de valer nos cinco pontos), e fundir as duas num retorno só faria o
 * gate deixar de enxergar o elo que ele existe para travar. A consulta é um
 * `WHERE id IN (...)` sobre um punhado de ids, dentro da mesma transação — ao lado das
 * buscas FEFO, que são UMA POR ITEM, o custo é ruído.
 *
 * ⚠️ Com o `client` da transação, nunca o `prisma` global: sem o carimbo de tenant o
 * RLS devolve zero linha em silêncio e todo produto volta a valer uma embalagem.
 */
async function mapaConteudoEmbalagem(client, itens) {
  const ids = itens
    .filter(i => i.tipo === 'MEDICAMENTO' && i.medicamentoCatId)
    .map(i => i.medicamentoCatId);
  const mapa = await catalogoEmpresa.multidosePorItem(client, ids);
  const conteudos = new Map();
  for (const [id, info] of mapa) {
    const c = conteudoDaEmbalagem(info);
    if (c != null) conteudos.set(id, c);
  }
  return conteudos;
}

/** Quanto cabe na embalagem DESTE item, ou `null` (= uma embalagem por curso). */
function conteudoDoItem(conteudos, item) {
  return conteudos?.get(item.medicamentoCatId) ?? null;
}

/**
 * A unidade em que ESTE item é contado no estoque.
 *
 * Forma de cálculo quando o produto a declara; senão **'Un.'** — a embalagem é a
 * própria unidade (2026-09-17, a pedido).
 *
 * 🔴 NÃO cai mais na unidade do CATÁLOGO, e a diferença é a conta da fatura: aquela é
 * a unidade da EMBALAGEM e pode ser 'g'/'mL'/'kg', enquanto a entrada de estoque de um
 * produto sem multidose conta EMBALAGENS (Qtd Total = Qtd Produto). Com 'g' dos dois
 * lados, uma receita de "20 g" debitava 20 de um saldo de 10 bisnagas e cobrava
 * 20 × R$/g. Em 'Un.', 1 embalagem debita 1 e custa `valorRepassado ÷ Qtd Produto`.
 *
 * ⚠️ `item.unidade` (a unidade GRAVADA na receita) não entra aqui de propósito: quem
 * decide em que o estoque é contado é o PRODUTO, não o que foi digitado na prescrição
 * — foi essa inversão que deixou receita e estoque falando línguas diferentes.
 */
function unidadeDoEstoque(formaMap, item) {
  return formaMap?.get(item.medicamentoCatId) ?? UNIDADE_AVULSA;
}

// 🔴 `hojeLocalStr()` foi REMOVIDA daqui: lia o relógio do SERVIDOR (fixo em
// America/Sao_Paulo por server.ts), e "hoje" na fila do plantão tem de ser o dia da
// CLÍNICA — para quem está em UTC−4/−5 o servidor vira o dia 1-2h antes. Use
// `hojeNaEmpresa(fuso)` / `diaNaEmpresa(instante, fuso)` de lib/fusoEmpresa.js.

// ─── Janela de execução de um item (dataInicio .. dataInicio+duracaoDias) ────
// hojeStr: 'YYYY-MM-DD'. Retorna { dentro, ultimoDia } — ultimoDia = hoje é o
// último dia coberto pela janela do item (ou já passou dela).
function janelaDoItem(item, hojeStr) {
  const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
  const inicio    = new Date(inicioStr + 'T00:00:00Z');
  const fim       = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + Math.max(Number(item.duracaoDias) || 1, 1));
  const fimStr    = fim.toISOString().split('T')[0];
  // fimStr é exclusivo (dataInicio + duracaoDias): o último dia válido é fimStr - 1 dia
  const ultimoDiaValido = new Date(fim);
  ultimoDiaValido.setUTCDate(ultimoDiaValido.getUTCDate() - 1);
  const ultimoDiaStr = ultimoDiaValido.toISOString().split('T')[0];
  return {
    dentro:    inicioStr <= hojeStr && hojeStr < fimStr,
    ultimoDia: hojeStr >= ultimoDiaStr,
  };
}

function qtdDiariaEstoque(item, unidadeEstoque, resolverQtd = calcularQuantidadeDiaria, conteudo = null) {
  return qtdDoEstoque(resolverQtd(item), item.unidade, unidadeEstoque, conteudo);
}

// Converte a quantidade prescrita (item.unidade) para a unidade do estoque via base.
// Ex: 500g → kg: paraBase(500,'g')=500g → deBase(500,'kg')=0.5 kg
// Com a FORMA DE CÁLCULO as duas unidades coincidem e a conversão é a identidade.
function qtdNaUnidadeEstoque(item, unidadeEstoque, conteudo = null) {
  return qtdDoEstoque(calcularQuantidadeTotal(item), item.unidade, unidadeEstoque, conteudo);
}

// ─── Multi-lote (FEFO) ───────────────────────────────────────────────────────
// Um medicamento pode ter VÁRIAS entradas de estoque (lotes). Todas as operações
// de reserva/baixa/verificação consideram o CONJUNTO das entradas: quando uma
// entrada não é suficiente, o restante é reservado/debitado nas demais.
// Ordem FEFO: validade mais próxima primeiro; sem validade por último; empate → id.

async function buscarEstoquesFEFO(client, medicamentoCatId, empresaId, grupoIdExcluir = null) {
  const estoques = await client.estoqueClinica.findMany({
    where:   { medicamentoId: medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
    include: {
      medicamento: { select: { nome: true, unidade: true } },
      reservas: {
        ...(grupoIdExcluir != null ? { where: { prescricaoGrupoId: { not: grupoIdExcluir } } } : {}),
        include: { animal: { select: { nome: true } }, prescricaoGrupo: { select: { numero: true } } },
      },
    },
  });
  return estoques.sort((a, b) => {
    const va = a.validade ? new Date(a.validade).getTime() : Infinity;
    const vb = b.validade ? new Date(b.validade).getTime() : Infinity;
    return va !== vb ? va - vb : a.id - b.id;
  });
}

// Cria reservas de estoque em unidade do estoque (não altera qtdEstoque).
// MULTI-LOTE: distribui a quantidade do curso entre as entradas do medicamento
// (FEFO), respeitando o que já está reservado por OUTRAS prescrições. Se mesmo
// assim faltar, o restante é reservado na última entrada (finalização forçada).
async function criarReservas(tx, grupoId, animalId, itens, empresaId) {
  // A unidade em que cada item é contado (forma de cálculo, quando declarada) — a
  // reserva precisa nascer NA MESMA unidade da baixa, senão ela segura um número que
  // o débito nunca consome e o saldo trava para toda a clínica.
  const formas = await mapaFormaCalculo(tx, itens);
  // ⚠️ A reserva precisa cobrir o CURSO INTEIRO: com um frasco de 100 mL e 125 mL
  // receitados, reservar 1 deixaria o segundo frasco livre para outra prescrição e a
  // última dose bateria num saldo que alguém já levou.
  const conteudos = await mapaConteudoEmbalagem(tx, itens);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
    const estoques = await buscarEstoquesFEFO(tx, item.medicamentoCatId, empresaId, grupoId);
    if (estoques.length === 0) continue;

    // Recalcula do zero (re-finalização): limpa reservas anteriores deste grupo p/ este medicamento
    await tx.reservaEstoque.deleteMany({
      where: { prescricaoGrupoId: grupoId, estoqueId: { in: estoques.map(e => e.id) } },
    });

    const unidadeEstoque = unidadeDoEstoque(formas, item);
    let restante = qtdNaUnidadeEstoque(item, unidadeEstoque, conteudoDoItem(conteudos, item));

    for (let i = 0; i < estoques.length && restante > 0.0001; i++) {
      const e = estoques[i];
      const reservadoOutros = (e.reservas ?? []).reduce((s, r) => s + r.quantidade, 0);
      const disponivel      = Math.max(e.qtdEstoque - reservadoOutros, 0);
      const ultimaEntrada   = i === estoques.length - 1;
      const quantidade      = ultimaEntrada ? restante : Math.min(disponivel, restante);
      if (quantidade <= 0.0001) continue;
      await tx.reservaEstoque.create({
        data: { prescricaoGrupoId: grupoId, estoqueId: e.id, animalId, quantidade },
      });
      restante -= quantidade;
    }
  }
}

// Consome reservas e dá baixa no estoque (ao executar).
// Estratégia: converte tudo para a menor unidade (g ou mL), subtrai, converte de volta.
// Retorna { precos: Map<catId, R$/unidadeEstoque>, unidades: Map<catId, unidadeEstoque> }
async function consumirReservas(tx, grupoId, itens, empresaId) {
  const precos   = new Map();
  const unidades = new Map();
  const formas   = await mapaFormaCalculo(tx, itens);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
    const estoque = await tx.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { unidade: true } } },
    });
    if (!estoque) continue;
    const unidadeEstoque = unidadeDoEstoque(formas, item);
    const qtdTotal       = calcularQuantidadeTotal(item);

    let novaQtd;
    if (mesmoGrupo(item.unidade, unidadeEstoque)) {
      // Converte TUDO para a menor unidade base (g ou mL), faz a conta, volta para unidade do estoque
      const estoqueBase  = paraBase(estoque.qtdEstoque, unidadeEstoque);
      const prescritaBase = paraBase(qtdTotal, item.unidade);
      novaQtd = deBase(Math.max(estoqueBase - prescritaBase, 0), unidadeEstoque);
    } else {
      // Unidades incompatíveis — subtrai diretamente
      novaQtd = Math.max(estoque.qtdEstoque - qtdTotal, 0);
    }

    const deduzido = estoque.qtdEstoque - novaQtd;
    const desc     = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} × ${item.duracaoDias}d`
      : item.frequencia;
    await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
    await tx.movimentoEstoque.create({
      data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
    });
    await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } });
    // Preço proporcional ao cliente por unidade base (R$/g ou R$/mL).
    // ⚠️ FONTE ÚNICA `precoUnitarioDoEstoque`: a regra (campo fixo da entrada, com o
    // cálculo legado como reserva) estava escrita aqui e lá, e divergiria na primeira
    // correção — o que divergiria é o VALOR COBRADO DO CLIENTE.
    const precoPorUnidade = precoUnitarioDoEstoque(estoque, unidadeEstoque);
    precos.set(item.medicamentoCatId, precoPorUnidade);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
  }
  return { precos, unidades };
}

// Libera reservas sem dar baixa (ao cancelar)
async function liberarReservas(tx, grupoId) {
  await tx.reservaEstoque.deleteMany({ where: { prescricaoGrupoId: grupoId } });
}

/**
 * 🔴 REFAZ AS RESERVAS DO GRUPO do zero, a partir dos itens que existem AGORA.
 *
 * POR QUE EXISTE: `finalizar` reserva estoque pela quantidade de cada item. Editar
 * um item DEPOIS disso (grupo FINALIZADO, ainda sem nenhuma dose dada — que é
 * exatamente a prescrição parada na fila do plantão) deixava a reserva presa na
 * quantidade ANTIGA. Dobrar a duração de 5 para 10 dias reservava 5; trocar o
 * medicamento deixava a reserva do anterior ÓRFÃ, segurando estoque que ninguém
 * mais vai usar — e o próximo a prescrever aquele medicamento via saldo a menos.
 *
 * ⚠️ APAGA TUDO E RECRIA, em vez do ajuste por medicamento: é o único jeito de
 * limpar a reserva do medicamento que saiu do documento (`criarReservas` percorre
 * os itens NOVOS e nunca chega ao que foi trocado).
 *
 * ⚠️ SÓ VALE PARA GRUPO SEM NENHUMA EXECUÇÃO. Depois da primeira dose as reservas
 * já foram abatidas proporcionalmente por `debitarEstoqueDia`, e recriá-las pela
 * quantidade CHEIA do item reservaria de novo o que já saiu do estoque. Quem
 * garante isso aqui é o guard `EXECUTADO` do `atualizarItem`, que roda antes.
 */
async function recalcularReservasDoGrupo(tx, grupo) {
  // Reserva só existe a partir do FINALIZADO — em rascunho não há o que refazer.
  if (!grupo || grupo.status === 'SALVO') return;
  await liberarReservas(tx, grupo.id);
  const itens = await anexarAplicadaProprietario(prisma, await tx.prescricao.findMany({
    where: { grupoId: grupo.id, ativo: true, status: { not: 'CANCELADA' } },
  }));
  if (itens.length === 0) return;
  await criarReservas(tx, grupo.id, grupo.animalId, itens, grupo.empresaId ?? null);
}

// Debita estoque e cria MovimentoEstoque para a quantidade que `resolverQtd(item)`
// determinar — por padrão, a dose do DIA INTEIRO (`calcularQuantidadeDiaria`, itens
// legados sem horário definido); a execução por dose passa um resolvedor que
// devolve só a quantidade de UMA dose (ver `executar`).
// MULTI-LOTE: a quantidade é debitada em FEFO através das entradas do
// medicamento — quando uma entrada não basta, o restante sai da próxima.
// Se `grupoId` for informado, as reservas DESTE grupo são abatidas na mesma
// proporção (evita contagem dupla: estoque já baixado + reserva ainda ativa).
// Retorna { precos, unidades } por medicamentoCatId (para lançar na fatura) —
// precos contém o VALOR TOTAL da quantidade debitada (soma dos lotes).
async function debitarEstoqueDia(
  tx, itens, empresaId, grupoId = null, resolverQtd = calcularQuantidadeDiaria,
  { incluirDoProprietario = false } = {},
) {
  const precos   = new Map();
  const unidades = new Map();
  // 🔴 Itens que NÃO tiveram entrega nesta execução (ver `entregaPorEmbalagem`). Quem
  // chama precisa deles para NÃO lançar a linha de fatura nem a conta a pagar: a dose
  // de hoje sai do frasco que o cliente já pagou.
  // ⚠️ Desde 2026-09-19 isto não é mais "já foi entregue UMA vez": o curso pode
  // consumir várias embalagens, e o item volta a entregar (e a ser cobrado) na dose em
  // que o frasco aberto acaba.
  const jaEntregues  = new Set();
  // Itens entregues por embalagem — a conta a pagar do fornecedor conta EMBALAGENS, não
  // a dosagem da receita (que está em mL).
  const porEmbalagem = new Set();
  // Quantas embalagens saíram NESTA execução, por item. É ela que vira a quantidade da
  // linha da fatura e da conta a pagar — `1` fixo cobraria um frasco onde saíram dois.
  const entregas     = new Map();
  // 🔴 QUANTAS UNIDADES INTEIRAS ESTA DOSE ENTREGOU, por item (2026-09-23).
  //
  // Só existe para o produto contado em unidades AVULSAS ("Un.", ampola, comprimido) e
  // prescrito nelas: ali a dose de "2 Un." entrega DUAS unidades, e a linha da fatura
  // precisa sair `2 × R$ 100,00` — não `1 × R$ 200,00`, que era o que aparecia (o valor
  // fechava, a quantidade mentia e não havia como conferir o unitário contra a nota).
  //
  // ⚠️ Produto MULTIDOSE (mL/g) fica FORA de propósito: lá a linha conta DOSES
  // ("5 mL × 3x ao dia (1 dose)"), e trocar a quantidade para 5 passaria a exibir um
  // R$/mL onde a tela sempre mostrou o preço da dose. Nada muda para ele.
  const unidadesFaturadas = new Map();
  // 🔴 A unidade em que cada item é contado. Com a FORMA DE CÁLCULO declarada, a
  // dosagem da receita já está na unidade do estoque — não há conversão nem divisão,
  // e a fatura sai por `qtd × preço da embalagem ÷ conteúdo` sozinha.
  const formas = await mapaFormaCalculo(tx, itens);
  // Quanto cabe na embalagem de cada produto SEM multidose — é o que diz se o curso
  // consome um frasco ou três. Sem ele declarado, tudo continua valendo uma embalagem.
  const conteudos = await mapaConteudoEmbalagem(tx, itens);
  // Forma de cobrança da clínica — resolvida UMA vez por execução (é a mesma para
  // todos os itens). Ver lib/formaCobrancaEstoque.js.
  const cfgCobranca = await formaCobranca.lerForma(tx, empresaId);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // Aplicado pelo proprietário em casa: não passa pelo plantão. A clínica não reserva
    // nem debita na EXECUÇÃO — mas, quando é ela quem FORNECE, o frasco sai da
    // prateleira na FINALIZAÇÃO, que é a única oportunidade de cobrá-lo
    // (`incluirDoProprietario`, 2026-09-18). Ver a matriz em `finalizar`.
    if (item.aplicadaPeloProprietario && !incluirDoProprietario) continue;

    // 🔴 A unidade é resolvida ANTES de olhar o estoque, e a guarda de entrega vem
    // antes de tudo: item sem estoque cadastrado é lançado com valor 0 "para o
    // financeiro saber", e sem a guarda aqui ele voltaria a somar quantidade na linha
    // a cada dose de um frasco que já foi entregue.
    const unidadeEstoque = unidadeDoEstoque(formas, item);
    unidades.set(item.medicamentoCatId, unidadeEstoque);
    const entregaUnica = entregaPorEmbalagem(item.unidade, unidadeEstoque);
    let embalagensAgora = 0;
    if (entregaUnica) {
      porEmbalagem.add(item.id);
      const conteudo   = conteudoDoItem(conteudos, item);
      const porExecucao = Number(resolverQtd(item)) || 0;
      // ⚠️ `dosesExecutadas` só é incrementado no FLUXO POR DOSE
      // (`elegivelParaFluxoNovo`). No legado ele fica em 0 para sempre, e um item já
      // executado cairia aqui com "nada consumido ainda" — voltando a debitar e a
      // cobrar uma embalagem A CADA execução, que é o defeito de 2026-09-17. Item já
      // executado SEM contador é o legado, e ali vale a regra anterior: entrega única
      // no curso inteiro.
      const doses = Number(item.dosesExecutadas) || 0;
      if (item.executadoEm && doses === 0) { jaEntregues.add(item.id); continue; }

      // 🔴 A CONTA É ACUMULADA, NÃO POR DOSE (2026-09-19). Compara quantas embalagens o
      // curso já tinha aberto com quantas ele passa a ter abertas depois desta dose, e
      // entrega a diferença. Frasco de 100 mL, 5 doses de 25 mL:
      //
      //     dose 1  acum   25  ->  1 aberta   (antes 0)   entrega 1
      //     dose 2  acum   50  ->  1 aberta   (antes 1)   entrega 0
      //     dose 3  acum   75  ->  1 aberta   (antes 1)   entrega 0
      //     dose 4  acum  100  ->  1 aberta   (antes 1)   entrega 0
      //     dose 5  acum  125  ->  2 abertas  (antes 1)   entrega 1
      //                                        TOTAL DO CURSO: 2 frascos
      //
      // ⚠️ É isto que faz o curso cancelado no meio NUNCA cobrar frasco que ninguém
      // abriu — a alternativa (cobrar ceil(curso inteiro) na 1ª dose) deixaria dois
      // frascos cobrados numa prescrição interrompida na segunda aplicação.
      // ⚠️ `embalagensPara` devolve 1 para quantidade zero (é o piso da entrega única),
      // então o "antes" precisa ser 0 EXPLÍCITO na primeira dose — senão a 1ª entrega
      // sairia 1 − 1 = 0 e o item nunca seria debitado nem cobrado.
      embalagensAgora = embalagensDaExecucao({
        jaConsumido: porExecucao * doses, qtdAgora: porExecucao, conteudo,
      });
      if (embalagensAgora <= 0) { jaEntregues.add(item.id); continue; }
      entregas.set(item.id, embalagensAgora);
    }

    const estoques = await buscarEstoquesFEFO(tx, item.medicamentoCatId, empresaId);
    if (estoques.length === 0) continue;
    const qtdDia         = resolverQtd(item);
    // 🔴 O retrato do estoque é tirado ANTES do laço de baixa: MAIOR_VALOR e
    // CUSTO_MEDIO olham o que a clínica TEM no momento da cobrança. Calculado
    // depois, cada lote debitado mudaria o preço dos seguintes na mesma execução.
    const entradas = entradasParaCobranca(estoques, unidadeEstoque);

    // Quantidade do dia na unidade do estoque. Na entrega por embalagem quem manda é a
    // conta acumulada acima (as embalagens que ESTA execução abre), nunca a dosagem —
    // `qtdDoEstoque` sozinha responderia pelo curso inteiro a cada dose.
    let restante = entregaUnica
      ? embalagensAgora
      : qtdDoEstoque(qtdDia, item.unidade, unidadeEstoque, conteudoDoItem(conteudos, item));

    const desc = item.dosagem
      ? `${item.dosagem}${item.unidade ? ' ' + item.unidade : ''} × ${item.frequencia} (1 dose)`
      : `${item.frequencia} (1 dose)`;

    let valorDaDose   = 0;
    let debitadoTotal = 0;
    for (const estoque of estoques) {
      if (restante <= 0.0001) break;
      if (estoque.qtdEstoque <= 0) continue;

      const deduzido = Math.min(estoque.qtdEstoque, restante);
      const novaQtd  = estoque.qtdEstoque - deduzido;
      await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
      await tx.movimentoEstoque.create({
        data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: deduzido, motivo: `Prescrição executada: ${desc}` },
      });

      // Abate a reserva deste grupo nesta entrada (na mesma proporção do débito)
      if (grupoId != null) {
        const reserva = await tx.reservaEstoque.findUnique({
          where: { prescricaoGrupoId_estoqueId: { prescricaoGrupoId: grupoId, estoqueId: estoque.id } },
        });
        if (reserva) {
          const novaReserva = reserva.quantidade - deduzido;
          if (novaReserva > 0.0001) {
            await tx.reservaEstoque.update({ where: { id: reserva.id }, data: { quantidade: novaReserva } });
          } else {
            await tx.reservaEstoque.delete({ where: { id: reserva.id } });
          }
        }
      }

      // Valor da dose = qtdDebitBase × preço unitário resolvido pela FORMA DE COBRANÇA
      // da clínica (R$/g ou R$/mL). Em VALOR_REPASSADO é o preço DAQUELE lote — o que
      // sempre foi; em PERCENTUAL, ele + o acréscimo; em MAIOR_VALOR/CUSTO_MEDIO, um
      // preço único tirado do estoque inteiro, e aí a fatura sai numa linha só.
      const qtdDebitBase = paraBase(deduzido, unidadeEstoque);
      const precoUnit    = formaCobranca.precoDeVenda(
        cfgCobranca, precoUnitarioDoEstoque(estoque, unidadeEstoque), entradas,
      );
      valorDaDose += qtdDebitBase * precoUnit;

      debitadoTotal += deduzido;
      restante -= deduzido;
    }

    // Unidade AVULSA e sem entrega por embalagem = a receita está escrita na MESMA
    // unidade do estoque, então o debitado É a contagem de unidades entregues. Em
    // mL/g (multidose) o mapa fica vazio e a linha continua valendo "1 dose".
    if (!entregaUnica && ehAvulsa(unidadeEstoque) && debitadoTotal > 0) {
      unidadesFaturadas.set(item.id, debitadoTotal);
    }

    precos.set(item.medicamentoCatId, valorDaDose);
  }
  return { precos, unidades, jaEntregues, porEmbalagem, entregas, unidadesFaturadas };
}

// ─── Insumos de aplicação injetável (seringa + agulha) ───────────────────────
// Vias que caracterizam uma aplicação injetável — IV/IM/ID/SC/EV.
const VIA_INJETAVEL_REGEX = /intramuscular|intraven|subcut|intraderm|endovenos/i;

function isViaInjetavel(via) {
  if (!via) return false;
  const v = String(via).trim().toLowerCase();
  // Abreviações injetáveis usadas no catálogo (IM, IV, EV, SC, ID) — o valor da via
  // costuma vir abreviado do cadastro do medicamento, não como nome completo.
  if (['im', 'iv', 'ev', 'sc', 'id'].includes(v)) return true;
  // Nomes completos (ex.: Intramuscular, Endovenosa, Subcutânea, Intradérmica).
  return VIA_INJETAVEL_REGEX.test(v);
}

// Localiza no estoque da empresa um item cujo nome do medicamento comece com
// `prefixoNome` (ex: 'Seringa', 'Agulha') e tenha saldo disponível. Sem
// cadastro/sem estoque → null (não bloqueia, apenas não é lançado).
async function buscarInsumoDisponivel(tx, prefixoNome, empresaId) {
  return tx.estoqueClinica.findFirst({
    where: {
      ativo:      true,
      qtdEstoque: { gt: 0 },
      ...(empresaId != null ? { empresaId } : {}),
      medicamento: { nome: { startsWith: prefixoNome, mode: 'insensitive' }, ativo: true },
    },
    include: { medicamento: { select: { id: true, nome: true } } },
    orderBy: { id: 'asc' },
  });
}

// Debita 1 unidade do insumo (seringa/agulha) e retorna { valor, nome } para lançar na
// fatura. Sem estoque disponível → retorna null silenciosamente (não bloqueia a execução).
async function debitarInsumoUnidade(tx, prefixoNome, empresaId, motivo) {
  const estoque = await buscarInsumoDisponivel(tx, prefixoNome, empresaId);
  if (!estoque) return null;

  const novaQtd = Math.max(estoque.qtdEstoque - 1, 0);
  await tx.estoqueClinica.update({ where: { id: estoque.id }, data: { qtdEstoque: novaQtd } });
  await tx.movimentoEstoque.create({
    data: { estoqueId: estoque.id, tipo: 'SAIDA', quantidade: 1, motivo },
  });

  // 🔴 O PREÇO DE **UMA** UNIDADE, nunca o da embalagem inteira. `precoUnitarioBase` é
  // gravado na entrada já dividido pelo conteúdo declarado (caixa de 100 seringas por
  // R$ 100 -> R$ 1,00 cada); `valorRepassado` é o valor da EMBALAGEM e só serve de
  // fallback para a entrada legada que não tem o preço calculado.
  const valor = estoque.precoUnitarioBase != null && estoque.precoUnitarioBase > 0
    ? estoque.precoUnitarioBase
    : (estoque.valorRepassado > 0 ? estoque.valorRepassado : (estoque.valor ?? 0));
  return { valor, nome: estoque.medicamento.nome };
}

// Verifica estoque para a quantidade que `resolverQtd(item)` determinar (por
// padrão, o dia inteiro) — retorna lista de alertas.
// MULTI-LOTE: soma a quantidade de TODAS as entradas do medicamento — uma
// entrada insuficiente não bloqueia se outra cobre o restante.
async function verificarEstoqueParaDia(itens, empresaId, resolverQtd = calcularQuantidadeDiaria) {
  const alertas = [];
  // O alerta tem de comparar na MESMA unidade da baixa: com a forma de cálculo
  // declarada, o estoque está em mL e a receita também. Comparar contra a unidade da
  // embalagem barraria a execução de uma prescrição que cabe.
  const formas = await mapaFormaCalculo(prisma, itens);
  const conteudos = await mapaConteudoEmbalagem(prisma, itens);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
    const estoques = await buscarEstoquesFEFO(prisma, item.medicamentoCatId, empresaId);
    if (estoques.length === 0) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque = unidadeDoEstoque(formas, item);
    const totalEstoque   = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
    // 🔴 A COMPARAÇÃO É NA UNIDADE DO ESTOQUE, e só nela (2026-09-17).
    // `qtdDiariaEstoque`/`qtdNaUnidadeEstoque` JÁ devolvem o necessário nessa unidade
    // (convertendo quando há grupo comum e contando embalagens quando o produto é
    // avulso). O par `paraBase` + `comparavel` que existia aqui repetia essa regra pela
    // metade: no ramo incomparável comparava a quantidade CRUA da receita ("20 mL")
    // com o saldo em embalagens (2) e acusava falta do que cabe.
    const necessarioEstoque = qtdDiariaEstoque(item, unidadeEstoque, resolverQtd, conteudoDoItem(conteudos, item));
    const insuficiente   = totalEstoque < necessarioEstoque;
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessarioEstoque,
        qtdDisponivel: totalEstoque,
      });
    }
  }
  return alertas;
}

// Verifica estoque real antes de executar — retorna lista de alertas.
// Compara em unidade base para evitar mismatch kg vs g.
async function verificarEstoqueParaExecucao(itens, empresaId) {
  const alertas = [];
  const formas = await mapaFormaCalculo(prisma, itens);
  const conteudos = await mapaConteudoEmbalagem(prisma, itens);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // Aplicado pelo proprietário em casa: a clínica não reserva nem debita estoque
    if (item.aplicadaPeloProprietario) continue;
    const estoque = await prisma.estoqueClinica.findFirst({
      where:   { medicamentoId: item.medicamentoCatId, ...(empresaId != null ? { empresaId } : {}), ativo: true },
      include: { medicamento: { select: { nome: true, unidade: true } } },
    });
    if (!estoque) continue; // medicamento não cadastrado no estoque da clínica — ignorar silenciosamente
    const unidadeEstoque  = unidadeDoEstoque(formas, item);
    // 🔴 A COMPARAÇÃO É NA UNIDADE DO ESTOQUE, e só nela (2026-09-17).
    // `qtdDiariaEstoque`/`qtdNaUnidadeEstoque` JÁ devolvem o necessário nessa unidade
    // (convertendo quando há grupo comum e contando embalagens quando o produto é
    // avulso). O par `paraBase` + `comparavel` que existia aqui repetia essa regra pela
    // metade: no ramo incomparável comparava a quantidade CRUA da receita ("20 mL")
    // com o saldo em embalagens (2) e acusava falta do que cabe.
    const necessarioEstoque = qtdNaUnidadeEstoque(item, unidadeEstoque, conteudoDoItem(conteudos, item));
    const insuficiente    = (estoque.qtdEstoque ?? 0) < necessarioEstoque;
    if (insuficiente) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessarioEstoque,
        qtdDisponivel: estoque.qtdEstoque ?? 0,
      });
    }
  }
  return alertas;
}

// Verifica disponibilidade antes de reservar — retorna lista de alertas.
// Compara em unidade base (g/mL) para suportar kg vs g, L vs mL, etc.
// MULTI-LOTE: agrega TODAS as entradas do medicamento (estoque, reservas de
// outras prescrições e disponível são somados entre os lotes).
// tipo 'INSUFICIENTE': disponível < necessário
// tipo 'ZERADO':       ficará zerado após esta reserva
async function verificarDisponibilidade(itens, grupoId, empresaId) {
  const alertas = [];
  const formas = await mapaFormaCalculo(prisma, itens);
  const conteudos = await mapaConteudoEmbalagem(prisma, itens);
  for (const item of itens) {
    if (item.tipo !== 'MEDICAMENTO' || !item.medicamentoCatId || item.medicamentoCliente) continue;
    // ⚠️ O item aplicado pelo proprietário ENTRA aqui desde 2026-09-18: ele não reserva
    // (não há execução futura a garantir), mas a clínica ENTREGA o medicamento na
    // finalização, e a embalagem sai do estoque naquele instante. Pulá-lo faria a
    // finalização debitar sem nunca avisar que o frasco não existe na prateleira.
    const estoques = await buscarEstoquesFEFO(prisma, item.medicamentoCatId, empresaId, grupoId);
    if (estoques.length === 0) continue;
    const unidadeEstoque = unidadeDoEstoque(formas, item);
    const qtdEstoqueTotal = estoques.reduce((s, e) => s + (e.qtdEstoque ?? 0), 0);
    const todasReservas   = estoques.flatMap(e => e.reservas ?? []);
    const qtdReservada    = todasReservas.reduce((s, r) => s + r.quantidade, 0); // em unidadeEstoque
    const disponivel      = qtdEstoqueTotal - qtdReservada;                      // em unidadeEstoque

    // 🔴 A COMPARAÇÃO É NA UNIDADE DO ESTOQUE, e só nela (2026-09-17).
    // `qtdDiariaEstoque`/`qtdNaUnidadeEstoque` JÁ devolvem o necessário nessa unidade
    // (convertendo quando há grupo comum e contando embalagens quando o produto é
    // avulso). O par `paraBase` + `comparavel` que existia aqui repetia essa regra pela
    // metade: no ramo incomparável comparava a quantidade CRUA da receita ("20 mL")
    // com o saldo em embalagens (2) e acusava falta do que cabe.
    const necessario = qtdNaUnidadeEstoque(item, unidadeEstoque, conteudoDoItem(conteudos, item)); // na unidade do estoque

    const reservasInfo = todasReservas.map(r => ({
      animalNome:       r.animal.nome,
      prescricaoNumero: String(r.prescricaoGrupo.numero).padStart(3, '0'),
      quantidade:       r.quantidade,
    }));

    const dispInsuf  = disponivel < necessario;
    const dispZerado = Math.abs(disponivel - necessario) < 0.001;

    if (dispInsuf) {
      alertas.push({
        tipo:          'INSUFICIENTE',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: Math.max(disponivel, 0),
        qtdEstoque:    qtdEstoqueTotal,
        qtdReservada,
        reservas:      reservasInfo,
      });
    } else if (necessario > 0 && dispZerado) {
      alertas.push({
        tipo:          'ZERADO',
        medicamento:   item.medicamento,
        unidade:       unidadeEstoque,
        qtdNecessaria: necessario,
        qtdDisponivel: disponivel,
        qtdEstoque:    qtdEstoqueTotal,
        qtdReservada,
        reservas:      reservasInfo,
      });
    }
  }
  return alertas;
}

// ─── Listar grupos por animal ─────────────────────────────────────────────────

// Colunas ordenáveis do histórico de prescrição (whitelist — lib/ordenacaoLista.js).
// `dataFim` é a do GRUPO: executadoEm quando houve execução, senão finalizadoEm — a
// mesma conta que a tela faz na coluna "Data Fim". Como são duas colunas, ordenar por
// ela usa a de execução e cai na de finalização no desempate.
const ORDENACAO_GRUPO = {
  numero:        opcional('numero'),
  dataInicio:    simples('createdAt'),
  dataFim:       (dir) => [{ executadoEm: { sort: dir, nulls: 'last' } }, { finalizadoEm: { sort: dir, nulls: 'last' } }],
  responsavel:   daRelacao('veterinario', 'fullName'),
  status:        simples('status'),
  justificativa: opcional('motivoCancelamento'),
};

const listarPorAnimal = async (req, res) => {
  try {
    const { animalId } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    // Transferência de Propriedade — o PROPRIETÁRIO atual só vê o que foi criado a
    // partir de `propriedadeDesde`; GESTOR/VET/ADMIN (corte null) veem tudo.
    const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
    const corte = corteDePropriedade(req, animalCorte);

    // Segregação multi-clínica: cada empresa vê só as próprias prescrições do animal
    const whereBase = { animalId: Number(animalId), AND: [escopoPrescricaoGrupoWhere(req)], ...(corte ? { createdAt: { gte: corte } } : {}) };
    const where = status ? { ...whereBase, status } : whereBase;

    const [grupos, total] = await Promise.all([
      prisma.prescricaoGrupo.findMany({
        where,
        include: GRUPO_INCLUDE,
        // Ordem natural: o mais recente primeiro. `?ordenarPor=` só troca isso
        // quando a coluna está na whitelist.
        orderBy: orderByDaQuery(req.query, ORDENACAO_GRUPO, { numero: 'desc' }),
        skip:    (Number(page) - 1) * Number(limit),
        take:    Number(limit),
      }),
      prisma.prescricaoGrupo.count({ where }),
    ]);

    // Contagem por status (sempre sobre TODOS os registros do animal, ignorando o
    // filtro atual) — alimenta as abas de filtro por status do histórico no front.
    const contagensRaw = await prisma.prescricaoGrupo.groupBy({
      by:     ['status'],
      where:  whereBase,
      _count: { _all: true },
    });
    const contagens = Object.fromEntries(contagensRaw.map((c) => [c.status, c._count._all]));
    const salvos = contagens.SALVO ?? 0;

    // `versao` acompanha TODA leitura: é ela que a tela devolve no próximo salvar.
    // Lista sem versão faz o formulário aberto a partir dela gravar sem proteção.
    return res.json({
      dados:   await anexarControle(prisma, 'PRESCRICAO_GRUPO', await anexarFlagEmGrupos(
        prisma,
        grupos.map((g) => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      )),
      total,
      salvos,
      contagens,
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarPorAnimal:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições.' });
  }
};

// ─── Obter grupo por ID ───────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: Number(req.params.id) },
      include: GRUPO_INCLUDE,
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    return res.json({
      dados: await anexarControle(prisma, 'PRESCRICAO_GRUPO',
        await anexarFlagEmGrupos(prisma, { ...grupo, numeroFormatado: formatNumero(grupo.numero) })),
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar prescrição.' });
  }
};

// ─── Criar grupo(s) com itens ─────────────────────────────────────────────────
// Medicamento comum e PROCEDIMENTO saem JUNTOS, numa única prescrição — o
// atendimento é um só e separá-los obrigava o profissional a lidar com dois
// documentos para a mesma conduta (alterado em 2026-07-30, a pedido).
//
// O CONTROLADO continua em prescrição PRÓPRIA, e isso NÃO é preferência de UI: o
// receituário de controle especial é um documento legalmente distinto (Portaria
// SVS/MS 344/98), com numeração e retenção próprias. Misturá-lo com item comum
// produziria um receituário inválido para dispensação.
//   CONTROLADO → medicamento com Medicamento.controlado = true
//   GERAL      → medicamento comum (controlado = false / sem catálogo) + PROCEDIMENTO
// Com itens de uma só categoria, cria uma única prescrição.
// Retorna SEMPRE um array em `dados` (1 ou mais grupos), ordenado por número.

const ORDEM_CATEGORIAS = ['CONTROLADO', 'GERAL'];

/**
 * A coluna `aplicada_pelo_proprietario` já existe no banco?
 *
 * ⚠️ ESTE GUARD NÃO É OPCIONAL. SQL cru para uma coluna inexistente DENTRO de uma
 * transaction aborta a TRANSACTION INTEIRA no Postgres — os comandos seguintes
 * morrem com 25P02 ("current transaction is aborted"), e o `try/catch` em JS não
 * desfaz isso: quem estoura é o comando SEGUINTE, longe do culpado. Foi assim que
 * o Salvar da prescrição quebrou em `catalogoManual.js`, que não tem nada a ver.
 *
 * Consultado uma vez por processo. O `false` expira em 60s para que rodar a
 * migration com o backend no ar volte a funcionar sem restart.
 */
let _temColunaProp = null;
let _temColunaPropEm = 0;
async function temColunaProprietario() {
  if (_temColunaProp === true) return true;
  if (_temColunaProp === false && Date.now() - _temColunaPropEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_prescricoes'
          AND column_name = 'aplicada_pelo_proprietario' LIMIT 1`,
    );
    _temColunaProp = rows.length > 0;
  } catch { _temColunaProp = false; }
  _temColunaPropEm = Date.now();
  return _temColunaProp;
}

/**
 * Anexa `aplicadaPeloProprietario` a ITENS já carregados (aceita item, lista de
 * itens, ou lista de GRUPOS — neste caso percorre `grupo.itens`).
 *
 * Lido por SQL cru porque o client Prisma pode não conhecer a coluna ainda (no
 * Windows o `prisma generate` falha com o backend rodando) — mesmo padrão do
 * `isConvidado`/`cadastroConfirmadoEm`. Sem a coluna, devolve false.
 *
 * Toda leitura que decida EXECUÇÃO, FATURA ou ESTOQUE precisa passar por aqui:
 * sem a flag, o item aplicado em casa volta a ser cobrado e a debitar estoque.
 *
 * `client` é sempre o cliente FORA da transaction (ver `temColunaProprietario`):
 * a flag não é alterada pelas transactions que a leem, então ler por fora é seguro
 * e não arrisca abortá-las.
 */
async function anexarAplicadaProprietario(client, itens) {
  const lista = Array.isArray(itens) ? itens : [itens];
  const ids = lista.map(i => i?.id).filter(Number.isInteger);
  if (ids.length === 0) return itens;
  let marcados = new Set();
  if (!(await temColunaProprietario())) {
    const semFlag = (i) => ({ ...i, aplicadaPeloProprietario: false });
    return Array.isArray(itens) ? itens.map(semFlag) : semFlag(itens);
  }
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id FROM schs2vet.tb_prescricoes
        WHERE aplicada_pelo_proprietario = true AND id IN (${ph})`,
      ...ids,
    );
    marcados = new Set(rows.map(r => r.id));
  } catch { /* coluna ainda não migrada */ }
  const aplicar = (i) => ({ ...i, aplicadaPeloProprietario: marcados.has(i.id) });
  return Array.isArray(itens) ? itens.map(aplicar) : aplicar(itens);
}

/**
 * As DUAS colunas do item que o client Prisma pode não conhecer, numa passada:
 * `aplicadaPeloProprietario` e `prestadorId`/`prestadorNome`.
 *
 * ⚠️ Existe para não haver dois lugares decidindo o que o item "tem": quem esquecer
 * de anexar o prestador faz o procedimento do prestador externo ser cobrado pelo
 * valor padrão da empresa e não gerar linha no recibo — em silêncio.
 */
async function anexarCamposDoItem(client, itens) {
  return vinculoPrestador.anexarPrestador(client, await anexarAplicadaProprietario(client, itens));
}

/** Mesma coisa, para grupos já carregados com `itens`. */
async function anexarFlagEmGrupos(client, grupos) {
  const lista = Array.isArray(grupos) ? grupos : [grupos];
  const todos = lista.flatMap(g => g?.itens ?? []);
  const comFlag = await anexarCamposDoItem(client, todos);
  const porId = new Map(comFlag.map(i => [i.id, i]));
  const aplicar = (g) => ({ ...g, itens: (g.itens ?? []).map(i => porId.get(i.id) ?? i) });
  return Array.isArray(grupos) ? lista.map(aplicar) : aplicar(grupos);
}

/**
 * Grava a coluna do item por SQL cru (o client pode não conhecê-la). `undefined`
 * não toca no valor — mantém a semântica de PATCH parcial do `atualizarItem`.
 */
async function gravarAplicadaProprietario(client, itemId, valor) {
  if (valor === undefined) return;
  if (!(await temColunaProprietario())) return;
  try {
    await client.$executeRawUnsafe(
      'UPDATE schs2vet.tb_prescricoes SET aplicada_pelo_proprietario = $1 WHERE id = $2',
      valor === true,
      itemId,
    );
  } catch { /* coluna ainda não migrada */ }
}

// Categoria de um item cru (do body). `controladoDe` resolve o flag do catálogo.
// FONTE ÚNICA da regra de agrupamento — criação e edição usam esta função.
function categoriaPara({ tipo, medicamentoCatId }, controladoDe) {
  if ((tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO') return 'GERAL';
  return controladoDe(medicamentoCatId) ? 'CONTROLADO' : 'GERAL';
}

/**
 * Resolve o `medicamentoCatId` de um item digitado à mão (sem id de catálogo).
 * FONTE ÚNICA do fallback de `lib/catalogoManual.js` — usada por `criar`,
 * `adicionarItem` e `atualizarItem`, que são os três pontos onde um item de
 * prescrição nasce ou muda de nome. Sem isto, incluir/editar um item numa
 * prescrição já SALVA (os dois últimos) silenciosamente perdia o item no limbo:
 * salvava com `medicamentoCatId: null` e nunca virava um item reutilizável do
 * catálogo da empresa — só `criar` (a primeira gravação) tinha o fallback.
 *
 * MEDICAMENTO ganha o id retornado (é FK real na prescrição). PROCEDIMENTO não
 * tem essa coluna — é guardado só pelo nome — mas a chamada ainda GARANTE a
 * entrada no catálogo da empresa, para reaparecer em buscas futuras (Orçamento,
 * outra prescrição). Sem nome nenhum, não faz nada e devolve o id já recebido.
 *
 * @param {object} tx        transaction em curso
 * @param {object} item      { tipo, medicamento, medicamentoCatId, unidade }
 * @param {number|null} empresaId
 * @param {{ especieId?: number|null, especie?: { nome?: string|null } }|null} animal
 * @returns {Promise<number|null>}
 */
async function resolverCatalogoDoItem(tx, { tipo, medicamento, medicamentoCatId, unidade }, empresaId, animal) {
  const catId = medicamentoCatId ? Number(medicamentoCatId) : null;
  const nome  = String(medicamento ?? '').trim();
  if (catId || !nome) return catId;

  if ((tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO') {
    await garantirProcedimentoDaEmpresa(tx, {
      nome, especieNome: animal?.especie?.nome ?? null,
    }, empresaId);
    return null; // procedimento não tem FK — segue guardado só pelo nome
  }
  return garantirMedicamentoDaEmpresa(tx, {
    nome, unidade, especieIds: animal?.especieId ? [animal.especieId] : [],
  }, empresaId);
}

const criar = async (req, res) => {
  try {
    const { animalId, empresaId, evolucaoId, itens = [] } = req.body;
    const veterinarioId = req.user.id;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório.' });
    if (await animalFoiExcluido(animalId)) {
      return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
    }
    if (await animalEstaInativo(animalId)) {
      return res.status(400).json({ error: MSG_PACIENTE_INATIVO, code: 'PACIENTE_INATIVO' });
    }
    if (!evolucaoId) return res.status(400).json({ error: 'evolucaoId é obrigatório.', code: 'EVOLUCAO_REQUIRED' });
    if (!Array.isArray(itens) || itens.length === 0)
      return res.status(400).json({ error: 'Inclua ao menos um item na prescrição.' });

    // Medicamento sem dosagem não pode ser prescrito (o item importado do orçamento
    // chega sem dosagem — a regra vale para qualquer origem).
    const semDosagem = itens.find(
      i => (i.tipo ?? 'MEDICAMENTO') === 'MEDICAMENTO' && !String(i.dosagem ?? '').trim(),
    );
    if (semDosagem) {
      return res.status(400).json({
        error: `Informe a dosagem de "${semDosagem.medicamento ?? 'medicamento'}".`,
        code:  'DOSAGEM_OBRIGATORIA',
      });
    }

    // 🔴 Hora Início NÃO é obrigatória em frequência nenhuma (2026-08-23). A
    // grade das doses é definida pela PRIMEIRA EXECUÇÃO, não pelo formulário —
    // ver lib/agendaDoses.js#elegivelParaFluxoNovo. NÃO reintroduzir a validação
    // `HORA_INICIO_OBRIGATORIA` que existia aqui: sem hora o item continua no
    // rolling schedule, apenas sem horário previsto até a 1ª dose ser dada.

    // Valida que a evolução existe e pertence ao animal
    const evolucao = await prisma.evolucaoClinica.findFirst({
      where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
      select: { id: true, veterinarioId: true },
    });
    if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal.', code: 'EVOLUCAO_NOT_FOUND' });

    // Autoria: prescrever dentro do atendimento de outro profissional é operar um
    // documento que não é seu — mesma regra de adicionarItem/atualizarItem/etc.,
    // só que aqui é ANTES do registro existir (nenhum `podeOperarRegistro` protegia
    // o `criar`). Quem não conduz a evolução (não criou nem assumiu) só prescreve
    // depois de assumi-la — nunca "por tabela", só porque tem acesso ao animal.
    if (!podeOperarRegistro(req, evolucao.veterinarioId)) {
      return res.status(403).json({ error: 'Só é possível prescrever dentro de uma evolução sua. Assuma o atendimento antes de prescrever.' });
    }

    // Resolve o flag `controlado` de cada medicamento do catálogo (1 query)
    const catIds = [...new Set(
      itens
        .filter(i => (i.tipo ?? 'MEDICAMENTO') === 'MEDICAMENTO' && i.medicamentoCatId)
        .map(i => Number(i.medicamentoCatId)),
    )];
    const controladoPorId = new Map();
    if (catIds.length > 0) {
      const meds = await prisma.medicamento.findMany({
        where:  { id: { in: catIds } },
        select: { id: true, controlado: true },
      });
      for (const m of meds) controladoPorId.set(m.id, m.controlado);
    }

    const ehControlado = (catId) =>
      !!catId && controladoPorId.get(Number(catId)) === true;

    // Agrupa preservando a ordem original dentro de cada categoria
    const buckets = { CONTROLADO: [], GERAL: [] };
    for (const item of itens) buckets[categoriaPara(item, ehControlado)].push(item);
    const categoriasComItens = ORDEM_CATEGORIAS.filter(c => buckets[c].length > 0);

    // Espécie do animal atendido — usada para cadastrar no catálogo da empresa o item
    // que o vet digitou à mão (sem ela, o novo item não voltaria nas buscas).
    const animalDaPrescricao = await prisma.animal.findUnique({
      where:  { id: Number(animalId) },
      select: { especieId: true, especie: { select: { nome: true } } },
    });
    const empresaDoGrupo = empresaId ? Number(empresaId) : (req.empresaId ?? null);

    const gruposCriados = await prisma.$transaction(async (tx) => {
      let numero = await proximoNumero(tx, Number(animalId));
      const idsCriados = [];
      const cacheCatalogo = new Map(); // não recadastra o mesmo nome duas vezes

      for (const categoria of categoriasComItens) {
        const grp = await tx.prescricaoGrupo.create({
          data: {
            numero,
            animalId:     Number(animalId),
            veterinarioId,
            evolucaoId:   Number(evolucaoId),
            empresaId:    empresaId ? Number(empresaId) : (req.empresaId ?? null),
            status:       'SALVO',
          },
        });
        for (const item of buckets[categoria]) {
          // Item fora do catálogo (digitado à mão) → cadastra para a EMPRESA e, no
          // caso de medicamento, já vincula a prescrição ao registro criado.
          let medicamentoCatId = item.medicamentoCatId ? Number(item.medicamentoCatId) : null;
          const tipoItem = item.tipo ?? 'MEDICAMENTO';
          const nomeItem = String(item.medicamento ?? '').trim();
          const chaveCatalogo = `${tipoItem}|${nomeItem.toLowerCase()}`;
          if (!medicamentoCatId && nomeItem) {
            if (!cacheCatalogo.has(chaveCatalogo)) {
              cacheCatalogo.set(chaveCatalogo,
                await resolverCatalogoDoItem(tx, item, empresaDoGrupo, animalDaPrescricao));
            }
            medicamentoCatId = cacheCatalogo.get(chaveCatalogo);
          }

          const dadosItem = {
            animalId:           Number(animalId),
            veterinarioId,
            grupoId:            grp.id,
            medicamentoCatId,
            tipo:               item.tipo             ?? 'MEDICAMENTO',
            medicamento:        String(item.medicamento ?? ''),
            dosagem:            item.dosagem           ?? null,
            unidade:            item.unidade           ?? null,
            via:                item.via               ?? 'Oral',
            frequencia:         item.frequencia        ?? '',
            duracaoDias:        Number(item.duracaoDias ?? 1),
            horaInicio:         item.horaInicio        ?? null,
            observacao:         item.observacao        ?? null,
            dataInicio:         item.dataInicio ? new Date(item.dataInicio) : new Date(),
            status:             'RASCUNHO',
            medicamentoCliente: item.medicamentoCliente === true,
            // Importado do orçamento: guarda o valor UNITÁRIO aceito pelo cliente —
            // é ele que vai para a fatura, e não o preço do catálogo/estoque.
            orcamentoItemId:    item.orcamentoItemId ? Number(item.orcamentoItemId) : null,
            valorOrcado:        item.valorOrcado != null && item.valorOrcado !== ''
              ? Number(item.valorOrcado)
              : null,
          };
          // Âncora do rolling schedule — só quando o item JÁ tem horário (Hora
          // Início preenchida). Sem ela a âncora nasce na 1ª execução, então
          // `proximaDoseEm` fica null até lá (ver lib/agendaDoses.js).
          if (elegivelParaFluxoNovo(dadosItem) && !semAncoraDeHorario(dadosItem)) {
            dadosItem.proximaDoseEm = primeiraDoseEsperada(dadosItem);
          }
          const criado = await tx.prescricao.create({ data: dadosItem });
          // Colunas novas gravadas por SQL cru — o client Prisma pode não tê-las ainda
          // (no Windows o `generate` falha com o backend rodando).
          await gravarAplicadaProprietario(tx, criado.id, item.aplicadaPeloProprietario === true);
          // PRESTADOR que executa este PROCEDIMENTO. `gravarPrestadorDoItem` ignora
          // item de MEDICAMENTO por construção: remédio não tem prestador, e aceitar
          // o campo ali criaria linha de recibo por dose de medicamento.
          await vinculoPrestador.gravarPrestadorDoItem(tx, criado.id, item.prestadorId ?? null, tipoItem);
        }

        idsCriados.push(grp.id);
        numero += 1;
      }

      return tx.prescricaoGrupo.findMany({
        where:   { id: { in: idsCriados } },
        include: GRUPO_INCLUDE,
        orderBy: { numero: 'asc' },
      });
    });

    return res.status(201).json({
      dados: await anexarFlagEmGrupos(
        prisma,
        gruposCriados.map(g => ({ ...g, numeroFormatado: formatNumero(g.numero) })),
      ),
    });
  } catch (err) {
    console.error('PrescricaoGrupoController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar prescrição.' });
  }
};

// ─── Helpers de categoria (split por tipo também na edição) ───────────────────

// Categoria homogênea de uma lista de itens (cada item com medicamentoCat.controlado
// carregado): null = vazio | 'MISTO' = categorias diferentes | senão a categoria única.
// Usa a MESMA regra da criação (`categoriaPara`): medicamento comum e procedimento
// convivem em GERAL; só o CONTROLADO se separa. Sem isso, editar uma prescrição
// mista criada agora a estilhaçaria de novo em dois documentos.
function categoriaDeItens(itens) {
  const cats = new Set(itens.map(i =>
    categoriaPara(i, () => !!i.medicamentoCat?.controlado),
  ));
  if (cats.size === 0) return null;
  if (cats.size === 1) return [...cats][0];
  return 'MISTO';
}

// Categoria de um item a partir do body/estado (consulta o flag controlado quando med).
async function categoriaDoItem(client, { tipo, medicamentoCatId }) {
  if ((tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO') return 'GERAL';
  if (!medicamentoCatId) return 'GERAL';
  const med = await client.medicamento.findUnique({
    where:  { id: Number(medicamentoCatId) },
    select: { controlado: true },
  });
  return med?.controlado ? 'CONTROLADO' : 'GERAL';
}

// Encontra um grupo SALVO irmão (mesma evolução/animal) da categoria alvo, ou cria
// um novo. Retorna { id, numero, novo }. Usado ao editar uma prescrição e inserir/
// alterar um item de categoria diferente — mantém cada prescrição homogênea.
async function resolverGrupoDestino(tx, { animalId, evolucaoId, empresaId, veterinarioId, excluirGrupoId, categoriaAlvo }) {
  const irmaos = await tx.prescricaoGrupo.findMany({
    where: { animalId, evolucaoId, status: 'SALVO', id: { not: excluirGrupoId } },
    include: { itens: { where: { ativo: true }, include: { medicamentoCat: { select: { controlado: true } } } } },
  });
  const irmao = irmaos.find(g => categoriaDeItens(g.itens) === categoriaAlvo);
  if (irmao) return { id: irmao.id, numero: irmao.numero, novo: false };

  const numero = await proximoNumero(tx, animalId);
  const novo = await tx.prescricaoGrupo.create({
    data: { numero, animalId, veterinarioId, evolucaoId, empresaId: empresaId ?? null, status: 'SALVO' },
  });
  return { id: novo.id, numero: novo.numero, novo: true };
}

// ─── Adicionar item ao grupo ──────────────────────────────────────────────────

const adicionarItem = async (req, res) => {
  try {
    const grupoId      = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true }, include: { medicamentoCat: { select: { controlado: true } } } } },
    });
    if (!grupo)               return res.status(404).json({ error: 'Prescrição não encontrada.' });
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível adicionar itens em prescrições com status SALVO.' });

    // Autoria: incluir item na prescrição de outro é alterar o documento clínico dele.
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar prescrições criadas por você.' });
    }
    if (await animalFoiExcluido(grupo.animalId)) {
      return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
    }
    if (await animalEstaInativo(grupo.animalId)) {
      return res.status(400).json({ error: MSG_PACIENTE_INATIVO, code: 'PACIENTE_INATIVO' });
    }

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente, aplicadaPeloProprietario, prestadorId } = req.body;

    if (!medicamento) return res.status(400).json({ error: 'Campo medicamento é obrigatório.' });
    // Hora Início opcional — ver a nota em `finalizar`.

    // Split na edição: se o item é de categoria diferente de um grupo homogêneo,
    // vai para uma prescrição irmã (ou nova) da categoria correta.
    const catItem  = await categoriaDoItem(prisma, { tipo, medicamentoCatId });
    const catGrupo = categoriaDeItens(grupo.itens);

    const versaoCliente = versaoDoBody(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      // Incluir item MUDA O DOCUMENTO: se outro profissional mexeu nele desde que
      // esta tela carregou, a inclusão é recusada com 409 em vez de entrar num
      // conjunto que já não é o que a pessoa está vendo.
      await reservarVersao(tx, 'PRESCRICAO_GRUPO', grupoId, versaoCliente);

      let destinoId   = grupoId;
      let destinoInfo = null;
      if (catGrupo && catGrupo !== 'MISTO' && catGrupo !== catItem) {
        destinoInfo = await resolverGrupoDestino(tx, {
          animalId:       grupo.animalId,
          evolucaoId:     grupo.evolucaoId,
          empresaId:      grupo.empresaId,
          veterinarioId,
          excluirGrupoId: grupoId,
          categoriaAlvo:  catItem,
        });
        destinoId = destinoInfo.id;
      }

      // Item fora do catálogo (digitado à mão) → mesmo fallback do `criar`: cadastra
      // (ou reaproveita) a entrada PRIVADA da empresa. Sem isto, incluir um item novo
      // numa prescrição já SALVA nunca o deixava reutilizável nem rastreável.
      const animalDoItem = await tx.animal.findUnique({
        where:  { id: grupo.animalId },
        select: { especieId: true, especie: { select: { nome: true } } },
      });
      const medicamentoCatIdFinal = await resolverCatalogoDoItem(
        tx, { tipo, medicamento, medicamentoCatId, unidade }, grupo.empresaId, animalDoItem);

      const dadosNovoItem = {
        animalId:          grupo.animalId,
        veterinarioId,
        grupoId:           destinoId,
        medicamentoCatId:  medicamentoCatIdFinal,
        tipo:              tipo              ?? 'MEDICAMENTO',
        medicamento:       String(medicamento),
        dosagem:           dosagem           ?? null,
        unidade:           unidade           ?? null,
        via:               via               ?? 'Oral',
        frequencia:        frequencia        ?? '',
        duracaoDias:       Number(duracaoDias ?? 1),
        horaInicio:        horaInicio        ?? null,
        observacao:        observacao        ?? null,
        dataInicio:        dataInicio ? new Date(dataInicio) : new Date(),
        status:            'RASCUNHO',
        medicamentoCliente: medicamentoCliente === true,
      };
      if (elegivelParaFluxoNovo(dadosNovoItem) && !semAncoraDeHorario(dadosNovoItem)) {
        dadosNovoItem.proximaDoseEm = primeiraDoseEsperada(dadosNovoItem);
      }
      const novoItem = await tx.prescricao.create({
        data: dadosNovoItem,
        include: {
          veterinario:    { select: { id: true, fullName: true } },
          medicamentoCat: { select: { id: true, nome: true } },
        },
      });

      await gravarAplicadaProprietario(tx, novoItem.id, aplicadaPeloProprietario === true);
      await vinculoPrestador.gravarPrestadorDoItem(tx, novoItem.id, prestadorId ?? null, tipo ?? 'MEDICAMENTO');

      // Responsável passa a ser quem adicionou (no grupo de destino)
      await tx.prescricaoGrupo.update({ where: { id: destinoId }, data: { veterinarioId } });
      return { item: novoItem, destinoInfo };
    });

    return res.status(201).json({
      dados:        await anexarAplicadaProprietario(prisma, resultado.item),
      grupoDestino: resultado.destinoInfo
        ? { id: resultado.destinoInfo.id, numeroFormatado: formatNumero(resultado.destinoInfo.numero), novo: resultado.destinoInfo.novo }
        : null,
    });
  } catch (err) {
    if (err instanceof ConflitoEdicaoError) {
      const editor = await descreverEditor(prisma, err.editorId).catch(() => null);
      return responderConflito(res, Object.assign(err, { editor }));
    }
    console.error('PrescricaoGrupoController.adicionarItem:', err);
    return res.status(500).json({ error: 'Erro ao adicionar item.' });
  }
};

// ─── Atualizar item ───────────────────────────────────────────────────────────

const atualizarItem = async (req, res) => {
  try {
    const itemId       = Number(req.params.itemId);
    const veterinarioId = req.user.id;

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)       return res.status(404).json({ error: 'Item não encontrado.' });
    if (!item.ativo) return res.status(400).json({ error: 'Item já foi removido.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // alterada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, item.grupo?.animalId ?? item.animalId)) return;

    // Autoria: o dono do DOCUMENTO manda no item. Sem isto, qualquer profissional com
    // "alterar prescrição" reescrevia a posologia prescrita por outro — e o antigo
    // `data.veterinarioId = <quem editou>` ainda fazia o documento mudar de dono calado.
    if (!podeOperarRegistro(req, item.grupo?.veterinarioId ?? item.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar prescrições criadas por você.' });
    }

    // Regra: prescrição que já teve QUALQUER execução não pode ser alterada.
    const execucoesNoGrupo = await prisma.prescricao.count({
      where: { grupoId: item.grupoId, executadoEm: { not: null } },
    });
    if (execucoesNoGrupo > 0 || item.grupo?.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser alterada.', code: 'EXECUTADO' });
    }

    const { tipo, medicamento, medicamentoCatId, dosagem, unidade, via, frequencia, duracaoDias, horaInicio, observacao, dataInicio, medicamentoCliente, aplicadaPeloProprietario, prestadorId } = req.body;

    const data = {};
    if (tipo               !== undefined) data.tipo              = tipo;
    if (medicamento        !== undefined) data.medicamento       = String(medicamento);
    if (dosagem            !== undefined) data.dosagem           = dosagem;
    if (unidade            !== undefined) data.unidade           = unidade;
    if (via                !== undefined) data.via               = via;
    if (frequencia         !== undefined) data.frequencia        = frequencia;
    if (duracaoDias        !== undefined) data.duracaoDias       = Number(duracaoDias);
    if (horaInicio         !== undefined) data.horaInicio        = horaInicio;
    if (observacao         !== undefined) data.observacao        = observacao;
    if (dataInicio         !== undefined) data.dataInicio        = new Date(dataInicio);
    if (medicamentoCliente !== undefined) data.medicamentoCliente = medicamentoCliente === true;

    // Recalcula a âncora do rolling schedule quando um campo que a afeta muda —
    // só é alcançável aqui porque o item ainda não teve NENHUMA execução (guard
    // acima), então `dosesExecutadas` é sempre 0 e a "próxima dose" é sempre a 1ª.
    if (horaInicio !== undefined || dataInicio !== undefined || frequencia !== undefined) {
      const itemFinal = {
        horaInicio: data.horaInicio !== undefined ? data.horaInicio : item.horaInicio,
        dataInicio: data.dataInicio ?? item.dataInicio,
        frequencia: data.frequencia !== undefined ? data.frequencia : item.frequencia,
      };
      // Hora Início opcional — ver a nota em `finalizar`. Sem hora (e sem dose
      // dada, garantido pelo guard acima) o item não tem horário previsto ainda:
      // grava `null` em vez da meia-noite, que seria lida como "atrasado".
      data.proximaDoseEm = elegivelParaFluxoNovo(itemFinal) && !semAncoraDeHorario(itemFinal)
        ? primeiraDoseEsperada(itemFinal)
        : null;
    }
    // Editar NÃO transfere a autoria (2026-08-04): quem chegou até aqui é o próprio dono
    // ou o gestor, e um ajuste feito pelo gestor não pode tirar do veterinário a
    // prescrição que ele conduz. A troca de dono tem caminho próprio (assumir/transferir).
    const donoDoDocumento = item.grupo?.veterinarioId ?? item.veterinarioId ?? veterinarioId;
    data.veterinarioId = donoDoDocumento;

    // Split na edição: se a alteração muda a categoria do item e o grupo tem OUTROS
    // itens de categoria diferente (ficaria misto), move o item para uma prescrição
    // irmã (ou nova) da categoria correta. Sem outros itens (ou já misto/legado) →
    // altera no lugar (o grupo só acompanha a nova categoria).
    const tipoFinal  = tipo             !== undefined ? tipo             : item.tipo;
    const catIdFinal = medicamentoCatId !== undefined ? medicamentoCatId : item.medicamentoCatId;
    const catItem    = await categoriaDoItem(prisma, { tipo: tipoFinal, medicamentoCatId: catIdFinal });

    const outros = await prisma.prescricao.findMany({
      where:   { grupoId: item.grupoId, ativo: true, id: { not: itemId } },
      include: { medicamentoCat: { select: { controlado: true } } },
    });
    const catOutros    = categoriaDeItens(outros);
    const precisaRotear = outros.length > 0 && catOutros !== 'MISTO' && catOutros !== catItem;

    const versaoCliente = versaoDoBody(req.body);

    const resultado = await prisma.$transaction(async (tx) => {
      // 🔴 PRIMEIRO PASSO. A versão é do DOCUMENTO: se outro profissional mexeu na
      // prescrição (qualquer item, ou o próprio conjunto) entre a leitura desta tela
      // e este clique, nada casa e o erro sobe como 409 — a transação inteira
      // reverte e o trabalho dele não é sobrescrito.
      await reservarVersao(tx, 'PRESCRICAO_GRUPO', item.grupoId, versaoCliente);

      let destinoInfo = null;
      if (precisaRotear) {
        destinoInfo = await resolverGrupoDestino(tx, {
          animalId:       item.animalId,
          evolucaoId:     item.grupo.evolucaoId,
          empresaId:      item.grupo.empresaId,
          veterinarioId,
          excluirGrupoId: item.grupoId,
          categoriaAlvo:  catItem,
        });
        data.grupoId = destinoInfo.id;
        await tx.prescricaoGrupo.update({ where: { id: destinoInfo.id }, data: { veterinarioId: donoDoDocumento } });
      }

      // Item fora do catálogo (digitado à mão) → mesmo fallback do `criar`/
      // `adicionarItem`. Só entra quando o nome ou o id do catálogo estão sendo
      // tocados por esta edição — sem isto, trocar SÓ a dosagem de um item ligado
      // ao catálogo faria uma consulta e uma resolução desnecessárias.
      if (medicamento !== undefined || medicamentoCatId !== undefined) {
        const animalDoItem = await tx.animal.findUnique({
          where:  { id: item.animalId },
          select: { especieId: true, especie: { select: { nome: true } } },
        });
        data.medicamentoCatId = await resolverCatalogoDoItem(
          tx,
          {
            tipo:             tipoFinal,
            medicamento:      medicamento !== undefined ? medicamento : item.medicamento,
            medicamentoCatId,
            unidade:          data.unidade !== undefined ? data.unidade : item.unidade,
          },
          item.grupo?.empresaId ?? null,
          animalDoItem,
        );
      }

      const updated = await tx.prescricao.update({
        where: { id: itemId },
        data,
        include: {
          veterinario:    { select: { id: true, fullName: true } },
          medicamentoCat: { select: { id: true, nome: true } },
        },
      });

      await gravarAplicadaProprietario(tx, itemId, aplicadaPeloProprietario);
      // `undefined` não toca no gravado (PATCH parcial); `null` desvincula. O tipo vem
      // do item ATUALIZADO — trocar procedimento→medicamento tem de limpar o prestador,
      // senão o remédio herdaria o prestador do procedimento anterior.
      await vinculoPrestador.gravarPrestadorDoItem(tx, itemId, prestadorId, updated.tipo);

      // 🔴 A RESERVA DE ESTOQUE ACOMPANHA A EDIÇÃO. Grupo FINALIZADO reservou pela
      // quantidade ANTIGA no `finalizar`; sem refazer, dobrar a duração de 5 para
      // 10 dias mantinha a reserva de 5, e trocar o medicamento deixava a reserva
      // do anterior ÓRFÃ segurando estoque que ninguém mais vai consumir.
      // Seguro aqui porque o guard `EXECUTADO` acima garante ZERO doses dadas.
      await recalcularReservasDoGrupo(tx, item.grupo);
      // Item ROTEADO para outra prescrição: a origem perdeu um item e o destino
      // ganhou. O destino nasce/é escolhido em SALVO (`resolverGrupoDestino`), então
      // o helper sai cedo nele — a chamada fica pelo dia em que isso mudar.
      if (destinoInfo) {
        const grupoDestino = await tx.prescricaoGrupo.findUnique({ where: { id: destinoInfo.id } });
        await recalcularReservasDoGrupo(tx, grupoDestino);
      }

      // O grupo de origem MANTÉM o responsável (ver comentário em `donoDoDocumento`);
      // só assume um quando estava órfão.
      if (item.grupo?.veterinarioId == null) {
        await tx.prescricaoGrupo.update({ where: { id: item.grupoId }, data: { veterinarioId: donoDoDocumento } });
      }

      await registrarAlteracao(tx, req, {
        entidade: 'PRESCRICAO', entidadeId: item.grupoId, animalId: item.animalId,
        donoAtualId: donoDoDocumento,
        campos: {
          [`item.medicamento`]: { de: item.medicamento, para: updated.medicamento },
          [`item.dosagem`]:     { de: item.dosagem,     para: updated.dosagem },
          [`item.unidade`]:     { de: item.unidade,     para: updated.unidade },
          [`item.via`]:         { de: item.via,         para: updated.via },
          [`item.frequencia`]:  { de: item.frequencia,  para: updated.frequencia },
          [`item.duracaoDias`]: { de: item.duracaoDias, para: updated.duracaoDias },
          [`item.horaInicio`]:  { de: item.horaInicio,  para: updated.horaInicio },
          [`item.observacao`]:  { de: resumoTexto(item.observacao), para: resumoTexto(updated.observacao) },
        },
      });

      return { updated, destinoInfo };
    });

    return res.json({
      dados:        await anexarAplicadaProprietario(prisma, resultado.updated),
      grupoDestino: resultado.destinoInfo
        ? { id: resultado.destinoInfo.id, numeroFormatado: formatNumero(resultado.destinoInfo.numero), novo: resultado.destinoInfo.novo }
        : null,
    });
  } catch (err) {
    if (err instanceof ConflitoEdicaoError) {
      const editor = await descreverEditor(prisma, err.editorId).catch(() => null);
      return responderConflito(res, Object.assign(err, { editor }));
    }
    console.error('PrescricaoGrupoController.atualizarItem:', err);
    return res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
};

// ─── Remover item (soft delete) ───────────────────────────────────────────────

const removerItem = async (req, res) => {
  try {
    const itemId     = Number(req.params.itemId);
    const { motivo } = req.body ?? {};

    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item)             return res.status(404).json({ error: 'Item não encontrado.' });
    if (!item.ativo)       return res.status(400).json({ error: 'Item já foi removido.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // cancelada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, item.grupo?.animalId ?? item.animalId)) return;

    // Autoria: cancelar item da prescrição de outro é ato do dono — ou do gestor.
    if (!podeOperarRegistro(req, item.grupo?.veterinarioId ?? item.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }

    // Grupo TOTALMENTE executado não tem dose futura a cancelar.
    if (item.grupo?.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já totalmente executada não pode ser cancelada.', code: 'EXECUTADO' });
    }

    // Cancelamento POR ITEM: cancela as doses que ainda FALTAM deste item e PRESERVA o
    // que já foi aplicado DELE (fatura + estoque) — os DEMAIS itens da prescrição
    // seguem normalmente. Antes, qualquer execução no grupo bloqueava a operação
    // ("já executada não pode ser excluída"), travando justamente o item em execução.
    // Como `executar` só carrega itens `ativo: true`, desativar o item aqui já impede
    // que as doses restantes dele voltem a ser executadas.
    const itemComExecucao  = item.executadoEm != null;
    const grupoJaFinalizado = item.grupo?.status !== 'SALVO';

    const versaoCliente = versaoDoBody(req.body);

    await prisma.$transaction(async (tx) => {
      // Remover item MUDA O DOCUMENTO — mesma trava do incluir/alterar.
      await reservarVersao(tx, 'PRESCRICAO_GRUPO', item.grupoId, versaoCliente);

      // Item PARCIALMENTE executado fica VISÍVEL marcado como cancelado (ativo=true,
      // status CANCELADA) — igual ao cancelar de fora —, preservando fatura/estoque das
      // doses já dadas. Item nunca executado some (ativo=false); em grupo SALVO (edição)
      // segue só desativando, sem status.
      await tx.prescricao.update({
        where: { id: itemId },
        data:  itemComExecucao
          ? { status: 'CANCELADA' }
          : { ativo: false, ...(grupoJaFinalizado ? { status: 'CANCELADA' } : {}) },
      });

      let statusGrupo;
      if (grupoJaFinalizado) {
        // Item nunca executado → remove o placeholder de fatura (nunca foi aplicado).
        // Item PARCIALMENTE executado → PRESERVA os FaturaItems das doses já dadas
        // (têm baixa de estoque e não podem ficar órfãos).
        if (!itemComExecucao) {
          await removerFaturaItensDaOrigem(tx, 'prescricaoId', itemId);
        }

        // "Ainda a aplicar" = itens ativos NÃO cancelados (fora este). Um item
        // parcial-cancelado que fica ativo=true NÃO conta como restante.
        const restantes = await tx.prescricao.count({
          where: { grupoId: item.grupoId, ativo: true, status: { not: 'CANCELADA' }, id: { not: itemId } },
        });
        if (restantes === 0) {
          await liberarReservas(tx, item.grupoId);
          statusGrupo = 'CANCELADO';
        } else {
          statusGrupo = 'CANCELADO_PARCIALMENTE';

          // Recalcula as reservas do grupo com os itens restantes (multi-lote) —
          // sem isso, a reserva do item removido ficaria órfã, bloqueando o
          // estoque para outras prescrições.
          const itensRestantes = await anexarAplicadaProprietario(prisma, await tx.prescricao.findMany({
            where: { grupoId: item.grupoId, ativo: true, status: { not: 'CANCELADA' }, id: { not: itemId } },
          }));
          const empresaIdEfetivo = item.grupo?.empresaId ?? null;
          if (item.medicamentoCatId && !itensRestantes.some(i => i.medicamentoCatId === item.medicamentoCatId)) {
            // Nenhum item restante usa o medicamento do item removido → limpa as reservas dele
            const estoquesDoMed = await tx.estoqueClinica.findMany({
              where:  { medicamentoId: item.medicamentoCatId, ...(empresaIdEfetivo != null ? { empresaId: empresaIdEfetivo } : {}), ativo: true },
              select: { id: true },
            });
            if (estoquesDoMed.length > 0) {
              await tx.reservaEstoque.deleteMany({
                where: { prescricaoGrupoId: item.grupoId, estoqueId: { in: estoquesDoMed.map(e => e.id) } },
              });
            }
          }
          await criarReservas(tx, item.grupoId, item.animalId, itensRestantes, empresaIdEfetivo);
        }
      }

      // Responsável passa a ser quem removeu (+ transição de status quando aplicável).
      // Se este era o ÚLTIMO item (grupo inteiro CANCELADO), grava o motivo no grupo —
      // igual ao cancelar de fora (`cancelarNaExecucao`), para o Histórico exibir a
      // justificativa. No parcial o motivo do item fica só no AuditLog (o grupo segue vivo).
      await tx.prescricaoGrupo.update({
        where: { id: item.grupoId },
        data:  {
          veterinarioId: req.user.id,
          ...(statusGrupo ? { status: statusGrupo } : {}),
          ...(statusGrupo === 'CANCELADO' ? { motivoCancelamento: motivo } : {}),
        },
      });

      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PRESCRICAO_ITEM',
        entidadeId: itemId,
        animalId:   item.animalId,
        motivo,
        detalhes:   item.medicamento || null,
      });
    });

    return res.json({ dados: { message: 'Item removido.' } });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
    if (err instanceof ConflitoEdicaoError) {
      const editor = await descreverEditor(prisma, err.editorId).catch(() => null);
      return responderConflito(res, Object.assign(err, { editor }));
    }
    console.error('PrescricaoGrupoController.removerItem:', err);
    return res.status(500).json({ error: 'Erro ao remover item.' });
  }
};

// ─── Finalizar grupo ──────────────────────────────────────────────────────────
// SALVO → FINALIZADO.

const finalizar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: {
        itens:    { where: { ativo: true } },
        evolucao: { select: { tipoAtendimento: true, numero: true } },
      },
    });

    if (!grupo)                   return res.status(404).json({ error: 'Prescrição não encontrada.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // finalizada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, grupo.animalId)) return;
    if (grupo.status !== 'SALVO') return res.status(400).json({ error: 'Só é possível finalizar prescrições com status SALVO.' });

    // Autoria via RBAC (nível efetivo em atendimento.prescricoes.finalizar):
    // PROPRIO → só as próprias; EQUIPE/FULL → qualquer da equipe.
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar prescrições criadas por você.' });
    }
    if (grupo.itens.length === 0) return res.status(400).json({ error: 'A prescrição não possui itens ativos.' });

    // Sem a flag no item, o que o cliente aplica em casa voltaria a reservar estoque
    // e a ser cobrado logo aqui, na finalização.
    grupo.itens = await anexarCamposDoItem(prisma, grupo.itens);

    const empresaIdEfetivo = grupo.empresaId ?? req.empresaId ?? null;

    // Disponibilidade MULTI-LOTE (soma das entradas − reservas de outras prescrições).
    // Insuficiente → 409 com alertas; o usuário pode reenviar com forcarFinalizacao.
    if (!req.body?.forcarFinalizacao) {
      const alertas = await verificarDisponibilidade(grupo.itens, grupoId, empresaIdEfetivo);
      if (alertas.length > 0) {
        return res.status(409).json({ erro: 'ESTOQUE_INSUFICIENTE', alertas });
      }
    }

    const agora = new Date();

    // 🔴 PRESCRIÇÃO INTEIRAMENTE APLICADA PELO PROPRIETÁRIO JÁ NASCE NO ÚLTIMO PASSO.
    // Ela nunca chega ao plantão: `listarParaExecucao` descarta os itens com a flag e o
    // grupo que fica sem nenhum some da fila. Parada em FINALIZADO ("Em Execução"), ela
    // ficaria para sempre esperando uma execução que, por construção, não vai acontecer
    // — e engordando a lista de pendentes de quem opera a enfermagem.
    // ⚠️ Só quando TODOS os itens são do proprietário. Documento MISTO continua
    // FINALIZADO: a parte que a clínica aplica ainda vai ao plantão, e dizer que já
    // terminou esconderia da enfermagem a dose que ela tem de dar.
    // O status é `text` no Postgres (sem VARCHAR curto), então o valor não precisa de
    // migration — mas ele é `EXECUTADO`, e não um status novo, de propósito: os ~14
    // filtros que já tratam `EXECUTADO` (histórico do paciente, memória clínica,
    // documentos, relatórios, crons) passariam a ignorar em SILÊNCIO um status que não
    // conhecem, e a prescrição sumiria de cada um deles. Quem acrescenta o
    // "pelo Proprietário" é a EXIBIÇÃO, a partir da flag dos itens.
    const todosPeloProprietario = cursoTodoDoProprietario(grupo.itens);

    // 🔴 EMPRESA SEM ETAPA DE EXECUÇÃO (Configurações, 2026-09-24): a cobrança, a baixa
    // de estoque e o pagamento do prestador do que a clínica aplica saem AQUI, pelo
    // curso inteiro, e o documento termina EXECUTADO — ver `encerrarGrupoSemExecucao`.
    // Padrão `false`: nada muda para quem não marcou a opção.
    const semExecucao = await etapaExecucao.execucaoDispensada(prisma, empresaIdEfetivo);
    const statusFinal = (todosPeloProprietario || semExecucao) ? 'EXECUTADO' : 'FINALIZADO';

    const animal = await prisma.animal.findUnique({
      where: { id: grupo.animalId }, select: { userId: true },
    });
    const proprietarioId = animal?.userId ?? null;
    await prisma.$transaction(async (tx) => {
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true },
        data:  { status: 'ATIVA', veterinarioId },
      });

      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  {
          status:          todosPeloProprietario ? 'EXECUTADO' : 'FINALIZADO',
          veterinarioId,
          finalizadoPorId: veterinarioId,
          finalizadoEm:    agora,
          // `executadoEm` é o que a tela usa como "Data Fim" (`dataFimGrupo`). Sem ele,
          // o documento encerrado apareceria sem data de conclusão na lista.
          ...(todosPeloProprietario ? { executadoEm: agora } : {}),
        },
      });

      // Reserva o curso completo no estoque (multi-lote FEFO) — liberado ao
      // cancelar e abatido conforme a execução diária debita o estoque.
      // ⚠️ `criarReservas` PULA o item aplicado pelo proprietário, e tem de continuar
      // pulando: ele é debitado agora mesmo, logo abaixo — reservar e debitar o mesmo
      // frasco o contaria duas vezes contra o saldo.
      // ⚠️ Sem etapa de execução não há o que reservar: o curso inteiro é debitado
      // agora mesmo, em `encerrarGrupoSemExecucao`.
      if (!semExecucao) {
        await criarReservas(tx, grupoId, grupo.animalId, grupo.itens, empresaIdEfetivo);
      }

      // ── MATRIZ "quem FORNECE × quem APLICA" (2026-08-01) ────────────────────
      // MEDICAMENTO:
      // fornecido pelo Cliente | aplicado pelo Proprietário | execução | fatura
      //          não          |            não             |   ENTRA  | na EXECUÇÃO
      //          SIM          |            não             |   ENTRA  | nunca
      //          não          |            SIM             |  não vai | AQUI (finalização)
      //          SIM          |            SIM             |  não vai | nunca
      //
      // Ou seja: aqui só entra o item que a clínica FORNECE e o proprietário APLICA —
      // ele nunca chega ao plantão, então a finalização é a única oportunidade de
      // cobrá-lo. Todo o resto que é cobrável espera a execução (`executar`), que é
      // quando o serviço de fato acontece.
      //
      // PROCEDIMENTO marcado "Será executado pelo Proprietário" NUNCA é cobrado.
      // Procedimento não é bem entregue, é SERVIÇO: se quem executa é o proprietário,
      // a clínica não faz nada e não há o que faturar — diferente do medicamento, em
      // que a clínica ainda entrega o frasco mesmo sem aplicar. Por isso o filtro é
      // pelo tipo MEDICAMENTO, e não "não é procedimento": só o que a clínica de fato
      // ENTREGA pode ser cobrado sem execução.
      // ⚠️ Mudança de premissa: até 2026-08-01 a finalização lançava TUDO (com o
      // medicamento zerado até a 1ª execução preencher o valor). Agora o que vai ser
      // executado só vira linha de fatura ao ser executado.
      const itensParaFaturarAgora = grupo.itens.filter(
        i => i.tipo === 'MEDICAMENTO' && !i.medicamentoCliente && i.aplicadaPeloProprietario,
      );
      // 🔴 A ENTREGA AO PROPRIETÁRIO DEBITA O ESTOQUE E TEM PREÇO (2026-09-18, a
      // pedido). Até aqui este item era lançado com valor **ZERO** — o preço nasce do
      // LOTE debitado, e ele nunca era executado, então não havia lote: a clínica
      // entregava o frasco, a linha ia para a fatura em branco e alguém tinha de
      // corrigir o valor à mão (a "LACUNA CONHECIDA" registrada no CLAUDE.md).
      //
      // Debitar aqui não é efeito colateral do preço, é o fato: o frasco SAIU da
      // prateleira quando o cliente o levou. A quantidade é a do CURSO INTEIRO
      // (`calcularQuantidadeTotal`), que é o que ele leva — e ela cai nas duas regras
      // já existentes: 1 embalagem no produto sem multidose (`entregaPorEmbalagem`) e o
      // proporcional prescrito no multidose (20 mL de um frasco de 20 mL).
      //
      // ⚠️ `incluirDoProprietario` é OPT-IN e existe só para este caminho: na EXECUÇÃO
      // o item continua fora, porque lá ele nem chega (`itensHoje` já o exclui).
      const {
        precos: precosDaEntrega,
        entregas: entregasDaEntrega,
        unidadesFaturadas: unidadesDaEntrega,
      } = itensParaFaturarAgora.length > 0
        ? await debitarEstoqueDia(
            tx, itensParaFaturarAgora, empresaIdEfetivo, grupoId, calcularQuantidadeTotal,
            { incluirDoProprietario: true },
          )
        : { precos: new Map(), entregas: new Map(), unidadesFaturadas: new Map() };

      // Sem nada a cobrar agora, nem abre fatura: senão a finalização criaria uma
      // fatura vazia para o cliente todo mês.
      if (proprietarioId && itensParaFaturarAgora.length > 0) {
        // A fatura segue a tenancy do GRUPO (clínica que prescreveu), não o contexto
        // de quem executa — cada empresa tem a sua fatura para o mesmo cliente.
        const fatura = await getOrCreateFatura(tx, proprietarioId, empresaIdEfetivo);
        for (const item of itensParaFaturarAgora) {
          // Pela FK só, a linha COMPARTILHADA (2026-09-17) esconderia o lançamento
          // deste item quando ela foi criada por outro — e ele seria cobrado duas vezes.
          if (await itemOrigens.origemJaFaturada(tx, 'prescricaoId', item.id)) continue;
          // Consolida como a dose executada (2026-09-17): dois itens iguais que o
          // proprietário aplica em casa são UMA linha com a quantidade somada, e cada
          // um entra na observação. Abrir linha nova aqui deixaria a MESMA fatura com
          // duas regras — a do plantão somando e a da finalização repetindo.
          // Valor aceito no orçamento manda; sem orçamento, o MEDICAMENTO sai pelo
          // preço do lote que acabou de ser debitado logo acima.
          // ⚠️ Continua caindo em 0 quando o medicamento não tem estoque cadastrado na
          // clínica — a linha nasce zerada "para o financeiro saber", exatamente como
          // na execução. Zero aqui é "ninguém disse quanto vale", nunca um palpite.
          const valorDaEntrega = item.valorOrcado != null
            ? item.valorOrcado
            : (item.tipo === 'PROCEDIMENTO'
                ? await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento, item.prestadorId)
                : (item.medicamentoCatId ? (precosDaEntrega.get(item.medicamentoCatId) ?? 0) : 0));
          // 🔴 A QUANTIDADE É A DE EMBALAGENS ENTREGUES (2026-09-19), nunca 1 fixo: o
          // cliente leva o CURSO INTEIRO para casa, e o curso que não cabe num frasco
          // leva dois. Com `1`, a fatura mostraria o valor de dois frascos ao lado de
          // "Quant.: 1" e ele não teria como conferir o que recebeu.
          // ⚠️ E o `valor` tem de virar UNITÁRIO junto — `valorDaEntrega` é o TOTAL do
          // que saiu do estoque, e a linha multiplica de volta por `quantidade`. Mexer
          // num sem o outro dobra (ou divide) a cobrança, sem nada acusar.
          // ⚠️ Produto contado em unidades AVULSAS entra por `unidadesFaturadas`: o
          // cliente leva 14 ampolas do curso, e "Quant.: 1" ao lado do valor de 14 não
          // é conferível. Ver a mesma decisão na EXECUÇÃO (`qtdFaturada`).
          const embalagensDaEntrega = entregasDaEntrega.get(item.id)
            ?? unidadesDaEntrega.get(item.id)
            ?? 1;
          await adicionarOuSomarFaturaItem(tx, {
            faturaId:     fatura.id,
            animalId:     grupo.animalId,
            tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
            descricao:    descricaoItemFatura(item),
            valor:        valorDaEntrega / embalagensDaEntrega,
            quantidade:   embalagensDaEntrega,
            veterinarioId,
            prescricaoId: item.id,
            ocorridoEm:   new Date(),
          });
        }
      }

      // Finalizar grava `veterinarioId` = quem finalizou. Quando isso muda o dono do
      // documento (gestor finalizando a prescrição de outro), é uma TRANSFERÊNCIA e
      // precisa do mesmo rastro do assumir — senão o documento troca de mãos calado.
      if (grupo.veterinarioId != null && Number(grupo.veterinarioId) !== Number(veterinarioId)) {
        await registrarTransferencia(tx, req, {
          entidade: 'PRESCRICAO', entidadeId: grupoId, animalId: grupo.animalId,
          deVetId: grupo.veterinarioId, paraVetId: veterinarioId,
          motivo: 'Prescrição finalizada por outro profissional',
        });
      }

      await registrarAlteracao(tx, req, {
        entidade: 'PRESCRICAO', entidadeId: grupoId, animalId: grupo.animalId,
        donoAnteriorId: grupo.veterinarioId,
        donoAtualId:    veterinarioId,
        campos: { status: { de: grupo.status, para: statusFinal } },
      });

      // Empresa sem etapa de execução: o que a CLÍNICA aplica é cobrado, debitado e
      // pago ao prestador AGORA, e o documento vai para EXECUTADO. Na MESMA transaction:
      // ou a prescrição encerra com a cobrança, ou nada acontece.
      if (semExecucao) {
        await encerrarGrupoSemExecucao(tx, grupoId, {
          empresaId: empresaIdEfetivo, porUsuarioId: veterinarioId, agora, req,
        });
      }
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.finalizar:', err);
    return res.status(500).json({ error: 'Erro ao finalizar prescrição.' });
  }
};

// ─── Empresa SEM etapa de Execução de Prescrição ─────────────────────────────
//
// 🔴 A clínica que marcou "Dispensar a etapa de Execução de Prescrição" em
// Configurações (lib/etapaExecucaoPrescricao.js) não usa o plantão: o que em outras
// clínicas nasce na EXECUÇÃO, dose a dose, nasce AQUI, na FINALIZAÇÃO, pelo CURSO
// INTEIRO — linha de fatura, baixa de estoque, recibo e conta a pagar do prestador,
// conta a pagar do fornecedor e os insumos da aplicação injetável. E o documento já
// nasce EXECUTADO.
//
// ⚠️ Só o que a CLÍNICA aplica. O item aplicado pelo proprietário segue a matriz de
// `finalizar` (já é cobrado lá, no quadrante "clínica fornece × proprietário aplica"),
// e o fornecido pelo cliente continua sem cobrança — a opção muda o MOMENTO, não a
// matriz "quem FORNECE × quem APLICA".
//
// ⚠️ DOIS chamadores, e os dois precisam dela: `finalizar` e a cascata da finalização
// do ATENDIMENTO (lib/finalizacaoEvolucao.js), que promove o grupo SALVO sem passar por
// `finalizar`. Sem o segundo, a prescrição fechada junto do atendimento ficaria
// FINALIZADA esperando um plantão que a clínica não tem — e nunca seria cobrada.
//
// ⚠️ IDEMPOTENTE: item já marcado como executado é pulado e a linha de fatura passa
// por `origemJaFaturada` — rodar duas vezes não cobra duas vezes.
//
// ⚠️ As doses NÃO ganham linha em `tb_prescricao_execucoes_dose`: ninguém executou
// dose nenhuma, e o log é append-only do que ACONTECEU no plantão. O item é marcado
// com o curso completo (`dosesExecutadas` = total) só para nenhum leitor — Mapa de
// Atendimento, fila do plantão, lembrete de WhatsApp — projetar dose pendente num
// documento encerrado.

// Quantas vezes o item acontece no curso — é a QUANTIDADE da linha do procedimento e
// o número de insumos da aplicação injetável. Item sem agenda (dose única 'agora',
// SOS, "se necessário") vale UMA vez: não há como saber quantas.
function vezesNoCurso(item) {
  return elegivelParaFluxoNovo(item) ? dosesTotaisEsperadas(item) : 1;
}

async function encerrarGrupoSemExecucao(tx, grupoId, { empresaId = null, porUsuarioId, agora = new Date(), req = null } = {}) {
  const grupo = await tx.prescricaoGrupo.findUnique({
    where:   { id: Number(grupoId) },
    include: {
      itens:  { where: { ativo: true } },
      animal: { select: { nome: true, userId: true } },
    },
  });
  if (!grupo || !['FINALIZADO', 'EXECUTADO'].includes(grupo.status)) return { lancados: 0 };

  grupo.itens = await anexarCamposDoItem(tx, grupo.itens);
  const empresaIdEfetivo = grupo.empresaId ?? empresaId ?? null;
  const itens = grupo.itens.filter(i =>
    i.status !== 'CANCELADA' && !i.aplicadaPeloProprietario && !i.executadoEm);

  let fatura   = null;
  let lancados = 0;
  if (itens.length > 0) {
    const proprietarioId = grupo.animal?.userId ?? null;
    // Quem SOLICITOU é quem PRESCREVEU — mesma regra de `executar`.
    const solicitante = grupo.veterinarioId
      ? await tx.user.findUnique({
          where: { id: Number(grupo.veterinarioId) }, select: { id: true, fullName: true },
        }).catch(() => null)
      : null;

    // O CURSO INTEIRO sai do estoque agora (`calcularQuantidadeTotal`), pelas mesmas
    // regras de sempre: embalagem por embalagem no produto sem multidose, o
    // proporcional no multidose, unidades avulsas no 'Un.'.
    const { precos, porEmbalagem, entregas, unidadesFaturadas } =
      await debitarEstoqueDia(tx, itens, empresaIdEfetivo, grupo.id, calcularQuantidadeTotal);

    if (proprietarioId) fatura = await getOrCreateFatura(tx, proprietarioId, empresaIdEfetivo);

    for (const item of itens) {
      const vezes = vezesNoCurso(item);

      // Valor TOTAL do item no curso + a quantidade da linha. O `valor` gravado é o
      // UNITÁRIO (total ÷ quantidade) — a linha multiplica de volta.
      //   orçado       → o valor aceito é por dose/sessão, vezes o curso;
      //   procedimento → valor da sessão (vínculo do prestador > combo > empresa >
      //                  catálogo), vezes o curso;
      //   medicamento  → o que saiu do estoque; quantidade = embalagens entregues,
      //                  unidades avulsas ou, no multidose, as doses do curso.
      let valorTotal;
      let quantidade;
      if (item.valorOrcado != null) {
        quantidade = vezes;
        valorTotal = Number(item.valorOrcado) * vezes;
      } else if (item.tipo === 'PROCEDIMENTO') {
        quantidade = vezes;
        valorTotal = (await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento, item.prestadorId)) * vezes;
      } else {
        valorTotal = item.medicamentoCatId ? (precos.get(item.medicamentoCatId) ?? 0) : 0;
        quantidade = porEmbalagem.has(item.id)
          ? (entregas.get(item.id) ?? 1)
          : (unidadesFaturadas.get(item.id) ?? vezes);
      }
      quantidade = Math.max(Number(quantidade) || 1, 1);

      // Fornecido pelo cliente NÃO é cobrado — igual à execução.
      if (fatura && !item.medicamentoCliente
          && !(await itemOrigens.origemJaFaturada(tx, 'prescricaoId', item.id))) {
        await adicionarOuSomarFaturaItem(tx, {
          faturaId:     fatura.id,
          animalId:     grupo.animalId,
          tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
          descricao:    descricaoItemFatura(item),
          valor:        valorTotal / quantidade,
          quantidade,
          veterinarioId: porUsuarioId ?? null,
          prescricaoId: item.id,
          ocorridoEm:   agora,
        });
        lancados++;
      }

      // RECIBO + CONTA A PAGAR DO PRESTADOR — o curso inteiro numa execução só.
      // `valorCliente` é o TOTAL (base do PERCENTUAL) e `quantidade` as sessões (base
      // do valor fixo) — a mesma leitura de `calcularValorAPagar` que o plantão faz.
      if (item.tipo === 'PROCEDIMENTO' && item.prestadorId) {
        const doVinculo = await vinculoPrestador.resolverValoresPorNome(
          tx, empresaIdEfetivo, item.medicamento, item.prestadorId,
        );
        const prestador = await tx.prestador.findUnique({
          where:  { id: Number(item.prestadorId) },
          select: { nome: true, tipoPagamento: true, formaPagamento: true, valorPagamento: true },
        });
        const valorCliente = item.medicamentoCliente ? 0 : valorTotal;
        await vinculoPrestador.registrarExecucao(tx, {
          empresaId:        empresaIdEfetivo,
          prestadorId:      item.prestadorId,
          prescricaoId:     item.id,
          animalId:         grupo.animalId,
          animalNome:       grupo.animal?.nome ?? '',
          procedimentoNome: item.medicamento,
          quantidade:       vezes,
          valorCliente,
          valorPrestador:   doVinculo.valorPrestador,
          tipoPagamento:    prestador?.tipoPagamento  ?? null,
          formaPagamento:   prestador?.formaPagamento ?? null,
          valorPagamento:   prestador?.valorPagamento ?? null,
          executadoEm:      agora,
          executadoPorId:   porUsuarioId ?? null,
          faturaItemId:     null,
        });
        const { valorAPagar } = vinculoPrestador.calcularValorAPagar({
          valorCliente,
          valorPrestador: doVinculo.valorPrestador,
          tipoPagamento:  prestador?.tipoPagamento  ?? null,
          formaPagamento: prestador?.formaPagamento ?? null,
          valorPagamento: prestador?.valorPagamento ?? null,
          quantidade:     vezes,
        });
        await contasPagar.lancarItem(tx, {
          empresaId:   empresaIdEfetivo,
          tipo:        'PRESTADOR',
          credorId:    item.prestadorId,
          credorNome:  prestador?.nome ?? '',
          animalId:    grupo.animalId,
          animalNome:  grupo.animal?.nome ?? '',
          descricao:   item.medicamento,
          quantidade:  vezes,
          valor:       valorAPagar,
          solicitanteId:   solicitante?.id ?? null,
          solicitanteNome: solicitante?.fullName ?? '',
          ocorridoEm:  agora,
          origemTipo:  contasPagar.ORIGENS.EXECUCAO_PRESTADOR,
          origemId:    item.id,
          permitirSemValor: true,
        });
      }

      // CONTA A PAGAR DO FORNECEDOR — o medicamento que a clínica não estoca.
      if (item.tipo === 'MEDICAMENTO' && !item.medicamentoCliente && item.medicamentoCatId) {
        const produto = await produtoFornecedor.fornecedorDoItem(tx, empresaIdEfetivo, item.medicamentoCatId);
        if (produto?.valorUnitario != null) {
          await contasPagar.lancarItem(tx, {
            empresaId:   empresaIdEfetivo,
            tipo:        'FORNECEDOR',
            credorId:    produto.fornecedorId,
            credorNome:  produto.fornecedorNome ?? '',
            animalId:    grupo.animalId,
            animalNome:  grupo.animal?.nome ?? '',
            descricao:   item.medicamento,
            quantidade:  porEmbalagem.has(item.id)
              ? (entregas.get(item.id) ?? 1)
              : (Number(calcularQuantidadeTotal(item)) || 1),
            valor:       produto.valorUnitario,
            solicitanteId:   solicitante?.id ?? null,
            solicitanteNome: solicitante?.fullName ?? '',
            ocorridoEm:  agora,
            origemTipo:  contasPagar.ORIGENS.PRESCRICAO_ITEM,
            origemId:    item.id,
          });
        }
      }

      // Insumos da aplicação injetável: 1 seringa + 1 agulha POR APLICAÇÃO do curso,
      // como o plantão lança a cada dose. Sem estoque do insumo, apenas não lança.
      if (item.tipo === 'MEDICAMENTO' && isViaInjetavel(item.via) && fatura) {
        for (let n = 0; n < vezes; n++) {
          for (const prefixo of ['Seringa', 'Agulha']) {
            const insumo = await debitarInsumoUnidade(
              tx, prefixo, empresaIdEfetivo,
              `Aplicação injetável (${item.via}): ${item.medicamento}`,
            );
            if (!insumo) continue;
            await adicionarOuSomarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     grupo.animalId,
              tipo:         'PROCEDIMENTO',
              descricao:    `${insumo.nome} — aplicação ${item.via} (${item.medicamento})`,
              valor:        insumo.valor,
              quantidade:   1,
              veterinarioId: porUsuarioId ?? null,
              prescricaoId: item.id,
              ocorridoEm:   agora,
            });
          }
        }
      }

      // Curso completo: nenhum leitor pode projetar dose pendente num documento
      // encerrado. Ver a nota no topo do bloco.
      await tx.prescricao.update({
        where: { id: item.id },
        data:  {
          executadoEm: agora,
          ...(elegivelParaFluxoNovo(item)
            ? { dosesExecutadas: dosesTotaisEsperadas(item), proximaDoseEm: null }
            : {}),
        },
      });
    }
  }

  await tx.prescricaoGrupo.update({
    where: { id: grupo.id },
    data:  { status: 'EXECUTADO', executadoPorId: porUsuarioId ?? null, executadoEm: agora },
  });
  // Nada fica reservado: o curso inteiro já saiu do estoque (ou nunca vai sair).
  await liberarReservas(tx, grupo.id);
  if (fatura) await recalcularTotal(tx, fatura.id);

  if (req) {
    await registrarAuditoria(tx, req, {
      categoria:  'EXECUCAO',
      entidade:   'PRESCRICAO',
      entidadeId: grupo.id,
      animalId:   grupo.animalId,
      detalhes:   `Encerrada na finalização — empresa sem etapa de Execução de Prescrição `
        + `(${itens.length} item(ns), ${lancados} lançado(s) na fatura)`,
    });
  }
  return { lancados };
}

// ─── Cancelar grupo ───────────────────────────────────────────────────────────
// Libera reservas de estoque sem dar baixa.

const cancelar = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;
    const motivo  = req.body?.motivo?.trim() ?? null;

    if (!motivo) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
    }

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // cancelada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, grupo.animalId)) return;

    // Autoria via RBAC (nível efetivo em atendimento.prescricoes.deletar)
    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }

    // Regra: prescrição que já teve QUALQUER execução (mesmo parcial, em
    // tratamento de vários dias) não pode ser cancelada/excluída.
    if (grupo.status === 'EXECUTADO' || grupo.executadoEm || grupo.itens.some(i => i.executadoEm)) {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser cancelada.', code: 'EXECUTADO' });
    }

    if (!['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Status não permite cancelamento.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'CANCELADA' } });
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'CANCELADO', motivoCancelamento: motivo },
      });

      await registrarAuditoria(tx, req, {
        categoria:  'CANCELAMENTO',
        entidade:   'PRESCRICAO',
        entidadeId: grupoId,
        animalId:   grupo.animalId,
        motivo,
        detalhes:   `status anterior: ${grupo.status} — ${grupo.itens.length} item(ns)`,
      });
    });

    return res.json({ dados: { message: 'Prescrição cancelada. Estoque reservado liberado.' } });
  } catch (err) {
    console.error('PrescricaoGrupoController.cancelar:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Cancelar na TELA DE EXECUÇÃO ─────────────────────────────────────────────
// Permite cancelar toda a prescrição mesmo com execução PARCIAL (tratamento de
// vários dias). Itens já executados/faturados são preservados; os ainda NÃO
// executados são cancelados (ativo=false) e as reservas remanescentes liberadas.
// Justificativa obrigatória → AuditLog (CANCELAMENTO).
const cancelarNaExecucao = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;
    const motivo  = req.body?.motivo?.trim() ?? null;
    if (!motivo) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
    }

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // cancelada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, grupo.animalId)) return;

    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite cancelar prescrições criadas por você.' });
    }
    if (grupo.status === 'EXECUTADO') {
      return res.status(400).json({ error: 'Prescrição já totalmente executada não pode ser cancelada.', code: 'EXECUTADO' });
    }
    if (!['FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Status não permite cancelamento na execução.' });
    }

    const houveExecucao = grupo.itens.some(i => i.executadoEm);
    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      // O item foi lançado na fatura na finalização; cancelado sem execução, sai da
      // fatura (nunca foi aplicado). Itens já executados permanecem faturados.
      for (const item of grupo.itens.filter(i => !i.executadoEm)) {
        await removerFaturaItensDaOrigem(tx, 'prescricaoId', item.id);
      }
      // Cancela só os itens ainda NÃO executados (preserva os executados/faturados).
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true, executadoEm: null },
        data:  { status: 'CANCELADA', ativo: false },
      });
      // Item PARCIALMENTE executado (dose 2 de 7, p.ex.): as doses que FALTAM também
      // são canceladas — é o pedido explícito de quem cancela pelo plantão. Fica
      // `ativo: true` de propósito: as doses já aplicadas têm item de fatura e baixa
      // de estoque, e desativar a linha tiraria o documento da aba "Cancelado" da
      // própria tela de execução (que só lista itens ativos) — some sem deixar rastro.
      // Quem impede a execução das doses restantes é o status CANCELADO do GRUPO.
      await tx.prescricao.updateMany({
        where: { grupoId, ativo: true, executadoEm: { not: null } },
        data:  { status: 'CANCELADA' },
      });
      // Cancelamento na execução é SEMPRE definitivo: status CANCELADO, execução
      // bloqueada e prescrição imutável — itens já executados permanecem na fatura.
      await tx.prescricaoGrupo.update({
        where: { id: grupoId },
        data:  { status: 'CANCELADO', motivoCancelamento: motivo },
      });
      await registrarAuditoria(tx, req, {
        categoria:  'CANCELAMENTO',
        entidade:   'PRESCRICAO',
        entidadeId: grupoId,
        animalId:   grupo.animalId,
        motivo,
        detalhes:   houveExecucao
          ? 'Cancelada na execução (execução parcial — itens executados preservados)'
          : 'Cancelada na execução',
      });
    });

    return res.json({ dados: { message: 'Prescrição cancelada.' } });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
    console.error('PrescricaoGrupoController.cancelarNaExecucao:', err);
    return res.status(500).json({ error: 'Erro ao cancelar prescrição.' });
  }
};

// ─── Reabrir para edição ──────────────────────────────────────────────────────
// Prescrição FINALIZADA e ainda NÃO executada → volta para SALVO e libera as
// reservas de estoque. O usuário edita como rascunho e finaliza novamente.
// (SALVO já é editável; EXECUTADO/parcial/cancelada não podem ser reabertas.)
const reabrirParaEdicao = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const userId  = req.user.id;

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: { itens: { where: { ativo: true } } },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // reaberta até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, grupo.animalId)) return;

    if (!podeOperarRegistro(req, grupo.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite editar prescrições criadas por você.' });
    }
    if (grupo.status === 'SALVO') {
      const g = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
      // Anexar a flag aqui não é detalhe: o objeto devolvido vai direto para o
      // formulário de edição. Sem ela, a caixa "aplicada pelo Proprietário" reabre
      // desmarcada em cada item e o Salvar seguinte apagaria a marcação.
      return res.json({ dados: await anexarFlagEmGrupos(prisma, { ...g, numeroFormatado: formatNumero(g.numero) }) });
    }
    if (grupo.status === 'EXECUTADO' || grupo.itens.some(i => i.executadoEm)) {
      return res.status(400).json({ error: 'Prescrição já executada não pode ser editada.', code: 'EXECUTADO' });
    }
    if (grupo.status !== 'FINALIZADO') {
      return res.status(400).json({ error: 'Somente prescrições finalizadas e não executadas podem ser reabertas.' });
    }

    await prisma.$transaction(async (tx) => {
      await liberarReservas(tx, grupoId);
      // Volta a ser rascunho → sai da fatura (será relançada na próxima finalização)
      for (const item of grupo.itens) {
        await removerFaturaItensDaOrigem(tx, 'prescricaoId', item.id);
      }
      await tx.prescricao.updateMany({ where: { grupoId, ativo: true }, data: { status: 'RASCUNHO' } });
      await tx.prescricaoGrupo.update({ where: { id: grupoId }, data: { status: 'SALVO', veterinarioId: userId } });
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({
      dados: await anexarFlagEmGrupos(prisma, { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) }),
    });
  } catch (err) {
    if (err.code === 'FATURA_PAGA') {
      return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
    }
    console.error('PrescricaoGrupoController.reabrirParaEdicao:', err);
    return res.status(500).json({ error: 'Erro ao reabrir prescrição.' });
  }
};

// ─── Executar grupo (por dia / item a item) ──────────────────────────────────
// Debita a dose do dia do estoque e lança CADA item na fatura ao ser executado.
// body.itemIds (opcional) → executa só esses itens; sem itemIds → todos os da janela
// de hoje ainda não executados. Não reexecuta o mesmo item no mesmo dia.
// Transita para EXECUTADO (backend-autoritativo) quando TODOS os itens ativos já
// foram executados e alcançaram o último dia da sua janela.

// Data local (YYYY-MM-DD) da última execução do item — para não reexecutar/refaturar
// o MESMO item no MESMO dia (permite execução item a item sem duplicar na fatura).
function executadoHojeItem(item, hojeStr, fuso = null) {
  if (!item.executadoEm) return false;
  return diaNaEmpresa(item.executadoEm, fuso) === hojeStr;
}

// Data LOCAL (YYYY-MM-DD) de um instante qualquer — mesma regra de `hojeLocalStr`/
// `executadoHojeItem`: NUNCA `toISOString()` aqui, que dá a data em UTC e já vira o
// dia seguinte a partir das 21h no horário de Brasília.
function dataLocalStr(d, fuso = null) {
  return diaNaEmpresa(d, fuso);
}

// Descrição do item na fatura — mesma forma no lançamento da finalização e na execução
// 🔴 A DESCRIÇÃO NÃO CARREGA MAIS O Nº DO ATENDIMENTO (2026-09-17, a pedido).
//
// Enquanto ela começava com `[AG-0012]`, a chave de consolidação da fatura nunca
// casava entre atendimentos: o MESMO medicamento, na MESMA dose e pelo MESMO preço,
// aplicado em dois atendimentos do mês, virava duas linhas idênticas fora o número. O
// número passou a ser OBSERVAÇÃO da linha (`lib/faturaItemOrigens.js`), junto da data
// e da quantidade de cada contribuição — e clicável para o registro de origem, que é
// justamente o que ele servia para dizer.
//
// 🔴 A POSOLOGIA SAIU DA DESCRIÇÃO (2026-09-19, a pedido) — a linha é o PRODUTO.
//
// ⚠️ ISTO INVERTE a decisão de 2026-09-17, que a mantinha de propósito. O efeito não é
// cosmético: a posologia fazia parte da CHAVE de consolidação (tipo, descrição, animal,
// valor unitário), então o mesmo remédio prescrito 12/12h num atendimento e 8/8h em
// outro virava DUAS linhas. Sem ela, os dois viram UMA:
//
//     antes : Amoxicilina — 10mL × 12/12h   Quant.: 3
//             Amoxicilina — 10mL × 8/8h     Quant.: 2
//     agora : Amoxicilina                   Quant.: 5
//
// A razão da regra antiga ("a linha afirmaria uma posologia que metade das doses não
// teve") deixa de valer justamente porque a linha não afirma mais posologia nenhuma —
// ela diz o produto, a quantidade e o preço, que é o que a fatura cobra. O detalhe de
// cada aplicação continua inteiro na OBSERVAÇÃO da linha (`lib/faturaItemOrigens.js`):
// número do registro, data e quantidade, uma linha por execução.
//
// ⚠️ O VALOR UNITÁRIO continua na chave, e é ele que separa o que precisa ser separado:
// doses de tamanhos diferentes têm preços diferentes e seguem em linhas próprias.
function descricaoItemFatura(item) {
  return item.medicamento;
}

// Valor de um item PROCEDIMENTO na fatura, resolvido pelo NOME (o item guarda só o
// nome): VÍNCULO DO PRESTADOR > combo da empresa > valor da empresa p/ o
// procedimento (Cadastro > Procedimentos) > valorVenda do catálogo > 0.
//
// 🔴 O VÍNCULO DO PRESTADOR VEM PRIMEIRO (2026-09-08) porque é o mais específico
// que existe: é o preço daquele procedimento QUANDO É AQUELE PRESTADOR que executa
// — justamente o caso que o valor único da empresa não sabia representar (dois
// ferradores cobrando diferente pelo mesmo ferrageamento). Sem prestador no item, a
// cadeia é a de sempre e NENHUMA prescrição existente muda de preço.
//
// ⚠️ NÃO filtra por `ativo` — de propósito. Isto resolve o preço de algo que a
// pessoa JÁ ESCOLHEU ao prescrever (o item só guarda o nome, sem FK para o combo/
// procedimento de origem); se o combo/procedimento for inativado ENTRE a
// prescrição e a finalização/execução, o item não pode nascer com valor 0 só
// porque saiu do catálogo ativo. Oferecer a opção para prescrição NOVA é outro
// código (`listarCombos`/`listarComValores`, que filtram `ativo:true`).
async function resolverValorProcedimento(tx, empresaId, nome, prestadorId = null) {
  const n = (nome ?? '').trim();
  if (!n) return 0;
  if (empresaId && prestadorId) {
    const doVinculo = await vinculoPrestador.resolverValoresPorNome(tx, empresaId, n, prestadorId);
    if (doVinculo.valorCliente != null) return doVinculo.valorCliente;
  }
  if (empresaId) {
    const combo = await tx.procedimentoCombo.findFirst({
      where:  { empresaId, nome: { equals: n, mode: 'insensitive' } },
      select: { valor: true },
    });
    if (combo) return combo.valor ?? 0;
  }
  const proc = await tx.procedimentoVeterinario.findFirst({
    where:  { nome: { equals: n, mode: 'insensitive' } },
    select: { id: true, valorVenda: true },
  });
  if (!proc) return 0;
  if (empresaId) {
    const ve = await tx.procedimentoValorEmpresa.findFirst({
      where:  { empresaId, procedimentoId: proc.id },
      select: { valor: true },
    });
    if (ve) return ve.valor ?? 0;
  }
  return proc.valorVenda ?? 0;
}

// horarioPrevistoDoItem foi para lib/agendaDoses.js (fonte única) — a prévia de
// dias futuros (`itemPrevistoParaDataFutura`) também precisa dela.

const CLASSIFICACAO_LABEL = { NO_HORARIO: 'no horário', ANTECIPADA: 'antecipada', ATRASADA: 'atrasada' };

// A execução ANTECIPADA deixou de exigir JUSTIFICATIVA (2026-09-18): ela é
// CONFIRMADA (`confirmarAntecipacao`), no mesmo molde da atrasada. A justificativa
// continua ACEITA e, quando vier, vai para o `motivo` da auditoria — cliente antigo
// (que ainda a envia) segue funcionando sem nenhuma mudança de comportamento.

// Texto de data/hora para a mensagem de erro e para a auditoria — NO FUSO DA
// CLÍNICA. Lia o relógio do servidor, então a auditoria de uma clínica de Manaus
// registrava "previsto 06:44" como 07:44.
function fmtDataHora(d, fuso = null) {
  return formatarNaEmpresa(d, fuso).replace(/^(\d{2}\/\d{2})\/\d{4} /, '$1 ');
}

const executar = async (req, res) => {
  try {
    const grupoId       = Number(req.params.id);
    const veterinarioId = req.user.id;
    // itemIds (opcional): executa/fatura SOMENTE esses itens (execução item a item).
    // Sem itemIds → mantém o comportamento antigo (todos os itens pendentes).
    const itemIdsFiltro = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.map(Number).filter(Number.isInteger)
      : null;
    // Execução ATRASADA exige confirmação explícita do front (tela de aviso,
    // não-bloqueante) — sem ela, nada é debitado/faturado.
    const confirmarHorario = req.body?.confirmarHorario === true;
    // Execução ANTECIPADA (dose FUTURA) é CONFIRMADA, não justificada (2026-09-18):
    // a tela informa o horário previsto, pergunta, e `confirmarAntecipacao` é o "sim".
    //
    // 🔴 FLAG PRÓPRIA, NUNCA `confirmarHorario` — e isto não é preciosismo: o
    // "Executar Todos" manda `confirmarHorario: true` FIXO (o clique em lote vale
    // como confirmação de dose ATRASADA, que já era devida). Liberar a antecipação
    // por aquela mesma flag reabriria o furo de 2026-08-23: um clique aplicaria o
    // curso INTEIRO de uma vez, sem ninguém ser perguntado. Com flag própria, o
    // gate é o mesmo nos dois caminhos (ícone e lote) e os dois passam pela
    // pergunta.
    const confirmarAntecipacao = req.body?.confirmarAntecipacao === true;
    // OPCIONAL desde 2026-09-18 (era obrigatória). Quando vier, vai para o `motivo`
    // da auditoria — quem quiser registrar o porquê continua podendo.
    const justificativa = String(req.body?.justificativa ?? '').trim();

    /**
     * 🔴 QUEM EXECUTOU O PROCEDIMENTO, informado NA EXECUÇÃO (2026-09-15).
     *
     * O prestador já podia ser escolhido na PRESCRIÇÃO, mas quem prescreve nem sempre
     * sabe quem vai executar — e é a execução que gera o recibo e a conta a pagar.
     * A tela de plantão passa a oferecer o campo, e o que vier aqui VENCE o que estava
     * gravado no item.
     *
     * ⚠️ NUNCA é obrigatório: sem prestador escolhido a execução segue normalmente e
     * o item fica como estava (sem recibo, se nunca teve). Exigi-lo pararia o
     * atendimento por causa de um cadastro.
     * ⚠️ Só PROCEDIMENTO — `gravarPrestadorDoItem` ignora medicamento por construção,
     * e aceitar o campo ali criaria linha de recibo por dose de remédio.
     * ⚠️ Formato `{ "<itemId>": prestadorId }`: o "Executar Todos" manda vários
     * procedimentos de uma vez, e cada um pode ter sido feito por uma pessoa.
     */
    const prestadoresDaExecucao = new Map();
    {
      const bruto = req.body?.prestadores;
      if (bruto && typeof bruto === 'object') {
        for (const [chave, valor] of Object.entries(bruto)) {
          const itemId = Number(chave);
          const presId = Number(valor);
          if (Number.isInteger(itemId) && Number.isInteger(presId)) prestadoresDaExecucao.set(itemId, presId);
        }
      }
    }

    const grupo = await prisma.prescricaoGrupo.findUnique({
      where:   { id: grupoId },
      include: {
        itens:   { where: { ativo: true }, include: { medicamentoCat: true } },
        evolucao: { select: { id: true, numero: true, tipoAtendimento: true, status: true } },
        animal:   { select: { nome: true } },
      },
    });
    if (!grupo) return res.status(404).json({ error: 'Prescrição não encontrada.' });
    // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
    // executada até o gestor reativar. Ver lib/animalInativo.js.
    if (await bloquearSeAnimalInativo(res, grupo.animalId)) return;
    if (!['FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status)) {
      return res.status(400).json({ error: 'Apenas prescrições FINALIZADAS podem ser executadas.' });
    }
    // Premissa alterada (2026-07-16): a prescrição FINALIZADA pode ser executada mesmo
    // com a evolução ainda EM_ANDAMENTO — não exige mais a evolução FINALIZADA.

    // "Hoje" é o dia da CLÍNICA, não o do servidor (que roda fixo em Brasília).
    const fuso    = await fusoDaEmpresa(grupo.empresaId ?? req.empresaId);
    const hojeStr = hojeNaEmpresa(fuso);

    grupo.itens = await anexarCamposDoItem(prisma, grupo.itens);

    // Itens processáveis AGORA:
    //   elegível ao fluxo novo (horário definido) → uma dose de cada vez, até o
    //     total de doses do curso ser atingido (não é mais "uma vez por dia").
    //   legado (sem horário definido)             → mantém o comportamento antigo:
    //     dentro da janela do dia, ainda não executado hoje.
    // Item aplicado pelo proprietário nunca é executado pela clínica — a lista do
    // plantão já não o mostra, e o filtro aqui fecha a porta de um POST com itemIds
    // (execução item a item) que o alcançasse mesmo assim.
    const itensHoje = grupo.itens.filter(item => {
      // Item cancelado por item (fica visível ativo=true CANCELADA) nunca é executado —
      // fecha a porta de um POST com itemIds que o alcançasse.
      if (item.status === 'CANCELADA') return false;
      if (item.aplicadaPeloProprietario) return false;
      if (itemIdsFiltro && !itemIdsFiltro.includes(item.id)) return false;
      if (elegivelParaFluxoNovo(item)) {
        return (item.dosesExecutadas ?? 0) < dosesTotaisEsperadas(item);
      }
      return janelaDoItem(item, hojeStr).dentro && !executadoHojeItem(item, hojeStr, fuso);
    });
    if (itensHoje.length === 0) {
      return res.status(400).json({ error: 'Nenhum item da prescrição para executar agora.' });
    }

    const agora = new Date();

    // ─── Gate de horário — ANTES de tocar em estoque/fatura/log ───────────────
    //
    // Roda para TODO item de `itensHoje`, venha a chamada do ícone "Executar"
    // (um itemId) ou do "Executar Todos" (vários) — os dois caminhos passam por
    // aqui, que é o que corrige a divergência de comportamento entre eles.
    //
    //   ANTECIPADA (dose futura) → 400 EXECUCAO_FUTURA, liberada por
    //     `confirmarAntecipacao`. 🔴 NÃO é bloqueio: a resposta CARREGA o horário
    //     previsto para a tela poder dizer "estava prevista para 24/08 às 07:44" e
    //     PERGUNTAR. Confirmado, segue o caminho normal — inclusive o rolling
    //     schedule, que recalcula as doses seguintes a partir do horário REAL
    //     desta (`calcularProximaDose(agora, …)`, mais abaixo).
    //   ATRASADA                 → 400 CONFIRMACAO_NECESSARIA, liberada por
    //     `confirmarHorario` (aviso simples): a dose já era devida, atrasar não
    //     inventa dose nova.
    //   Sem âncora (`semAncoraDeHorario`) → não há horário previsto: esta
    //     execução é justamente quem vai fixá-lo. Nada a comparar, nada a
    //     confirmar. É o que sustenta "Hora Início não é obrigatória".
    for (const item of itensHoje) {
      if (!elegivelParaFluxoNovo(item)) continue;
      const previsto = horarioPrevistoDoItem(item);
      if (!previsto) continue;                      // semAncoraDeHorario
      const classificacao = classificarExecucao(agora, previsto);
      if (classificacao === 'NO_HORARIO') continue;

      if (classificacao === 'ANTECIPADA') {
        if (!confirmarAntecipacao) {
          return res.status(400).json({
            erro:        'EXECUCAO_FUTURA',
            error:       `A próxima dose de "${item.medicamento}" está prevista para ${fmtDataHora(previsto, fuso)}. Confirme a antecipação para executar agora.`,
            itemId:      item.id,
            medicamento: item.medicamento,
            // Qual dose do curso está sendo antecipada — a tela mostra "(03/05)".
            // Vem do backend (e não do contador do front) porque o "Executar Todos"
            // não sabe qual dos itens do lote foi o barrado: a resposta traz o item.
            numeroDose:  (item.dosesExecutadas ?? 0) + 1,
            totalDoses:  dosesTotaisEsperadas(item),
            previsto,
            agora,
            classificacao,
          });
        }
        continue;
      }

      if (!confirmarHorario) {
        return res.status(400).json({
          erro:          'CONFIRMACAO_NECESSARIA',
          itemId:        item.id,
          medicamento:   item.medicamento,
          previsto,
          agora,
          classificacao,
        });
      }
    }

    // Quantidade a debitar/faturar por item: UMA dose (elegível) ou o dia inteiro
    // (legado) — ver lib/agendaDoses.js e a nota em `debitarEstoqueDia`.
    const resolverQtdExecucao = (item) =>
      elegivelParaFluxoNovo(item) ? (parseFloat(item.dosagem) || 1) : calcularQuantidadeDiaria(item);

    const empresaIdEfetivo = grupo.empresaId ?? req.empresaId ?? null;

    // 🔴 SALDO DE ESTOQUE NÃO BLOQUEIA A EXECUÇÃO (2026-09-23, a pedido).
    //
    // Aqui havia um 409 `ESTOQUE_INSUFICIENTE` (`verificarEstoqueParaDia`) que RECUSAVA
    // a execução quando o saldo não cobria a dose — e só acontecia para o medicamento
    // CADASTRADO no estoque: o que não está cadastrado sempre passou direto
    // (`estoques.length === 0` → ignora). Ou seja, a clínica que controla o estoque
    // direitinho era a única impedida de registrar a dose que ela ACABOU DE APLICAR.
    //
    // Estoque é CONTROLE, não autorização clínica: a dose já foi dada na baia, e recusar
    // o registro não devolve o frasco — só apaga o rastro (fatura, histórico, conta a
    // pagar). A divergência de saldo se resolve no Ajuste de Estoque, que existe
    // exatamente para isso.
    //
    // ⚠️ `debitarEstoqueDia` continua debitando o que HOUVER, em FEFO, e para quando o
    // lote zera (`if (estoque.qtdEstoque <= 0) continue`) — não gera saldo negativo nem
    // movimento fantasma. O que faltar simplesmente não é debitado, e a linha da fatura
    // sai pelo que de fato saiu da prateleira (mesmo caminho do item sem estoque
    // cadastrado, que já era lançado com valor 0 "para o financeiro saber").
    //
    // ⚠️ A trava da FINALIZAÇÃO (`finalizar`, 409 com `forcarFinalizacao`) NÃO muda:
    // lá a prescrição ainda vai ser escrita e dá tempo de decidir. Aqui a aplicação já
    // aconteceu. `verificarEstoqueParaDia` segue existindo (e travada por
    // `produtoMultidose.test.js`) — o que saiu foi o BLOQUEIO, não a regra de unidade.

    const animal = await prisma.animal.findUnique({ where: { id: grupo.animalId }, select: { userId: true } });
    const proprietarioId = animal?.userId ?? null;

    // Quem SOLICITOU — é o que a conta a pagar precisa dizer ("quem fez a
    // solicitação", no pedido de 2026-09-10). É QUEM PRESCREVEU, não quem executou:
    // a compra foi provocada pela prescrição, e o plantonista que aplica a dose não
    // decidiu comprar nada. Resolvido UMA vez, fora do laço — dentro dele seria uma
    // consulta por item.
    const solicitante = grupo.veterinarioId
      ? await prisma.user.findUnique({
          where: { id: Number(grupo.veterinarioId) }, select: { id: true, fullName: true },
        }).catch(() => null)
      : null;

    await prisma.$transaction(async (tx) => {
      // Debita a quantidade resolvida por item (multi-lote FEFO) e retorna
      // preços/unidades por medicamento. Passa o grupoId para abater as reservas
      // deste grupo junto com a baixa.
      const { precos, jaEntregues, porEmbalagem, entregas, unidadesFaturadas } =
        await debitarEstoqueDia(tx, itensHoje, empresaIdEfetivo, grupoId, resolverQtdExecucao);

      // Lança na fatura ABERTA do proprietário NESTA empresa
      const fatura = await getOrCreateFatura(tx, proprietarioId, empresaIdEfetivo);

      // 🔴 O PRESTADOR INFORMADO NA EXECUÇÃO é aplicado ANTES do laço: o valor do
      // procedimento (`resolverValorProcedimento`), o recibo e a conta a pagar leem
      // `item.prestadorId`, e aplicá-lo depois deixaria a cobrança com um prestador e o
      // recibo com outro. Gravado no item na MESMA transaction — sem isso o plantão
      // seguinte não saberia quem executou.
      // ⚠️ Prestador de OUTRA empresa é descartado: o id vem do cliente, e o RLS
      // recusaria a leitura — mas depender só dele deixaria a intenção implícita.
      for (const item of itensHoje) {
        if (item.tipo !== 'PROCEDIMENTO') continue;
        const escolhido = prestadoresDaExecucao.get(item.id);
        if (!escolhido || Number(escolhido) === Number(item.prestadorId)) continue;
        const valido = await tx.prestador.findFirst({
          where:  { id: escolhido, ...(empresaIdEfetivo ? { empresaId: empresaIdEfetivo } : {}) },
          select: { id: true },
        });
        if (!valido) continue;
        item.prestadorId = escolhido;
        await vinculoPrestador.gravarPrestadorDoItem(tx, item.id, escolhido, 'PROCEDIMENTO');
      }

      for (const item of itensHoje) {
        // precos já contém o valor proporcional da dose (regra de 3)
        // MEDICAMENTO sem estoque no sistema → valor 0 na fatura (lança para o financeiro saber)
        // PROCEDIMENTO → valor do combo/valor da empresa/catálogo (Cadastro > Procedimentos)
        // Valor da dose: o que foi ACEITO no orçamento tem precedência; sem orçamento,
        // procedimento sai pelo catálogo/combo e medicamento pelo preço do lote debitado.
        const valorDaDose = item.valorOrcado != null
          ? item.valorOrcado
          : (item.tipo === 'PROCEDIMENTO'
              ? await resolverValorProcedimento(tx, empresaIdEfetivo, item.medicamento, item.prestadorId)
              : (item.medicamentoCatId ? (precos.get(item.medicamentoCatId) ?? 0) : 0));
        const descricao = descricaoItemFatura(item);

        // Fornecido pelo cliente NÃO é cobrado — não gera item na fatura, mesmo após
        // executado. (A seringa/agulha da aplicação, insumos da clínica, continuam
        // sendo lançados abaixo quando a via for injetável.)
        // É AQUI que nasce a cobrança do item sem flag nenhuma — a finalização deixou
        // de lançá-lo em 2026-08-01 (ver a matriz em `finalizar`). O item aplicado pelo
        // proprietário nem chega neste laço: `itensHoje` já o excluiu.
        // 🔴 SEM ENTREGA NESTA DOSE — nada de nova cobrança (2026-09-18). O produto sem
        // multidose prescrito em conteúdo ("5 mL de xarope") sai do estoque quando um
        // frasco é ABERTO: nas doses que saem de um frasco já aberto o cliente está
        // usando o que já pagou. Sem esta guarda a linha somaria quantidade a cada
        // aplicação e a fatura cobraria dez frascos por um. Ver `entregaPorEmbalagem`.
        // ⚠️ Só a COBRANÇA é pulada; a dose continua sendo marcada como executada mais
        // abaixo, e a seringa/agulha da aplicação continuam sendo lançadas — cada
        // aplicação usa um insumo novo.
        const entregaJaFeita = jaEntregues.has(item.id);
        // 🔴 QUANTAS EMBALAGENS ESTA EXECUÇÃO ENTREGOU (2026-09-19). Quase sempre 1, mas
        // uma dose maior que o frasco abre várias de uma vez (dose de 250 mL num frasco
        // de 100 mL abre três). `valorDaDose` é o TOTAL do que foi debitado, então a
        // linha precisa do UNITÁRIO — com `quantidade: 3` e o total no `valor`, a
        // fatura cobraria nove frascos.
        // ⚠️ Fora da entrega por embalagem nada muda: quantidade 1 e o valor da dose,
        // que é o que a consolidação vem somando desde sempre.
        const embalagensEntregues = porEmbalagem.has(item.id) ? (entregas.get(item.id) ?? 1) : 1;
        // 🔴 QUANTIDADE DA LINHA DA FATURA (2026-09-23). Três casos, nesta ordem:
        //   1. entrega por EMBALAGEM  → tantas quantas esta execução abriu;
        //   2. unidade AVULSA         → as unidades que saíram do estoque ("2 Un.");
        //   3. multidose / sem estoque→ 1, que é "uma dose", como sempre foi.
        // `valorDaDose` é sempre o TOTAL do que foi entregue, então o `valor` da linha
        // é ele DIVIDIDO por isto — senão a fatura cobraria a quantidade ao quadrado.
        const qtdFaturada = porEmbalagem.has(item.id)
          ? embalagensEntregues
          : (unidadesFaturadas.get(item.id) ?? 1);

        if (!item.medicamentoCliente && !entregaJaFeita) {
          // Prescrição finalizada ANTES da mudança já tem uma linha zerada criada na
          // finalização: na PRIMEIRA execução ela é aproveitada (só confirma o valor)
          // em vez de duplicar.
          // `item.executadoEm` ainda reflete o estado ANTES desta execução (a marcação
          // acontece adiante no laço) e `itensHoje` já excluiu quem executou hoje.
          const primeiraExecucao = !item.executadoEm;
          const candidatoDaFinalizacao = primeiraExecucao
            ? await tx.faturaItem.findFirst({ where: { prescricaoId: item.id }, orderBy: { id: 'asc' } })
            : null;
          // ⚠️ Só reaproveita a linha se ela for EXCLUSIVAMENTE deste item. Desde que a
          // consolidação passou a juntar origens diferentes (2026-09-17), a linha
          // achada pela FK pode já ter doses de OUTRA prescrição — e reescrever `valor`
          // ali reprecificaria retroativamente o que a outra já cobrou. `null` da lib
          // ("não sei", base sem a tabela) não bloqueia: ali nada é compartilhado.
          const compartilhada = candidatoDaFinalizacao
            ? await itemOrigens.temOutraOrigem(tx, candidatoDaFinalizacao.id, 'prescricaoId', item.id)
            : false;
          const lancamentoDaFinalizacao = compartilhada === true ? null : candidatoDaFinalizacao;
          if (lancamentoDaFinalizacao) {
            await tx.faturaItem.update({
              where: { id: lancamentoDaFinalizacao.id },
              data:  { descricao, valor: valorDaDose },
            });
          } else {
            // Doses SEGUINTES do mesmo item somam na QUANTIDADE da linha que já existe
            // (mesma descrição, mesmo valor unitário) em vez de repetir a linha na
            // fatura. Desde 2026-09-17 a chave NÃO inclui mais a ORIGEM: a dose do
            // atendimento seguinte cai na MESMA linha e o número dele entra como
            // observação, com data e quantidade. Ver `adicionarOuSomarFaturaItem`.
            await adicionarOuSomarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     grupo.animalId,
              tipo:         item.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
              descricao,
              // UNITÁRIO: `valorDaDose` é o TOTAL entregue nesta execução; a linha
              // guarda o preço de UMA unidade/embalagem/dose. Ver `qtdFaturada`.
              valor:        valorDaDose / qtdFaturada,
              quantidade:   qtdFaturada,
              veterinarioId,
              prescricaoId: item.id,
              // Data da CONTRIBUIÇÃO, que é o que a observação da linha mostra — a
              // linha consolidada não tem "a" data, tem uma por execução.
              ocorridoEm:   agora,
            });
          }
        }

        // 🔴 RECIBO DO PRESTADOR — o outro lado do balcão. A fatura acima registra o
        // que se COBRA do cliente; esta linha registra o que a clínica DEVE a quem
        // executou. Vai na MESMA transaction de propósito: ou o cliente é cobrado e o
        // prestador entra no recibo, ou nada acontece — fora dela existiria a janela
        // em que a clínica cobrou e não deve a ninguém.
        //
        // ⚠️ SNAPSHOT: `registrarExecucao` congela os dois valores E a forma de
        // pagamento do prestador. Recalcular na leitura faria o recibo de março mudar
        // de valor quando o percentual fosse renegociado em setembro.
        //
        // ⚠️ Registra mesmo com `medicamentoCliente` (item fornecido pelo cliente, que
        // NÃO é cobrado): o serviço foi prestado e o prestador tem de ser pago. Nesse
        // caso `valorCliente` é 0, então a comissão PERCENTUAL sai 0 — que é a
        // consequência correta de não haver receita, e não um erro de cálculo.
        //
        // ⚠️ `registrarExecucao` nunca lança: falha aqui não pode derrubar a execução
        // clínica (base ainda não migrada devolve null e a fatura sai como sempre saiu).
        if (item.tipo === 'PROCEDIMENTO' && item.prestadorId) {
          const doVinculo = await vinculoPrestador.resolverValoresPorNome(
            tx, empresaIdEfetivo, item.medicamento, item.prestadorId,
          );
          // `nome` entrou junto (2026-09-10): a conta a pagar grava o nome do credor
          // como SNAPSHOT, para dizer a quem se deve mesmo que o cadastro seja
          // renomeado ou inativado depois.
          const prestadorCadastro = await tx.prestador.findUnique({
            where:  { id: Number(item.prestadorId) },
            select: { nome: true, tipoPagamento: true, formaPagamento: true, valorPagamento: true },
          });
          const prestador = prestadorCadastro;
          await vinculoPrestador.registrarExecucao(tx, {
            empresaId:        empresaIdEfetivo,
            prestadorId:      item.prestadorId,
            prescricaoId:     item.id,
            animalId:         grupo.animalId,
            animalNome:       grupo.animal?.nome ?? '',
            procedimentoNome: item.medicamento,
            quantidade:       1,
            // A base do PERCENTUAL é o Valor Cobrado para o Cliente desta execução —
            // o MESMO número que acabou de ir para a fatura. Item fornecido pelo
            // cliente não gera cobrança, logo a base é 0.
            valorCliente:     item.medicamentoCliente ? 0 : valorDaDose,
            valorPrestador:   doVinculo.valorPrestador,
            tipoPagamento:    prestador?.tipoPagamento  ?? null,
            formaPagamento:   prestador?.formaPagamento ?? null,
            valorPagamento:   prestador?.valorPagamento ?? null,
            executadoEm:      agora,
            executadoPorId:   veterinarioId,
            // O id da linha da fatura não é rastreado aqui de propósito:
            // `adicionarOuSomarFaturaItem` CONSOLIDA doses na mesma linha, então não
            // existe um FaturaItem por execução para apontar. O recibo se sustenta
            // sozinho — ele é o documento do outro lado, não um espelho da fatura.
            faturaItemId:     null,
          });

          // 🔴 CONTA A PAGAR DO PRESTADOR (2026-09-10) — a mesma execução que gera o
          // recibo passa a abrir/alimentar a conta do mês dele, no molde da fatura.
          // ⚠️ O VALOR sai do ledger que acabou de ser gravado, não de uma segunda
          // conta: `calcularValorAPagar` é a fonte única da regra (POR_PROCEDIMENTO ×
          // PERCENTUAL × VALOR fixo × SALARIO), e recalcular aqui daria dois números
          // para a mesma dívida — com o recibo e a conta discordando entre si.
          const { valorAPagar } = vinculoPrestador.calcularValorAPagar({
            valorCliente:   item.medicamentoCliente ? 0 : valorDaDose,
            valorPrestador: doVinculo.valorPrestador,
            tipoPagamento:  prestador?.tipoPagamento  ?? null,
            formaPagamento: prestador?.formaPagamento ?? null,
            valorPagamento: prestador?.valorPagamento ?? null,
            quantidade:     1,
          });
          await contasPagar.lancarItem(tx, {
            empresaId:   empresaIdEfetivo,
            tipo:        'PRESTADOR',
            credorId:    item.prestadorId,
            credorNome:  prestadorCadastro?.nome ?? '',
            animalId:    grupo.animalId,
            animalNome:  grupo.animal?.nome ?? '',
            descricao:   item.medicamento,
            quantidade:  1,
            valor:       valorAPagar,
            solicitanteId:   solicitante?.id ?? null,
            solicitanteNome: solicitante?.fullName ?? '',
            ocorridoEm:  agora,
            // Idempotência: uma linha por ITEM de prescrição executado. Reprocessar a
            // mesma execução não cria a segunda (índice único parcial no banco).
            origemTipo:  contasPagar.ORIGENS.EXECUCAO_PRESTADOR,
            origemId:    item.id,
            // 🔴 LANÇA MESMO SEM VALOR (a pedido, 2026-09-18). Prestador sem forma de
            // pagamento cadastrada, ou procedimento sem preço no vínculo, devolve
            // `valorAPagar = 0` — e até aqui isso fazia a linha NÃO EXISTIR: o serviço
            // era prestado, a clínica devia, e a tela de Pagamentos não mostrava nada.
            // Zerado, a dívida aparece como PENDÊNCIA e o financeiro informa o valor
            // na própria tela. O zero é honesto ("ninguém disse quanto vale"); o que
            // continua proibido é ADIVINHAR um número.
            permitirSemValor: true,
          });
        }

        // 🔴 CONTA A PAGAR DO FORNECEDOR (2026-09-10) — o medicamento que a clínica
        // NÃO estoca e pediu ao fornecedor vira dívida com ele NESTE momento, o mesmo
        // em que o cliente é cobrado. Na MESMA transaction, pela mesma razão do
        // recibo: fora dela existiria a janela em que a clínica cobrou e não deve.
        //
        // ⚠️ Só MEDICAMENTO (aqui a vacina tem caminho próprio, em
        // `VacinaClinicaController`) e só o que é PRODUTO — item de estoque próprio já
        // foi comprado antes, na entrada da nota; cobrá-lo de novo aqui contaria a
        // mesma compra duas vezes.
        //
        // ⚠️ O valor é o de COMPRA cadastrado no produto, nunca o cobrado do cliente:
        // usar o segundo afirmaria que a clínica paga ao fornecedor o mesmo que cobra,
        // e zeraria a margem dela no relatório. Sem preço de compra cadastrado, NÃO
        // lança — dívida de valor inventado é pior que dívida ausente, e a tela de
        // Produtos é onde isso se resolve.
        //
        // ⚠️ Entrega por EMBALAGEM segue a mesma regra da fatura: a compra é do frasco
        // pedido ao fornecedor, e a quantidade é a de EMBALAGENS abertas nesta execução
        // — não a dosagem da receita, que está em mL.
        if (item.tipo === 'MEDICAMENTO' && !item.medicamentoCliente && item.medicamentoCatId && !entregaJaFeita) {
          const produto = await produtoFornecedor.fornecedorDoItem(
            tx, empresaIdEfetivo, item.medicamentoCatId,
          );
          if (produto?.valorUnitario != null) {
            // Entrega por embalagem: a compra é do FRASCO, e são tantos quantos esta
            // execução abriu — não a dosagem da receita, que está em mL.
            const qtd = porEmbalagem.has(item.id)
              ? embalagensEntregues
              : (Number(resolverQtdExecucao(item)) || 1);
            await contasPagar.lancarItem(tx, {
              empresaId:   empresaIdEfetivo,
              tipo:        'FORNECEDOR',
              credorId:    produto.fornecedorId,
              credorNome:  produto.fornecedorNome ?? '',
              animalId:    grupo.animalId,
              animalNome:  grupo.animal?.nome ?? '',
              descricao:   item.medicamento,
              quantidade:  qtd,
              valor:       produto.valorUnitario,
              solicitanteId:   solicitante?.id ?? null,
              solicitanteNome: solicitante?.fullName ?? '',
              ocorridoEm:  agora,
              origemTipo:  contasPagar.ORIGENS.PRESCRICAO_ITEM,
              origemId:    item.id,
            });
          }
        }

        // Via injetável (IV/IM/ID/SC/EV): 1 seringa + 1 agulha por dose aplicada.
        // Se não houver estoque cadastrado/disponível, apenas não lança (não bloqueia a execução).
        if (item.tipo === 'MEDICAMENTO' && isViaInjetavel(item.via)) {
          for (const prefixo of ['Seringa', 'Agulha']) {
            const insumo = await debitarInsumoUnidade(
              tx, prefixo, empresaIdEfetivo,
              `Aplicação injetável (${item.via}): ${item.medicamento}`,
            );
            if (!insumo) continue;
            // Sem o `[AG-0012]` pelo mesmo motivo da dose: a seringa de dois
            // atendimentos é a MESMA seringa, e o número vive na observação da linha.
            const descInsumo = `${insumo.nome} — aplicação ${item.via} (${item.medicamento})`;
            // Mesma consolidação da dose: 7 aplicações injetáveis = "Seringa … Quant.: 7",
            // não 7 linhas de seringa na fatura.
            await adicionarOuSomarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     grupo.animalId,
              tipo:         'PROCEDIMENTO',
              descricao:    descInsumo,
              valor:        insumo.valor,
              quantidade:   1,
              veterinarioId,
              prescricaoId: item.id,
              ocorridoEm:   agora,
            });
          }
        }

        // Trava o item (edição/exclusão) e registra a data da última execução.
        // Elegível: grava a DOSE individual (rolling schedule + auditoria); legado:
        // só marca `executadoEm`, como sempre (o Mapa de Atendimento usa isso para
        // saber se a dose de HOJE já foi dada).
        if (elegivelParaFluxoNovo(item)) {
          // Sem âncora, é ESTA execução que fixa o horário-base do curso: não há
          // previsto anterior a comparar, então ela é, por definição, no horário.
          // `horarioPrevisto` da dose recebe `agora` — a coluna é NOT NULL e o
          // valor honesto do "previsto" desta 1ª dose é o instante em que ela
          // aconteceu (é dele que sai `proximaDoseEm` das seguintes).
          const previsto      = horarioPrevistoDoItem(item) ?? agora;
          const classificacao = classificarExecucao(agora, previsto);
          const diffMin       = diferencaEmMinutos(agora, previsto);

          // 🔴 AS DOSES SEGUINTES SÃO RECALCULADAS A PARTIR DE `agora` — o horário
          // REAL desta execução, nunca da grade original. É isto (rolling schedule)
          // que faz a dose ANTECIPADA deslocar o curso inteiro junto: antecipou a
          // dose das 20:00 para as 14:00, a próxima de 12/12h passa a ser 02:00, não
          // 08:00. Vale igual para a atrasada. Usar `previsto` aqui em vez de `agora`
          // devolveria a grade fixa e faria a dose seguinte nascer fora de hora.
          await tx.prescricao.update({
            where: { id: item.id },
            data:  {
              executadoEm:     agora,
              dosesExecutadas: { increment: 1 },
              proximaDoseEm:   calcularProximaDose(agora, item.frequencia),
            },
          });
          await tx.prescricaoExecucaoDose.create({
            data: {
              prescricaoId:     item.id,
              grupoId,
              animalId:         grupo.animalId,
              numeroDose:       (item.dosesExecutadas ?? 0) + 1,
              horarioPrevisto:  previsto,
              horarioExecutado: agora,
              executadoPorId:   veterinarioId,
              classificacao,
              diferencaMinutos: diffMin,
            },
          });
          await registrarAuditoria(tx, req, {
            categoria:  'EXECUCAO',
            entidade:   'PRESCRICAO_DOSE',
            entidadeId: item.id,
            animalId:   grupo.animalId,
            // A justificativa (hoje OPCIONAL) vai para `motivo` — é o campo que a
            // tela de Auditoria exibe como texto do usuário (e o único que o
            // saneador de referências não reescreve). Sem ela, `motivo` fica
            // vazio: NUNCA preencher com frase do sistema, senão a auditoria
            // passaria a atribuir à pessoa um texto que ela não escreveu.
            motivo:     classificacao === 'ANTECIPADA' && justificativa ? justificativa : undefined,
            // "antecipada 120min, confirmada na execução" — o fato de ter havido
            // confirmação explícita é do SISTEMA e mora aqui, não no `motivo`. É o
            // que separa, na trilha, a dose antecipada com aval de quem executou de
            // uma eventual antecipação por outro caminho.
            detalhes:   `${grupo.animal?.nome ?? 'paciente'} — ${item.medicamento}: `
              + `previsto ${fmtDataHora(previsto, fuso)}, executado ${fmtDataHora(agora, fuso)} `
              + `(${CLASSIFICACAO_LABEL[classificacao]}${classificacao !== 'NO_HORARIO' ? ` ${Math.abs(diffMin)}min` : ''}`
              + `${classificacao === 'ANTECIPADA' && confirmarAntecipacao ? ', confirmada na execução' : ''})`,
          });
        } else {
          await tx.prescricao.update({ where: { id: item.id }, data: { executadoEm: agora } });
        }
      }

      // Transita para EXECUTADO só quando TODOS os itens ativos já foram executados —
      // elegível: todas as doses do curso já foram dadas; legado: o critério antigo
      // (executado e alcançou o último dia da janela). Backend-autoritativo — relê o
      // estado já atualizado. Item aplicado pelo proprietário está FORA da conta: ele
      // nunca será executado, e exigi-lo aqui deixaria o documento eternamente
      // FINALIZADO — preso na tela de execução mesmo com tudo já aplicado.
      const itensAtuais = (await anexarAplicadaProprietario(prisma, await tx.prescricao.findMany({
        where:  { grupoId, ativo: true },
        select: {
          id: true, executadoEm: true, dataInicio: true, duracaoDias: true,
          frequencia: true, horaInicio: true, dosesExecutadas: true,
        },
      }))).filter(i => !i.aplicadaPeloProprietario);
      const tudoConcluido = itensAtuais.length > 0 &&
        itensAtuais.every(item => elegivelParaFluxoNovo(item)
          ? (item.dosesExecutadas ?? 0) >= dosesTotaisEsperadas(item)
          : (item.executadoEm && janelaDoItem(item, hojeStr).ultimoDia));
      if (tudoConcluido) {
        await tx.prescricaoGrupo.update({
          where: { id: grupoId },
          data:  {
            status:         'EXECUTADO',
            executadoPorId: veterinarioId,
            executadoEm:    agora,
          },
        });
        // Curso concluído: libera eventuais reservas remanescentes do grupo
        await liberarReservas(tx, grupoId);
      }

      // O preenchimento do valor do item já lançado na finalização é um UPDATE —
      // não passa pelo incremento do lançamento de item. Recalcula para fechar.
      await recalcularTotal(tx, fatura.id);
    });

    const grupoAtualizado = await prisma.prescricaoGrupo.findUnique({ where: { id: grupoId }, include: GRUPO_INCLUDE });
    return res.json({ dados: { ...grupoAtualizado, numeroFormatado: formatNumero(grupoAtualizado.numero) } });
  } catch (err) {
    console.error('PrescricaoGrupoController.executar:', err);
    return res.status(500).json({ error: 'Erro ao executar prescrição.' });
  }
};

// ─── Ajustar Hora Início após a 1ª execução ───────────────────────────────────
// PATCH /clinica/prescricoes/grupos/:id/itens/:itemId/hora-inicio
//
// A 1ª dose de um item elegível ao rolling schedule pode acontecer fora do
// `horaInicio` prescrito (dose atrasada/antecipada, confirmada via
// CONFIRMACAO_NECESSARIA em `executar`) — isso já NÃO atrasa nem antecipa as
// doses SEGUINTES: `calcularProximaDose` sempre parte do horário REAL da última
// execução, nunca de `horaInicio`. O que fica desatualizado é só o CAMPO
// `horaInicio` em si — referência/exibição (chip, impressão) que continua
// mostrando o horário originalmente prescrito, agora divergente do que
// realmente está acontecendo. Este endpoint corrige só essa referência, quando
// o usuário confirma a pergunta feita pelo front logo após a 1ª execução.
const atualizarHoraInicioPosExecucao = async (req, res) => {
  try {
    const grupoId = Number(req.params.id);
    const itemId  = Number(req.params.itemId);
    const { horaInicio } = req.body;

    if (!horaInicio || !/^\d{2}:\d{2}$/.test(String(horaInicio))) {
      return res.status(400).json({ error: 'Informe o horário no formato HH:MM.' });
    }

    const item = await prisma.prescricao.findUnique({ where: { id: itemId }, include: { grupo: true } });
    if (!item || item.grupoId !== grupoId) {
      return res.status(404).json({ error: 'Item não encontrado.' });
      // SOMENTE LEITURA: paciente inativo congela o prontuário — a prescrição não é
      // alterada até o gestor reativar. Ver lib/animalInativo.js.
      if (await bloquearSeAnimalInativo(res, item.grupo?.animalId ?? item.animalId)) return;
    }
    if (!podeOperarRegistro(req, item.grupo?.veterinarioId ?? item.veterinarioId)) {
      return res.status(403).json({ error: 'Seu nível de permissão só permite alterar prescrições criadas por você.' });
    }
    // Só logo após a 1ª execução — é o único momento em que a pergunta "atualizar o
    // horário?" faz sentido (ver comentário acima). Depois disso o horário real de
    // cada dose já está gravado nos registros de execução; mudar `horaInicio` aqui
    // não teria mais relação com "a próxima dose vai mudar de horário" nenhuma.
    if ((item.dosesExecutadas ?? 0) !== 1) {
      return res.status(400).json({ error: 'Só é possível ajustar o horário logo após a primeira execução.', code: 'FORA_DA_JANELA' });
    }

    const horaAnterior = item.horaInicio;
    const atualizado = await prisma.$transaction(async (tx) => {
      const upd = await tx.prescricao.update({ where: { id: itemId }, data: { horaInicio } });
      await registrarAlteracao(tx, req, {
        entidade:    'PRESCRICAO', entidadeId: grupoId, animalId: item.animalId,
        donoAtualId: item.grupo?.veterinarioId ?? item.veterinarioId,
        campos:      { [`item.horaInicio`]: { de: horaAnterior, para: horaInicio } },
      });
      return upd;
    });

    return res.json({ dados: atualizado });
  } catch (err) {
    console.error('PrescricaoGrupoController.atualizarHoraInicioPosExecucao:', err);
    return res.status(500).json({ error: 'Erro ao atualizar o horário.' });
  }
};

// Item PENDENTE no dia informado — é o que decide se ele (e o grupo) aparece na
// fila de execução daquele dia.
//   LEGADO (sem horaInicio)      → `janelaDoItem`: qualquer dia dentro de
//     [dataInicio, dataInicio+duracaoDias) — o dia inteiro é uma dose só.
//   ELEGÍVEL (rolling schedule)  → 🔴 NUNCA usar `janelaDoItem` aqui: ela cobre a
//     janela do CURSO INTEIRO (ex.: 28 dias de "1x/semana × 4"), então usá-la
//     faria o item aparecer TODO santo dia da janela, não só nas 4 datas certas
//     — era exatamente esse o bug relatado ("agendado todos os dias"). O item SÓ
//     está pendente quando hoje é EXATAMENTE a data da próxima dose esperada
//     (`horarioPrevistoDoItem`) — nunca antes, e 🔴 NUNCA depois: regra de
//     produto explícita (2026-08-18) — "mesmo sem executar não pode mostrar em
//     outros dias". Dose perdida NÃO fica "atrasada, mas ainda pendente": some da
//     fila no dia seguinte e é cancelada pelo cron `cancelar_doses_prescricao_
//     perdidas` (`prescricaoCronService.js`). "A execução seguinte fica presa
//     esperando a anterior" é o ÚNICO atraso tolerado — e ele é automático: sem
//     a anterior, `proximaDoseEm` da seguinte nem existe ainda (rolling schedule).
//     Executado HOJE continua "pendente" nesta função de propósito — alimenta o
//     card "Histórico — executadas hoje" do front (que lê do MESMO resultado
//     desta rota); doses restantes em 0 (curso completo) tiram o item da fila.
function itemPendenteNoDia(item, hojeStr, fuso = null) {
  if (elegivelParaFluxoNovo(item)) {
    if (executadoHojeItem(item, hojeStr, fuso)) return true;
    if ((item.dosesExecutadas ?? 0) >= dosesTotaisEsperadas(item)) return false;
    // Ainda SEM âncora de horário (sem Hora Início e sem nenhuma dose dada): não
    // há data de próxima dose para casar — o item fica disponível em qualquer dia
    // da janela do curso, e a 1ª execução é que fixa a grade. Sem esta linha, um
    // item sem hora só apareceria no dia exato de `dataInicio` e sumiria depois.
    if (semAncoraDeHorario(item)) return dentroDaJanelaDoCurso(item, hojeStr);
    // Navegando o calendário da Execução de Prescrição para um dia FUTURO (além
    // de hoje): o rolling schedule real (`proximaDoseEm`) só existe depois da
    // dose ANTERIOR ser executada de verdade, então ainda não sabe responder
    // por um dia que nem chegou. Cai na PRÉVIA TEÓRICA do regime (frequência ×
    // duração) — mesma conta de `utils/posologia.ts#gerarResumoDoses` do front —
    // só para o item aparecer como PREVISTO; a execução continua bloqueada fora
    // de hoje (gate no front, `soVisualizacao={!isHoje}`).
    if (hojeStr > hojeNaEmpresa(fuso)) {
      return itemPrevistoParaDataFutura(item, hojeStr);
    }
    return dataLocalStr(horarioPrevistoDoItem(item), fuso) === hojeStr;
  }
  return janelaDoItem(item, hojeStr).dentro;
}

// ─── Listar para execução ─────────────────────────────────────────────────────
// Retorna grupos FINALIZADO cujo janela de tratamento inclui hoje.
// Filtro de data usa dataInicio + duracaoDias dos itens (não updatedAt) — exceto
// para itens elegíveis ao rolling schedule, que usam `itemPendenteNoDia` (a data
// REAL da próxima dose, não a janela do curso inteiro).

const listarParaExecucao = async (req, res) => {
  try {
    const { busca, empresaId, animalId, data } = req.query;

    const whereGrupo = {
      // A prescrição vai para a execução assim que o GRUPO é FINALIZADO (prescrição
      // finalizada dentro da evolução) — NÃO depende mais de a evolução estar FINALIZADA.
      // (Premissa alterada 2026-07-16: antes exigia evolucao.status = 'FINALIZADA'.)
      // EXECUTADO incluído para o histórico do dia (executado no último dia da janela).
      // CANCELADO incluído para exibir com status "Cancelada" (execução bloqueada) as
      // prescrições canceladas no meio da execução — filtradas abaixo (só com execução).
      status: { in: ['FINALIZADO', 'CANCELADO_PARCIALMENTE', 'EXECUTADO', 'CANCELADO'] },
    };
    // TENANCY DO DOCUMENTO — o plantão é da EMPRESA ATIVA e de mais ninguém.
    //
    // ⚠️ Esta linha é o que impede o vazamento entre clínicas. O `empresaId` só entrava
    // quando vinha na QUERY, e o front nunca o manda: o filtro simplesmente não existia,
    // e o escopo por ANIMAL abaixo não substitui isso por dois motivos —
    //   1. `buildAnimalScopeWhere` inclui, para dono/gestor, os vínculos do vet em
    //      QUALQUER empresa (regra da tela de Pacientes: "base própria vê o co-tratado
    //      de outra empresa" — CLAUDE.md §5). Correto lá, vazamento aqui.
    //   2. Mesmo com o animal certo, o MESMO paciente pode ser tratado por duas
    //      clínicas: sem este filtro, o plantão de uma exibia (e deixava executar) a
    //      prescrição da outra.
    // Mesma decisão da busca global (§16): escopo é a empresa do contexto, nunca
    // "todos os vínculos do usuário". `empresaId` da query NÃO pode ampliar — ele só
    // estreita dentro da empresa ativa; tenant vindo do cliente jamais define escopo.
    // Seguro para o legado: 100% dos PrescricaoGrupo têm `empresaId` gravado.
    if (req.empresaId) {
      whereGrupo.empresaId = Number(req.empresaId);
    } else if (empresaId) {
      whereGrupo.empresaId = Number(empresaId);
    }
    if (animalId)  whereGrupo.animalId  = Number(animalId);

    // Escopo base × convidado por ANIMAL (mesma regra da listagem/agendamento): o vet
    // vinculado (convidado) só vê os grupos dos SEUS animais + os liberados por outros
    // vets (designação) na empresa ativa; dono/gestor vê os pacientes que trata.
    //
    // 🔴 O PLANTÃO NÃO SEGUE O EXPEDIENTE DA EMPRESA (2026-09-22).
    // `ignorarDiaDeTrabalho` mantém a restrição "Atender somente no local de
    // trabalho" pelo LOCAL e desliga o recorte por DIA DA SEMANA. Numa clínica
    // seg–sex, os dias do local do profissional são validados contra o expediente
    // da empresa (`validarLocaisContraExpedienteEmpresa`) — ninguém consegue nem
    // ser cadastrado para sábado —, então a fila do fim de semana nascia VAZIA
    // para quem tem a opção ligada, e as doses daqueles dias eram depois
    // canceladas pelo cron de dose perdida, sem ninguém ver. Tratamento corre
    // 24/7: um "8 em 8h por 5 dias" atravessa o fim de semana.
    const { where: animalScopeWhere } = await buildAnimalScopeWhere(req, { ignorarDiaDeTrabalho: true });
    // `ANIMAL_VISIVEL` = `{ ativo: true, user: { ativo: true } }` — EXCLUSÃO LÓGICA
    // (lib/visibilidade.js). O `ativo: true` do animal já estava aqui; o que faltava
    // era o do CLIENTE: inativar o proprietário não tirava do plantão as prescrições
    // dos animais dele.
    whereGrupo.animal = { ...animalScopeWhere, ...ANIMAL_VISIVEL };

    const gruposCrus = await prisma.prescricaoGrupo.findMany({
      where:   whereGrupo,
      include: {
        veterinario:  { select: { id: true, fullName: true } },
        finalizadoPor:{ select: { id: true, fullName: true } },
        executadoPor: { select: { id: true, fullName: true } },
        animal: {
          select: {
            id: true, nome: true, photoUrl: true, peso: true, baia: true,
            // A fila do plantão mostra "Local • Peso • Idade" sob o paciente: quem vai
            // aplicar precisa saber PARA ONDE ir e o peso da dose. `local` é o campo
            // textual legado (fallback de quem foi cadastrado antes do catálogo).
            local: true, dataNascimento: true, idadeAnos: true,
            localizacao: { select: { nome: true } },
            especie: { select: { nome: true } },
            raca:    { select: { nome: true } },
          },
        },
        // 🔴 SEM `where: { ativo: true }` (2026-09-04). Cancelar pelo plantão marca
        // `ativo: false` em TODO item ainda não executado (`cancelarNaExecucao`), então
        // a prescrição cancelada sem nenhuma execução ficava com ZERO item ativo, caía
        // no `.filter(g => g.itens.length > 0)` logo abaixo e NUNCA chegava à tela — a
        // aba "Cancelado" do Histórico estava sempre vazia para medicamento e
        // procedimento. O recorte por `ativo` passou a ser feito por GRUPO em
        // `itensVisiveis`: no cancelado o item inativo É o registro; nos demais ele é
        // item removido da prescrição e continua escondido.
        itens: {
          include: {
            medicamentoCat: { select: { id: true, nome: true } },
            // Executor da dose — existe por ITEM mesmo quando o GRUPO inteiro ainda
            // não chegou a EXECUTADO (grupo.executadoPor só é gravado quando TODOS
            // os itens terminam). Sem isto, um grupo com medicamento pronto e
            // procedimento ainda pendente (ou vice-versa) mostrava a dose já feita
            // no Histórico do dia sem dizer quem a aplicou. `take: 1` + orderBy
            // desc = a dose mais recente deste item.
            // 🔴 Histórico COMPLETO das doses (era `take: 1`): a tela de execução
            // mostra "Dose 01/02 — Executado às 18:00" por dose, e o horário real
            // de cada uma só existe aqui. `numeroDose` asc para a linha N do card
            // casar com a dose N sem o front ter de reordenar.
            execucoesDose: {
              select: {
                numeroDose: true, horarioExecutado: true, horarioPrevisto: true,
                classificacao: true,
                executadoPor: { select: { id: true, fullName: true } },
              },
              orderBy: { numeroDose: 'asc' },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ animalId: 'asc' }, { numero: 'asc' }],
    });

    // O que o PROPRIETÁRIO aplica em casa não é serviço da clínica: sai do plantão.
    // O corte é por ITEM — o mesmo documento pode ter o injetável da baia (fica) e a
    // pomada que o tratador passa (sai). Grupo que ficou sem nenhum item some da tela;
    // como FaturaItem e baixa de estoque só nascem na EXECUÇÃO, não aparecer aqui é o
    // que garante que esse item nunca seja cobrado nem debitado.
    // "Se necessário"/"SOS" também saem da fila pelo mesmo corte por item — não têm
    // agenda prevista (ver FREQUENCIAS_FORA_DA_EXECUCAO), então não pertencem à lista
    // de pendências do plantão.
    // Item inativo só é registro no grupo CANCELADO (ver o `include` acima); em
    // qualquer outro status ele foi removido da prescrição e não deve aparecer.
    const itensVisiveis = g => (g.status === 'CANCELADO' ? g.itens : g.itens.filter(i => i.ativo));

    // 🔴 A UNIDADE QUE A TELA MOSTRA É A QUE O SISTEMA USA (2026-09-17, a pedido).
    //
    // A fila exibia `item.unidade` — o SNAPSHOT do que foi escrito na receita. Para o
    // produto que não declara conteúdo o estoque passou a ser contado em 'Un.', então a
    // tela dizia "20 mL" enquanto a baixa e a fatura falavam em embalagens. Quem aplica
    // a dose precisa ler a MESMA unidade que o sistema debita e cobra.
    //
    // ⚠️ `unidadeEstoque` vem das MESMAS funções da baixa (`mapaFormaCalculo` +
    // `unidadeDoEstoque`) — recalculá-la na tela criaria uma segunda regra, e é a
    // divergência entre as duas que este campo existe para eliminar.
    // ⚠️ A dosagem PRESCRITA não é reescrita: ela segue no item, e a tela a mostra ao
    // lado quando difere. Apagá-la esconderia de quem aplica os "20 mL" que o
    // veterinário indicou.
    const itensDeTodos = gruposCrus.flatMap(g => g.itens ?? []);
    const formasFila   = await mapaFormaCalculo(prisma, itensDeTodos);

    const grupos = (await anexarFlagEmGrupos(prisma, gruposCrus))
      .map(g => ({
        ...g,
        itens: itensVisiveis(g)
          .filter(i => !i.aplicadaPeloProprietario && !FREQUENCIAS_FORA_DA_EXECUCAO.has(i.frequencia))
          .map(i => (i.tipo === 'MEDICAMENTO' && i.medicamentoCatId
            ? { ...i, unidadeEstoque: unidadeDoEstoque(formasFila, i) }
            : i)),
      }))
      .filter(g => g.itens.length > 0);

    // Data de referência — usa param ?data=YYYY-MM-DD ou hoje
    // Dia de referência SEMPRE no fuso da CLÍNICA (ver lib/fusoEmpresa.js): o
    // servidor roda em Brasília e, para uma clínica em UTC−4/−5, "hoje" vira o dia
    // seguinte 1-2h antes da meia-noite local — a fila do plantão trocaria de dia
    // no meio do plantão da noite.
    const fuso    = await fusoDaEmpresa(req.empresaId);
    const hojeStr = (data && /^\d{4}-\d{2}-\d{2}$/.test(data))
      ? data
      : hojeNaEmpresa(fuso);
    const hoje    = new Date(hojeStr + 'T00:00:00Z'); // meia-noite UTC

    // Mantém apenas grupos onde pelo menos um item está PENDENTE hoje — cada item
    // decide pela sua própria regra (`itemPendenteNoDia`: janela do dia p/ legado,
    // data real da próxima dose p/ rolling schedule).
    // 🔴 CANCELADO é registro de AUDITORIA, não pendência do dia — aparece na aba
    // "Cancelado" pela DATA EM QUE FOI CANCELADO (`updatedAt` local), nunca pela
    // janela/próxima dose do item. Antes exigia `algum item executado`, mas o único
    // caminho de cancelamento hoje alcançável pela tela (`cancelar`/`cancelar-plantao`)
    // RECUSA cancelar se houve qualquer execução — ou seja, essa condição nunca era
    // satisfeita e a aba "Cancelado" da Execução de Prescrição nunca tinha o que
    // mostrar, mesmo para uma prescrição cancelada minutos antes.
    const dentroJanela = grupos.filter(g =>
      g.status === 'CANCELADO'
        ? dataLocalStr(g.updatedAt, fuso) === hojeStr
        : g.itens.some(item => itemPendenteNoDia(item, hojeStr, fuso))
    );

    // Filtro de busca textual (nome animal, baia, nº prescrição, vet)
    let resultado = dentroJanela;
    if (busca?.trim()) {
      const q = busca.toLowerCase();
      resultado = grupos.filter(g =>
        g.animal.nome.toLowerCase().includes(q) ||
        (g.animal.baia ?? '').toLowerCase().includes(q) ||
        String(g.numero).padStart(3, '0').includes(q) ||
        g.veterinario.fullName.toLowerCase().includes(q)
      );
    }

    // Adiciona diaAtual em cada item para exibição frontend (base UTC) + os campos
    // do fluxo por dose (elegível: doses dadas/esperadas + próximo horário — usados
    // pelo front para saber se ainda falta dose hoje e montar a tela de confirmação).
    const comDia = resultado.map(g => ({
      ...g,
      numeroFormatado: formatNumero(g.numero),
      itens: g.itens.map(item => {
        const inicioStr = new Date(item.dataInicio).toISOString().split('T')[0];
        const inicio    = new Date(inicioStr + 'T00:00:00Z');
        const diaAtual  = Math.floor((hoje.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const elegivel  = elegivelParaFluxoNovo(item);
        const { execucoesDose, ...itemSemDoses } = item;
        const doses = execucoesDose ?? [];
        return {
          ...itemSemDoses,
          diaAtual,
          dosesExecutadas:      elegivel ? (item.dosesExecutadas ?? 0) : null,
          dosesTotaisEsperadas: elegivel ? dosesTotaisEsperadas(item) : null,
          // `null` quando o item ainda não tem âncora — a tela lê isso como "sem
          // horário previsto ainda", não como "previsto para meia-noite".
          proximaDoseEm:        elegivel ? horarioPrevistoDoItem(item) : null,
          // Horário REAL de cada dose já aplicada — alimenta a linha
          // "Dose 01/02 — Executado às 18:00" do card de execução.
          doses: doses.map(d => ({
            numeroDose:       d.numeroDose,
            horarioExecutado: d.horarioExecutado,
            horarioPrevisto:  d.horarioPrevisto,
            classificacao:    d.classificacao,
            executadoPor:     d.executadoPor,
          })),
          // Executor da ÚLTIMA dose (ver comentário no `include` acima).
          executadoPorDose: doses.length ? doses[doses.length - 1].executadoPor ?? null : null,
        };
      }),
    }));

    // 🔴 O PACIENTE INATIVO CONTINUA SENDO DEVOLVIDO — sumir com ele daqui
    // esconderia da equipe que aquele tratamento existe e ficou parado.
    // ⚠️ Quem decide ONDE ele aparece é a TELA, e mudou em 2026-09-05: ele saiu da
    // fila "a executar" e passou a sair no HISTÓRICO, na aba "Paciente inativo"
    // (ExecucaoPrescricao.tsx#tipoPendenteEm). A regra de 02/09 — manter na fila,
    // só sem ação — deixava a linha no alto da tela oferecendo trabalho que ninguém
    // pode fazer, competindo com as doses do dia.
    // NÃO filtrar aqui: sem estas linhas a aba nova nasceria vazia.
    // O prontuário segue congelado — `executar`/`cancelar` respondem 400
    // (lib/animalInativo.js) — e a tela não renderiza esses botões (28-d).
    // ⚠️ `animalInativo` é lido por SQL cru (`lerInativosEmLote`), NUNCA pelo `where`
    // do Prisma: `Animal.inativo` é lida assim em todo o projeto porque o client pode
    // não estar regenerado (CLAUDE.md §11), e `where` com campo desconhecido derruba a
    // fila inteira com "Unknown argument".
    const inativos = await lerInativosEmLote(comDia.map(g => g.animalId ?? g.animal?.id));
    const fila = comDia.map(g => ({
      ...g,
      animalInativo: !!inativos.get(Number(g.animalId ?? g.animal?.id))?.inativo,
    }));

    return res.json({ dados: fila, total: fila.length });
  } catch (err) {
    console.error('PrescricaoGrupoController.listarParaExecucao:', err);
    return res.status(500).json({ error: 'Erro ao listar prescrições para execução.' });
  }
};

module.exports = {
  listarPorAnimal,
  obterPorId,
  criar,
  adicionarItem,
  atualizarItem,
  removerItem,
  finalizar,
  cancelar,
  cancelarNaExecucao,
  reabrirParaEdicao,
  executar,
  atualizarHoraInicioPosExecucao,
  listarParaExecucao,
  // Reusados por `prescricaoCronService.js` (cancelamento automático de dose
  // perdida) — mesmas funções que `removerItem` usa para cancelar UM item sem
  // deixar reserva de estoque órfã para os demais itens do grupo.
  criarReservas,
  liberarReservas,
  anexarAplicadaProprietario,
  // Reusada pela cascata da finalização do ATENDIMENTO (`lib/finalizacaoEvolucao.js`):
  // empresa sem etapa de execução cobra ali também o grupo promovido de SALVO.
  encerrarGrupoSemExecucao,
  // Exportadas para TESTE: a regra da dose multidose quebra em silêncio (o valor da
  // fatura sai errado sem erro nenhum), então precisa de gate sobre a conta PURA.
  qtdDoEstoque,
  entregaPorEmbalagem,
  embalagensDaExecucao,
  // Exportada para poder ser exercitada de verdade (gate e verificacao ao vivo):
  // e ela que decide, de uma so vez, QUANTO sai do estoque e QUANTO vai a fatura.
  debitarEstoqueDia,
  // Idem: "em que unidade este item é contado" decide a baixa E o preço da linha, e
  // errá-la não produz erro nenhum — só um saldo e uma fatura errados.
  unidadeDoEstoque,
};