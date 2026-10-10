// backend/src/__tests__/desbloqueioAuditoriaPlataforma.test.js
//
// 🔴 (2026-10-10) O ADMIN desbloqueava a conta e recebia 500: sem empresa no contexto,
// a auditoria nascia com `empresaId` NULO e o `WITH CHECK` de `tb_audit_logs` a
// recusava (42501 "new row violates row-level security policy"). A conta já estava
// liberada — só a resposta mentia. Sem empresa, a linha vai em escopo de PLATAFORMA.
'use strict';

const fs   = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'EquipeController.js'), 'utf8');

describe('Desbloqueio de conta — auditoria do ADMIN', () => {
  const ini = SRC.indexOf('desbloquearMembro: async');
  const fn  = SRC.slice(ini, SRC.indexOf('toggleMembro: async', ini));

  it('sem empresa no contexto, grava em escopo de plataforma', () => {
    expect(fn).toMatch(/if \(req\.empresaId\) await auditar\(\);\s*else await comEscopoPlataforma\(auditar\);/);
  });

  it('não sobrou gravação direta fora do escopo', () => {
    expect(fn).not.toMatch(/await registrarAuditoria\(prisma, req/);
  });
});
