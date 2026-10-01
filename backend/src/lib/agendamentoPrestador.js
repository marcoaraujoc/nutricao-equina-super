// backend/src/lib/agendamentoPrestador.js
//
// PRESTADOR (cadastro) como responsável pelo AGENDAMENTO — fonte única (2026-09-30).
//
// `tb_agendamentos_clinicos.veterinario_id` aponta para `users`, e o prestador
// cadastrado SEM login não tem usuário. A coluna `prestador_cadastro_id` (migration
// 20261028000000) guarda o CADASTRO: prestador sem login grava só ela; com login,
// grava as duas (o `veterinario_id` é o que faz o agendamento aparecer na agenda dele
// e mandar os avisos ao login).
//
// ⚠️ Acesso por SQL CRU com guarda de coluna (padrão de `lib/encaminhamentoPrestador.js`):
// passar a coluna ao `agendamentoClinico.create` tipado com o client defasado
// derrubaria a CRIAÇÃO do agendamento inteira, não só o campo novo.
// ⚠️ Datas NÃO vão como parâmetro do SQL cru: o Prisma envia `Date` ao raw em horário
// local e a janela descasaria da UTC (ver AgendamentoController.listarGlobal). O SQL cru
// só resolve os IDS; a janela de horário é filtrada pelo client tipado.
'use strict';

const prismaPadrao = require('./prisma').default;

const TABELA = 'schs2vet.tb_agendamentos_clinicos';

// `true` fica em cache; `false` é reconsultado (a migration pode ser aplicada com o
// backend no ar).
let colunaConfirmada = false;
async function temColuna(db = prismaPadrao) {
  if (colunaConfirmada) return true;
  try {
    const r = await db.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_agendamentos_clinicos'
          AND column_name = 'prestador_cadastro_id' LIMIT 1`,
    );
    colunaConfirmada = Array.isArray(r) && r.length > 0;
  } catch { colunaConfirmada = false; }
  return colunaConfirmada;
}

/** Grava o prestador responsável. Chamar DENTRO da transaction que criou o agendamento. */
async function gravarPrestador(db, agendamentoId, prestadorId) {
  if (!(await temColuna(db))) return false;
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA} SET prestador_cadastro_id = $2 WHERE id = $1`,
    Number(agendamentoId), prestadorId == null ? null : Number(prestadorId),
  );
  return true;
}

/**
 * O agendamento trocou de responsável (assumir / trocar profissional / transferir o
 * dia): o prestador deixa de responder por ele. Sem isto a linha continuaria exibindo
 * o prestador depois de outra pessoa ter assumido.
 */
async function limparPrestador(db, agendamentoIds) {
  const ids = [...new Set((Array.isArray(agendamentoIds) ? agendamentoIds : [agendamentoIds])
    .map(Number).filter(Number.isInteger))];
  if (ids.length === 0 || !(await temColuna(db))) return;
  await db.$executeRawUnsafe(
    `UPDATE ${TABELA} SET prestador_cadastro_id = NULL
      WHERE id = ANY($1::int[]) AND prestador_cadastro_id IS NOT NULL`,
    ids,
  );
}

/** Anexa `prestadorCadastro: { id, nome } | null` a uma lista de agendamentos. */
async function anexarPrestadorEmLista(lista, db = prismaPadrao) {
  const itens = Array.isArray(lista) ? lista : [];
  for (const i of itens) if (i && i.prestadorCadastro === undefined) i.prestadorCadastro = null;
  const ids = itens.map(i => i?.id).filter(Number.isInteger);
  if (ids.length === 0 || !(await temColuna(db))) return itens;

  const linhas = await db.$queryRawUnsafe(
    `SELECT a.id, p.id AS "prestadorId", p.nome
       FROM ${TABELA} a
       JOIN schs2vet.tb_prestadores p ON p.id = a.prestador_cadastro_id
      WHERE a.id = ANY($1::int[])`,
    ids,
  );
  const mapa = new Map(linhas.map(l => [Number(l.id), { id: Number(l.prestadorId), nome: l.nome }]));
  for (const i of itens) if (i && mapa.has(i.id)) i.prestadorCadastro = mapa.get(i.id);
  return itens;
}

/** Ids dos agendamentos ativos atribuídos a estes prestadores (cadastro). */
async function idsDosPrestadores(db, prestadorIds) {
  const ids = [...new Set((prestadorIds ?? []).map(Number).filter(Number.isInteger))];
  if (ids.length === 0 || !(await temColuna(db))) return [];
  const linhas = await db.$queryRawUnsafe(
    `SELECT id FROM ${TABELA} WHERE ativo = true AND prestador_cadastro_id = ANY($1::int[])`,
    ids,
  );
  return linhas.map(l => Number(l.id));
}

/**
 * 🔴 Quais destes LOGINS integram a EQUIPE da empresa (2026-10-01).
 *
 * "Integra a equipe" = foi incluído como MEMBRO na tela Equipe: tem `MembroEquipe`
 * numa equipe da empresa com cargo que NÃO é de prestador externo. O cartão de
 * acesso que o cadastro de Prestador emite (cargo PRESTADOR/FORNECEDOR, ver
 * `lib/acessoExterno.js`) NÃO conta — é exatamente o que separa o externo.
 * Quem integra a equipe é agendado como MEMBRO, pelas regras da empresa
 * (expediente, locais, tempo por especialidade); o externo, em qualquer dia e
 * horário, pelo tempo de consulta do próprio cadastro.
 */
async function loginsQueIntegramEquipe(db, userIds, empresaId) {
  // `filter(Boolean)` ANTES do Number: prestador sem login traz `null`, que viraria 0.
  const ids = [...new Set((userIds ?? []).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0 || !empresaId) return new Set();
  const { CARGOS_PRESTADOR } = require('./cargosPrestador');
  const membros = await db.membroEquipe.findMany({
    where:  { userId: { in: ids }, equipe: { empresaId: Number(empresaId) }, cargo: { notIn: CARGOS_PRESTADOR } },
    select: { userId: true },
  });
  return new Set(membros.map(m => Number(m.userId)));
}

module.exports = {
  loginsQueIntegramEquipe,
  temColuna,
  gravarPrestador,
  limparPrestador,
  anexarPrestadorEmLista,
  idsDosPrestadores,
};
