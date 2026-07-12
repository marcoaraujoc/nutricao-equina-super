// backend/src/controllers/EncaminhamentoController.js
// Encaminhamentos clínicos — destino pode ser um prestador da equipe (User FORNECEDOR)
// ou um profissional externo (texto livre). Encaminhar para prestador da equipe cria/
// reativa uma DesignacaoPrestador, que é o escopo de acesso do prestador ao animal.

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { formatAtendimentoNum, getOrCreateFatura, adicionarFaturaItem, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const { podeOperarRegistro } = require('../middlewares/permissao.middleware');

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
  prestador:   { select: { id: true, fullName: true } },
};

const STATUS_VALIDOS = ['PENDENTE', 'CONCLUIDO', 'CANCELADO'];

/**
 * Resolve as equipes do escopo do animal:
 *  - animal.equipeId definido → só ela
 *  - senão, todas as equipes da empresa do animal (legado sem equipeId)
 *  - senão, a equipe do contexto ativo (paciente pessoal do vet)
 */
async function getEquipeIdsDoAnimal(animal, reqEquipeId) {
  if (animal.equipeId) return [animal.equipeId];
  if (animal.empresaId) {
    const equipes = await prisma.equipe.findMany({
      where:  { empresaId: animal.empresaId },
      select: { id: true },
    });
    return equipes.map(e => e.id);
  }
  return reqEquipeId ? [Number(reqEquipeId)] : [];
}

