// backend/src/controllers/EvolucaoController.js

const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');

const prisma = new PrismaClient();

// ─── Helper: notificar veterinários principais ────────────────────────────────

const notificarVetPrincipais = async (assunto, corpo) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;
  try {
    const vets = await prisma.user.findMany({
      where: { role: 'VETERINARIO' },
      select: { email: true },
    });
    if (vets.length === 0) return;

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    await Promise.allSettled(
      vets.map((v) =>
        transporter.sendMail({
          from: `S2Vet <${process.env.EMAIL_USER}>`,
          to: v.email,
          subject: assunto,
          text: corpo,
        })
      )
    );
  } catch (err) {
    console.error('EvolucaoController: erro ao notificar veterinários:', err);
  }
};

// ─── Controller ───────────────────────────────────────────────────────────────

const EvolucaoController = {

  listar: async (req, res) => {
    const { animalId } = req.params;
    const { page = '1', limit = '10', search = '', status = '', especialidade = '', pendentes = 'false' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      animalId: Number(animalId),
      ativo: true,
      aprovado: pendentes === 'true' ? false : true,
      ...(status && { status }),
      ...(especialidade && { especialidade }),
      ...(search && { texto: { contains: search } }),
    };

    // RBAC: estagiário vê apenas suas próprias evoluções
    if (req.user.role === 'ESTAGIARIO') {
      where.veterinarioId = req.user.id;
    }

    try {
      const [total, evolucoes] = await Promise.all([
        prisma.evolucaoClinica.count({ where }),
        prisma.evolucaoClinica.findMany({
          where,
          include: {
            veterinario:   { select: { id: true, fullName: true } },
            modificadoPor: { select: { id: true, fullName: true } },
          },
          orderBy: { dataInicio: 'desc' },
          skip,
          take: Number(limit),
        }),
      ]);

      res.json({
        sucesso: true,
        dados: evolucoes,
        total,
        page: Number(page),
        limit: Number(limit),
        totalPaginas: Math.ceil(total / Number(limit)),
      });
    } catch (error) {
      console.error('Erro ao listar evoluções:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const evolucao = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
        include: {
          veterinario:   { select: { id: true, fullName: true } },
          modificadoPor: { select: { id: true, fullName: true } },
          animal:        { select: { id: true, nome: true } },
        },
      });

      if (!evolucao || !evolucao.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      res.json({ sucesso: true, dados: evolucao });
    } catch (error) {
      console.error('Erro ao obter evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  criar: async (req, res) => {
    const { animalId, especialidade, texto, status = 'EM_ANDAMENTO' } = req.body;
    const { id: veterinarioId, role, fullName } = req.user;

    if (!animalId || !especialidade || !texto || !texto.trim()) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'animalId, especialidade e texto são obrigatórios',
      });
    }

    try {
      const aprovado = role !== 'ESTAGIARIO';

      const evolucao = await prisma.evolucaoClinica.create({
        data: {
          animalId: Number(animalId),
          veterinarioId,
          especialidade,
          texto: texto.trim(),
          status,
          aprovado,
          dataInicio: new Date(),
        },
        include: {
          veterinario: { select: { id: true, fullName: true } },
        },
      });

      await notificarVetPrincipais(
        `[S2Vet] Nova evolução clínica — Animal #${animalId}`,
        `${fullName} registrou uma nova evolução.\n\nEspecialidade: ${especialidade}\nStatus: ${status}${!aprovado ? '\n\n⚠️ Pendente de aprovação (estagiário).' : ''}`
      );

      res.status(201).json({ sucesso: true, dados: evolucao });
    } catch (error) {
      console.error('Erro ao criar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  atualizar: async (req, res) => {
    const { id } = req.params;
    const { especialidade, texto, status } = req.body;
    const { id: userId, role, fullName } = req.user;

    try {
      const existe = await prisma.evolucaoClinica.findUnique({ where: { id: Number(id) } });

      if (!existe || !existe.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      if (role === 'ESTAGIARIO') {
        return res.status(403).json({ sucesso: false, mensagem: 'Estagiários não podem editar evoluções' });
      }
      if (role === 'VETERINARIO' && existe.veterinarioId !== userId) {
        return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão para editar esta evolução' });
      }

      const dataFim =
        (status === 'FINALIZADA' || status === 'CANCELADA') && !existe.dataFim
          ? new Date()
          : existe.dataFim;

      const atualizada = await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          especialidade,
          texto: texto?.trim(),
          status,
          dataFim,
          dataModificacao: new Date(),
          modificadoPorId: userId,
        },
        include: {
          veterinario:   { select: { id: true, fullName: true } },
          modificadoPor: { select: { id: true, fullName: true } },
        },
      });

      await notificarVetPrincipais(
        `[S2Vet] Evolução clínica alterada — Animal #${existe.animalId}`,
        `${fullName} alterou uma evolução.\n\nEspecialidade: ${especialidade}\nStatus: ${status}`
      );

      res.json({ sucesso: true, dados: atualizada });
    } catch (error) {
      console.error('Erro ao atualizar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  excluir: async (req, res) => {
    const { id } = req.params;
    const { justificativa } = req.body;
    const { id: userId, role } = req.user;

    if (!justificativa || !justificativa.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Justificativa é obrigatória para exclusão' });
    }

    try {
      const existe = await prisma.evolucaoClinica.findUnique({ where: { id: Number(id) } });

      if (!existe || !existe.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      if (role === 'ESTAGIARIO') {
        return res.status(403).json({ sucesso: false, mensagem: 'Estagiários não podem excluir evoluções' });
      }
      if (role === 'VETERINARIO' && existe.veterinarioId !== userId) {
        return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão para excluir esta evolução' });
      }

      await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          ativo: false,
          justificativaExclusao: justificativa.trim(),
          dataModificacao: new Date(),
          modificadoPorId: userId,
          ...(existe.status === 'EM_ANDAMENTO' && { status: 'CANCELADA', dataFim: new Date() }),
        },
      });

      res.json({ sucesso: true, mensagem: 'Evolução removida com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  aprovar: async (req, res) => {
    const { id } = req.params;
    const { role } = req.user;

    if (role !== 'VETERINARIO' && role !== 'ADMIN') {
      return res.status(403).json({ sucesso: false, mensagem: 'Sem permissão para aprovar evoluções' });
    }

    try {
      const atualizada = await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: { aprovado: true },
        include: { veterinario: { select: { id: true, fullName: true } } },
      });

      res.json({ sucesso: true, dados: atualizada });
    } catch (error) {
      console.error('Erro ao aprovar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

module.exports = EvolucaoController;