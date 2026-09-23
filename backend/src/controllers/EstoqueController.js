// backend/src/controllers/EstoqueController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { registrarAuditoria } = require('../lib/auditoria');
const { registrarAtivacao, registrarInativacao, anexarTrilha } = require('../lib/cadastroAtivacao');
// 🔴 UNIDADE DO MEDICAMENTO ESCOLHIDA PELA CLÍNICA (copy-on-write no catálogo misto).
// A tela de estoque é onde ela se define — ver lib/unidadeMedicamento.js.
const { definirUnidadeDoMedicamento, UnidadeIndisponivelError } = require('../lib/unidadeMedicamento');
// 🔴 FORMA DE CÁLCULO (2026-09-16): quando o produto declara conteúdo medido, é ELA a
// unidade em que o estoque é contado e o preço é calculado — não a da embalagem.
const catalogoEmpresa = require('../lib/catalogoEmpresa');
const { UNIDADE_AVULSA, unidadeOperativa } = require('../lib/formaCalculo');
// 🔴 CONTA A PAGAR DA COMPRA (2026-09-18) — a entrada de estoque é o OUTRO LADO do
// balcão: o que a clínica comprou do fornecedor é o que ela DEVE a ele. Ver
// `lancarCompraDoFornecedor` logo abaixo.
const contasPagar = require('../lib/contasPagar');

/**
 * A unidade OPERATIVA do item: a Forma de Cálculo quando o produto a declara, senão a
 * unidade da embalagem (o comportamento de sempre).
 *
 * 🔴 POR QUE ISTO NÃO É COSMÉTICO: `calcPrecoUnitarioBase` converte a quantidade para a
 * unidade BASE pelo fator da unidade recebida. Com o estoque contado em litros e a
 * unidade do catálogo dizendo "mL", o preço sairia mil vezes errado e a baixa da dose
 * converteria 2 L em 2.000 mL contra um saldo de 6 — sem erro nenhum na tela.
 */
/** Anexa a forma de cálculo ao `medicamento` de cada linha de estoque (em BLOCO). */
async function anexarFormaAosItens(itens) {
  const lista = Array.isArray(itens) ? itens : [];
  if (lista.length === 0) return lista;
  const mapa = await catalogoEmpresa.multidosePorItem(
    prisma, lista.map((i) => i.medicamentoId).filter(Boolean));
  return lista.map((i) => (i.medicamento ? {
    ...i,
    medicamento: {
      ...i.medicamento,
      multidose:         mapa.get(i.medicamentoId)?.multidose ?? false,
      dosesPorEmbalagem: mapa.get(i.medicamentoId)?.dosesPorEmbalagem ?? null,
      formaCalculo:      mapa.get(i.medicamentoId)?.formaCalculo ?? null,
    },
  } : i));
}

async function formaDeclaradaDoItem(client, medicamentoId, unidadeCatalogo = null) {
  if (!medicamentoId) return null;
  const mapa = await catalogoEmpresa.multidosePorItem(client, [Number(medicamentoId)]);
  const info = mapa.get(Number(medicamentoId));
  if (!info) return null;
  // Fonte ÚNICA: `unidadeOperativa` conhece os quatro estados do cadastro (declara
  // conteúdo, LEGADO sem forma, marcado sem quantidade, não-multidose). Repetir a
  // condição aqui daria duas respostas para "em que este item é contado".
  return unidadeOperativa({ ...info, unidade: info.unidade ?? unidadeCatalogo });
}

/**
 * A unidade em que ESTA entrada é contada e precificada.
 *
 * 🔴 Sem forma declarada devolve **'Un.'**, não a unidade do catálogo (2026-09-17, a
 * pedido): a entrada de um produto que não é multidose grava `qtdEstoque = Qtd Produto`
 * (embalagens), então é em EMBALAGEM que ela é contada. Com a unidade do catálogo
 * ('g', 'kg', 'L') o fator de base entrava na conta e `precoUnitarioBase` saía por
 * grama/mililitro sobre um número que conta embalagens — mil vezes errado em 'kg'/'L'.
 * Em 'Un.' o fator é 1 e o preço é exatamente `valorRepassado ÷ Qtd Produto`.
 *
 * ⚠️ O parâmetro `unidadeCatalogo` FICOU só para as chamadas existentes e é ignorado —
 * quem decide a unidade é o PRODUTO (forma de cálculo), nunca a embalagem.
 */
async function unidadeOperativaDoItem(client, medicamentoId, unidadeCatalogo) {
  return (await formaDeclaradaDoItem(client, medicamentoId, unidadeCatalogo)) ?? UNIDADE_AVULSA;
}

/**
 * 🔴 A ENTRADA DE ESTOQUE NUNCA REESCREVE A UNIDADE DO PRODUTO.
 *
 * `unidade` no corpo aciona `definirUnidadeDoMedicamento`, que faz COPY-ON-WRITE no
 * catálogo. O campo Unidade desta tela virou LEITURA e mostra a unidade OPERATIVA
 * ('mL' com forma declarada, 'Un.' sem ela) — deixá-la chegar ao copy-on-write
 * trocaria "Frasco"/"g" por "mL"/"Un." no cadastro do produto e apagaria a distinção
 * entre a embalagem e o que está dentro dela.
 *
 * ⚠️ Antes isto só valia para quem DECLARA conteúdo; desde 2026-09-17 o não-multidose
 * também exibe uma unidade operativa ('Un.'), então o filtro passou a valer para todos.
 * Quem troca a unidade do produto é a tela de Produtos, onde a troca passa pelos guards
 * de estoque já movimentado.
 */
