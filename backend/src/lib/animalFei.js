'use strict';
// lib/animalFei.js — REGISTRO NA FEI do paciente (migration 20261016000000)
//
// 🔴 SQL CRU, COM GUARDA DE EXISTÊNCIA DA COLUNA — mesmo padrão de
// `lib/usuarioEmpresa.js` (remuneração/acesso), `isConvidado` e
// `cadastroConfirmadoEm`. A razão é operacional e já mordeu antes: no Windows o
// `prisma generate` FALHA com o backend rodando, então o client em execução pode não
// conhecer a coluna nova. Passar `registradoFei` para `prisma.animal.create` nesse
// estado não erra só o campo — derruba o CADASTRO DE PACIENTE inteiro.
//
// ⚠️ SQL cru para coluna inexistente DENTRO de uma transaction aborta a TRANSACTION
// INTEIRA no Postgres (25P02), e o `try/catch` em JS não desfaz isso: quem estoura é o
// comando SEGUINTE, longe do culpado. Por isso a guarda vem ANTES de qualquer acesso.
//
// ⚠️ TENANCY: todo acesso aqui é por `id` de animal que o chamador JÁ autorizou
// (`verificarAcessoAnimal` / `ANIMAL_VISIVEL`), e o RLS de `tb_animais` continua
// valendo por baixo — esta lib não amplia escopo nenhum, só lê/grava uma coluna.

const prisma = require('./prisma').default;

let _temColuna   = null;
let _temColunaEm = 0;

/**
 * A coluna já existe no banco? `false` expira em 60s — aplicar a migration com o
 * backend no ar volta a funcionar sem restart.
 */
async function temColuna() {
  if (_temColuna === true) return true;
  if (_temColuna === false && Date.now() - _temColunaEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_animais'
          AND column_name = 'registrado_fei' LIMIT 1`,
    );
    _temColuna = rows.length > 0;
  } catch { _temColuna = false; }
  _temColunaEm = Date.now();
  return _temColuna;
}

/** Normaliza o que veio do corpo do request. `undefined` = o campo não foi enviado. */
function valorDoBody(v) {
  if (v === undefined) return undefined;
  // Checkbox chega como boolean pelo JSON, mas multipart manda 'true'/'false'
  // (string) — e `Boolean('false')` é `true`, que gravaria o oposto do marcado.
  if (typeof v === 'string') return v === 'true' || v === '1';
  return !!v;
}

/**
 * Grava o registro na FEI de UM animal. Silenciosa quando a coluna ainda não existe
 * (a migration é gerada e aplicada à parte) e quando `valor` é `undefined` — não
 * enviar o campo NÃO pode apagar o que já está gravado.
 */
async function salvarFei(client, animalId, valor) {
  const v = valorDoBody(valor);
  if (v === undefined || !animalId) return;
  if (!(await temColuna())) return;
  await (client ?? prisma).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_animais" SET "registrado_fei" = $1 WHERE "id" = $2`,
    v, Number(animalId),
  );
}

/** Mapa id → boolean, em BLOCO (nunca uma consulta por item de lista). */
async function feiPorAnimal(ids) {
  const alvos = [...new Set((ids ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (alvos.length === 0) return mapa;
  if (!(await temColuna())) return mapa;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "registrado_fei" FROM "schs2vet"."tb_animais" WHERE "id" = ANY($1::int[])`,
    alvos,
  );
  for (const r of rows) mapa.set(Number(r.id), !!r.registrado_fei);
  return mapa;
}

/**
 * Anexa `registradoFei` a um animal (ou a uma lista). Sem a coluna, devolve `false`
 * — que é o valor de toda base existente, e o que a tela desenharia de qualquer jeito.
 */
async function anexarFei(animalOuLista) {
  if (!animalOuLista) return animalOuLista;
  const lista = Array.isArray(animalOuLista) ? animalOuLista : [animalOuLista];
  const mapa = await feiPorAnimal(lista.map(a => a?.id));
  const comFei = lista.map(a => (a ? { ...a, registradoFei: mapa.get(Number(a.id)) ?? false } : a));
  return Array.isArray(animalOuLista) ? comFei : comFei[0];
}

module.exports = { temColuna, valorDoBody, salvarFei, feiPorAnimal, anexarFei };
