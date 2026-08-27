// src/controllers/EvolucaoController.js

const prisma = require('../lib/prisma').default;
const { Prisma } = require('@prisma/client');
const fs     = require('fs');
const path   = require('path');
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { animalEstaInativo } = require('../lib/animalInativo');
const { animalFoiExcluido } = require('../lib/animalAtivacao');
const { storage } = require('../storage');
const { escopoEvolucaoWhere }   = require('../lib/clinicalScope');
const { corteDePropriedade }    = require('../lib/animalPropriedadeCorte');
// Rastro de "assumido de quem" no agendamento arrastado junto (SQL cru)
const { marcarAssumido }        = require('../lib/agendamentoAssumido');
const { formatAtendimentoNum, lancarExameNaFatura } = require('../lib/faturaUtils');
const { resolverLogoPorAnimal } = require('../lib/logoEmpresaUtils');
const emailService              = require('../services/emailService');
const whatsappService           = require('../services/whatsappService');
const { transcodeParaMp3, EXTS_INCOMPATIVEIS_SAFARI } = require('../lib/audioTranscode');
const { PROMPTS }               = require('../ai/prompts');
const { MODULOS_IA }            = require('../ai');
const { transcreverAudio }      = require('../ai/geminiClient');
const { logAiUsage }            = require('../services/aiLogger.service');
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

async function registrarAuditoria(userId, userName, email, action, empresaId = null) {
  try {
    // RLS de tb_audit_logs exige empresaId = app_empresa_id() da sessão (fase 7c,
    // sem escape para NULL) — omitir o campo grava NULL e a policy recusa o INSERT.
    await prisma.auditLog.create({
      data: { userId, userName, email, action, empresaId, timestamp: new Date() },
    });
  } catch (err) {
    console.error('Erro ao registrar auditoria:', err);
  }
}

// Auditoria central estruturada (exclusões/cancelamentos/transferências/alterações)
const {
  registrarAuditoria: auditoriaCentral,
  registrarTransferencia,
  registrarAlteracao,
  resumoTexto,
} = require('../lib/auditoria');
// AUTORIA (2026-08-04): a ação concedida vale sobre o que é DE QUEM A EXECUTA — o
// registro que ele criou ou assumiu. Só o GESTOR opera registro de outro profissional.
const { podeOperarRegistro, ehGestorNoContexto } = require('../middlewares/permissao.middleware');
// Assumir a evolução arrasta prescrição, exame, encaminhamento e vacina do atendimento
const { transferirFilhosDasEvolucoes } = require('../lib/transferenciaAtendimento');
// Cancelar/excluir a evolução cancela junto tudo que está atrelado a ela (prescrição,
// procedimento, exame, encaminhamento, vacina) e estorna o item já lançado na fatura
const { cancelarPendenciasDaEvolucao } = require('../lib/cancelamentoPendencias');

// ─────────────────────────────────────────────────────────────────────────────
// COMUNICAÇÃO ENTRE PROFISSIONAIS (e-mail + WhatsApp)
// Mesma lógica da agenda (AgendamentoController.notificarTransferencia): quando o
// responsável por um atendimento muda — ou passa a haver outro atendimento em
// paralelo — o profissional afetado é avisado. Fire-and-forget: falha de
// notificação NUNCA derruba a operação clínica.
//
// modo 'ASSUMIDA' → `paraVetId` PERDEU a evolução, que `deVetId` assumiu.
// modo 'PARALELA' → `paraVetId` segue com a evolução dele, e `deVetId` abriu uma
//                   NOVA evolução para o mesmo paciente.
// ─────────────────────────────────────────────────────────────────────────────

