// backend/src/lib/alimentoUnidade.js
'use strict';

/**
 * Unidade padrão do alimento (kg, g, L, mL, unidade, porção).
 *
 * POR QUE EXISTE
 * O campo sempre esteve na TELA (`criaAlimentos.tsx`) e na listagem, e o controller
 * já o mandava para o `prisma.alimento.create` — só que a coluna não existia nem no
 * `schema.prisma` nem no banco. O cadastro inteiro morria com
 * `Unknown argument 'unidade'`: não era um campo que deixava de gravar, era o
 * ALIMENTO que não nascia.
 *
 * ACESSO POR SQL CRU (parametrizado), mesmo padrão de `lib/agendamentoAssumido.js` e
 * `lib/usuarioEmpresa.js`: pelo client tipado, uma base ainda sem a migration
 * `20261003000000_alimento_unidade` derrubaria de novo o cadastro — e no Windows o
 * `prisma generate` falha com o backend rodando (CLAUDE.md §11).
 *
 * ⚠️ Coluna ausente NÃO é erro: `unidade` volta `null` e o alimento é cadastrado
 * normalmente, sem a unidade. É o pior caso aceitável — o oposto do que acontecia.
 */

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_alimentos';

/** `''`/`undefined` viram null — a tela usa o vazio para "não informado". */
function normalizarUnidade(valor) {
  const texto = String(valor ?? '').trim();
  return texto === '' ? null : texto.slice(0, 40);
}

/** Grava a unidade. Silencioso quando a coluna ainda não existe. */
async function salvarUnidade(id, unidade, client) {
  const db = client || prismaPadrao;
  try {
    await db.$executeRawUnsafe(
      `UPDATE ${TABELA} SET "unidade" = $2 WHERE id = $1`,
      Number(id),
      normalizarUnidade(unidade),
    );
    return true;
  } catch {
    return false; // base sem a migration
  }
}

/** Lê a unidade de vários alimentos de uma vez. Map<id, string|null>. */
async function lerUnidades(ids, client) {
  const db = client || prismaPadrao;
  const alvo = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (alvo.length === 0) return new Map();

  try {
    const linhas = await db.$queryRawUnsafe(
      `SELECT id, "unidade" FROM ${TABELA} WHERE id = ANY($1::int[])`,
      alvo,
    );
    return new Map(linhas.map((l) => [Number(l.id), l.unidade ?? null]));
  } catch {
    return new Map(); // base sem a migration
  }
}

/** Anexa `unidade` a um alimento (ou a uma lista deles). */
async function anexarUnidade(alimentoOuLista, client) {
  const lista = Array.isArray(alimentoOuLista) ? alimentoOuLista : [alimentoOuLista];
  const validos = lista.filter(Boolean);
  if (validos.length === 0) return alimentoOuLista;

  const mapa = await lerUnidades(validos.map((a) => a.id), client);
  const comUnidade = lista.map((a) => (a ? { ...a, unidade: mapa.get(Number(a.id)) ?? null } : a));
  return Array.isArray(alimentoOuLista) ? comUnidade : comUnidade[0];
}

module.exports = { normalizarUnidade, salvarUnidade, lerUnidades, anexarUnidade };
