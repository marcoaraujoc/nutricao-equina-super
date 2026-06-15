// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');

const TIPOS_VALIDOS = ['Laboratorial', 'Bioquímico', 'Imagem'];

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

const ExameClinicoController = {

  // GET /clinica/exames/animal/:animalId?page=1&limit=10
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const take = Math.min(Number(req.query.limit ?? 10), 50);
      const skip = (Number(req.query.page ?? 1) - 1) * take;

      const [itens, total] = await Promise.all([
        prisma.exameClinico.findMany({
          where:   { animalId, ativo: true },
          include: INCLUDE,
          orderBy: { dataSolicitacao: 'desc' },
          take, skip,
        }),
        prisma.exameClinico.count({ where: { animalId, ativo: true } }),
      ]);

      res.json({ dados: itens, meta: { total, page: Number(req.query.page ?? 1), limit: take } });
    } catch (err) {
      console.error('Erro ao listar exames clínicos:', err);
      res.status(500).json({ error: 'Erro ao listar exames' });
    }
  },

  // POST /clinica/exames
  // body: { animalId, tipo, descricao, laboratorio?, tipoAmostra?, indicacaoClinica?, observacao? }
  criar: async (req, res) => {
    try {
      const { animalId, tipo, descricao, laboratorio, tipoAmostra, indicacaoClinica, observacao } = req.body;

      if (!animalId || !tipo || !descricao?.trim()) {
        return res.status(400).json({ error: 'animalId, tipo e descricao são obrigatórios' });
      }
      if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: `tipo deve ser: ${TIPOS_VALIDOS.join(', ')}` });
      }

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      // Campos extras armazenados em observacao como JSON
      const extra = {
        laboratorio:      laboratorio?.trim()      || null,
        tipoAmostra:      tipoAmostra?.trim()      || null,
        indicacaoClinica: indicacaoClinica?.trim() || null,
        obs:              observacao?.trim()        || null,
      };

      const item = await prisma.exameClinico.create({
        data: {
          animalId:      Number(animalId),
          veterinarioId: req.user.userType === 'VETERINARIO' ? req.user.id : null,
          tipo,
          descricao:     descricao.trim(),
          status:        'SOLICITADO',
          observacao:    JSON.stringify(extra),
        },
        include: INCLUDE,
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao criar exame' });
    }
  },

  // DELETE /clinica/exames/:id  (soft delete)
  excluir: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      await prisma.exameClinico.update({ where: { id: item.id }, data: { ativo: false } });
      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir exame clínico:', err);
      res.status(500).json({ error: 'Erro ao excluir exame' });
    }
  },
};

module.exports = ExameClinicoController;
