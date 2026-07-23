// backend/src/controllers/FaturaController.js

const prisma = require('../lib/prisma').default;
const { getEquipeScopeDoUsuario } = require('../lib/vetUtils');
const {
  recalcularTotal: recalcularTotalCompartilhado,
  registrarCorrecaoFatura,
  normalizarDesconto,
} = require('../lib/faturaUtils');
const { resolverLogoPorProprietario } = require('../lib/logoEmpresaUtils');
const { registrarAuditoria } = require('../lib/auditoria');
const {
  aplicarPerfil: aplicarPerfilProprietario,
  aplicarPerfilEmLista: aplicarPerfilProprietarioEmLista,
} = require('../lib/proprietarioPerfil');

// Aplica à fatura o cadastro que a EMPRESA ATIVA mantém do proprietário
// (nome, telefone e condição comercial são por empresa — ver lib/proprietarioPerfil).
async function comPerfilDaEmpresa(fatura, empresaId) {
  if (!fatura?.proprietario || !empresaId) return fatura;
  return { ...fatura, proprietario: await aplicarPerfilProprietario(fatura.proprietario, empresaId) };
}

const ITEM_INCLUDE = {
  veterinario: { select: { id: true, fullName: true } },
  animal:      { select: { id: true, nome: true, especie: { select: { nome: true } }, raca: { select: { nome: true } }, photoUrl: true } },
};

const FATURA_INCLUDE = {
  itens: {
    where:   { },
    include: ITEM_INCLUDE,
    orderBy: [{ animalId: 'asc' }, { criadoEm: 'asc' }],
  },
  proprietario: { select: { id: true, fullName: true, email: true, phone: true, valorAssistencia: true, mensalista: true } },
};

function recalcularTotal(faturaId) {
  return recalcularTotalCompartilhado(prisma, faturaId);
}

function mesReferenciaAtual() {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

// Retorna o mês seguinte no formato "YYYY-MM"
function proximoMesRef(mesRef) {
  if (!mesRef) {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 7);
  }
  const [ano, mes] = mesRef.split('-').map(Number);
  // mes é 1-based; new Date(ano, mes, 1) avança um mês (junho=6 → Date(2026,6,1) = julho)
  const d = new Date(ano, mes, 1);
  return d.toISOString().slice(0, 7);
}

// Adiciona item de assistência veterinária mensal se o proprietário for mensalista
// e ainda não existir o item nesta fatura (idempotente)
async function adicionarAssistenciaMensal(faturaId, proprietario, veterinarioId = null) {
  if (!proprietario?.mensalista || !proprietario?.valorAssistencia || proprietario.valorAssistencia <= 0) return false;
  const existeAssistencia = await prisma.faturaItem.findFirst({
    where: { faturaId, tipo: 'ASSISTENCIA', descricao: 'Assistência Veterinária Mensal' },
  });
  if (existeAssistencia) return false;
  await prisma.faturaItem.create({
    data: {
      faturaId,
      tipo:         'ASSISTENCIA',
      descricao:    'Assistência Veterinária Mensal',
      valor:        proprietario.valorAssistencia,
      quantidade:   1,
      veterinarioId: veterinarioId ?? null,
    },
  });
  await recalcularTotal(faturaId);
  return true;
}

