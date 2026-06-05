// backend/src/controllers/FornecedorController.js
'use strict';

const bcrypt = require('bcryptjs');
const prisma  = require('../lib/prisma').default;

const SELECT_FORNECEDOR = {
  id: true, fullName: true, email: true, phone: true,
  role: true, userType: true, ativo: true, createdAt: true,
  cep: true, endereco: true, complemento: true, bairro: true, cidade: true, estado: true,
  cpf: true, cnpj: true,
  // Campos customizados reutilizando campos extras do User
  // tipoFornecedor → armazenado em categoriaAnimal (alias)
  // tipoServico    → armazenado em localTrabalho via AuditLog não — usamos campo isConvidado+frequenciaVisitas=null
  // Por ora usamos um campo genérico; em produção criar migration dedicada
};

const FornecedorController = {

  // GET /api/cadastro/fornecedores
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = { userType: 'FORNECEDOR' };

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.OR = [
          { fullName: { contains: busca.trim(), mode: 'insensitive' } },
          { email:    { contains: busca.trim(), mode: 'insensitive' } },
          { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      const fornecedores = await prisma.user.findMany({
        where,
        orderBy: { fullName: 'asc' },
        select:  SELECT_FORNECEDOR,
      });

      res.json({ sucesso: true, dados: fornecedores });
    } catch (err) {
      console.error('Erro ao listar fornecedores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar fornecedores' });
    }
  },

  // GET /api/cadastro/fornecedores/:id
  obterPorId: async (req, res) => {
    try {
      const f = await prisma.user.findFirst({
        where:  { id: Number(req.params.id), userType: 'FORNECEDOR' },
        select: SELECT_FORNECEDOR,
      });
      if (!f) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      res.json({ sucesso: true, dados: f });
    } catch {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar fornecedor' });
    }
  },

  // POST /api/cadastro/fornecedores
  criar: async (req, res) => {
    const {
      fullName, email, phone, senha,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, tipoFornecedor, tipoServico,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!tipoFornecedor)   return res.status(400).json({ sucesso: false, mensagem: 'Tipo de fornecedor é obrigatório' });

    try {
      const existente = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (existente) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });

      // Gera senha aleatória se não fornecida
      const senhaReal   = senha?.trim() || Math.random().toString(36).slice(-8) + 'A1!';
      const passwordHash = await bcrypt.hash(senhaReal, 10);

      // tipoFornecedor armazenado em frequenciaVisitas: 1=MEDICAMENTO, 2=PRESTACAO_SERVICO, 3=ALMOXARIFADO
      // tipoServico (quando PRESTACAO) armazenado em complemento
      const tipoMap = { MEDICAMENTO: 1, PRESTACAO_SERVICO: 2, ALMOXARIFADO: 3 };

      const fornecedor = await prisma.user.create({
        data: {
          fullName:          fullName.trim(),
          email:             email.trim().toLowerCase(),
          phone:             phone?.trim()       || null,
          role:              'USER',
          userType:          'FORNECEDOR',
          cep:               cep?.trim()         || null,
          endereco:          endereco?.trim()    || null,
          complemento:       tipoServico?.trim() ? tipoServico.trim() : (complemento?.trim() || null),
          bairro:            bairro?.trim()      || null,
          cidade:            cidade?.trim()      || null,
          estado:            estado?.trim()      || null,
          cpf:               cpf?.trim()         || null,
          cnpj:              cnpj?.trim()        || null,
          frequenciaVisitas: tipoMap[tipoFornecedor] ?? null,
          passwordHash,
          ativo: true,
        },
        select: SELECT_FORNECEDOR,
      });
      res.status(201).json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'E-mail já cadastrado' });
      console.error('Erro ao criar fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar fornecedor' });
    }
  },

  // PUT /api/cadastro/fornecedores/:id
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      fullName, email, phone, ativo,
      cep, endereco, complemento, bairro, cidade, estado,
      cpf, cnpj, tipoFornecedor, tipoServico,
    } = req.body;

    if (!fullName?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())    return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });

    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(id), userType: 'FORNECEDOR' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });

      const emailNovo = email.trim().toLowerCase();
      if (emailNovo !== existe.email) {
        const dup = await prisma.user.findUnique({ where: { email: emailNovo } });
        if (dup) return res.status(409).json({ sucesso: false, mensagem: 'E-mail já está em uso' });
      }

      const tipoMap = { MEDICAMENTO: 1, PRESTACAO_SERVICO: 2, ALMOXARIFADO: 3 };

      const fornecedor = await prisma.user.update({
        where: { id: Number(id) },
        data: {
          fullName:          fullName.trim(),
          email:             emailNovo,
          phone:             phone?.trim()       || null,
          cep:               cep?.trim()         || null,
          endereco:          endereco?.trim()    || null,
          complemento:       tipoServico?.trim() ? tipoServico.trim() : (complemento?.trim() || null),
          bairro:            bairro?.trim()      || null,
          cidade:            cidade?.trim()      || null,
          estado:            estado?.trim()      || null,
          cpf:               cpf?.trim()         || null,
          cnpj:              cnpj?.trim()        || null,
          frequenciaVisitas: tipoFornecedor ? (tipoMap[tipoFornecedor] ?? null) : existe.frequenciaVisitas,
          ativo:             ativo !== undefined ? Boolean(ativo) : existe.ativo,
        },
        select: SELECT_FORNECEDOR,
      });
      res.json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ sucesso: false, mensagem: 'E-mail já está em uso' });
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar fornecedor' });
    }
  },

  // PATCH /api/cadastro/fornecedores/:id/toggle
  toggleAtivo: async (req, res) => {
    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(req.params.id), userType: 'FORNECEDOR' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      const f = await prisma.user.update({ where: { id: Number(req.params.id) }, data: { ativo: !existe.ativo }, select: SELECT_FORNECEDOR });
      res.json({ sucesso: true, dados: f });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },

  // DELETE /api/cadastro/fornecedores/:id
  excluir: async (req, res) => {
    try {
      const existe = await prisma.user.findFirst({ where: { id: Number(req.params.id), userType: 'FORNECEDOR' } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      await prisma.user.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
      res.json({ sucesso: true, mensagem: 'Fornecedor inativado' });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao inativar fornecedor' });
    }
  },
};

module.exports = FornecedorController;
