// backend/src/controllers/ExameClinicoController.js
'use strict';

const prisma                  = require('../lib/prisma').default;
const { verificarAcessoAnimal } = require('../lib/animalAccess');
const { escopoFilhoEvolucaoWhere } = require('../lib/clinicalScope');
const { lancarExameNaFatura, removerFaturaItensDaOrigem, atualizarFaturaItensDaOrigem } = require('../lib/faturaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const { podeOperarRegistro, getNivelEfetivo, NIVEL_ORDINAL } = require('../middlewares/permissao.middleware');

const TIPOS_VALIDOS = ['Laboratorial', 'Bioquímico', 'Imagem', 'Compra'];

// ── Permissão por TIPO de exame (matriz RBAC) ────────────────────────────────
// Laboratorial/Bioquímico → exames.laboratorial.* ; Imagem → exames.imagem.*
// Compra não tem módulo próprio (vale apenas atendimento.exames.*).
// Complementa o checkPermission da rota: o slug do tipo só é conhecido em runtime
// (vem do body ou do registro), por isso é resolvido aqui via getNivelEfetivo.
const SLUG_BASE_POR_TIPO = {
  Laboratorial: 'exames.laboratorial',
  'Bioquímico': 'exames.laboratorial',
  Imagem:       'exames.imagem',
};

async function nivelDoTipo(req, tipo, acao) {
  const base = SLUG_BASE_POR_TIPO[tipo];
  if (!base) return null; // tipo sem restrição adicional
  return getNivelEfetivo(req, `${base}.${acao}`);
}

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
          // Segregação multi-clínica: cada empresa vê só os próprios exames do animal
          where:   { animalId, ativo: true, AND: [escopoFilhoEvolucaoWhere(req)] },
          include: INCLUDE,
          orderBy: { dataSolicitacao: 'desc' },
          take, skip,
        }),
        prisma.exameClinico.count({ where: { animalId, ativo: true, AND: [escopoFilhoEvolucaoWhere(req)] } }),
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

      // Permissão por tipo (matriz RBAC): exames.laboratorial.criar / exames.imagem.criar
      const nivelTipoCriar = await nivelDoTipo(req, tipo, 'criar');
      if (nivelTipoCriar !== null && (NIVEL_ORDINAL[nivelTipoCriar] ?? 0) < NIVEL_ORDINAL.PROPRIO) {
        return res.status(403).json({ error: `Sem permissão para criar exames do tipo ${tipo}.` });
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

      // Proprietário do animal — o exame é lançado na fatura já na solicitação
      const animalDoExame = await prisma.animal.findUnique({
        where: { id: Number(animalId) }, select: { userId: true },
      });

      const item = await prisma.$transaction(async (tx) => {
        const maxResult = await tx.exameClinico.aggregate({
          where: { animalId: Number(animalId) },
          _max:  { numero: true },
        });
        const proximoNumero = (maxResult._max.numero ?? 0) + 1;

        const criado = await tx.exameClinico.create({
          data: {
            animalId:        Number(animalId),
            veterinarioId:   req.user.id,
            evolucaoId:      evolucaoId ? Number(evolucaoId) : null,
            tipo,
            descricao:       descricao.trim(),
            status:          'SOLICITADO',
            ativo:           true,
            observacao:      observacaoFinal,
            qtdAmostra:      qtdAmostra != null ? Number(qtdAmostra) : null,
            numero:          proximoNumero,
            dataSolicitacao: dataSolicitacao ? new Date(dataSolicitacao) : new Date(),
          },
          include: INCLUDE,
        });

        // Lança na fatura (valor zerado) JÁ na solicitação. Antes isso só acontecia ao
        // FINALIZAR a evolução ou ao concluir o exame — exame pedido depois da evolução
        // finalizada, ou que nunca foi concluído, nunca chegava ao financeiro.
        // `lancarExameNaFatura` é idempotente: os outros gatilhos não duplicam.
        await lancarExameNaFatura(tx, criado, animalDoExame?.userId ?? null);
        return criado;
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

      // Autoria via RBAC (nível efetivo em atendimento.exames.editar):
      // PROPRIO → só registros próprios; EQUIPE/FULL → qualquer da equipe.
      if (!podeOperarRegistro(req.permissaoNivel, item.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite editar exames criados por você.' });
      }

      // Permissão por tipo (exames.laboratorial.editar / exames.imagem.editar)
      const nivelTipoEditar = await nivelDoTipo(req, item.tipo, 'editar');
      if (nivelTipoEditar !== null && !podeOperarRegistro(nivelTipoEditar, item.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: `Sem permissão para editar exames do tipo ${item.tipo}.` });
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

      const descricaoTrim  = descricao ? descricao.trim() : undefined;
      const descricaoMudou = descricaoTrim !== undefined && descricaoTrim !== item.descricao;

      const atualizado = await prisma.$transaction(async (tx) => {
        // Descrição mudou → sincroniza o FaturaItem vinculado (se houver), independente
        // do status — o exame pode estar faturado ainda como SOLICITADO (valor 0 ao
        // finalizar a evolução). Idempotente; bloqueia se a fatura de destino for PAGA.
        if (descricaoMudou) {
          const exNum = `EX-${String(item.numero).padStart(4, '0')}`;
          await atualizarFaturaItensDaOrigem(tx, 'exameClinicoId', item.id, {
            descricao: `[${exNum}] ${item.tipo}: ${descricaoTrim}`,
          });
        }

        return tx.exameClinico.update({
          where: { id: item.id },
          data: {
            ...(descricaoTrim !== undefined && { descricao: descricaoTrim }),
            ...(status          && { status }),
            ...(dataSolicitacao && { dataSolicitacao: new Date(dataSolicitacao) }),
            ...(qtdAmostra != null && { qtdAmostra: Number(qtdAmostra) }),
            observacao: observacaoAtualizada,
          },
          include: INCLUDE,
        });
      });

      res.json({ dados: atualizado });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
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

      // Autoria via RBAC (nível efetivo em atendimento.exames.finalizar)
      if (!podeOperarRegistro(req.permissaoNivel, item.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite finalizar exames criados por você.' });
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

      // Lança na fatura com valor zerado (idempotente — não duplica se o exame já foi
      // lançado ao finalizar a evolução). Exame clínico não tem preço automático.
      setImmediate(async () => {
        try {
          const animal = await prisma.animal.findUnique({
            where:  { id: item.animalId },
            select: { userId: true },
          });
          await prisma.$transaction(async (tx) => {
            await lancarExameNaFatura(tx, item, animal?.userId);
          });
        } catch { /* silencioso — fatura não bloqueia a finalização */ }
      });
    } catch (err) {
      console.error('Erro ao finalizar exame clínico:', err);
      res.status(500).json({ error: 'Erro ao finalizar exame' });
    }
  },

  // DELETE /clinica/exames/:id  (soft delete)
  excluir: async (req, res) => {
    try {
      const { motivo } = req.body ?? {};
      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const item = await prisma.exameClinico.findUnique({ where: { id: Number(req.params.id) } });
      if (!item || !item.ativo) return res.status(404).json({ error: 'Exame não encontrado' });

      const acesso = await verificarAcessoAnimal({
        animalId: item.animalId, userId: req.user.id, empresaId: req.empresaId, equipeId: req.equipeId,
      });
      if (!acesso) return res.status(403).json({ error: 'Acesso não autorizado' });

      // Autoria via RBAC (nível efetivo em atendimento.exames.deletar)
      if (!podeOperarRegistro(req.permissaoNivel, item.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: 'Seu nível de permissão só permite excluir exames criados por você.' });
      }

      // Permissão por tipo (exames.laboratorial.deletar / exames.imagem.deletar)
      const nivelTipoDel = await nivelDoTipo(req, item.tipo, 'deletar');
      if (nivelTipoDel !== null && !podeOperarRegistro(nivelTipoDel, item.veterinarioId, req.user.id)) {
        return res.status(403).json({ error: `Sem permissão para excluir exames do tipo ${item.tipo}.` });
      }

      await prisma.$transaction(async (tx) => {
        // Remove o FaturaItem vinculado ao exame (se houver) — independente do status,
        // pois desde 2026-07-16 o exame pode ser faturado (valor 0) já ao FINALIZAR a
        // evolução, ainda como SOLICITADO. Idempotente: sem item vinculado, não faz nada.
        // Bloqueia (lança FaturaPagaError) se a fatura de destino já estiver PAGA.
        await removerFaturaItensDaOrigem(tx, 'exameClinicoId', item.id);
        await tx.exameClinico.update({ where: { id: item.id }, data: { ativo: false } });

        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'EXAME_CLINICO',
          entidadeId: item.id,
          animalId:   item.animalId,
          motivo,
          detalhes:   [item.tipo, item.descricao].filter(Boolean).join(' — ') || null,
        });
      });

      res.json({ dados: { id: item.id, excluido: true } });
    } catch (err) {
      if (err.code === 'FATURA_PAGA') {
        return res.status(400).json({ error: err.message, code: 'FATURA_PAGA' });
      }
      console.error('Erro ao excluir exame clínico:', err);
      res.status(500).json({ error: 'Erro ao excluir exame' });
    }
  },
};

module.exports = ExameClinicoController;