const FaturaController = {

  // GET /proprietarios
  // Lista todos os proprietários cujos animais estão vinculados ao vet logado
  // OU pertencem à empresa do vet (acesso compartilhado entre gestores da equipe).
  // Quando chamado por um PROPRIETÁRIO, retorna os próprios dados (ver fatura própria).
  listarProprietarios: async (req, res) => {
    const vetId     = req.user.id;
    const empresaId = req.empresaId ?? null;
    try {
      // PROPRIETÁRIO visualizando a própria fatura
      const caller = await prisma.user.findUnique({
        where:  { id: vetId },
        select: { userType: true },
      });
      if (caller?.userType === 'PROPRIETARIO') {
        const ANIMAL_SELECT = {
          id: true, nome: true,
          especie: { select: { nome: true } },
          raca:    { select: { nome: true } },
          photoUrl: true,
        };
        const prop = await prisma.user.findUnique({
          where:  { id: vetId },
          select: {
            id: true, fullName: true, email: true, phone: true,
            animais: { where: { ativo: true }, select: ANIMAL_SELECT },
            faturas: {
              where:   { status: { in: ['ABERTA', 'FECHADA', 'ATRASADA', 'PAGA'] } },
              orderBy: { criadoEm: 'desc' },
              take:    6,
              select:  { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
            },
          },
        });
        if (!prop) return res.json({ dados: [] });
        const faturaAberta   = prop.faturas.find(f => f.status === 'ABERTA')   ?? null;
        const faturaFechada  = prop.faturas.find(f => f.status === 'FECHADA')  ?? null;
        const faturaAtrasada = prop.faturas.find(f => f.status === 'ATRASADA') ?? null;
        const faturaPaga     = prop.faturas.find(f => f.status === 'PAGA')     ?? null;
        const dados = [{ ...prop, faturaAtiva: faturaAberta ?? null, faturaFechada, faturaAtrasada, faturaPaga, faturas: undefined }];
        return res.json({ dados });
      }

      // Escopo por equipe dentro da empresa ativa (segregação entre equipes do gestor)
      const equipeScope = empresaId
        ? await getEquipeScopeDoUsuario(vetId, empresaId, req.equipeId)
        : null;

      // Proprietários via vínculos diretos do vet — animais de OUTRA equipe da
      // mesma empresa ficam fora (mesma regra da listagem de pacientes)
      const solicitacoes = await prisma.vetAnimalSolicitacao.findMany({
        where:   { vetUserId: vetId, tipo: 'VINCULO', status: 'ACEITO' },
        include: { animal: { select: { id: true, userId: true, empresaId: true, equipeId: true } } },
      });

      const animaisVinculados = solicitacoes
        .map(s => s.animal)
        .filter(a => !empresaId || !equipeScope || a.empresaId !== empresaId || !a.equipeId || equipeScope.includes(a.equipeId));
      let proprietarioIds = [...new Set(animaisVinculados.map(a => a.userId))];

      // Também inclui proprietários via animais da(s) equipe(s) do vet na empresa
      if (empresaId) {
        const animaisEmpresa = await prisma.animal.findMany({
          where: {
            empresaId,
            ativo: true,
            ...(equipeScope ? { OR: [{ equipeId: { in: equipeScope } }, { equipeId: null }] } : {}),
          },
          select: { userId: true },
        });
        const idsEmpresa = animaisEmpresa.map(a => a.userId);
        proprietarioIds = [...new Set([...proprietarioIds, ...idsEmpresa])];
      }

      if (proprietarioIds.length === 0) return res.json({ dados: [] });

      const proprietarios = await prisma.user.findMany({
        where: { id: { in: proprietarioIds } },
        select: {
          id: true, fullName: true, email: true, phone: true,
          valorAssistencia: true, mensalista: true,
          animais: {
            where: { ativo: true },
            select: {
              id: true, nome: true,
              especie: { select: { nome: true } },
              raca:    { select: { nome: true } },
              photoUrl: true,
            },
          },
          faturas: {
            where: { status: { in: ['ABERTA', 'FECHADA', 'ATRASADA'] } },
            orderBy: { criadoEm: 'desc' },
            take: 6,
            select: { id: true, total: true, status: true, mesReferencia: true, criadoEm: true },
          },
        },
        orderBy: { fullName: 'asc' },
      });

      // Busca a fatura PAGA mais recente por proprietário
      const faturasPagas = proprietarioIds.length > 0
        ? await prisma.fatura.findMany({
            where: { proprietarioId: { in: proprietarioIds }, status: 'PAGA' },
            orderBy: { criadoEm: 'desc' },
            select: { id: true, total: true, status: true, mesReferencia: true, proprietarioId: true },
          })
        : [];

      const faturaPagaPorProp = faturasPagas.reduce((acc, f) => {
        if (!acc[f.proprietarioId]) acc[f.proprietarioId] = f;
        return acc;
      }, {});

      // Nome/telefone/condição comercial conforme o cadastro DESTA empresa
      const comPerfil = await aplicarPerfilProprietarioEmLista(proprietarios, req.empresaId);

      const dados = comPerfil.map(p => ({
        ...p,
        faturaAtiva:    p.faturas.find(f => f.status === 'ABERTA')   ?? null,
        faturaFechada:  p.faturas.find(f => f.status === 'FECHADA')  ?? null,
        faturaAtrasada: p.faturas.find(f => f.status === 'ATRASADA') ?? null,
        faturaPaga:     faturaPagaPorProp[p.id] ?? null,
        faturas: undefined,
      }));

      res.json({ dados });
    } catch (err) {
      console.error('Erro ao listar proprietários:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /proprietario/:proprietarioId?faturaId=N&mes=YYYY-MM
  // Sem faturaId/mes → retorna (ou cria) a fatura ABERTA do mês atual.
  // Com faturaId      → retorna a fatura específica pelo ID (sem criar).
  // Com mes           → retorna a fatura do proprietário no mês (sem criar; null se não houver).
  // Sempre inclui `meses` — lista de faturas do proprietário para o seletor de mês/ano.
  obterFaturaProprietario: async (req, res) => {
    const { proprietarioId } = req.params;
    const { faturaId, mes }  = req.query;
    const mesRef = mesReferenciaAtual();

    try {
      // Meses/faturas existentes do proprietário — alimenta o seletor de mês/ano.
      const meses = await prisma.fatura.findMany({
        where:   { proprietarioId: Number(proprietarioId) },
        select:  { id: true, mesReferencia: true, status: true },
        orderBy: { mesReferencia: 'desc' },
      });

      if (mes) {
        const fatura = await prisma.fatura.findFirst({
          where:   { proprietarioId: Number(proprietarioId), mesReferencia: String(mes) },
          include: FATURA_INCLUDE,
          orderBy: { criadoEm: 'desc' },
        });
        return res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId) ?? null, meses });
      }

      if (faturaId) {
        const fatura = await prisma.fatura.findFirst({
          where:   { id: Number(faturaId), proprietarioId: Number(proprietarioId) },
          include: FATURA_INCLUDE,
        });
        if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
        return res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId), meses });
      }

      let fatura = await prisma.fatura.findFirst({
        where:   { proprietarioId: Number(proprietarioId), status: 'ABERTA' },
        include: FATURA_INCLUDE,
        orderBy: { criadoEm: 'desc' },
      });

      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { proprietarioId: Number(proprietarioId), mesReferencia: mesRef, total: 0, status: 'ABERTA' },
          include: FATURA_INCLUDE,
        });
      }

      // Adiciona assistência mensal automaticamente ao abrir (idempotente — não duplica)
      const adicionou = await adicionarAssistenciaMensal(fatura.id, fatura.proprietario);
      if (adicionou) {
        fatura = await prisma.fatura.findUnique({ where: { id: fatura.id }, include: FATURA_INCLUDE });
      }

      // Inclui a fatura recém-criada/aberta na lista de meses, se ainda não estiver.
      if (fatura && !meses.some(m => m.id === fatura.id)) {
        meses.unshift({ id: fatura.id, mesReferencia: fatura.mesReferencia, status: fatura.status });
      }
      res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId), meses });
    } catch (err) {
      console.error('Erro ao obter fatura do proprietário:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /proprietario/:proprietarioId/logo-empresa
  // Logo da empresa/equipe do proprietário — usado na impressão/PDF/compartilhamento
  // da fatura em vez da marca S2Vet.
  obterLogoEmpresaProprietario: async (req, res) => {
    try {
      const logoUrl = await resolverLogoPorProprietario(req.params.proprietarioId);
      res.json({ dados: { logoUrl } });
    } catch (err) {
      console.error('Erro ao obter logo do proprietário:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /:faturaId/itens
  adicionarItem: async (req, res) => {
    const { faturaId }  = req.params;
    const { tipo, descricao, valor, quantidade = 1, animalId, descontoTipo, descontoValor } = req.body;
    const veterinarioId = req.user.id;

    if (!tipo || !descricao || valor === undefined || valor === null) {
      return res.status(400).json({ error: 'tipo, descricao e valor são obrigatórios' });
    }

    let desconto;
    try {
      desconto = normalizarDesconto(descontoTipo, descontoValor);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    try {
      const fatura = await prisma.fatura.findUnique({ where: { id: Number(faturaId) }, select: { status: true } });
      if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
      if (fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode receber novos itens.', code: 'FATURA_PAGA' });
      }

      const item = await prisma.faturaItem.create({
        data: {
          faturaId:     Number(faturaId),
          animalId:     animalId ? Number(animalId) : null,
          tipo,
          descricao,
          valor:        Number(valor),
          quantidade:   Number(quantidade),
          veterinarioId,
          ...desconto,
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(Number(faturaId));
      res.status(201).json({ dados: item, totalFatura: total });
    } catch (err) {
      console.error('Erro ao adicionar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PUT /itens/:itemId
  atualizarItem: async (req, res) => {
    const { itemId } = req.params;
    const { tipo, descricao, valor, quantidade, descontoTipo, descontoValor } = req.body;

    // O desconto só é tocado quando o request menciona algum dos dois campos —
    // assim um PATCH parcial (ex: só a descrição) não zera um desconto existente.
    const mexeuNoDesconto = descontoTipo !== undefined || descontoValor !== undefined;
    let desconto = null;
    if (mexeuNoDesconto) {
      try {
        desconto = normalizarDesconto(descontoTipo, descontoValor);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    try {
      const item = await prisma.faturaItem.findUnique({
        where:   { id: Number(itemId) },
        include: { fatura: { select: { status: true } } },
      });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (item.fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' });
      }

      const updated = await prisma.faturaItem.update({
        where: { id: Number(itemId) },
        data: {
          ...(tipo       !== undefined && { tipo }),
          ...(descricao  !== undefined && { descricao }),
          ...(valor      !== undefined && { valor: Number(valor) }),
          ...(quantidade !== undefined && { quantidade: Number(quantidade) }),
          ...(desconto ?? {}),
        },
        include: ITEM_INCLUDE,
      });

      const total = await recalcularTotal(item.faturaId);
      await registrarCorrecaoFatura(prisma, item.faturaId);
      res.json({ dados: updated, totalFatura: total });
    } catch (err) {
      console.error('Erro ao atualizar item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // DELETE /itens/:itemId
  removerItem: async (req, res) => {
    const { itemId } = req.params;
    const { motivo } = req.body ?? {};

    try {
      if (!motivo?.trim()) {
        return res.status(400).json({ error: 'É obrigatório informar o motivo da exclusão' });
      }

      const item = await prisma.faturaItem.findUnique({
        where:   { id: Number(itemId) },
        include: { fatura: { select: { status: true, mesReferencia: true } } },
      });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (item.fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode ser alterada.', code: 'FATURA_PAGA' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.faturaItem.delete({ where: { id: Number(itemId) } });
        await registrarAuditoria(tx, req, {
          categoria:  'EXCLUSAO',
          entidade:   'FATURA_ITEM',
          entidadeId: Number(itemId),
          animalId:   item.animalId ?? null,
          motivo,
          detalhes:   `${item.descricao ?? 'Item de fatura'} (fatura #${item.faturaId}${item.fatura.mesReferencia ? ` · ${item.fatura.mesReferencia}` : ''})`,
        });
      });
      const total = await recalcularTotal(item.faturaId);
      await registrarCorrecaoFatura(prisma, item.faturaId);

      res.json({ mensagem: 'Item removido', totalFatura: total });
    } catch (err) {
      console.error('Erro ao remover item:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PATCH /:faturaId/status
  atualizarStatus: async (req, res) => {
    const { faturaId } = req.params;
    const { status }   = req.body;

    const VALIDOS = ['ABERTA', 'PAGA', 'CANCELADA', 'FECHADA'];
    if (!VALIDOS.includes(status)) {
      return res.status(400).json({ error: `Status inválido. Use: ${VALIDOS.join(', ')}` });
    }

    try {
      const fatura = await prisma.fatura.update({
        where:   { id: Number(faturaId) },
        data:    { status },
        include: FATURA_INCLUDE,
      });
      res.json({ dados: await comPerfilDaEmpresa(fatura, req.empresaId) });
    } catch (err) {
      console.error('Erro ao atualizar status:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // PATCH /:faturaId/fechar
  // Fecha a fatura: adiciona assistência veterinária mensal (se aplicável) e muda status para FECHADA.
  // Idempotente: não duplica o item de assistência se já existir.
  fecharFatura: async (req, res) => {
    const { faturaId } = req.params;

    try {
      const fatura = await prisma.fatura.findUnique({
        where:   { id: Number(faturaId) },
        include: { proprietario: { select: { id: true, valorAssistencia: true, mensalista: true } } },
      });

      if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada' });
      if (fatura.status !== 'ABERTA') {
        return res.status(400).json({ error: 'Apenas faturas com status ABERTA podem ser fechadas' });
      }

      await adicionarAssistenciaMensal(Number(faturaId), fatura.proprietario, req.user.id);

      const faturaFechada = await prisma.fatura.update({
        where:   { id: Number(faturaId) },
        data:    { status: 'FECHADA' },
        include: FATURA_INCLUDE,
      });

      res.json({ dados: await comPerfilDaEmpresa(faturaFechada, req.empresaId) });
    } catch (err) {
      console.error('Erro ao fechar fatura:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /fechar-lote  { faturaIds: number[] }
  // Fecha em lote as faturas ABERTAS informadas (IDs vêm da lista já escopada por
  // listarProprietarios). Aplica a mesma regra de fecharFatura (assistência mensal
  // + status FECHADA). Ignora IDs inexistentes, não-ABERTA ou de outra empresa.
  fecharFaturasLote: async (req, res) => {
    const { faturaIds } = req.body;
    if (!Array.isArray(faturaIds) || faturaIds.length === 0) {
      return res.status(400).json({ error: 'Informe as faturas a fechar' });
    }
    try {
      const fechadas = [];
      for (const rawId of faturaIds) {
        const id = Number(rawId);
        if (!Number.isInteger(id)) continue;
        const fatura = await prisma.fatura.findUnique({
          where:   { id },
          include: { proprietario: { select: { id: true, fullName: true, phone: true, email: true, empresaId: true, valorAssistencia: true, mensalista: true } } },
        });
        if (!fatura || fatura.status !== 'ABERTA') continue;
        // Guarda de escopo: não fecha fatura de proprietário de outra empresa
        if (req.empresaId && fatura.proprietario?.empresaId && fatura.proprietario.empresaId !== req.empresaId) continue;

        await adicionarAssistenciaMensal(id, fatura.proprietario, req.user.id);
        const atualizada = await prisma.fatura.update({
          where:  { id },
          data:   { status: 'FECHADA' },
          select: { id: true, total: true, mesReferencia: true },
        });
        fechadas.push({
          faturaId:      atualizada.id,
          total:         atualizada.total,
          mesReferencia: atualizada.mesReferencia,
          proprietario:  {
            id:       fatura.proprietario.id,
            fullName: fatura.proprietario.fullName,
            phone:    fatura.proprietario.phone,
            email:    fatura.proprietario.email,
          },
        });
      }
      res.json({ dados: { fechadas, total: fechadas.length } });
    } catch (err) {
      console.error('Erro ao fechar faturas em lote:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // GET /catalogo-itens — itens frequentes da empresa (dropdown de nova fatura)
  listarCatalogo: async (req, res) => {
    try {
      const empresaId = req.empresaId ?? null;
      const itens = await prisma.faturaItemCatalogo.findMany({
        where:   { ativo: true, OR: [{ empresaId }, { empresaId: null }] },
        orderBy: { descricao: 'asc' },
        select:  { id: true, tipo: true, descricao: true, valor: true },
      });
      res.json({ dados: itens });
    } catch (err) {
      console.error('Erro ao listar catálogo de itens:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // POST /catalogo-itens { tipo, descricao, valor } — cria item frequente
  criarItemCatalogo: async (req, res) => {
    const { tipo, descricao, valor } = req.body;
    if (!descricao || !String(descricao).trim()) {
      return res.status(400).json({ error: 'Informe a descrição do item' });
    }
    const tiposValidos = ['ASSISTENCIA', 'MEDICAMENTO', 'PROCEDIMENTO'];
    const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'ASSISTENCIA';
    try {
      const item = await prisma.faturaItemCatalogo.create({
        data: {
          empresaId:   req.empresaId ?? null,
          tipo:        tipoFinal,
          descricao:   String(descricao).trim(),
          valor:       Number(valor) || 0,
          criadoPorId: req.user.id,
        },
        select: { id: true, tipo: true, descricao: true, valor: true },
      });
      res.status(201).json({ dados: item });
    } catch (err) {
      console.error('Erro ao criar item de catálogo:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // DELETE /catalogo-itens/:id — remove item frequente do próprio escopo
  excluirItemCatalogo: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const item = await prisma.faturaItemCatalogo.findUnique({ where: { id } });
      if (!item) return res.status(404).json({ error: 'Item não encontrado' });
      if (req.empresaId && item.empresaId && item.empresaId !== req.empresaId) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
      await prisma.faturaItemCatalogo.delete({ where: { id } });
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao excluir item de catálogo:', err);
      res.status(500).json({ error: 'Erro interno' });
    }
  },

  // Legado — mantido para compatibilidade
  obterFaturaAberta: async (req, res) => {
    const { animalId } = req.params;
    try {
      let fatura = await prisma.fatura.findFirst({
        where:   { animalId: Number(animalId), status: 'ABERTA' },
        include: { itens: { include: { veterinario: { select: { fullName: true } } }, orderBy: { criadoEm: 'asc' } } },
      });
      if (!fatura) {
        fatura = await prisma.fatura.create({
          data:    { animalId: Number(animalId), status: 'ABERTA' },
          include: { itens: { include: { veterinario: { select: { fullName: true } } } } },
        });
      }
      res.json({ sucesso: true, dados: fatura });
    } catch (err) {
      console.error(err);
      res.status(500).json({ sucesso: false, mensagem: 'Erro interno' });
    }
  },
};

module.exports = FaturaController;
module.exports.adicionarAssistenciaMensal = adicionarAssistenciaMensal;
module.exports.recalcularTotal            = recalcularTotal;