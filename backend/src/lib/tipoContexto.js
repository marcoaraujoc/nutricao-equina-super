// backend/src/lib/tipoContexto.js
//
// TIPO DE USUÁRIO É POR EMPRESA (decisão 2026-07-30).
//
// O `User` guarda a IDENTIDADE (e-mail, senha, ativo) e um `userType` que agora é
// apenas o padrão/legado. O que a pessoa É dentro de uma clínica se resolve pelo
// CONTEXTO ATIVO (req.empresaId / req.equipeId):
//
//   0. é DONA da empresa                  → GESTOR sempre, mesmo sem vínculo gravado
//   1. tem vínculo de equipe no contexto  → o tipo vem do CARGO que o gestor deu
//      (gestora/veterinária/estagiária/enfermeira/... → cargoParaTipo)
//   2. não tem vínculo, mas é cliente ali → PROPRIETARIO (tem cadastro de
//      proprietário na empresa OU animal ativo dela)
//   3. nada disso                         → cai no `User.userType` (legado, vet
//      autônomo, cliente sem empresa resolvida)
//
// ADMIN é global por definição (plataforma) e nunca é reescrito pelo contexto.
//
// ⚠️ MAIS DE UM PAPEL NA MESMA EMPRESA (ex.: dona/gestora que TAMBÉM tem cadastro
// de cliente, ou veterinária que TAMBÉM é cliente) NÃO tem um "tipo" próprio aqui —
// este resolvedor devolve UM tipo/cargo (o mais forte, pela ordem acima), que é o
// que orienta menu/telas. A SOMA de permissões entre os papéis (regra de produto:
// "sempre soma, nunca restringe") é responsabilidade de quem CONSOME o resultado —
// `permissao.middleware.js` (checkPermission) e `EquipeController.minhasPermissoes`
// — que consultam a Matriz do PROPRIETARIO em UNIÃO com o cargo/bypass encontrado
// aqui, nunca em vez dele. Ver `ajusteperfil` na memória.
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
 * A pessoa tem cadastro de CLIENTE nesta empresa? (ProprietarioPerfil ativo OU
 * animal ativo dela). Extraído porque `EquipeController.minhasPermissoes` e
 * `checkPermission` reusam o MESMO critério para decidir se somam a Matriz do
 * PROPRIETARIO ao cargo/bypass da pessoa (regra "sempre soma" — `ajusteperfil`).
 */
async function resolverComoCliente(userId, empresaId) {
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
  return !!(perfilCliente || animalNaEmpresa);
}

/**
 * Tipo efetivo do usuário na empresa/equipe do contexto.
 * @returns {Promise<{ tipo: string, cargo: string|null, origem: 'ADMIN'|'DONO'|'VINCULO'|'CARGO'|'CLIENTE'|'LEGADO' }>}
 */
async function resolverTipoNoContexto({ userId, userType, role, empresaId, equipeId }) {
  const base = userType ?? null;
  if (ehAdminPlataforma({ role, userType })) {
    return { tipo: 'ADMIN', cargo: null, origem: 'ADMIN' };
  }

  // 0. DONO DA EMPRESA — sempre GESTOR aqui, consistente com o bypass INCONDICIONAL
  //    que `checkPermission` (permissao.middleware.js) já dá ao dono. Sem isto, dono
  //    cuja empresa ainda não tem linha em tb_usuario_empresa (ou que a teve
  //    sobrescrita — ver `ehProfissionalNaEmpresa`/ProprietarioController) era
  //    resolvido pelo tipo LEGADO/de cliente — divergindo do que as permissões já
  //    concediam (caso real: dona da Patyvet, com `perfil` corrompido para
  //    PROPRIETARIO, seguia operando como gestora via `checkPermission`, mas o
  //    `userType` devolvido por aqui — usado em getMe/menus — dizia PROPRIETARIO).
  if (empresaId) {
    const dono = await prisma.empresa.findFirst({
      where:  { id: Number(empresaId), ownerId: Number(userId) },
      select: { id: true },
    });
    if (dono) return { tipo: CARGO_PARA_TIPO.GESTOR, cargo: 'GESTOR', origem: 'DONO' };
  }

  // 1. FONTE PRIMÁRIA: a tabela de ligação usuário × empresa. O `perfil` gravado ali
  //    É o tipo de usuário naquela empresa (ver lib/usuarioEmpresa.js).
  if (empresaId) {
    const vinculo = await prisma.usuarioEmpresa.findUnique({
      where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
      select: { perfil: true },
    });
    if (vinculo?.perfil) {
      return {
        tipo:   CARGO_PARA_TIPO[vinculo.perfil] ?? vinculo.perfil,
        cargo:  vinculo.perfil,
        origem: 'VINCULO',
      };
    }
  }

  // 2. Vínculo de equipe no contexto ativo — equipe explícita vence a empresa.
  //    (fallback enquanto houver vínculo de equipe sem linha em tb_usuario_empresa)
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

  // 3. Sem vínculo profissional: é CLIENTE nesta empresa? (cadastro de proprietário
  //    ou animal ativo dela). Sem isto, a profissional que também é cliente em outra
  //    clínica entraria lá com o tipo profissional e cairia na matriz errada.
  if (empresaId && await resolverComoCliente(userId, empresaId)) {
    return { tipo: 'PROPRIETARIO', cargo: null, origem: 'CLIENTE' };
  }

  // 4. Legado / sem contexto resolvido.
  return { tipo: base ?? 'PROPRIETARIO', cargo: null, origem: 'LEGADO' };
}

module.exports = { resolverTipoNoContexto, CARGO_PARA_TIPO, resolverComoCliente };