async function unidadeParaResolver() {
  return undefined;
}

/**
 * Preço por unidade base (R$/g, R$/mL ou R$/unidade contável) a partir do valor de UMA
 * EMBALAGEM e do que ela contém.
 *
 * 🔴 O 2º ARGUMENTO É O CONTEÚDO DE UMA EMBALAGEM, NUNCA A QUANTIDADE TOTAL
 * (2026-09-17, a pedido: "no estoque não multiplique o Valor Comprado e o Valor
 * Repassado pela quantidade"). Até aqui a tela multiplicava os dois valores pela Qtd
 * Produto antes de gravar, e esta função dividia pelo saldo inteiro — as duas operações
 * se cancelavam e o preço saía certo, mas o BANCO ficava com o valor TOTAL da compra em
 * campos rotulados "Valor Unitário". Quem lia o campo cru cobrava a compra inteira numa
 * linha só: `debitarInsumoUnidade` cobrava a CAIXA de seringas por UMA seringa, e
 * reabrir a entrada para editar trazia o total para um campo unitário.
 *
 * Agora o valor gravado é o da embalagem, como já era na vacina
 * (`LoteVacina.valorUnitarioRepassado` ÷ `dosesPorFrasco`), e a conta não depende mais
 * do saldo:
 *   frasco de 20 mL por R$ 100  ->  100 ÷ 20      = R$ 5,00/mL
 *   embalagem avulsa por R$ 30  ->  30  ÷ 1       = R$ 30,00/Un.
 *   embalagem de 1 kg por R$ 100 -> 100 ÷ 1.000 g = R$ 0,10/g
 *
 * ⚠️ Conteúdo `null`/0 é "o produto não declara conteúdo" e vale **1** — a embalagem é a
 * própria unidade. Não é ausência de dado: é o não-multidose, medido em 'Un.'.
 *
 * ⚠️ Como o saldo saiu da conta, dar baixa ou ajustar o estoque não mexe mais no preço.
 * Era esse acoplamento que fazia o caminho legado subir o preço a cada dose aplicada.
 *
 * ⚠️ UNIDADE CONTÁVEL USA FATOR 1 — devolver `null` ali jogaria a cobrança no caminho
 * legado (`precoUnitarioDoEstoque`), que divide pelo estoque RESTANTE.
 */
const FATOR_BASE_ESTOQUE = {
  'g': 1, 'mg': 0.001, 'kg': 1000, 'mcg': 0.000001,
  'ml': 1, 'l': 1000,
};
function calcPrecoUnitarioBase(valorPorEmbalagem, conteudoPorEmbalagem, unidade) {
  const valor = Number(valorPorEmbalagem);
  if (!valor || valor <= 0) return null;
  const conteudo = Number(conteudoPorEmbalagem) > 0 ? Number(conteudoPorEmbalagem) : 1;
  const fator    = FATOR_BASE_ESTOQUE[(unidade ?? '').trim().toLowerCase()] ?? 1;
  const base     = conteudo * fator;
  return base > 0 ? valor / base : null;
}

/**
 * Lança a COMPRA na conta a pagar do fornecedor.
 *
 * 🔴 POR QUE ISTO FALTAVA (relatado 2026-09-18: "informando o fornecedor, o valor não
 * está sendo inserido na tela de pagamentos"): a entrada de estoque GRAVAVA
 * `fornecedorId` e parava aí — o campo servia só de etiqueta na linha do estoque.
 * `tb_contas_pagar` nasceu em 2026-09-10 alimentada pela EXECUÇÃO (o produto que a
 * clínica não estoca e pede ao fornecedor); a compra que ENTRA no estoque nunca teve
 * quem a lançasse. Resultado: a clínica comprava, o saldo subia e a dívida não existia
 * em lugar nenhum.
 *
 * ⚠️ A ORIGEM É O MOVIMENTO, não a entrada de estoque. Cada compra cria um
 * `MovimentoEstoque` de ENTRADA — inclusive quando a entrada é CONSOLIDADA numa linha
 * que já existia (mesmo lote, validade e valor). Com o id da `EstoqueClinica` como
 * origem, a segunda compra do mesmo lote casaria no `ON CONFLICT (origem_tipo,
 * origem_id)` e seria DESCARTADA em silêncio — a clínica pagaria uma e deveria zero
 * pela outra. Pelo movimento, cada compra é uma dívida, e a idempotência continua
 * valendo (reenvio do mesmo formulário não duplica).
 *
 * 🔴 `valor` DA LINHA É UNITÁRIO — a conta é `valor × quantidade`, e quem multiplica
 * é `recalcularTotal` (`SUM(i.valor * i.quantidade)`) e a tela de Pagamentos. Mandar o
 * TOTAL aqui e a quantidade ao lado multiplica DUAS vezes: medido na base em
 * 2026-09-19, uma compra de 10 × R$ 100 aparecia como **R$ 10.000** em vez de R$ 1.000.
 * O contrato é o mesmo dos outros três chamadores de `lancarItem` (execução de
 * prescrição, vacina e prestador), que sempre passaram o unitário.
 * Resultado: **valor unitário da embalagem × Qtd Produto**, que é o que a tela digita.
 *
 * ⚠️ A QUANTIDADE É DE EMBALAGENS, NUNCA O SALDO — é o "independente de doses". Sem
 * `qtdEmbalagens` (entrada avulsa, cliente antigo), o saldo só serve de reserva DEPOIS
 * de dividido pelo conteúdo que o produto declara: num multidose `qtdEstoque` é o
 * CONTEÚDO (60 mL), e usá-lo cru cobraria 60 frascos de um fornecedor que entregou 3.
 *
 * ⚠️ NUNCA LANÇA sem valor > 0 (`lancarItem` já devolve null): dívida de valor
 * inventado é pior que dívida ausente — a mesma regra do lançamento da execução.
 *
 * ⚠️ Best-effort e FORA da transaction do estoque: a entrada é ato de estoque e não
 * pode ser revertida porque a conta a pagar falhou. O `catch` de `lancarItem` já
 * engole o erro; este `try` cobre o resto (fornecedor sumido, tabela ausente).
 */
