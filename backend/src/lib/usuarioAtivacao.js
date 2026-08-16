// backend/src/lib/usuarioAtivacao.js
//
// Trilha de ATIVAÇÃO/INATIVAÇÃO de um usuário (tb `users`) — quem fez e quando.
// `User.ativo` sozinho só diz o estado ATUAL; a tela de Equipe (abas Ativos/
// Inativos) e a Auditoria precisam responder TAMBÉM "desde quando" e "por quem"
// — ver EquipeController.toggleMembro.
//
// Migration `20260824000000_user_ativacao_trilha`. Lido/gravado por SQL CRU,
// mesmo padrão de `lib/usuarioEmpresa.js#temColunasPagamento`: no Windows o
// `prisma generate` falha com o backend rodando, então o client tipado pode
// não conhecer as colunas recém-migradas ainda.
'use strict';

const prisma = require('./prisma').default;

// Mesma cache de `temColunasPagamento`: positivo é definitivo (colunas não somem),
// negativo expira em 60s — rodar a migration com o backend no ar volta a
// funcionar sem restart.
let _temColunas = null;
let _temColunasEm = 0;
async function temColunas() {
  if (_temColunas === true) return true;
  if (_temColunas === false && Date.now() - _temColunasEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'users'
          AND column_name = 'ativo_por_id' LIMIT 1`,
    );
    _temColunas = rows.length > 0;
  } catch { _temColunas = false; }
  _temColunasEm = Date.now();
  return _temColunas;
}

/** Grava a ATIVAÇÃO (ativo=true) + quem/quando. */
async function registrarAtivacao(client, userId, porUserId) {
  if (!(await temColunas())) return;
  await client.$executeRawUnsafe(
    `UPDATE schs2vet.users SET ativo = true, ativo_em = now(), ativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(userId),
  );
}

/** Grava a INATIVAÇÃO (ativo=false) + quem/quando. */
async function registrarInativacao(client, userId, porUserId) {
  if (!(await temColunas())) return;
  await client.$executeRawUnsafe(
    `UPDATE schs2vet.users SET ativo = false, inativo_em = now(), inativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(userId),
  );
}

/**
 * Trilha de vários usuários de uma vez:
 * Map(userId → { ativoEm, ativoPorNome, inativoEm, inativoPorNome }).
 */
async function lerTrilhaAtivacao(client, userIds) {
  const ids = [...new Set((userIds ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (ids.length === 0 || !(await temColunas())) return mapa;
  const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await client.$queryRawUnsafe(
    `SELECT u.id AS id, u.ativo_em AS ativo_em, u.inativo_em AS inativo_em,
            ap."fullName" AS ativo_por_nome, ip."fullName" AS inativo_por_nome
       FROM schs2vet.users u
       LEFT JOIN schs2vet.users ap ON ap.id = u.ativo_por_id
       LEFT JOIN schs2vet.users ip ON ip.id = u.inativo_por_id
      WHERE u.id IN (${ph})`,
    ...ids,
  );
  for (const r of rows) {
    mapa.set(r.id, {
      ativoEm:        r.ativo_em,
      ativoPorNome:   r.ativo_por_nome,
      inativoEm:      r.inativo_em,
      inativoPorNome: r.inativo_por_nome,
    });
  }
  return mapa;
}

/** Anexa a trilha ao usuário sob `chave` (ex.: membro.user), em lote. */
async function anexarTrilhaAtivacaoEmRelacao(itens, chave, client = prisma) {
  if (!Array.isArray(itens) || itens.length === 0) return itens;
  const mapa = await lerTrilhaAtivacao(client, itens.map(i => i?.[chave]?.id));
  if (mapa.size === 0) return itens;
  return itens.map(item => {
    const u = item?.[chave];
    const d = u ? mapa.get(u.id) : null;
    return d ? { ...item, [chave]: { ...u, ...d } } : item;
  });
}

module.exports = {
  registrarAtivacao,
  registrarInativacao,
  lerTrilhaAtivacao,
  anexarTrilhaAtivacaoEmRelacao,
};
