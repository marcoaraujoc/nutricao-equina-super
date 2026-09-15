'use strict';
/**
 * CADASTRO > PRODUTOS (2026-09-10)
 *
 * 🔴 O QUE ESTA TELA REÚNE: até aqui, cadastrar um item que a clínica usa exigia
 * passar por três lugares diferentes — `/medicamentos` (catálogo, ADMIN da
 * plataforma), `/cadastro-vacina` (catálogo de vacina) e `/farmacia`
 * ou `/estoque-vacina` (a entrada física). Produtos é a tela da CLÍNICA: cadastra o
 * item, diz de quem ela compra, e — só se ela quiser — dá entrada no estoque.
 *
 * ⚠️ NÃO substitui as telas anteriores (decisão de 2026-09-10). `/medicamentos`
 * continua sendo o catálogo GLOBAL do ADMIN, com 4.878 itens que valem para todas as
 * clínicas; aqui nasce o item PRÓPRIO da empresa (`empresa_id` setado), que só ela vê.
 *
 * 🔴 A DIFERENÇA ENTRE "PRODUTO" E "ESTOQUE", que é o que a tela existe para
 * registrar:
 *   • PRODUTO  = tenho fornecedor para este item. A clínica NÃO o guarda; pede quando
 *                o vet prescreve. Aparece VERDE na prescrição, com o nome do fornecedor.
 *   • ESTOQUE  = tenho o frasco aqui. Quantidade, lote, validade.
 * O checkbox "dar entrada no estoque" é o que separa os dois — marcado, o item vira
 * as DUAS coisas (a clínica comprou daquele fornecedor E guardou).
 */

const prisma = require('../lib/prisma').default;
const { garantirMedicamentoDaEmpresa } = require('../lib/catalogoManual');
const produtoFornecedor = require('../lib/produtoFornecedor');
const { registrarAuditoria } = require('../lib/auditoria');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// GET /api/cadastro/produtos?busca=&ativo=
const listar = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [], recursos: { disponivel: false } });
    const disponivel = await produtoFornecedor.temTabela();
    const dados = disponivel
      ? await produtoFornecedor.listarDaEmpresa(req.empresaId, {
          busca: req.query.busca,
          ativo: req.query.ativo === 'all' ? 'all' : req.query.ativo !== 'false',
        })
      : [];
    // ⚠️ A bandeira diz se a MIGRATION foi aplicada. Sem ela a tela mostra um aviso
    // que nomeia o que falta, em vez de uma lista vazia que se lê como "não há
    // produto cadastrado" — o pior resultado possível (mesmo padrão do
    // `recursos.comboPrestador` e do `recursos.porProcedimento`).
    //
    // ⚠️ `multidose` vem JÁ NA CARGA DA TELA, não só no detalhe do item: o checkbox
    // precisa estar escondido desde o primeiro render. Resolvê-lo só ao escolher um
    // item do catálogo deixaria o campo à mostra para quem digita um produto NOVO — e
    // a marcação sumiria no salvar, em silêncio, que é o que a bandeira existe para
    // evitar.
    return res.json({
      dados,
      recursos: { disponivel, multidose: await produtoFornecedor.temColunasMultidose() },
    });
  } catch (err) {
    console.error('ProdutoController.listar:', err);
    return res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
};

// GET /api/cadastro/produtos/catalogo?tipo=medicamento|vacina&busca=
// Itens do catálogo (global + da empresa) para o seletor da tela — é aqui que o
// gestor escolhe SE está cadastrando um item que já existe ou criando um novo.
const listarCatalogo = async (req, res) => {
  try {
    const tipo  = req.query.tipo === 'vacina' ? 'vacina' : 'medicamento';
    const busca = String(req.query.busca ?? '').trim();
    const where = { ativo: true };
    // Mesmo critério de `MedicamentoController.paraAtendimento`: a vacina é a linha
    // cuja `classificacao` contém "vacin". Duas regras para "isto é vacina?" fariam
    // esta tela e o seletor do atendimento discordarem sobre o mesmo item.
    if (tipo === 'vacina') where.classificacao = { contains: 'vacin', mode: 'insensitive' };
    else                   where.NOT = { classificacao: { contains: 'vacin', mode: 'insensitive' } };
    if (busca) {
      where.OR = [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
      ];
    }
    where.AND = [{ OR: [{ empresaId: null }, ...(req.empresaId ? [{ empresaId: req.empresaId }] : [])] }];

    const itens = await prisma.medicamento.findMany({
      where,
      select: { id: true, nome: true, formaFarmaceutica: true, unidade: true, empresaId: true },
      orderBy: { nome: 'asc' },
      // Teto de 50: o catálogo tem milhares de linhas e o seletor é de BUSCA, não de
      // rolagem. Sem o corte, abrir a tela baixaria o catálogo inteiro.
      take: 50,
    });
    return res.json({ dados: itens });
  } catch (err) {
    console.error('ProdutoController.listarCatalogo:', err);
    return res.status(500).json({ error: 'Erro ao listar o catálogo.' });
  }
};