/**
 * Quantas EMBALAGENS foram compradas — a quantidade da linha da conta a pagar.
 *
 * ⚠️ "Independente de doses": o saldo (`qtdEstoque`) é a Qtd TOTAL, e num produto
 * multidose ele está no CONTEÚDO (3 frascos de 20 mL = 60). Ele só vira embalagem
 * depois de dividido pelo que o produto declara conter.
 */
function embalagensCompradas({ qtdEmbalagens, qtdEstoque, conteudoEmbalagem }) {
  const emb = Number(qtdEmbalagens);
  if (emb > 0) return emb;
  const saldo = Number(qtdEstoque) || 0;
  const cont  = Number(conteudoEmbalagem);
  return cont > 0 ? saldo / cont : saldo;
}

async function lancarCompraDoFornecedor(client, {
  empresaId, fornecedorId, movimentoId, movimentoEm, medicamentoNome,
  valorEmbalagem, qtdEmbalagens, qtdEstoque, conteudoEmbalagem,
  notaFiscal, solicitanteId, solicitanteNome,
}) {
  if (!empresaId || !fornecedorId || !movimentoId) return null;
  try {
    const fornecedor = await client.fornecedor.findFirst({
      where:  { id: Number(fornecedorId), empresaId: Number(empresaId) },
      select: { id: true, nome: true },
    });
    // Fornecedor de OUTRA empresa (id vindo do corpo) não vira dívida desta clínica.
    if (!fornecedor) return null;

    const embalagens = embalagensCompradas({ qtdEmbalagens, qtdEstoque, conteudoEmbalagem });

    return await contasPagar.lancarItem(client, {
      empresaId:   Number(empresaId),
      tipo:        'FORNECEDOR',
      credorId:    fornecedor.id,
      credorNome:  fornecedor.nome,
      descricao:   `${medicamentoNome || 'Produto'}${notaFiscal ? ` — NF ${notaFiscal}` : ''}`,
      quantidade:  embalagens || 1,
      // UNITÁRIO. Ver o cabeçalho: `recalcularTotal` e a tela de Pagamentos fazem
      // `valor × quantidade`, então o total já multiplicado sairia ao quadrado.
      valor:       Number(valorEmbalagem),
      solicitanteId,
      solicitanteNome,
      // 🔴 A "DATA DO PEDIDO" da tela de Pagamentos é a DATA DA ENTRADA NO ESTOQUE, e
      // ela é PASSADA em vez de deixada no default (`NOW()` do `lancarItem`). Hoje as
      // duas coincidem, mas o lançamento é best-effort e roda FORA da transaction: se um
      // dia ele for reprocessado ou enfileirado, o default carimbaria o instante do
      // reprocessamento e a compra apareceria no período errado — que é justamente a
      // conta pela qual o financeiro fecha o mês.
      ocorridoEm:  movimentoEm ?? undefined,
      origemTipo:  'ESTOQUE_ENTRADA',
      origemId:    Number(movimentoId),
    });
  } catch (err) {
    console.error('EstoqueController.lancarCompraDoFornecedor:', err.message);
    return null;
  }
}

const INCLUDE = {
  medicamento: {
    include: { vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } } },
  },
  fornecedor: { select: { id: true, nome: true, tipoServico: true } },
};

// Normaliza lote para comparação (case-insensitive, vazio=null)
function normLote(lote) {
  const t = (lote ?? '').trim();
  return t === '' ? null : t.toLowerCase();
}
// Normaliza validade para comparação (apenas YYYY-MM-DD)
function normValidade(v) {
  if (!v) return null;
  try { return new Date(v).toISOString().split('T')[0]; } catch { return null; }
}

// ADMIN pode passar ?empresaId= para ver qualquer empresa; demais sempre usam req.empresaId
function getEmpresaScope(req) {
  if (req.user?.userType === 'ADMIN') {
    return req.query?.empresaId ? Number(req.query.empresaId) : (req.empresaId ?? null);
  }
  return req.empresaId ?? null;
}

// Retorna true se o item pertence à empresa do usuário (ADMIN bypassa)
function pertenceAEmpresa(item, req) {
  if (req.user?.userType === 'ADMIN') return true;
  return req.empresaId != null && item.empresaId === req.empresaId;
}

/**
 * Resolve a UNIDADE informada na tela, devolvendo o medicamento a gravar no estoque.
 *
 * ⚠️ Roda em transaction PRÓPRIA: `definirUnidadeDoMedicamento` pode CRIAR a cópia da
 * empresa e REAPONTAR estoque e prescrições pendentes — um passo falhando no meio
 * deixaria metade disso feito.
 * ⚠️ `empresaId` vem do CONTEXTO, nunca do corpo (o RLS também recusaria a escrita de
 * catálogo carimbada para outra clínica, mas a intenção fica explícita aqui).
 *
 * @returns {Promise<{id:number, unidade:string, copiado:boolean, alterado:boolean}>}
 */
