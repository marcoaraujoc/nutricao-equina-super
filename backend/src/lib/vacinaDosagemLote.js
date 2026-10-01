// backend/src/lib/vacinaDosagemLote.js
//
// 🔴 QUANTO UMA APLICAÇÃO DE VACINA TIRA DO LOTE, na unidade em que o lote está contado
// (2026-10-01). FONTE ÚNICA da reserva (`criarReservaVacina`), da baixa
// (`darBaixaEFaturar`) e da reconversão do lote quando o produto muda de conteúdo
// (`lib/catalogoEmpresa.js#reconverterLotesVacinaAtivos`).
//
// POR QUÊ: a dosagem da vacina é SNAPSHOT (`tb_vacinas_clinicas.quantidade` +
// `forma_calculo`, gravados no registro), e o lote é contado na unidade que o produto
// declara HOJE. Enquanto os dois coincidiam, descontar a dosagem crua estava certo. Mas
// o produto pode mudar de estado entre o registro e a aplicação:
//
//   registrada "2 mL" (multidose 20 mL) → produto DESMARCADO → lote volta a frascos
//       crua: −2 FRASCOS e cobra 2 frascos          certo: −1 frasco (a embalagem aberta)
//   registrada "1" dose (sem multidose) → produto MARCADO multidose 20 mL → lote em mL
//       crua: −1 mL e cobra 1/20 do frasco          certo: −20 mL (o frasco que era)
//
// A regra do inverso é a MESMA da prescrição de produto sem multidose
// (`PrescricaoGrupoController.entregaPorEmbalagem`): dosagem escrita em conteúdo contra
// estoque contado em embalagens consome as embalagens que couberem — 1, se o produto não
// declara quanto cabe nela.
// ⚠️ Produto LEGADO "multidose com quantidade e SEM forma" fica fora das duas
// conversões: a vacina dele nasce sem snapshot de forma, mas a dosagem já está no
// conteúdo (`formaCalculo.unidadeOperativa`). Multiplicar ali seria o erro.
'use strict';

const {
  qtdPorEmbalagemDe, conteudoDaEmbalagem, embalagensPara, normalizarFormaCalculo,
} = require('./formaCalculo');

/**
 * @param {number} dosagem         o que foi registrado na vacina (já ≥ 0)
 * @param {string|null} formaSnapshot  `tb_vacinas_clinicas.forma_calculo`
 * @param {object|null} produto    `{ multidose, dosesPorEmbalagem, formaCalculo, unidade }` ATUAL
 * @returns {number} quanto sai do lote
 */
function dosagemNaUnidadeDoLote(dosagem, formaSnapshot, produto) {
  const q = Number(dosagem) > 0 ? Number(dosagem) : 1;
  const conteudoMulti  = qtdPorEmbalagemDe(produto);
  const formaProduto   = conteudoMulti != null ? normalizarFormaCalculo(produto?.formaCalculo) : null;
  const doseEmConteudo = !!normalizarFormaCalculo(formaSnapshot);

  // Inverso: dose em conteúdo, lote em embalagens.
  if (doseEmConteudo && conteudoMulti == null) return embalagensPara(q, conteudoDaEmbalagem(produto));
  // Direto: dose em embalagens, lote em conteúdo.
  if (!doseEmConteudo && formaProduto) return q * conteudoMulti;
  return q;
}

/** `forma_calculo` gravada na vacina — SQL cru com `catch` (coluna de migration recente). */
async function formaDaVacina(client, vacinaId) {
  if (!vacinaId) return null;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT forma_calculo AS "formaCalculo" FROM schs2vet.tb_vacinas_clinicas WHERE id = $1`,
      Number(vacinaId),
    );
    return rows?.[0]?.formaCalculo ?? null;
  } catch { return null; }
}

/**
 * Atalho dos controllers: lê a forma da vacina e o produto atual e converte.
 * `produto` pode vir pronto (a reconversão o conhece ANTES de o catálogo refletir a
 * cópia); sem ele, é lido do `medicamentoCatId`.
 */
async function qtdNoLoteDaVacina(client, { vacinaId, medicamentoCatId, dosagem, produto = undefined }) {
  const forma = await formaDaVacina(client, vacinaId);
  let prod = produto;
  if (prod === undefined) {
    // require TARDIO: catalogoEmpresa importa este módulo (reconversão do lote).
    const { multidosePorItem } = require('./catalogoEmpresa');
    prod = medicamentoCatId
      ? (await multidosePorItem(client, [Number(medicamentoCatId)])).get(Number(medicamentoCatId)) ?? null
      : null;
  }
  return dosagemNaUnidadeDoLote(dosagem, forma, prod);
}

module.exports = { dosagemNaUnidadeDoLote, formaDaVacina, qtdNoLoteDaVacina };