function notificarEvolucao({ req, paraVetId, deVetId, evolucao, animalNome, modo = 'ASSUMIDA' }) {
  if (!paraVetId || Number(paraVetId) === Number(deVetId)) return;
  setImmediate(async () => {
    try {
      const [destino, origem] = await Promise.all([
        prisma.user.findUnique({ where: { id: Number(paraVetId) }, select: { email: true, fullName: true, phone: true } }),
        deVetId ? prisma.user.findUnique({ where: { id: Number(deVetId) }, select: { fullName: true } }) : null,
      ]);
      if (!destino) return;

      const atendimentoNumero = formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero);

      await emailService.enviarTransferenciaEvolucao({
        paraEmail:     destino.email,
        paraNome:      destino.fullName,
        deNome:        origem?.fullName ?? null,
        animalNome:    animalNome ?? null,
        atendimentoNumero,
        titulo:        evolucao.titulo ?? null,
        especialidade: evolucao.especialidade ?? null,
        dataInicio:    evolucao.dataInicio ?? null,
        modo,
      }).catch(() => {});

      if (!destino.phone) return;
      const assumida = modo === 'ASSUMIDA';
      const msg = [
        assumida
          ? '🐴 *S2Vet — Evolução assumida por outro profissional*'
          : '🐴 *S2Vet — Nova evolução aberta em paralelo*',
        origem?.fullName
          ? (assumida ? `🙋 ${origem.fullName} assumiu a condução` : `👥 ${origem.fullName} abriu uma nova evolução`)
          : '',
        `🐎 ${animalNome ?? 'Paciente'}${atendimentoNumero ? ` — ${atendimentoNumero}` : ''}`,
        evolucao.titulo ? `📝 ${evolucao.titulo}` : '',
        assumida ? '' : 'Sua evolução continua sob sua responsabilidade.',
      ].filter(Boolean).join('\n');

      // Instância da clínica (Evolution). Sem instância conectada, cai no provider legado.
      const envio = await whatsappService.sendMessage(
        { empresaId: req.empresaId, equipeId: req.equipeId },
        destino.phone, msg,
      ).catch(() => ({ sucesso: false }));
      if (!envio?.sucesso) await whatsappService.sendWhatsApp(destino.phone, msg).catch(() => {});
    } catch { /* silencioso — notificação não bloqueia o atendimento */ }
  });
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
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Segregação multi-clínica: cada empresa vê só as próprias evoluções do animal
      where.AND = [escopoEvolucaoWhere(req)];

      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê o que foi gerado
      // a partir de `propriedadeDesde`; intersecta com o filtro de data que a tela
      // já pode ter mandado (nunca afrouxa um `gte` mais restritivo do usuário).
      const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);
      if (corte) {
        where.dataInicio = where.dataInicio || {};
        if (!where.dataInicio.gte || corte > where.dataInicio.gte) where.dataInicio.gte = corte;
      }

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
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
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

      const acesso = await verificarAcessoAnimal({ animalId: evolucao.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
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
  // Evolução em andamento do PRÓPRIO profissional continua BLOQUEANDO (400
  // EVOLUCAO_EM_ANDAMENTO): ele finaliza ou cancela a que abriu antes de abrir outra
  // para o mesmo paciente — nunca atende a si mesmo em paralelo.
  // Evolução em andamento de OUTRO profissional não bloqueia: responde 409
  // EVOLUCAO_EM_ANDAMENTO com os dados dela para o frontend oferecer as duas saídas —
  // ASSUMIR (PATCH /:id/assumir) ou CRIAR UMA NOVA (reenvio com `confirmarConcorrente`),
  // caso em que o outro profissional é comunicado por e-mail/WhatsApp.

  criar: async (req, res) => {
    const { animalId, especialidade, texto, status = 'EM_ANDAMENTO', agendamentoId, confirmarConcorrente } = req.body;
    const userId = req.user.id;

    if (!animalId)      return res.status(400).json({ sucesso: false, mensagem: 'Animal é obrigatório' });
    if (!especialidade) return res.status(400).json({ sucesso: false, mensagem: 'Especialidade é obrigatória' });
    if (!texto?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Texto da evolução é obrigatório' });

    try {
      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { id: true, nome: true },
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({
          sucesso: false, mensagem: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.',
          code: 'PACIENTE_EXCLUIDO',
        });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({
          sucesso: false, mensagem: 'Paciente inativo — reative com o gestor antes de registrar algo novo.',
          code: 'PACIENTE_INATIVO',
        });
      }

      // Evoluções em andamento deste animal (pode haver mais de uma quando
      // profissionais diferentes atendem o mesmo paciente em paralelo).
      const abertas = await prisma.evolucaoClinica.findMany({
        where:   { animalId: Number(animalId), status: 'EM_ANDAMENTO', ativo: true },
        orderBy: { dataInicio: 'desc' },
        select: {
          id: true, numero: true, tipoAtendimento: true, dataInicio: true,
          especialidade: true, titulo: true, veterinarioId: true, agendamentoId: true,
          veterinario: { select: { id: true, fullName: true } },
        },
      });

      // A PRÓPRIA evolução aberta só BLOQUEIA quando é a MESMA CONSULTA — sem
      // agendamento (avulsa, ambígua por natureza: duas avulsas do mesmo animal são
      // indistinguíveis) ou vinculada ao MESMO agendamento que já está aberto (reenvio/
      // duplo clique). Vinculada a um AGENDAMENTO DIFERENTE é uma consulta DISTINTA —
      // ex.: a mesma pessoa assumiu a consulta Clínica e a de Dermatologia do mesmo
      // animal no mesmo dia — e não bloqueia: nem `confirmarConcorrente` é necessário,
      // porque não há nada "concorrente" com outro profissional aqui, é a própria
      // pessoa conduzindo dois atendimentos paralelos legítimos. `agendamentoId` é o
      // que prova a distinção; sem ele (avulsa) não há como provar nada, então bloqueia.
      const minhaAberta = abertas.find(e => {
        if (Number(e.veterinarioId) !== Number(userId)) return false;
        if (!agendamentoId) return true;
        return Number(e.agendamentoId) === Number(agendamentoId);
      });
      if (minhaAberta) {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Já existe uma evolução em andamento para este animal. Finalize ou cancele-a antes de criar uma nova.',
          code:     'EVOLUCAO_EM_ANDAMENTO',
        });
      }

      // Aberta por OUTRO profissional: exige decisão explícita (assumir OU criar
      // uma nova em paralelo, reenviando com `confirmarConcorrente`). Evoluções MINHAS
      // que passaram pelo bloqueio acima (agendamento diferente = consulta distinta)
      // NUNCA entram aqui — não faz sentido "assumir" ou confirmar concorrência com
      // algo que já é meu.
      const evolucaoAberta = abertas.find(e => Number(e.veterinarioId) !== Number(userId)) ?? null;
      if (evolucaoAberta && !confirmarConcorrente) {
        return res.status(409).json({
          sucesso:  false,
          code:     'EVOLUCAO_EM_ANDAMENTO',
          mensagem: `${evolucaoAberta.veterinario?.fullName ?? 'Outro profissional'} tem uma evolução em andamento para este paciente. Assuma a evolução ou confirme a criação de uma nova.`,
          evolucaoAberta: {
            id:                evolucaoAberta.id,
            numero:            evolucaoAberta.numero,
            tipoAtendimento:   evolucaoAberta.tipoAtendimento,
            atendimentoNumero: formatAtendimentoNum(evolucaoAberta.tipoAtendimento, evolucaoAberta.numero),
            dataInicio:        evolucaoAberta.dataInicio,
            especialidade:     evolucaoAberta.especialidade,
            titulo:            evolucaoAberta.titulo,
            veterinarioId:     evolucaoAberta.veterinarioId,
            veterinarioNome:   evolucaoAberta.veterinario?.fullName ?? null,
          },
        });
      }

      // ⚠️ NENHUM caminho de criar espera a IA (2026-08-26). Até aqui, nascer já
      // FINALIZADA bloqueava a resposta até o Gemini responder — medido em produção:
      // de <1s a mais de um MINUTO — e só por causa de `acoesIA`, a sugestão de
      // encaminhamento que o front abre DEPOIS de salvar. O registro clínico já
      // estava gravado; o usuário esperava por uma sugestão.
      // Quem faz a chamada agora é o FRONT, por `POST /:id/titulo-ia`, sem travar a
      // tela — e é uma só chamada, que grava o título e devolve as ações.
      // `acoesIA: []` continua no corpo da resposta de propósito: o contrato não
      // muda para nenhum cliente que ainda o leia.
      const tituloIA = null;
      const acoesIA  = [];

      const evolucao = await prisma.$transaction(async (tx) => {
        let numero;
        let tipoAtendimento;
        let agendamentoIdFinal = null;

        if (agendamentoId) {
          // Vinculado a agendamento: herda numero do agendamento e marca como EM_ANDAMENTO
          // (só vira FINALIZADO quando a evolução for finalizada — ver EvolucaoController.atualizar)
          const agendamento = await tx.agendamentoClinico.findFirst({
            where: { id: Number(agendamentoId), animalId: Number(animalId), ativo: true },
            select: { id: true, numero: true, status: true, dataHora: true },
          });
          if (!agendamento) {
            throw Object.assign(new Error('Agendamento não encontrado para este animal'), { statusCode: 404, code: 'AGENDAMENTO_NOT_FOUND' });
          }
          // EM_ANDAMENTO é aceito: o botão "Iniciar" da agenda já marca o agendamento
          // como em atendimento ANTES de a evolução existir (é o que faz a tela refletir
          // o início na hora). Recusar aqui impediria o profissional de escrever a
          // evolução do atendimento que ele mesmo acabou de iniciar.
          // ATRASADA idem: atraso não pode impedir o atendimento de acontecer.
          if (!['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'].includes(agendamento.status)) {
            throw Object.assign(new Error('Agendamento já foi concluído ou cancelado'), { statusCode: 400, code: 'AGENDAMENTO_INVALIDO' });
          }
          // ADIANTAR é permitido: o paciente chegou antes, o profissional vagou —
          // atende-se e pronto. O que continua proibido é o inverso, mexer na
          // agenda para TRÁS do relógio (`AgendamentoController.criar`/`atualizar`
          // recusam com DATA_PASSADA). Não existe mais bloqueio de antecipação
          // aqui: exigir reagendamento para atender 20 min antes era atrito puro.
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
        `EVOLUCAO_CRIADA | id=${evolucao.id} | animal=${animalId} | num=${evolucao.tipoAtendimento}-${evolucao.numero} | status=${status}`,
        req.empresaId ?? null
      );

      // Atendimento em paralelo: o outro profissional (só chega aqui a evolução
      // aberta por OUTRO — a própria bloqueia acima) é comunicado de que uma nova
      // evolução foi aberta para o mesmo paciente; a dele segue com ele.
      if (evolucaoAberta) {
        notificarEvolucao({
          req,
          paraVetId:  evolucaoAberta.veterinarioId,
          deVetId:    userId,
          modo:       'PARALELA',
          animalNome: animal.nome,
          evolucao:   evolucaoAberta,
        });
      }

      // Título em segundo plano — não atrasa o "Salvar" nem falha a criação se o
      // Gemini estiver lento/fora do ar. Falha silenciosa: o registro já foi criado e
      // o título é conveniência, não requisito.
      // ⚠️ NÃO roda quando a evolução já nasce FINALIZADA: nesse caso quem chama a IA
      // é o front (`POST /:id/titulo-ia`, para receber também as ações de
      // encaminhamento), e disparar aqui faria DUAS chamadas ao Gemini pelo mesmo
      // texto — consumo de IA é medido e faturado por empresa (CLAUDE.md §7).
      if (status !== 'FINALIZADA') {
        const evolucaoId = evolucao.id;
        setImmediate(async () => {
          try {
            const resultadoIA = await interpretarEvolucao(texto.trim(), userId, Number(animalId), req.empresaId ?? null).catch(() => null);
            const tituloAssincrono = resultadoIA?.titulo?.trim()?.substring(0, 255) || null;
            if (tituloAssincrono) {
              await prisma.evolucaoClinica.update({
                where: { id: evolucaoId },
                data:  { titulo: tituloAssincrono },
              });
            }
          } catch { /* silencioso — título é conveniência, não bloqueia o atendimento */ }
        });
      }

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

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Autoria dirigida pela matriz RBAC (nível efetivo em atendimento.evolucoes.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer registro da equipe.
      if (!podeOperarRegistro(req, existente.veterinarioId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Seu nível de permissão só permite editar evoluções criadas por você.' });
      }

      // Reabrir registro FINALIZADO é ato de GESTOR — não é nível de matriz. Antes a
      // regra era "nível FULL no editar", que na prática só o gestor tem, mas deixava a
      // porta aberta para a matriz conceder a reabertura de prontuário a um perfil comum.
      if (existente.status === 'FINALIZADA' && !ehGestorNoContexto(req)) {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Somente o gestor pode editar uma evolução já finalizada.',
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

      // Título via IA: regera quando ainda não há título OU quando o TEXTO mudou. Se o
      // texto não mudou, não reprocessa (evita gasto de IA a cada "Salvar" de um
      // rascunho já titulado). Falha/retorno vazio da IA mantém o título anterior
      // (nunca zera um já existente). Vale só para o "Salvar" do rascunho — na
      // FINALIZAÇÃO quem pede o título é o front, junto das ações (ver abaixo).
      const precisaTitulo = (!existente.titulo?.trim() || textoMudou) && Boolean(textoEfetivo?.trim());

      // ⚠️ FINALIZAR NÃO ESPERA MAIS A IA (2026-08-26). O `await` daqui era a
      // duração inteira do "Finalizar" (medido: de <1s a mais de um MINUTO) e existia
      // só por `acoesIA` — a sugestão de encaminhamento que o front abre DEPOIS de
      // salvar. Quem chama a IA agora é o front, por `POST /:id/titulo-ia`, sem
      // travar a tela; lá uma ÚNICA chamada grava o título e devolve as ações.
      const tituloParaSalvar = existente.titulo;
      const acoesIA = [];

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

        // Cascata da finalização (2026-07-25): finalizar a evolução também FINALIZA as
        // prescrições e vacinas SALVAS do atendimento → elas passam a "Em Execução" e vão
        // para o plantão (Execução de Prescrição). Só transição de status: fatura e débito
        // de estoque continuam acontecendo na EXECUÇÃO, não aqui. Idempotente (só toca SALVO/SALVA).
        if (vaiFinalizar) {
          const gruposSalvos = await tx.prescricaoGrupo.findMany({
            where:  { evolucaoId: Number(id), status: 'SALVO' },
            select: { id: true },
          });
          const grupoIds = gruposSalvos.map(g => g.id);
          if (grupoIds.length > 0) {
            await tx.prescricao.updateMany({
              where: { grupoId: { in: grupoIds }, ativo: true },
              data:  { status: 'ATIVA' },
            });
            await tx.prescricaoGrupo.updateMany({
              where: { id: { in: grupoIds } },
              data:  { status: 'FINALIZADO', finalizadoPorId: userId, finalizadoEm: new Date() },
            });
          }

          // Vacinas SALVAS do atendimento → FINALIZADA (status vive fora do client gerado).
          await tx.$executeRawUnsafe(
            `UPDATE schs2vet.tb_vacinas_clinicas
             SET status = 'FINALIZADA'
             WHERE evolucao_id = $1 AND status = 'SALVA' AND ativo = true`,
            Number(id)
          );
        }

        // Mudar o status faz de quem finaliza/cancela o novo responsável. Quando isso
        // tira a evolução de outro profissional (gestor finalizando a dele), é uma
        // TRANSFERÊNCIA e precisa do mesmo rastro do assumir.
        if (existente.veterinarioId != null && Number(existente.veterinarioId) !== Number(novoVetId)) {
          await registrarTransferencia(tx, req, {
            entidade: 'EVOLUCAO', entidadeId: Number(id), animalId: existente.animalId,
            deVetId: existente.veterinarioId, paraVetId: novoVetId,
            motivo: `Evolução ${status === 'CANCELADA' ? 'cancelada' : 'finalizada'} por outro profissional`,
          });
        }

        // Antes → depois da edição, sempre com o responsável de cada lado: quando o
        // status muda, quem finaliza/cancela vira o dono, e a auditoria precisa
        // mostrar que a alteração atravessou essa troca.
        await registrarAlteracao(tx, req, {
          entidade: 'EVOLUCAO', entidadeId: Number(id), animalId: existente.animalId,
          donoAnteriorId: existente.veterinarioId,
          donoAtualId:    novoVetId,
          campos: {
            status:        { de: existente.status,        para: upd.status },
            especialidade: { de: existente.especialidade, para: upd.especialidade },
            titulo:        { de: existente.titulo,        para: upd.titulo },
            texto:         { de: resumoTexto(existente.texto), para: resumoTexto(upd.texto) },
          },
        });

        return upd;
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_EDITADA | id=${id} | animal=${existente.animalId} | status=${status ?? existente.status} | responsavelAnterior=${existente.veterinarioId} | responsavelNovo=${novoVetId}`,
        req.empresaId ?? null
      );

      res.json({ sucesso: true, dados: atualizada, acoesIA });

      // Título em segundo plano quando o texto mudou fora do fluxo de finalização —
      // não atrasa o "Salvar" do rascunho nem falha a edição se o Gemini estiver
      // lento/fora do ar. Falha silenciosa: título é conveniência, não requisito.
      // ⚠️ `!vaiFinalizar`: ao FINALIZAR quem chama a IA é o front (precisa das ações
      // de encaminhamento no mesmo retorno), e disparar aqui também faria DUAS
      // chamadas ao Gemini pelo mesmo texto — IA é medida e faturada por empresa.
      if (precisaTitulo && !vaiFinalizar) {
        setImmediate(async () => {
          try {
            const resultadoIA = await interpretarEvolucao(textoEfetivo, userId, existente.animalId, req.empresaId ?? null).catch(() => null);
            const tituloAssincrono = resultadoIA?.titulo?.trim()?.substring(0, 255) || null;
            if (tituloAssincrono) {
              await prisma.evolucaoClinica.update({
                where: { id: Number(id) },
                data:  { titulo: tituloAssincrono },
              });
            }
          } catch { /* silencioso — título é conveniência, não bloqueia o atendimento */ }
        });
      }

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
              for (const ex of exames) await lancarExameNaFatura(tx, ex, animal?.userId, req.empresaId ?? null);
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

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC (nível efetivo em atendimento.evolucoes.deletar)
      if (!podeOperarRegistro(req, existente.veterinarioId)) {
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
        // Tudo que estava atrelado a esta evolução (prescrição/procedimento, exame,
        // encaminhamento, vacina ainda pendentes) cancela junto, com estorno do que
        // já tinha ido para a fatura — senão a evolução some da tela mas deixa
        // pendência clínica órfã por trás (ver cancelamentoPendencias.js).
        await cancelarPendenciasDaEvolucao(tx, Number(id), req, justificativa.trim());

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

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      if (existente.status === 'CANCELADA') {
        return res.status(400).json({ sucesso: false, mensagem: 'Evolução já está cancelada' });
      }

      const cancelada = await prisma.$transaction(async (tx) => {
        // Tudo que está atrelado a esta evolução (prescrição/procedimento, exame,
        // encaminhamento, vacina ainda pendentes) cancela junto, com estorno do que
        // já tinha ido para a fatura — cancelar a evolução não pode deixar a
        // prescrição/exame "em aberto" sem ninguém mais conduzindo o atendimento.
        await cancelarPendenciasDaEvolucao(tx, Number(id), req, justificativa.trim());

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

  // ── Assumir evolução de outro profissional ────────────────────────────────
  // PATCH /clinica/evolucoes/:id/assumir
  //
  // Mesma lógica do "assumir" da agenda (AgendamentoController.assumir): é um PUXAR
  // PARA SI, não a edição do registro alheio — por isso NÃO passa por
  // `podeOperarRegistro` (que exigiria ser o autor). O gate é o RBAC da rota
  // (atendimento.evolucoes.editar), o acesso ao animal e o escopo clínico.
  // Quem estava conduzindo a evolução é comunicado por e-mail e WhatsApp.
  //
  // SÓ se assume evolução de OUTRO profissional — qualquer paciente, sem exceção.
  // A própria evolução aberta não se assume (ela já é dele): responde 400
  // EVOLUCAO_JA_MINHA e o caminho continua sendo editar/finalizar/cancelar.

  assumir: async (req, res) => {
    const { id } = req.params;
    // Agendamento que o "Iniciar" da agenda já deixou EM_ANDAMENTO antes de o
    // usuário decidir ASSUMIR esta evolução (que não tem relação nenhuma com ele —
    // é da OUTRA pessoa). Sem anexá-lo, ele fica travado em EM_ANDAMENTO sem
    // nenhuma evolução apontando para ele. Opcional: só existe quando a decisão
    // nasceu desse caminho (ver `agendamentoConflitoOrigemRef` no frontend).
    const { agendamentoId } = req.body;
    const userId = req.user.id;

    try {
      const existente = await prisma.evolucaoClinica.findFirst({
        where:   { AND: [{ id: Number(id) }, escopoEvolucaoWhere(req)] },
        include: { animal: { select: { nome: true } } },
      });

      if (!existente || !existente.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      if (existente.status !== 'EM_ANDAMENTO') {
        return res.status(400).json({
          sucesso:  false,
          mensagem: 'Só é possível assumir uma evolução em andamento.',
          code:     'EVOLUCAO_NAO_ABERTA',
        });
      }
      if (Number(existente.veterinarioId) === Number(userId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Esta evolução já é sua.', code: 'EVOLUCAO_JA_MINHA' });
      }

      const anteriorId = existente.veterinarioId;

      // Só anexa quando a evolução assumida AINDA não tem agendamento próprio —
      // isto é um vínculo que faltava, não uma substituição do que já existia. O
      // número/tipoAtendimento da evolução assumida NÃO mudam: ela continua com o
      // que já tinha, só ganha o agendamento que estava solto.
      let agendamentoNovo = null;
      if (agendamentoId && !existente.agendamentoId) {
        agendamentoNovo = await prisma.agendamentoClinico.findFirst({
          where: {
            id: Number(agendamentoId), animalId: existente.animalId, ativo: true,
            status: { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] },
          },
          select: { id: true },
        });
      }

      // Assumir o ATENDIMENTO arrasta a AGENDA junto: a evolução nascida de um
      // agendamento (AG-XXXX) tem o agendamento apontando para o vet anterior.
      // Mover só a evolução deixaria o atendimento na agenda de quem não o conduz
      // mais — e ele não apareceria na agenda de quem assumiu.
      //
      // E arrasta também TUDO QUE ESTÁ EMBAIXO (prescrição, exame, encaminhamento,
      // vacina): com a premissa de autoria, quem assume precisa poder operar o que
      // passou a conduzir, e o antigo responsável não pode continuar mexendo nisso.
      const { evolucao: assumida, movidos } = await prisma.$transaction(async (tx) => {
        const evo = await tx.evolucaoClinica.update({
          where: { id: existente.id },
          data:  {
            veterinarioId:   userId,
            modificadoPorId: userId,
            dataModificacao: new Date(),
            ...(agendamentoNovo ? { agendamentoId: agendamentoNovo.id } : {}),
          },
          include: INCLUDE_PADRAO,
        });

        const arrastados = await transferirFilhosDasEvolucoes(tx, [existente.id], userId);

        if (existente.agendamentoId) {
          const movidosAg = await tx.agendamentoClinico.updateMany({
            where: { id: existente.agendamentoId, ativo: true, status: { in: ['AGENDADO', 'EM_ANDAMENTO', 'ATRASADA'] } },
            data:  { veterinarioId: userId },
          });
          // Mesmo rastro do "assumir" da agenda: a Agenda pinta o selo "assumida de
          // <Fulano>". Só marca se o agendamento realmente mudou de mãos.
          if (movidosAg.count > 0) {
            await marcarAssumido(tx, existente.agendamentoId, anteriorId);
            arrastados.push({
              entidade: 'AGENDAMENTO', entidadeId: existente.agendamentoId,
              animalId: existente.animalId, deVetId: anteriorId,
            });
          }
        }

        // O agendamento novo é do PRÓPRIO usuário (ele mesmo clicou "Iniciar") —
        // não é uma transferência de outro profissional, só o vínculo que faltava.
        // Sem rastro de "assumido de": ninguém tirou nada de ninguém aqui.
        if (agendamentoNovo) {
          await tx.agendamentoClinico.update({
            where: { id: agendamentoNovo.id },
            data:  { veterinarioId: userId, status: 'EM_ANDAMENTO' },
          });
        }

        // A auditoria entra na MESMA transaction que a troca: ou a transferência e o
        // seu rastro existem juntos, ou nenhum dos dois existe.
        await registrarTransferencia(tx, req, {
          entidade: 'EVOLUCAO', entidadeId: existente.id, animalId: existente.animalId,
          deVetId: anteriorId, paraVetId: userId,
          motivo: 'Evolução assumida por outro profissional',
        });
        for (const m of arrastados) {
          await registrarTransferencia(tx, req, {
            ...m, paraVetId: userId,
            motivo: 'Arrasto do atendimento assumido',
            origem: `evolução assumida`,
          });
        }

        return { evolucao: evo, movidos: arrastados };
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_ASSUMIDA | id=${existente.id} | animal=${existente.animalId} | de=${anteriorId ?? '-'} | para=${userId} | arrastados=${movidos.length}`,
        req.empresaId ?? null
      );

      notificarEvolucao({
        req,
        paraVetId:  anteriorId,
        deVetId:    userId,
        modo:       'ASSUMIDA',
        animalNome: existente.animal?.nome ?? null,
        evolucao:   existente,
      });

      res.json({
        sucesso: true,
        dados: {
          ...assumida,
          atendimentoNumero: formatAtendimentoNum(assumida.tipoAtendimento, assumida.numero),
        },
      });
    } catch (error) {
      console.error('Erro ao assumir evolução:', error);
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

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC (nível efetivo em atendimento.evolucoes.finalizar):
      // PROPRIO → só finaliza o que criou; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req, existente.veterinarioId)) {
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
        `EVOLUCAO_APROVADA | id=${id} | animal=${existente.animalId}`,
        req.empresaId ?? null
      );

      res.json({ sucesso: true, dados: aprovada });
    } catch (error) {
      console.error('Erro ao aprovar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Salvar título gerado pela LLM ─────────────────────────────────────────
  // ── Título por IA + ações clinicas, FORA do caminho de finalizar ────────────
  // POST /clinica/evolucoes/:id/titulo-ia
  //
  // POR QUE EXISTE: finalizar a evolução ESPERAVA o Gemini, e só por causa de
  // `acoesIA` (a sugestão de encaminhamento que o front abre depois de salvar). A
  // latência dessa chamada é de <1s a mais de um MINUTO (conta compartilhada entre
  // tenants), então o botão "Finalizar" ficava girando esse tempo todo com o
  // atendimento já gravado no banco há muito — o usuário esperava por uma sugestão,
  // não pelo registro clínico.
  //
  // Agora finalizar responde na hora e o front chama ESTA rota em seguida, sem travar
  // a tela. ⚠️ É **UMA SÓ** chamada de IA: `interpretarEvolucao` devolve título E
  // ações no mesmo retorno, então gravar o título aqui evita a segunda chamada que
  // um job de título em segundo plano custaria — e o consumo de IA é medido e
  // faturado por empresa (CLAUDE.md §7).
  //
  // ⚠️ O TEXTO vem do BANCO, nunca do body: a rota não pode virar um atalho para
  // rodar a LLM com texto arbitrário por conta do tenant.
  // ⚠️ NÃO sobrescreve título já existente — pode ser o que alguém escreveu à mão
  // pelo PATCH /titulo. As AÇÕES continuam sendo devolvidas nesse caso.

  tituloIa: async (req, res) => {
    const { id } = req.params;
    try {
      const evolucao = await prisma.evolucaoClinica.findUnique({
        where:  { id: Number(id) },
        select: { id: true, animalId: true, ativo: true, texto: true, titulo: true, veterinarioId: true },
      });
      if (!evolucao || !evolucao.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      const acesso = await verificarAcessoAnimal({
        animalId: evolucao.animalId, userId: req.user.id,
        empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType,
      });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      if (!podeOperarRegistro(req, evolucao.veterinarioId)) {
        return res.status(403).json({ sucesso: false, mensagem: 'Só é possível operar uma evolução sua.' });
      }

      if (!evolucao.texto?.trim()) {
        return res.json({ sucesso: true, dados: { titulo: evolucao.titulo ?? null, acoes: [] } });
      }

      // Degradação graciosa: IA fora do ar/lenta não é erro para quem chama — o
      // atendimento JÁ está finalizado, isto aqui é conveniência.
      const resultadoIA = await interpretarEvolucao(
        evolucao.texto, req.user.id, evolucao.animalId, req.empresaId ?? null,
      ).catch(() => null);

      const tituloIA = resultadoIA?.titulo?.trim()?.substring(0, 255) || null;
      let tituloFinal = evolucao.titulo;
      if (tituloIA && !evolucao.titulo?.trim()) {
        await prisma.evolucaoClinica.update({ where: { id: evolucao.id }, data: { titulo: tituloIA } });
        tituloFinal = tituloIA;
      }

      res.json({ sucesso: true, dados: { titulo: tituloFinal ?? null, acoes: resultadoIA?.acoes ?? [] } });
    } catch (error) {
      console.error('Erro ao gerar título por IA (não crítico):', error);
      res.json({ sucesso: true, dados: { titulo: null, acoes: [] } });
    }
  },

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

      const acesso = await verificarAcessoAnimal({ animalId: evolucaoParaTitulo.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
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

      const acesso = await verificarAcessoAnimal({ animalId: evolucao.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
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

      // O binário vai para o BANCO (tb_midia_arquivos) e o arquivo temporário do
      // multer é descartado. Antes a url apontava para `/uploads/evolucoes/...`,
      // servido por express.static SEM autenticação — vídeo e áudio do prontuário
      // ficavam acessíveis a quem tivesse o link, de qualquer empresa.
      // O multer grava em disco (não em memória) de propósito: são até 100 MB, e o
      // transcode de áudio para MP3 precisa de um path real.
      const caminhoFinal = path.join(path.dirname(file.path), nomeArquivoFinal);
      const url = await storage.upload(
        {
          fieldname:    file.fieldname,
          originalname: nomeExibicao,
          mimetype:     tipoFinal === 'AUDIO' && nomeArquivoFinal.endsWith('.mp3') ? 'audio/mpeg' : file.mimetype,
          size:         tamanhoFinal,
          path:         caminhoFinal,
        },
        'evolucoes',
        { empresaId: req.empresaId ?? null, animalId: evolucao.animalId, criadoPorId: req.user?.id ?? null },
      );
      fs.unlink(caminhoFinal, () => {});

      const midia = await prisma.evolucaoMidia.create({
        data: {
          evolucaoId: Number(id),
          tipo:       tipoFinal,
          url,
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
        const acesso = await verificarAcessoAnimal({ animalId: evolucaoParaMidia.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
        if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
        if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });
      }

      // Mídia no banco: storage.delete apaga a linha de tb_midia_arquivos.
      // Mídia LEGADA (url `/uploads/...`, anterior à migração): o provider de banco
      // ignora essa url, então o arquivo em disco é removido aqui — senão o binário
      // ficaria órfão no filesystem depois de o registro sumir.
      await storage.delete(midia.url);
      if (midia.url && midia.url.startsWith('/uploads/')) {
        fs.unlink(path.join(__dirname, '../../', midia.url), () => {});
      }

      await prisma.evolucaoMidia.delete({ where: { id: Number(midiaId) } });

      res.json({ sucesso: true });
    } catch (error) {
      console.error('Erro ao remover mídia:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Interpretar texto com LLM ─────────────────────────────────────────────
  // Rota inline em evolucao.js — usa clinicaLLMService
  // Este método é mantido como fallback mas não está em uso direto no router

  interpretar: async (req, res) => {
    const { texto } = req.body;
    if (!texto?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Texto é obrigatório' });
    }
    res.status(501).json({ sucesso: false, mensagem: 'Use a rota POST /interpretar do router' });
  },

  // ── Transcrever áudio com Gemini ──────────────────────────────────────────
  // POST /clinica/evolucoes/transcrever
  // multipart/form-data: audio (arquivo)

  transcrever: async (req, res) => {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ sucesso: false, mensagem: 'Arquivo de áudio obrigatório' });
    }

    const extOrig = path.extname(req.file.originalname || '').toLowerCase();
    // O Gemini não aceita WebM/Opus (formato das gravações do app e das notas de
    // voz do WhatsApp) — transcodifica para MP3 antes de enviar.
    const precisaConverter = EXTS_INCOMPATIVEIS_SAFARI.has(extOrig) || !extOrig;
    const audioPath        = `${req.file.path}${precisaConverter ? '.mp3' : extOrig}`;
    const mimeType         = precisaConverter ? 'audio/mp3' : (req.file.mimetype || 'audio/mp3');

    try {
      if (precisaConverter) await transcodeParaMp3(req.file.path, audioPath);
      else                  fs.renameSync(req.file.path, audioPath);
    } catch (err) {
      try { fs.unlinkSync(req.file.path); } catch {}
      console.error('Erro ao preparar o áudio:', err);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao preparar o áudio' });
    }
    if (precisaConverter) { try { fs.unlinkSync(req.file.path); } catch {} }

    const inicio = Date.now();
    try {
      const buffer = fs.readFileSync(audioPath);
      const r      = await transcreverAudio(buffer, mimeType);
      const texto  = (r.text ?? '').trim();

      try { fs.unlinkSync(audioPath); } catch {}

      await logAiUsage({
        operacao:         'transcricao_audio@v1',
        modulo:           MODULOS_IA.TRANSCRICAO,
        modelo:           r.modelo,
        provedor:         r.provedor,
        promptTexto:      '',
        respostaTexto:    texto,
        tokensEntradaApi: r.tokensEntrada ?? undefined,
        tokensSaidaApi:   r.tokensSaida   ?? undefined,
        latenciaMs:       Date.now() - inicio,
        userId,
        empresaId:        req.empresaId ?? null,
        sucesso:          true,
      });

      res.json({ sucesso: true, dados: { texto } });
    } catch (error) {
      try { fs.unlinkSync(audioPath); } catch {}
      console.error('Erro ao transcrever áudio:', error);
      await logAiUsage({
        operacao:      'transcricao_audio@v1',
        modulo:        MODULOS_IA.TRANSCRICAO,
        modelo:        'gemini',
        promptTexto:   '',
        respostaTexto: '',
        latenciaMs:    Date.now() - inicio,
        userId,
        empresaId:     req.empresaId ?? null,
        sucesso:       false,
        erroMensagem:  error.message,
      }).catch(() => {});
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

      const acesso = await verificarAcessoAnimal({ animalId: existente.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Mesma regra de autoria do atualizar — dirigida pela matriz RBAC
      if (!podeOperarRegistro(req, existente.veterinarioId)) {
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

      const acesso = await verificarAcessoAnimal({ animalId: atual.animalId, userId, empresaId: req.empresaId, equipeId: req.equipeId, userType: req.user.userType });
      if (acesso === null) return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ sucesso: false, mensagem: 'Acesso não autorizado a este animal' });

      // Evolução anterior do animal DA MESMA ESPECIALIDADE — o comparativo é
      // sempre especialidade com especialidade (odontologia x odontologia,
      // fisioterapia x fisioterapia...). Exceção: Fisioterapia e Quiropraxia
      // formam um grupo comparável entre si.
      // Só compara com a última FINALIZADA: rascunhos (EM_ANDAMENTO) e canceladas
      // não são baseline clínica válida — o comparativo é sempre contra o último
      // atendimento efetivamente concluído.
      const GRUPOS_COMPARACAO = [['Fisioterapia', 'Quiropraxia']];
      const comparaveis = GRUPOS_COMPARACAO.find(g => g.includes(atual.especialidade)) ?? [atual.especialidade];
      const anterior = await prisma.evolucaoClinica.findFirst({
        where: {
          animalId:      atual.animalId,
          ativo:         true,
          status:        'FINALIZADA',
          id:            { not: atual.id },
          dataInicio:    { lt: atual.dataInicio },
          especialidade: { in: comparaveis },
        },
        orderBy: { dataInicio: 'desc' },
        include: INCLUDE_PADRAO,
      });

      const [resumoAtual, resumoAnterior] = await Promise.all([
        garantirResumoIa(atual, userId, req.empresaId ?? null),
        anterior ? garantirResumoIa(anterior, userId, req.empresaId ?? null) : Promise.resolve(null),
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
async function garantirResumoIa(evolucao, userId, empresaId = null) {
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
    empresaId,
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