async function resolverUnidade(req, medicamentoId, unidade, ignorarEstoqueId = null) {
  return prisma.$transaction((tx) => definirUnidadeDoMedicamento(tx, {
    medicamentoId,
    unidade,
    empresaId: req.empresaId ?? null,
    ignorarEstoqueId,
  }));
}

/** 400/404 da regra de unidade; qualquer outro erro segue para o catch do controller. */
function responderErroUnidade(res, err) {
  if (err instanceof UnidadeIndisponivelError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  return null;
}

// ─── Listar estoque da clínica ────────────────────────────────────────────────

const listar = async (req, res) => {
  try {
    const { busca, ativo, limit } = req.query;
    const empresaId = getEmpresaScope(req);

    // Não-ADMIN sem empresa ativa não vê nada
    if (!empresaId && req.user?.userType !== 'ADMIN') {
      return res.json({ dados: [], meta: { total: 0, totalControlados: 0, totalAbaixoMinimo: 0, totalAbaixoAlarmante: 0 } });
    }

    const where = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (empresaId)           where.empresaId = empresaId;

    if (busca) {
      where.medicamento = {
        OR: [
          { nome:              { contains: busca, mode: 'insensitive' } },
          { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
          { vias: { some: { via: { contains: busca, mode: 'insensitive' } } } },
        ],
      };
    }

    const rawItens = await prisma.estoqueClinica.findMany({
      where,
      include: {
        ...INCLUDE,
        _count: { select: { movimentos: { where: { tipo: 'SAIDA' } } } },
      },
      orderBy: { medicamento: { nome: 'asc' } },
      ...(limit ? { take: parseInt(limit, 10) } : {}),
    });

    const itensComUso  = rawItens.map(({ _count, ...i }) => ({ ...i, emUso: (_count?.movimentos ?? 0) > 0 }));
    const comTrilha    = await anexarTrilha(itensComUso, 'estoque_farmacia');
    // 🔴 A FORMA DE CÁLCULO tem de viajar junto do item: é ela que a tela exibe como
    // unidade do estoque. Por SQL cru (§11) — `forma_calculo` é coluna da migration
    // 20261012000000 e, com o client desatualizado, o `include` simplesmente não a
    // traria: a edição de uma entrada abriria dizendo "Frasco" sobre um saldo em mL.
    const itens        = await anexarFormaAosItens(comTrilha);

    const [total, totalControlados] = await Promise.all([
      prisma.estoqueClinica.count({ where: { ativo: true, ...(empresaId ? { empresaId } : {}) } }),
      prisma.estoqueClinica.count({ where: { ativo: true, ...(empresaId ? { empresaId } : {}), medicamento: { controlado: true } } }),
    ]);

    const totalAbaixoMinimo    = itens.filter((i) => i.ativo && i.qtdEstoque <= i.estoqueMinimo).length;
    const totalAbaixoAlarmante = itens.filter((i) => i.ativo && i.qtdEstoque <= i.estoqueAlarmante && i.qtdEstoque > i.estoqueMinimo).length;

    return res.json({
      dados: itens,
      meta: { total, totalControlados, totalAbaixoMinimo, totalAbaixoAlarmante },
    });
  } catch (err) {
    console.error('EstoqueController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar estoque.' });
  }
};

// ─── Obter por ID ─────────────────────────────────────────────────────────────

const obterPorId = async (req, res) => {
  try {
    const item = await prisma.estoqueClinica.findUnique({
      where:   { id: Number(req.params.id) },
      include: INCLUDE,
    });
    if (!item) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(item, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });
    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.obterPorId:', err);
    return res.status(500).json({ error: 'Erro ao buscar item.' });
  }
};

// ─── Criar entrada de estoque ─────────────────────────────────────────────────

