// backend/src/lib/auditoria.js
// Auditoria central de exclusões/cancelamentos — grava no AuditLog (tb_audit_logs).
//
// Todo endpoint de exclusão/cancelamento DEVE exigir `motivo` no body e registrar
// aqui. Passe o `tx` quando a operação já roda dentro de uma transaction — o log
// entra na mesma atomicidade (se a operação falha, o log não fica órfão; se o log
// falha, a operação inteira faz rollback — a justificativa nunca se perde).
//
// INSERT via SQL parametrizado (não usa o client tipado) — resiliente a client
// desatualizado logo após migration, antes do `npx prisma generate`.
'use strict';

const prisma = require('./prisma').default;

// TRANSFERENCIA → troca de responsável (assumir / transferir / reatribuir agenda).
//                 O `detalhes` DEVE dizer quem era o dono anterior e quem passou a ser.
// ALTERACAO      → edição de registro do atendimento, com o antes → depois.
// CRIACAO        → nasceu um registro. Sem ela a trilha tem buraco: dá para ver que um
//                  agendamento foi cancelado, mas não que ele existiu nem quem o marcou.
const CATEGORIAS = ['EXCLUSAO', 'CANCELAMENTO', 'AJUSTE', 'CONFIGURACAO', 'TRANSFERENCIA', 'ALTERACAO', 'CRIACAO'];

/**
 * Extrai o IP de origem do request de forma consistente com o `trust proxy`
 * configurado no server (req.ip já respeita X-Forwarded-For nos hops confiáveis).
 * Normaliza o formato IPv6-mapeado (::ffff:1.2.3.4 → 1.2.3.4).
 */
