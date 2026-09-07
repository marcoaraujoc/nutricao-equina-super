// backend/src/lib/concorrenciaRegistro.js
//
// CONTROLE DE CONCORRÊNCIA DE EDIÇÃO — trava otimista por registro.
//
// 🔴 A REGRA QUE ISTO IMPÕE: "quem salva por último vence" NÃO existe mais. Duas
// pessoas com o mesmo registro aberto não se sobrescrevem em silêncio: a segunda
// gravação é RECUSADA com 409 e a pessoa decide o que fazer com o que digitou.
// Em prontuário, sobrescrever calado é perda de dado clínico.
//
// 🔴 A GARANTIA É DO BANCO, NUNCA DA TELA. O aviso em tempo real (SSE) é
// conveniência: evita que a pessoa continue digitando à toa. A INTEGRIDADE vem da
// cláusula WHERE — navegador offline, aba congelada, evento perdido ou front
// desatualizado batem no mesmo `UPDATE ... WHERE versao = $x` e recebem o mesmo
// 409. Nunca mover esta decisão para o cliente.
//
// ⚠️ LEITURA/ESCRITA POR SQL CRU, de propósito: `versao` e `autor_id` são colunas
// novas e o client Prisma pode não estar regenerado (no Windows o `generate` falha
// com o backend rodando — CLAUDE.md §11). Um `update` tipado com campo desconhecido
// derruba o handler inteiro; o SQL cru funciona antes do generate.
//
// ⚠️ NÃO existe lock com TIMEOUT aqui. Lock que expira precisa de heartbeat, e
// heartbeat que falha por rede instável libera o registro de quem AINDA está
// digitando — troca um problema raro por um pior. Quem dá exclusividade é o par
// AUTORIZAÇÃO (`podeOperarRegistro`, sobre `veterinarioId`) + INTEGRIDADE
// (`versao`); "assumir" é a transferência explícita, feita por uma pessoa.
'use strict';

const prisma = require('./prisma').default;

// Tabela -> como ler/gravar o controle de concorrência dela.
// ⚠️ `colEditor` DIFERE por tabela: `EvolucaoClinica.veterinarioId` NÃO tem `@map`
// (coluna em camelCase, exige aspas), enquanto `AgendamentoClinico.veterinarioId`
// tem `@map("veterinario_id")`. Escrever o nome errado devolve
// `column "veterinario_id" does not exist` (armadilha 41 do CLAUDE.md).
const TABELAS = {
  EVOLUCAO: {
    tabela:    'schs2vet.tb_evolucoes_clinicas',
    colEditor: '"veterinarioId"',
    colAutor:  '"autor_id"',
    entidade:  'EVOLUCAO',
    rotulo:    'evolução',
  },
  AGENDAMENTO: {
    tabela:    'schs2vet.tb_agendamentos_clinicos',
    colEditor: '"veterinario_id"',
    colAutor:  null,          // agendamento não tem autor separado (tem `criado_por_id`)
    entidade:  'AGENDAMENTO',
    rotulo:    'agendamento',
  },
  // A versão da prescrição fica no GRUPO, não no item: o que se disputa é o
  // DOCUMENTO — incluir/remover item muda o conjunto, e versão por item deixaria
  // passar 'A removeu o item 3 enquanto B adicionava o item 4'.
  PRESCRICAO_GRUPO: {
    tabela:    'schs2vet.tb_prescricao_grupos',
    colEditor: '"veterinarioId"',   // sem @map no schema → camelCase, exige aspas
    colAutor:  null,                // autoria original recuperável por finalizadoPorId + auditoria
    entidade:  'PRESCRICAO',
    rotulo:    'prescrição',
  },
  EXAME_CLINICO: {
    tabela:    'schs2vet.tb_exames_clinicos',
    colEditor: '"veterinarioId"',   // idem — sem @map
    colAutor:  null,
    entidade:  'EXAME_CLINICO',
    rotulo:    'exame',
  },
};

function alvoDe(recurso) {
  const t = TABELAS[recurso];
  if (!t) throw new Error(`recurso de concorrência desconhecido: ${recurso}`);
  return t;
}

/**
 * Erro de concorrência. Carrega tudo que a TELA precisa para explicar o que houve —
 * quem é o editor atual e qual é a versão vigente. Mensagem genérica
 * ("optimistic locking failed") não diz a ninguém o que fazer.
 */
