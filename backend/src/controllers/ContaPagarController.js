'use strict';
/**
 * FINANCEIRO > PAGAMENTOS — o que a clínica DEVE a terceiros (2026-09-10)
 *
 * 🔴 É O OUTRO LADO DO BALCÃO DA FATURA. `FaturaController` responde "quanto o cliente
 * me deve"; este responde "quanto eu devo ao fornecedor e ao prestador". Os dois
 * nascem do MESMO evento — a execução — e por isso conferem entre si, mas são
 * documentos diferentes, para pessoas diferentes, com totais diferentes.
 *
 * 🔴 UMA tela para os dois tipos, separados por `?tipo=`. FORNECEDOR e PRESTADOR têm o
 * mesmo ciclo (abrir → fechar → pagar) e o mesmo formato de linha; duas telas
 * divergiriam na primeira correção — e o que divergiria seria como a clínica apura o
 * que paga.
 *
 * ⚠️ O lançamento AUTOMÁTICO não passa por aqui: ele acontece na execução, dentro da
 * transaction que cobra o cliente (`PrescricaoGrupoController.executar`,
 * `VacinaClinicaController.darBaixaEFaturar`). Este controller é a LEITURA, o
 * fechamento e o lançamento MANUAL do que o automático não pegou.
 */

const prisma = require('../lib/prisma').default;
const contasPagar = require('../lib/contasPagar');
const { registrarAuditoria } = require('../lib/auditoria');
const { resolverPeriodo } = require('./RelatorioGerencialController');

/** Fornecedores e prestadores da empresa, para o seletor do lançamento manual. */
const listarCredores = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [] });
    const tipo = req.query.tipo === 'PRESTADOR' ? 'PRESTADOR' : 'FORNECEDOR';
    // ⚠️ As duas tabelas são INDEPENDENTES desde 2026-08-21 e não compartilham id —
    // por isso o `tipo` escolhe a tabela, e não um filtro dentro de uma só.
    const dados = tipo === 'PRESTADOR'
      ? await prisma.prestador.findMany({
          where:  { empresaId: req.empresaId, ativo: true },
          // `telefone` entrou em 2026-09-18: é o DESTINO do WhatsApp da tela de
          // Pagamentos. Sem ele o envio cai no fallback manual (baixa o PDF e abre o
          // app), que funciona — mas obriga a procurar o contato à mão.
          select: { id: true, nome: true, tipoServico: true, telefone: true },
          orderBy: { nome: 'asc' },
        })
      : await prisma.fornecedor.findMany({
          // Fornecedor GLOBAL (empresa_id null, semeado pelo ADMIN) também atende a
          // clínica — escondê-lo obrigaria a recadastrar quem já existe.
          where:  { ativo: true, OR: [{ empresaId: null }, { empresaId: req.empresaId }] },
          select: { id: true, nome: true, tipoServico: true, telefone: true },
          orderBy: { nome: 'asc' },
        });
    return res.json({ dados });
  } catch (err) {
    console.error('ContaPagarController.listarCredores:', err);
    return res.status(500).json({ error: 'Erro ao listar credores.' });
  }
};

// GET /api/financeiro/contas-pagar?tipo=&granularidade=&data=&status=
const listar = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [], recursos: { disponivel: false } });
    const disponivel = await contasPagar.temTabelas();
    if (!disponivel) {
      // Base sem a migration EXPLICA o que falta, em vez de devolver lista vazia —
      // que se lê como "não há nada a pagar", uma afirmação diferente e errada.
      return res.json({
        dados: [], recursos: { disponivel: false },
        mensagem: 'Falta aplicar a migration 20261006000000_produtos_contas_pagar.',
      });
    }

    const tipo = req.query.tipo === 'PRESTADOR' ? 'PRESTADOR' : 'FORNECEDOR';
    const { inicio, fim } = resolverPeriodo(req);
    // ⚠️ Janela `[inicio, fim)` com o fim EXCLUSIVO (+1ms sobre o fim inclusivo de
    // `resolverPeriodo`): com `<=` numa data sem hora, o lançamento do último
    // milissegundo do período ficaria de fora — a mesma correção do recibo.
    const fimExclusivo = new Date(new Date(fim).getTime() + 1);

    const dados = await contasPagar.listarContas(req.empresaId, {
      tipo,
      inicio,
      fim: fimExclusivo,
      status: req.query.status,
    });
    return res.json({ dados, recursos: { disponivel: true } });
  } catch (err) {
    console.error('ContaPagarController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar as contas a pagar.' });
  }
};

