// backend/src/controllers/OrcamentoController.js
// Orçamento (etapa OPCIONAL): monta um quote por proprietário/animais com
// procedimentos/combos, medicamentos e vacinas. A equipe registra o que o cliente
// aceitou/rejeitou (status derivado). Itens ACEITO podem ser importados nas telas de
// Prescrição e Vacina. Item manual (procedimento/medicamento fora do catálogo) é
// criado no catálogo escopado à empresa (só ela vê/edita).
'use strict';

const prisma = require('../lib/prisma').default;
const {
  aplicarPerfil: aplicarPerfilProprietario,
  aplicarPerfilEmRelacao: aplicarPerfilProprietarioEmRelacao,
} = require('../lib/proprietarioPerfil');
const { buildAnimalScopeWhere } = require('../lib/animalScope');
const { proprietarioAtivoNaEmpresa } = require('../lib/visibilidade');
const { registrarAuditoria } = require('../lib/auditoria');
const { recalcularTotal, normalizarDesconto, descontoDoItem } = require('../lib/faturaUtils');
const {
  garantirMedicamentoDaEmpresa, garantirProcedimentoDaEmpresa, normalizarEspecies,
} = require('../lib/catalogoManual');
const { enviarDocumentoWhatsApp } = require('../services/documentoWhatsappService');
const { gerarHtmlOrcamentoCliente } = require('../templates/orcamentoHtml');

const brlSimples = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Mensagens amigáveis para os códigos de erro do WhatsAppProvider/whatsappService
const MSG_ERRO_WA = {
  WHATSAPP_NAO_PROVISIONADO: 'WhatsApp da clínica ainda não foi configurado.',
  WHATSAPP_DESCONECTADO:     'WhatsApp da clínica está desconectado. Reconecte em Configurações.',
  TELEFONE_INVALIDO:         'Telefone do proprietário é inválido.',
  TELEFONE_AUSENTE:          'Proprietário sem telefone cadastrado.',
  CLINICA_NAO_ENCONTRADA:    'Clínica não encontrada no contexto ativo.',
  ERRO_PDF:                  'Falha ao gerar o PDF do orçamento.',
  SEM_EMPRESA:               'Contexto de empresa não resolvido.',
};

// OUTROS: item avulso (nome + qtd de vezes + valor) que NÃO passa pelas telas clínicas —
// depois de aceito é lançado direto na fatura (ver listarOutrosParaFatura/lancarNaFatura).
const TIPOS = ['PROCEDIMENTO', 'COMBO', 'MEDICAMENTO', 'VACINA', 'OUTROS'];

// Tipos que a importação clínica (prescrição/vacina) consome. OUTROS fica de fora
// de propósito: o destino dele é a fatura, não a evolução.
const TIPOS_CLINICOS = ['PROCEDIMENTO', 'COMBO', 'MEDICAMENTO', 'VACINA'];

// Tipos que aceitam posologia orçada (duração em dias + frequência) — os que viram
// prescrição. Vacina usa doses (quantidade) e OUTROS é cobrança avulsa.
const TIPOS_COM_POSOLOGIA = ['MEDICAMENTO', 'PROCEDIMENTO', 'COMBO'];

const ITEM_SELECT = {
  id: true, animalId: true, tipo: true, refId: true, especialidade: true,
  descricao: true, quantidade: true, unidade: true, dias: true, frequencia: true,
  tipoDose: true, via: true,
  valorUnitario: true, descontoTipo: true, descontoValor: true,
  valorTotal: true, statusItem: true, importadoEm: true,
  animal: { select: { id: true, nome: true } },
};

const ORC_INCLUDE = {
  proprietario: { select: { id: true, fullName: true, email: true, phone: true } },
  criadoPor:    { select: { id: true, fullName: true } },
  itens:        { select: ITEM_SELECT, orderBy: { id: 'asc' } },
};

const formatNumero = (n) => String(n).padStart(4, '0');

async function proximoNumero(tx, empresaId) {
  const ultimo = await tx.orcamento.findFirst({
    where: { empresaId }, orderBy: { numero: 'desc' }, select: { numero: true },
  });
  return (ultimo?.numero ?? 0) + 1;
}

// Status derivado dos itens: todos ACEITO → APROVADO; todos REJEITADO → REJEITADO;
// nenhum decidido → RASCUNHO; qualquer mistura → APROVADO_PARCIALMENTE.
function calcularStatus(itens) {
  if (itens.length === 0) return 'RASCUNHO';
  const aceitos    = itens.filter(i => i.statusItem === 'ACEITO').length;
  const rejeitados = itens.filter(i => i.statusItem === 'REJEITADO').length;
  if (aceitos === itens.length)     return 'APROVADO';
  if (rejeitados === itens.length)  return 'REJEITADO';
  if (aceitos + rejeitados === 0)   return 'RASCUNHO';
  return 'APROVADO_PARCIALMENTE';
}

