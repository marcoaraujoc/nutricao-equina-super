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

// Verifica se o proprietário tem animal ativo na empresa (para acesso isolado por empresa)
async function verificarAcessoNaEmpresa(proprietarioId, empresaId) {
  const animal = await prisma.animal.findFirst({
    where: { userId: proprietarioId, empresaId, ativo: true },
    select: { id: true },
  });
  return !!animal;
}

const ProprietarioController = {

  // GET /api/cadastro/proprietarios
  listar: async (req, res) => {
    try {
      const { busca } = req.query;
      const isAdmin   = req.user?.role === 'ADMIN';

      const where = { userType: 'PROPRIETARIO', AND: [] };

      if (!isAdmin) {
        if (!req.empresaId) {
          return res.json({ sucesso: true, dados: [] });
        }
        // Proprietários com animal ativo na empresa OU criados diretamente nela
        where.AND.push({
          OR: [
            { animais:    { some: { empresaId: req.empresaId, ativo: true } } },
            { empresaId:  req.empresaId },
          ],
        });
      }

      if (busca?.trim()) {
        where.AND.push({
          OR: [
            { fullName: { contains: busca.trim(), mode: 'insensitive' } },
            { email:    { contains: busca.trim(), mode: 'insensitive' } },
            { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
            { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
            { cidade:   { contains: busca.trim(), mode: 'insensitive' } },
          ],
        });
      }

      // Remove o AND vazio se não há filtros (ADMIN sem busca)
      if (where.AND.length === 0) delete where.AND;

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
      const isAdmin = req.user?.role === 'ADMIN';
      const proprietario = await prisma.user.findFirst({
        where:  { id: Number(req.params.id), userType: 'PROPRIETARIO' },
        select: SELECT_PROPRIETARIO,
      });
      if (!proprietario) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      if (!isAdmin && req.empresaId) {
        const temAcesso = await verificarAcessoNaEmpresa(proprietario.id, req.empresaId);
        if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado' });
      }

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
    if (!phone?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });

    try {
      const existente = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existente) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });

      // Sem senha no payload → padrão do sistema, com troca obrigatória no primeiro acesso
      const senhaEfetiva = senha || 'Inicial_001';
      const passwordHash = await bcrypt.hash(senhaEfetiva, 10);
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
          ativo:     true,
          empresaId: req.empresaId || null,
        },
        select: SELECT_PROPRIETARIO,
      });

      emailService.enviarBoasVindasProprietario({
        destinatarioEmail: email.trim().toLowerCase(),
        destinatarioNome:  fullName.trim(),
        criadoPorNome:     criadoPor,
        senhaInicial:      senhaEfetiva,
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
      const isAdmin = req.user?.role === 'ADMIN';
      const existe  = await prisma.user.findFirst({ where: { id: Number(id), userType: 'PROPRIETARIO' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      if (!isAdmin && req.empresaId) {
        const temAcesso = await verificarAcessoNaEmpresa(Number(id), req.empresaId);
        if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado' });
      }

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
        ...(isAdmin && ativo !== undefined ? { ativo: Boolean(ativo) } : {}),
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
  // ADMIN: toggle User.ativo global
  // Sócio: não permitido (remover da empresa usa DELETE)
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    const isAdmin = req.user?.role === 'ADMIN';

    if (!isAdmin) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Para remover um proprietário da empresa use o botão "Remover da Empresa"',
      });
    }

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

  // DELETE /api/cadastro/proprietarios/:id
  // Sócio: remove da empresa (inativa animais + clear empresaId)
  // Proprietários NUNCA são excluídos do sistema
  removerDaEmpresa: async (req, res) => {
    const { id } = req.params;
    const isAdmin = req.user?.role === 'ADMIN';

    if (isAdmin) {
      return res.status(403).json({
        sucesso: false,
        mensagem: 'Proprietários não podem ser excluídos do sistema. Use "Inativar" para desativar o acesso.',
      });
    }

    if (!req.empresaId) {
      return res.status(403).json({ sucesso: false, mensagem: 'Operação requer contexto de empresa' });
    }

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), userType: 'PROPRIETARIO' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Proprietário não encontrado' });

      const temAcesso = await verificarAcessoNaEmpresa(Number(id), req.empresaId);
      if (!temAcesso) return res.status(403).json({ sucesso: false, mensagem: 'Este proprietário não pertence à sua empresa' });

      // Inativa todos os animais do proprietário nesta empresa e remove o vínculo empresarial
      const resultado = await prisma.animal.updateMany({
        where: { userId: Number(id), empresaId: req.empresaId },
        data:  { ativo: false, empresaId: null },
      });

      res.json({
        sucesso:  true,
        mensagem: `Proprietário removido da empresa. ${resultado.count} animal(is) inativado(s).`,
        animaisInativados: resultado.count,
      });
    } catch (err) {
      console.error('Erro ao remover proprietário da empresa:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao remover proprietário da empresa' });
    }
  },
};

module.exports = ProprietarioController;
