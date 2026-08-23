const prisma = require('../lib/prisma').default;
const { corteDePropriedade } = require('../lib/animalPropriedadeCorte');
const { registrarAuditoria } = require('../lib/auditoria');
// ISOLAMENTO ENTRE EMPRESAS: `checkPermission` na rota diz SE a pessoa lê/edita dieta,
// nunca SOBRE QUAL paciente. Nas rotas com :animalId o guard é middleware; aqui, nas
// rotas por :id do plano/item, o animal só aparece depois de carregar o registro —
// por isso a checagem vem logo após o findUnique e ANTES de responder qualquer dado.
const { garantirAcessoAnimal } = require('../middlewares/animalAcesso.middleware');
const { animalEstaInativo }    = require('../lib/animalInativo');
const { animalFoiExcluido }    = require('../lib/animalAtivacao');

// =============================================================================
// PLANOS DE DIETA
// =============================================================================

const PlanoDietaController = {

  listarPorAnimal: async (req, res) => {
    const { animalId } = req.params;
    const { ativo } = req.query; // ?ativo=true|false (opcional)

    try {
      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê planos criados a
      // partir de `propriedadeDesde`; GESTOR/VET/ADMIN veem tudo.
      const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);

      const where = { animalId: Number(animalId), ...(corte ? { dataCriacao: { gte: corte } } : {}) };
      if (ativo !== undefined) where.ativo = ativo === 'true';

      const planos = await prisma.planoDieta.findMany({
        where,
        include: {
          _count: { select: { itens: true } }
        },
        orderBy: [{ ativo: 'asc' }, { dataCriacao: 'desc' }]
      });

      res.json({ sucesso: true, dados: planos });
    } catch (error) {
      console.error('Erro ao listar planos de dieta:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao listar planos de dieta' });
    }
  },

  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const plano = await prisma.planoDieta.findUnique({
        where: { id: Number(id) },
        include: {
          itens: {
            include: { alimento: true },
            orderBy: { horario: 'asc' }
          }
        }
      });

      if (!plano) return res.status(404).json({ sucesso: false, mensagem: 'Plano de dieta não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, plano.animalId))) return;

      res.json({ sucesso: true, dados: plano });
    } catch (error) {
      console.error('Erro ao obter plano de dieta:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  criar: async (req, res) => {
    const { animalId, nome } = req.body;

    if (!animalId) return res.status(400).json({ sucesso: false, mensagem: 'animalId é obrigatório' });
    if (!nome || !nome.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome do plano é obrigatório' });

    try {
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ sucesso: false, mensagem: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }
      const plano = await prisma.planoDieta.create({
        data: {
          animalId: Number(animalId),
          nome: nome.trim(),
          ativo: true
        }
      });

      res.status(201).json({ sucesso: true, dados: plano });
    } catch (error) {
      console.error('Erro ao criar plano de dieta:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro ao criar plano de dieta' });
    }
  },

  atualizar: async (req, res) => {
    const { id } = req.params;
    const { nome } = req.body;

    if (!nome || !nome.trim()) return res.status(400).json({ sucesso: false, mensagem: 'Nome é obrigatório' });

    try {
      const existe = await prisma.planoDieta.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, existe.animalId))) return;

      const plano = await prisma.planoDieta.update({
        where: { id: Number(id) },
        data: { nome: nome.trim() }
      });

      res.json({ sucesso: true, dados: plano });
    } catch (error) {
      console.error('Erro ao atualizar plano de dieta:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  toggleAtivo: async (req, res) => {
    const { id } = req.params;
    try {
      const plano = await prisma.planoDieta.findUnique({ where: { id: Number(id) } });
      if (!plano) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, plano.animalId))) return;

      if (!plano.ativo) {
        await prisma.planoDieta.updateMany({
          where: { animalId: plano.animalId, id: { not: Number(id) } },
          data: { ativo: false },
        });
      }

      const atualizado = await prisma.planoDieta.update({
        where: { id: Number(id) },
        data: { ativo: !plano.ativo }
      });

      res.json({ sucesso: true, dados: atualizado });
    } catch (error) {
      console.error('Erro ao alterar status do plano:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  excluir: async (req, res) => {
    const { id } = req.params;
    try {
      const existe = await prisma.planoDieta.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, existe.animalId))) return;

      // Remove os itens vinculados antes de excluir o plano
      await prisma.dieta.deleteMany({ where: { planoDietaId: Number(id) } });
      await prisma.planoDieta.delete({ where: { id: Number(id) } });

      res.json({ sucesso: true, mensagem: 'Plano excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir plano:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  buscar: async (req, res) => {
    const { animalId } = req.params;
    const { q, ativo } = req.query;

    try {
      const where = { animalId: Number(animalId) };
      if (q) where.nome = { contains: q };
      if (ativo !== undefined) where.ativo = ativo === 'true';

      const planos = await prisma.planoDieta.findMany({
        where,
        include: { _count: { select: { itens: true } } },
        orderBy: [{ ativo: 'desc' }, { dataCriacao: 'desc' }]
      });

      res.json({ sucesso: true, dados: planos });
    } catch (error) {
      console.error('Erro ao buscar planos:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  }
};

// =============================================================================
// ITENS DA DIETA
// =============================================================================

const DietaItemController = {

  listarPorAnimal: async (req, res) => {
    const { animalId } = req.params;
    try {
      // Transferência de Propriedade — o PROPRIETÁRIO atual só vê itens criados a
      // partir de `propriedadeDesde`; GESTOR/VET/ADMIN veem tudo.
      const animalCorte = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { propriedadeDesde: true } });
      const corte = corteDePropriedade(req, animalCorte);

      const dietas = await prisma.dieta.findMany({
        where: { animalId: Number(animalId), ...(corte ? { dataCriacao: { gte: corte } } : {}) },
        include: {
          alimento: true,
          animal: {
            include: {
              user: { select: { fullName: true, email: true } },
              raca: true,
              especie: true
            }
          },
          plano: { select: { id: true, nome: true, ativo: true } }
        },
        orderBy: { dataCriacao: 'desc' }
      });
      res.json(dietas);
    } catch (error) {
      console.error('Erro ao listar itens da dieta:', error);
      res.status(500).json({ error: 'Erro ao listar dieta do animal' });
    }
  },

  listarPorPlano: async (req, res) => {
    const { planoDietaId } = req.params;
    try {
      const plano = await prisma.planoDieta.findUnique({
        where:  { id: Number(planoDietaId) },
        select: { animalId: true },
      });
      if (!plano) return res.status(404).json({ sucesso: false, mensagem: 'Plano não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, plano.animalId))) return;

      const itens = await prisma.dieta.findMany({
        where: { planoDietaId: Number(planoDietaId) },
        include: { alimento: true },
        orderBy: { horario: 'asc' }
      });
      res.json({ sucesso: true, dados: itens });
    } catch (error) {
      console.error('Erro ao listar itens do plano:', error);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },

  obterPorId: async (req, res) => {
    const { id } = req.params;
    try {
      const dieta = await prisma.dieta.findUnique({
        where: { id: Number(id) },
        include: { alimento: true, plano: true }
      });
      if (!dieta) return res.status(404).json({ error: 'Item da dieta não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, dieta.animalId))) return;
      res.json(dieta);
    } catch (error) {
      console.error('Erro ao buscar item da dieta:', error);
      res.status(500).json({ error: 'Erro ao buscar item da dieta' });
    }
  },

  criarItem: async (req, res) => {
    const {
      animalId,
      alimentoId,
      planoDietaId,
      qtdGramasDia,
      unidade,
      periodicidade,
      horario,
      observacao,
      criadopor,
      modificadopor
    } = req.body;

    if (!animalId) return res.status(400).json({ error: 'animalId é obrigatório' });
    if (!alimentoId) return res.status(400).json({ error: 'alimentoId é obrigatório' });

    const userId = Number(criadopor || modificadopor || req.user?.id || 1);

    try {
      if (await animalFoiExcluido(animalId)) {
        return res.status(400).json({ error: 'Paciente inativado — reative-o na tela de Pacientes antes de registrar algo novo.', code: 'PACIENTE_EXCLUIDO' });
      }
      if (await animalEstaInativo(animalId)) {
        return res.status(400).json({ error: 'Paciente inativo — reative com o gestor antes de registrar algo novo.', code: 'PACIENTE_INATIVO' });
      }
      const dieta = await prisma.dieta.create({
        data: {
          animalId:     Number(animalId),
          alimentoId:   Number(alimentoId),
          planoDietaId: planoDietaId ? Number(planoDietaId) : null,
          qtdGramasDia: parseFloat(qtdGramasDia) || 0,
          unidade:      unidade      || null,
          periodicidade: periodicidade || null,
          horario:      horario      || null,
          observacao:   observacao   || null,
          criadopor:    userId,
          modificadopor: userId
        },
        include: { alimento: true }
      });

      res.status(201).json(dieta);
    } catch (error) {
      console.error('Erro ao criar item da dieta:', error);
      res.status(500).json({ error: 'Erro ao salvar alimento na dieta' });
    }
  },

  atualizarItem: async (req, res) => {
    const { id } = req.params;
    const {
      alimentoId,
      planoDietaId,
      qtdGramasDia,
      unidade,
      periodicidade,
      horario,
      observacao
    } = req.body;

    const userId = Number(req.user?.id || req.body.modificadopor || 1);

    try {
      const existe = await prisma.dieta.findUnique({ where: { id: Number(id) } });
      if (!existe) return res.status(404).json({ error: 'Item da dieta não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, existe.animalId))) return;

      const dieta = await prisma.dieta.update({
        where: { id: Number(id) },
        data: {
          ...(alimentoId   !== undefined && { alimentoId: Number(alimentoId) }),
          ...(planoDietaId !== undefined && { planoDietaId: planoDietaId ? Number(planoDietaId) : null }),
          qtdGramasDia:  parseFloat(qtdGramasDia) || 0,
          unidade:       unidade       || null,
          periodicidade: periodicidade || null,
          horario:       horario       || null,
          observacao:    observacao    || null,
          modificadopor: userId
        }
      });

      res.json(dieta);
    } catch (error) {
      console.error('Erro ao atualizar item da dieta:', error);
      res.status(500).json({ error: 'Erro ao atualizar item da dieta' });
    }
  },

  excluirItem: async (req, res) => {
    const { id } = req.params;
    const { motivo } = req.body ?? {};
    if (!motivo?.trim()) {
      return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
    }
    try {
      const existe = await prisma.dieta.findUnique({
        where:   { id: Number(id) },
        include: { alimento: { select: { nome: true } } },
      });
      if (!existe) return res.status(404).json({ error: 'Item da dieta não encontrado' });
      if (!(await garantirAcessoAnimal(req, res, existe.animalId))) return;

      await prisma.dieta.delete({ where: { id: Number(id) } });

      await registrarAuditoria(null, req, {
        categoria:  'EXCLUSAO',
        entidade:   'DIETA_ITEM',
        entidadeId: Number(id),
        animalId:   existe.animalId ?? null,
        motivo,
        detalhes:   existe.alimento?.nome ?? null,
      });

      res.json({ message: 'Item excluído com sucesso' });
    } catch (error) {
      console.error('Erro ao excluir item da dieta:', error);
      res.status(500).json({ error: 'Erro ao excluir item' });
    }
  }
};

module.exports = { PlanoDietaController, DietaItemController };