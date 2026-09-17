'use strict';
/**
 * CADASTRO > PRODUTOS
 *
 * 🔴 O QUE ESTA TELA É, DESDE 2026-09-15: o cadastro do ITEM que a clínica usa —
 * medicamento e vacina, com forma farmacêutica, apresentação, unidade, via,
 * controlado e doses por embalagem. É o catálogo DELA.
 *
 * ⚠️ REVERTE o escopo de 2026-09-10, em que a tela cadastrava o VÍNCULO com o
 * FORNECEDOR (de quem se compra, por quanto) e podia dar entrada no estoque.
 * Fornecedor, nota fiscal, valor de compra, valor de venda, leitura do documento de
 * compra e a entrada no estoque SAÍRAM a pedido — quem trata de compra e de saldo é a
 * Farmácia / o Estoque de Vacinas, e ter os dois aqui misturava "o que é o produto"
 * com "quanto eu tenho dele".
 * ⚠️ O backend de produto-fornecedor NÃO foi removido: `tb_produtos_fornecedor`,
 * `lib/produtoFornecedor.js` e o lançamento da conta a pagar na execução seguem
 * existindo e funcionando. O que sumiu foi a porta de entrada NESTA tela.
 *
 * 🔴 EDITAR É COPY-ON-WRITE. `tb_medicamentos` é CATÁLOGO MISTO: a linha GLOBAL vale
 * para todas as clínicas do SaaS. Alterar a forma/via/unidade de um item global
 * mudaria o item de todo mundo — então a alteração nasce numa CÓPIA da empresa e é
 * ela que recebe tudo (`lib/catalogoEmpresa.js`). Item que já é da empresa é alterado
 * no lugar; item de outra clínica responde 404. O RLS de `tb_medicamentos`
 * (ENABLE + FORCE, `WITH CHECK` só do próprio) é a rede por baixo disso.
 */

const prisma = require('../lib/prisma').default;
const catalogoEmpresa = require('../lib/catalogoEmpresa');
const { registrarAuditoria } = require('../lib/auditoria');
// Fonte Única de "erro que chega à tela": repassa regra de negócio, engole o resto.
const { responderErro } = require('../lib/erroResposta');
const { normalizarFormaCalculo, numeroPositivo } = require('../lib/formaCalculo');

/** Filtro "é vacina?" — MESMO critério de `MedicamentoController.paraAtendimento`. */
function filtroTipo(tipo) {
  return tipo === 'vacina'
    ? { classificacao: { contains: 'vacin', mode: 'insensitive' } }
    : { NOT: { classificacao: { contains: 'vacin', mode: 'insensitive' } } };
}

/** Só o catálogo VISÍVEL da empresa: o global + o próprio dela. Nunca o de outra. */
function escopoDaEmpresa(empresaId) {
  return { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])] };
}

const SELECT_ITEM = {
  id: true, nome: true, formaFarmaceutica: true, unidade: true,
  apresentacao: true, classificacao: true, fabricante: true,
  controlado: true, empresaId: true, ativo: true,
  vias: { select: { id: true, via: true }, orderBy: { via: 'asc' } },
};

/**
 * GET /api/cadastro/produtos?tipo=medicamento|vacina&busca=&ativo=
 *
 * 🔴 A BUSCA TRAZ OS ITENS JÁ CADASTRADOS (a pedido, 2026-09-15) — medicamentos e
 * vacinas do catálogo visível da clínica. Achado um, a tela CARREGA os dados dele
 * para alteração; a alteração pertence só a esta empresa (copy-on-write).
 */
