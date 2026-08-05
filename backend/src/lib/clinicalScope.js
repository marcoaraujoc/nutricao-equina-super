// backend/src/lib/clinicalScope.js
// Segregação multi-clínica dos registros clínicos: o mesmo animal pode ser paciente
// de vários veterinários/clínicas (multi-vet), mas cada empresa/equipe enxerga apenas
// os PRÓPRIOS registros + os criados pelo próprio usuário. ADMIN e o PROPRIETÁRIO do
// animal veem o histórico completo (o acesso ao animal já é validado pelos callers
// via verificarAcessoAnimal).
//
// ⚠️ MUDANÇA (isolamento entre empresas): o GESTOR NÃO recebe mais `{}`.
//
// A regra "gestor tem acesso a tudo" vale para AUTORIA — ele enxerga e finaliza o que
// QUALQUER membro da equipe registrou —, nunca para TENANT. Devolvendo `{}` o filtro
// de empresa sumia por completo, e toda listagem clínica que não fosse por animalId
// passava a incluir registros de OUTRAS clínicas. Já tinha acontecido duas vezes
// (fila de vacina do plantão e prescrição em /execucao-prescricao), corrigidas caso a
// caso; a origem era esta função, então a correção passou para cá — quem chama não
// precisa mais lembrar de somar o próprio limite de empresa.
//
// O gestor continua vendo registro com tenancy AUSENTE (`empresaId: null`): era esse o
// motivo original do bypass — evolução gravada com empresaId divergente/nulo por race
// de contexto não pode sumir da tela dele.
'use strict';

/**
 * Quem não tem recorte por AUTORIA.
 * ⚠️ Não confundir com "sem recorte por EMPRESA": só ADMIN e PROPRIETARIO são globais.
 * Mantida exportada porque outros módulos a consultam.
 */
function semEscopoClinico(req) {
  const { role, userType } = req.user ?? {};
  return role === 'ADMIN' || userType === 'ADMIN' || userType === 'PROPRIETARIO'
      || req.membroCargo === 'GESTOR';
}

/** ADMIN da plataforma e PROPRIETARIO do animal: sem filtro de empresa. */
function semEscopoDeEmpresa(req) {
  const { role, userType } = req.user ?? {};
  return role === 'ADMIN' || userType === 'ADMIN' || userType === 'PROPRIETARIO';
}

function ehGestor(req) {
  return req.membroCargo === 'GESTOR';
}

/**
 * Where de visibilidade para EvolucaoClinica (tem empresaId próprio — tenancy
 * gravada na criação a partir do contexto ativo do autor).
 */
function escopoEvolucaoWhere(req) {
  if (semEscopoDeEmpresa(req)) return {};
  const userId = Number(req.user.id);

  if (ehGestor(req) && req.empresaId) {
    // Todos os autores da empresa + registros sem tenancy (legado/race de contexto).
    return { OR: [{ empresaId: Number(req.empresaId) }, { empresaId: null }] };
  }

  return req.empresaId
    ? { OR: [{ empresaId: Number(req.empresaId) }, { veterinarioId: userId }] }
    : { veterinarioId: userId };
}

/**
 * Where de visibilidade para registros VINCULADOS a uma evolução (VacinaClinica,
 * ExameClinico, EncaminhamentoClinico): herdam a tenancy da evolução do atendimento.
 * Avulsos (evolucaoId null) valem pela empresa do autor (ou pelo próprio autor).
 */
function escopoFilhoEvolucaoWhere(req) {
  if (semEscopoDeEmpresa(req)) return {};
  const userId = Number(req.user.id);
  if (!req.empresaId) return { veterinarioId: userId };
  const empresaId = Number(req.empresaId);

  if (ehGestor(req)) {
    return {
      OR: [
        { evolucao: { empresaId } },
        { evolucao: { empresaId: null } },
        // Avulso: pertence a quem registrou — vale se o autor é da empresa.
        { evolucaoId: null, veterinario: { membrosEquipe: { some: { equipe: { empresaId } } } } },
      ],
    };
  }

  return {
    OR: [
      { evolucao: { empresaId } },
      { veterinarioId: userId },
      // Avulso (sem evolução vinculada): visível para a empresa do autor
      { evolucaoId: null, veterinario: { membrosEquipe: { some: { equipe: { empresaId } } } } },
    ],
  };
}

/**
 * Where de visibilidade para PrescricaoGrupo (tem empresaId próprio, já gravado
 * na criação).
 */
function escopoPrescricaoGrupoWhere(req) {
  if (semEscopoDeEmpresa(req)) return {};
  const userId = Number(req.user.id);

  if (ehGestor(req) && req.empresaId) {
    return { OR: [{ empresaId: Number(req.empresaId) }, { empresaId: null }] };
  }

  return req.empresaId
    ? { OR: [{ empresaId: Number(req.empresaId) }, { veterinarioId: userId }] }
    : { veterinarioId: userId };
}

module.exports = {
  semEscopoClinico,
  semEscopoDeEmpresa,
  escopoEvolucaoWhere,
  escopoFilhoEvolucaoWhere,
  escopoPrescricaoGrupoWhere,
};