class ConflitoEdicaoError extends Error {
  constructor(code, mensagem, extra = {}) {
    super(mensagem);
    this.name   = 'ConflitoEdicaoError';
    this.code   = code;          // 'VERSAO_CONFLITO' | 'REGISTRO_ASSUMIDO'
    this.status = 409;
    Object.assign(this, extra);
  }
}

/**
 * Estado de concorrência do registro, direto do banco.
 * @returns {Promise<{versao:number, editorId:number|null, autorId:number|null}|null>}
 */
async function lerControle(client, recurso, id) {
  const t = alvoDe(recurso);
  const c = client ?? prisma;
  const autorSel = t.colAutor ? `${t.colAutor} AS "autorId"` : 'NULL::int AS "autorId"';
  const rows = await c.$queryRawUnsafe(
    `SELECT "versao", ${t.colEditor} AS "editorId", ${autorSel}
       FROM ${t.tabela} WHERE id = $1`,
    Number(id)
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    versao:   Number(r.versao ?? 1),
    editorId: r.editorId == null ? null : Number(r.editorId),
    autorId:  r.autorId  == null ? null : Number(r.autorId),
  };
}

/**
 * Nome de quem detém o registro AGORA — para a mensagem do 409 e para o evento em
 * tempo real. Nunca inventa: sem editor resolvido devolve null e a tela cai numa
 * frase genérica, em vez de afirmar um nome errado.
 */
async function descreverEditor(client, editorId) {
  if (editorId == null) return null;
  const c = client ?? prisma;
  const u = await c.user.findUnique({
    where:  { id: Number(editorId) },
    select: { id: true, fullName: true },
  }).catch(() => null);
  return { id: Number(editorId), nome: u?.fullName ?? null };
}

/**
 * 🔴 O CORAÇÃO DA REGRA. Grava condicionado à versão que o cliente leu.
 *
 * `UPDATE ... WHERE id = $1 AND versao = $2` é ATÔMICO no Postgres: duas
 * transações concorrentes partindo da MESMA versão não podem as duas afetar a
 * linha — a segunda encontra `versao` já incrementada e devolve 0 linhas. Sem a
 * cláusula de versão isto seria o `SELECT` + `UPDATE` ingênuo, em que os dois "dão
 * certo" e um dos textos desaparece.
 *
 * @param {object} tx      transaction aberta (obrigatório — a escrita e o
 *                         incremento têm de ser a mesma unidade atômica)
 * @param {string} recurso 'EVOLUCAO' | 'AGENDAMENTO'
 * @param {number} id
 * @param {number} versaoEsperada
 * @param {object} campos  colunas a gravar, já citadas: { '"texto"': valor }
 * @returns {Promise<number|null>} nova versão, ou null se PERDEU a corrida
 */
async function gravarComVersao(tx, recurso, id, versaoEsperada, campos = {}) {
  const t = alvoDe(recurso);
  const params = [Number(id), Number(versaoEsperada)];
  const sets   = Object.keys(campos).map((col) => {
    params.push(campos[col]);
    return `${col} = $${params.length}`;
  });
  // O incremento é parte do MESMO UPDATE: versão gravada fora dele abriria uma
  // janela em que a linha já mudou e a versão ainda não — e nessa janela um
  // terceiro passaria pela checagem com a versão velha.
  sets.push('"versao" = "versao" + 1');

  const rows = await tx.$queryRawUnsafe(
    `UPDATE ${t.tabela} SET ${sets.join(', ')}
      WHERE id = $1 AND "versao" = $2
      RETURNING "versao"`,
    ...params
  );
  if (!rows || rows.length === 0) return null;    // perdeu a corrida
  return Number(rows[0].versao);
}

/**
 * Confere a versão ANTES de uma escrita que não passa por `gravarComVersao` (ex.: o
 * `update` tipado do Prisma, que é quem sabe montar o `include` da resposta).
 * Incrementa a versão condicionalmente e lança 409 se alguém chegou antes.
 *
 * ⚠️ Chamar SEMPRE como PRIMEIRO passo da transaction. Rodando depois do update
 * principal, a escrita já aconteceu e o rollback vira a única defesa — funciona,
 * mas desperdiça o trabalho e inverte a ordem da regra.
 *
 * ⚠️ `versaoCliente` ausente NÃO é tratada como conflito: cliente antigo (ou
 * caminho interno que não passa pela tela) continua funcionando, só sem a
 * proteção — ver `versaoDoBody`. Endurecer isso quebraria toda chamada existente
 * de uma vez, sem nenhum aviso ao usuário.
 */