const criar = async (req, res) => {
  try {
    const {
      medicamentoId,
      empresaId,
      valor            = 0,
      valorRepassado   = 0,
      lote,
      validade,
      qtdEstoque       = 0,
      qtdEmbalagens,
      pesoPorEmbalagem,
      estoqueMinimo    = 0,
      estoqueAlarmante = 0,
      fornecedorId,
      notaFiscal,
      // ⚠️ `unidade` do corpo é IGNORADA de propósito — ver `unidadeParaResolver`.
    } = req.body;

    if (!medicamentoId)
      return res.status(400).json({ error: 'medicamentoId é obrigatório.' });

    // Lote e validade são obrigatórios na entrada de estoque
    if (!lote?.trim()) return res.status(400).json({ error: 'Lote é obrigatório.' });
    if (!validade)     return res.status(400).json({ error: 'Validade é obrigatória.' });

    if (Number(qtdEstoque) < 0 || Number(estoqueMinimo) < 0 || Number(estoqueAlarmante) < 0)
      return res.status(400).json({ error: 'Quantidades não podem ser negativas.' });

    // A unidade informada na tela decide o medicamento a gravar: trocá-la num item do
    // catálogo GLOBAL produz a CÓPIA da empresa, e é nela que a entrada vai apontar.
    let unidadeResolvida;
    try {
      unidadeResolvida = await resolverUnidade(req, medicamentoId, await unidadeParaResolver());
    } catch (err) {
      const resposta = responderErroUnidade(res, err);
      if (resposta) return resposta;
      throw err;
    }
    const medicamentoIdFinal = unidadeResolvida.id;

    const med = await prisma.medicamento.findUnique({ where: { id: medicamentoIdFinal } });
    if (!med) return res.status(404).json({ error: 'Medicamento não encontrado no catálogo.' });

    // ⚠️ Só o ADMIN da plataforma escolhe a empresa por parâmetro; para os demais o
    // tenant é o do CONTEXTO. Aceitar `empresaId` do corpo faria a entrada nascer para
    // outra clínica (o RLS recusaria, mas como erro 500 sem explicação).
    const eId           = req.user?.userType === 'ADMIN'
      ? (empresaId ? Number(empresaId) : (req.empresaId ?? null))
      : (req.empresaId ?? null);
    const loteNorm      = normLote(lote);
    const validadeStr   = normValidade(validade);
    // ⚠️ `med.unidade` é a da EMBALAGEM; quem manda no preço é a unidade OPERATIVA.
    const unidadeConta  = await unidadeOperativaDoItem(prisma, medicamentoIdFinal, med.unidade);
    // ⚠️ `valor`/`valorRepassado` chegam POR EMBALAGEM e são gravados assim — a tela não
    // os multiplica mais pela Qtd Produto. Quem divide o preço é o CONTEÚDO da embalagem
    // (`pesoPorEmbalagem`, que vem do cadastro do produto), nunca o saldo.
    const conteudoEmb   = pesoPorEmbalagem ? Number(pesoPorEmbalagem) : null;
    const precoNovo     = calcPrecoUnitarioBase(Number(valorRepassado), conteudoEmb, unidadeConta);
    const nfMotivo      = notaFiscal?.trim() ? `NF: ${notaFiscal.trim()}` : null;

    // ── Busca candidatos para consolidação (mesmo medicamento, empresa, ativo) ─
    const candidatos = await prisma.estoqueClinica.findMany({
      where: { medicamentoId: medicamentoIdFinal, empresaId: eId, ativo: true },
      include: INCLUDE,
    });

    // Verifica se existe entrada idêntica (mesmo lote + mesma validade + mesmo
    // valor POR EMBALAGEM). Nesse caso a nova entrada é SOMADA ao item existente.
    // ⚠️ `valor` já É por embalagem nos dois lados — a divisão por `qtdEmbalagens` que
    // havia aqui existia só para desfazer a multiplicação da tela.
    const qtdEmbNova   = qtdEmbalagens ? Number(qtdEmbalagens) : null;
    const valorEmbNovo = Number(valor);
    const existente = candidatos.find(c => {
      if (normLote(c.lote) !== loteNorm) return false;
      if (normValidade(c.validade) !== validadeStr) return false;
      const cValorEmb = Number(c.valor);
      const maxV = Math.max(valorEmbNovo, cValorEmb);
      return maxV === 0 || Math.abs(valorEmbNovo - cValorEmb) / maxV < 0.01; // 1% de tolerância
    });

    if (existente) {
      // ── CONSOLIDAR: soma quantidade + cria movimento com NF ──────────────
      let movimentoConsolidado = null;
      const updated = await prisma.$transaction(async (tx) => {
        // O movimento é a ORIGEM da conta a pagar (uma dívida por COMPRA, não por
        // linha de estoque) — por isso o id sai da transaction.
        movimentoConsolidado = await tx.movimentoEstoque.create({
          data: {
            estoqueId: existente.id,
            tipo: 'ENTRADA',
            quantidade: Number(qtdEstoque),
            motivo: nfMotivo ?? 'Entrada adicional',
          },
        });
        // Soma quantidade e embalagens. 🔴 OS VALORES NÃO SÃO SOMADOS: eles são POR
        // EMBALAGEM, e a entrada só chega aqui porque o valor bate com o da linha
        // existente (1% de tolerância). Somá-los dobraria o preço da embalagem — e,
        // por tabela, a linha da fatura — a cada reentrada do mesmo lote.
        const conteudoFinal = Number(existente.pesoPorEmbalagem) > 0
          ? Number(existente.pesoPorEmbalagem)
          : conteudoEmb;
        const precoConsolidado = calcPrecoUnitarioBase(Number(valorRepassado), conteudoFinal, unidadeConta);
        return tx.estoqueClinica.update({
          where: { id: existente.id },
          data: {
            qtdEstoque:     { increment: Number(qtdEstoque) },
            ...(qtdEmbNova ? { qtdEmbalagens: { increment: qtdEmbNova } } : {}),
            ...(pesoPorEmbalagem && !existente.pesoPorEmbalagem ? { pesoPorEmbalagem: Number(pesoPorEmbalagem) } : {}),
            ...(precoConsolidado !== null ? { precoUnitarioBase: precoConsolidado } : {}),
          },
          include: { ...INCLUDE, _count: { select: { movimentos: { where: { tipo: 'SAIDA' } } } } },
        });
      });
      // Depois do COMMIT, de propósito: a compra já entrou no estoque e não pode ser
      // desfeita porque o lançamento da dívida falhou.
      await lancarCompraDoFornecedor(prisma, {
        empresaId: eId,
        fornecedorId,
        movimentoId:     movimentoConsolidado?.id,
        movimentoEm:     movimentoConsolidado?.createdAt,
        medicamentoNome: updated.medicamento?.nome,
        valorEmbalagem:  valorEmbNovo,
        qtdEmbalagens:   qtdEmbNova,
        qtdEstoque,
        conteudoEmbalagem: conteudoEmb,
        notaFiscal:      notaFiscal?.trim() || null,
        solicitanteId:   req.user?.id ?? null,
        solicitanteNome: req.user?.fullName ?? null,
      });

      const { _count, ...rest } = updated;
      return res.status(200).json({
        dados: { ...rest, emUso: (_count?.movimentos ?? 0) > 0 },
        consolidado: true,
        mensagem: nfMotivo ? `Quantidade somada ao estoque existente (${nfMotivo}).` : 'Quantidade somada ao estoque existente.',
      });
    }

    // ── NOVA ENTRADA ──────────────────────────────────────────────────────────
    let movimentoNovo = null;
    const item = await prisma.$transaction(async (tx) => {
      const entry = await tx.estoqueClinica.create({
        data: {
          medicamentoId:    medicamentoIdFinal,
          empresaId:        eId,
          valor:            Number(valor),
          valorRepassado:   Number(valorRepassado),
          precoUnitarioBase: precoNovo,
          lote:             loteNorm ?? null,
          validade:         validade ? new Date(validade) : null,
          qtdEstoque:       Number(qtdEstoque),
          qtdEmbalagens:    qtdEmbNova,
          pesoPorEmbalagem: pesoPorEmbalagem ? Number(pesoPorEmbalagem) : null,
          estoqueMinimo:    Number(estoqueMinimo),
          estoqueAlarmante: Number(estoqueAlarmante),
          fornecedorId:     fornecedorId ? Number(fornecedorId) : null,
          notaFiscal:       notaFiscal?.trim() ?? null,
        },
        include: INCLUDE,
      });

      if (Number(qtdEstoque) > 0) {
        movimentoNovo = await tx.movimentoEstoque.create({
          data: { estoqueId: entry.id, tipo: 'ENTRADA', quantidade: Number(qtdEstoque), motivo: nfMotivo ?? 'Entrada inicial' },
        });
      }

      return entry;
    });

    // Fora da transaction — ver `lancarCompraDoFornecedor`.
    await lancarCompraDoFornecedor(prisma, {
      empresaId: eId,
      fornecedorId,
      movimentoId:     movimentoNovo?.id,
      movimentoEm:     movimentoNovo?.createdAt,
      medicamentoNome: item.medicamento?.nome,
      valorEmbalagem:  Number(valor),
      qtdEmbalagens:   qtdEmbNova,
      qtdEstoque,
      conteudoEmbalagem: conteudoEmb,
      notaFiscal:      notaFiscal?.trim() || null,
      solicitanteId:   req.user?.id ?? null,
      solicitanteNome: req.user?.fullName ?? null,
    });

    return res.status(201).json({ dados: { ...item, emUso: false }, consolidado: false });
  } catch (err) {
    console.error('EstoqueController.criar:', err);
    return res.status(500).json({ error: 'Erro ao criar item de estoque.' });
  }
};

