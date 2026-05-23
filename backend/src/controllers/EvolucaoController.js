// src/controllers/EvolucaoController.js

const prisma = require('../lib/prisma').default;

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT LLM — detectar ações clínicas no texto da evolução
// ─────────────────────────────────────────────────────────────────────────────

const PROMPT_INTERPRETACAO = `Você é um assistente clínico veterinário especializado em equinos.
Analise o texto de evolução clínica abaixo e extraia APENAS as ações concretas que o veterinário mencionou realizar: medicamentos prescritos, procedimentos realizados ou solicitados, exames solicitados, vacinas aplicadas e encaminhamentos indicados.

Retorne SOMENTE um JSON válido, sem texto adicional, sem markdown, sem \`\`\`:
{
  "acoes": [
    {
      "tipo": "MEDICAMENTO" | "PROCEDIMENTO" | "EXAME" | "VACINA" | "ENCAMINHAMENTO",
      "descricao": "descrição clara e objetiva",
      "valorEstimado": 0.00,
      "quantidade": 1
    }
  ]
}

Regras:
- Se não houver ações concretas, retorne { "acoes": [] }
- valorEstimado deve ser um número (use 0.00 se não mencionado)
- quantidade deve ser um número inteiro
- descricao deve incluir dosagem quando mencionada (ex: "Calcidrato 30ml IV")
- Ignore sintomas, observações e diagnósticos — extraia apenas AÇÕES`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — registrar audit log
// ─────────────────────────────────────────────────────────────────────────────

