// backend/src/controllers/FornecedorController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');

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

const normalizarDigitos = v => (v ?? '').replace(/\D/g, '');
const normalizarTexto   = v => (v ?? '').trim().toLowerCase();
const normalizarTipos   = v => (v ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|');

// ─── Helper: verifica duplicidade por CPF ou por nome+tipoServico+telefone ────
// Escopo: mesma visibilidade da listagem (empresaId null = global/SYSTEM, OU empresa alvo)
// excludeId: ignora o próprio registro (usado no update)
// Retorna: { tipo, ativo: boolean, fornecedor } — ativo=true bloqueia; ativo=false avisa (force bypass)
async function verificarDuplicidade({ cpf, nome, tipoServico, telefone, empresaId, excludeId = null }) {
  const candidatos = await prisma.fornecedor.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [{ empresaId: null }, { empresaId: empresaId ?? -1 }],
    },
  });

  const cpfNum = normalizarDigitos(cpf);
  if (cpfNum) {
    const dupAtivo   = candidatos.find(c =>  c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    const dupInativo = candidatos.find(c => !c.ativo && normalizarDigitos(c.cpf) === cpfNum);
    if (dupAtivo)   return { tipo: 'cpf', ativo: true,  fornecedor: dupAtivo };
    if (dupInativo) return { tipo: 'cpf', ativo: false, fornecedor: dupInativo };
  }

  const nomeNorm = normalizarTexto(nome);
  const tipoNorm = normalizarTipos(tipoServico);
  const telNum   = normalizarDigitos(telefone);
  if (nomeNorm && tipoNorm && telNum) {
    const match = c =>
      normalizarTexto(c.nome) === nomeNorm &&
      normalizarTipos(c.tipoServico) === tipoNorm &&
      normalizarDigitos(c.telefone) === telNum;
    const dupAtivo   = candidatos.find(c =>  c.ativo && match(c));
    const dupInativo = candidatos.find(c => !c.ativo && match(c));
    if (dupAtivo)   return { tipo: 'combo', ativo: true,  fornecedor: dupAtivo };
    if (dupInativo) return { tipo: 'combo', ativo: false, fornecedor: dupInativo };
  }

  return null;
}

const MSG_DUPLICADO = {
  cpf:   'Já existe um fornecedor cadastrado com este CPF.',
  combo: 'Já existe um fornecedor cadastrado com o mesmo nome, tipo de serviço e telefone.',
};

function buildMensagemInativo(tipo, f) {
  if (tipo === 'cpf') {
    return `Já existe o fornecedor "${f.nome}" com o CPF ${f.cpf ?? f.cnpj} (inativo).`;
  }
  const contato = [
    f.telefone ? `telefone ${f.telefone}` : null,
    f.email    ? `e-mail ${f.email}`      : null,
  ].filter(Boolean).join(' e ');
  return `Fornecedor "${f.nome}" com ${contato} já existe (inativo).`;
}

const FornecedorController = {

  // GET /api/cadastro/fornecedores?busca=X&ativo=true|false|all
  listar: async (req, res) => {
    try {
      const { busca, ativo } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      // Escopo por empresa/equipe: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
      // + fornecedores da empresa ativa, segregados pela equipe do contexto (igual Animal)
      if (req.user?.role !== 'ADMIN') {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND = [{
          OR: [
            { empresaId: null },
            { empresaId: req.empresaId ?? -1, equipeId: null },
            ...(equipeScope
              ? [{ empresaId: req.empresaId ?? -1, equipeId: { in: equipeScope } }]
              : [{ empresaId: req.empresaId ?? -1 }]),
          ],
        }];
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
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;

    try {
      const dup = await verificarDuplicidade({ cpf, nome, tipoServico, telefone, empresaId: empresaAlvo });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.fornecedor),
          fornecedor: dup.fornecedor,
        });
      }

      const fornecedor = await prisma.fornecedor.create({
        data: {
          // SYSTEM é global; CLIENTE pertence à empresa/equipe ativa do criador
          empresaId:   empresaAlvo,
          equipeId:    equipeAlvo,
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email?.trim() ? email.trim().toLowerCase() : null,
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

  // PUT /api/cadastro/fornecedores/:id — escopado por empresa/equipe (checkPermission na rota)
  atualizar: async (req, res) => {
    const { id } = req.params;
    const {
      nome, cpf, cnpj, telefone, email, tipoServico,
      cep, endereco, complemento, bairro, cidade, estado,
    } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });
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
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este fornecedor.' });

      const dup = await verificarDuplicidade({
        cpf, nome, telefone,
        tipoServico: tipoServico?.trim() || existe.tipoServico,
        empresaId:   existe.empresaId,
        excludeId:   Number(id),
      });
      if (dup) {
        if (dup.ativo) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });
        if (!req.body.force) return res.status(409).json({
          sucesso: false, inativo: true,
          mensagem: buildMensagemInativo(dup.tipo, dup.fornecedor),
          fornecedor: dup.fornecedor,
        });
      }

      const fornecedor = await prisma.fornecedor.update({
        where: { id: Number(id) },
        data: {
          nome:        nome.trim(),
          cpf:         cpf?.trim()         || null,
          cnpj:        cnpj?.trim()        || null,
          telefone:    telefone.trim(),
          email:       email?.trim() ? email.trim().toLowerCase() : null,
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

  // PATCH /api/cadastro/fornecedores/:id/toggle — escopado por empresa/equipe (checkPermission na rota)
  toggleAtivo: async (req, res) => {
    try {
      const existe = await prisma.fornecedor.findUnique({ where: { id: Number(req.params.id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Fornecedor não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este fornecedor.' });

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
