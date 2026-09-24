'use strict';
// lib/encaminhamentoPrestador.js — O CADASTRO DE PRESTADOR COMO DESTINO DO
// ENCAMINHAMENTO (migration 20261022000000).
//
// 🔴 O destino interno do encaminhamento deixou de exigir LOGIN (2026-09-23). Antes ele
// era só `prestador_id` → `users`, e prestador só ganha usuário quando o cadastro é
// salvo com "acesso ao sistema". O ferrador e o quiroprata cadastrados sem login não
// apareciam no seletor, e a lista era completada com os VETERINÁRIOS da equipe.
//
// O endereço do cadastro é o par (origem, id) — `tb_prestadores` e `tb_fornecedores`
// são tabelas distintas e uma FK única não alcança as duas. É o mesmo par que
// `lib/contasPagar.js` usa para amarrar uma dívida à sua origem.
//
// ⚠️ FORNECEDOR entra junto de propósito: `PRESTADOR` nasceu em 2026-09-09 e NADA foi
// migrado (CLAUDE.md §4) — quem já estava cadastrado como prestador externo segue em
// `tb_fornecedores`. Ler só `tb_prestadores` sumiria com a maior parte da base.
//
// ⚠️ `prestador_id` (o login) CONTINUA e continua sendo quem recebe a
// `DesignacaoPrestador`: designação é ESCOPO DE ACESSO, e não há a quem dar acesso
// quando não existe login. Encaminhar para prestador sem login grava o registro
// clínico e NÃO libera o paciente.
//
// 🔴 SQL CRU COM GUARDA DE COLUNA — mesmo padrão de `lib/faturaFechamentoAnimal.js` e
// `lib/formasRecebimentoFatura.js`. No Windows o `prisma generate` FALHA com o backend
// rodando (§11), então o client em execução pode não conhecer as colunas novas; passá-las
// ao `encaminhamentoClinico.create` tipado nesse estado derrubaria a CRIAÇÃO INTEIRA do
// encaminhamento, e não só o campo novo.

const ORIGENS = Object.freeze({ PRESTADOR: 'PRESTADOR', FORNECEDOR: 'FORNECEDOR' });

/** Tabela de cada origem. Origem desconhecida devolve `null` — nunca interpola texto. */
const TABELA = Object.freeze({
  PRESTADOR:  'schs2vet.tb_prestadores',
  FORNECEDOR: 'schs2vet.tb_fornecedores',
});

function prismaGlobal() {
  return require('./prisma').default;
}

let _temColunas   = null;
let _temColunasEm = 0;

/**
 * As colunas já existem? `false` expira em 60s — aplicar a migration com o backend no
 * ar volta a funcionar sem restart.
 *
 * ⚠️ Usa o client GLOBAL de propósito, nunca o `tx` recebido: SQL cru contra coluna
 * inexistente DENTRO de uma transaction aborta a TRANSACTION INTEIRA (25P02), e quem
 * estoura é o comando seguinte, longe do culpado.
 */
