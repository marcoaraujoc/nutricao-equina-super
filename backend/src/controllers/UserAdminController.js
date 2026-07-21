// backend/src/controllers/UserAdminController.js
'use strict';

const bcrypt = require('bcryptjs');

const prisma       = require('../lib/prisma').default;
const emailService = require('../services/emailService');
const { senhaReutilizada, registrarTrocaSenha, MENSAGEM_REUSO: MENSAGEM_SENHA_REUTILIZADA } = require('../services/passwordHistoryService');

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
        select:  {
          ...SELECT_SEGURO,
          membrosEquipe: {
            select: {
              cargo:  true,
              cargos: true,
              equipe: { select: { id: true, nome: true, empresa: { select: { id: true, nome: true } } } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      // Empresas onde o usuário é DONO (gestor mesmo sem MembroEquipe)
      const donos = await prisma.empresa.findMany({
        where:  { ownerId: { in: usuarios.map(u => u.id) } },
        select: { id: true, nome: true, ownerId: true },
      });
      const empresasPorDono = new Map();
      for (const e of donos) {
        if (!empresasPorDono.has(e.ownerId)) empresasPorDono.set(e.ownerId, []);
        empresasPorDono.get(e.ownerId).push(e);
      }

      const dados = usuarios.map(u => {
        // Todos os vínculos do usuário: um por equipe (com todos os cargos)
        const vinculos = u.membrosEquipe.map(m => ({
          cargos:      (m.cargos && m.cargos.length > 0) ? m.cargos : [m.cargo],
          equipeNome:  m.equipe?.nome ?? null,
          empresaId:   m.equipe?.empresa?.id ?? null,
          empresaNome: m.equipe?.empresa?.nome ?? null,
          dono:        false,
        }));
        // Dono de empresa sem vínculo GESTOR registrado nela → entra como GESTOR (dono)
        for (const emp of (empresasPorDono.get(u.id) ?? [])) {
          const jaGestorNaEmpresa = vinculos.some(v => v.empresaId === emp.id && v.cargos.includes('GESTOR'));
          if (!jaGestorNaEmpresa) {
            vinculos.push({ cargos: ['GESTOR'], equipeNome: null, empresaId: emp.id, empresaNome: emp.nome, dono: true });
          } else {
            vinculos.forEach(v => { if (v.empresaId === emp.id && v.cargos.includes('GESTOR')) v.dono = true; });
          }
        }
        return {
          ...u,
          cargoEquipe:   u.membrosEquipe[0]?.cargo                    ?? null,
          equipeNome:    u.membrosEquipe[0]?.equipe?.nome              ?? null,
          empresaNome:   u.membrosEquipe[0]?.equipe?.empresa?.nome     ?? null,
          vinculos,
          membrosEquipe: undefined,
        };
      });
      res.json({ sucesso: true, dados });
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
    if (!phone?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });

    try {
      const existente = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existente) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });

      // Sem senha no payload → aplica a padrão do sistema com troca obrigatória no primeiro acesso
      const SENHA_INICIAL = 'Inicial_001';
      const passwordHash = await bcrypt.hash(senha || SENHA_INICIAL, 10);
      const usuario = await prisma.user.create({
        data: {
          fullName:    fullName.trim(),
          email:       email.trim().toLowerCase(),
          phone:       phone.trim(),
          role:        role                || 'USER',
          userType:    userType            || 'PROPRIETARIO',
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
          passwordHash,
          mustChangePassword: !senha,
          ativo: true,
        },
        select: SELECT_SEGURO,
      });

      // Criado com a senha padrão → e-mail de boas-vindas com os dados de acesso
      if (!senha) {
        emailService.enviarBoasVindasProprietario({
          destinatarioEmail: usuario.email,
          destinatarioNome:  usuario.fullName,
          criadoPorNome:     req.user?.fullName ?? 'a administração',
          senhaInicial:      SENHA_INICIAL,
        }).catch(err => console.warn('[UserAdminController] Falha ao enviar e-mail de boas-vindas:', err?.message));
      }

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
    if (!phone?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });

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

      const novaSenha = senha?.trim();
      if (novaSenha) {
        if (novaSenha.length < 8)            return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 8 caracteres' });
        if (!/[A-Z]/.test(novaSenha))        return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos uma letra maiúscula' });
        if (!/\d/.test(novaSenha))           return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 número' });
        if (!/[^A-Za-z0-9]/.test(novaSenha)) return res.status(400).json({ sucesso: false, mensagem: 'A senha deve ter ao menos 1 caractere especial' });
        if (await senhaReutilizada(existe.id, novaSenha, existe.passwordHash)) {
          return res.status(400).json({ sucesso: false, mensagem: MENSAGEM_SENHA_REUTILIZADA });
        }
        data.passwordHash = await bcrypt.hash(novaSenha, 10);
      }

      const usuario = await prisma.user.update({
        where:  { id: Number(id) },
        data,
        select: SELECT_SEGURO,
      });
      if (novaSenha) await registrarTrocaSenha(existe.id, existe.passwordHash);
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

      const novoAtivo = !existe.ativo;
      const usuario = await prisma.user.update({
        where:  { id: Number(id) },
        data:   { ativo: novoAtivo, ...(novoAtivo ? {} : { refreshToken: null }) },
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