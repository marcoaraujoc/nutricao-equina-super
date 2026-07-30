// backend/src/lib/tipoContexto.js
//
// TIPO DE USUÁRIO É POR EMPRESA (decisão 2026-07-30).
//
// O `User` guarda a IDENTIDADE (e-mail, senha, ativo) e um `userType` que agora é
// apenas o padrão/legado. O que a pessoa É dentro de uma clínica se resolve pelo
// CONTEXTO ATIVO (req.empresaId / req.equipeId):
//
//   1. tem vínculo de equipe no contexto  → o tipo vem do CARGO que o gestor deu
//      (gestora/veterinária/estagiária/enfermeira/... → cargoParaTipo)
//   2. não tem vínculo, mas é cliente ali → PROPRIETARIO (tem cadastro de
//      proprietário na empresa OU animal ativo dela)
//   3. nada disso                         → cai no `User.userType` (legado, vet
//      autônomo, cliente sem empresa resolvida)
//
// ADMIN é global por definição (plataforma) e nunca é reescrito pelo contexto.
//
// É isto que permite o MESMO e-mail ser gestora na empresa 1, veterinária na 2,
// estagiária na 3 e PROPRIETÁRIA na 4 — cada uma com seu cadastro (endereço,
// telefone) em ProfissionalPerfil/ProprietarioPerfil — sem duplicar linha em `users`
// (e sem partir login, 2FA, OAuth e reset de senha, que são da identidade).
'use strict';

const prisma = require('./prisma').default;

// Cargo na equipe → tipo de usuário efetivo. Mesma tabela usada na inclusão de
// membro (EquipeController), aqui como fonte única para a LEITURA.
const CARGO_PARA_TIPO = {
  GESTOR:       'VETERINARIO',
  VETERINARIO:  'VETERINARIO',
  ESTAGIARIO:   'ESTAGIARIO',
  ENFERMEIRO:   'ESTAGIARIO',
  SECRETARIA:   'ESTAGIARIO',
  FINANCEIRO:   'ESTAGIARIO',
  FORNECEDOR:   'FORNECEDOR',
  PRESTADOR:    'FORNECEDOR',
  PROPRIETARIO: 'PROPRIETARIO',
  ADMIN:        'VETERINARIO',
  MEMBRO:       'ESTAGIARIO',
};

const ehAdminPlataforma = (u) => u?.role === 'ADMIN' || u?.userType === 'ADMIN';

/**
 * Tipo efetivo do usuário na empresa/equipe do contexto.
 * @returns {Promise<{ tipo: string, cargo: string|null, origem: 'ADMIN'|'CARGO'|'CLIENTE'|'LEGADO' }>}
 */
async function resolverTipoNoContexto({ userId, userType, role, empresaId, equipeId }) {
  const base = userType ?? null;
  if (ehAdminPlataforma({ role, userType })) {
    return { tipo: 'ADMIN', cargo: null, origem: 'ADMIN' };
  }

  // 1. Vínculo de equipe no contexto ativo — equipe explícita vence a empresa.
  let membro = null;
  if (equipeId) {
    membro = await prisma.membroEquipe.findFirst({
      where:  { userId: Number(userId), equipeId: Number(equipeId) },
      select: { cargo: true },
    });
  }
  if (!membro && empresaId) {
    membro = await prisma.membroEquipe.findFirst({
      where:   { userId: Number(userId), equipe: { empresaId: Number(empresaId) } },
      orderBy: { createdAt: 'desc' },
      select:  { cargo: true },
    });
  }
  if (membro) {
    return { tipo: CARGO_PARA_TIPO[membro.cargo] ?? base ?? 'ESTAGIARIO', cargo: membro.cargo, origem: 'CARGO' };
  }

  // 2. Sem vínculo profissional: é CLIENTE nesta empresa? (cadastro de proprietário
  //    ou animal ativo dela). Sem isto, a profissional que também é cliente em outra
  //    clínica entraria lá com o tipo profissional e cairia na matriz errada.
  if (empresaId) {
    const [perfilCliente, animalNaEmpresa] = await Promise.all([
      prisma.proprietarioPerfil.findFirst({
        where:  { userId: Number(userId), empresaId: Number(empresaId), ativo: true },
        select: { id: true },
      }),
      prisma.animal.findFirst({
        where:  { userId: Number(userId), empresaId: Number(empresaId), ativo: true },
        select: { id: true },
      }),
    ]);
    if (perfilCliente || animalNaEmpresa) {
      return { tipo: 'PROPRIETARIO', cargo: null, origem: 'CLIENTE' };
    }
  }

  // 3. Legado / sem contexto resolvido.
  return { tipo: base ?? 'PROPRIETARIO', cargo: null, origem: 'LEGADO' };
}

module.exports = { resolverTipoNoContexto, CARGO_PARA_TIPO };
