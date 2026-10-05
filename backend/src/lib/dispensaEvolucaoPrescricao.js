// backend/src/lib/dispensaEvolucaoPrescricao.js
// PRESCRIÇÃO SEM EVOLUÇÃO, POR EMPRESA — coluna `dispensa_evolucao_prescricao` (JSONB)
// de tb_empresa_configuracoes (migration 20261102000000). Configurada em Cadastro da
// Empresa › Funcionamento.
//
// ─────────────────────────────────────────────────────────────────────────────
// A REGRA
// ─────────────────────────────────────────────────────────────────────────────
//   PADRÃO (null / listas vazias) → TODA prescrição exige uma evolução aberta, como
//                                   sempre foi. A vacina é a exceção histórica, e não
//                                   passa por aqui (VacinaClinicaController).
//   Com itens liberados           → a prescrição pode ser criada SEM evolução desde que
//                                   TODOS os itens dela estejam liberados:
//     PROCEDIMENTO → nome em `procedimentos` OU especialidade (do procedimento ou do
//                    combo de mesmo nome) em `especialidades`
//     MEDICAMENTO  → `classificacao` do catálogo (`tb_medicamentos`) em `classificacoes`
//
// ⚠️ Vale SÓ para a PRESCRIÇÃO (decisão de 2026-10-03). Pedido de exame e
// encaminhamento continuam exigindo evolução.
//
// ⚠️ Medicamento DIGITADO À MÃO (sem `medicamentoCatId`) NUNCA é liberado: não tem
// classificação, e liberar o que não se sabe o que é abriria a porta inteira.
//
// ⚠️ A especialidade do procedimento é resolvida AQUI, pelo catálogo — nunca a que a
// tela manda. Confiar no corpo da requisição deixaria qualquer item passar dizendo-se
// de uma especialidade liberada.
//
// ⚠️ SQL CRU (mesma razão de etapaExecucaoPrescricao/formaCobrancaEstoque): no Windows
// o `prisma generate` falha com o backend rodando, e um campo que o client não conhece
// derrubaria o SALVAR de Configurações inteiro. `tb_empresa_configuracoes` NÃO tem
// @map nas FKs — "empresaId"/"equipeId" EXIGEM aspas (armadilha 41 do CLAUDE.md).
'use strict';

const TTL_MS   = 60_000;
const MAX_ITENS = 500;
const MAX_TAM   = 255;
const cache    = new Map(); // empresaId → { valor, expiraEm }

const VAZIO = Object.freeze({ especialidades: [], procedimentos: [], classificacoes: [] });
const CHAVES = ['especialidades', 'procedimentos', 'classificacoes'];

function invalidarCache(empresaId = null) {
  if (empresaId == null) cache.clear();
  else cache.delete(Number(empresaId));
}

