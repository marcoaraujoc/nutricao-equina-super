// backend/src/lib/cadeiaResponsaveis.js
'use strict';

/**
 * CADEIA DE RESPONSÁVEIS de um registro que muda de mãos.
 *
 * POR QUE EXISTE
 * `assumido_de_id` (agendamento) guarda UM nome: o anterior imediato. `autor_id`
 * (evolução) guarda outro: o primeiro. Nenhum dos dois responde "por quantas mãos
 * este atendimento passou" — e é essa a pergunta da tela, que risca todo mundo que
 * já respondeu pelo registro e deixa em pé só quem responde agora:
 *
 *   Marco Araújo (criou) → Marina assumiu → Cláudio assumiu → Laura assumiu
 *   tela: M̶a̶r̶c̶o̶ ̶A̶r̶a̶ú̶j̶o̶  M̶a̶r̶i̶n̶a̶  C̶l̶á̶u̶d̶i̶o̶ ̶A̶r̶a̶ú̶j̶o̶
 *         Laura
 *
 * A trilha completa sempre existiu no AuditLog (categoria TRANSFERENCIA), mas lá ela
 * é TEXTO LIVRE ("responsável anterior: X → novo responsável: Y") — serve para
 * auditar, não para desenhar uma coluna: exigiria varrer o log de cada linha da lista
 * e depender do formato de uma frase.
 *
 * ORDEM = CRONOLÓGICA (o mais antigo primeiro), que é como a tela lê da esquerda para
 * a direita. `array_append` no fim é o que a preserva.
 *
 * ACESSO POR SQL CRU (parametrizado), mesmo padrão de `lib/agendamentoAssumido.js`:
 * funciona com o client Prisma ainda não regenerado (no Windows o `prisma generate`
 * falha com o backend rodando — CLAUDE.md §11).
 *
 * ⚠️ TOLERA A COLUNA AUSENTE. Enquanto a migration não for aplicada, toda leitura
 * devolve vazio e toda escrita é ignorada — a tela cai no comportamento anterior (só
 * o autor/anterior imediato riscado) em vez de quebrar. É o que permite o código
 * subir antes do banco.
 */

const prismaPadrao = require('./prisma').default;

const TABELAS = {
  EVOLUCAO:    { tabela: 'schs2vet.tb_evolucoes_clinicas',    coluna: '"responsaveis_anteriores"' },
  AGENDAMENTO: { tabela: 'schs2vet.tb_agendamentos_clinicos', coluna: '"responsaveis_anteriores"' },
};

function alvoDe(recurso) {
  const t = TABELAS[recurso];
  if (!t) throw new Error(`cadeiaResponsaveis: recurso desconhecido "${recurso}"`);
  return t;
}

/**
 * Acrescenta `deVetId` (quem ACABOU de perder o registro) ao fim da cadeia.
 *
 * ⚠️ Não empilha `null`: agendamento que não tinha responsável não deixa um vão na
 * lista — não havia ninguém para riscar.
 * ⚠️ Não repete o ÚLTIMO da cadeia: dois caminhos podem carimbar a mesma troca (o
 * assumir do agendamento arrasta a evolução, que também empilha), e o nome sairia
 * riscado duas vezes seguidas na tela.
 */
async function empilharResponsavel(client, recurso, ids, deVetId) {
  const alvo = [...new Set((Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger))];
  if (alvo.length === 0 || deVetId == null) return;
  const t = alvoDe(recurso);
  const db = client || prismaPadrao;
  await db.$executeRawUnsafe(
    `UPDATE ${t.tabela}
        SET ${t.coluna} = array_append(COALESCE(${t.coluna}, '{}'::int[]), $2::int)
      WHERE id = ANY($1::int[])
        AND COALESCE(${t.coluna}[array_length(${t.coluna}, 1)], -1) <> $2::int`,
    alvo,
    Number(deVetId),
  ).catch(() => {});   // coluna ainda não migrada → segue sem a cadeia
}

/**
 * Empilha o dono anterior de VÁRIOS registros de uma vez, cada um com o seu.
 * `movidos` é a lista que `lib/transferenciaAtendimento.js` já devolve.
 */
async function empilharDosMovidos(client, recurso, movidos) {
  for (const m of movidos ?? []) {
    if (m?.deVetId == null) continue;
    await empilharResponsavel(client, recurso, [m.entidadeId], m.deVetId);
  }
}

/**
 * Lê a cadeia de vários registros. Devolve Map<id, Array<{id, fullName}>>, na ordem
 * cronológica e já com os nomes resolvidos.
 *
 * ⚠️ `WITH ORDINALITY` + `ORDER BY` é o que preserva a ordem: um `IN` sobre users
 * devolveria os nomes na ordem que o banco quisesse, e a cadeia sairia embaralhada.
 */
async function lerCadeia(recurso, ids, client) {
  const t = alvoDe(recurso);
  const db = client || prismaPadrao;
  const alvo = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (alvo.length === 0) return new Map();

  const linhas = await db.$queryRawUnsafe(
    `SELECT r.id,
            e.ord,
            e.uid            AS "usuarioId",
            u."fullName"     AS "nome"
       FROM ${t.tabela} r
       CROSS JOIN LATERAL unnest(COALESCE(r.${t.coluna}, '{}'::int[])) WITH ORDINALITY AS e(uid, ord)
       LEFT JOIN schs2vet.users u ON u.id = e.uid
      WHERE r.id = ANY($1::int[])
      ORDER BY r.id, e.ord`,
    alvo,
  ).catch(() => []);

  const mapa = new Map();
  for (const l of linhas) {
    const chave = Number(l.id);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push({ id: Number(l.usuarioId), fullName: l.nome ?? null });
  }
  return mapa;
}

/** Anexa `responsaveisAnteriores` a uma lista já carregada pelo Prisma. */
async function anexarCadeiaEmLista(recurso, lista, client) {
  const itens = Array.isArray(lista) ? lista : [lista];
  const validos = itens.filter(i => i && i.id != null);
  if (validos.length === 0) return lista;
  const mapa = await lerCadeia(recurso, validos.map(i => i.id), client);
  for (const item of validos) {
    // Nome nulo = profissional removido do sistema; a tela decide o que fazer com ele
    // (hoje: descarta, para não riscar um espaço em branco).
    item.responsaveisAnteriores = mapa.get(Number(item.id)) ?? [];
  }
  return lista;
}

module.exports = {
  empilharResponsavel,
  empilharDosMovidos,
  lerCadeia,
  anexarCadeiaEmLista,
  TABELAS,
};