async function reservarVersao(tx, recurso, id, versaoCliente) {
  const t = alvoDe(recurso);
  if (versaoCliente == null) {
    // Sem versão declarada: incrementa mesmo assim, para que QUEM declarou versão
    // veja o conflito. Não recusa a escrita — ver o comentário acima.
    await tx.$executeRawUnsafe(
      `UPDATE ${t.tabela} SET "versao" = "versao" + 1 WHERE id = $1`, Number(id)
    );
    return null;
  }
  const rows = await tx.$queryRawUnsafe(
    `UPDATE ${t.tabela} SET "versao" = "versao" + 1
      WHERE id = $1 AND "versao" = $2 RETURNING "versao"`,
    Number(id), Number(versaoCliente)
  );
  if (!rows || rows.length === 0) {
    const atual = await lerControle(tx, recurso, id);
    throw new ConflitoEdicaoError(
      'VERSAO_CONFLITO',
      `Esta ${t.rotulo} foi modificada por outro profissional enquanto você trabalhava nela.`,
      {
        versaoAtual:   atual?.versao ?? null,
        versaoCliente: Number(versaoCliente),
        editorId:      atual?.editorId ?? null,
      }
    );
  }
  return Number(rows[0].versao);
}

/**
 * ASSUMIR de forma ATÔMICA — resolve a corrida "B e C assumem ao mesmo tempo".
 *
 * A condição inclui o EDITOR ANTERIOR, não só a versão: é o que garante que
 * somente UM dos dois vença. Quem perder encontra a linha já apontando para o
 * outro e recebe `null` -> 409, nunca um "sucesso" que sobrescreveu a assunção do
 * colega um milissegundo antes.
 *
 * @returns {Promise<{versao:number}|null>} null = perdeu a corrida
 */
async function assumirComLock(tx, recurso, id, { deEditorId, versaoEsperada, paraEditorId, camposExtra = {} }) {
  const t = alvoDe(recurso);
  const params = [Number(id), Number(versaoEsperada), Number(paraEditorId)];
  const sets   = [`${t.colEditor} = $3`, '"versao" = "versao" + 1'];
  for (const col of Object.keys(camposExtra)) {
    params.push(camposExtra[col]);
    sets.push(`${col} = $${params.length}`);
  }
  // `IS NOT DISTINCT FROM` e não `=`: o editor anterior pode ser NULL (agendamento
  // "Não atribuído"), e `NULL = NULL` é NULL — a condição nunca casaria, e assumir
  // um registro sem responsável falharia sempre.
  params.push(deEditorId == null ? null : Number(deEditorId));
  const condEditor = `${t.colEditor} IS NOT DISTINCT FROM $${params.length}`;

  const rows = await tx.$queryRawUnsafe(
    `UPDATE ${t.tabela} SET ${sets.join(', ')}
      WHERE id = $1 AND "versao" = $2 AND ${condEditor}
      RETURNING "versao"`,
    ...params
  );
  if (!rows || rows.length === 0) return null;
  return { versao: Number(rows[0].versao) };
}

/**
 * 🔴 INVALIDA A TELA DE QUEM PERDEU O REGISTRO — incrementa a versão de vários
 * registros de uma vez, sem condição de versão.
 *
 * POR QUE ISTO EXISTE, e por que é a peça que fecha o arrasto:
 * quando alguém ASSUME uma evolução, prescrição/exame/encaminhamento/vacina do
 * atendimento mudam de dono junto (`transferirFilhosDasEvolucoes`). A autoria
 * sozinha NÃO basta para barrar o profissional anterior — `podeOperarRegistro`
 * tem bypass de GESTOR, então um gestor que perdeu o atendimento continuava
 * podendo gravar por cima do novo responsável. Bumpando a versão, a tela dele
 * (que ainda segura a versão antiga) é recusada com 409 no próximo salvar,
 * INDEPENDENTE de cargo. É o que torna o bloqueio automático de verdade.
 *
 * ⚠️ SEM condição de versão de propósito: aqui não se está disputando nada — a
 * transferência JÁ foi decidida e commitada. O incremento é consequência dela, e
 * condicioná-lo a uma versão lida antes só criaria uma corrida onde não há.
 *
 * ⚠️ Chamar DENTRO da mesma transaction do arrasto: se a transferência reverter,
 * a versão não pode ter avançado — senão a tela de quem NÃO perdeu nada passaria
 * a levar 409 sem motivo.
 */
