// backend/src/lib/formaCobrancaEstoque.js
// FORMA DE COBRANÇA DE MEDICAMENTO/VACINA — como o item que SAI DO ESTOQUE é
// precificado na fatura do cliente. Colunas `forma_cobranca_estoque` e
// `percentual_cobranca_estoque` de tb_empresa_configuracoes
// (migration 20261007000000).
//
// ─────────────────────────────────────────────────────────────────────────────
// AS QUATRO FORMAS
// ─────────────────────────────────────────────────────────────────────────────
//   VALOR_REPASSADO  o preço repassado DAQUELE lote (o que o sistema sempre fez)
//   PERCENTUAL       o repassado do lote + N% de acréscimo
//   MAIOR_VALOR      o MAIOR preço repassado entre as entradas EM ESTOQUE
//   CUSTO_MEDIO      média ponderada pela quantidade em estoque:
//                    Σ(preço_i × qtd_i) / Σ(qtd_i)
//
// 🔴 A CONSEQUÊNCIA NA FATURA NÃO É COSMÉTICA. As duas primeiras dão um preço POR
// LOTE, então uma saída tirada de dois lotes com preços diferentes sai em DUAS linhas
// (é `adicionarOuSomarFaturaItem` que só consolida linhas de mesmo valor unitário).
// As duas últimas dão o MESMO preço para todo lote, e a mesma saída vira UMA linha
// com a quantidade somada. Exemplo real (estoque: 2 un a 120 e 6 un a 150, saída de
// 1 un de cada lote):
//     VALOR_REPASSADO → 1×120 + 1×150            (duas linhas)
//     PERCENTUAL 10%  → 1×132 + 1×165            (duas linhas)
//     MAIOR_VALOR     → 2×150 = 300              (uma linha)
//     CUSTO_MEDIO     → 2×142,50 = 285           (uma linha)
//
// ⚠️ `null` = VALOR_REPASSADO: é o comportamento que toda clínica tem hoje, e é por
// isso que a migration não tem backfill — ninguém muda de preço ao aplicá-la.
//
// ⚠️ SQL CRU (mesma razão de validadeOrcamento/fusoEmpresa): no Windows o
// `prisma generate` falha com o backend rodando, e passar um campo que o client ainda
// não conhece ao update derrubaria o SALVAR de Configurações INTEIRO. Sempre
// parametrizado. E `tb_empresa_configuracoes` é das poucas tabelas SEM @map nas FKs —
// as colunas chamam-se "empresaId"/"equipeId" (camelCase) e EXIGEM aspas no Postgres
// (armadilha 41 do CLAUDE.md).
'use strict';

const FORMAS = {
  VALOR_REPASSADO: 'VALOR_REPASSADO',
  PERCENTUAL:      'PERCENTUAL',
  MAIOR_VALOR:     'MAIOR_VALOR',
  CUSTO_MEDIO:     'CUSTO_MEDIO',
};
const FORMAS_VALIDAS = Object.values(FORMAS);

/** O que vale para quem nunca configurou — o comportamento histórico do sistema. */
const FORMA_PADRAO = FORMAS.VALOR_REPASSADO;

const PERCENTUAL_MIN = 0;
const PERCENTUAL_MAX = 1000; // acréscimo, não desconto: negativo não entra

const TTL_MS = 60_000;
const cache  = new Map(); // empresaId → { cfg, expiraEm }

function invalidarCache(empresaId = null) {
  if (empresaId == null) cache.clear();
  else cache.delete(Number(empresaId));
}

/**
 * Normaliza o que veio do request.
 * `forma === undefined` → não altera nada (PATCH parcial).
 * Retorna { erro } ou { forma, percentual }.
 */
function normalizarForma(forma, percentual) {
  if (forma === undefined) return { forma: undefined, percentual: undefined };

  const f = String(forma ?? '').trim().toUpperCase();
  if (f === '') return { forma: null, percentual: null }; // volta ao padrão

  if (!FORMAS_VALIDAS.includes(f)) {
    return { erro: `Forma de cobrança inválida — use uma de: ${FORMAS_VALIDAS.join(', ')}.` };
  }

  // Percentual só existe na forma PERCENTUAL. Nas outras é gravado como null, senão
  // um número esquecido ali voltaria a valer ao trocar a forma de volta, sem ninguém
  // ter digitado nada.
  if (f !== FORMAS.PERCENTUAL) return { forma: f, percentual: null };

  const s = String(percentual ?? '').trim().replace(',', '.');
  if (s === '') return { erro: 'Informe o percentual a ser acrescido.' };

  const n = Number(s);
  if (!Number.isFinite(n) || n < PERCENTUAL_MIN || n > PERCENTUAL_MAX) {
    return { erro: `Percentual inválido — informe de ${PERCENTUAL_MIN} a ${PERCENTUAL_MAX}.` };
  }
  return { forma: f, percentual: n };
}

