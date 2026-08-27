// backend/src/lib/clienteEmpresa.js
//
// "Este usuário é CLIENTE (proprietário) DESTA empresa?" — guard de autorização a
// nível de OBJETO para rotas que recebem um `:proprietarioId` na URL.
//
// 🔴 POR QUE EXISTE (falha real corrigida): `GET /clinica/faturas/proprietario/:id`
// aceitava QUALQUER id, criava uma fatura no tenant do chamador apontando para o
// usuário alheio e devolvia, via `include.proprietario`, o nome/e-mail/telefone lido
// de `users` — tabela que NÃO tem RLS (é identidade global). Resultado: qualquer
// gestor enumerava ids inteiros e colhia PII de clientes de TODAS as clínicas.
//
// ⚠️ NÃO reutilizar o `whereEhClienteDaEmpresa` do ProprietarioController para isto:
// aquele inclui `{ userType: 'PROPRIETARIO' }` — o tipo GLOBAL, igual em todas as
// empresas — então casaria um cliente de OUTRA clínica. Aqui a pergunta é
// "tem VÍNCULO REAL com ESTA empresa?", e só isso:
//   - animal ATIVO na empresa;
//   - ProprietarioPerfil na empresa;
//   - UsuarioEmpresa (vínculo) com perfil PROPRIETARIO na empresa;
//   - fatura já emitida para ele NESTA empresa;
//   - coluna legada users.empresaId apontando para a empresa.
'use strict';

const prisma = require('./prisma').default;

/** `where` (sobre `User`) que exige vínculo REAL do proprietário com a empresa. */
function whereClienteDaEmpresa(empresaId) {
  const id = Number(empresaId);
  return {
    OR: [
      { animais:            { some: { empresaId: id, ativo: true } } },
      { proprietarioPerfis: { some: { empresaId: id } } },
      { empresasVinculadas: { some: { empresaId: id, perfil: 'PROPRIETARIO' } } },
      { faturas:            { some: { empresaId: id } } },
      { empresaId: id },
    ],
  };
}

/**
 * `true` se `proprietarioId` é cliente de `empresaId`. Roda sob o tenant do request
 * (o RLS já restringe as relações lidas à empresa ativa) — passar um `empresaId`
 * diferente do tenant só torna o resultado mais restritivo, nunca mais permissivo.
 */
async function ehClienteDaEmpresa(proprietarioId, empresaId, db = prisma) {
  const pid = Number(proprietarioId);
  const eid = Number(empresaId);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(eid) || eid <= 0) return false;
  const achado = await db.user.findFirst({
    where:  { id: pid, ...whereClienteDaEmpresa(eid) },
    select: { id: true },
  });
  return Boolean(achado);
}

module.exports = { whereClienteDaEmpresa, ehClienteDaEmpresa };