async function invalidarVersoes(tx, recurso, ids) {
  const lista = [...new Set((ids ?? []).map(Number).filter(Number.isInteger))];
  if (lista.length === 0) return 0;
  const t = alvoDe(recurso);
  return tx.$executeRawUnsafe(
    `UPDATE ${t.tabela} SET "versao" = "versao" + 1 WHERE id = ANY($1::int[])`,
    lista,
  );
}

/** Grava o autor original quando ele ainda não existe (registro recém-criado). */
async function definirAutor(tx, recurso, id, autorId) {
  const t = alvoDe(recurso);
  if (!t.colAutor || autorId == null) return;
  await tx.$executeRawUnsafe(
    `UPDATE ${t.tabela} SET ${t.colAutor} = $2 WHERE id = $1 AND ${t.colAutor} IS NULL`,
    Number(id), Number(autorId)
  );
}

/**
 * Anexa `versao`/`autorId` a registro que veio pelo client tipado (que pode não
 * conhecer as colunas). Mesmo padrão de `anexarFotoEmRelacao`/`anexarInativoEmLista`.
 * ⚠️ Falha de leitura NÃO derruba a listagem: coluna ainda não migrada devolve
 * `versao: 1`, e a tela funciona como antes (sem proteção, não quebrada).
 */
async function anexarControle(client, recurso, registros) {
  const lista = Array.isArray(registros) ? registros : [registros];
  const ids = lista.filter(Boolean).map(r => r.id).filter(v => v != null).map(Number);
  if (ids.length === 0) return registros;
  const t = alvoDe(recurso);
  const c = client ?? prisma;
  // O NOME do autor vem no mesmo SELECT: é ele que a tela risca quando o registro
  // muda de responsável ("estava com Fulano, agora é de Beltrano"). Sem o join, a
  // tela teria só o id e não teria como escrever o nome de quem saiu.
  const autorSel  = t.colAutor ? `r.${t.colAutor} AS "autorId"` : 'NULL::int AS "autorId"';
  const nomeSel   = t.colAutor ? 'a."fullName" AS "autorNome"'  : 'NULL::text AS "autorNome"';
  const joinAutor = t.colAutor ? `LEFT JOIN schs2vet.users a ON a.id = r.${t.colAutor}` : '';
  const rows = await c.$queryRawUnsafe(
    `SELECT r.id, r."versao", ${autorSel}, ${nomeSel}
       FROM ${t.tabela} r ${joinAutor}
      WHERE r.id = ANY($1::int[])`,
    ids
  ).catch(() => []);
  const mapa = new Map(rows.map(r => [Number(r.id), r]));
  for (const reg of lista) {
    if (!reg) continue;
    const r = mapa.get(Number(reg.id));
    reg.versao  = r ? Number(r.versao ?? 1) : 1;
    if (r?.autorId != null) reg.autorId = Number(r.autorId);
    else if (reg.autorId === undefined) reg.autorId = null;
    // Autor removido do sistema (ou registro sem autor) → nome nulo, e a tela cai no
    // rótulo de sempre: nunca se escreve "assumida de" sem dizer de quem.
    if (reg.autorNome === undefined) reg.autorNome = r?.autorNome ?? null;
  }
  return registros;
}

/**
 * Lê a versão que o cliente declarou. Aceita `versao` ou `_versao` no corpo e
 * devolve `null` (= sem proteção, não conflito) para valor ausente ou inválido.
 * ⚠️ Nunca confiar neste número para AUTORIZAR nada: ele só serve para comparar
 * com a coluna. Quem o usuário é vem sempre da sessão.
 */
function versaoDoBody(body) {
  const v = body?.versao ?? body?._versao;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resposta HTTP 409 padronizada. A mensagem é para PESSOA — nunca "optimistic
 * locking failed": quem lê é um profissional no meio de um atendimento.
 * Envia `error` E `mensagem` porque os controllers do projeto divergem no nome do
 * campo, e a tela lê os dois (ver `mensagemDoErro` no front).
 */
function responderConflito(res, err, extra = {}) {
  return res.status(409).json({
    sucesso:       false,
    code:          err.code,
    error:         err.message,
    mensagem:      err.message,
    versaoAtual:   err.versaoAtual   ?? null,
    versaoCliente: err.versaoCliente ?? null,
    editor:        err.editor        ?? null,
    ...extra,
  });
}

module.exports = {
  ConflitoEdicaoError,
  lerControle,
  descreverEditor,
  gravarComVersao,
  reservarVersao,
  assumirComLock,
  invalidarVersoes,
  definirAutor,
  anexarControle,
  versaoDoBody,
  responderConflito,
  TABELAS,
};