async function registrarAuditoria(userId, userName, email, action) {
  try {
    await prisma.auditLog.create({
      data: { userId, userName, email, action, timestamp: new Date() },
    });
  } catch (err) {
    // Auditoria nunca bloqueia o fluxo principal
    console.error('Erro ao registrar auditoria:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

const EvolucaoController = {

  // ── Listar evoluções de um animal ────────────────────────────────────────
  // GET /clinica/evolucoes/animal/:animalId
  // Query: page, limit, status, dataInicio, dataFim, responsavelId

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
      const [evolucoes, total] = await Promise.all([
        prisma.evolucaoClinica.findMany({
          where,
          skip,
          take:    Number(limit),
          orderBy: { dataInicio: 'desc' },
          include: {
            veterinario:   { select: { id: true, fullName: true } },
            modificadoPor: { select: { id: true, fullName: true } },
          },
        }),
        prisma.evolucaoClinica.count({ where }),
      ]);

      res.json({ sucesso: true, dados: evolucoes, total });
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
          veterinario:   { select: { id: true, fullName: true } },
          modificadoPor: { select: { id: true, fullName: true } },
          animal:        { select: { id: true, nome: true } },
        },
      });

      if (!evolucao || !evolucao.ativo) {
        return res.status(404).json({ sucesso: false, mensagem: 'Evolução não encontrada' });
      }

      res.json({ sucesso: true, dados: evolucao });
    } catch (error) {
      console.error('Erro ao obter evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Criar evolução ────────────────────────────────────────────────────────
  // POST /clinica/evolucoes

  criar: async (req, res) => {
    const { animalId, especialidade, texto, status = 'EM_ANDAMENTO' } = req.body;
    const userId = req.user.id;

    if (!animalId)      return res.status(400).json({ sucesso: false, mensagem: 'Animal é obrigatório' });
    if (!especialidade) return res.status(400).json({ sucesso: false, mensagem: 'Especialidade é obrigatória' });
    if (!texto?.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Texto da evolução é obrigatório' });

    try {
      // Verifica se o animal existe e o usuário tem acesso
      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { id: true, nome: true },
      });

      if (!animal) {
        return res.status(404).json({ sucesso: false, mensagem: 'Animal não encontrado' });
      }

      const evolucao = await prisma.evolucaoClinica.create({
        data: {
          animalId:      Number(animalId),
          veterinarioId: userId,
          especialidade,
          texto:         texto.trim(),
          status,
          dataInicio:    new Date(),
          dataFim:       status === 'FINALIZADA' ? new Date() : null,
          aprovado:      true, // estagiários podem requerer aprovação futuramente
          ativo:         true,
        },
        include: {
          veterinario:   { select: { id: true, fullName: true } },
          modificadoPor: { select: { id: true, fullName: true } },
        },
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_CRIADA | id=${evolucao.id} | animal=${animalId} | status=${status}`
      );

      res.status(201).json({ sucesso: true, dados: evolucao });
    } catch (error) {
      console.error('Erro ao criar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  // ── Atualizar evolução ────────────────────────────────────────────────────
  // PUT /clinica/evolucoes/:id
  //
  // Regras:
  //  - FINALIZADA não pode ser editada
  //  - O vet que edita assume a responsabilidade (veterinarioId = req.user.id)
  //  - Toda alteração é registrada em auditoria

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

      if (existente.status === 'FINALIZADA') {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Evoluções finalizadas não podem ser editadas',
        });
      }

      // Vet que edita assume a responsabilidade
      const novoResponsavelId = userId;

      const atualizada = await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          especialidade:    especialidade ?? existente.especialidade,
          texto:            texto?.trim() ?? existente.texto,
          status:           status        ?? existente.status,
          veterinarioId:    novoResponsavelId,
          modificadoPorId:  userId,
          dataModificacao:  new Date(),
          // Seta dataFim quando muda para FINALIZADA
          dataFim: (status === 'FINALIZADA' && !existente.dataFim)
            ? new Date()
            : existente.dataFim,
        },
        include: {
          veterinario:   { select: { id: true, fullName: true } },
          modificadoPor: { select: { id: true, fullName: true } },
        },
      });

      await registrarAuditoria(
        userId,
        req.user.fullName,
        req.user.email,
        `EVOLUCAO_EDITADA | id=${id} | animal=${existente.animalId} | status=${status ?? existente.status} | responsavelAnterior=${existente.veterinarioId} | responsavelNovo=${novoResponsavelId}`
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

      if (existente.status === 'FINALIZADA' && req.user.role !== 'ADMIN') {
        return res.status(403).json({
          sucesso:  false,
          mensagem: 'Apenas administradores podem excluir evoluções finalizadas',
        });
      }

      // Soft delete — preserva para auditoria
      await prisma.evolucaoClinica.update({
        where: { id: Number(id) },
        data: {
          ativo:                 false,
          justificativaExclusao: justificativa.trim(),
          modificadoPorId:       userId,
          dataModificacao:       new Date(),
        },
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
        include: {
          veterinario: { select: { id: true, fullName: true } },
        },
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

  // ── Interpretar texto com LLM (Groq) ──────────────────────────────────────
  // POST /clinica/evolucoes/interpretar
  // Body: { texto }
  //
  // Detecta ações clínicas (medicamentos, procedimentos, exames, etc.)
  // e retorna lista estruturada para o frontend apresentar ao usuário.

  interpretar: async (req, res) => {
    const { texto } = req.body;
    const userId    = req.user.id;

    if (!texto?.trim()) {
      return res.status(400).json({ sucesso: false, mensagem: 'Texto é obrigatório' });
    }

    const inicio = Date.now();

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          model:      'llama-3.3-70b-versatile',
          temperature: 0.1,
          max_tokens:  1000,
          messages: [
            { role: 'system', content: PROMPT_INTERPRETACAO },
            { role: 'user',   content: texto.trim() },
          ],
        }),
      });

      if (!response.ok) {
        const erro = await response.text();
        console.error('Groq API erro:', erro);
        return res.status(502).json({ sucesso: false, mensagem: 'Erro ao chamar serviço de IA' });
      }

      const groqData = await response.json();
      const latencia = Date.now() - inicio;

      const conteudo  = groqData.choices?.[0]?.message?.content ?? '{"acoes":[]}';
      const tokens    = groqData.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      // Parse seguro do JSON retornado pelo LLM
      let acoes = [];
      try {
        const limpo  = conteudo.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(limpo);
        acoes = Array.isArray(parsed.acoes) ? parsed.acoes : [];
      } catch (parseErr) {
        console.error('Erro ao parsear resposta LLM:', parseErr, conteudo);
        acoes = [];
      }

      // Registrar uso de IA para monitoramento
      try {
        await prisma.aiUsageLog.create({
          data: {
            operacao:     'INTERPRETAR_EVOLUCAO',
            modelo:       'llama-3.3-70b-versatile',
            provedor:     'groq',
            tokensEntrada: tokens.prompt_tokens,
            tokensSaida:   tokens.completion_tokens,
            tokensTotal:   tokens.total_tokens,
            custoUsd:      tokens.total_tokens * 0.00000059, // preço aproximado llama-3.3-70b
            latenciaMs:    latencia,
            userId:        userId,
            sucesso:       true,
          },
        });
      } catch (logErr) {
        console.error('Erro ao registrar AI log:', logErr);
      }

      res.json({ sucesso: true, dados: { acoes } });
    } catch (error) {
      console.error('Erro ao interpretar evolução:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao interpretar evolução' });
    }
  },

  // ── Transcrever áudio com Groq Whisper ────────────────────────────────────
  // POST /clinica/evolucoes/transcrever
  // multipart/form-data: audio (arquivo)
  //
  // Usado quando o dispositivo está online.
  // Quando offline, o frontend usa Whisper local (whisperService.ts).

  transcrever: async (req, res) => {
    const fs     = require('fs');
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

      // Remove arquivo temporário
      try { fs.unlinkSync(req.file.path); } catch {}

      // Registrar uso de IA
      try {
        await prisma.aiUsageLog.create({
          data: {
            operacao:      'TRANSCRICAO_AUDIO',
            modelo:        'whisper-large-v3',
            provedor:      'groq',
            tokensEntrada: 0,
            tokensSaida:   0,
            tokensTotal:   0,
            custoUsd:      0.0, // Whisper tem preço por minuto, não por token
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
      // Limpeza do arquivo temporário em caso de erro
      if (req.file?.path) {
        try { require('fs').unlinkSync(req.file.path); } catch {}
      }
      console.error('Erro ao transcrever áudio:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro na transcrição do áudio' });
    }
  },

};

module.exports = EvolucaoController;