const listar = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ dados: [], recursos: { disponivel: false } });
    const tipo  = req.query.tipo === 'vacina' ? 'vacina' : 'medicamento';
    const busca = String(req.query.busca ?? '').trim();

    const where = {
      ...filtroTipo(tipo),
      AND: [escopoDaEmpresa(req.empresaId)],
      ...(req.query.ativo === 'all' ? {} : { ativo: req.query.ativo !== 'false' }),
      ...(busca ? { OR: [
        { nome:              { contains: busca, mode: 'insensitive' } },
        { formaFarmaceutica: { contains: busca, mode: 'insensitive' } },
        { apresentacao:      { contains: busca, mode: 'insensitive' } },
      ] } : {}),
    };

    // 🔴 O QUE É DA CLÍNICA VEM ANTES DO GLOBAL (2026-09-17, a pedido): primeiro o
    // produto CADASTRADO pela empresa, depois o do catálogo do sistema, alfabético
    // dentro de cada grupo.
    //
    // ⚠️ `empresaId: 'asc'` e NUNCA `'desc'`: no Postgres ASC é NULLS LAST, então o
    // não-nulo (a empresa) vem primeiro e o global (`empresa_id IS NULL`) por último.
    // Mesma precedência de `ordemEmpresaPrimeiro` e de `garantirMedicamentoDaEmpresa`.
    //
    // ⚠️ A ordenação é do BANCO, não da página recebida: o `take` abaixo corta em 60/100
    // sobre um catálogo global de milhares de linhas. Ordenando só o que chegou, o item
    // da clínica nem entraria na lista quando o nome fosse alfabeticamente tarde — e o
    // defeito apareceria já na primeira tela, sem erro nenhum.
    const itens = await prisma.medicamento.findMany({
      where, select: SELECT_ITEM, orderBy: [{ empresaId: 'asc' }, { nome: 'asc' }],
      // Teto: o catálogo global tem milhares de linhas e o campo é de BUSCA, não de
      // rolagem. Sem o corte, abrir a tela baixaria o catálogo inteiro.
      take: busca ? 100 : 60,
    });

    // Multidose vem por SQL cru (coluna nova — §11) e EM BLOCO, nunca um por item.
    const multi = await catalogoEmpresa.multidosePorItem(prisma, itens.map(i => i.id));

    return res.json({
      dados: itens.map(i => ({
        ...i,
        ehVacina:   catalogoEmpresa.ehVacinaPelaClassificacao(i.classificacao),
        // `daEmpresa: false` = item GLOBAL. A tela diz isso porque alterar um global
        // não altera o global: cria a cópia desta clínica.
        daEmpresa:  i.empresaId != null,
        multidose:  multi.get(i.id)?.multidose ?? false,
        dosesPorEmbalagem: multi.get(i.id)?.dosesPorEmbalagem ?? null,
        formaCalculo:      multi.get(i.id)?.formaCalculo ?? null,
      })),
      recursos: { disponivel: true, multidose: await catalogoEmpresa.temColunasMultidose(prisma) },
    });
  } catch (err) {
    return responderErro(res, err, {
      contexto: 'ProdutoController.listar', mensagem: 'Não foi possível carregar a lista de produtos.',
    });
  }
};

/**
 * GET /api/cadastro/produtos/detalhe?medicamentoId=
 *
 * O item escolhido na busca, com TUDO o que o formulário edita. Continua existindo
 * porque a lista é recortada (`take`) e o formulário pode ser aberto por id vindo de
 * outra tela (Prescrição / Vacina).
 *
 * ⚠️ MULTI-TENANT: só devolve linha GLOBAL ou da PRÓPRIA empresa — item de outra
 * clínica responde 404, nunca os dados.
 */
const detalhe = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const medicamentoId = Number(req.query.medicamentoId);
    if (!Number.isInteger(medicamentoId)) return res.status(400).json({ error: 'Informe o item do catálogo.' });

    const item = await prisma.medicamento.findFirst({
      where:  { id: medicamentoId, ...escopoDaEmpresa(req.empresaId) },
      select: SELECT_ITEM,
    });
    if (!item) return res.status(404).json({ error: 'Item não encontrado no catálogo desta clínica.' });

    const multi = await catalogoEmpresa.multidosePorItem(prisma, [item.id]);
    return res.json({
      dados: {
        ...item,
        ehVacina:  catalogoEmpresa.ehVacinaPelaClassificacao(item.classificacao),
        daEmpresa: item.empresaId != null,
        multidose: multi.get(item.id)?.multidose ?? false,
        dosesPorEmbalagem: multi.get(item.id)?.dosesPorEmbalagem ?? null,
        formaCalculo:      multi.get(item.id)?.formaCalculo ?? null,
      },
      recursos: { multidose: await catalogoEmpresa.temColunasMultidose(prisma) },
    });
  } catch (err) {
    return responderErro(res, err, {
      contexto: 'ProdutoController.detalhe', mensagem: 'Não foi possível carregar o produto.',
    });
  }
};

