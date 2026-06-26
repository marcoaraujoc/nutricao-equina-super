// backend/src/controllers/FornecedorController.js
'use strict';

const prisma = require('../lib/prisma').default;

const TIPOS_SERVICO_VALIDOS = [
  'Cardiologista',
  'Dermatologista',
  'Farmácia',
  'Ferrador',
  'Fisioterapeuta',
  'Laboratório',
  'Loja',
  'Quiroprata',
  'Radiologista',
];

const FornecedorController = {

  // GET /api/cadastro/fornecedores?busca=X&ativo=true|false|all
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      // Escopo por empresa: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
      // + fornecedores da empresa ativa (seletor de empresa)
      if (req.user?.role !== 'ADMIN') {
        where.AND = [{ OR: [{ empresaId: null }, { empresaId: req.empresaId ?? -1 }] }];
      }

      if (busca?.trim()) {
        where.OR = [
          { nome:     { contains: busca.trim(), mode: 'insensitive' } },
          { cpf:      { contains: busca.trim(), mode: 'insensitive' } },
          { cnpj:     { contains: busca.trim(), mode: 'insensitive' } },
          { telefone: { contains: busca.trim(), mode: 'insensitive' } },
          { email:    { contains: busca.trim(), mode: 'insensitive' } },
        ];
      }

      const fornecedores = await prisma.fornecedor.findMany({
        where,
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      res.json({ sucesso: true, dados: fornecedores });
    } catch (err) {
      console.error('Erro ao listar fornecedores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar fornecedores' });
    }
  },

  // GET /api/cadastro/fornecedores/tipos
  listarTipos: async (req, res) => {
    res.json({ sucesso: true, dados: TIPOS_SERVICO_VALIDOS });
  },

  // GET /api/cadastro/fornecedores/:id
  obterPorId: async (req, res) => {
    try {
      const fornecedor = await prisma.fornecedor.findUnique({
        where: { id: Number(req.params.id) },
      });
      if (!fornecedor) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      res.json({ sucesso: true, dados: fornecedor });
    } catch {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar fornecedor' });
    }
  },

  // POST /api/cadastro/fornecedores
  // ADMIN → tipoEntrada=SYSTEM; demais → tipoEntrada=CLIENTE
  criar: async (req, res) => {
    const {
      nome, cpf, cnpj, telefone, email, tipoServico,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (!tipoServico?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço é obrigatório' });
    const tiposEnviados = tipoServico.split(',').map(t => t.trim()).filter(Boolean);
    if (tiposEnviados.length === 0)
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço é obrigatório' });
    if (!tiposEnviados.every(t => TIPOS_SERVICO_VALIDOS.includes(t)))
      return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço inválido' });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';

    try {
      const fornecedor = await prisma.fornecedor.create({
        data: {
          // SYSTEM é global; CLIENTE pertence à empresa ativa do criador
          empresaId:   tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null,
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email.trim().toLowerCase(),
          tipoServico: tipoServico.trim(),
          tipoEntrada,
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
        },
      });
      res.status(201).json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      console.error('Erro ao criar fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar fornecedor' });
    }
  },

  // PUT /api/cadastro/fornecedores/:id — apenas ADMIN
  atualizar: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode editar fornecedores diretamente' });

    const { id } = req.params;
    const {
      nome, cpf, cnpj, telefone, email, tipoServico,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
    if (!email?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'E-mail é obrigatório' });
    if (!telefone?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Telefone é obrigatório' });
    if (tipoServico) {
      const tiposEnviados = tipoServico.split(',').map(t => t.trim()).filter(Boolean);
      if (!tiposEnviados.every(t => TIPOS_SERVICO_VALIDOS.includes(t)))
        return res.status(400).json({ sucesso: false, mensagem: 'Tipo de serviço inválido' });
    }

    try {
      const existe = await prisma.fornecedor.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });

      const fornecedor = await prisma.fornecedor.update({
        where: { id: Number(id) },
        data: {
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email.trim().toLowerCase(),
          tipoServico: tipoServico?.trim() || existe.tipoServico,
          cep:         cep?.trim()         || null,
          endereco:    endereco?.trim()    || null,
          complemento: complemento?.trim() || null,
          bairro:      bairro?.trim()      || null,
          cidade:      cidade?.trim()      || null,
          estado:      estado?.trim()      || null,
        },
      });
      res.json({ sucesso: true, dados: fornecedor });
    } catch (err) {
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      console.error('Erro ao atualizar fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar fornecedor' });
    }
  },

  // PATCH /api/cadastro/fornecedores/:id/toggle — apenas ADMIN
  toggleAtivo: async (req, res) => {
    if (req.user?.role !== 'ADMIN')
      return res.status(403).json({ sucesso: false, mensagem: 'Apenas ADMIN pode ativar/inativar fornecedores' });

    try {
      const existe = await prisma.fornecedor.findUnique({ where: { id: Number(req.params.id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });

      const fornecedor = await prisma.fornecedor.update({
        where: { id: Number(req.params.id) },
        data:  { ativo: !existe.ativo },
      });
      res.json({
        sucesso:  true,
        dados:    fornecedor,
        mensagem: `Fornecedor ${fornecedor.ativo ? 'ativado' : 'inativado'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status do fornecedor:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = FornecedorController;
module.exports.TIPOS_SERVICO_VALIDOS = TIPOS_SERVICO_VALIDOS;
