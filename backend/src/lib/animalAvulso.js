'use strict';
// lib/animalAvulso.js — PACIENTE AVULSO (migration 20261104000000)
//
// 🔴 SQL CRU, COM GUARDA DE EXISTÊNCIA DA COLUNA — mesmo padrão de `lib/animalFei.js`.
// No Windows o `prisma generate` FALHA com o backend rodando, e passar `avulso` para
// `prisma.animal.create` com o client defasado derrubaria o CADASTRO DE PACIENTE
// inteiro, não só o campo novo.
//
// ⚠️ TENANCY: todo acesso é por `id` de animal que o chamador JÁ autorizou, e o RLS de
// `tb_animais` continua valendo por baixo — esta lib não amplia escopo nenhum.

const prisma = require('./prisma').default;
const { valorDoBody } = require('./animalFei');

let _temColuna   = null;
let _temColunaEm = 0;

/** A coluna já existe? `false` expira em 60s — aplicar a migration dispensa restart. */
async function temColuna() {
  if (_temColuna === true) return true;
  if (_temColuna === false && Date.now() - _temColunaEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_animais'
          AND column_name = 'avulso' LIMIT 1`,
    );
    _temColuna = rows.length > 0;
  } catch { _temColuna = false; }
  _temColunaEm = Date.now();
  return _temColuna;
}

/**
 * Grava a marca de avulso de UM animal. Silenciosa sem a coluna e quando `valor` é
 * `undefined` — não enviar o campo NÃO pode apagar o que já está gravado.
 */
async function salvarAvulso(client, animalId, valor) {
  const v = valorDoBody(valor);
  if (v === undefined || !animalId) return;
  if (!(await temColuna())) return;
  await (client ?? prisma).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_animais" SET "avulso" = $1 WHERE "id" = $2`,
    v, Number(animalId),
  );
}

/** Anexa `avulso` a um animal (ou lista), em BLOCO. Sem a coluna, `false`. */
async function anexarAvulso(animalOuLista) {
  if (!animalOuLista) return animalOuLista;
  const lista = Array.isArray(animalOuLista) ? animalOuLista : [animalOuLista];
  const ids = [...new Set(lista.map(a => Number(a?.id)).filter(Number.isFinite))];
  const mapa = new Map();
  if (ids.length > 0 && (await temColuna())) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "avulso" FROM "schs2vet"."tb_animais" WHERE "id" = ANY($1::int[])`,
      ids,
    );
    for (const r of rows) mapa.set(Number(r.id), !!r.avulso);
  }
  const com = lista.map(a => (a ? { ...a, avulso: mapa.get(Number(a.id)) ?? false } : a));
  return Array.isArray(animalOuLista) ? com : com[0];
}

/**
 * Regra do paciente AVULSO: localização e contato do proprietário são obrigatórios.
 * A tela já confere, mas é aqui que a regra vale (tela nenhuma segura integridade).
 *
 * @param {object} p
 * @param {unknown} p.avulso         valor do body (boolean ou 'true'/'false' do multipart)
 * @param {unknown} p.localizacaoId  local EFETIVO do animal (na edição, o gravado se não veio)
 * @param {object|null} p.proprietario dados do dono enviados pela tela (null = não enviados)
 * @param {boolean} p.exigirEmail    true quando o dono está sendo identificado agora (criação)
 * @returns {string|null} mensagem de erro, ou null quando está tudo certo
 */
function erroPacienteAvulso({ avulso, localizacaoId, proprietario, exigirEmail }) {
  if (valorDoBody(avulso) !== true) return null;
  if (!localizacaoId) return 'Paciente avulso: a localização é obrigatória.';
  if (!proprietario) return null;
  if (exigirEmail && !String(proprietario.email ?? '').trim()) {
    return 'Paciente avulso: o e-mail do proprietário é obrigatório.';
  }
  const digitos = String(proprietario.phone ?? '').replace(/\D/g, '');
  if (!digitos) return 'Paciente avulso: o telefone do proprietário é obrigatório.';
  return null;
}

module.exports = { temColuna, salvarAvulso, anexarAvulso, erroPacienteAvulso };
