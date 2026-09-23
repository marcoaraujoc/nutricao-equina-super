'use strict';
/**
 * PREÇO E PRESTADOR DO EXAME (2026-09-09)
 *
 * 🔴 POR QUE ESTE ARQUIVO EXISTE: o exame de imagem virou PROCEDIMENTO do catálogo
 * (`tb_procedimentos_vet`, tipo IMAGEM), e com isso passou a ter valor por empresa e
 * vínculo com prestador. Faltava a ponte entre o PEDIDO de exame e esse preço —
 * `lancarExameNaFatura` lançava a linha com valor ZERO, sempre.
 *
 * 🔴 LEITURA/ESCRITA das colunas novas SEMPRE por aqui, em SQL cru com `catch`:
 * `tb_exames_clinicos.prestador_id` e `.valor_cobrado` são da migration
 * `20261005000000` e o client Prisma pode não conhecê-las (§11 — no Windows o
 * `prisma generate` falha com o backend no ar). Um `select` tipado derrubaria a
 * LISTAGEM INTEIRA de exames numa base ainda não migrada; aqui o pior caso é o exame
 * sair sem valor, como saía antes.
 *
 * ⚠️ O valor é SNAPSHOT do dia do pedido. Recalcular na leitura faria o exame pedido
 * em março ser cobrado pelo preço renegociado em setembro — a mesma premissa de
 * `FaturaItem.descricao` e do ledger do recibo.
 */

const prisma = require('./prisma').default;
const vinculoPrestador = require('./procedimentoPrestador');
const { TIPO_IMAGEM } = require('../seeds/005_procedimentos_imagem.seed');

/** As colunas da migration 20261005000000 existem nesta base? */
let _temColunas = null;
async function temColunas() {
  if (_temColunas !== null) return _temColunas;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_exames_clinicos'
          AND column_name IN ('prestador_id', 'valor_cobrado')`);
    _temColunas = rows.length === 2;
  } catch { _temColunas = false; }
  return _temColunas;
}

const num = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Preço de UM exame de imagem, pelo NOME, para uma empresa e (opcionalmente) um
 * prestador.
 *
 * Cadeia: vínculo do prestador → valor padrão da empresa → `valorVenda` do catálogo
 * → null. É a MESMA ordem de `resolverValorProcedimento` (o exame É um procedimento
 * agora), e o `null` do fim é deliberado: "não sei o preço" não é R$ 0,00.
 *
 * ⚠️ `valorCliente` NULO no vínculo significa "usa o valor padrão da empresa", nunca
 * zero — é o que permite vincular o prestador sem repetir um preço que já existe.
 */
async function precoDoExame(client, empresaId, nome, prestadorId = null) {
  const n = String(nome ?? '').trim();
  if (!n || !empresaId) return { valorCliente: null, valorPrestador: null, procedimentoId: null };

  // O procedimento de imagem com este nome — global ou da própria empresa.
  let proc = null;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT id, "valorVenda"
         FROM schs2vet.tb_procedimentos_vet
        WHERE "tipoProcedimento" = $1 AND ativo = true
          AND lower(btrim(nome)) = lower(btrim($2))
          AND (empresa_id IS NULL OR empresa_id = $3)
        ORDER BY (empresa_id IS NOT NULL) DESC, id ASC
        LIMIT 1`,
      TIPO_IMAGEM, n, Number(empresaId),
    );
    proc = rows[0] ?? null;
  } catch { /* base sem o catálogo unificado */ }

  if (!proc) return { valorCliente: null, valorPrestador: null, procedimentoId: null };

  // Vínculo do prestador (o mais específico que existe).
  const doVinculo = prestadorId
    ? await vinculoPrestador.resolverValoresPorNome(client, empresaId, n, prestadorId)
    : { valorCliente: null, valorPrestador: null };

  // Valor PADRÃO da empresa.
  let padrao = null;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT valor FROM schs2vet.tb_procedimento_valores_empresa
        WHERE empresa_id = $1 AND procedimento_id = $2 LIMIT 1`,
      Number(empresaId), proc.id,
    );
    padrao = num(rows[0]?.valor);
  } catch { /* segue sem o padrão */ }

  return {
    procedimentoId: proc.id,
    valorCliente:   doVinculo.valorCliente ?? padrao ?? num(proc.valorVenda),
    valorPrestador: doVinculo.valorPrestador ?? null,
  };
}

/**
 * Soma o preço dos exames de UM pedido. Os nomes chegam como a lista que a tela
 * montou (`descricao` é a mesma lista concatenada).
 *
 * ⚠️ Devolve `null` quando NENHUM dos nomes tem preço resolvível — e não 0. A
 * diferença importa: 0 seria uma afirmação ("este pedido é gratuito"), enquanto null
 * mantém o comportamento antigo (a linha de fatura nasce zerada e o financeiro
 * ajusta), que é o que vale para todo exame laboratorial.
 */
async function precoDoPedido(client, empresaId, nomes, prestadorId = null) {
  const lista = (Array.isArray(nomes) ? nomes : [nomes])
    .map(x => String(x ?? '').trim()).filter(Boolean);
  if (lista.length === 0 || !empresaId) return { valorCliente: null, valorPrestador: null };

  let cliente = null;
  let prest   = null;
  for (const nome of lista) {
    const p = await precoDoExame(client, empresaId, nome, prestadorId);
    if (p.valorCliente   != null) cliente = (cliente ?? 0) + p.valorCliente;
    if (p.valorPrestador != null) prest   = (prest   ?? 0) + p.valorPrestador;
  }
  // Dinheiro arredondado ao CENTAVO: somas de percentual fecham em
  // 55.000000000000004 e o pedido sairia com um centavo que ninguém explica.
  const cent = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return { valorCliente: cent(cliente), valorPrestador: cent(prest) };
}

/**
 * Grava prestador e valor no pedido recém-criado.
 *
 * ⚠️ NUNCA lança: falha aqui não pode derrubar a criação do pedido de exame, que é
 * ato clínico. Base não migrada devolve `false` e o exame segue como sempre seguiu.
 */
async function gravarPrestadorEValor(client, exameId, { prestadorId, valorCobrado }) {
  if (!exameId) return false;
  if (!(await temColunas())) return false;
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_exames_clinicos
          SET prestador_id = $2, valor_cobrado = $3
        WHERE id = $1`,
      Number(exameId),
      prestadorId ? Number(prestadorId) : null,
      valorCobrado == null ? null : Number(valorCobrado),
    );
    return true;
  } catch { return false; }
}

