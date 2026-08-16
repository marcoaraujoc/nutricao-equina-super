// backend/src/lib/cadastroAtivacao.js
//
// Trilha de ATIVAÇÃO/INATIVAÇÃO de Fornecedor, Prestador e Tratador — mesma lógica
// de `lib/usuarioAtivacao.js` (User/Equipe), generalizada por tabela: `ativo`
// sozinho só diz o estado ATUAL; as telas de Fornecedores/Prestadores/Tratadores
// (abas Ativos/Inativos) e a Auditoria precisam responder TAMBÉM "desde quando" e
// "por quem" — ver FornecedorController.toggleAtivo / PrestadorController.toggleAtivo /
// TratadorController.toggleAtivo.
//
// Migration `20260825000000_fornecedor_prestador_ativacao_catalogo` (Fornecedor/
// Prestador) e `20260826000000_tratador_ativacao_trilha` (Tratador). Lido/
// gravado por SQL CRU, mesmo padrão de `lib/usuarioEmpresa.js#temColunasPagamento`
// e `lib/usuarioAtivacao.js`: no Windows o `prisma generate` falha com o
// backend rodando, então o client tipado pode não conhecer as colunas ainda.
'use strict';

const prisma = require('./prisma').default;

const TABELAS = {
  fornecedor: 'schs2vet.tb_fornecedores',
  prestador:  'schs2vet.tb_prestadores',
  tratador:   'schs2vet.tb_tratadores',
};

// Mesma cache de temColunasPagamento/usuarioAtivacao: positivo é definitivo,
// negativo expira em 60s (roda a migration com o backend no ar sem restart).
const _cache = {};
async function temColunas(tabela) {
  const c = _cache[tabela];
  if (c?.ok === true) return true;
  if (c?.ok === false && Date.now() - c.em < 60_000) return false;
  const [schema, table] = TABELAS[tabela].split('.');
  let ok = false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = 'ativo_por_id' LIMIT 1`,
      schema, table,
    );
    ok = rows.length > 0;
  } catch { ok = false; }
  _cache[tabela] = { ok, em: Date.now() };
  return ok;
}

/** Grava a ATIVAÇÃO (ativo=true) + quem/quando. `tabela`: 'fornecedor' | 'prestador'. */
async function registrarAtivacao(client, tabela, id, porUserId) {
  if (!(await temColunas(tabela))) return;
  await client.$executeRawUnsafe(
    `UPDATE ${TABELAS[tabela]} SET ativo = true, ativo_em = now(), ativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(id),
  );
}

/** Grava a INATIVAÇÃO (ativo=false) + quem/quando. */
async function registrarInativacao(client, tabela, id, porUserId) {
  if (!(await temColunas(tabela))) return;
  await client.$executeRawUnsafe(
    `UPDATE ${TABELAS[tabela]} SET ativo = false, inativo_em = now(), inativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(id),
  );
}

/**
 * Trilha de vários registros de uma vez:
 * Map(id → { ativoEm, ativoPorNome, inativoEm, inativoPorNome }).
 */
async function lerTrilha(tabela, ids) {
  const idsNum = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (idsNum.length === 0 || !(await temColunas(tabela))) return mapa;
  const ph = idsNum.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id AS id, t.ativo_em AS ativo_em, t.inativo_em AS inativo_em,
            ap."fullName" AS ativo_por_nome, ip."fullName" AS inativo_por_nome
       FROM ${TABELAS[tabela]} t
       LEFT JOIN schs2vet.users ap ON ap.id = t.ativo_por_id
       LEFT JOIN schs2vet.users ip ON ip.id = t.inativo_por_id
      WHERE t.id IN (${ph})`,
    ...idsNum,
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

/** Anexa a trilha a uma lista de fornecedores/prestadores (cada item já com `id`). */
async function anexarTrilha(itens, tabela) {
  if (!Array.isArray(itens) || itens.length === 0) return itens;
  const mapa = await lerTrilha(tabela, itens.map(i => i?.id));
  if (mapa.size === 0) return itens;
  return itens.map(item => {
    const d = mapa.get(item.id);
    return d ? { ...item, ...d } : item;
  });
}

module.exports = {
  registrarAtivacao,
  registrarInativacao,
  lerTrilha,
  anexarTrilha,
};