const withTotais = (o) => ({
  ...o,
  numeroFormatado: formatNumero(o.numero),
  valorTotal:  o.itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0),
  valorAceito: o.itens.filter(i => i.statusItem === 'ACEITO').reduce((s, i) => s + (i.valorTotal ?? 0), 0),
});

// Totais + cadastro do proprietário conforme a EMPRESA do orçamento (o mesmo
// cliente pode ter nome/telefone diferentes em outra clínica — ver lib/proprietarioPerfil).
const withTotaisEPerfil = async (o, empresaId) => {
  const base = withTotais(o);
  if (!base.proprietario || !empresaId) return base;
  return { ...base, proprietario: await aplicarPerfilProprietario(base.proprietario, empresaId) };
};

const listaWithTotaisEPerfil = async (lista, empresaId) => {
  const comTotais = lista.map(withTotais);
  return aplicarPerfilProprietarioEmRelacao(comTotais, 'proprietario', empresaId);
};

// Item manual que vira catálogo próprio da empresa (só ela vê/edita nas demais telas).
const TIPOS_MANUAIS = ['PROCEDIMENTO', 'MEDICAMENTO', 'VACINA'];

// A especialidade é OBRIGATÓRIA nos itens de procedimento/combo do orçamento.
// Ela não aparece no documento enviado ao cliente (impressão/WhatsApp), mas é
// devolvida na importação para a prescrição — por isso não pode ficar vazia.
const TIPOS_COM_ESPECIALIDADE = ['PROCEDIMENTO', 'COMBO'];

function validarEspecialidade(item) {
  if (!TIPOS_COM_ESPECIALIDADE.includes(item.tipo)) return null;
  if (String(item.especialidade ?? '').trim()) return null;
  return `Informe a especialidade do item "${String(item.descricao ?? '').trim() || item.tipo}".`;
}

// VACINA exige Tipo de Dose e Via — os mesmos dois campos obrigatórios da tela
// de aplicação (SubModuloVacina). Capturados aqui para a importação já vir
// pronta, sem exigir preenchimento manual depois de importar.
function validarVacina(item) {
  if (item.tipo !== 'VACINA') return null;
  const nome = String(item.descricao ?? '').trim() || 'vacina';
  if (!String(item.tipoDose ?? '').trim()) return `Informe o tipo de dose de "${nome}".`;
  if (!String(item.via ?? '').trim())      return `Informe a via de aplicação de "${nome}".`;
  return null;
}

// Monta os dados de gravação de um item — usado por criar e atualizar (que
// substitui a lista inteira), mantendo as duas rotas com as mesmas regras.
function dadosDoItem(item, orcamentoId, refId) {
  const qtd = Number(item.quantidade) || 1;
  const vu  = Number(item.valorUnitario) || 0;
  // Posologia orçada — vale para medicamento E procedimento/combo (duração + frequência)
  const temPosologia = TIPOS_COM_POSOLOGIA.includes(item.tipo);
  const dias = temPosologia && Number(item.dias) > 0 ? Math.trunc(Number(item.dias)) : null;
  // Desconto do item (mesma regra da fatura): lança 400 quando a entrada é inválida
  const desconto = normalizarDesconto(item.descontoTipo, item.descontoValor);
  const bruto    = qtd * vu;
  const liquido  = bruto - descontoDoItem({ valor: vu, quantidade: qtd, ...desconto });
  return {
    orcamentoId,
    animalId:      item.animalId ? Number(item.animalId) : null,
    tipo:          item.tipo,
    refId,
    especialidade: item.especialidade || null,
    descricao:     String(item.descricao).slice(0, 255),
    quantidade:    qtd,
    unidade:       item.unidade || null,
    dias,
    frequencia:    temPosologia && item.frequencia ? String(item.frequencia).slice(0, 50) : null,
    // VACINA — tipo de dose e via de aplicação orçados (ver validarVacina).
    tipoDose:      item.tipo === 'VACINA' && item.tipoDose ? String(item.tipoDose).slice(0, 50)  : null,
    via:           item.tipo === 'VACINA' && item.via      ? String(item.via).slice(0, 100)      : null,
    valorUnitario: vu,
    descontoTipo:  desconto.descontoTipo,
    descontoValor: desconto.descontoValor,
    valorTotal:    Math.round(liquido * 100) / 100,
    statusItem:    'PENDENTE',
  };
}

// Resolve o refId de um item manual criando a entrada de catálogo UMA ÚNICA VEZ por
// (tipo + descrição). O mesmo item manual chega repetido quando o orçamento cobre
// vários animais (uma linha por animal) — sem o cache, cada linha geraria uma
// duplicata no catálogo da empresa. `cache` vive por transação.
async function resolverCatalogoManual(tx, item, empresaId, cache, nomePorEspecie) {
  const chave = `${item.tipo}|${String(item.descricao).trim().toLowerCase()}`;
  if (!cache.has(chave)) cache.set(chave, await criarCatalogoManual(tx, item, empresaId, nomePorEspecie));
  return cache.get(chave);
}