// ─── Atualizar ────────────────────────────────────────────────────────────────

const atualizar = async (req, res) => {
  try {
    const id = Number(req.params.id);
    // ⚠️ `unidade` do corpo é IGNORADA de propósito — ver `unidadeParaResolver`.
    const { valor, valorRepassado, lote, validade, estoqueMinimo, estoqueAlarmante, ativo, fornecedorId, notaFiscal, qtdEstoque, qtdEmbalagens, pesoPorEmbalagem } = req.body;

    // Lote e validade são obrigatórios — não podem ser apagados na edição
    if (lote     !== undefined && !lote?.trim()) return res.status(400).json({ error: 'Lote é obrigatório.' });
    if (validade !== undefined && !validade)     return res.status(400).json({ error: 'Validade é obrigatória.' });

    const existe = await prisma.estoqueClinica.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    // Nº de movimentos de SAÍDA do item — consultado uma única vez quando necessário.
    // Só SAIDA conta como "usado" (mesmo critério do flag emUso na listagem) —
    // a ENTRADA inicial/adicional criada automaticamente não bloqueia a edição.
    let movimentosCount = null;
    const contarMovimentos = async () => {
      if (movimentosCount === null) {
        const c = await prisma.estoqueClinica.findUnique({
          where:  { id },
          select: { _count: { select: { movimentos: { where: { tipo: 'SAIDA' } } } } },
        });
        movimentosCount = c?._count?.movimentos ?? 0;
      }
      return movimentosCount;
    };

    // Lote e validade identificam a entrada — só podem ser ALTERADOS enquanto o
    // item não foi usado (sem movimentos). Valores iguais aos atuais passam.
    const loteMudou     = lote     !== undefined && normLote(lote) !== normLote(existe.lote);
    const validadeMudou = validade !== undefined && normValidade(validade) !== normValidade(existe.validade);
    if ((loteMudou || validadeMudou) && (await contarMovimentos()) > 0) {
      return res.status(400).json({ error: 'Item já movimentado — lote e validade não podem ser alterados.' });
    }

    if (estoqueMinimo    !== undefined && Number(estoqueMinimo)    < 0) return res.status(400).json({ error: 'Estoque mínimo não pode ser negativo.' });
    if (estoqueAlarmante !== undefined && Number(estoqueAlarmante) < 0) return res.status(400).json({ error: 'Estoque alarmante não pode ser negativo.' });

    const data = {};
    if (valor            !== undefined) data.valor            = Number(valor);
    if (valorRepassado   !== undefined) data.valorRepassado   = Number(valorRepassado);
    if (lote             !== undefined) data.lote             = lote?.trim() ?? null;
    if (validade         !== undefined) data.validade         = validade ? new Date(validade) : null;
    if (estoqueMinimo    !== undefined) data.estoqueMinimo    = Number(estoqueMinimo);
    if (estoqueAlarmante !== undefined) data.estoqueAlarmante = Number(estoqueAlarmante);
    if (ativo            !== undefined) data.ativo            = Boolean(ativo);
    if (fornecedorId     !== undefined) data.fornecedorId     = fornecedorId ? Number(fornecedorId) : null;
    if (notaFiscal       !== undefined) data.notaFiscal       = notaFiscal?.trim() ?? null;

    // Nº de embalagens / peso por embalagem só podem ser corrigidos enquanto o item
    // NÃO tem nenhum movimento (não usado). Depois disso, use o Ajuste de Estoque.
    if (qtdEstoque !== undefined || qtdEmbalagens !== undefined || pesoPorEmbalagem !== undefined) {
      if (qtdEstoque !== undefined && Number(qtdEstoque) < 0) return res.status(400).json({ error: 'Estoque não pode ser negativo.' });
      if ((await contarMovimentos()) > 0) {
        return res.status(400).json({ error: 'Item já movimentado — altere a quantidade pelo Ajuste de Estoque.' });
      }
      if (qtdEstoque       !== undefined) data.qtdEstoque       = Number(qtdEstoque);
      if (qtdEmbalagens    !== undefined) data.qtdEmbalagens    = qtdEmbalagens ? Number(qtdEmbalagens) : null;
      if (pesoPorEmbalagem !== undefined) data.pesoPorEmbalagem = pesoPorEmbalagem ? Number(pesoPorEmbalagem) : null;
    }

    // 🔴 UNIDADE + GRAVAÇÃO NA MESMA TRANSACTION. A troca de unidade CRIA a cópia da
    // empresa e REAPONTA estoque e prescrições pendentes; resolvê-la antes das
    // validações acima deixaria a unidade alterada mesmo quando o salvar é recusado.
    let item;
    try {
      item = await prisma.$transaction(async (tx) => {
        // `ignorarEstoqueId` é ESTA entrada: ela não conta como "outra entrada com a
        // quantidade na unidade antiga", porque é aqui que a quantidade é reexpressa.
        const u = await definirUnidadeDoMedicamento(tx, {
          medicamentoId:    existe.medicamentoId,
          unidade:          await unidadeParaResolver(),
          empresaId:        req.empresaId ?? null,
          ignorarEstoqueId: id,
        });

        // O reapontamento da cópia cobre as entradas ATIVAS da empresa; carimbar aqui
        // alcança também a INATIVA que está sendo editada, deixada de fora de propósito.
        if (u.id !== existe.medicamentoId) data.medicamentoId = u.id;

        // Recalcula precoUnitarioBase quando o valor da EMBALAGEM, o CONTEÚDO dela ou a
        // UNIDADE mudarem — sem a unidade na conta, trocar 'g' por 'Un.' deixaria o
        // preço gravado em R$/g valendo como R$/unidade na fatura do cliente.
        // ⚠️ A QUANTIDADE saiu do gatilho e da conta: o valor é por embalagem, então
        // corrigir o saldo não pode mexer no preço que já foi cobrado do cliente.
        if (valorRepassado !== undefined || data.pesoPorEmbalagem !== undefined || u.alterado) {
          const vrFinal = valorRepassado !== undefined ? Number(valorRepassado) : existe.valorRepassado;
          const conteudoFinal = data.pesoPorEmbalagem !== undefined
            ? data.pesoPorEmbalagem
            : existe.pesoPorEmbalagem;
          // ⚠️ A unidade OPERATIVA, não a da embalagem — ver `unidadeOperativaDoItem`.
          const unidadeConta = await unidadeOperativaDoItem(tx, u.id, u.unidade);
          const novoPreco = calcPrecoUnitarioBase(vrFinal, conteudoFinal, unidadeConta);
          if (novoPreco !== null) data.precoUnitarioBase = novoPreco;
        }

        return tx.estoqueClinica.update({ where: { id }, data, include: INCLUDE });
      });
    } catch (err) {
      const resposta = responderErroUnidade(res, err);
      if (resposta) return resposta;
      throw err;
    }

    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar item.' });
  }
};

