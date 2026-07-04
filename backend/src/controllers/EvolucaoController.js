// src/controllers/EvolucaoController.js

const prisma = require('../lib/prisma').default;
const fs     = require('fs');
const path   = require('path');
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { formatAtendimentoNum }  = require('../lib/faturaUtils');
const { resolverLogoPorAnimal } = require('../lib/logoEmpresaUtils');
const { PROMPTS }               = require('../ai/prompts');
const { extrairResumoAtendimento } = require('../services/laudoEquinoExtracao.service');
const { pintarLaudoEquino }         = require('../models/anatomia-equina/pintarLaudoEquino');
const { carregarBaseInnerEquino }   = require('../models/anatomia-equina/equinoBaseLoader');

// Versão do prompt de extração — usada para invalidar o cache de resumoIaData
// quando o prompt evoluir (ver ai/prompts/index.js#extrair_resultado_sessao_equino).
const RESUMO_IA_PROMPT_KEY = 'extrair_resultado_sessao_equino';
const RESUMO_IA_VERSAO_ATUAL = `${RESUMO_IA_PROMPT_KEY}@${PROMPTS[RESUMO_IA_PROMPT_KEY].version}`;

// ─────────────────────────────────────────────────────────────────────────────
// INCLUDE PADRÃO — retorna veterinário, modificador e mídias
// ─────────────────────────────────────────────────────────────────────────────

