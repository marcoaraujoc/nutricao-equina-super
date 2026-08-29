// Catálogo de especialidades por espécie (fonte única). Usado no Cadastro Pessoal,
// Novo Fornecedor, Novo Membro (VET/FORNECEDOR), no filtro da Agenda e no
// encaminhamento.
//
// CATÁLOGO MISTO desde a migration 20260920000000 (mesma forma de `tb_medicamentos`):
// `empresa_id` nulo = item GLOBAL do sistema, que toda clínica LÊ; setado = cadastrado
// por aquela clínica (hoje, pelo encaminhamento a profissional externo), visível só
// para ela. O RLS já recusaria a linha de outra empresa, mas o `where` é explícito de
// propósito: escopo que só existe na policy some da revisão de código, e o dia em que
// a listagem rodar em escopo de plataforma (ADMIN) ela devolveria o catálogo inteiro
// de todas as clínicas sem ninguém notar.
const prisma = require('../lib/prisma').default;
// O recorte fica em `lib/especialidadeEscopo.js` porque ele é INERTE enquanto o Prisma
// Client não conhece `empresaId` (migration 20260920000000 aplicada + generate). Sem
// essa guarda, o catálogo inteiro responderia 500 no intervalo entre uma coisa e outra.
const { escopoDaEmpresa, catalogoPorEmpresaAtivo } = require('../lib/especialidadeEscopo');

const EspecialidadeController = {
  // GET /api/especialidades?especieIds=1,2  (especieIds opcional — filtra por espécie)
  // Retorna: { dados: [{ id, nome, especieId, especie: { id, nome } }] } ordenado por espécie/nome.
  async listar(req, res) {
    try {
      const where = { ativo: true, ...escopoDaEmpresa(req.empresaId) };

      const raw = String(req.query.especieIds ?? '').trim();
      if (raw) {
        const ids = raw.split(',').map(s => Number(s.trim())).filter(Number.isInteger);
        if (ids.length) where.especieId = { in: ids };
      }

      const dados = await prisma.especialidade.findMany({
        where,
        select: {
          id: true, nome: true, especieId: true,
          ...(catalogoPorEmpresaAtivo ? { empresaId: true } : {}),
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
        where:    { ativo: true, ...escopoDaEmpresa(req.empresaId) },
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