// Cria (ou reaproveita) a entrada de catálogo da empresa para um item manual.
// As ESPÉCIES vêm da tela — são as que a empresa atende (com mais de uma, o usuário
// escolhe quais). Sem elas o item não voltaria nas buscas seguintes.
// MEDICAMENTO e VACINA compartilham tb_medicamentos; a vacina é distinguida por
// classificacao contendo "vacina" (mesmo critério de paraAtendimento).
async function criarCatalogoManual(tx, item, empresaId, nomePorEspecie) {
  const especieIds = normalizarEspecies(item.especieIds);
  if (item.tipo === 'PROCEDIMENTO' || item.tipo === 'COMBO') {
    return garantirProcedimentoDaEmpresa(tx, {
      nome:          item.descricao,
      especialidade: item.especialidade,
      valor:         item.valorUnitario,
      // uma espécie → grava o nome; várias → genérico (o campo é único, em texto)
      especieNome:   especieIds.length === 1 ? nomePorEspecie.get(especieIds[0]) ?? null : null,
    }, empresaId);
  }
  return garantirMedicamentoDaEmpresa(tx, {
    nome:    item.descricao,
    unidade: item.unidade,
    vacina:  item.tipo === 'VACINA',
    especieIds,
  }, empresaId);
}

// Nome de cada espécie usada pelos itens manuais (o catálogo de procedimento guarda
// a espécie como texto).
async function nomesDasEspecies(itens) {
  const ids = normalizarEspecies(itens.flatMap(i => i.especieIds ?? []));
  if (ids.length === 0) return new Map();
  const especies = await prisma.especie.findMany({
    where:  { id: { in: ids } },
    select: { id: true, nome: true },
  });
  return new Map(especies.map(e => [e.id, e.nome]));
}

