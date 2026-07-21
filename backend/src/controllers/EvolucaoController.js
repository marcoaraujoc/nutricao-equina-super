// src/controllers/EvolucaoController.js

const prisma = require('../lib/prisma').default;
const { Prisma } = require('@prisma/client');
const fs     = require('fs');
const path   = require('path');
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoEvolucaoWhere }   = require('../lib/clinicalScope');
const { formatAtendimentoNum, lancarExameNaFatura } = require('../lib/faturaUtils');
const { resolverLogoPorAnimal } = require('../lib/logoEmpresaUtils');
const { transcodeParaMp3, EXTS_INCOMPATIVEIS_SAFARI } = require('../lib/audioTranscode');
const { PROMPTS }               = require('../ai/prompts');
const { extrairResumoAtendimento } = require('../services/laudoEquinoExtracao.service');
const { interpretarEvolucao }      = require('../services/clinicaLLMService');
const { pintarLaudoEquino }         = require('../models/anatomia-equina/pintarLaudoEquino');
const { carregarBaseInnerEquino }   = require('../models/anatomia-equina/equinoBaseLoader');
const { pintarLaudoCasco, pintarLaudoDental } = require('../models/pintarLaudoRaster');

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

// Auditoria central estruturada (exclusões/cancelamentos) — lib/auditoria.js
const { registrarAuditoria: auditoriaCentral } = require('../lib/auditoria');
// Autoria via RBAC (req.permissaoNivel): PROPRIO = só registros próprios;
// EQUIPE/FULL = qualquer registro da equipe. Nenhuma checagem de cargo/userType aqui.
const { podeOperarRegistro, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');

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

      // Segregação multi-clínica: cada empresa vê só as próprias evoluções do animal
      where.AND = [escopoEvolucaoWhere(req)];

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
        where:    { animalId: Number(animalId), ativo: true, AND: [escopoEvolucaoWhere(req)] },
        select:   { veterinario: { select: { id: true, fullName: true } } },
        distinct: ['veterinarioId'],
      });

      // filter(Boolean): evolução com autor removido tem veterinario null
      const responsaveis = evolucoes.map(e => e.veterinario).filter(Boolean);
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

      // Segregação multi-clínica: evolução de outra empresa/equipe não é visível
      const escopo = escopoEvolucaoWhere(req);
      if (Object.keys(escopo).length > 0) {
        const visivel =
          (req.empresaId && evolucao.empresaId === Number(req.empresaId)) ||
          evolucao.veterinarioId === Number(req.user.id);
        if (!visivel) {
          return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este registro' });
        }
      }

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

      // Título via IA gerado ANTES de criar e gravado na MESMA escrita (não um PATCH
      // separado depois) — assim a evolução já nasce com título, sem depender de uma
      // segunda chamada à IA no frontend. `acoes` (sugestões de encaminhamento) volta
      // na resposta para o modal do frontend, sem persistir aqui.
      let tituloIA = null;
      let acoesIA  = [];
      const resultadoIA = await interpretarEvolucao(texto.trim(), userId, Number(animalId)).catch(() => null);
      if (resultadoIA) {
        tituloIA = resultadoIA.titulo?.trim()?.substring(0, 255) || null;
        acoesIA  = resultadoIA.acoes ?? [];
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
            titulo:          tituloIA,
            status,
            dataInicio:      new Date(),
            dataFim:         status === 'FINALIZADA' ? new Date() : null,
            aprovado:        true,
            ativo:           true,
            numero,
            tipoAtendimento,
            agendamentoId:   agendamentoIdFinal,
            // Tenancy: contexto ativo do autor — segrega o histórico entre as
            // clínicas/equipes que atendem o mesmo animal (multi-vet)
            empresaId:       req.empresaId ?? null,
            equipeId:        req.equipeId  ?? null,
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
        acoesIA,
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

      // Autoria dirigida pela matriz RBAC (nível efetivo em atendimento.evolucoes.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer registro da equipe.
      if (!podeOperarRegistro(req.permissaoNivel, existente.veterinarioId, userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Seu nível de permissão só permite editar evoluções criadas por você.' });
      }

      // Editar registro FINALIZADO exige nível FULL no editar (gestor tem FULL por
      // bypass; a matriz pode conceder FULL a outros perfis).
      if (existente.status === 'FINALIZADA' && (NIVEL_ORDINAL[req.permissaoNivel] ?? 0) < NIVEL_ORDINAL.FULL) {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Editar evoluções finalizadas exige nível FULL na permissão de alterar evoluções.',
        });
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

      // Texto alterado → o mapa corporal do relatório fica desatualizado:
      // invalida o cache de extração IA para regenerar na próxima impressão.
      const textoMudou   = texto != null && texto.trim() !== existente.texto;
      const textoEfetivo = texto?.trim() ?? existente.texto;

      // Título via IA gerado ANTES de salvar e gravado na MESMA escrita — só quando
      // ainda não existe título (evita reprocessar a cada "Salvar" de um rascunho já
      // titulado, e nunca sobrescreve um título definido manualmente via PATCH /titulo).
      // `acoes` (sugestões de encaminhamento) volta na resposta, sem persistir aqui.
      let tituloParaSalvar = existente.titulo;
      let acoesIA = [];
      if (!existente.titulo?.trim() && textoEfetivo?.trim()) {
        const resultadoIA = await interpretarEvolucao(textoEfetivo, userId, existente.animalId).catch(() => null);
        if (resultadoIA) {
          tituloParaSalvar = resultadoIA.titulo?.trim()?.substring(0, 255) || null;
          acoesIA = resultadoIA.acoes ?? [];
        }
      }

      const atualizada = await prisma.$transaction(async (tx) => {
        const upd = await tx.evolucaoClinica.update({
          where: { id: Number(id) },
          data: {
            especialidade:   especialidade ?? existente.especialidade,
            texto:           textoEfetivo,
            titulo:          tituloParaSalvar,
            status:          status        ?? existente.status,
            veterinarioId:   novoVetId,
            modificadoPorId: userId,
            dataModificacao: new Date(),
            dataFim: (status === 'FINALIZADA' && !existente.dataFim)
              ? new Date()
              : existente.dataFim,
            ...(textoMudou ? { resumoIaData: Prisma.DbNull, resumoIaVersao: null } : {}),
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

      res.json({ sucesso: true, dados: atualizada, acoesIA });

      // Ao FINALIZAR a evolução, lança os exames dela na fatura com VALOR ZERADO
      // (idempotente — o financeiro define o preço depois). Fire-and-forget: não
      // bloqueia nem falha a finalização da evolução.
      if (vaiFinalizar) {
        setImmediate(async () => {
          try {
            const exames = await prisma.exameClinico.findMany({
              where:  { evolucaoId: Number(id), ativo: true },
              select: { id: true, animalId: true, veterinarioId: true, tipo: true, descricao: true, numero: true },
            });
            if (exames.length === 0) return;
            const animal = await prisma.animal.findUnique({
              where: { id: existente.animalId }, select: { userId: true },
            });
            await prisma.$transaction(async (tx) => {
              for (const ex of exames) await lancarExameNaFatura(tx, ex, animal?.userId);
            });
          } catch { /* silencioso — fatura não bloqueia a finalização da evolução */ }
        });
      }
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

      // Autoria via RBAC (nível efetivo em atendimento.evolucoes.deletar)
      if (!podeOperarRegistro(req.permissaoNivel, existente.veterinarioId, userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Seu nível de permissão só permite excluir evoluções criadas por você.' });
      }

      // Regra de ADMIN (única regra fixa permitida no backend)
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

        await auditoriaCentral(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'EVOLUCAO',
          entidadeId: Number(id),
          animalId:   existente.animalId,
          motivo:     justificativa,
          detalhes:   existente.titulo || null,
        });
      });

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

        await auditoriaCentral(tx, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'EVOLUCAO',
          entidadeId: Number(id),
          animalId:   existente.animalId,
          motivo:     justificativa,
          detalhes:   `status anterior: ${existente.status}${existente.titulo ? ` — ${existente.titulo}` : ''}`,
        });

        return upd;
      });

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

      // Autoria via RBAC (nível efetivo em atendimento.evolucoes.finalizar):
      // PROPRIO → só finaliza o que criou; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req.permissaoNivel, existente.veterinarioId, userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Seu nível de permissão só permite finalizar evoluções criadas por você.' });
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

      // Áudio em formato que o Safari/iOS não reproduz (Ogg/Opus/WebM — ex:
      // nota de voz do WhatsApp) → converte para MP3 no upload, garantindo
      // reprodução em qualquer navegador. Em falha do ffmpeg mantém o original.
      let nomeArquivoFinal = file.filename;
      let tamanhoFinal     = file.size;
      let nomeExibicao     = file.originalname;
      if (tipoFinal === 'AUDIO' && EXTS_INCOMPATIVEIS_SAFARI.has(path.extname(file.filename).toLowerCase())) {
        const mp3Nome = `${path.basename(file.filename, path.extname(file.filename))}.mp3`;
        const mp3Path = path.join(path.dirname(file.path), mp3Nome);
        try {
          await transcodeParaMp3(file.path, mp3Path);
          fs.unlink(file.path, () => {});
          nomeArquivoFinal = mp3Nome;
          tamanhoFinal     = fs.statSync(mp3Path).size;
          // Nome de exibição acompanha o formato real (evita parecer que segue .ogg)
          const extOrig = path.extname(file.originalname);
          nomeExibicao  = extOrig ? `${file.originalname.slice(0, -extOrig.length)}.mp3` : `${file.originalname}.mp3`;
        } catch (convErr) {
          console.error('Falha ao converter áudio para MP3 (mantendo original):', convErr.message);
        }
      }

      const midia = await prisma.evolucaoMidia.create({
        data: {
          evolucaoId: Number(id),
          tipo:       tipoFinal,
          url:        `/uploads/evolucoes/${nomeArquivoFinal}`,
          nome:       nomeExibicao,
          tamanho:    tamanhoFinal,
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

    // O Groq Whisper valida a EXTENSÃO do nome do arquivo, mas o multer salva o
    // temporário sem extensão (dest:). Renomeia com a extensão original
    // (whitelist do Groq) antes de enviar — fallback .webm (gravações do app).
    const GROQ_EXTS = new Set(['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.opus', '.wav', '.webm']);
    const extOrig   = path.extname(req.file.originalname || '').toLowerCase();
    const audioPath = `${req.file.path}${GROQ_EXTS.has(extOrig) ? extOrig : '.webm'}`;
    try { fs.renameSync(req.file.path, audioPath); } catch {
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao preparar o áudio' });
    }

    try {
      const Groq = require('groq-sdk');
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const transcription = await groq.audio.transcriptions.create({
        file:     fs.createReadStream(audioPath),
        model:    'whisper-large-v3',
        language: 'pt',
      });

      const latencia = Date.now() - inicio;
      const texto    = transcription.text?.trim() ?? '';

      try { fs.unlinkSync(audioPath); } catch {}

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
      try { fs.unlinkSync(audioPath); } catch {}
      console.error('Erro ao transcrever áudio:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro na transcrição do áudio' });
    }
  },

  // ── Edição do relatório pelo veterinário ──────────────────────────────────
  // PUT /clinica/evolucoes/:id/resumo-ia — sobrescreve o resumo clínico do
  // relatório (scores, treino, observação). A edição manual passa a ter
  // precedência sobre a IA: nunca é sobrescrita por re-extração (nem por bump
  // de versão do prompt). O mapa corporal (registros) NÃO é editável por aqui —
  // ele é regenerado quando o TEXTO da evolução é alterado.

  salvarResumoIa: async (req, res) => {
    const { id }            = req.params;
    const { resumoClinico } = req.body;
    const userId            = req.user.id;

    try {
      const existente = await prisma.evolucaoClinica.findUnique({ where: { id: Number(id) } });
      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Mesma regra de autoria do atualizar — dirigida pela matriz RBAC
      if (!podeOperarRegistro(req.permissaoNivel, existente.veterinarioId, userId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Seu nível de permissão só permite editar relatórios de evoluções criadas por você.' });
      }

      const base = (existente.resumoIaData && typeof existente.resumoIaData === 'object')
        ? existente.resumoIaData
        : { registros: [], completo: true, avisos: [] };

      const novoResumo = {
        ...base,
        resumoClinico:    resumoClinico ?? undefined,
        editadoPeloVetEm: new Date().toISOString(),
        editadoPorId:     userId,
      };

      await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          resumoIaData:   novoResumo,
          resumoIaVersao: existente.resumoIaVersao ?? RESUMO_IA_VERSAO_ATUAL,
        },
      });

      res.json({ sucesso: true });
    } catch (error) {
      console.error('Erro ao salvar edição do relatório:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
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

      // Evolução anterior do animal DA MESMA ESPECIALIDADE — o comparativo é
      // sempre especialidade com especialidade (odontologia x odontologia,
      // fisioterapia x fisioterapia...). Exceção: Fisioterapia e Quiropraxia
      // formam um grupo comparável entre si.
      const GRUPOS_COMPARACAO = [['Fisioterapia', 'Quiropraxia']];
      const comparaveis = GRUPOS_COMPARACAO.find(g => g.includes(atual.especialidade)) ?? [atual.especialidade];
      const anterior = await prisma.evolucaoClinica.findFirst({
        where: {
          animalId:      atual.animalId,
          ativo:         true,
          id:            { not: atual.id },
          dataInicio:    { lt: atual.dataInicio },
          especialidade: { in: comparaveis },
        },
        orderBy: { dataInicio: 'desc' },
        include: INCLUDE_PADRAO,
      });

      const [resumoAtual, resumoAnterior] = await Promise.all([
        garantirResumoIa(atual, userId),
        anterior ? garantirResumoIa(anterior, userId) : Promise.resolve(null),
      ]);

      // Painter por tipo de atendimento: Ferrageamento → casco.png;
      // Odontologia → odontologia.png; demais → body-map equino.
      // Fallback pelo CONTEÚDO: se a extração produziu alvos de casco/dente
      // (ex.: ditado de ferrageamento salvo com especialidade "Clínico"),
      // pinta a imagem correspondente mesmo sem a especialidade correta.
      const baseInner = carregarBaseInnerEquino();
      const pintarSessao = (evolucao, resumo) => {
        const args = {
          registros: resumo.registros,
          titulo:    evolucao.titulo || `Evolução ${formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero)}`,
          completo:  resumo.completo,
        };
        const regs     = resumo.registros ?? [];
        const nCasco   = regs.filter(r => r.alvo?.tipo === 'casco').length;
        const nDente   = regs.filter(r => r.alvo?.tipo === 'dente').length;

        if (evolucao.especialidade === 'Ferrageamento' || (nCasco > 0 && nCasco >= nDente)) {
          return pintarLaudoCasco(args) ?? pintarLaudoEquino({ ...args, baseInner });
        }
        if (evolucao.especialidade === 'Odontologia' || nDente > 0) {
          return pintarLaudoDental(args) ?? pintarLaudoEquino({ ...args, baseInner });
        }
        return pintarLaudoEquino({ ...args, baseInner });
      };

      const svgAtual    = pintarSessao(atual, resumoAtual);
      const svgAnterior = anterior ? pintarSessao(anterior, resumoAnterior) : null;

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
            texto:             anterior.texto,
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
  // Relatório editado pelo veterinário tem precedência ABSOLUTA sobre a IA:
  // nunca re-extrai (nem em bump de versão do prompt). Só um novo texto de
  // evolução (que limpa o cache em `atualizar`) dispara nova extração.
  if (evolucao.resumoIaData?.editadoPeloVetEm) {
    return evolucao.resumoIaData;
  }
  if (evolucao.resumoIaData && evolucao.resumoIaVersao === RESUMO_IA_VERSAO_ATUAL) {
    return evolucao.resumoIaData;
  }

  const resultado = await extrairResumoAtendimento({
    texto:    evolucao.texto,
    userId,
    animalId: evolucao.animalId,
  });

  // NÃO cachear falha de extração (registros vazios + completo:false = fallback
  // gracioso do service, ex.: IA indisponível) — senão o vazio fica "definitivo"
  // e o relatório nunca mais tenta extrair esta evolução.
  const extracaoFalhou = resultado.completo === false && (resultado.registros?.length ?? 0) === 0;
  if (!extracaoFalhou) {
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