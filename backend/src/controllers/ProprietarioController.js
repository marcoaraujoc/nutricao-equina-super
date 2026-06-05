// backend/src/controllers/ProprietarioController.js
'use strict';

const bcrypt       = require('bcryptjs');
const prisma       = require('../lib/prisma').default;
const emailService = require('../services/emailService');

const SELECT_PROPRIETARIO = {
  id: true, fullName: true, email: true, phone: true,
  role: true, userType: true, ativo: true, createdAt: true,
  cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true,
  cpf: true, cnpj: true, mensalista: true, valorAssistencia: true, frequenciaVisitas: true,
};

const ProprietarioController = {

  // GET /api/cadastro/proprietarios
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;

      const where = { userType: 'PROPRIETARIO' };
      if (ativo !== undefined) where.ativo = ativo === 'true';

      if (busca?.trim()) {
        where.OR = [
          { fullName: { contains: busca.trim(), mode: 'insensitive' } },
          { email:    { contains: busca.trim(), mode: 'insensitive' } },
          { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
          { cidade:   { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      // Se o usuário pertencer a uma empresa, filtra só proprietários com animals dessa empresa
      // (Para MVP: sem filtro por empresa — retorna todos os proprietários)

      const proprietarios = await prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        select:  SELECT_PROPRIETARIO,
      });

      res.json({ sucesso: true, dados: proprietarios });
    } catch (err) {
      console.error('Erro ao listar proprietários:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar proprietários' });
    }
  },

  // GET /api/cadastro/proprietarios/:id
  obterPorId: async (req, res) => {
    try {
      const proprietario = await prisma.user.findFirst({
        where:  { id: Number(req.params.id), userType: 'PROPRIETARIO' },
        select: SELECT_PROPRIETARIO,
      });
      if (!proprietario) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });
      res.json({ sucesso: true, dados: proprietario });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar proprietário' });
    }
  },

  // POST /api/cadastro/proprietarios
  criar: async (req, res) => {
    const {
      fullName, email, phone, senha,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!senha)            return res.status(400).json({ sucesso: false, mensagem: 'Senha é obrigatória' });

    try {
      const existente = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existente) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });

      const passwordHash = await bcrypt.hash(senha, 10);
      const criadoPor = req.user?.fullName ?? 'sua clínica';
      const proprietario = await prisma.user.create({
        data: {
          fullName:          fullName.trim(),
          email:             email.trim().toLowerCase(),
          phone:             phone?.trim()       || null,
          role:              'USER',
          userType:          'PROPRIETARIO',
          cep:               cep?.trim()         || null,
          endereco:          endereco?.trim()    || null,
          complemento:       complemento?.trim() || null,
          bairro:            bairro?.trim()      || null,
          cidade:            cidade?.trim()      || null,
          estado:            estado?.trim()      || null,
          cpf:               cpf?.trim()         || null,
          cnpj:              cnpj?.trim()        || null,
          mensalista:        Boolean(mensalista),
          valorAssistencia:  valorAssistencia ? Number(valorAssistencia) : null,
          frequenciaVisitas: frequenciaVisitas ? Number(frequenciaVisitas) : null,
          passwordHash,
          mustChangePassword: true,
          ativo: true,
        },
        select: SELECT_PROPRIETARIO,
      });

      // Envia e-mail de boas-vindas em background (não bloqueia a resposta)
      emailService.enviarBoasVindasProprietario({
        destinatarioEmail: email.trim().toLowerCase(),
        destinatarioNome:  fullName.trim(),
        criadoPorNome:     criadoPor,
        senhaInicial:      senha,
      }).catch(err => console.warn('[ProprietarioController] Falha ao enviar e-mail de boas-vindas:', err?.message));

      res.status(201).json({ sucesso: true, dados: proprietario });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });
      console.error('Erro ao criar proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar proprietário' });
    }
  },

  // PUT /api/cadastro/proprietarios/:id
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      fullName, email, phone, senha, ativo,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, mensalista, valorAssistencia, frequenciaVisitas,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), userType: 'PROPRIETARIO' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const emailNovo = email.trim().toLowerCase();
      if (emailNovo !== existe.email) {
        const duplicado = await prisma.user.findUnique({ where: { email: emailNovo } });
        if (duplicado) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já está em uso' });
      }

      const data = {
        fullName:         fullName.trim(),
        email:            emailNovo,
        phone:            phone?.trim()       || null,
        cep:              cep?.trim()         || null,
        endereco:         endereco?.trim()    || null,
        complemento:      complemento?.trim() || null,
        bairro:           bairro?.trim()      || null,
        cidade:           cidade?.trim()      || null,
        estado:           estado?.trim()      || null,
        cpf:              cpf?.trim()         || null,
        cnpj:             cnpj?.trim()        || null,
        mensalista:       mensalista !== undefined ? Boolean(mensalista) : existe.mensalista,
        valorAssistencia: valorAssistencia !== undefined ? (valorAssistencia ? Number(valorAssistencia) : null) : existe.valorAssistencia,
        frequenciaVisitas: frequenciaVisitas !== undefined ? (frequenciaVisitas ? Number(frequenciaVisitas) : null) : existe.frequenciaVisitas,
        ativo:            ativo !== undefined ? Boolean(ativo) : existe.ativo,
      };

      if (senha?.trim()) {
        data.passwordHash = await bcrypt.hash(senha.trim(), 10);
      }

      const proprietario = await prisma.user.update({
        where:  { id: Number(id) },
        data,
        select: SELECT_PROPRIETARIO,
      });
      res.json({ sucesso: true, dados: proprietario });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });
      console.error('Erro ao atualizar proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar proprietário' });
    }
  },

  // PATCH /api/cadastro/proprietarios/:id/toggle
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), userType: 'PROPRIETARIO' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const proprietario = await prisma.user.update({
        where:  { id: Number(id) },
        data:   { ativo: !existe.ativo },
        select: { id: true, fullName: true, ativo: true },
      });
      res.json({ sucesso: true, dados: proprietario, mensagem: `Proprietário ${proprietario.ativo ? 'ativado' : 'inativado'}` });
    } catch (err) {
      console.error('Erro ao alternar status:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },

  // DELETE /api/cadastro/proprietarios/:id  (soft delete)
  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), userType: 'PROPRIETARIO' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      await prisma.user.update({ where: { id: Number(id) }, data: { ativo: false } });
      res.json({ sucesso: true, mensagem: 'Proprietário inativado com sucesso' });
    } catch (err) {
      console.error('Erro ao excluir proprietário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir proprietário' });
    }
  },
};

module.exports = ProprietarioController;
