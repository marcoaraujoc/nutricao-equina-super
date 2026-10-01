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
const { lerCobrancaPorImagem } = require('./cobrancaPorImagem');
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
  const nenhum = { valorCliente: null, valorPrestador: null, procedimentoId: null, porImagem: false };
  if (!n || !empresaId) return nenhum;

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

  if (!proc) return nenhum;

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

  // Valor ÚNICO × POR IMAGEM (migration 20261030000000). Base sem a coluna = único.
  const porImagem = (await lerCobrancaPorImagem(client, proc.id)).get(Number(proc.id)) === true;

  return {
    procedimentoId: proc.id,
    valorCliente:   doVinculo.valorCliente ?? padrao ?? num(proc.valorVenda),
    valorPrestador: doVinculo.valorPrestador ?? null,
    porImagem,
  };
}

const qtdValida = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/**
 * Os exames de UM pedido, cada um com a SUA quantidade de imagens.
 *
 * 🔴 A quantidade é do GRUPO, não do pedido: a tela monta um grupo por "Inserir",
 * cada um com os seus exames e a sua "Quantidade de imagens", e o pedido guarda a
 * SOMA em `qtdAmostra`. Multiplicar cada exame pela soma cobraria 3 imagens de um
 * raio-x em que foi pedida 1, só porque outro grupo do mesmo pedido tinha 2.
 * Ordem de fonte: `grupos[]` (payload da criação, ou o JSON gravado em `observacao`)
 * → lista de nomes + `qtdAmostra` do pedido (pedido de um grupo só).
 * ⚠️ Fora de Imagem a quantidade é de AMOSTRAS e não entra no preço: qtd = 1.
 *
 * @returns {Array<{ nome: string, qtd: number }>}
 */
function itensDoPedido({ tipo, grupos, nomes, descricao, qtdAmostra } = {}) {
  const ehImagem = tipo === 'Imagem';
  const gs = Array.isArray(grupos) ? grupos.filter(g => Array.isArray(g?.exames) && g.exames.length > 0) : [];
  if (gs.length > 0) {
    return gs.flatMap(g => g.exames
      .map(x => String(x ?? '').trim()).filter(Boolean)
      .map(nome => ({ nome, qtd: ehImagem ? qtdValida(g.qtdAmostra) : 1 })));
  }
  const lista = Array.isArray(nomes) && nomes.length > 0
    ? nomes
    : String(descricao ?? '').split(',');
  return lista.map(x => String(x ?? '').trim()).filter(Boolean)
    .map(nome => ({ nome, qtd: ehImagem ? qtdValida(qtdAmostra) : 1 }));
}

/** Os grupos que a criação gravou no JSON de `observacao` (null se não houver). */
function gruposDaObservacao(observacao) {
  try {
    const o = JSON.parse(observacao ?? '');
    return Array.isArray(o?.grupos) ? o.grupos : null;
  } catch { return null; }
}

/**
 * Soma o preço dos exames de UM pedido. Cada item é o nome do exame (qtd 1) ou
 * `{ nome, qtd }` — ver `itensDoPedido`.
 *
 * 🔴 VALOR POR IMAGEM (2026-09-30): exame cadastrado como "por imagem" tem o valor
 * multiplicado pela quantidade de imagens — o do cliente E o do prestador, que é pago
 * pelo mesmo serviço. "Valor único" ignora a quantidade, como sempre ignorou.
 *
 * ⚠️ Devolve `null` quando NENHUM dos nomes tem preço resolvível — e não 0. A
 * diferença importa: 0 seria uma afirmação ("este pedido é gratuito"), enquanto null
 * mantém o comportamento antigo (a linha de fatura nasce zerada e o financeiro
 * ajusta), que é o que vale para todo exame laboratorial.
 */
async function precoDoPedido(client, empresaId, nomes, prestadorId = null) {
  const lista = (Array.isArray(nomes) ? nomes : [nomes])
    .map(x => (x && typeof x === 'object')
      ? { nome: String(x.nome ?? '').trim(), qtd: qtdValida(x.qtd) }
      : { nome: String(x ?? '').trim(), qtd: 1 })
    .filter(x => x.nome);
  // Dinheiro arredondado ao CENTAVO: somas de percentual fecham em
  // 55.000000000000004 e o pedido sairia com um centavo que ninguém explica.
  const cent = (v) => (v == null ? null : Math.round(v * 100) / 100);
  const vazio = { valorCliente: null, valorPrestador: null, linha: null, porImagem: false };
  if (lista.length === 0 || !empresaId) return vazio;

  let cliente = null;
  let prest   = null;
  const resolvidos = [];
  for (const { nome, qtd } of lista) {
    const p = await precoDoExame(client, empresaId, nome, prestadorId);
    const mult = p.porImagem ? qtd : 1;
    if (p.valorCliente   != null) cliente = (cliente ?? 0) + p.valorCliente * mult;
    if (p.valorPrestador != null) prest   = (prest   ?? 0) + p.valorPrestador * mult;
    if (p.valorCliente   != null) resolvidos.push({ ...p, qtd: mult });
  }

  // Como a linha aparece na FATURA: pedido de UM exame cobrado por imagem sai como
  // "valor da imagem × N" — a quantidade fica legível para o cliente. Qualquer outro
  // formato (vários exames, valor único) sai como o TOTAL × 1, como sempre saiu.
  const unico = resolvidos.length === 1 && lista.length === 1 ? resolvidos[0] : null;
  const linha = cliente == null ? null
    : (unico && unico.porImagem && unico.qtd > 1)
      ? { valor: cent(unico.valorCliente), quantidade: unico.qtd }
      : { valor: cent(cliente), quantidade: 1 };

  return {
    valorCliente: cent(cliente),
    valorPrestador: cent(prest),
    linha,
    porImagem:      resolvidos.some(r => r.porImagem),
  };
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
  itensDoPedido,
  gruposDaObservacao,
  gravarPrestadorEValor,
  gravarPrestador,
  lerPrestadorEValor,
};