const OrcamentoController = {

  // GET /api/orcamentos — histórico (filtros: proprietarioId, animalId, status)
  listar: async (req, res) => {
    try {
      const { proprietarioId, animalId, status } = req.query;
      const where = { empresaId: req.empresaId ?? -1, ativo: true };
      if (proprietarioId) where.proprietarioId = Number(proprietarioId);
      if (status)         where.status = String(status);
      if (animalId)       where.itens = { some: { animalId: Number(animalId) } };

      const orcamentos = await prisma.orcamento.findMany({
        where, include: ORC_INCLUDE, orderBy: { numero: 'desc' },
      });
      return res.json({ dados: await listaWithTotaisEPerfil(orcamentos, req.empresaId) });
    } catch (err) {
      console.error('OrcamentoController.listar:', err);
      return res.status(500).json({ error: 'Erro ao listar orçamentos.' });
    }
  },

  // GET /api/orcamentos/:id
  obterPorId: async (req, res) => {
    try {
      const orc = await prisma.orcamento.findFirst({
        where: { id: Number(req.params.id), empresaId: req.empresaId ?? -1, ativo: true },
        include: ORC_INCLUDE,
      });
      if (!orc) return res.status(404).json({ error: 'Orçamento não encontrado.' });
      return res.json({ dados: await withTotaisEPerfil(orc, req.empresaId) });
    } catch (err) {
      console.error('OrcamentoController.obterPorId:', err);
      return res.status(500).json({ error: 'Erro ao obter orçamento.' });
    }
  },

  // POST /api/orcamentos — { proprietarioId, observacao?, itens[] }
  criar: async (req, res) => {
    try {
      if (!req.empresaId) return res.status(400).json({ error: 'Contexto de empresa não resolvido.' });
      const { proprietarioId, observacao, itens } = req.body;
      if (!proprietarioId) return res.status(400).json({ error: 'Selecione o proprietário.' });
      if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Inclua ao menos um item no orçamento.' });
      }
      for (const it of itens) {
        if (!TIPOS.includes(it.tipo)) return res.status(400).json({ error: `Tipo de item inválido: ${it.tipo}` });
        if (!it.descricao?.trim())    return res.status(400).json({ error: 'Item sem descrição.' });
        const erroEsp = validarEspecialidade(it);
        if (erroEsp) return res.status(400).json({ error: erroEsp });
        const erroVac = validarVacina(it);
        if (erroVac) return res.status(400).json({ error: erroVac });
        // Desconto do item — valida antes de abrir a transação
        try { normalizarDesconto(it.descontoTipo, it.descontoValor); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      }
      const prop = await prisma.user.findUnique({ where: { id: Number(proprietarioId) }, select: { id: true } });
      if (!prop) return res.status(404).json({ error: 'Proprietário não encontrado.' });

      const nomePorEspecie = await nomesDasEspecies(itens);
      const criado = await prisma.$transaction(async (tx) => {
        const numero = await proximoNumero(tx, req.empresaId);
        const orc = await tx.orcamento.create({
          data: {
            empresaId:      req.empresaId,
            equipeId:       req.equipeId ?? null,
            proprietarioId: Number(proprietarioId),
            criadoPorId:    req.user.id,
            numero,
            status:         'RASCUNHO',
            observacao:     observacao?.trim() || null,
          },
        });

        const cacheManual = new Map();
        for (const item of itens) {
          let refId = item.refId ? Number(item.refId) : null;
          // Item manual (procedimento/medicamento/vacina fora do catálogo) → cria escopado à empresa
          if (item.manual && TIPOS_MANUAIS.includes(item.tipo)) {
            refId = await resolverCatalogoManual(tx, item, req.empresaId, cacheManual, nomePorEspecie);
          }
          await tx.orcamentoItem.create({ data: dadosDoItem(item, orc.id, refId) });
        }
        return tx.orcamento.findUnique({ where: { id: orc.id }, include: ORC_INCLUDE });
      });

      return res.status(201).json({ dados: await withTotaisEPerfil(criado, req.empresaId) });
    } catch (err) {
      console.error('OrcamentoController.criar:', err);
      return res.status(500).json({ error: 'Erro ao criar orçamento.' });
    }
  },

  // PUT /api/orcamentos/:id — edita observação + substitui itens (só RASCUNHO)
  atualizar: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const orc = await prisma.orcamento.findFirst({ where: { id, empresaId: req.empresaId ?? -1, ativo: true } });
      if (!orc) return res.status(404).json({ error: 'Orçamento não encontrado.' });
      if (orc.status !== 'RASCUNHO') {
        return res.status(400).json({ error: 'Só é possível editar orçamentos em rascunho.' });
      }
      const { observacao, itens } = req.body;
      if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: 'Inclua ao menos um item no orçamento.' });
      }
      for (const it of itens) {
        if (!TIPOS.includes(it.tipo)) return res.status(400).json({ error: `Tipo de item inválido: ${it.tipo}` });
        const erroEsp = validarEspecialidade(it);
        if (erroEsp) return res.status(400).json({ error: erroEsp });
        const erroVac = validarVacina(it);
        if (erroVac) return res.status(400).json({ error: erroVac });
        // Desconto do item — valida antes de abrir a transação
        try { normalizarDesconto(it.descontoTipo, it.descontoValor); }
        catch (e) { return res.status(400).json({ error: e.message }); }
      }

      const nomePorEspecie = await nomesDasEspecies(itens);
      const atualizado = await prisma.$transaction(async (tx) => {
        await tx.orcamentoItem.deleteMany({ where: { orcamentoId: id } });
        const cacheManual = new Map();
        for (const item of itens) {
          let refId = item.refId ? Number(item.refId) : null;
          if (item.manual && TIPOS_MANUAIS.includes(item.tipo)) {
            refId = await resolverCatalogoManual(tx, item, req.empresaId, cacheManual, nomePorEspecie);
          }
          await tx.orcamentoItem.create({ data: dadosDoItem(item, id, refId) });
        }
        return tx.orcamento.update({
          where: { id },
          data:  { observacao: observacao?.trim() || null, status: 'RASCUNHO' },
          include: ORC_INCLUDE,
        });
      });
      return res.json({ dados: await withTotaisEPerfil(atualizado, req.empresaId) });
    } catch (err) {
      console.error('OrcamentoController.atualizar:', err);
      return res.status(500).json({ error: 'Erro ao atualizar orçamento.' });
    }
  },

  // POST /api/orcamentos/:id/decidir — { aceitarTudo } ou { decisoes:[{itemId,statusItem}] }
  // Registrar a decisão FECHA o orçamento item a item: tudo que não vier como ACEITO
  // é marcado REJEITADO. Nenhum item permanece PENDENTE depois de uma decisão.
  decidir: async (req, res) => {
    try {
      const id = Number(req.params.id);
      const orc = await prisma.orcamento.findFirst({ where: { id, empresaId: req.empresaId ?? -1, ativo: true }, select: { id: true } });
      if (!orc) return res.status(404).json({ error: 'Orçamento não encontrado.' });

      const { aceitarTudo, decisoes } = req.body;

      await prisma.$transaction(async (tx) => {
        if (aceitarTudo) {
          await tx.orcamentoItem.updateMany({ where: { orcamentoId: id }, data: { statusItem: 'ACEITO' } });
        } else if (Array.isArray(decisoes)) {
          const aceitos = decisoes
            .filter(d => d.statusItem === 'ACEITO')
            .map(d => Number(d.itemId))
            .filter(Number.isInteger);
          // [-1] representa "conjunto vazio" com segurança: nenhum id real é negativo,
          // então `in` não casa nada e `notIn` casa todos os itens do orçamento.
          const idsAceitos = aceitos.length ? aceitos : [-1];
          await tx.orcamentoItem.updateMany({
            where: { orcamentoId: id, id: { in: idsAceitos } },
            data:  { statusItem: 'ACEITO' },
          });
          await tx.orcamentoItem.updateMany({
            where: { orcamentoId: id, id: { notIn: idsAceitos } },
            data:  { statusItem: 'REJEITADO' },
          });
        }
        const itens = await tx.orcamentoItem.findMany({ where: { orcamentoId: id }, select: { statusItem: true } });
        await tx.orcamento.update({ where: { id }, data: { status: calcularStatus(itens) } });
      });

      const atualizado = await prisma.orcamento.findUnique({ where: { id }, include: ORC_INCLUDE });
      return res.json({ dados: await withTotaisEPerfil(atualizado, req.empresaId) });
    } catch (err) {
      console.error('OrcamentoController.decidir:', err);
      return res.status(500).json({ error: 'Erro ao registrar decisão do orçamento.' });
    }
  },

  // DELETE /api/orcamentos/:id — CANCELA o orçamento (muda o status para CANCELADO;
  // NÃO exclui nem faz soft delete). Motivo obrigatório + auditoria de CANCELAMENTO.
  excluir: async (req, res) => {
    try {
      const id     = Number(req.params.id);
      const motivo = req.body?.motivo?.trim();
      if (!motivo) return res.status(400).json({ error: 'É obrigatório informar o motivo do cancelamento' });

      const orc = await prisma.orcamento.findFirst({ where: { id, empresaId: req.empresaId ?? -1, ativo: true } });
      if (!orc) return res.status(404).json({ error: 'Orçamento não encontrado.' });
      if (orc.status === 'CANCELADO') return res.status(400).json({ error: 'Este orçamento já está cancelado.' });

      await prisma.$transaction(async (tx) => {
        // Continua ativo=true — o orçamento permanece na listagem, agora como CANCELADO.
        // `motivo` é ACRESCENTADO à observação (nunca sobrescreve o que o usuário já
        // tinha escrito) — mesmo padrão do cancelamento automático por validade vencida
        // (orcamentoCronService.js) e por inativação de proprietário
        // (ProprietarioController.removerDaEmpresa). É o que faz a tela de Orçamento
        // conseguir mostrar o motivo do cancelamento, manual ou automático, pelo mesmo campo.
        await tx.orcamento.update({
          where: { id },
          data:  { status: 'CANCELADO', observacao: [orc.observacao?.trim(), motivo].filter(Boolean).join('\n') },
        });
        await registrarAuditoria(tx, req, {
          categoria:  'CANCELAMENTO',
          entidade:   'ORCAMENTO',
          entidadeId: id,
          motivo,
          detalhes:   `Orçamento #${formatNumero(orc.numero)} cancelado`,
        });
      });
      return res.json({ dados: { id, cancelado: true } });
    } catch (err) {
      console.error('OrcamentoController.excluir:', err);
      return res.status(500).json({ error: 'Erro ao cancelar orçamento.' });
    }
  },

  // GET /api/orcamentos/para-importar?proprietarioId=&animalId=&tipos=MEDICAMENTO,PROCEDIMENTO,COMBO
  // Orçamentos APROVADO/PARCIAL com itens ACEITO, do(s) tipo(s), ainda não importados.
  listarParaImportar: async (req, res) => {
    try {
      const { proprietarioId, animalId, tipos } = req.query;
      // OUTROS nunca entra aqui — ele vai direto para a fatura, não para a evolução
      const tiposArr = String(tipos || '').split(',').map(s => s.trim()).filter(t => TIPOS_CLINICOS.includes(t));
      if (tiposArr.length === 0) return res.json({ dados: [] });

      const where = {
        empresaId: req.empresaId ?? -1,
        ativo:     true,
        status:    { in: ['APROVADO', 'APROVADO_PARCIALMENTE'] },
      };
      // Escopo pelo proprietário: explícito, ou derivado do animal em atendimento
      let propId = proprietarioId ? Number(proprietarioId) : null;
      if (!propId && animalId) {
        const animal = await prisma.animal.findUnique({ where: { id: Number(animalId) }, select: { userId: true } });
        propId = animal?.userId ?? null;
      }
      if (propId) where.proprietarioId = propId;

      const orcamentos = await prisma.orcamento.findMany({
        where,
        include: {
          proprietario: { select: { id: true, fullName: true } },
          itens: {
            where: {
              statusItem:  'ACEITO',
              importadoEm: null,
              tipo:        { in: tiposArr },
              // item do animal solicitado OU item de nível proprietário (animalId null)
              ...(animalId ? { OR: [{ animalId: Number(animalId) }, { animalId: null }] } : {}),
            },
            select: ITEM_SELECT,
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { numero: 'desc' },
      });

      // Candidatos: orçamentos que ainda têm itens importáveis (não importados)
      const candidatos = orcamentos.filter(o => o.itens.length > 0);

      // Import "iniciado" = orçamento que JÁ tem QUALQUER item importado — CROSS-CATEGORIA
      // (sem filtro por tipo/animal). Se começar a importar de um orçamento em qualquer
      // categoria (prescrição, vacina, …), TODOS os modais passam a mostrar só ele, até
      // ser concluído — obriga a terminar o orçamento começado antes de partir p/ outro.
      let iniciados = new Set();
      if (candidatos.length > 0) {
        const grupos = await prisma.orcamentoItem.groupBy({
          by: ['orcamentoId'],
          where: {
            orcamentoId: { in: candidatos.map(o => o.id) },
            statusItem:  'ACEITO',
            importadoEm: { not: null },
          },
          _count: { _all: true },
        });
        iniciados = new Set(grupos.map(g => g.orcamentoId));
      }

      const visiveis = iniciados.size > 0
        ? candidatos.filter(o => iniciados.has(o.id))
        : candidatos;

      const dados = visiveis.map(o => ({ ...o, numeroFormatado: formatNumero(o.numero) }));
      return res.json({ dados });
    } catch (err) {
      console.error('OrcamentoController.listarParaImportar:', err);
      return res.status(500).json({ error: 'Erro ao listar orçamentos para importar.' });
    }
  },

  // POST /api/orcamentos/importar — { itemIds } → marca importadoEm
  marcarImportados: async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number).filter(Number.isInteger) : [];
      if (ids.length === 0) return res.status(400).json({ error: 'Nenhum item informado.' });
      // Escopa à empresa (via join com orcamento) para não marcar itens de outra empresa
      await prisma.orcamentoItem.updateMany({
        where: { id: { in: ids }, orcamento: { empresaId: req.empresaId ?? -1 } },
        data:  { importadoEm: new Date() },
      });
      return res.json({ dados: { marcados: ids.length } });
    } catch (err) {
      console.error('OrcamentoController.marcarImportados:', err);
      return res.status(500).json({ error: 'Erro ao marcar itens importados.' });
    }
  },

  // GET /api/orcamentos/outros-para-fatura?proprietarioId=
  // Itens tipo OUTROS já ACEITO e ainda não lançados, do proprietário, agrupados por
  // orçamento. `pendentesClinicos` é AVISO (quantos itens clínicos do mesmo orçamento
  // ainda não foram importados numa evolução) — NÃO bloqueia o lançamento: importar é
  // opcional, e travar nisso deixava taxa/transporte impossível de cobrar.
  listarOutrosParaFatura: async (req, res) => {
    try {
      const proprietarioId = req.query.proprietarioId ? Number(req.query.proprietarioId) : null;
      if (!proprietarioId) return res.json({ dados: [] });

      const orcamentos = await prisma.orcamento.findMany({
        where: {
          empresaId:      req.empresaId ?? -1,
          ativo:          true,
          proprietarioId,
          status:         { in: ['APROVADO', 'APROVADO_PARCIALMENTE'] },
        },
        include: { itens: { where: { statusItem: 'ACEITO' }, select: ITEM_SELECT, orderBy: { id: 'asc' } } },
        orderBy: { numero: 'desc' },
      });

      const dados = orcamentos
        .map(o => {
          const outros     = o.itens.filter(i => i.tipo === 'OUTROS' && !i.importadoEm);
          const pendentes  = o.itens.filter(i => TIPOS_CLINICOS.includes(i.tipo) && !i.importadoEm);
          return {
            id:              o.id,
            numeroFormatado: formatNumero(o.numero),
            // AVISO, não permissão: o item OUTROS pode ser lançado mesmo com item
            // clínico pendente (ver `lancarNaFatura`). Serve para o financeiro saber
            // que aquele orçamento ainda não foi consumido por inteiro.
            pendentesClinicos: pendentes.length,
            itens:           outros,
          };
        })
        .filter(o => o.itens.length > 0);

      return res.json({ dados });
    } catch (err) {
      console.error('OrcamentoController.listarOutrosParaFatura:', err);
      return res.status(500).json({ error: 'Erro ao listar itens do orçamento para a fatura.' });
    }
  },

  // POST /api/orcamentos/lancar-na-fatura — { faturaId, itemIds }
  // Lança itens OUTROS aceitos direto como FaturaItem e os marca como importados.
  // Sem trava por item clínico pendente (removida em 2026-08-01 — ver `lancarNaFatura`).
  lancarNaFatura: async (req, res) => {
    try {
      const faturaId = Number(req.body?.faturaId);
      // dedup: id repetido no body não pode virar duas cobranças nem furar a conferência abaixo
      const ids = [...new Set(Array.isArray(req.body?.itemIds) ? req.body.itemIds.map(Number).filter(Number.isInteger) : [])];
      if (!Number.isInteger(faturaId)) return res.status(400).json({ error: 'Informe a fatura de destino.' });
      if (ids.length === 0)            return res.status(400).json({ error: 'Nenhum item informado.' });

      const fatura = await prisma.fatura.findUnique({
        where:  { id: faturaId },
        select: { id: true, status: true, proprietarioId: true },
      });
      if (!fatura) return res.status(404).json({ error: 'Fatura não encontrada.' });
      if (fatura.status === 'PAGA') {
        return res.status(400).json({ error: 'Fatura já paga não pode receber novos itens.', code: 'FATURA_PAGA' });
      }
      if (fatura.status === 'CANCELADA') {
        return res.status(400).json({ error: 'Fatura cancelada não pode receber novos itens.' });
      }

      const itens = await prisma.orcamentoItem.findMany({
        where:   { id: { in: ids }, orcamento: { empresaId: req.empresaId ?? -1, ativo: true } },
        include: { orcamento: { select: { id: true, numero: true, proprietarioId: true, status: true } } },
      });
      if (itens.length !== ids.length) {
        return res.status(404).json({ error: 'Item de orçamento não encontrado nesta empresa.' });
      }
      const invalido = itens.find(i =>
        i.tipo !== 'OUTROS' || i.statusItem !== 'ACEITO' || i.importadoEm !== null
        || !['APROVADO', 'APROVADO_PARCIALMENTE'].includes(i.orcamento.status));
      if (invalido) {
        return res.status(400).json({ error: 'Só itens "Outros" aprovados e ainda não lançados podem ir para a fatura.' });
      }
      if (itens.some(i => i.orcamento.proprietarioId !== fatura.proprietarioId)) {
        return res.status(400).json({ error: 'O orçamento é de outro proprietário.' });
      }

      // NÃO existe mais trava por "itens clínicos ainda não importados" (removida em
      // 2026-08-01). Ela prendia o item OUTROS para SEMPRE: `importadoEm` do item
      // clínico só é gravado quando alguém importa aquele item numa prescrição/vacina,
      // e importar é OPCIONAL — o orçamento inteiro é etapa opcional. Vet que atendeu
      // sem importar (ou que orçou 3 animais e atendeu 1) deixava a taxa/transporte
      // impossível de cobrar, sem nenhuma saída na tela. A pendência continua sendo
      // INFORMADA no modal (`pendentesClinicos`), como aviso — não como bloqueio.

      const total = await prisma.$transaction(async (tx) => {
        for (const item of itens) {
          await tx.faturaItem.create({
            data: {
              faturaId,
              animalId:        item.animalId ?? null,
              tipo:            'OUTROS',
              descricao:       `[ORC-${formatNumero(item.orcamento.numero)}] ${item.descricao}`,
              valor:           item.valorUnitario ?? 0,
              quantidade:      item.quantidade ?? 1,
              // O desconto negociado no orçamento acompanha o item na fatura
              descontoTipo:    item.descontoTipo ?? null,
              descontoValor:   item.descontoValor ?? 0,
              veterinarioId:   req.user.id,
              orcamentoItemId: item.id,
            },
          });
        }
        await tx.orcamentoItem.updateMany({
          where: { id: { in: itens.map(i => i.id) } },
          data:  { importadoEm: new Date() },
        });
        return recalcularTotal(tx, faturaId);
      });

      return res.status(201).json({ dados: { lancados: itens.length, totalFatura: total } });
    } catch (err) {
      console.error('OrcamentoController.lancarNaFatura:', err);
      return res.status(500).json({ error: 'Erro ao lançar itens do orçamento na fatura.' });
    }
  },

  // POST /api/orcamentos/:id/enviar-whatsapp — gera o PDF (resumido) e envia ao cliente.
  // Usa o componente reutilizável documentoWhatsappService (mesmo caminho da fatura).
  enviarWhatsApp: async (req, res) => {
    try {
      const id  = Number(req.params.id);
      const orc = await prisma.orcamento.findFirst({
        where: { id, empresaId: req.empresaId ?? -1, ativo: true },
        include: ORC_INCLUDE,
      });
      if (!orc) return res.status(404).json({ error: 'Orçamento não encontrado.' });

      // Cadastro do cliente NESTA empresa (nome e telefone do documento e do envio)
      const comTotais = await withTotaisEPerfil(orc, req.empresaId);

      // Telefone: o do body (edição pontual) tem precedência sobre o cadastro
      const telefone = req.body?.telefone?.trim() || comTotais.proprietario?.phone || null;
      if (!telefone) {
        return res.status(400).json({ error: 'Proprietário sem telefone cadastrado.', code: 'SEM_TELEFONE' });
      }

      const empresa = await prisma.empresa.findUnique({
        where: { id: req.empresaId }, select: { nome: true },
      });

      const html = gerarHtmlOrcamentoCliente(comTotais, { empresaNome: empresa?.nome });
      const r = await enviarDocumentoWhatsApp({
        empresaId:   req.empresaId,
        equipeId:    req.equipeId ?? null,
        telefone,
        html,
        nomeArquivo: `orcamento-${comTotais.numeroFormatado}.pdf`,
        legenda:     `Orçamento #${comTotais.numeroFormatado} — ${brlSimples(comTotais.valorTotal)}`,
        contexto:    { orcamentoId: id },
      });

      if (!r.sucesso) {
        return res.status(502).json({ error: MSG_ERRO_WA[r.erro] ?? 'Falha ao enviar pelo WhatsApp.', code: r.erro });
      }
      return res.json({ dados: { enviado: true, simulado: !!r.simulado, telefone } });
    } catch (err) {
      console.error('OrcamentoController.enviarWhatsApp:', err);
      return res.status(500).json({ error: 'Erro ao enviar orçamento por WhatsApp.' });
    }
  },

  // GET /api/orcamentos/proprietarios — proprietários da empresa (para o builder)
  listarProprietarios: async (req, res) => {
    try {
      const empresaId = req.empresaId ?? null;
      if (!empresaId) return res.json({ dados: [] });

      // Mesmo escopo da listagem de pacientes (AnimalController.listar): inclui animais
      // co-atendidos de OUTRA empresa via vínculo do vet/gestor — assim um proprietário
      // cliente de mais de uma clínica aparece com seus animais no contexto ativo.
      const { where: scopeWhere } = await buildAnimalScopeWhere(req);
      const animais = await prisma.animal.findMany({
        where:  { AND: [scopeWhere, { ativo: true }] },
        select: { userId: true },
      });
      // Proprietário removido DESTA empresa (ProprietarioPerfil.ativo=false) não entra
      // pela via direta — só continuaria aparecendo se tivesse animal ativo no escopo
      // (já coberto por `animais` acima).
      const filtroPerfilAtivo = proprietarioAtivoNaEmpresa(empresaId).user;
      const propsDiretos = await prisma.user.findMany({
        where: {
          userType: 'PROPRIETARIO', empresaId, ativo: true,
          ...(filtroPerfilAtivo?.OR ? { OR: filtroPerfilAtivo.OR } : {}),
        },
        select: { id: true },
      });
      const ids = [...new Set([...animais.map(a => a.userId), ...propsDiretos.map(p => p.id)])];
      if (ids.length === 0) return res.json({ dados: [] });

      const props = await prisma.user.findMany({
        where:   { id: { in: ids } },
        select:  { id: true, fullName: true, email: true, phone: true },
        orderBy: { fullName: 'asc' },
      });

      // Dedup por e-mail normalizado (contas duplicadas por maiúsc/minúsc — ex:
      // "Karina@gmail.com" e "karina@gmail.com"). Mantém a conta que tem animais no escopo.
      const animalCount = new Map();
      for (const a of animais) animalCount.set(a.userId, (animalCount.get(a.userId) ?? 0) + 1);
      const porChave = new Map();
      for (const p of props) {
        const chave = (p.email || p.fullName || String(p.id)).trim().toLowerCase();
        const atual = porChave.get(chave);
        if (!atual || (animalCount.get(p.id) ?? 0) > (animalCount.get(atual.id) ?? 0)) porChave.set(chave, p);
      }
      const distintos = [...porChave.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'));
      return res.json({ dados: distintos });
    } catch (err) {
      console.error('OrcamentoController.listarProprietarios:', err);
      return res.status(500).json({ error: 'Erro ao listar proprietários.' });
    }
  },

  // GET /api/orcamentos/proprietario/:id/animais — animais do proprietário no escopo
  // (inclui animais co-atendidos de outra empresa, via vínculo — mesmo critério da
  // listagem de pacientes). Um animal registrado em 2 clínicas aparece em ambas.
  listarAnimaisDoProprietario: async (req, res) => {
    try {
      const proprietarioId = Number(req.params.id);
      const { where: scopeWhere } = await buildAnimalScopeWhere(req);
      const animais = await prisma.animal.findMany({
        where: { AND: [scopeWhere, { userId: proprietarioId, ativo: true }] },
        select: {
          id: true, nome: true, especieId: true,
          especie: { select: { nome: true } },
          raca:    { select: { nome: true } },
        },
        orderBy: { nome: 'asc' },
      });
      return res.json({ dados: animais });
    } catch (err) {
      console.error('OrcamentoController.listarAnimaisDoProprietario:', err);
      return res.status(500).json({ error: 'Erro ao listar animais do proprietário.' });
    }
  },
};

module.exports = OrcamentoController;