/**
 * Pares do `translate()` do Postgres — a MESMA remoção de acento que `normalizarNome`
 * faz em JS. Mesmo precedente de `lib/duplicidadeAnimal.js`: `translate()` e não
 * `unaccent()`, porque a extensão pode não estar instalada na base do cliente — e um
 * reconhecimento que só funciona em algumas instalações é pior que nenhum.
 * ⚠️ As duas cadeias precisam ter o MESMO comprimento: o `translate` mapeia posição a
 * posição, e uma sobra desloca todo o resto e passa a trocar letras erradas.
 */
const COM_ACENTO = 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ';
const SEM_ACENTO = 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN';

/** "Dipirona 500 " → "dipirona 500". Único ponto de normalização — o espelho no front
 *  (`normalizarNomeProduto`) precisa concordar com este. */
function normalizarNome(v) {
  return String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * GET /api/cadastro/produtos/por-nome?tipo=medicamento|vacina&nome=
 *
 * 🔴 O NOME DIGITADO TRAZ O QUE JÁ ESTÁ CADASTRADO (a pedido, 2026-09-15). Ao sair do
 * campo Nome, a tela pergunta "este produto já existe?" e, existindo, carrega forma,
 * apresentação, unidade, vias, controlado, fabricante e doses — em vez de deixar a
 * pessoa redigitar um cadastro que o sistema tem, e nascer um item divergente do
 * global com o mesmo nome.
 *
 * ⚠️ MULTI-TENANT: o escopo é o MESMO da listagem (global + o da PRÓPRIA empresa) —
 * item privado de outra clínica responde "não encontrado", nunca os dados. Fail-closed
 * sem `req.empresaId`.
 * ⚠️ A CÓPIA DA EMPRESA VENCE o global homônimo (`empresa_id ASC NULLS LAST`): com a
 * cópia já existente, carregar o GLOBAL faria o salvar criar uma SEGUNDA cópia da mesma
 * clínica. É a mesma precedência de `garantirMedicamentoDaEmpresa`.
 * ⚠️ Item INATIVO também é devolvido: `salvarItemDoCatalogo` REAPROVEITA e reativa a
 * cópia da empresa de mesmo nome, então esconder o inativo aqui faria a tela oferecer
 * um cadastro "novo" que o salvar transformaria em edição — em silêncio.
 */
const porNome = async (req, res) => {
  try {
    if (!req.empresaId) return res.json({ encontrado: false });
    const tipo = req.query.tipo === 'vacina' ? 'vacina' : 'medicamento';
    const alvo = normalizarNome(req.query.nome);
    if (alvo.length < 2) return res.json({ encontrado: false });

    // ⚠️ `coalesce(classificacao, '')` nos DOIS lados: em SQL o `NOT ILIKE` sobre NULL
    // não é verdadeiro, então o item legado com classificação nula ficaria FORA do
    // recorte de medicamento — a mesma armadilha documentada em `catalogoManual`.
    const linhas = await prisma.$queryRawUnsafe(
      `SELECT m.id
         FROM schs2vet.tb_medicamentos m
        WHERE (m.empresa_id IS NULL OR m.empresa_id = $1::int)
          AND translate(lower(btrim(m.nome)), '${COM_ACENTO}', '${SEM_ACENTO}') = $2
          AND (CASE WHEN $3::boolean
                    THEN coalesce(m.classificacao, '') ILIKE '%vacin%'
                    ELSE coalesce(m.classificacao, '') NOT ILIKE '%vacin%' END)
        ORDER BY m.empresa_id ASC NULLS LAST, m.ativo DESC, m.id ASC
        LIMIT 1`,
      Number(req.empresaId), alvo, tipo === 'vacina',
    ).catch(() => []);

    if (linhas.length === 0) return res.json({ encontrado: false });

    const item = await prisma.medicamento.findFirst({
      where:  { id: Number(linhas[0].id), ...escopoDaEmpresa(req.empresaId) },
      select: SELECT_ITEM,
    });
    if (!item) return res.json({ encontrado: false });

    const multi = await catalogoEmpresa.multidosePorItem(prisma, [item.id]);
    return res.json({
      encontrado: true,
      dados: {
        ...item,
        ehVacina:  catalogoEmpresa.ehVacinaPelaClassificacao(item.classificacao),
        daEmpresa: item.empresaId != null,
        multidose: multi.get(item.id)?.multidose ?? false,
        dosesPorEmbalagem: multi.get(item.id)?.dosesPorEmbalagem ?? null,
        formaCalculo:      multi.get(item.id)?.formaCalculo ?? null,
      },
    });
  } catch (err) {
    console.error('ProdutoController.porNome:', err);
    // Reconhecer o nome é CONVENIÊNCIA: falhar aqui não pode impedir o cadastro.
    return res.json({ encontrado: false });
  }
};

/**
 * Espécies a vincular no item novo.
 *
 * 🔴 É a ESPÉCIE que faz o item APARECER nas buscas depois — `paraAtendimento` e os
 * filtros `especieDaEmpresa` (Farmácia) / `getEspeciesIds` (Estoque de Vacinas)
 * recortam por ela. Sem vínculo nenhum o produto nasce INVISÍVEL nas telas de
 * estoque, e a pessoa conclui que o cadastro não funcionou.
 *
 * ⚠️ Reusa `especiesParaItemSemPaciente` do `MedicamentoController` — ela já é a UNIÃO
 * das duas fontes que essas telas consultam (animais ativos + espécies declaradas do
 * vet). Uma versão própria aqui cobriria só uma delas, e o item ficaria visível numa
 * tela e ausente na outra.
 */
const { especiesParaItemSemPaciente } = require('./MedicamentoController');

/**
 * POST /api/cadastro/produtos
 *
 * Corpo: { tipo, medicamentoId?, nome, formaFarmaceutica, apresentacao, unidade,
 *          vias[], controlado?, fabricante?, multidose?, dosesPorEmbalagem? }
 *
 * Cria o item PRÓPRIO da clínica ou ALTERA o escolhido (copy-on-write).
 * ⚠️ Numa TRANSACTION: o item, as vias e as espécies nascem juntos ou não nascem —
 * item sem espécie vinculada nasce INVISÍVEL na busca do atendimento, e a pessoa
 * concluiria que o cadastro falhou sem nada acusar.
 */
const criar = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa antes de cadastrar.' });

    const {
      tipo = 'medicamento', medicamentoId,
      nome, formaFarmaceutica, apresentacao, unidade, vias, controlado, fabricante,
      multidose, dosesPorEmbalagem, formaCalculo,
    } = req.body ?? {};

    const ehVacina = tipo === 'vacina';
    const viasLista = Array.isArray(vias) ? vias.map(v => String(v ?? '').trim()).filter(Boolean) : [];

    // Os obrigatórios são os MESMOS do cadastro rápido do atendimento
    // (`CadastroCatalogoModal`): item que nasce sem forma/unidade/apresentação/via não
    // consegue ser prescrito nem entrar no estoque depois.
    const faltando = [];
    if (!String(nome ?? '').trim())              faltando.push('Nome');
    if (!String(formaFarmaceutica ?? '').trim()) faltando.push('Forma farmacêutica');
    if (!String(unidade ?? '').trim())           faltando.push('Unidade');
    if (!String(apresentacao ?? '').trim())      faltando.push('Apresentação');
    if (viasLista.length === 0)                  faltando.push('Via de administração');
    // 🔴 Multidose marcado exige o PAR forma + quantidade. Marcado sem eles, o item
    // afirmaria "sou medido por dentro" sem dizer em quê nem quanto — e é justamente
    // esse par que divide o preço da embalagem na linha da fatura. Aceitar pela
    // metade produziria dose cobrada pelo frasco inteiro, em silêncio.
    if (multidose === true) {
      if (!normalizarFormaCalculo(formaCalculo))  faltando.push('Forma de Cálculo');
      if (numeroPositivo(dosesPorEmbalagem) == null) faltando.push('Qtd');
    }
    if (faltando.length > 0) {
      return res.status(400).json({ error: `Preencha: ${faltando.join(', ')}.`, campos: faltando });
    }

    const especieIds = await especiesParaItemSemPaciente(req);

    const resultado = await prisma.$transaction(async (tx) => {
      const salvo = await catalogoEmpresa.salvarItemDoCatalogo(tx, {
        medicamentoId: medicamentoId ? Number(medicamentoId) : null,
        empresaId:     req.empresaId,
        vacina:        ehVacina,
        especieIds,
        dados: {
          nome, formaFarmaceutica, apresentacao, unidade, fabricante,
          // Vacina não é medicamento controlado — aceitar a marcação ali produziria
          // receituário especial para uma dose de rotina.
          controlado: ehVacina ? false : controlado,
          vias: viasLista,
          multidose, dosesPorEmbalagem, formaCalculo,
        },
      });

      await registrarAuditoria(tx, req, {
        categoria:  medicamentoId ? 'ALTERACAO' : 'CRIACAO',
        entidade:   'PRODUTO',
        entidadeId: salvo.id,
        detalhes:   `${ehVacina ? 'Vacina' : 'Medicamento'} "${String(nome ?? '').trim()}"`
                    + (salvo.copiado ? ' (cópia desta clínica criada a partir do catálogo global)' : ''),
      });
      return salvo;
    });

    return res.status(medicamentoId ? 200 : 201).json({ dados: resultado });
  } catch (err) {
    // ⚠️ NUNCA `err.message || <fallback>`: a mensagem do Prisma SEMPRE existe, então o
    // fallback amigável nunca entrava e o dump da invocação — com o CAMINHO do arquivo no
    // servidor — ia inteiro para a tela. Quem decide o que a pessoa lê é `responderErro`:
    // ele repassa o erro de REGRA DE NEGÓCIO inteiro (`UnidadeIndisponivelError` tem
    // `status` e texto escrito para ser lido) e engole o resto, deixando-o no log.
    return responderErro(res, err, {
      contexto: 'ProdutoController.criar',
      mensagem: 'Não foi possível salvar o produto. Tente novamente; se continuar, avise o suporte.',
    });
  }
};