/**
 * GET /api/cadastro/produtos/detalhe?medicamentoId=&fornecedorId=
 *
 * 🔴 O QUE ESCOLHER O ITEM PASSA A CARREGAR (pedido de 2026-09-12): o formulário
 * abria em branco mesmo para um item que a clínica JÁ compra — a pessoa redigitava
 * preço, unidade e fornecedor que já estavam no banco, e ao salvar sobrescrevia o
 * cadastro sem nunca ter visto o que havia nele. Agora o item escolhido traz o que
 * está gravado, e tudo continua EDITÁVEL.
 *
 * Devolve o item do CATÁLOGO + os VÍNCULOS de fornecedor daquela empresa. Quem
 * escolhe qual vínculo preenche o formulário é a tela: o do fornecedor selecionado,
 * ou o primeiro quando ainda não há fornecedor escolhido.
 *
 * ⚠️ MULTI-TENANT: o catálogo é MISTO — só passa a linha GLOBAL (`empresa_id IS
 * NULL`) ou a da PRÓPRIA empresa; item de outra clínica responde 404, nunca os dados.
 * Os vínculos saem de `listarDaEmpresa`, escopado por `empresa_id`.
 */
const detalhe = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const medicamentoId = Number(req.query.medicamentoId);
    if (!Number.isInteger(medicamentoId)) {
      return res.status(400).json({ error: 'Informe o item do catálogo.' });
    }

    const item = await prisma.medicamento.findFirst({
      where: {
        id: medicamentoId,
        // O RLS já recusaria a linha de outra clínica; o filtro explícito é o que faz
        // a resposta ser a mesma com e sem o carimbo de tenant (ADMIN incluído).
        OR: [{ empresaId: null }, { empresaId: req.empresaId }],
      },
      select: {
        id: true, nome: true, formaFarmaceutica: true, unidade: true,
        apresentacao: true, classificacao: true, fabricante: true,
        controlado: true, empresaId: true,
      },
    });
    if (!item) return res.status(404).json({ error: 'Item não encontrado no catálogo desta clínica.' });

    const produtos = (await produtoFornecedor.listarDaEmpresa(req.empresaId, { ativo: 'all' }))
      .filter(p => p.medicamentoId === medicamentoId);

    return res.json({
      dados: {
        catalogo: {
          ...item,
          ehVacina: /vacin/i.test(String(item.classificacao ?? '')),
        },
        produtos,
        // A bandeira diz se a coluna de multidose existe — sem ela a tela esconde o
        // checkbox em vez de oferecer um campo cuja marcação sumiria no salvar, em
        // silêncio (mesmo padrão de `recursos.comboPrestador`).
        recursos: { multidose: await produtoFornecedor.temColunasMultidose() },
      },
    });
  } catch (err) {
    console.error('ProdutoController.detalhe:', err);
    return res.status(500).json({ error: 'Erro ao carregar o produto.' });
  }
};

/**
 * POST /api/cadastro/produtos
 *
 * Corpo: { tipo, medicamentoId?, nome?, unidade?, especieIds?, fornecedorId,
 *          valorUnitario?, valorVenda?, notaFiscal?, observacao?,
 *          entrarNoEstoque?, estoque: { quantidade, lote, validade, valor, ... } }
 *
 * 🔴 TUDO numa transaction: o item de catálogo, o vínculo com o fornecedor e a
 * entrada de estoque nascem juntos ou não nascem. Sem isso, uma falha no meio
 * deixaria o item cadastrado sem fornecedor (invisível como produto) ou o estoque
 * apontando para um vínculo que não existe.
 */