// ─── Ativar / Inativar (toggle) ───────────────────────────────────────────────
// Mesma regra de /cadastro/fornecedores: um clique alterna o estado nos dois
// sentidos; a trilha (quem/quando) fica em `ativo_em`/`ativo_por_id`/
// `inativo_em`/`inativo_por_id` (lib/cadastroAtivacao.js). Justificativa
// OBRIGATÓRIA só para INATIVAR (migration 20260901000001) — ativar segue direto.

const toggle = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    const existe = await prisma.estoqueClinica.findUnique({ where: { id }, include: { medicamento: { select: { nome: true } } } });
    if (!existe) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const vaiInativar = existe.ativo;

    if (vaiInativar && !motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da inativação' });
    }

    if (vaiInativar) {
      await registrarInativacao(prisma, 'estoque_farmacia', id, req.user.id, motivo.trim());
    } else {
      await registrarAtivacao(prisma, 'estoque_farmacia', id, req.user.id);
    }

    await registrarAuditoria(null, req, {
      // (In)ativar não é editar um campo: a categoria é o rótulo exibido na
      // Auditoria e o recorte dos Relatórios de Cadastro.
      categoria:  vaiInativar ? 'INATIVACAO' : 'ATIVACAO',
      entidade:   'ESTOQUE_FARMACIA',
      entidadeId: id,
      motivo:     vaiInativar ? motivo.trim() : null,
      detalhes:   `${req.user.fullName ?? req.user.email} ${vaiInativar ? 'inativou' : 'ativou'} ${existe.medicamento?.nome ?? 'item'}${existe.lote ? ` — Lote ${existe.lote}` : ''}`,
    });

    const itemAtualizado = await prisma.estoqueClinica.findUnique({ where: { id }, include: INCLUDE });
    const [comTrilha] = await anexarTrilha([itemAtualizado], 'estoque_farmacia');

    return res.json({
      dados:    comTrilha,
      mensagem: vaiInativar ? 'Item inativado' : 'Item ativado',
    });
  } catch (err) {
    console.error('EstoqueController.toggle:', err);
    return res.status(500).json({ error: 'Erro ao alternar status.' });
  }
};

