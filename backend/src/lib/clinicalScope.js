// backend/src/lib/clinicalScope.js
// Segregação multi-clínica dos registros clínicos: o mesmo animal pode ser paciente
// de vários veterinários/clínicas (multi-vet), mas cada empresa/equipe enxerga apenas
// os PRÓPRIOS registros + os criados pelo próprio usuário. ADMIN e o PROPRIETÁRIO do
// animal veem o histórico completo (o acesso ao animal já é validado pelos callers
// via verificarAcessoAnimal).
'use strict';

function semEscopoClinico(req) {
  const { role, userType } = req.user ?? {};
  return role === 'ADMIN' || userType === 'ADMIN' || userType === 'PROPRIETARIO';
}

/**
 * Where de visibilidade para EvolucaoClinica (tem empresaId próprio — tenancy
 * gravada na criação a partir do contexto ativo do autor).
 */
function escopoEvolucaoWhere(req) {
  if (semEscopoClinico(req)) return {};
  const userId = Number(req.user.id);
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
  if (semEscopoClinico(req)) return {};
  const userId = Number(req.user.id);
  if (!req.empresaId) return { veterinarioId: userId };
  const empresaId = Number(req.empresaId);
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
  if (semEscopoClinico(req)) return {};
  const userId = Number(req.user.id);
  return req.empresaId
    ? { OR: [{ empresaId: Number(req.empresaId) }, { veterinarioId: userId }] }
    : { veterinarioId: userId };
}

module.exports = {
  semEscopoClinico,
  escopoEvolucaoWhere,
  escopoFilhoEvolucaoWhere,
  escopoPrescricaoGrupoWhere,
};