const INCLUDE_PADRAO = {
  veterinario:   { select: { id: true, fullName: true } },
  modificadoPor: { select: { id: true, fullName: true } },
  midias:        { orderBy: { criadoEm: 'asc' } },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — registrar audit log
// ─────────────────────────────────────────────────────────────────────────────

async function registrarAuditoria(userId, userName, email, action) {
  try {
    await prisma.auditLog.create({
      data: { userId, userName, email, action, timestamp: new Date() },
    });
  } catch (err) {
    console.error('Erro ao registrar auditoria:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

const EvolucaoController = {

  // ── Listar evoluções de um animal ────────────────────────────────────────
  // GET /clinica/evolucoes/animal/:animalId
  // Query: page, limit, status, dataInicio, dataFim, responsavelId, busca

  listarPorAnimal: async (req, res) => {
    const { animalId } = req.params;
    const {
      page          = 1,
      limit         = 10,
      status,
      dataInicio,
      dataFim,
      responsavelId,
      busca,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      animalId: Number(animalId),
      ativo:    true,
    };

    if (status)        where.status        = status;
    if (responsavelId) where.veterinarioId = Number(responsavelId);

    if (dataInicio || dataFim) {
      where.dataInicio = {};
      if (dataInicio) where.dataInicio.gte = new Date(dataInicio);
      if (dataFim)    where.dataInicio.lte = new Date(dataFim + 'T23:59:59');
    }

    if (busca?.trim()) {
      where.texto = { contains: busca.trim(), mode: 'insensitive' };
    }

    try {
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const [evolucoes, total] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where,
          skip,
          take:    Number(limit),
          orderBy: { dataInicio: 'desc' },
          include: INCLUDE_PADRAO,
        }),
        prisma.evolucaoClinica.count({ where }),
      ]);

      const dados = evolucoes.map(e => ({
        ...e,
        atendimentoNumero: formatAtendimentoNum(e.tipoAtendimento, e.numero),
      }));

      res.json({ sucesso: true, dados, total });
    } catch (error) {
      console.error('Erro ao listar evoluções:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Listar responsáveis que possuem evoluções para o animal ─────────────
  // GET /clinica/evolucoes/responsaveis/:animalId

  listarResponsaveis: async (req, res) => {
    const { animalId } = req.params;

    try {
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const evolucoes = await prisma.evolucaoClinica.findMany({
        where:    { animalId: Number(animalId), ativo: true },
        select:   { veterinario: { select: { id: true, fullName: true } } },
        distinct: ['veterinarioId'],
      });

      const responsaveis = evolucoes.map(e => e.veterinario);
      res.json({ sucesso: true, dados: responsaveis });
    } catch (error) {
      console.error('Erro ao listar responsáveis:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Obter evolução por ID ────────────────────────────────────────────────
  // GET /clinica/evolucoes/:id

  obterPorId: async (req, res) => {
    const { id } = req.params;

    try {
      const evolucao = await prisma.evolucaoClinica.findUnique({
        where:   { id: Number(id) },
        include: {
          ...INCLUDE_PADRAO,
          animal: { select: { id: true, nome: true } },
        },
      });

      if (!evolucao || !evolucao.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: evolucao.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      res.json({ sucesso: true, dados: evolucao });
    } catch (error) {
      console.error('Erro ao obter evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Criar evolução ────────────────────────────────────────────────────────
  // POST /clinica/evolucoes
  //
  // Regra: não permite criar se já existir uma evolução EM_ANDAMENTO para este animal.

  criar: async (req, res) => {
    const { animalId, especialidade, texto, status = 'EM_ANDAMENTO', agendamentoId } = req.body;
    const userId = req.user.id;

    if (!animalId)      return res.status(400).json({ sucesso: false, mensagem: 'Animal é obrigatório' });
    if (!especialidade) return res.status(400).json({ sucesso: false, mensagem: 'Especialidade é obrigatória' });
    if (!texto?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Texto da evolução é obrigatório' });

    try {
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { id: true, nome: true },
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      // Bloqueia nova evolução se já existe uma em andamento para este animal
      const evolucaoAberta = await prisma.evolucaoClinica.findFirst({
        where: { animalId: Number(animalId), status: 'EM_ANDAMENTO', ativo: true },
        select: { id: true },
      });

      if (evolucaoAberta) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Já existe uma evolução em andamento para este animal. Finalize ou cancele-a antes de criar uma nova.',
          code:     'EVOLUCAO_EM_ANDAMENTO',
        });
      }

      const evolucao = await prisma.$transaction(async (tx) => {
        let numero;
        let tipoAtendimento;
        let agendamentoIdFinal = null;

        if (agendamentoId) {
          // Vinculado a agendamento: herda numero do agendamento e marca como EM_ANDAMENTO
          // (só vira FINALIZADO quando a evolução for finalizada — ver EvolucaoController.atualizar)
          const agendamento = await tx.agendamentoClinico.findFirst({
            where: { id: Number(agendamentoId), animalId: Number(animalId), ativo: true },
            select: { id: true, numero: true, status: true },
          });
          if (!agendamento) {
            throw Object.assign(new Error('Agendamento não encontrado para este animal'), { statusCode: 404, code: 'AGENDAMENTO_NOT_FOUND' });
          }
          if (agendamento.status !== 'AGENDADO') {
            throw Object.assign(new Error('Agendamento já foi iniciado, concluído ou cancelado'), { statusCode: 400, code: 'AGENDAMENTO_INVALIDO' });
          }
          numero = agendamento.numero;
          tipoAtendimento = 'AG';
          agendamentoIdFinal = agendamento.id;

          await tx.agendamentoClinico.update({
            where: { id: agendamento.id },
            data:  { status: 'EM_ANDAMENTO' },
          });
        } else {
          // Autônomo: sequência EV por animal
          const maxResult = await tx.evolucaoClinica.aggregate({
            where: { animalId: Number(animalId), tipoAtendimento: 'EV', ativo: true },
            _max:  { numero: true },
          });
          numero = (maxResult._max.numero ?? 0) + 1;
          tipoAtendimento = 'EV';
        }

        return tx.evolucaoClinica.create({
          data: {
            animalId:        Number(animalId),
            veterinarioId:   userId,
            especialidade,
            texto:           texto.trim(),
            status,
            dataInicio:      new Date(),
            dataFim:         status === 'FINALIZADA' ? new Date() : null,
            aprovado:        true,
            ativo:           true,
            numero,
            tipoAtendimento,
            agendamentoId:   agendamentoIdFinal,
          },
          include: INCLUDE_PADRAO,
        });
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_CRIADA | id=${evolucao.id} | animal=${animalId} | num=${evolucao.tipoAtendimento}-${evolucao.numero} | status=${status}`
      );

      res.status(201).json({
        sucesso: true,
        dados: {
          ...evolucao,
          atendimentoNumero: formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero),
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ sucesso: false, mensagem: error.message, code: error.code });
      }
      console.error('Erro ao criar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Atualizar evolução ────────────────────────────────────────────────────
  // PUT /clinica/evolucoes/:id
  //
  // Regras:
  //  - FINALIZADA e CANCELADA não podem ser editadas
  //  - veterinarioId só muda quando o status muda (quem cria = responsável EM_ANDAMENTO)
  //  - Quem finaliza ou cancela se torna o responsável

  atualizar: async (req, res) => {
    const { id }                            = req.params;
    const { especialidade, texto, status }  = req.body;
    const userId                            = req.user.id;

    try {
      const existente = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
      });

      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Regra de autoria: GESTOR pode editar qualquer registro, mas FORNECEDOR nunca tem
      // bypass de gestor mesmo que req.membroCargo === 'GESTOR' (via bypass de dono de empresa).
      const bypassGestor = req.membroCargo === 'GESTOR' && req.user.userType !== 'FORNECEDOR';
      if (!bypassGestor && Number(existente.veterinarioId) !== Number(userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Você só pode editar evoluções criadas por você.' });
      }

      if (existente.status === 'FINALIZADA') {
        if (!bypassGestor) {
          return res.status(403).json({
            sucesso:  false,
            mensagem: 'Evoluções finalizadas só podem ser editadas por gestores',
          });
        }
      }

      if (existente.status === 'CANCELADA') {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Evoluções canceladas não podem ser editadas',
        });
      }

      // veterinarioId só muda quando o status muda (quem finaliza/cancela = responsável)
      const statusMudou   = status && status !== existente.status;
      const novoVetId     = statusMudou ? userId : existente.veterinarioId;
      const vaiFinalizar  = status === 'FINALIZADA' && existente.status !== 'FINALIZADA';

      const atualizada = await prisma.$transaction(async (tx) => {
        const upd = await tx.evolucaoClinica.update({
          where: { id: Number(id) },
          data: {
            especialidade:   especialidade ?? existente.especialidade,
            texto:           texto?.trim() ?? existente.texto,
            status:          status        ?? existente.status,
            veterinarioId:   novoVetId,
            modificadoPorId: userId,
            dataModificacao: new Date(),
            dataFim: (status === 'FINALIZADA' && !existente.dataFim)
              ? new Date()
              : existente.dataFim,
          },
          include: INCLUDE_PADRAO,
        });

        // Evolução vinculada a um agendamento (AG-XXXX): ao finalizar, o agendamento
        // sai de EM_ANDAMENTO para FINALIZADO (distinto do CONCLUIDO manual, sem evolução).
        if (vaiFinalizar && existente.agendamentoId) {
          await tx.agendamentoClinico.updateMany({
            where: { id: existente.agendamentoId, status: 'EM_ANDAMENTO' },
            data:  { status: 'FINALIZADO' },
          });
        }

        return upd;
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_EDITADA | id=${id} | animal=${existente.animalId} | status=${status ?? existente.status} | responsavelAnterior=${existente.veterinarioId} | responsavelNovo=${novoVetId}`
      );

      res.json({ sucesso: true, dados: atualizada });
    } catch (error) {
      console.error('Erro ao atualizar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Excluir evolução (soft delete) ────────────────────────────────────────
  // DELETE /clinica/evolucoes/:id
  // Body: { justificativa }

  excluir: async (req, res) => {
    const { id }           = req.params;
    const { justificativa } = req.body;
    const userId            = req.user.id;

    if (!justificativa?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Justificativa é obrigatória' });
    }

    try {
      const existente = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
      });

      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Regra de autoria: GESTOR pode excluir qualquer registro, FORNECEDOR só o próprio
      const bypassGestorDel = req.membroCargo === 'GESTOR' && req.user.userType !== 'FORNECEDOR';
      if (!bypassGestorDel && Number(existente.veterinarioId) !== Number(userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Você só pode excluir evoluções criadas por você.' });
      }

      if (existente.status === 'FINALIZADA' && req.user.userType !== 'ADMIN') {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Apenas administradores podem excluir evoluções finalizadas',
        });
      }

      await prisma.$transaction(async (tx) => {
        await tx.evolucaoClinica.update({
          where: { id: Number(id) },
          data: {
            ativo:                 false,
            justificativaExclusao: justificativa.trim(),
            modificadoPorId:       userId,
            dataModificacao:       new Date(),
          },
        });

        // Mesma regra de cancelar(): excluir a evolução libera o agendamento vinculado.
        if (existente.agendamentoId) {
          await tx.agendamentoClinico.updateMany({
            where: { id: existente.agendamentoId, status: { in: ['EM_ANDAMENTO', 'FINALIZADO'] } },
            data:  { status: 'AGENDADO' },
          });
        }
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_EXCLUIDA | id=${id} | animal=${existente.animalId} | justificativa="${justificativa.trim()}"`
      );

      res.json({ sucesso: true, mensagem: 'Evolução removida com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Cancelar evolução (EM_ANDAMENTO ou FINALIZADA) ───────────────────────
  // PATCH /clinica/evolucoes/:id/cancelar
  // Body: { justificativa }

  cancelar: async (req, res) => {
    const { id }             = req.params;
    const { justificativa }  = req.body;
    const userId             = req.user.id;

    if (!justificativa?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Justificativa é obrigatória' });
    }

    try {
      const existente = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
      });

      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      if (existente.status === 'CANCELADA') {
        return res.status(400).json({ sucesso: false, mensagem: 'Evolução já está cancelada' });
      }

      const cancelada = await prisma.$transaction(async (tx) => {
        const upd = await tx.evolucaoClinica.update({
          where: { id: Number(id) },
          data: {
            status:                'CANCELADA',
            veterinarioId:         userId,
            modificadoPorId:       userId,
            dataModificacao:       new Date(),
            justificativaExclusao: justificativa.trim(),
          },
          include: INCLUDE_PADRAO,
        });

        // Evolução vinculada a um agendamento: cancelar libera o agendamento de volta
        // para AGENDADO (permite iniciar de novo), em vez de deixá-lo preso em
        // EM_ANDAMENTO/FINALIZADO sem nenhuma evolução ativa por trás.
        if (existente.agendamentoId) {
          await tx.agendamentoClinico.updateMany({
            where: { id: existente.agendamentoId, status: { in: ['EM_ANDAMENTO', 'FINALIZADO'] } },
            data:  { status: 'AGENDADO' },
          });
        }

        return upd;
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_CANCELADA | id=${id} | animal=${existente.animalId} | statusAnterior=${existente.status} | justificativa="${justificativa.trim()}"`
      );

      res.json({ sucesso: true, dados: cancelada });
    } catch (error) {
      console.error('Erro ao cancelar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Aprovar evolução ──────────────────────────────────────────────────────
  // PATCH /clinica/evolucoes/:id/aprovar

  aprovar: async (req, res) => {
    const { id }  = req.params;
    const userId  = req.user.id;

    try {
      const existente = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
      });

      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Regra: FORNECEDOR só pode finalizar evolução que ele próprio criou
      if (req.user.userType === 'FORNECEDOR' && existente.veterinarioId !== userId) {
        return res.status(403).json({ sucesso: false, mensagem: 'Você só pode finalizar evoluções criadas por você.' });
      }

      if (existente.aprovado) {
        return res.status(400).json({ sucesso: false, mensagem: 'Evolução já está aprovada' });
      }

      const aprovada = await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          aprovado:        true,
          modificadoPorId: userId,
          dataModificacao: new Date(),
        },
        include: INCLUDE_PADRAO,
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_APROVADA | id=${id} | animal=${existente.animalId}`
      );

      res.json({ sucesso: true, dados: aprovada });
    } catch (error) {
      console.error('Erro ao aprovar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Salvar título gerado pela LLM ─────────────────────────────────────────
  // PATCH /clinica/evolucoes/:id/titulo
  // Body: { titulo }

  salvarTitulo: async (req, res) => {
    const { id }    = req.params;
    const { titulo } = req.body;

    if (!titulo?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Título é obrigatório' });
    }

    try {
      const evolucaoParaTitulo = await prisma.evolucaoClinica.findUnique({
        where:  { id: Number(id) },
        select: { animalId: true, ativo: true },
      });
      if (!evolucaoParaTitulo || !evolucaoParaTitulo.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: evolucaoParaTitulo.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data:  { titulo: titulo.trim().substring(0, 255) },
      });
      res.json({ sucesso: true });
    } catch (error) {
      console.error('Erro ao salvar título:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Adicionar mídia a uma evolução ────────────────────────────────────────
  // POST /clinica/evolucoes/:id/midias
  // multipart/form-data: midia (arquivo), tipo (IMAGEM|VIDEO|AUDIO)

  adicionarMidia: async (req, res) => {
    const { id }   = req.params;
    const { tipo } = req.body;
    const file     = req.file;

    if (!file) {
      return res.status(400).json({ sucesso: false, mensagem: 'Arquivo é obrigatório' });
    }

    const tiposValidos = ['IMAGEM', 'VIDEO', 'AUDIO'];
    const tipoFinal    = tipo && tiposValidos.includes(tipo.toUpperCase())
      ? tipo.toUpperCase()
      : derivarTipo(file.mimetype);

    try {
      const evolucao = await prisma.evolucaoClinica.findUnique({
        where:  { id: Number(id) },
        select: { id: true, ativo: true, animalId: true },
      });

      if (!evolucao || !evolucao.ativo) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: evolucao.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso) {
        fs.unlink(file.path, () => {});
        return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      }

      const midia = await prisma.evolucaoMidia.create({
        data: {
          evolucaoId: Number(id),
          tipo:       tipoFinal,
          url:        `/uploads/evolucoes/${file.filename}`,
          nome:       file.originalname,
          tamanho:    file.size,
        },
      });

      res.status(201).json({ sucesso: true, dados: midia });
    } catch (error) {
      fs.unlink(file.path, () => {});
      console.error('Erro ao adicionar mídia:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Remover mídia de uma evolução ─────────────────────────────────────────
  // DELETE /clinica/evolucoes/:evolucaoId/midias/:midiaId

  removerMidia: async (req, res) => {
    const { midiaId } = req.params;

    try {
      const midia = await prisma.evolucaoMidia.findUnique({
        where: { id: Number(midiaId) },
      });

      if (!midia) {
        return res.status(404).json({ sucesso: false, mensagem: 'Mídia não encontrada' });
      }

      const evolucaoParaMidia = await prisma.evolucaoClinica.findUnique({
        where:  { id: midia.evolucaoId },
        select: { animalId: true },
      });
      if (evolucaoParaMidia) {
        const acesso = await verificarAcessoAnimal({ animalId: evolucaoParaMidia.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
        if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      }

      // Remove arquivo físico (caminho relativo ao backend)
      const filePath = path.join(__dirname, '../../', midia.url);
      fs.unlink(filePath, () => {});

      await prisma.evolucaoMidia.delete({ where: { id: Number(midiaId) } });

      res.json({ sucesso: true });
    } catch (error) {
      console.error('Erro ao remover mídia:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Interpretar texto com LLM (Groq) ──────────────────────────────────────
  // Rota inline em evolucao.js — usa clinicaLLMService
  // Este método é mantido como fallback mas não está em uso direto no router

  interpretar: async (req, res) => {
    const { texto } = req.body;
    if (!texto?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Texto é obrigatório' });
    }
    res.status(501).json({ sucesso: false, mensagem: 'Use a rota POST /interpretar do router' });
  },

  // ── Transcrever áudio com Groq Whisper ────────────────────────────────────
  // POST /clinica/evolucoes/transcrever
  // multipart/form-data: audio (arquivo)

  transcrever: async (req, res) => {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ sucesso: false, mensagem: 'Arquivo de áudio obrigatório' });
    }

    const inicio = Date.now();

    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const transcription = await groq.audio.transcriptions.create({
        file:     fs.createReadStream(req.file.path),
        model:    'whisper-large-v3',
        language: 'pt',
      });

      const latencia = Date.now() - inicio;
      const texto    = transcription.text?.trim() ?? '';

      try { fs.unlinkSync(req.file.path); } catch {}

      try {
        await prisma.aiUsageLog.create({
          data: {
            operacao:      'TRANSCRICAO_AUDIO',
            modelo:        'whisper-large-v3',
            provedor:      'groq',
            tokensEntrada: 0,
            tokensSaida:   0,
            tokensTotal:   0,
            custoUsd:      0.0,
            latenciaMs:    latencia,
            userId:        userId,
            sucesso:       true,
          },
        });
      } catch (logErr) {
        console.error('Erro ao registrar AI log:', logErr);
      }

      res.json({ sucesso: true, dados: { texto } });
    } catch (error) {
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      console.error('Erro ao transcrever áudio:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro na transcrição do áudio' });
    }
  },

  // ── Relatório comparativo de atendimento (body-map + scores vs. sessão anterior) ──
  // GET /clinica/evolucoes/:id/relatorio-atendimento

  relatorioAtendimento: async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      const atual = await prisma.evolucaoClinica.findUnique({
        where: { id: Number(id) },
        include: {
          ...INCLUDE_PADRAO,
          animal: {
            select: {
              id: true, nome: true, dataNascimento: true, idadeAnos: true, peso: true,
              sexo: true, tipoExercicio: true, photoUrl: true,
              especie: { select: { nome: true } },
              raca:    { select: { nome: true } },
              user:    { select: { id: true, fullName: true } },
            },
          },
        },
      });

      if (!atual || !atual.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: atual.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Evolução imediatamente anterior do animal, INDEPENDENTE da especialidade —
      // o comparativo é sempre contra o último atendimento registrado, mesmo que
      // tenha sido de outra especialidade (a tag do relatório informa qual foi).
      const anterior = await prisma.evolucaoClinica.findFirst({
        where: {
          animalId:   atual.animalId,
          ativo:      true,
          id:         { not: atual.id },
          dataInicio: { lt: atual.dataInicio },
        },
        orderBy: { dataInicio: 'desc' },
        include: INCLUDE_PADRAO,
      });

      const [resumoAtual, resumoAnterior] = await Promise.all([
        garantirResumoIa(atual, userId),
        anterior ? garantirResumoIa(anterior, userId) : Promise.resolve(null),
      ]);

      const baseInner = carregarBaseInnerEquino();
      const svgAtual = pintarLaudoEquino({
        registros: resumoAtual.registros,
        baseInner,
        titulo:    atual.titulo || `Evolução ${formatAtendimentoNum(atual.tipoAtendimento, atual.numero)}`,
        completo:  resumoAtual.completo,
      });
      const svgAnterior = anterior
        ? pintarLaudoEquino({
            registros: resumoAnterior.registros,
            baseInner,
            titulo:    anterior.titulo || `Evolução ${formatAtendimentoNum(anterior.tipoAtendimento, anterior.numero)}`,
            completo:  resumoAnterior.completo,
          })
        : null;

      const logoUrl = await resolverLogoPorAnimal(atual.animalId);

      res.json({
        sucesso: true,
        dados: {
          animal:  atual.animal,
          logoUrl,
          atual: {
            id:                atual.id,
            especialidade:     atual.especialidade,
            titulo:            atual.titulo,
            texto:             atual.texto,
            dataInicio:        atual.dataInicio,
            veterinario:       atual.veterinario,
            atendimentoNumero: formatAtendimentoNum(atual.tipoAtendimento, atual.numero),
            resumoClinico:     resumoAtual.resumoClinico ?? null,
            avisos:            resumoAtual.avisos ?? [],
            completo:          resumoAtual.completo,
            svgColuna:         svgAtual,
          },
          anterior: anterior ? {
            id:                anterior.id,
            especialidade:     anterior.especialidade,
            titulo:            anterior.titulo,
            dataInicio:        anterior.dataInicio,
            atendimentoNumero: formatAtendimentoNum(anterior.tipoAtendimento, anterior.numero),
            resumoClinico:     resumoAnterior.resumoClinico ?? null,
            svgColuna:         svgAnterior,
          } : null,
        },
      });
    } catch (error) {
      console.error('Erro ao gerar relatório de atendimento:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS PRIVADOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retorna o ResumoAtendimento cacheado em `resumoIaData` se ainda válido para a
 * versão atual do prompt; caso contrário, extrai via IA e persiste o cache.
 * Nunca lança — extrairResumoAtendimento já degrada graciosamente.
 */
async function garantirResumoIa(evolucao, userId) {
  if (evolucao.resumoIaData && evolucao.resumoIaVersao === RESUMO_IA_VERSAO_ATUAL) {
    return evolucao.resumoIaData;
  }

  const resultado = await extrairResumoAtendimento({
    texto:    evolucao.texto,
    userId,
    animalId: evolucao.animalId,
  });

  try {
    await prisma.evolucaoClinica.update({
      where: { id: evolucao.id },
      data: {
        resumoIaData:   resultado,
        resumoIaVersao: resultado.meta?.promptVersao ?? RESUMO_IA_VERSAO_ATUAL,
      },
    });
  } catch (err) {
    console.error('[EvolucaoController.garantirResumoIa] falha ao cachear resumoIaData:', err);
  }

  return resultado;
}

function derivarTipo(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'IMAGEM';
  if (mimetype.startsWith('video/')) return 'VIDEO';
  if (mimetype.startsWith('audio/')) return 'AUDIO';
  return 'IMAGEM';
}

module.exports = EvolucaoController;