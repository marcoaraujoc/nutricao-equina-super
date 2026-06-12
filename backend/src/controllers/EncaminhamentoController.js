// backend/src/controllers/EncaminhamentoController.js
// Encaminhamentos clínicos — destino pode ser um prestador da equipe (User FORNECEDOR)
// ou um profissional externo (texto livre). Encaminhar para prestador da equipe cria/
// reativa uma DesignacaoPrestador, que é o escopo de acesso do prestador ao animal.

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');

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
  // Prestadores (cargo PRESTADOR) das equipes do escopo do animal, com a
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
      if (equipeIds.length === 0) return res.json({ dados: [] });

      const membros = await prisma.membroEquipe.findMany({
        where: {
          equipeId: { in: equipeIds },
          OR: [{ cargo: 'PRESTADOR' }, { cargos: { has: 'PRESTADOR' } }],
          user: { ativo: true },
        },
        select: {
          equipeId: true,
          user: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      });

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

      res.json({ dados });
    } catch (err) {
      console.error('Erro ao listar prestadores:', err);
      res.status(500).json({ error: 'Erro ao listar prestadores' });
    }
  },

  // POST /clinica/encaminhamentos
  // body: { animalId, especialidade, motivo, prestadorId?, veterinarioDestino?,
  //         clinicaDestino?, urgencia?, observacao? }
  // prestadorId presente → cria/reativa DesignacaoPrestador (acesso do prestador ao animal)
  criar: async (req, res) => {
    try {
      const {
        animalId, especialidade, motivo, prestadorId,
        veterinarioDestino, clinicaDestino, urgencia = 'NORMAL', observacao,
      } = req.body;

      if (!animalId || !especialidade || !motivo) {
        return res.status(400).json({ error: 'animalId, especialidade e motivo são obrigatórios' });
      }

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
            OR: [{ cargo: 'PRESTADOR' }, { cargos: { has: 'PRESTADOR' } }],
          },
          select: { equipeId: true },
        });
        if (memberships.length === 0) {
          return res.status(400).json({ error: 'Prestador não é membro PRESTADOR de uma equipe deste animal' });
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
      const { id }     = req.params;
      const { status } = req.body;

      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
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

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      if (enc.status !== 'PENDENTE') {
        return res.status(400).json({ error: 'Apenas encaminhamentos pendentes podem ser editados' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const atualizado = await prisma.encaminhamentoClinico.update({
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

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar encaminhamento' });
    }
  },

  // DELETE /clinica/encaminhamentos/:id — soft delete + inativa designação vinculada
  excluir: async (req, res) => {
    try {
      const { id } = req.params;

      const enc = await prisma.encaminhamentoClinico.findUnique({ where: { id: Number(id) } });
      if (!enc || !enc.ativo) return res.status(404).json({ error: 'Encaminhamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: enc.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      await prisma.$transaction(async (tx) => {
        await tx.encaminhamentoClinico.update({ where: { id: enc.id }, data: { ativo: false } });
        await tx.designacaoPrestador.updateMany({
          where: { encaminhamentoId: enc.id, ativo: true },
          data:  { ativo: false, dataFim: new Date() },
        });
      });

      res.json({ dados: { id: enc.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir encaminhamento:', err);
      res.status(500).json({ error: 'Erro ao excluir encaminhamento' });
    }
  },
};

module.exports = EncaminhamentoController;
