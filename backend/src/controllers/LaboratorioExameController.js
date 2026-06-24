'use strict';
// Catálogo de laboratórios e exames clínicos — endpoints públicos (autenticados)

const prisma = require('../lib/prisma').default;

const LaboratorioExameController = {

  // GET /api/clinica/laboratorios
  // Lista todos os labs ativos ordenados por nome
  listarLaboratorios: async (req, res) => {
    try {
      const labs = await prisma.laboratorio.findMany({
        where:   { ativo: true },
        select:  { id: true, nome: true, contato: true, email: true, site: true },
        orderBy: { nome: 'asc' },
      });
      res.json({ dados: labs });
    } catch (err) {
      console.error('Erro ao listar laboratórios:', err);
      res.status(500).json({ error: 'Erro ao listar laboratórios' });
    }
  },

  // GET /api/clinica/laboratorios/:id/grupos
  // Grupos de exames de um laboratório específico
  listarGruposPorLab: async (req, res) => {
    try {
      const laboratorioId = Number(req.params.id);
      const grupos = await prisma.exameGrupo.findMany({
        where:   { laboratorioId, ativo: true },
        select:  { id: true, nome: true, ordem: true },
        orderBy: { ordem: 'asc' },
      });
      res.json({ dados: grupos });
    } catch (err) {
      console.error('Erro ao listar grupos:', err);
      res.status(500).json({ error: 'Erro ao listar grupos' });
    }
  },

  // GET /api/clinica/laboratorios/grupos/:grupoId/itens
  // Itens de um grupo específico
  listarItensPorGrupo: async (req, res) => {
    try {
      const grupoId = Number(req.params.grupoId);
      const itens = await prisma.exameItem.findMany({
        where:   { grupoId, ativo: true },
        select:  { id: true, nome: true, sigla: true, tiposAmostra: true },
        orderBy: { nome: 'asc' },
      });
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar itens de exame:', err);
      res.status(500).json({ error: 'Erro ao listar itens' });
    }
  },

  // GET /api/clinica/laboratorios/grupos-todos
  // Todos os grupos distintos (para seleção "Outros laboratórios")
  listarGruposTodos: async (req, res) => {
    try {
      const grupos = await prisma.$queryRaw`
        SELECT DISTINCT ON (nome) id, nome, ordem
        FROM schs2vet.tb_exame_grupos
        WHERE ativo = true
        ORDER BY nome, id
      `;
      res.json({ dados: grupos });
    } catch (err) {
      console.error('Erro ao listar grupos distintos:', err);
      res.status(500).json({ error: 'Erro ao listar grupos' });
    }
  },

  // GET /api/clinica/laboratorios/itens-todos?grupo=NOME_GRUPO
  // Todos os itens distintos de um grupo por nome, independente do lab
  // Usado quando "Outros laboratórios" está selecionado
  listarItensTodosPorNomeGrupo: async (req, res) => {
    try {
      const nomeGrupo = (req.query.grupo ?? '');
      if (!String(nomeGrupo).trim()) return res.json({ dados: [] });

      const itens = await prisma.$queryRaw`
        SELECT DISTINCT ON (i.nome) i.id, i.nome, i.sigla
        FROM schs2vet.tb_exame_itens i
        JOIN schs2vet.tb_exame_grupos g ON g.id = i.grupo_id
        WHERE g.nome = ${nomeGrupo}
          AND g.ativo = true
          AND i.ativo = true
        ORDER BY i.nome, i.id
      `;
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar itens distintos:', err);
      res.status(500).json({ error: 'Erro ao listar itens' });
    }
  },
};

module.exports = LaboratorioExameController;
