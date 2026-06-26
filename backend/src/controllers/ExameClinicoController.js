// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');

const TIPOS_VALIDOS = ['Laboratorial', 'Bioquímico', 'Imagem', 'Compra'];

const INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
};

const ExameClinicoController = {

  // GET /clinica/exames/animal/:animalId?page=1&limit=10
  listarPorAnimal: async (req, res) => {
    try {
      const animalId = Number(req.params.animalId);
      const acesso = await verificarAcessoAnimal({
        animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      const take = Math.min(Number(req.query.limit ?? 10), 50);
      const skip = (Number(req.query.page ?? 1) - 1) * take;

      const [itens, total] = await Promise.all([
        prisma.exameClinico.findMany({
          where:   { animalId, ativo: true },
          include: INCLUDE,
          orderBy: { dataSolicitacao: 'desc' },
          take, skip,
        }),
        prisma.exameClinico.count({ where: { animalId, ativo: true } }),
      ]);

      res.json({ dados: itens, meta: { total, page: Number(req.query.page ?? 1), limit: take } });
    } catch (err) {
      console.error('Erro ao listar exames clínicos:', err);
      res.status(500).json({ error: 'Erro ao listar exames' });
    }
  },

  // POST /clinica/exames
  // body: { animalId, tipo, descricao, evolucaoId, laboratorio?, tipoAmostra?, indicacaoClinica?, observacao? }
  criar: async (req, res) => {
    try {
      const { animalId, tipo, descricao, evolucaoId, laboratorio, tipoAmostra, qtdAmostra, indicacaoClinica, observacao, grupoNome, grupos } = req.body;

      if (!animalId || !tipo || !descricao?.trim()) {
        return res.status(400).json({ error: 'animalId, tipo e descricao são obrigatórios' });
      }
      if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({ error: `tipo deve ser: ${TIPOS_VALIDOS.join(', ')}` });
      }
      // evolucaoId obrigatório apenas fora do fluxo autônomo de Compra
      if (!evolucaoId && tipo !== 'Compra') {
        return res.status(400).json({ error: 'evolucaoId é obrigatório', code: 'EVOLUCAO_REQUIRED' });
      }

      const acesso = await verificarAcessoAnimal({
        animalId: Number(animalId), userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (acesso === null) return res.status(404).json({ error: 'Animal não encontrado' });
      if (!acesso)         return res.status(403).json({ error: 'Acesso não autorizado' });

      // Valida evolução apenas quando fornecida
      if (evolucaoId) {
        const evolucao = await prisma.evolucaoClinica.findFirst({
          where:  { id: Number(evolucaoId), animalId: Number(animalId), ativo: true },
          select: { id: true },
        });
        if (!evolucao) return res.status(400).json({ error: 'Evolução não encontrada para este animal', code: 'EVOLUCAO_NOT_FOUND' });
      }

      // Campos extras armazenados em observacao como JSON
      const { dataHoraColeta, dataSolicitacao } = req.body;

      // Exame de Compra: ExameCompra.tsx manda o laudo completo em `observacao` como JSON string.
      // Preserva direto, sem encapsular na estrutura extra (que quebraria a leitura em handleEditar).
      let observacaoFinal;
      if (tipo === 'Compra') {
        observacaoFinal = observacao ?? null;
      } else {
        const extra = {
          laboratorio:      laboratorio?.trim()      || null,
          dataHoraColeta:   dataHoraColeta           || null,
          tipoAmostra:      tipoAmostra?.trim()      || null,
          indicacaoClinica: indicacaoClinica?.trim() || null,
          obs:              observacao?.trim()        || null,
          grupoNome:        grupoNome?.trim()         || null,
          grupos:           Array.isArray(grupos) && grupos.length >= 1 ? grupos : null,
        };
        observacaoFinal = JSON.stringify(extra);
      }

      const item = await prisma.$transaction(async (tx) => {
        const maxResult = await tx.exameClinico.aggregate({
          where: { animalId: Number(animalId) },
          _max:  { numero: true },
        });
        const proximoNumero = (maxResult._max.numero ?? 0) + 1;

        return tx.exameClinico.create({
          data: {
            animalId:        Number(animalId),
            veterinarioId:   req.user.id,
            evolucaoId:      evolucaoId ? Number(evolucaoId) : null,
            tipo,
            descricao:       descricao.trim(),
            status:          'SOLICITADO',
            observacao:      observacaoFinal,
            qtdAmostra:      qtdAmostra != null ? Number(qtdAmostra) : null,
            numero:          proximoNumero,
            dataSolicitacao: dataSolicitacao ? new Date(dataSolicitacao) : new Date(),
          },
          include: INCLUDE,
        });
      });

      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao criar exame' });
    }
  },

  // GET /clinica/exames/:id
  obterPorId: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({
        where:   { id: Number(req.params.id) },
        include: INCLUDE,
      });
      if (!item) return res.status(404).json({ error: 'Exame não encontrado' });
      res.json({ dados: item });
    } catch (err) {
      console.error('Erro ao obter exame clínico:', err);
      res.status(500).json({ error: 'Erro ao obter exame' });
    }
  },

  // PUT /clinica/exames/:id
  atualizar: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Regra de autoria: GESTOR pode editar qualquer registro, mas FORNECEDOR nunca tem
      // bypass de gestor mesmo que req.membroCargo === 'GESTOR' (via bypass de dono de empresa).
      const bypassGestor = req.membroCargo === 'GESTOR' && req.user.userType !== 'FORNECEDOR';
      if (!bypassGestor && Number(item.veterinarioId) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Você só pode editar exames criados por você.' });
      }

      const { descricao, observacao, status, laboratorio, tipoAmostra, indicacaoClinica, dataSolicitacao, qtdAmostra } = req.body;

      // Exame de Compra: ExameCompra.tsx manda o laudo completo em `observacao` como JSON string.
      // Preserva direto; para outros tipos, encapsula na estrutura extra padrão.
      let observacaoAtualizada;
      if (item.tipo === 'Compra') {
        observacaoAtualizada = observacao ?? item.observacao;
      } else {
        const extra = {
          laboratorio:      laboratorio?.trim()      || null,
          tipoAmostra:      tipoAmostra?.trim()      || null,
          indicacaoClinica: indicacaoClinica?.trim() || null,
          obs:              observacao?.trim()        || null,
        };
        observacaoAtualizada = JSON.stringify(extra);
      }

      const atualizado = await prisma.exameClinico.update({
        where: { id: item.id },
        data: {
          ...(descricao       && { descricao: descricao.trim() }),
          ...(status          && { status }),
          ...(dataSolicitacao && { dataSolicitacao: new Date(dataSolicitacao) }),
          ...(qtdAmostra != null && { qtdAmostra: Number(qtdAmostra) }),
          observacao: observacaoAtualizada,
        },
        include: INCLUDE,
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao atualizar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao atualizar exame' });
    }
  },

  // PATCH /clinica/exames/:id/finalizar — transita status para CONCLUIDO
  // GESTOR: qualquer exame (bypass via checkPermission)
  // FORNECEDOR: apenas exames que ele próprio criou (veterinarioId check)
  finalizar: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Regra: FORNECEDOR só pode finalizar exame que ele próprio criou
      if (req.user.userType === 'FORNECEDOR' && item.veterinarioId !== req.user.id) {
        return res.status(403).json({ error: 'Você só pode finalizar exames criados por você.' });
      }

      if (item.status === 'CONCLUIDO') {
        return res.status(400).json({ error: 'Exame já está concluído.' });
      }

      const atualizado = await prisma.exameClinico.update({
        where: { id: item.id },
        data:  { status: 'CONCLUIDO' },
        include: INCLUDE,
      });

      res.json({ dados: atualizado });
    } catch (err) {
      console.error('Erro ao finalizar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao finalizar exame' });
    }
  },

  // DELETE /clinica/exames/:id  (soft delete)
  excluir: async (req, res) => {
    try {
      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Regra de autoria: GESTOR pode excluir qualquer registro, FORNECEDOR só o próprio
      const bypassGestorDel = req.membroCargo === 'GESTOR' && req.user.userType !== 'FORNECEDOR';
      if (!bypassGestorDel && Number(item.veterinarioId) !== Number(req.user.id)) {
        return res.status(403).json({ error: 'Você só pode excluir exames criados por você.' });
      }

      await prisma.exameClinico.update({ where: { id: item.id }, data: { ativo: false } });
      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      console.error('Erro ao excluir exame clínico:', err);
      res.status(500).json({ error: 'Erro ao excluir exame' });
    }
  },
};

module.exports = ExameClinicoController;
