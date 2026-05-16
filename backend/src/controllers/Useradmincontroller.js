// backend/src/controllers/UserAdminController.js
'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Campos seguros para retornar — nunca expor passwordHash, tokens
const SELECT_SEGURO = {
  id: true, fullName: true, email: true, phone: true,
  role: true, userType: true, ativo: true, createdAt: true,
  cep: true, endereco: true, complemento: true,
  bairro: true, cidade: true, estado: true,
};

const UserAdminController = {

  // GET /api/users
  listar: async (req, res) => {
    try {
      const usuarios = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select:  SELECT_SEGURO,
      });
      res.json({ sucesso: true, dados: usuarios });
    } catch (err) {
      console.error('Erro ao listar usuários:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar usuários' });
    }
  },

  // GET /api/users/:id
  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const usuario = await prisma.user.findUnique({
        where:  { id: Number(id) },
        select: SELECT_SEGURO,
      });
      if (!usuario) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      res.json({ sucesso: true, dados: usuario });
    } catch (err) {
      console.error('Erro ao buscar usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar usuário' });
    }
  },

  // POST /api/users
  criar: async (req, res) => {
    const {
      fullName, email, phone, role, userType, senha,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!senha)            return res.status(400).json({ sucesso: false, mensagem: 'Senha é obrigatória' });

    try {
      const existente = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existente) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });

      const passwordHash = await bcrypt.hash(senha, 10);
      const usuario = await prisma.user.create({
        data: {
          fullName:    fullName.trim(),
          email:       email.trim().toLowerCase(),
          phone:       phone?.trim()       || null,
          role:        role                || 'USER',
          userType:    userType            || 'PROPRIETARIO',
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
          passwordHash,
          ativo: true,
        },
        select: SELECT_SEGURO,
      });
      res.status(201).json({ sucesso: true, dados: usuario });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });
      console.error('Erro ao criar usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar usuário' });
    }
  },

  // PUT /api/users/:id
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      fullName, email, phone, role, userType, senha, ativo,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });

    try {
      const existe = await prisma.user.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });

      const emailNovo = email.trim().toLowerCase();
      if (emailNovo !== existe.email) {
        const duplicado = await prisma.user.findUnique({ where: { email: emailNovo } });
        if (duplicado) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já está em uso por outro usuário' });
      }

      const data = {
        fullName:    fullName.trim(),
        email:       emailNovo,
        phone:       phone?.trim()       || null,
        role:        role                || existe.role,
        userType:    userType            || existe.userType,
        cep:         cep?.trim()         || null,
        endereco:    endereco?.trim()    || null,
        complemento: complemento?.trim() || null,
        bairro:      bairro?.trim()      || null,
        cidade:      cidade?.trim()      || null,
        estado:      estado?.trim()      || null,
        ativo:       ativo !== undefined ? Boolean(ativo) : existe.ativo,
      };

      if (senha?.trim()) {
        data.passwordHash = await bcrypt.hash(senha.trim(), 10);
      }

      const usuario = await prisma.user.update({
        where:  { id: Number(id) },
        data,
        select: SELECT_SEGURO,
      });
      res.json({ sucesso: true, dados: usuario });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      console.error('Erro ao atualizar usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar usuário' });
    }
  },

  // PATCH /api/users/:id/toggle
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.user.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });

      const usuario = await prisma.user.update({
        where:  { id: Number(id) },
        data:   { ativo: !existe.ativo },
        select: { id: true, fullName: true, ativo: true },
      });
      res.json({
        sucesso: true,
        dados: usuario,
        mensagem: `Usuário ${usuario.ativo ? 'ativado' : 'inativado'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },

  // DELETE /api/users/:id
  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.user.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });

      await prisma.user.delete({ where: { id: Number(id) } });
      res.json({ sucesso: true, mensagem: 'Usuário excluído com sucesso' });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ sucesso: false, mensagem: 'Usuário não encontrado' });
      console.error('Erro ao excluir usuário:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao excluir usuário' });
    }
  },
};

module.exports = UserAdminController;