/** Comparação sem acento, sem caixa e sem espaço nas pontas. */
function normalizarNome(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

function limparLista(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const out = [];
  for (const bruto of lista) {
    const v = String(bruto ?? '').trim().slice(0, MAX_TAM);
    const chave = normalizarNome(v);
    if (!v || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(v);
    if (out.length >= MAX_ITENS) break;
  }
  return out;
}

/** Forma canônica — sempre as três listas, sem repetido nem vazio. */
function canonizar(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return {
    especialidades: limparLista(o.especialidades),
    procedimentos:  limparLista(o.procedimentos),
    classificacoes: limparLista(o.classificacoes),
  };
}

const temAlgo = (r) => CHAVES.some(k => (r?.[k]?.length ?? 0) > 0);

/**
 * Normaliza o que veio do request (multipart manda JSON em string).
 * `undefined` → não altera (PATCH parcial). Retorna { erro } ou { valor }.
 */
function normalizarRegras(bruto) {
  if (bruto === undefined) return { valor: undefined };
  if (bruto === null || bruto === '') return { valor: canonizar(null) };
  let obj = bruto;
  if (typeof bruto === 'string') {
    try { obj = JSON.parse(bruto); } catch {
      return { erro: 'Configuração de prescrição sem evolução inválida.' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { erro: 'Configuração de prescrição sem evolução inválida.' };
  }
  return { valor: canonizar(obj) };
}

/** Lê do ESCOPO exato (empresa CNPJ = equipeId null; pessoal = equipe). Nunca lança. */
async function lerDoEscopo(client, empresaId, equipeId = null) {
  try {
    const rows = equipeId == null
      ? await client.$queryRawUnsafe(
          `SELECT dispensa_evolucao_prescricao AS v FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`, Number(empresaId))
      : await client.$queryRawUnsafe(
          `SELECT dispensa_evolucao_prescricao AS v FROM schs2vet.tb_empresa_configuracoes
            WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`, Number(empresaId), Number(equipeId));
    return canonizar(rows?.[0]?.v);
  } catch {
    // Coluna ainda não existe (migration não aplicada) → nada dispensado.
    return canonizar(null);
  }
}

/**
 * Regras da EMPRESA (cache 60s). Nunca falha: na dúvida, nada é dispensado — exigir a
 * evolução é o comportamento de sempre.
 * Linha da EMPRESA (equipeId null) primeiro e, não havendo, a de uma equipe — empresa
 * pessoal (CPF) configura POR EQUIPE. Mesma resolução de etapaExecucaoPrescricao.
 */
async function regrasDaEmpresa(client, empresaId) {
  if (!empresaId) return canonizar(null);
  const id    = Number(empresaId);
  const agora = Date.now();
  const hit   = cache.get(id);
  if (hit && hit.expiraEm > agora) return hit.valor;

  let valor = canonizar(null);
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT dispensa_evolucao_prescricao AS v
         FROM schs2vet.tb_empresa_configuracoes
        WHERE "empresaId" = $1
        ORDER BY "equipeId" NULLS FIRST LIMIT 1`, id);
    valor = canonizar(rows?.[0]?.v);
  } catch {
    // Migration não aplicada: segue exigindo evolução.
  }
  cache.set(id, { valor, expiraEm: agora + TTL_MS });
  return valor;
}

/**
 * Grava no escopo. A linha de configuração já existe quando isto roda.
 * Base sem a coluna: gravar "nada" é o que já vale e é ignorado; gravar alguma
 * liberação devolve 400 dizendo o que falta — fingir que gravou faria a clínica
 * esperar uma liberação que nunca valeria.
 */
async function salvarRegras(client, empresaId, equipeId, valor) {
  if (valor === undefined) return;
  const regras = canonizar(valor);
  const json   = temAlgo(regras) ? JSON.stringify(regras) : null;
  try {
    if (equipeId == null) {
      await client.$executeRawUnsafe(
        `UPDATE schs2vet.tb_empresa_configuracoes SET dispensa_evolucao_prescricao = $2::jsonb
          WHERE "empresaId" = $1 AND "equipeId" IS NULL`, Number(empresaId), json);
    } else {
      await client.$executeRawUnsafe(
        `UPDATE schs2vet.tb_empresa_configuracoes SET dispensa_evolucao_prescricao = $2::jsonb
          WHERE "empresaId" = $1 AND "equipeId" = $3`, Number(empresaId), json, Number(equipeId));
    }
  } catch (err) {
    const semColuna = err?.meta?.code === '42703' || /dispensa_evolucao_prescricao/.test(String(err?.message ?? ''));
    if (!semColuna) throw err;
    if (!json) return;
    const e = new Error('A liberação de prescrição sem evolução ainda não está disponível nesta base (migration 20261102000000 pendente).');
    e.status = 400;
    throw e;
  } finally {
    invalidarCache(empresaId);
  }
}

/**
 * Decide UM item, com os dados do catálogo já resolvidos. Função PURA.
 * @param regras   forma canônica
 * @param item     { tipo, medicamento }
 * @param contexto { classificacao: string|null, especialidades: string[] }
 */
function itemDispensado(regras, item, contexto = {}) {
  const r = canonizar(regras);
  if (!temAlgo(r)) return false;
  const tipo = item?.tipo ?? 'MEDICAMENTO';
  const em = (lista, v) => {
    const n = normalizarNome(v);
    return !!n && lista.some(x => normalizarNome(x) === n);
  };
  if (tipo === 'PROCEDIMENTO') {
    if (em(r.procedimentos, item?.medicamento)) return true;
    return (contexto.especialidades ?? []).some(e => em(r.especialidades, e));
  }
  return em(r.classificacoes, contexto.classificacao);
}

/**
 * Confere uma lista de itens contra as regras da empresa, resolvendo no CATÁLOGO a
 * classificação de cada medicamento e a especialidade de cada procedimento/combo.
 * Devolve { ok: true } ou { ok: false, item } com o PRIMEIRO item que exige evolução.
 */
async function verificarItensSemEvolucao(client, empresaId, itens) {
  const regras = await regrasDaEmpresa(client, empresaId);
  const lista  = Array.isArray(itens) ? itens : [];
  if (!temAlgo(regras)) return { ok: false, item: lista[0] ?? null, regras };

  // Medicamentos: classificação pelo id do catálogo (1 query).
  const catIds = [...new Set(lista
    .filter(i => (i.tipo ?? 'MEDICAMENTO') !== 'PROCEDIMENTO' && i.medicamentoCatId)
    .map(i => Number(i.medicamentoCatId)))];
  const classifPorId = new Map();
  if (catIds.length) {
    const meds = await client.medicamento.findMany({
      where: { id: { in: catIds } }, select: { id: true, classificacao: true },
    });
    for (const m of meds) classifPorId.set(m.id, m.classificacao ?? null);
  }

  // Procedimentos: especialidade pelo NOME (procedimento não tem FK na prescrição) —
  // no catálogo de procedimentos e no de combos. O RLS recorta à empresa.
  const nomesProc = [...new Set(lista
    .filter(i => (i.tipo ?? 'MEDICAMENTO') === 'PROCEDIMENTO')
    .map(i => String(i.medicamento ?? '').trim())
    .filter(Boolean))];
  const espPorNome = new Map();
  if (nomesProc.length) {
    const filtroNome = { OR: nomesProc.map(n => ({ nome: { equals: n, mode: 'insensitive' } })) };
    const [procs, combos] = await Promise.all([
      client.procedimentoVeterinario.findMany({ where: filtroNome, select: { nome: true, especialidade: true } }),
      client.procedimentoCombo.findMany({ where: filtroNome, select: { nome: true, especialidade: true } })
        .catch(() => []),
    ]);
    for (const p of [...procs, ...combos]) {
      if (!p.especialidade) continue;
      const k = normalizarNome(p.nome);
      if (!espPorNome.has(k)) espPorNome.set(k, []);
      espPorNome.get(k).push(p.especialidade);
    }
  }

  for (const item of lista) {
    const tipo = item.tipo ?? 'MEDICAMENTO';
    const contexto = tipo === 'PROCEDIMENTO'
      ? { especialidades: espPorNome.get(normalizarNome(item.medicamento)) ?? [] }
      : { classificacao: item.medicamentoCatId ? (classifPorId.get(Number(item.medicamentoCatId)) ?? null) : null };
    if (!itemDispensado(regras, item, contexto)) return { ok: false, item, regras };
  }
  return { ok: true, regras };
}

/** Mensagem da recusa — diz QUAL item e ONDE se libera. */
function mensagemExigeEvolucao(item) {
  const nome = String(item?.medicamento ?? '').trim();
  return nome
    ? `"${nome}" exige uma evolução aberta. Inicie uma evolução, ou libere-o em Cadastro da Empresa › Funcionamento.`
    : 'Esta prescrição exige uma evolução aberta. Inicie uma evolução na aba Evolução.';
}

module.exports = {
  VAZIO, normalizarNome, canonizar, temAlgo, normalizarRegras,
  lerDoEscopo, regrasDaEmpresa, salvarRegras, invalidarCache,
  itemDispensado, verificarItensSemEvolucao, mensagemExigeEvolucao,
};
