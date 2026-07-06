'use strict';

const crypto = require('crypto');
const prisma  = require('../lib/prisma').default;

const CRMV_REGEX = /^(\d{1,6})\/(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;

function hashCrmv(numero, uf) {
  const n = String(numero).replace(/\D/g, '').padStart(6, '0');
  return crypto.createHash('sha256').update(`${n}${uf.toUpperCase()}`).digest('hex');
}

async function validarCRMV(crmv) {
  const match = (crmv ?? '').trim().toUpperCase().match(CRMV_REGEX);
  if (!match) return { valido: false, motivo: 'formato_invalido' };

  const [, numero, uf] = match;

  // Se o índice ainda não foi populado, informa sem bloquear
  const total = await prisma.crmvValido.count();
  if (total === 0) {
    return { valido: null, motivo: 'indice_vazio' };
  }

  const hash      = hashCrmv(numero, uf);
  const encontrado = await prisma.crmvValido.findUnique({ where: { hash } });

  return encontrado
    ? { valido: true,  uf }
    : { valido: false, motivo: 'nao_encontrado' };
}

async function statusIndice() {
  const [total, syncLog] = await Promise.all([
    prisma.crmvValido.count(),
    prisma.crmvSyncLog.findFirst({ orderBy: { executadoEm: 'desc' } }),
  ]);

  return {
    totalCrmvs:           total,
    ultimaSincronizacao:  syncLog?.executadoEm  ?? null,
    duracao:              syncLog?.duracao       ?? null,
    sucesso:              syncLog?.sucesso       ?? null,
    erro:                 syncLog?.erro          ?? null,
  };
}

module.exports = { validarCRMV, hashCrmv, statusIndice };