/**
 * Grava SÓ o prestador, preservando o valor já congelado.
 *
 * 🔴 Existe separado de `gravarPrestadorEValor` porque quem escolhe o prestador na
 * CONCLUSÃO do exame (2026-09-22) não pode reabrir o preço: `valor_cobrado` é o
 * snapshot do dia do PEDIDO e já foi para a fatura do cliente. Passar por aquela
 * função com `valorCobrado` indefinido gravaria NULL por cima e a linha da fatura
 * passaria a divergir do que o cliente viu.
 *
 * ⚠️ NUNCA lança, pela mesma razão da irmã: base não migrada devolve `false` e a
 * conclusão do exame segue — sem prestador, como seguia antes.
 */
async function gravarPrestador(client, exameId, prestadorId) {
  if (!exameId) return false;
  if (!(await temColunas())) return false;
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_exames_clinicos SET prestador_id = $2 WHERE id = $1`,
      Number(exameId),
      prestadorId ? Number(prestadorId) : null,
    );
    return true;
  } catch { return false; }
}

/**
 * Lê prestador e valor de um exame (ou de vários). Devolve um Map por id.
 * ⚠️ Base não migrada devolve Map vazio — quem chama trata como "sem valor".
 */
async function lerPrestadorEValor(client, exameIds) {
  const ids = [...new Set((Array.isArray(exameIds) ? exameIds : [exameIds]).map(Number).filter(Number.isInteger))];
  const vazio = new Map();
  if (ids.length === 0 || !(await temColunas())) return vazio;
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT id, prestador_id, valor_cobrado
         FROM schs2vet.tb_exames_clinicos WHERE id IN (${ph})`, ...ids);
    return new Map(rows.map(r => [r.id, {
      prestadorId:  r.prestador_id ?? null,
      valorCobrado: num(r.valor_cobrado),
    }]));
  } catch { return vazio; }
}

module.exports = {
  temColunas,
  precoDoExame,
  precoDoPedido,
  gravarPrestadorEValor,
  gravarPrestador,
  lerPrestadorEValor,
};
