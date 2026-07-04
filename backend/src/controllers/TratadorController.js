// backend/src/controllers/TratadorController.js
'use strict';

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const { podeAlterarRegistroEscopado } = require('../lib/cadastroScopeAccess');

const normalizarTexto = v => (v ?? '').trim().toLowerCase();

// ─── Helper: verifica duplicidade por nome+localizacaoId, escopado por empresa ────
// Escopo: mesma visibilidade da listagem (empresaId null = global/SYSTEM, OU empresa alvo)
// excludeId: ignora o próprio registro (usado no update)
async function verificarDuplicidade({ nome, localizacaoId, empresaId, excludeId = null }) {
  const nomeNorm = normalizarTexto(nome);
  if (!nomeNorm) return null;

  const candidatos = await prisma.tratador.findMany({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      localizacaoId,
      OR: [{ empresaId: null }, { empresaId: empresaId ?? -1 }],
    },
  });

  const dup = candidatos.find(c => normalizarTexto(c.nome) === nomeNorm);
  return dup ? { tipo: 'nome_local' } : null;
}

const MSG_DUPLICADO = {
  nome_local: 'Já existe um tratador com esse nome neste local',
};

const TratadorController = {

  // GET /api/cadastro/tratadores?busca=X&ativo=true|false|all&localizacaoId=N
  listar: async (req, res) => {
    try {
      const { busca, ativo, localizacaoId } = req.query;
      const where = {};

      if (ativo === 'all') { /* sem filtro */ }
      else if (ativo !== undefined) where.ativo = ativo === 'true';
      else where.ativo = true;

      if (busca?.trim()) {
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { nome:     { contains: busca.trim(), mode: 'insensitive' } },
              { telefone: { contains: busca.trim(), mode: 'insensitive' } },
            ],
          },
        ];
      }

      if (localizacaoId) {
        where.localizacaoId = Number(localizacaoId);
      }

      // Escopo por empresa/equipe: não-ADMIN vê globais (empresaId null = SYSTEM/legado)
      // + tratadores da empresa ativa, segregados pela equipe do contexto (igual Animal)
      if (req.user?.role !== 'ADMIN') {
        const equipeScope = await getEquipeScopeDoUsuario(req.user.id, req.empresaId, req.equipeId);
        where.AND = [
          ...(where.AND ?? []),
          {
            OR: [
              { empresaId: null },
              { empresaId: req.empresaId ?? -1, equipeId: null },
              ...(equipeScope
                ? [{ empresaId: req.empresaId ?? -1, equipeId: { in: equipeScope } }]
                : [{ empresaId: req.empresaId ?? -1 }]),
            ],
          },
        ];
      }

      const tratadores = await prisma.tratador.findMany({
        where,
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
        orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
      });

      res.json({ sucesso: true, dados: tratadores });
    } catch (err) {
      console.error('Erro ao listar tratadores:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar tratadores' });
    }
  },

  // GET /api/cadastro/tratadores/:id
  obterPorId: async (req, res) => {
    try {
      const tratador = await prisma.tratador.findUnique({
        where: { id: Number(req.params.id) },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      if (!tratador) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao buscar tratador' });
    }
  },

  // POST /api/cadastro/tratadores
  // ADMIN cria com tipoEntrada=SYSTEM; demais criam com tipoEntrada=CLIENTE, escopado à empresa/equipe ativa
  criar: async (req, res) => {
    const { nome, telefone, localizacaoId } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

    const tipoEntrada = req.user?.role === 'ADMIN' ? 'SYSTEM' : 'CLIENTE';
    const empresaAlvo = tipoEntrada === 'CLIENTE' ? (req.empresaId ?? null) : null;
    const equipeAlvo  = tipoEntrada === 'CLIENTE' ? (req.equipeId ?? null)  : null;
    const locId = localizacaoId ? Number(localizacaoId) : null;

    try {
      const dup = await verificarDuplicidade({ nome, localizacaoId: locId, empresaId: empresaAlvo });
      if (dup) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });

      const tratador = await prisma.tratador.create({
        data: {
          nome:          nome.trim(),
          telefone:      telefone?.trim() || null,
          localizacaoId: locId,
          tipoEntrada,
          empresaId:     empresaAlvo,
          equipeId:      equipeAlvo,
        },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      res.status(201).json({ sucesso: true, dados: tratador });
    } catch (err) {
      console.error('Erro ao criar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar tratador' });
    }
  },

  // PUT /api/cadastro/tratadores/:id — escopado por empresa/equipe (checkPermission na rota)
  atualizar: async (req, res) => {
    const { id } = req.params;
    const { nome, telefone, localizacaoId } = req.body;

    if (!nome?.trim())
      return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

    const locId = localizacaoId !== undefined ? (localizacaoId ? Number(localizacaoId) : null) : undefined;

    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este tratador.' });

      const locIdParaCheck = locId !== undefined ? locId : existe.localizacaoId;
      const dup = await verificarDuplicidade({
        nome, localizacaoId: locIdParaCheck, empresaId: existe.empresaId, excludeId: Number(id),
      });
      if (dup) return res.status(409).json({ sucesso: false, mensagem: MSG_DUPLICADO[dup.tipo] });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data: {
          nome:     nome.trim(),
          telefone: telefone?.trim() || null,
          ...(locId !== undefined && { localizacaoId: locId }),
        },
        include: {
          localizacao: { select: { id: true, nome: true, tipoLocalizacao: true } },
        },
      });
      res.json({ sucesso: true, dados: tratador });
    } catch (err) {
      if (err.code === 'P2025')
        return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      console.error('Erro ao atualizar tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao atualizar tratador' });
    }
  },

  // PATCH /api/cadastro/tratadores/:id/toggle — escopado por empresa/equipe (checkPermission na rota)
  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.tratador.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Tratador não encontrado' });
      if (!podeAlterarRegistroEscopado(existe, req))
        return res.status(403).json({ sucesso: false, mensagem: 'Você não tem acesso para alterar este tratador.' });

      const tratador = await prisma.tratador.update({
        where: { id: Number(id) },
        data:  { ativo: !existe.ativo },
      });
      res.json({
        sucesso:  true,
        dados:    tratador,
        mensagem: `Tratador ${tratador.ativo ? 'ativado' : 'inativado'} com sucesso`,
      });
    } catch (err) {
      console.error('Erro ao alternar status do tratador:', err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao alternar status' });
    }
  },
};

module.exports = TratadorController;