/** Lê a configuração do ESCOPO exato (empresa CNPJ = equipeId null; pessoal = equipe). */
async function lerFormaDoEscopo(client, empresaId, equipeId = null) {
  try {
    const rows = equipeId == null
      ? await client.$queryRawUnsafe(
          `SELECT forma_cobranca_estoque AS forma,
                  percentual_cobranca_estoque::float AS percentual
             FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`, Number(empresaId))
      : await client.$queryRawUnsafe(
          `SELECT forma_cobranca_estoque AS forma,
                  percentual_cobranca_estoque::float AS percentual
             FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`, Number(empresaId), Number(equipeId));
    const r = rows?.[0];
    return {
      forma:      r?.forma ? String(r.forma) : FORMA_PADRAO,
      percentual: r?.percentual == null ? null : Number(r.percentual),
    };
  } catch {
    // Coluna ainda não existe (migration não aplicada) → comportamento de sempre.
    return { forma: FORMA_PADRAO, percentual: null };
  }
}

/**
 * Forma EFETIVA da empresa. Nunca falha e nunca devolve null: quem chama está prestes
 * a precificar uma linha de fatura.
 *
 * 🔴 Procura primeiro a linha da EMPRESA (equipeId null) e, não achando, qualquer
 * linha daquela empresa — empresa pessoal (CPF) configura POR EQUIPE, e sem esse
 * fallback ela nunca enxergaria a própria escolha. Mesma resolução de `fusoDaEmpresa`.
 */
async function lerForma(client, empresaId) {
  if (!empresaId) return { forma: FORMA_PADRAO, percentual: null };
  const id    = Number(empresaId);
  const agora = Date.now();
  const hit   = cache.get(id);
  if (hit && hit.expiraEm > agora) return hit.cfg;

  let cfg = { forma: FORMA_PADRAO, percentual: null };
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT forma_cobranca_estoque AS forma,
              percentual_cobranca_estoque::float AS percentual
         FROM schs2vet.tb_empresa_configuracoes
        WHERE "empresaId" = $1 AND forma_cobranca_estoque IS NOT NULL
        ORDER BY "equipeId" NULLS FIRST LIMIT 1`, id);
    const r = rows?.[0];
    if (r?.forma) {
      cfg = { forma: String(r.forma), percentual: r.percentual == null ? null : Number(r.percentual) };
    }
  } catch {
    // Migration não aplicada: segue no padrão (preço do lote), como sempre foi.
  }
  cache.set(id, { cfg, expiraEm: agora + TTL_MS });
  return cfg;
}

/** Grava no escopo. A linha de configuração já existe quando isto roda. */
async function salvarForma(client, empresaId, equipeId, forma, percentual) {
  if (forma === undefined) return;
  const f = forma == null ? null : String(forma);
  const p = percentual == null ? null : Number(percentual);
  if (equipeId == null) {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes
          SET forma_cobranca_estoque = $2, percentual_cobranca_estoque = $3
        WHERE "empresaId" = $1 AND "equipeId" IS NULL`, Number(empresaId), f, p);
  } else {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_empresa_configuracoes
          SET forma_cobranca_estoque = $2, percentual_cobranca_estoque = $3
        WHERE "empresaId" = $1 AND "equipeId" = $4`, Number(empresaId), f, p, Number(equipeId));
  }
  invalidarCache(empresaId);
}

/**
 * 🔴 O CÁLCULO — função PURA, sem banco, e o único lugar onde a regra existe.
 *
 * @param cfg          { forma, percentual }
 * @param precoDoLote  preço unitário da entrada efetivamente debitada (R$/unidade base
 *                     no medicamento, R$/dose na vacina)
 * @param entradas     [{ preco, qtd }] das entradas ATIVAS do mesmo item, com a
 *                     quantidade AINDA EM ESTOQUE — o retrato de ANTES da baixa.
 * @returns preço unitário a cobrar do cliente
 *
 * ⚠️ Entrada sem saldo fica FORA de MAIOR_VALOR e de CUSTO_MEDIO: ela não está "dentro
 * do estoque", e um lote zerado e caro puxaria o preço de todo mundo para cima.
 * ⚠️ Sem nenhuma entrada com saldo (execução forçada), cai no preço do lote — nunca
 * zero: cobrar zero afirmaria que o item é gratuito.
 */
function precoDeVenda(cfg, precoDoLote, entradas = []) {
  const base  = Number(precoDoLote) || 0;
  const forma = cfg?.forma ?? FORMA_PADRAO;
  const uteis = (entradas ?? []).filter(e => Number(e?.qtd) > 0 && Number(e?.preco) > 0);

  switch (forma) {
    case FORMAS.PERCENTUAL: {
      const p = Number(cfg?.percentual);
      return Number.isFinite(p) ? base * (1 + p / 100) : base;
    }
    case FORMAS.MAIOR_VALOR: {
      if (uteis.length === 0) return base;
      return Math.max(...uteis.map(e => Number(e.preco)));
    }
    case FORMAS.CUSTO_MEDIO: {
      if (uteis.length === 0) return base;
      const valor = uteis.reduce((s, e) => s + Number(e.preco) * Number(e.qtd), 0);
      const qtd   = uteis.reduce((s, e) => s + Number(e.qtd), 0);
      return qtd > 0 ? valor / qtd : base;
    }
    default:
      return base; // VALOR_REPASSADO
  }
}

module.exports = {
  FORMAS, FORMAS_VALIDAS, FORMA_PADRAO, PERCENTUAL_MIN, PERCENTUAL_MAX,
  normalizarForma, lerForma, lerFormaDoEscopo, salvarForma, invalidarCache,
  precoDeVenda,
};
