// backend/src/lib/cadastroAtivacao.js
//
// Trilha de ATIVAÇÃO/INATIVAÇÃO de Fornecedor, Prestador, Tratador, do PERFIL
// de Proprietário e do Estoque (Vacina/Farmácia) — mesma lógica de
// `lib/usuarioAtivacao.js` (User/Equipe), generalizada por tabela: `ativo`
// sozinho só diz o estado ATUAL; as telas de Fornecedores/Prestadores/
// Tratadores/Proprietários/Estoque de Vacina/Farmácia e a Auditoria precisam
// responder TAMBÉM "desde quando" e "por quem" — ver
// FornecedorController.toggleAtivo / PrestadorController.toggleAtivo /
// TratadorController.toggleAtivo / ProprietarioController.removerDaEmpresa+reativar /
// EstoqueVacinaController.toggle / EstoqueController.toggle.
//
// Migration `20260825000000_fornecedor_prestador_ativacao_catalogo` (Fornecedor/
// Prestador), `20260826000000_tratador_ativacao_trilha` (Tratador),
// `20260827000000_proprietario_perfil_ativacao_trilha` (ProprietarioPerfil) e
// `20260828000000_estoque_ativacao_trilha` (LoteVacina/EstoqueClinica — leva as
// telas /estoque-vacina e /farmacia à mesma regra de ativar/inativar de
// /cadastro/fornecedores: toggle direto, sem justificativa).
// Lido/gravado por SQL CRU, mesmo padrão de `lib/usuarioEmpresa.js#temColunasPagamento`
// e `lib/usuarioAtivacao.js`: no Windows o `prisma generate` falha com o
// backend rodando, então o client tipado pode não conhecer as colunas ainda.
//
// ⚠️ `proprietario` aponta para `tb_proprietario_perfis`, cuja PK é o `id` do
// PERFIL (um por empresa), NÃO o `userId`. Quem chama `registrarAtivacao`/
// `registrarInativacao`/`lerTrilha`/`anexarTrilha` com tabela='proprietario'
// precisa passar o `id` do `ProprietarioPerfil`, resolvido antes por
// (userId, empresaId) — ver `lib/proprietarioPerfil.js`.
'use strict';

const prisma = require('./prisma').default;

const TABELAS = {
  fornecedor:        'schs2vet.tb_fornecedores',
  prestador:         'schs2vet.tb_prestadores',
  tratador:          'schs2vet.tb_tratadores',
  proprietario:      'schs2vet.tb_proprietario_perfis',
  lote_vacina:       'schs2vet.tb_lotes_vacina',
  estoque_farmacia:  'schs2vet.tb_estoque_clinica',
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

// Cache PRÓPRIA para `inativo_motivo` (migration 20260901000000), separada de
// `temColunas()` — a trilha básica pode já estar em produção enquanto esta
// coluna ainda não foi migrada, e as duas não podem cair juntas nesse intervalo.
const _cacheMotivo = {};
async function temColunaMotivo(tabela) {
  const c = _cacheMotivo[tabela];
  if (c?.ok === true) return true;
  if (c?.ok === false && Date.now() - c.em < 60_000) return false;
  const [schema, table] = TABELAS[tabela].split('.');
  let ok = false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = 'inativo_motivo' LIMIT 1`,
      schema, table,
    );
    ok = rows.length > 0;
  } catch { ok = false; }
  _cacheMotivo[tabela] = { ok, em: Date.now() };
  return ok;
}

/**
 * Grava a ATIVAÇÃO (ativo=true) + quem/quando. `tabela`: 'fornecedor' | 'prestador' | 'tratador'.
 * ⚠️ O ativo=true SEMPRE é gravado, mesmo sem as colunas de trilha (migration
 * ainda não aplicada) — cair fora nesse caso deixava o toggle inteiro em NO-OP
 * silencioso (o registro nunca ativava/inativava, sem erro nenhum). A trilha
 * (quem/quando) é só um EXTRA best-effort por cima do estado real.
 */
async function registrarAtivacao(client, tabela, id, porUserId) {
  if (!(await temColunas(tabela))) {
    await client.$executeRawUnsafe(`UPDATE ${TABELAS[tabela]} SET ativo = true WHERE id = $1`, Number(id));
    return;
  }
  await client.$executeRawUnsafe(
    `UPDATE ${TABELAS[tabela]} SET ativo = true, ativo_em = now(), ativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(id),
  );
}

/**
 * Grava a INATIVAÇÃO (ativo=false) + quem/quando + a justificativa (`motivo`,
 * exigida por Fornecedor/Prestador/Tratador/ProprietarioController). Mesma
 * garantia de best-effort acima para a trilha básica; `motivo` só é gravado
 * quando a coluna já existe.
 */
async function registrarInativacao(client, tabela, id, porUserId, motivo = null) {
  if (!(await temColunas(tabela))) {
    await client.$executeRawUnsafe(`UPDATE ${TABELAS[tabela]} SET ativo = false WHERE id = $1`, Number(id));
    return;
  }
  if (motivo != null && (await temColunaMotivo(tabela))) {
    await client.$executeRawUnsafe(
      `UPDATE ${TABELAS[tabela]} SET ativo = false, inativo_em = now(), inativo_por_id = $1, inativo_motivo = $2 WHERE id = $3`,
      Number(porUserId), motivo, Number(id),
    );
    return;
  }
  await client.$executeRawUnsafe(
    `UPDATE ${TABELAS[tabela]} SET ativo = false, inativo_em = now(), inativo_por_id = $1 WHERE id = $2`,
    Number(porUserId), Number(id),
  );
}

/**
 * Trilha de vários registros de uma vez:
 * Map(id → { ativoEm, ativoPorNome, inativoEm, inativoPorNome, inativoMotivo }).
 */
async function lerTrilha(tabela, ids) {
  const idsNum = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (idsNum.length === 0 || !(await temColunas(tabela))) return mapa;
  const comMotivo = await temColunaMotivo(tabela);
  const ph = idsNum.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id AS id, t.ativo_em AS ativo_em, t.inativo_em AS inativo_em,
            ap."fullName" AS ativo_por_nome, ip."fullName" AS inativo_por_nome
            ${comMotivo ? ', t.inativo_motivo AS inativo_motivo' : ''}
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
      inativoMotivo:  comMotivo ? r.inativo_motivo : null,
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
