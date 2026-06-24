'use strict';
// Catálogo de exames de diagnóstico por imagem — endpoints autenticados

const prisma = require('../lib/prisma').default;

const ImagemExameController = {

  // GET /api/clinica/imagem-exames/grupos
  listarGrupos: async (req, res) => {
    try {
      const grupos = await prisma.imagemExameGrupo.findMany({
        where:   { ativo: true },
        select:  { id: true, nome: true, categoria: true, ordem: true },
        orderBy: { ordem: 'asc' },
      });
      res.json({ dados: grupos });
    } catch (err) {
      console.error('Erro ao listar grupos de imagem:', err);
      res.status(500).json({ error: 'Erro ao listar grupos' });
    }
  },

  // GET /api/clinica/imagem-exames/grupos/:grupoId/itens
  listarItensPorGrupo: async (req, res) => {
    try {
      const grupoId = Number(req.params.grupoId);
      const itens = await prisma.imagemExameItem.findMany({
        where:   { grupoId, ativo: true },
        select:  { id: true, codigo: true, nome: true, sigla: true, especie: true },
        orderBy: { nome: 'asc' },
      });
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar itens de imagem:', err);
      res.status(500).json({ error: 'Erro ao listar itens' });
    }
  },
};

module.exports = ImagemExameController;
