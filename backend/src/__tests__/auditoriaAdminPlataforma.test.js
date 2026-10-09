// backend/src/__tests__/auditoriaAdminPlataforma.test.js
//
// O que este arquivo protege: a tela de Auditoria do ADMIN da plataforma. `tb_audit_logs`
// tem RLS forçado, e o ADMIN normalmente não tem empresa no contexto — sem o escopo de
// plataforma a consulta devolve ZERO linhas, com sucesso e sem erro (medido: 0 de 1.003).
// E LOGIN/LOGOUT nasce sem empresa, então só aparece nesse escopo. Quebra em SILÊNCIO.

'use strict';

const fs = require('fs');
const path = require('path');
const escopoPlataformaSeAdmin = require('../middlewares/escopoPlataforma');
const { ehPlataforma } = require('../lib/prismaTenant');

test('🔴 GET /audit/logs passa pelo escopo de plataforma do ADMIN', () => {
  const rotas = fs.readFileSync(path.join(__dirname, '../routes/audit.js'), 'utf8');
  expect(rotas).toMatch(/router\.get\(\s*'\/logs',\s*authenticate,\s*escopoPlataformaSeAdmin,\s*controller\.listar\)/);
});

test('ADMIN da plataforma entra em escopo de plataforma', async () => {
  let dentro;
  await escopoPlataformaSeAdmin({ user: { role: 'ADMIN' } }, {}, () => { dentro = ehPlataforma(); });
  expect(dentro).toBe(true);
});

test('gestor NÃO ganha escopo de plataforma (segue no tenant da empresa ativa)', async () => {
  let dentro;
  await escopoPlataformaSeAdmin(
    { user: { role: 'USER', userType: 'VETERINARIO', userTypeGlobal: 'VETERINARIO' } }, {},
    () => { dentro = ehPlataforma(); },
  );
  expect(dentro).toBe(false);
});
