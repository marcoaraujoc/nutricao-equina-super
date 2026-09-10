// src/controllers/AlimentoController.js

const prisma = require('../lib/prisma').default;
// `unidade` é lida/gravada por SQL cru: o client tipado derrubaria a tela inteira
// numa base sem a migration `20261003000000_alimento_unidade` (CLAUDE.md §11).
const { anexarUnidade, salvarUnidade } = require('../lib/alimentoUnidade');
const { registrarAuditoria } = require('../lib/auditoria');
const {
  empresaDoNovoItem, noEscopoDeEscrita, bloqueioDeEscrita, bloqueioDeUso,
  marcarOrigem, marcarOrigemEmLista, EXIGE_EMPRESA,
} = require('../lib/catalogoNutricional');

const AlimentoController = {

  listar: async (req, res) => {
    try {
      const { ativo, categoria } = req.query;

      const where = {};
      if (ativo !== undefined) where.ativo = ativo === 'true';
      if (categoria)          where.categoria = categoria;

      const alimentos = await prisma.alimento.findMany({
        where,
        orderBy: { nome: 'asc' },
      });

      // A policy de RLS ja devolve o GLOBAL + o da empresa do contexto; o que falta e
      // a tela saber qual e qual (`doSistema` gateia editar/excluir no front).
      res.json({ sucesso: true, dados: marcarOrigemEmLista(await anexarUnidade(alimentos)) });
    } catch (error) {
      console.error('Erro ao listar alimentos:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar alimentos' });
    }
  },

  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const alimento = await prisma.alimento.findUnique({
        where: { id: Number(id) },
      });

      if (!alimento) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      res.json({ sucesso: true, dados: marcarOrigem(await anexarUnidade(alimento)) });
    } catch (error) {
      console.error('Erro ao buscar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar alimento' });
    }
  },

  criar: async (req, res) => {
    const { nome, categoria, fabricante, forma, unidade } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do alimento é obrigatório' });
    }
    if (!categoria) {
      return res.status(400).json({ sucesso: false, mensagem: 'Categoria é obrigatória' });
    }

    // ADMIN da plataforma cria no catálogo GLOBAL; a clínica cria o alimento DELA.
    const empresaId = empresaDoNovoItem(req);
    if (empresaId === undefined) return res.status(EXIGE_EMPRESA.status).json(EXIGE_EMPRESA.corpo);

    try {
      // O RLS limita a busca ao que este contexto enxerga (global + próprio), então o
      // 409 fala do que a pessoa realmente veria na lista — nunca de alimento de outra
      // clínica, que ela não pode nem consultar.
      const existente = await prisma.alimento.findFirst({
        where: { nome: nome.trim() },
      });

      if (existente) {
        return res.status(409).json({
          sucesso: false,
          mensagem: existente.empresaId == null
            ? `O alimento "${nome.trim()}" já existe no catálogo do sistema.`
            : `O alimento "${nome.trim()}" já está cadastrado nesta clínica.`,
        });
      }

      const alimento = await noEscopoDeEscrita(req, empresaId == null, () =>
        prisma.alimento.create({
          data: {
            nome:       nome.trim(),
            categoria,
            fabricante: fabricante?.trim() || null,
            forma:      forma || null,
            empresaId,
            ativo:      true,
          },
        }));
      await salvarUnidade(alimento.id, unidade);

      res.status(201).json({ sucesso: true, dados: marcarOrigem(await anexarUnidade(alimento)) });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({ sucesso: false, mensagem: 'Alimento já cadastrado.' });
      }
      console.error('Erro ao criar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar alimento' });
    }
  },

  atualizar: async (req, res) => {
    const { id } = req.params;
    const { nome, categoria, fabricante, forma, unidade, ativo } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Nome do alimento é obrigatório' });
    }

    try {
      const existe = await prisma.alimento.findUnique({ where: { id: Number(id) } });
      if (!existe) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      const barrado = bloqueioDeEscrita(req, existe, 'alimento');
      if (barrado) return res.status(barrado.status).json(barrado.corpo);

      const alimento = await noEscopoDeEscrita(req, existe.empresaId == null, () =>
        prisma.alimento.update({
          where: { id: Number(id) },
          data: {
            nome:       nome.trim(),
            categoria,
            fabricante: fabricante?.trim() || null,
            forma:      forma || null,
            ativo:      ativo !== undefined ? Boolean(ativo) : existe.ativo,
          },
        }));
      await salvarUnidade(alimento.id, unidade);

      res.json({ sucesso: true, dados: marcarOrigem(await anexarUnidade(alimento)) });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }
      console.error('Erro ao atualizar alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar alimento' });
    }
  },

  // 🔴 EXCLUSÃO DE VERDADE (`delete`), não `ativo = false` — decisão de 2026-09-09.
  // O catálogo sai do banco; o que protege o histórico é `bloqueioDeUso`, não um flag.
  excluir: async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'É obrigatório informar o motivo da exclusão' });
    }

    try {
      const existe = await prisma.alimento.findUnique({ where: { id: Number(id) } });
      if (!existe) {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }

      const barrado = bloqueioDeEscrita(req, existe, 'alimento');
      if (barrado) return res.status(barrado.status).json(barrado.corpo);

      // A DIETA é registro clínico do paciente e não pode virar FK órfã — nem sumir
      // junto com o alimento. As COMPOSIÇÕES, ao contrário, não existem sem ele: são
      // "quanto deste nutriente há neste alimento" e vão junto, na mesma transaction.
      const emDietas = await prisma.dieta.count({ where: { alimentoId: Number(id) } });
      const emUso = bloqueioDeUso(
        [{ quantidade: emDietas, singular: 'dieta', plural: 'dietas' }],
        'alimento',
      );
      if (emUso) return res.status(emUso.status).json(emUso.corpo);

      const removidas = await noEscopoDeEscrita(req, existe.empresaId == null, () =>
        prisma.$transaction(async (tx) => {
          const { count } = await tx.composicaoAlimento.deleteMany({ where: { alimentoId: Number(id) } });
          await tx.alimento.delete({ where: { id: Number(id) } });
          return count;
        }));

      await registrarAuditoria(null, req, {
        categoria:  'EXCLUSAO',
        entidade:   'ALIMENTO',
        entidadeId: Number(id),
        motivo,
        detalhes:   `${existe.nome}${removidas > 0 ? ` — ${removidas} composição(ões) removida(s) junto` : ''}`,
      });

      res.json({
        sucesso: true,
        mensagem: `Alimento excluído${removidas > 0 ? ` com ${removidas} composição(ões)` : ''}.`,
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ sucesso: false, mensagem: 'Alimento não encontrado' });
      }
      console.error('Erro ao excluir alimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir alimento' });
    }
  },

};

module.exports = AlimentoController;