const EncaminhamentoController = {

  // GET /clinica/encaminhamentos/:id
  obterPorId: async (req, res) => {
    try {
      const item = await prisma.encaminhamentoClinico.findUnique({
        where:   { id: Number(req.params.id) },
        include: INCLUDE,
      });
      if (!item) return res.status(404).json({ error: 'Encaminhamento não encontrado' });
      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao obter encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao obter encaminhamento' });
    }
  },

  // GET /clinica/encaminhamentos/animal/:animalId
  listarPorAnimal: async (req, res) => {
    try {
      const { animalId } = req.params;
      const { status } = req.query;

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const where = { animalId: Number(animalId), ativo: true };
      if (status && status !== 'TODOS') where.status = status;
      // Segregação multi-clínica: cada empresa vê só os próprios encaminhamentos
      where.AND = [escopoFilhoEvolucaoWhere(req)];

      const [items, total] = await Promise.all([
        prisma.encaminhamentoClinico.findMany({
          where,
          include: INCLUDE,
          orderBy: { dataEncaminhamento: 'desc' },
        }),
        prisma.encaminhamentoClinico.count({ where }),
      ]);

      res.json({ dados: items, total });
    } catch (err) {
      console.error('Erro ao listar encaminhamentos:', err);
      res.status(500).json({ error: 'Erro ao listar encaminhamentos' });
    }
  },

  // GET /clinica/encaminhamentos/prestadores/:animalId
  // Fornecedores (cargo FORNECEDOR) das equipes do escopo do animal, com a
  // especialidade (tipoServico) do cadastro Fornecedor vinculado ao login.
  listarPrestadores: async (req, res) => {
    try {
      const { animalId } = req.params;

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const animal = await prisma.animal.findUnique({
        where:  { id: Number(animalId) },
        select: { equipeId: true, empresaId: true },
      });
      if (!animal) return res.status(404).json({ error: 'Animal não encontrado' });

      const equipeIds = await getEquipeIdsDoAnimal(animal, req.equipeId);

      const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

      const [membros, servicosFornecedor] = await Promise.all([
        equipeIds.length === 0
          ? Promise.resolve([])
          : prisma.membroEquipe.findMany({
              where: {
                equipeId: { in: equipeIds },
                OR: [{ cargo: 'FORNECEDOR' }, { cargos: { has: 'FORNECEDOR' } }],
                user: { ativo: true },
              },
              select: {
                equipeId: true,
                user: { select: { id: true, fullName: true, email: true, phone: true } },
              },
            }),
        prisma.fornecedor.findMany({
          where: {
            ativo: true,
            tipoEntrada: 'CLIENTE',
            empresaId: req.empresaId ?? null,
          },
          select: { tipoServico: true },
        }),
      ]);

      const EXCLUIR_SERVICOS = new Set([
        'clinico', 'clinica', 'farmacia', 'loja', 'supermercado', 'laboratorio',
      ]);

      const servicosSet = new Set();
      for (const f of servicosFornecedor) {
        if (!f.tipoServico) continue;
        for (const s of f.tipoServico.split(',')) {
          const nome = s.trim();
          if (nome && !EXCLUIR_SERVICOS.has(normalizar(nome))) servicosSet.add(nome);
        }
      }
      const servicosDisponiveis = [...servicosSet]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));

      if (equipeIds.length === 0) return res.json({ dados: [], servicosDisponiveis });

      const userIds = [...new Set(membros.map(m => m.user.id))];

      const [fornecedores, designacoes] = await Promise.all([
        prisma.fornecedor.findMany({
          where:  { userId: { in: userIds } },
          select: { userId: true, tipoServico: true },
        }),
        prisma.designacaoPrestador.findMany({
          where:  { animalId: Number(animalId), prestadorId: { in: userIds }, ativo: true },
          select: { prestadorId: true },
        }),
      ]);

      const tipoPorUser  = new Map(fornecedores.map(f => [f.userId, f.tipoServico]));
      const designadoSet = new Set(designacoes.map(d => d.prestadorId));

      const vistos = new Set();
      const dados  = [];
      for (const m of membros) {
        if (vistos.has(m.user.id)) continue;
        vistos.add(m.user.id);
        dados.push({
          userId:      m.user.id,
          fullName:    m.user.fullName,
          email:       m.user.email,
          phone:       m.user.phone,
          tipoServico: tipoPorUser.get(m.user.id) ?? null,
          equipeId:    m.equipeId,
          jaDesignado: designadoSet.has(m.user.id),
        });
      }
      dados.sort((a, b) => a.fullName.localeCompare(b.fullName));

      res.json({ dados, servicosDisponiveis });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ error: 'Erro ao listar prestadores' });
    }
  },

  // POST /clinica/encaminhamentos
  // body: { animalId, especialidade, motivo, evolucaoId, prestadorId?, veterinarioDestino?,
  //         clinicaDestino?, urgencia?, observacao?, valor? }
  // prestadorId presente → cria/reativa DesignacaoPrestador (acesso do prestador ao animal)
  criar: async (req, res) => {
    try {
      const {
        animalId, especialidade, motivo, evolucaoId, prestadorId,
        veterinarioDestino, clinicaDestino, urgencia = 'NORMAL', observacao, valor,
      } = req.body;

      if (!animalId || !especialidade || !motivo) {
        return res.status(400).json({ error: 'animalId, especialidade e motivo são obrigatórios' });
      }
      if (!evolucaoId) {
        return res.status(400).json({ error: 'evolucaoId é obrigatório', code: 'EVOLUCAO_REQUIRED' });
      }

      // Valida que a evolução existe e pertence ao animal
      const evolucao = await prisma.evolucaoClinica.findFirst({
        where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
        select: { id: true, numero: true, tipoAtendimento: true },
      });
      if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal', code: 'EVOLUCAO_NOT_FOUND' });

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      let equipeDesignacao = null;
      if (prestadorId) {
        const animal = await prisma.animal.findUnique({
          where:  { id: Number(animalId) },
          select: { equipeId: true, empresaId: true },
        });
        const equipeIds = await getEquipeIdsDoAnimal(animal, req.equipeId);

        const memberships = await prisma.membroEquipe.findMany({
          where: {
            userId:   Number(prestadorId),
            equipeId: { in: equipeIds.length ? equipeIds : [-1] },
            OR: [{ cargo: 'FORNECEDOR' }, { cargos: { has: 'FORNECEDOR' } }],
          },
          select: { equipeId: true },
        });
        if (memberships.length === 0) {
          return res.status(400).json({ error: 'Fornecedor não é membro FORNECEDOR de uma equipe deste animal' });
        }
        // Preferir a equipe do animal quando o prestador pertence a ela
        equipeDesignacao =
          memberships.find(m => m.equipeId === animal.equipeId)?.equipeId
          ?? memberships[0].equipeId;
      }

      const resultado = await prisma.$transaction(async (tx) => {
        const enc = await tx.encaminhamentoClinico.create({
          data: {
            animalId:           Number(animalId),
            veterinarioId:      req.user.id,
            prestadorId:        prestadorId ? Number(prestadorId) : null,
            evolucaoId:         Number(evolucaoId),
            especialidade,
            motivo,
            veterinarioDestino: veterinarioDestino || null,
            clinicaDestino:     clinicaDestino || null,
            urgencia,
            observacao:         observacao || null,
          },
          include: INCLUDE,
        });

        if (prestadorId && equipeDesignacao) {
          await tx.designacaoPrestador.upsert({
            where: {
              animalId_prestadorId_equipeId: {
                animalId:    Number(animalId),
                prestadorId: Number(prestadorId),
                equipeId:    equipeDesignacao,
              },
            },
            update: {
              ativo:            true,
              dataFim:          null,
              encaminhamentoId: enc.id,
              motivo:           especialidade,
              criadoPorId:      req.user.id,
            },
            create: {
              animalId:         Number(animalId),
              prestadorId:      Number(prestadorId),
              equipeId:         equipeDesignacao,
              encaminhamentoId: enc.id,
              motivo:           especialidade,
              criadoPorId:      req.user.id,
            },
          });
        }

        // Lança na fatura se valor fornecido
        if (valor && Number(valor) > 0) {
          const animal = await tx.animal.findUnique({
            where:  { id: Number(animalId) },
            select: { userId: true },
          });
          if (animal?.userId) {
            const atendNum  = formatAtendimentoNum(evolucao.tipoAtendimento, evolucao.numero);
            const destino   = prestadorId
              ? (enc.prestador?.fullName ?? especialidade)
              : (veterinarioDestino || clinicaDestino || 'externo');
            const descricao = `[${atendNum}] ${especialidade} — ${destino}`;
            const fatura    = await getOrCreateFatura(tx, animal.userId);
            await adicionarFaturaItem(tx, {
              faturaId:     fatura.id,
              animalId:     Number(animalId),
              tipo:         'ENCAMINHAMENTO',
              descricao,
              valor:        Number(valor),
              quantidade:   1,
              veterinarioId: req.user.id,
              encaminhamentoClinicoId: enc.id,
            });
          }
        }

        return enc;
      });

      res.status(201).json({ dados: resultado });
    } catch (err) {
      console.error('Erro ao criar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao criar encaminhamento' });
    }
  },

  // PATCH /clinica/encaminhamentos/:id/status
  // body: { status: 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO' }
  // CONCLUIDO/CANCELADO inativam a designação criada por este encaminhamento;
  // voltar a PENDENTE reativa.
  atualizarStatus: async (req, res) => {
    try {
      const { id }             = req.params;
      const { status, motivo } = req.body;

      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
      }

      // Cancelamento exige justificativa (auditoria)
      if (status === 'CANCELADO' && !motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });
      }

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where:   { id: enc.id },
          data:    { status },
          include: INCLUDE,
        });

        if (enc.prestadorId) {
          const encerrado = status === 'CONCLUIDO' || status === 'CANCELADO';
          await tx.designacaoPrestador.updateMany({
            where: { encaminhamentoId: enc.id },
            data:  encerrado
              ? { ativo: false, dataFim: new Date() }
              : { ativo: true,  dataFim: null },
          });
        }

        if (status === 'CANCELADO') {
          await registrarAuditoria(tx, req, {
            categoria:  'CANCELAMENTO',
            entidade:   'ENCAMINHAMENTO',
            entidadeId: enc.id,
            animalId:   enc.animalId,
            motivo,
            detalhes:   [enc.especialidade, enc.motivo].filter(Boolean).join(' — ') || null,
          });
        }

        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar status do encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar status' });
    }
  },

  // PUT /clinica/encaminhamentos/:id — edita campos textuais (só PENDENTE)
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const { especialidade, motivo, urgencia, observacao, veterinarioDestino, clinicaDestino } = req.body;

      const enc = await prisma.encaminhamentoClinico.findUnique({
        where:   { id: Number(id) },
        include: {
          evolucao:  { select: { numero: true, tipoAtendimento: true } },
          prestador: { select: { fullName: true } },
        },
      });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      if (enc.status !== 'PENDENTE') {
        return res.status(400).json({ error: 'Apenas encaminhamentos pendentes podem ser editados' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req.permissaoNivel, enc.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite editar encaminhamentos criados por você.' });
      }

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where: { id: enc.id },
          data: {
            ...(especialidade      !== undefined && { especialidade }),
            ...(motivo             !== undefined && { motivo }),
            ...(urgencia           !== undefined && { urgencia }),
            ...(observacao         !== undefined && { observacao }),
            ...(veterinarioDestino !== undefined && { veterinarioDestino }),
            ...(clinicaDestino     !== undefined && { clinicaDestino }),
          },
          include: INCLUDE,
        });

        // Especialidade/destino mudaram → sincroniza a descrição do FaturaItem vinculado
        // (se houver). Bloqueia (lança FaturaPagaError) se a fatura já estiver PAGA.
        const descricaoAfetada = especialidade !== undefined || veterinarioDestino !== undefined || clinicaDestino !== undefined;
        if (descricaoAfetada && enc.evolucao) {
          const especialidadeFinal      = especialidade      !== undefined ? especialidade      : enc.especialidade;
          const veterinarioDestinoFinal = veterinarioDestino  !== undefined ? veterinarioDestino  : enc.veterinarioDestino;
          const clinicaDestinoFinal     = clinicaDestino      !== undefined ? clinicaDestino      : enc.clinicaDestino;

          const atendNum = formatAtendimentoNum(enc.evolucao.tipoAtendimento, enc.evolucao.numero);
          const destino  = enc.prestadorId
            ? (enc.prestador?.fullName ?? especialidadeFinal)
            : (veterinarioDestinoFinal || clinicaDestinoFinal || 'externo');
          const descricao = `[${atendNum}] ${especialidadeFinal} — ${destino}`;

          await atualizarFaturaItensDaOrigem(tx, 'encaminhamentoClinicoId', enc.id, { descricao });
        }

        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao atualizar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar encaminhamento' });
    }
  },

  // PATCH /clinica/encaminhamentos/:id/finalizar — CONCLUIDO com regra de autoria
  // GESTOR: finaliza qualquer encaminhamento (bypass via checkPermission)
  // FORNECEDOR: finaliza apenas os que ele criou (veterinarioId check)
  finalizar: async (req, res) => {
    try {
      const { id } = req.params;

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.finalizar)
      if (!podeOperarRegistro(req.permissaoNivel, enc.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar encaminhamentos criados por você.' });
      }

      if (enc.status === 'CONCLUIDO') {
        return res.status(400).json({ error: 'Encaminhamento já está concluído.' });
      }

      const atualizado = await prisma.$transaction(async (tx) => {
        const upd = await tx.encaminhamentoClinico.update({
          where:   { id: enc.id },
          data:    { status: 'CONCLUIDO' },
          include: INCLUDE,
        });
        if (enc.prestadorId) {
          await tx.designacaoPrestador.updateMany({
            where: { encaminhamentoId: enc.id },
            data:  { ativo: false, dataFim: new Date() },
          });
        }
        return upd;
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao finalizar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao finalizar encaminhamento' });
    }
  },

  // DELETE /clinica/encaminhamentos/:id — soft delete + inativa designação vinculada
  excluir: async (req, res) => {
    try {
      const { id }     = req.params;
      const { motivo } = req.body ?? {};

      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      // Autoria via RBAC (nível efetivo em atendimento.encaminhamentos.deletar)
      if (!podeOperarRegistro(req.permissaoNivel, enc.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite excluir encaminhamentos criados por você.' });
      }

      await prisma.$transaction(async (tx) => {
        // Remove o FaturaItem vinculado, se houver. Bloqueia (lança FaturaPagaError)
        // se a fatura de destino já estiver PAGA.
        await removerFaturaItensDaOrigem(tx, 'encaminhamentoClinicoId', enc.id);
        await tx.encaminhamentoClinico.update({ where: { id: enc.id }, data: { ativo: false } });
        await tx.designacaoPrestador.updateMany({
          where: { encaminhamentoId: enc.id, ativo: true },
          data:  { ativo: false, dataFim: new Date() },
        });

        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'ENCAMINHAMENTO',
          entidadeId: enc.id,
          animalId:   enc.animalId,
          motivo,
          detalhes:   [enc.especialidade, enc.motivo].filter(Boolean).join(' — ') || null,
        });
      });

      res.json({ dados: { id: enc.id, excluido: true } });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao excluir encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao excluir encaminhamento' });
    }
  },
};

module.exports = EncaminhamentoController;
