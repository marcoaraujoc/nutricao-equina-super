'use strict';
// lib/formasRecebimentoFatura.js — COMO O CLIENTE QUER RECEBER A FATURA
// (migration 20261017000000). E-mail, WhatsApp e/ou impresso — pode ser mais de uma.
//
// 🔴 SQL CRU, COM GUARDA DE EXISTÊNCIA DA COLUNA — mesmo padrão de `lib/animalFei.js`,
// `lib/usuarioEmpresa.js` (remuneração/acesso) e `lib/proprietarioLocalidades.js`. A
// razão é operacional e já mordeu antes: no Windows o `prisma generate` FALHA com o
// backend rodando, então o client em execução pode não conhecer a coluna nova. Passar
// `formasRecebimentoFatura` ao `proprietarioPerfil.upsert` nesse estado não erra só o
// campo — derruba o CADASTRO DE CLIENTE inteiro. É também por isso que a coluna NÃO
// entra em `CAMPOS_PERFIL` de `lib/proprietarioPerfil.js`, que monta o `select` tipado.
//
// ⚠️ SQL cru para coluna inexistente DENTRO de uma transaction aborta a TRANSACTION
// INTEIRA no Postgres (25P02), e o `try/catch` em JS não desfaz isso: quem estoura é o
// comando SEGUINTE, longe do culpado. Por isso a guarda vem ANTES de qualquer acesso.
//
// ⚠️ TENANCY: todo acesso é por (userId, empresaId), e `empresaId` é SEMPRE o
// `req.empresaId` do contexto ativo — nunca um id vindo do corpo do request. O RLS de
// `tb_proprietario_perfis` (tenant direto, FORCE) continua valendo por baixo: esta lib
// não amplia escopo nenhum, só lê/grava uma coluna da linha que a empresa já enxerga.

const prisma = require('./prisma').default;

/**
 * As formas pelas quais a fatura CHEGA AO CLIENTE. Exportar CSV não está aqui de
 * propósito: aquilo baixa um arquivo para a clínica, não entrega nada ao cliente
 * (é a mesma distinção que a §6 faz ao dar cor própria ao "exportar").
 */
const FORMAS = ['EMAIL', 'WHATSAPP', 'IMPRESSO'];

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
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_proprietario_perfis'
          AND column_name = 'formas_recebimento_fatura' LIMIT 1`,
    );
    _temColuna = rows.length > 0;
  } catch { _temColuna = false; }
  _temColunaEm = Date.now();
  return _temColuna;
}

/**
 * Normaliza o que veio do corpo do request.
 *
 * `undefined` = o campo NÃO foi enviado → `{ formas: undefined }`, e o salvar não toca
 * no que está gravado. Tela antiga (ou payload parcial) não pode apagar a preferência.
 *
 * Aceita array (`['EMAIL','WHATSAPP']`) ou CSV. Descarta desconhecido e repetido, e
 * preserva a ORDEM de FORMAS — assim a mesma escolha grava sempre a mesma string e o
 * diff da auditoria não acusa mudança onde não houve.
 *
 * ⚠️ Lista VAZIA é recusada com erro, não gravada: "não quero receber de jeito nenhum"
 * deixaria a fatura sem nenhuma saída e o financeiro sem entender por quê. Quem não
 * declarou nada continua com NULL (= todas), que é outra coisa.
 */
function normalizarFormas(valor) {
  if (valor === undefined || valor === null) return { formas: undefined };
  const bruto = Array.isArray(valor) ? valor : String(valor).split(',');
  const pedidas = new Set(
    bruto.map(v => String(v ?? '').trim().toUpperCase()).filter(Boolean),
  );
  const formas = FORMAS.filter(f => pedidas.has(f));
  if (formas.length === 0) {
    return { erro: 'Informe ao menos uma forma de recebimento da fatura (e-mail, WhatsApp ou impresso)' };
  }
  return { formas };
}

/** CSV do banco → array normalizado. Vazio/NULL/lixo = TODAS as formas. */
function formasDoTexto(csv) {
  if (!csv) return [...FORMAS];
  const guardadas = new Set(String(csv).split(',').map(v => v.trim().toUpperCase()).filter(Boolean));
  const formas = FORMAS.filter(f => guardadas.has(f));
  return formas.length > 0 ? formas : [...FORMAS];
}

/**
 * Grava a preferência do cliente NESTA empresa. Silenciosa quando a coluna ainda não
 * existe (a migration é aplicada à parte) e quando `formas` é `undefined`.
 */
async function salvarFormas(client, userId, empresaId, formas) {
  if (formas === undefined || !userId || !empresaId) return;
  if (!(await temColuna())) return;
  await (client ?? prisma).$executeRawUnsafe(
    `UPDATE "schs2vet"."tb_proprietario_perfis"
        SET "formas_recebimento_fatura" = $1
      WHERE "user_id" = $2 AND "empresa_id" = $3`,
    formas.join(','), Number(userId), Number(empresaId),
  );
}

/** Mapa userId → string[], em BLOCO (nunca uma consulta por linha de lista). */
async function formasPorUsuario(userIds, empresaId, client = prisma) {
  const alvos = [...new Set((userIds ?? []).map(Number).filter(Number.isFinite))];
  const mapa = new Map();
  if (alvos.length === 0 || !empresaId) return mapa;
  if (!(await temColuna())) return mapa;
  try {
    const rows = await (client ?? prisma).$queryRawUnsafe(
      `SELECT "user_id" AS "userId", "formas_recebimento_fatura" AS "formas"
         FROM "schs2vet"."tb_proprietario_perfis"
        WHERE "empresa_id" = $1 AND "user_id" = ANY($2::int[])`,
      Number(empresaId), alvos,
    );
    for (const r of rows) mapa.set(Number(r.userId), formasDoTexto(r.formas));
  } catch { /* sem a coluna/linha, cai no default de `anexarFormas` */ }
  return mapa;
}

/**
 * Anexa `formasRecebimentoFatura` a um cliente (ou a uma lista).
 *
 * ⚠️ Sem cadastro na empresa, sem a coluna, ou com o campo em branco, devolve TODAS as
 * formas — que é o comportamento de hoje. Devolver lista vazia apagaria os botões de
 * envio de toda a base legada em silêncio.
 */
async function anexarFormas(clienteOuLista, empresaId, client = prisma) {
  if (!clienteOuLista) return clienteOuLista;
  const lista = Array.isArray(clienteOuLista) ? clienteOuLista : [clienteOuLista];
  const mapa = await formasPorUsuario(lista.map(p => p?.id), empresaId, client);
  const comFormas = lista.map(p => (
    p ? { ...p, formasRecebimentoFatura: mapa.get(Number(p.id)) ?? [...FORMAS] } : p
  ));
  return Array.isArray(clienteOuLista) ? comFormas : comFormas[0];
}

module.exports = {
  FORMAS, temColuna, normalizarFormas, formasDoTexto,
  salvarFormas, formasPorUsuario, anexarFormas,
};
