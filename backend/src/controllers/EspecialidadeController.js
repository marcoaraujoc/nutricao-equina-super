// Catálogo de especialidades por espécie (fonte única). Usado no Cadastro Pessoal,
// Novo Fornecedor e Novo Membro (VET/FORNECEDOR).
const prisma = require('../lib/prisma').default;

const EspecialidadeController = {
  // GET /api/especialidades?especieIds=1,2  (especieIds opcional — filtra por espécie)
  // Retorna: { dados: [{ id, nome, especieId, especie: { id, nome } }] } ordenado por espécie/nome.
  async listar(req, res) {
    try {
      const where = { ativo: true };

      const raw = String(req.query.especieIds ?? '').trim();
      if (raw) {
        const ids = raw.split(',').map(s => Number(s.trim())).filter(Number.isInteger);
        if (ids.length) where.especieId = { in: ids };
      }

      const dados = await prisma.especialidade.findMany({
        where,
        select: {
          id: true, nome: true, especieId: true,
          especie: { select: { id: true, nome: true } },
        },
        orderBy: [{ especieId: 'asc' }, { nome: 'asc' }],
      });

      return res.json({ dados });
    } catch (err) {
      console.error('Erro ao listar especialidades:', err);
      return res.status(500).json({ error: 'Erro ao listar especialidades' });
    }
  },

  // GET /api/especialidades/especies — espécies (animais) que possuem especialidades.
  // Exclui registros de espécie usados só pela nutrição (ex.: "NA ÁGUA DE BEBIDA").
  async listarEspecies(req, res) {
    try {
      const rows = await prisma.especialidade.findMany({
        where:    { ativo: true },
        select:   { especieId: true, especie: { select: { id: true, nome: true } } },
        distinct: ['especieId'],
        orderBy:  { especieId: 'asc' },
      });
      return res.json({ dados: rows.map(r => r.especie) });
    } catch (err) {
      console.error('Erro ao listar espécies com especialidades:', err);
      return res.status(500).json({ error: 'Erro ao listar espécies' });
    }
  },
};

module.exports = EspecialidadeController;