async function temColunas() {
  if (_temColunas === true) return true;
  if (_temColunas === false && Date.now() - _temColunasEm < 60000) return false;
  try {
    const rows = await prismaGlobal().$queryRawUnsafe(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'schs2vet'
          AND table_name   = 'tb_encaminhamentos_clinicos'
          AND column_name  = 'prestador_cadastro_id'
        LIMIT 1`,
    );
    _temColunas   = rows.length > 0;
    _temColunasEm = Date.now();
  } catch {
    // Falha na consulta NÃO é "a coluna não existe". Já tendo respondido antes, a
    // última resposta CONHECIDA vale; sem nenhuma, devolve `false` SEM cachear, para a
    // próxima chamada perguntar de novo.
    if (_temColunas !== null) return _temColunas;
    return false;
  }
  return _temColunas;
}

/** Normaliza a origem vinda do request. Qualquer outra coisa vira `null`. */
function normalizarOrigem(origem) {
  const v = String(origem ?? '').trim().toUpperCase();
  return ORIGENS[v] ?? null;
}

/**
 * O cadastro existe, está ATIVO e é DESTA empresa?
 *
 * Devolve `{ id, origem, nome, email, telefone, tipoServico, userId }` ou `null`.
 * `userId` é o login — `null` quando o prestador não tem acesso ao sistema.
 *
 * ⚠️ O filtro por empresa é explícito, e não só o RLS: é o que faz a resposta ser a
 * mesma com e sem o carimbo de tenant (ADMIN de plataforma incluído).
 */
async function buscarCadastro(client, { origem, id, empresaId }) {
  const org = normalizarOrigem(origem);
  const tabela = TABELA[org];
  if (!tabela || !id) return null;
  const rows = await (client ?? prismaGlobal()).$queryRawUnsafe(
    `SELECT id, nome, email, telefone, tipo_servico AS "tipoServico", user_id AS "userId"
       FROM ${tabela}
      WHERE id = $1 AND ativo = true
        AND ($2::int IS NULL OR empresa_id = $2::int)
      LIMIT 1`,
    Number(id),
    empresaId != null ? Number(empresaId) : null,
  );
  if (rows.length === 0) return null;
  return { ...rows[0], id: Number(rows[0].id), origem: org, userId: rows[0].userId != null ? Number(rows[0].userId) : null };
}

/**
 * Grava o cadastro de destino no encaminhamento recém-criado.
 *
 * É um UPDATE, então vai SEMPRE **depois** do `create` — antes acerta zero linhas em
 * silêncio (a mesma armadilha de `gravarVencimento`). Sem as colunas, não faz nada e o
 * encaminhamento segue válido, só sem a origem registrada.
 */
async function gravarCadastro(tx, encaminhamentoId, { origem, id }) {
  const org = normalizarOrigem(origem);
  if (!org || !id) return;
  if (!(await temColunas())) return;
  await tx.$executeRawUnsafe(
    `UPDATE schs2vet.tb_encaminhamentos_clinicos
        SET prestador_cadastro_id = $2, prestador_cadastro_origem = $3
      WHERE id = $1`,
    Number(encaminhamentoId), Number(id), org,
  );
}

/**
 * Anexa `prestadorCadastroId`, `prestadorCadastroOrigem` e `prestadorCadastroNome` a uma
 * lista de encaminhamentos já lida.
 *
 * O NOME vem por join na leitura, e não por snapshot na escrita, porque o cadastro é
 * soft-deleted (`ativo`) — a linha não desaparece, e renomear o prestador deve aparecer
 * no histórico. Cadastro que o join não alcança cai em `null` e a tela mostra "—".
 */
async function anexarEmLista(client, itens) {
  if (!Array.isArray(itens) || itens.length === 0) return itens;
  if (!(await temColunas())) return itens;
  const ids = itens.map(i => Number(i.id)).filter(Number.isFinite);
  if (ids.length === 0) return itens;

  const rows = await (client ?? prismaGlobal()).$queryRawUnsafe(
    `SELECT e.id,
            e.prestador_cadastro_id     AS "cadastroId",
            e.prestador_cadastro_origem AS "cadastroOrigem",
            COALESCE(p.nome, f.nome)    AS "cadastroNome"
       FROM schs2vet.tb_encaminhamentos_clinicos e
       LEFT JOIN schs2vet.tb_prestadores  p
              ON e.prestador_cadastro_origem = 'PRESTADOR'  AND p.id = e.prestador_cadastro_id
       LEFT JOIN schs2vet.tb_fornecedores f
              ON e.prestador_cadastro_origem = 'FORNECEDOR' AND f.id = e.prestador_cadastro_id
      WHERE e.id = ANY($1::int[])`,
    ids,
  );
  const porId = new Map(rows.map(r => [Number(r.id), r]));
  return itens.map((it) => {
    const r = porId.get(Number(it.id));
    return {
      ...it,
      prestadorCadastroId:     r?.cadastroId != null ? Number(r.cadastroId) : null,
      prestadorCadastroOrigem: r?.cadastroOrigem ?? null,
      prestadorCadastroNome:   r?.cadastroNome ?? null,
    };
  });
}

/** Um só — o mesmo caminho da lista, para não haver duas leituras divergentes. */
async function anexar(client, item) {
  if (!item) return item;
  const [out] = await anexarEmLista(client, [item]);
  return out;
}

module.exports = {
  ORIGENS,
  normalizarOrigem,
  buscarCadastro,
  gravarCadastro,
  anexar,
  anexarEmLista,
  temColunas,
};
