// backend/src/controllers/ResumoAtendimentoController.js
// Resumo consolidado de atendimentos do animal (IA, persistido) — AnimalDetail.
'use strict';

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { obterResumo, atualizarResumo } = require('../services/resumoAtendimentoService');

async function autorizar(req, res, animalId) {
  const acesso = await verificarAcessoAnimal({
    animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
  });
  if (acesso === null) { res.status(404).json({ error: 'Animal não encontrado' }); return false; }
  if (!acesso)         { res.status(403).json({ error: 'Acesso não autorizado a este animal' }); return false; }
  return true;
}

const ResumoAtendimentoController = {

  // GET /clinica/resumo-atendimento/animal/:animalId
  // Retorna o resumo SALVO + flag desatualizado (não chama a IA).
  obter: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      if (!(await autorizar(req, res, animalId))) return;
      const dados = await obterResumo(req, animalId);
      res.json({ dados });
    } catch (err) {
      console.error('ResumoAtendimentoController.obter:', err);
      res.status(500).json({ error: 'Erro ao buscar resumo de atendimentos' });
    }
  },

  // POST /clinica/resumo-atendimento/animal/:animalId/atualizar
  // Apenda os eventos novos ao resumo via IA e persiste. Sem eventos novos, não chama a IA.
  atualizar: async (req, res, next) => {
    try {
      const animalId = Number(req.params.animalId);
      if (!(await autorizar(req, res, animalId))) return;
      const animal = await prisma.animal.findUnique({ where: { id: animalId }, select: { nome: true } });
      const dados  = await atualizarResumo(req, animalId, animal?.nome ?? null);
      res.json({ dados });
    } catch (err) {
      // Limite de plano de IA → 429 pelo handler global (não é erro do servidor)
      if (err.code === 'IA_QUOTA_EXCEDIDA') return next(err);
      console.error('ResumoAtendimentoController.atualizar:', err);
      res.status(500).json({ error: 'Erro ao atualizar resumo de atendimentos' });
    }
  },
};

module.exports = ResumoAtendimentoController;