function ipDoRequest(req) {
  const raw = req?.ip || req?.socket?.remoteAddress || null;
  if (!raw) return null;
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * @param {object|null} client  prisma ou tx (transaction aberta) — null usa o prisma global
 * @param {object} req          request Express autenticado (req.user, req.empresaId, req.ip)
 * @param {object} dados        { categoria, entidade, entidadeId?, animalId?, motivo?, detalhes? }
 */
async function registrarAuditoria(client, req, { categoria, entidade, entidadeId = null, animalId = null, motivo = null, detalhes = null }) {
  if (!CATEGORIAS.includes(categoria)) throw new Error(`categoria de auditoria inválida: ${categoria}`);
  const c = client ?? prisma;
  // Sem o id no texto: ele já é a coluna `entidadeId` (filtrável e preservada), e a
  // tela de Auditoria não exibe referência numérica. Repeti-lo aqui só reintroduzia
  // o "#65" no rótulo da ação.
  const action = `${categoria} ${entidade}`;
  await c.$executeRawUnsafe(
    `INSERT INTO schs2vet.tb_audit_logs
       ("userId", "userName", "email", "action", "empresaId", "categoria", "entidade", "entidadeId", "animalId", "motivo", "detalhes", "ip")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    req.user?.id ?? null,
    req.user?.fullName ?? '',
    req.user?.email ?? '',
    action,
    req.empresaId ?? null,
    categoria,
    entidade,
    entidadeId != null ? Number(entidadeId) : null,
    animalId   != null ? Number(animalId)   : null,
    motivo?.trim() || null,
    detalhes || null,
    ipDoRequest(req),
  );
}

/**
 * Encurta campo longo (texto de evolução, observação) para o antes → depois.
 * O AuditLog é um LEDGER, não um versionador de conteúdo: guardar o corpo inteiro de
 * cada evolução a cada "Salvar" inflaria a tabela sem responder nada que o registro
 * atual + o rastro de responsável já não respondam.
 */
function resumoTexto(valor, max = 180) {
  if (valor == null) return null;
  const s = String(valor).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length} caracteres)`;
}

/**
 * Nome legível de um usuário para o texto da auditoria.
 * Aceita o client/tx para respeitar a transaction em curso.
 *
 * ⚠️ Devolve SÓ O NOME, sem id (decisão de 2026-08-04: a auditoria não exibe
 * referência numérica). Efeito colateral aceito: dois profissionais homônimos ficam
 * indistinguíveis DENTRO do texto de `detalhes`. Quem executou a ação continua
 * identificado pelas colunas `userId`/`email` da própria linha; o que se perde é o id
 * do "de quem → para quem" numa transferência. Sem nome (usuário apagado), devolve
 * "usuário não identificado" em vez do id.
 */
async function nomeDoUsuario(client, userId) {
  if (userId == null) return '—';
  try {
    const c = client ?? prisma;
    const [u] = await c.$queryRawUnsafe(
      'SELECT "fullName" FROM schs2vet.users WHERE id = $1',
      Number(userId),
    );
    return u?.fullName || 'usuário não identificado';
  } catch {
    return 'usuário não identificado';
  }
}

/**
 * Registra uma TROCA DE RESPONSÁVEL sobre um registro do atendimento.
 *
 * Sempre grava QUEM ERA o dono anterior e QUEM PASSOU A SER — é o que a auditoria
 * precisa responder quando um atendimento muda de mãos (assumir, transferir agenda,
 * reatribuir profissional) e o que o arrasto em cascata torna obrigatório: sem isto,
 * prescrição/exame/encaminhamento mudam de dono sem rastro nenhum.
 *
 * @param {object} dados { entidade, entidadeId, animalId?, deVetId, paraVetId, motivo?, origem? }
 *   `origem` = o que disparou a cascata (ex.: 'EVOLUCAO #12 assumida').
 */
async function registrarTransferencia(client, req, { entidade, entidadeId, animalId = null, deVetId, paraVetId, motivo = null, origem = null }) {
  const [de, para] = await Promise.all([
    nomeDoUsuario(client, deVetId),
    nomeDoUsuario(client, paraVetId),
  ]);
  await registrarAuditoria(client, req, {
    categoria: 'TRANSFERENCIA',
    entidade,
    entidadeId,
    animalId,
    motivo,
    detalhes: `responsável anterior: ${de} → novo responsável: ${para}`
            + (origem ? ` | origem: ${origem}` : ''),
  });
}

/**
 * Registra ALTERAÇÃO de um registro do atendimento com o antes → depois.
 *
 * `campos` = { campo: { de, para } }. Campos sem mudança real são descartados aqui
 * mesmo — auditoria de "nada mudou" só faz ruído. Nada é gravado se a lista ficar
 * vazia. `donoAtual` entra sempre no texto: a mesma edição significa coisas
 * diferentes conforme quem conduz o atendimento no momento.
 */
async function registrarAlteracao(client, req, { entidade, entidadeId, animalId = null, campos = {}, donoAnteriorId = null, donoAtualId = null, motivo = null }) {
  const mudancas = Object.entries(campos)
    .filter(([, v]) => v && String(v.de ?? '') !== String(v.para ?? ''))
    .map(([campo, v]) => `${campo}: "${v.de ?? '—'}" → "${v.para ?? '—'}"`);

  if (mudancas.length === 0) return;

  const donoDe   = await nomeDoUsuario(client, donoAnteriorId ?? donoAtualId);
  const donoPara = donoAnteriorId != null && donoAtualId != null && Number(donoAnteriorId) !== Number(donoAtualId)
    ? await nomeDoUsuario(client, donoAtualId)
    : null;

  await registrarAuditoria(client, req, {
    categoria: 'ALTERACAO',
    entidade,
    entidadeId,
    animalId,
    motivo,
    detalhes: `responsável: ${donoDe}${donoPara ? ` → ${donoPara}` : ''} | ${mudancas.join(' ; ')}`,
  });
}

module.exports = {
  registrarAuditoria,
  registrarTransferencia,
  registrarAlteracao,
  nomeDoUsuario,
  resumoTexto,
  ipDoRequest,
};
