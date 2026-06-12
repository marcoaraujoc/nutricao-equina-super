// backend/src/controllers/AgendamentoController.js
// Agendamentos do animal (consulta, vacina, retorno, exame, procedimento).
// Exibidos no painel "Agendamentos" da tela do animal (AnimalDetail).

const prisma = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');

const TIPOS_VALIDOS  = ['CONSULTA', 'VACINA', 'RETORNO', 'EXAME', 'PROCEDIMENTO'];
const STATUS_VALIDOS = ['AGENDADO', 'CONCLUIDO', 'CANCELADO'];
// Proprietário e fornecedor visualizam; quem agenda é a equipe clínica
const PODE_GERENCIAR = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO'];

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

function podeGerenciar(user) {
  return user.role === 'ADMIN' || PODE_GERENCIAR.includes(user.userType);
}

const AgendamentoController = {

  // GET /clinica/agendamentos/animal/:animalId?futuros=1
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);

      const acesso = await verificarAcessoAnimal({ animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const where = { animalId, ativo: true };
      if (req.query.futuros === '1') {
        where.status   = 'AGENDADO';
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        where.dataHora = { gte: hoje };
      }

      const itens = await prisma.agendamentoClinico.findMany({
        where,
        include: INCLUDE,
        orderBy: { dataHora: 'asc' },
      });

      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar agendamentos:', err);
      res.status(500).json({ error: 'Erro ao listar agendamentos' });
    }
  },

  // POST /clinica/agendamentos
  // body: { animalId, tipo, titulo, dataHora, observacao?, veterinarioId? }
  criar: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para criar agendamentos' });
      }

      const { animalId, tipo = 'CONSULTA', titulo, dataHora, observacao, veterinarioId } = req.body;

      if (!animalId || !titulo?.trim() || !dataHora) {
        return res.status(400).json({ error: 'animalId, titulo e dataHora são obrigatórios' });
      }
      if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: `tipo deve ser um de: ${TIPOS_VALIDOS.join(', ')}` });
      }
      const quando = new Date(dataHora);
      if (isNaN(quando.getTime())) {
        return res.status(400).json({ error: 'dataHora inválida' });
      }

      const acesso = await verificarAcessoAnimal({ animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const item = await prisma.agendamentoClinico.create({
        data: {
          animalId:      Number(animalId),
          tipo,
          titulo:        titulo.trim(),
          dataHora:      quando,
          observacao:    observacao?.trim() || null,
          veterinarioId: veterinarioId
            ? Number(veterinarioId)
            : (req.user.userType === 'VETERINARIO' ? req.user.id : null),
          criadoPorId:   req.user.id,
        },
        include: INCLUDE,
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar agendamento:', err);
      res.status(500).json({ error: 'Erro ao criar agendamento' });
    }
  },

  // PATCH /clinica/agendamentos/:id/status — body: { status }
  atualizarStatus: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para alterar agendamentos' });
      }

      const { status } = req.body;
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ error: `status deve ser um de: ${STATUS_VALIDOS.join(', ')}` });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      const atualizado = await prisma.agendamentoClinico.update({
        where:   { id: item.id },
        data:    { status },
        include: INCLUDE,
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar agendamento:', err);
      res.status(500).json({ error: 'Erro ao atualizar agendamento' });
    }
  },

  // DELETE /clinica/agendamentos/:id — soft delete
  excluir: async (req, res) => {
    try {
      if (!podeGerenciar(req.user)) {
        return res.status(403).json({ error: 'Sem permissão para excluir agendamentos' });
      }

      const item = await prisma.agendamentoClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const acesso = await verificarAcessoAnimal({ animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado a este animal' });

      await prisma.agendamentoClinico.update({ where: { id: item.id }, data: { ativo: false } });

      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir agendamento:', err);
      res.status(500).json({ error: 'Erro ao excluir agendamento' });
    }
  },
};

module.exports = AgendamentoController;