const criar = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa antes de cadastrar.' });
    if (!(await produtoFornecedor.temTabela())) {
      return res.status(400).json({
        error: 'Recurso de produtos ainda não disponível nesta base. Falta aplicar a migration 20261006000000_produtos_contas_pagar.',
        code:  'MIGRATION_PENDENTE',
      });
    }

    const {
      tipo = 'medicamento', medicamentoId, nome, unidade, especieIds = [],
      fornecedorId, valorUnitario, valorVenda, notaFiscal, observacao,
      multidose = false, dosesPorEmbalagem,
      entrarNoEstoque = false, estoque = {},
    } = req.body ?? {};

    const ehVacina = tipo === 'vacina';
    if (!fornecedorId) return res.status(400).json({ error: 'Selecione o fornecedor.' });
    if (!medicamentoId && !String(nome ?? '').trim()) {
      return res.status(400).json({ error: 'Escolha um item do catálogo ou informe o nome do produto novo.' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      // 1. O item do CATÁLOGO — reaproveita o escolhido, ou cria o da empresa.
      // ⚠️ `garantirMedicamentoDaEmpresa` é idempotente por (nome, empresa, tipo): é
      // ele que impede o mesmo produto virar duas linhas quando cadastrado duas vezes.
      const medId = medicamentoId
        ? Number(medicamentoId)
        : await garantirMedicamentoDaEmpresa(tx, {
            nome, unidade, vacina: ehVacina, especieIds,
          }, req.empresaId);
      if (!medId) throw new Error('Não foi possível resolver o item do catálogo.');

      // 2. O VÍNCULO com o fornecedor — é isto que faz o item ser "produto".
      const salvo = await produtoFornecedor.salvarProduto(tx, {
        empresaId: req.empresaId,
        medicamentoId: medId,
        fornecedorId,
        valorUnitario, valorVenda, unidade, notaFiscal, observacao,
        multidose, dosesPorEmbalagem,
        ativo: true,
      });
      if (salvo.erro) throw new Error(salvo.erro);

      // 3. A entrada de ESTOQUE — só quando o gestor marcou o checkbox.
      let estoqueId = null;
      if (entrarNoEstoque) {
        // ⚠️ "Doses por embalagem" é UM dado só: o do checkbox de multidose governa
        // também o `dosesPorFrasco` do lote de vacina. Dois campos para a mesma coisa
        // divergiriam, e quem diverge aqui é o número que desconta a dose do frasco.
        const estoqueEfetivo = multidose && dosesPorEmbalagem
          ? { ...estoque, dosesPorFrasco: estoque.dosesPorFrasco ?? dosesPorEmbalagem }
          : estoque;
        estoqueId = ehVacina
          ? await entradaLoteVacina(tx, { medId, fornecedorId, notaFiscal, estoque: estoqueEfetivo, empresaId: req.empresaId })
          : await entradaEstoqueFarmacia(tx, { medId, fornecedorId, notaFiscal, estoque: estoqueEfetivo, empresaId: req.empresaId });
      }

      await registrarAuditoria(tx, req, {
        categoria:  'CRIACAO',
        entidade:   'PRODUTO',
        entidadeId: salvo.id,
        detalhes:   `Produto "${nome ?? `#${medId}`}" (${ehVacina ? 'vacina' : 'medicamento'})`
                    + (entrarNoEstoque ? ' com entrada no estoque' : ''),
      });

      return { id: salvo.id, medicamentoId: medId, estoqueId };
    });

    return res.status(201).json({ dados: resultado });
  } catch (err) {
    console.error('ProdutoController.criar:', err);
    return res.status(500).json({ error: err.message || 'Erro ao cadastrar o produto.' });
  }
};

/**
 * Entrada de estoque da FARMÁCIA (medicamento).
 *
 * ⚠️ Espelha `EstoqueController.criar`, inclusive o `MovimentoEstoque` de ENTRADA —
 * sem ele o item nasce com saldo que não veio de lugar nenhum, e o relatório de
 * movimentação não fecha com o saldo.
 */
async function entradaEstoqueFarmacia(tx, { medId, fornecedorId, notaFiscal, estoque, empresaId }) {
  const qtd = num(estoque.quantidade) ?? 0;
  const criado = await tx.estoqueClinica.create({
    data: {
      medicamentoId:    medId,
      empresaId:        Number(empresaId),
      fornecedorId:     fornecedorId ? Number(fornecedorId) : null,
      notaFiscal:       String(notaFiscal ?? '').trim().slice(0, 100) || null,
      valor:            num(estoque.valor) ?? 0,
      valorRepassado:   num(estoque.valorRepassado) ?? 0,
      precoUnitarioBase: num(estoque.precoUnitarioBase),
      lote:             String(estoque.lote ?? '').trim().slice(0, 100) || null,
      validade:         estoque.validade ? new Date(estoque.validade) : null,
      qtdEstoque:       qtd,
      qtdEmbalagens:    num(estoque.qtdEmbalagens),
      pesoPorEmbalagem: num(estoque.pesoPorEmbalagem),
      estoqueMinimo:    num(estoque.estoqueMinimo) ?? 0,
      estoqueAlarmante: num(estoque.estoqueAlarmante) ?? 0,
      ativo:            true,
    },
    select: { id: true },
  });
  if (qtd > 0) {
    await tx.movimentoEstoque.create({
      data: { estoqueId: criado.id, tipo: 'ENTRADA', quantidade: qtd, motivo: 'Entrada inicial (Produtos)' },
    });
  }
  return criado.id;
}