/** PUT /api/cadastro/produtos/:id — o mesmo caminho do POST, com o id na rota. */
const atualizar = async (req, res) => {
  req.body = { ...(req.body ?? {}), medicamentoId: Number(req.params.id) };
  return criar(req, res);
};

/**
 * DELETE /api/cadastro/produtos/:id  { motivo }
 *
 * INATIVA o item da clínica (soft delete — §10: registro de catálogo não se apaga,
 * há prescrição e estoque apontando para ele).
 * ⚠️ Item GLOBAL responde 400: ele é de todas as clínicas. Para tirá-lo da frente
 * desta, o caminho é cadastrar o próprio — que o esconde por `preferirCopiaDaEmpresa`.
 */
const excluir = async (req, res) => {
  try {
    if (!req.empresaId) return res.status(400).json({ error: 'Selecione a empresa.' });
    const motivo = String(req.body?.motivo ?? '').trim();
    if (motivo.length < 3) return res.status(400).json({ error: 'Informe o motivo da exclusão.' });

    const id = Number(req.params.id);
    const item = await prisma.medicamento.findFirst({
      where: { id, ...escopoDaEmpresa(req.empresaId) }, select: { id: true, empresaId: true, nome: true },
    });
    if (!item) return res.status(404).json({ error: 'Produto não encontrado.' });
    if (item.empresaId == null) {
      return res.status(400).json({
        error: 'Este item é do catálogo do sistema e vale para todas as clínicas — não pode ser excluído aqui.',
        code:  'ITEM_DO_SISTEMA',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.medicamento.update({ where: { id }, data: { ativo: false } });
      await registrarAuditoria(tx, req, {
        categoria: 'INATIVACAO', entidade: 'PRODUTO', entidadeId: id, motivo,
        detalhes: `Produto "${item.nome}"`,
      });
    });
    return res.json({ mensagem: 'Produto inativado.' });
  } catch (err) {
    return responderErro(res, err, {
      contexto: 'ProdutoController.excluir', mensagem: 'Não foi possível remover o produto.',
    });
  }
};

module.exports = { listar, detalhe, porNome, criar, atualizar, excluir };