// ─── Excluir (soft delete) ────────────────────────────────────────────────────

const excluir = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }

    const existe = await prisma.estoqueClinica.findUnique({ where: { id }, include: { medicamento: { select: { nome: true } } } });
    if (!existe) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });
    await prisma.estoqueClinica.update({ where: { id }, data: { ativo: false } });

    await registrarAuditoria(null, req, {
      categoria:  'EXCLUSAO',
      entidade:   'ESTOQUE_FARMACIA',
      entidadeId: id,
      motivo,
      detalhes:   [existe.medicamento?.nome, existe.lote ? `Lote ${existe.lote}` : null].filter(Boolean).join(' — ') || null,
    });

    return res.json({ dados: { message: 'Item inativado com sucesso.' } });
  } catch (err) {
    console.error('EstoqueController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir item.' });
  }
};

// ─── Ajustar estoque (entrada/saída/ajuste) ───────────────────────────────────

const ajustarEstoque = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { tipo, quantidade, motivo } = req.body;

    if (!tipo || !['ENTRADA', 'SAIDA', 'AJUSTE'].includes(tipo))
      return res.status(400).json({ error: 'tipo deve ser ENTRADA, SAIDA ou AJUSTE.' });

    const qty = Number(quantidade);
    // AJUSTE aceita delta com sinal (correção para cima ou para baixo) — assim uma
    // correção negativa não vira SAIDA, que marcaria o item como "em uso" (emUso).
    if (tipo === 'AJUSTE') {
      if (!qty) return res.status(400).json({ error: 'quantidade deve ser diferente de zero.' });
    } else if (!qty || qty <= 0) {
      return res.status(400).json({ error: 'quantidade deve ser maior que zero.' });
    }

    const existe = await prisma.estoqueClinica.findUnique({
      where:   { id },
      include: { medicamento: { select: { nome: true } } },
    });
    if (!existe) return res.status(404).json({ error: 'Item não encontrado.' });
    if (!pertenceAEmpresa(existe, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const delta      = tipo === 'SAIDA' ? -qty : qty; // AJUSTE já vem com sinal
    const novaQtd    = existe.qtdEstoque + delta;
    if (novaQtd < 0) return res.status(400).json({ error: 'Estoque resultante seria negativo.' });

    const item = await prisma.$transaction(async (tx) => {
      await tx.movimentoEstoque.create({
        data: { estoqueId: id, tipo, quantidade: qty, motivo: motivo ?? null },
      });
      const atualizado = await tx.estoqueClinica.update({ where: { id }, data: { qtdEstoque: novaQtd }, include: INCLUDE });

      // AUDITORIA do AJUSTE — é o que alimenta o relatório "Ajustes de Estoque"
      // (quem/quando/o quê). O MovimentoEstoque não guarda o autor; o AuditLog sim.
      // Só o AJUSTE é auditado aqui: ENTRADA/SAIDA têm seus próprios fluxos.
      if (tipo === 'AJUSTE') {
        const sinal    = delta >= 0 ? '+' : '';
        const nomeMed  = existe.medicamento?.nome ?? 'Medicamento';
        const detalhes = `${nomeMed}${existe.lote ? ` (lote ${existe.lote})` : ''}: `
          + `${existe.qtdEstoque} → ${novaQtd} (${sinal}${delta})`;
        await registrarAuditoria(tx, req, {
          categoria:  'AJUSTE',
          entidade:   'ESTOQUE_FARMACIA',
          entidadeId: id,
          motivo:     motivo?.trim() || null,
          detalhes,
        });
      }
      return atualizado;
    });

    return res.json({ dados: item });
  } catch (err) {
    console.error('EstoqueController.ajustarEstoque:', err);
    return res.status(500).json({ error: 'Erro ao ajustar estoque.' });
  }
};

// ─── Listar movimentações ─────────────────────────────────────────────────────

const listarMovimentos = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.estoqueClinica.findUnique({ where: { id }, select: { id: true, empresaId: true } });
    if (!item) return res.status(404).json({ error: 'Item de estoque não encontrado.' });
    if (!pertenceAEmpresa(item, req)) return res.status(403).json({ error: 'Acesso não autorizado.' });

    const movimentos = await prisma.movimentoEstoque.findMany({
      where:   { estoqueId: id },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    return res.json({ dados: movimentos });
  } catch (err) {
    console.error('EstoqueController.listarMovimentos:', err);
    return res.status(500).json({ error: 'Erro ao listar movimentos.' });
  }
};

module.exports = {
  listar, obterPorId, criar, atualizar, excluir, toggle, ajustarEstoque, listarMovimentos,
  // Exportado para teste: é o preço que vai para a FATURA do cliente, e o caso da
  // unidade CONTÁVEL ('Un.') quebra em silêncio — devolvia null e a cobrança caía no
  // cálculo dinâmico, que sobe conforme o estoque baixa.
  calcPrecoUnitarioBase,
  // Exportado para teste: é a QUANTIDADE da linha da conta a pagar, e o modo de
  // errá-la é silencioso — com o saldo de um multidose no lugar das embalagens, a
  // clínica passa a dever 60 frascos a quem entregou 3.
  embalagensCompradas,
};