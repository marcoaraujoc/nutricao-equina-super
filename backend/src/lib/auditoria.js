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

const CATEGORIAS = ['EXCLUSAO', 'CANCELAMENTO', 'AJUSTE'];

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
  const action = `${categoria} ${entidade}${entidadeId != null ? ` #${entidadeId}` : ''}`;
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

module.exports = { registrarAuditoria, ipDoRequest };