// POST /api/financeiro/contas-pagar/lancar — lançamento MANUAL
const lancar = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const r = await contasPagar.lancarManual(prisma, req.empresaId, {
      ...req.body,
      // O SOLICITANTE do lançamento manual é quem está lançando — não há execução
      // clínica de onde deduzir outro.
      solicitanteId:   req.user?.id ?? null,
      solicitanteNome: req.user?.fullName ?? '',
    });
    if (r.erro) return res.status(400).json({ error: r.erro });
    return res.status(201).json({ dados: { contaId: r.contaId } });
  } catch (err) {
    console.error('ContaPagarController.lancar:', err);
    return res.status(500).json({ error: 'Erro ao lançar na conta.' });
  }
};

// PATCH /api/financeiro/contas-pagar/:id/status  { status, motivo? }
const alterarStatus = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const { status } = req.body ?? {};
    const motivo = String(req.body?.motivo ?? '').trim();
    // CANCELAR uma conta a pagar é ato destrutivo sobre registro financeiro — mesma
    // regra do §33: justificativa obrigatória e trilha na auditoria.
    if (status === 'CANCELADA' && motivo.length < 3) {
      return res.status(400).json({ error: 'Informe o motivo do cancelamento.' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const r = await contasPagar.alterarStatus(tx, req.empresaId, req.params.id, status, req.user?.id);
      if (r.erro) return r;
      await registrarAuditoria(tx, req, {
        categoria:  status === 'CANCELADA' ? 'CANCELAMENTO' : 'ALTERACAO',
        entidade:   'CONTA_PAGAR',
        entidadeId: Number(req.params.id),
        motivo:     motivo || null,
        detalhes:   `Conta de ${r.dados.tipo.toLowerCase()} "${r.dados.credorNome}" → ${status}`,
      });
      return r;
    });

    if (resultado.erro) return res.status(400).json({ error: resultado.erro });
    return res.json({ dados: resultado.dados });
  } catch (err) {
    console.error('ContaPagarController.alterarStatus:', err);
    return res.status(500).json({ error: 'Erro ao alterar o status da conta.' });
  }
};

// PATCH /api/financeiro/contas-pagar/itens/:itemId  { valor }
// 🔴 A outra metade do lançamento zerado (2026-09-18): o procedimento sem valor
// cadastrado passa a APARECER na conta, e é aqui que o financeiro informa quanto vale.
// Sem esta rota o item zerado seria só uma linha inútil.
const atualizarItem = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });

    const resultado = await prisma.$transaction(async (tx) => {
      const r = await contasPagar.atualizarValorItem(tx, req.empresaId, req.params.itemId, req.body?.valor);
      if (r.erro) return r;
      // Dinheiro que muda de valor deixa rastro: quem alterou, de quanto para quanto.
      await registrarAuditoria(tx, req, {
        categoria:  'ALTERACAO',
        entidade:   'CONTA_PAGAR_ITEM',
        entidadeId: Number(req.params.itemId),
        detalhes:   `Valor do item definido em R$ ${Number(r.valor).toFixed(2)}`,
      });
      return r;
    });

    if (resultado.erro) return res.status(400).json({ error: resultado.erro });
    return res.json({ dados: resultado });
  } catch (err) {
    console.error('ContaPagarController.atualizarItem:', err);
    return res.status(500).json({ error: 'Erro ao atualizar o item.' });
  }
};

// DELETE /api/financeiro/contas-pagar/itens/:itemId  { motivo }
const removerItem = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Informe o motivo da remoção.' });

    const ok = await prisma.$transaction(async (tx) => {
      const removido = await contasPagar.removerItem(tx, req.empresaId, req.params.itemId);
      if (!removido) return false;
      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'CONTA_PAGAR_ITEM',
        entidadeId: Number(req.params.itemId),
        motivo,
      });
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Item não encontrado.' });
    return res.json({ mensagem: 'Item removido.' });
  } catch (err) {
    console.error('ContaPagarController.removerItem:', err);
    return res.status(500).json({ error: 'Erro ao remover o item.' });
  }
};

module.exports = { listar, listarCredores, lancar, alterarStatus, removerItem, atualizarItem };