/**
 * Entrada de LOTE de vacina.
 *
 * ⚠️ `fornecedor_id`/`nota_fiscal` do lote são colunas NOVAS (migration
 * 20261006000000) e vão por SQL cru depois do create — o client pode não conhecê-las
 * (§11), e passá-las ao `create` tipado derrubaria a criação inteira numa base ainda
 * não migrada. Falhando ali, o lote nasce sem fornecedor, que é o comportamento antigo.
 */
async function entradaLoteVacina(tx, { medId, fornecedorId, notaFiscal, estoque, empresaId }) {
  const doses = num(estoque.quantidade) ?? 0;
  const criado = await tx.loteVacina.create({
    data: {
      medicamentoCatId: medId,
      empresaId:        Number(empresaId),
      lote:             String(estoque.lote ?? '').trim().slice(0, 100) || 'S/L',
      // ⚠️ `validade` é NOT NULL no schema: sem data informada, o lote não pode
      // nascer. Um ano é o padrão do estoque de vacina e é editável na tela dele.
      validade:         estoque.validade ? new Date(estoque.validade)
                                         : new Date(Date.now() + 365 * 24 * 3600 * 1000),
      qtdTotal:         doses,
      qtdDisponivel:    doses,
      dosesPorFrasco:   num(estoque.dosesPorFrasco) ?? 1,
      qtdFrascos:       num(estoque.qtdFrascos) ?? 0,
      valorUnitario:    num(estoque.valor),
      valorUnitarioRepassado: num(estoque.valorRepassado),
      estoqueMinimo:    num(estoque.estoqueMinimo) ?? 0,
      estoqueAlarmante: num(estoque.estoqueAlarmante) ?? 0,
      dataRecebimento:  estoque.dataRecebimento ? new Date(estoque.dataRecebimento) : new Date(),
      ativo:            true,
    },
    select: { id: true },
  });
  await produtoFornecedor.gravarFornecedorNoLote(tx, criado.id, { fornecedorId, notaFiscal });
  return criado.id;
}

// PUT /api/cadastro/produtos/:id — só o vínculo (preço, unidade, nota, observação).
const atualizar = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const { medicamentoId, fornecedorId, valorUnitario, valorVenda, unidade,
            notaFiscal, observacao, ativo, multidose, dosesPorEmbalagem } = req.body ?? {};
    if (!medicamentoId || !fornecedorId) {
      return res.status(400).json({ error: 'Produto e fornecedor são obrigatórios.' });
    }
    const salvo = await produtoFornecedor.salvarProduto(prisma, {
      empresaId: req.empresaId, medicamentoId, fornecedorId,
      valorUnitario, valorVenda, unidade, notaFiscal, observacao, ativo,
      multidose, dosesPorEmbalagem,
    });
    if (salvo.erro) return res.status(400).json({ error: salvo.erro });
    return res.json({ dados: { id: salvo.id } });
  } catch (err) {
    console.error('ProdutoController.atualizar:', err);
    return res.status(500).json({ error: 'Erro ao atualizar o produto.' });
  }
};

// DELETE /api/cadastro/produtos/:id  { motivo }
const excluir = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    // Justificativa obrigatória + auditoria: a regra de §33 vale para toda exclusão.
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Informe o motivo da exclusão.' });

    const ok = await prisma.$transaction(async (tx) => {
      const removido = await produtoFornecedor.removerProduto(tx, req.empresaId, req.params.id);
      if (!removido) return false;
      await registrarAuditoria(tx, req, {
        categoria:  'EXCLUSAO',
        entidade:   'PRODUTO',
        entidadeId: Number(req.params.id),
        motivo,
      });
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'Produto não encontrado.' });
    return res.json({ mensagem: 'Produto removido.' });
  } catch (err) {
    console.error('ProdutoController.excluir:', err);
    return res.status(500).json({ error: 'Erro ao excluir o produto.' });
  }
};

module.exports = { listar, listarCatalogo, detalhe, criar, atualizar, excluir };
