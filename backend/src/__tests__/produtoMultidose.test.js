// FORMA DE CÁLCULO — a embalagem deixou de ser a própria unidade (2026-09-16).
//
// O QUE QUEBRA EM SILÊNCIO AQUI, e é por isso que o arquivo existe:
//   1. o frasco de 20 mL era cadastrado como "1 Un.". A receita saía em mL,
//      `mesmoGrupo('mL','Un.')` é FALSO e a baixa caía no valor BRUTO: uma dose de
//      5 mL debitava 5 FRASCOS e cobrava 5 frascos. Nenhum erro, nenhuma tela acusando;
//   2. deixar o ESTOQUE contar numa unidade e a RECEITA ser escrita em outra devolve o
//      mesmo defeito por outro caminho — por isso `unidadeDoEstoque` tem de valer na
//      reserva, na baixa e nas três verificações, não só numa delas;
//   3. `qtdPorEmbalagem` nulo tratado como 1 afirmaria "a embalagem tem uma unidade da
//      forma" para todo item que não declara conteúdo;
//   4. marcar multidose numa linha GLOBAL do catálogo mudaria a cobrança de TODAS as
//      clínicas do SaaS.
//
// ⚠️ ESTE ARQUIVO SUBSTITUI a versão que testava a semântica ANTIGA de multidose
// ("N aplicações por frasco, desconta 1/N"). Ela foi trocada a pedido: hoje o produto
// declara QUANTO cabe na embalagem e EM QUÊ, e não há mais divisão por doses.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const Prescricao = require('../controllers/PrescricaoGrupoController');
const forma      = require('../lib/formaCalculo');

const { qtdDoEstoque } = Prescricao;
const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const leiaFront = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');
// Comentários explicam a regra CITANDO as mesmas palavras; um gate que se satisfaz
// com a própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ─── 1. A CONTA QUE VAI PARA O ESTOQUE E PARA A FATURA ───────────────────────
describe('quantidade que sai do estoque', () => {
  test('receita e estoque na MESMA unidade: 5 mL saem de 60 mL, sem conversão', () => {
    expect(qtdDoEstoque(5, 'mL', 'mL')).toBeCloseTo(5, 6);
  });

  test('unidades do mesmo grupo continuam convertendo: 500 g -> 0,5 kg', () => {
    expect(qtdDoEstoque(500, 'g', 'kg')).toBeCloseTo(0.5, 6);
    expect(qtdDoEstoque(2, 'L', 'mL')).toBeCloseTo(2000, 6);
  });

  test('unidades incompatíveis subtraem direto — o comportamento legado', () => {
    expect(qtdDoEstoque(10, 'mL', 'Un.')).toBe(10);
  });

  test('fração não é truncada: 2,5 mL é dosagem legítima', () => {
    expect(qtdDoEstoque(2.5, 'mL', 'mL')).toBeCloseTo(2.5, 6);
  });
});

// ─── 2. A FATURA — o exemplo que originou a mudança ──────────────────────────
describe('cobrança por conteúdo da embalagem', () => {
  // Produto: Forma de Cálculo mL, Qtd 20 (a embalagem tem 20 mL).
  // Estoque: Qtd Produto 3 -> Qtd Total 60 mL; Valor Unitário Cobrado R$ 100 por
  // embalagem -> R$ 300 no total da entrada.
  const QTD_POR_EMBALAGEM = 20;
  const PRECO_EMBALAGEM   = 100;
  const EMBALAGENS        = 3;

  const qtdTotal   = EMBALAGENS * QTD_POR_EMBALAGEM;   // 60 mL
  const valorTotal = EMBALAGENS * PRECO_EMBALAGEM;     // R$ 300
  // É o que `calcPrecoUnitarioBase` grava na entrada: valor ÷ quantidade.
  const precoPorMl = valorTotal / qtdTotal;            // R$ 5/mL

  test('a baixa de 5 mL deixa 55 mL', () => {
    expect(qtdTotal - qtdDoEstoque(5, 'mL', 'mL')).toBeCloseTo(55, 6);
  });

  test('a linha da fatura é qtd x valorUnitarioCobrado / qtdPorEmbalagem', () => {
    const valorDaDose = qtdDoEstoque(5, 'mL', 'mL') * precoPorMl;
    expect(valorDaDose).toBeCloseTo(25, 6);
    // A MESMA conta, escrita como o pedido a descreve.
    expect(valorDaDose).toBeCloseTo(5 * PRECO_EMBALAGEM / QTD_POR_EMBALAGEM, 6);
  });

  test('o conteúdo da embalagem é cobrado UMA vez ao longo das aplicações', () => {
    // 20 mL consumidos em 4 aplicações de 5 mL custam exatamente uma embalagem.
    const total = [5, 5, 5, 5].reduce((s, q) => s + qtdDoEstoque(q, 'mL', 'mL') * precoPorMl, 0);
    expect(total).toBeCloseTo(PRECO_EMBALAGEM, 6);
  });
});

// ─── 3. A LIB DA FORMA DE CÁLCULO ────────────────────────────────────────────
describe('lib/formaCalculo', () => {
  test('aceita a grafia gravada no banco, sem caixa', () => {
    expect(forma.normalizarFormaCalculo('ML')).toBe('mL');
    expect(forma.normalizarFormaCalculo(' doses ')).toBe('doses');
    expect(forma.normalizarFormaCalculo('frasco')).toBeNull();
    expect(forma.normalizarFormaCalculo('')).toBeNull();
  });

  test('qtdPorEmbalagem NULO não é 1 — é "não declara conteúdo"', () => {
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: null })).toBeNull();
    expect(forma.qtdPorEmbalagemDe({ multidose: false, qtdPorEmbalagem: 20 })).toBeNull();
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: 20 })).toBe(20);
    expect(forma.qtdPorEmbalagemDe({ multidose: true, qtdPorEmbalagem: 2.5 })).toBe(2.5);
  });

  test('a unidade operativa é a forma de cálculo — e SEM MULTIDOSE é Un.', () => {
    expect(forma.unidadeOperativa({ multidose: true, formaCalculo: 'mL', qtdPorEmbalagem: 20, unidade: 'Frasco' }))
      .toBe('mL');
    // 🔴 SEM MULTIDOSE É 'Un.', NUNCA a unidade da embalagem (2026-09-17, a pedido).
    // Devolver 'g'/'Comprimido' aqui é o que fazia a receita ser escrita no CONTEÚDO
    // contra um estoque que conta EMBALAGENS — "20 g" debitando 20 de 10 bisnagas.
    expect(forma.unidadeOperativa({ multidose: false, unidade: 'Comprimido' })).toBe('Un.');
    expect(forma.unidadeOperativa({ multidose: false, unidade: 'g' })).toBe('Un.');
    expect(forma.unidadeOperativa({ multidose: false, unidade: 'kg' })).toBe('Un.');
    // Marcado sem quantidade é PENDÊNCIA de cadastro, não item medido: cai no mesmo
    // 'Un.' de quem não declara nada — o número que faltou é o que dividiria o preço.
    expect(forma.unidadeOperativa({ multidose: true, formaCalculo: 'mL', qtdPorEmbalagem: null, unidade: 'Frasco' }))
      .toBe('Un.');
    expect(forma.unidadeOperativa(null)).toBe('Un.');
  });

  test('🔴 LEGADO: multidose COM quantidade e SEM forma segue na unidade da EMBALAGEM', () => {
    // Cadastro feito entre as migrations `20261009000000` e `20261012000000`, quando
    // `forma_calculo` ainda não existia. O estoque desse item foi gravado MULTIPLICANDO
    // pela quantidade — está contado no CONTEÚDO —, então 'Un.' faria 19,9 mL de frasco
    // serem lidos como "19,9 unidades": uma dose de 5 mL debitaria 1 e cobraria R$ 5 no
    // lugar de R$ 25. Medido na base: o "17 Beta - 0%, frasco-ampola" está assim.
    expect(forma.unidadeOperativa({ multidose: true, formaCalculo: null, qtdPorEmbalagem: 10, unidade: 'mL' }))
      .toBe('mL');
    expect(forma.unidadeOperativa({ multidose: true, dosesPorEmbalagem: 10, unidade: 'g' })).toBe('g');
    // Sem unidade no catálogo não há o que devolver — cai no padrão.
    expect(forma.unidadeOperativa({ multidose: true, qtdPorEmbalagem: 10, unidade: null })).toBe('Un.');
  });

  test('backend e front respondem a MESMA coisa nos quatro estados do cadastro', () => {
    // O front tem o espelho (`unidadeOperativaProduto`); divergir faz a tela rotular o
    // saldo de um jeito e a baixa contar de outro.
    const frontUtil = leiaFront('utils/formaCalculo.ts');
    expect(frontUtil).toMatch(/if \(temConteudoDeclarado\(p\)\) return p\.formaCalculo as string;/);
    expect(frontUtil).toMatch(/p\.multidose === true && Number\.isFinite\(qtd\) && qtd > 0 && p\.unidade\) return p\.unidade;/);
    expect(frontUtil).toMatch(/return UNIDADE_AVULSA;/);
  });

  test('a grafia de Un. é a MESMA nos dois lados — divergir descasa receita e estoque', () => {
    // Backend: nasceu em `lib/unidadeMedicamento.js` (a opção garantida do seletor) e
    // é REEXPORTADA por `formaCalculo`, nunca recopiada.
    expect(forma.UNIDADE_AVULSA).toBe(require('../lib/unidadeMedicamento').UNIDADE_AVULSA);
    // Front: o espelho de `utils/formaCalculo.ts`. 'Un' × 'Un.' faria `mesmaUnidade`
    // divergir do que a receita escreve, e o defeito volta como quantidade bruta.
    const frontUtil = leiaFront('utils/formaCalculo.ts');
    expect(frontUtil).toMatch(/export const UNIDADE_AVULSA = 'Un\.';/);
  });
});

// ─── 4. GATE ESTRUTURAL ──────────────────────────────────────────────────────
// Os elos abaixo somem sem erro nenhum: a execução continua funcionando e só o VALOR
// da fatura (ou o saldo do estoque) fica errado.
describe('elos que somem em silêncio', () => {
  const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));

  test('a baixa da dose resolve a unidade pela FORMA DE CÁLCULO', () => {
    expect(controller).toMatch(/async function debitarEstoqueDia[\s\S]{0,900}mapaFormaCalculo\(/);
    expect(controller).toMatch(/let restante = qtdDoEstoque\(qtdDia, item\.unidade, unidadeEstoque, item\.dosagem\)/);
  });

  test('a RESERVA nasce na MESMA unidade da baixa', () => {
    // ⚠️ RECORTADO em `criarReservas`: a mesma chamada existe em `debitarEstoqueDia` e
    // em `verificarDisponibilidade`, então procurá-la no arquivo INTEIRO passaria mesmo
    // com a reserva voltando a usar a unidade crua da embalagem — e uma reserva numa
    // unidade que o débito não consome trava o saldo para toda a clínica.
    const corpo = controller.slice(controller.indexOf('async function criarReservas'));
    expect(corpo.slice(0, 900)).toMatch(/mapaFormaCalculo\(/);
    expect(corpo.slice(0, 1400)).toMatch(/unidadeDoEstoque\(formas, item\)/);
  });

  test('as TRÊS verificações de estoque usam a mesma unidade — senão barram o que cabe', () => {
    for (const fn of ['verificarEstoqueParaDia', 'verificarEstoqueParaExecucao', 'verificarDisponibilidade']) {
      const corpo = controller.slice(controller.indexOf(`async function ${fn}`));
      expect(corpo.slice(0, 1400)).toMatch(/mapaFormaCalculo\(prisma, itens\)/);
      expect(corpo.slice(0, 1800)).toMatch(/unidadeDoEstoque\(formas, item\)/);
    }
  });

  test('o lookup roda com o client da TRANSAÇÃO (o prisma global não enxerga o tenant)', () => {
    expect(controller).toMatch(/mapaFormaCalculo\(tx, itens\)/);
  });

  test('a divisão por doses SAIU — o item medido não converte mais nada', () => {
    const fn = controller.slice(controller.indexOf('function qtdDoEstoque'));
    expect(fn.slice(0, 400)).not.toMatch(/dosesPorEmbalagem/);
  });

  test('o preço do estoque é calculado na unidade OPERATIVA, não na da embalagem', () => {
    const estoque = semComentarios(leia('controllers/EstoqueController.js'));
    expect(estoque).toMatch(/calcPrecoUnitarioBase\(Number\(valorRepassado\), Number\(qtdEstoque\), unidadeConta\)/);
    expect(estoque).toMatch(/async function unidadeOperativaDoItem\(/);
  });

  test('multidose marcado exige o PAR forma + quantidade', () => {
    const prod = semComentarios(leia('controllers/ProdutoController.js'));
    expect(prod).toMatch(/normalizarFormaCalculo\(formaCalculo\)\)\s*faltando\.push\('Forma de Cálculo'\)/);
    expect(prod).toMatch(/numeroPositivo\(dosesPorEmbalagem\) == null\)\s*faltando\.push\('Qtd'\)/);
  });

  test('o reforço da vacina deixou de deduzir o tamanho da série da dosagem', () => {
    const vac = semComentarios(leia('controllers/VacinaClinicaController.js'));
    const fn  = vac.slice(vac.indexOf('async function agendarReforcos'));
    expect(fn.slice(0, 500)).not.toMatch(/quantidade/);
    // A dosagem não é mais travada em >= 1: 0,5 mL é cadastro legítimo.
    expect(vac).toMatch(/function dosagemDaVacina\(/);
    expect(vac).not.toMatch(/Math\.max\(1, Number\(quantidade\)/);
  });
});

// ─── 5. MULTI-TENANT, RLS E A MIGRATION ──────────────────────────────────────
describe('multi-tenant e migration', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations',
              '20261012000000_forma_calculo_produto', 'migration.sql'), 'utf8');
  const sql = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  test('é ADITIVA: nenhum UPDATE/DELETE de dado gravado', () => {
    expect(sql).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  });

  test('a forma de cálculo nasce NULA — nenhum cadastro existente muda de cobrança', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "forma_calculo" VARCHAR\(20\)/);
    expect(sql).not.toMatch(/forma_calculo" VARCHAR\(20\) NOT NULL/i);
  });

  test('as quantidades viram DOUBLE PRECISION — inteiro truncaria 2,5 mL em silêncio', () => {
    for (const col of ['doses_por_embalagem', 'quantidade', 'qtd_disponivel', 'doses_por_frasco']) {
      expect(sql).toMatch(new RegExp(`ALTER COLUMN "${col}" TYPE DOUBLE PRECISION`));
    }
  });

  test('só a CÓPIA da empresa é marcada — o catálogo global nunca', () => {
    const med = semComentarios(leia('controllers/MedicamentoController.js'));
    expect(med).toMatch(/WHERE id = \$1 AND empresa_id IS NOT NULL/);
  });

  test('a gravação da forma é por SQL cru com catch — base não migrada não quebra', () => {
    const lib = leia('lib/catalogoEmpresa.js');
    const fn  = lib.slice(lib.indexOf('async function gravarMultidose'));
    expect(fn.slice(0, 1600)).toMatch(/temColunaFormaCalculo\(client\)/);
    expect(fn.slice(0, 1600)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  test('o front e o backend oferecem a MESMA lista de formas', () => {
    const ts = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils', 'formaCalculo.ts'), 'utf8');
    const m = ts.match(/FORMAS_CALCULO = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const doFront = m[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
    expect(doFront).toEqual(forma.FORMAS_CALCULO);
  });
});

// ─── 5. PRODUTO SEM MULTIDOSE: A EMBALAGEM É A UNIDADE ───────────────────────
// 🔴 2026-09-17, a pedido: "quando no produto não for marcado o multidose a Forma de
// Cálculo sempre será Unidade; na prescrição a Unidade deverá ser Un.; e o lançamento
// da fatura deverá ser Valor Total Repassado ÷ Qtd Produto".
//
// O QUE QUEBRAVA EM SILÊNCIO: sem multidose a unidade caía na do CATÁLOGO, que é a da
// EMBALAGEM ('g', 'mL', 'kg'...), enquanto a entrada de estoque conta EMBALAGENS
// (Qtd Total = Qtd Produto). Os dois lados usavam o mesmo rótulo para coisas
// diferentes: uma receita de "20 g" debitava 20 de um saldo de 10 bisnagas e cobrava
// 20 × R$/g. Nenhum erro na tela — só o saldo e a fatura errados.
describe('produto sem multidose é medido em Un.', () => {
  const { unidadeDoEstoque } = Prescricao;
  const { calcPrecoUnitarioBase } = require('../controllers/EstoqueController');
  const semForma = new Map();                     // nenhum item declara conteúdo
  const comForma = new Map([[7, 'mL']]);          // o item 7 é multidose de 20 mL

  test('a unidade do estoque é Un. — não a do catálogo nem a digitada na receita', () => {
    expect(unidadeDoEstoque(semForma, { medicamentoCatId: 5, unidade: 'g' })).toBe('Un.');
    expect(unidadeDoEstoque(semForma, { medicamentoCatId: 5, unidade: 'mg' })).toBe('Un.');
    // Com forma declarada nada muda: continua sendo ela.
    expect(unidadeDoEstoque(comForma, { medicamentoCatId: 7, unidade: 'mL' })).toBe('mL');
  });

  test('1 Un. prescrita debita 1 embalagem — a conversão não tem o que fazer', () => {
    expect(qtdDoEstoque(1, 'Un.', 'Un.')).toBe(1);
    expect(qtdDoEstoque(3, 'Un.', 'Un.')).toBe(3);
  });

  test('a linha da fatura é Valor Total Repassado ÷ Qtd Produto', () => {
    // 10 embalagens por R$ 300 → R$ 30 a embalagem; 1 Un. na receita custa R$ 30.
    const preco = calcPrecoUnitarioBase(300, 10, 'Un.');
    expect(preco).toBe(30);
    expect(qtdDoEstoque(1, 'Un.', 'Un.') * preco).toBe(30);
    // E o curso inteiro cobra o que saiu, nunca mais que isso.
    expect(qtdDoEstoque(10, 'Un.', 'Un.') * preco).toBe(300);
  });

  test('🔴 em kg/L o fator de base NÃO entra mais na conta', () => {
    // O caso que saía mil vezes errado: 3 embalagens de um produto cadastrado em 'kg'.
    // Com a unidade do CATÁLOGO o preço virava R$/g sobre um número que conta
    // embalagens (300 ÷ 3.000), e a receita de 1 unidade cobrava R$ 0,10.
    expect(calcPrecoUnitarioBase(300, 3, 'kg')).toBeCloseTo(0.1, 6);
    expect(calcPrecoUnitarioBase(300, 3, 'Un.')).toBe(100);
  });

  test('a unidade do estoque NÃO volta a cair no catálogo nem no item', () => {
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    const fn = controller.slice(controller.indexOf('function unidadeDoEstoque'));
    const corpo = fn.slice(0, fn.indexOf('\n}') + 2);
    expect(corpo).toMatch(/UNIDADE_AVULSA/);
    expect(corpo).not.toMatch(/unidadeCatalogo|item\.unidade/);
  });

  test('o preço do estoque também cai em Un. quando o produto não declara conteúdo', () => {
    const estoque = semComentarios(leia('controllers/EstoqueController.js'));
    const fn = estoque.slice(estoque.indexOf('async function unidadeOperativaDoItem'));
    expect(fn.slice(0, 300)).toMatch(/\?\?\s*UNIDADE_AVULSA/);
  });

  test('a ENTRADA de estoque nunca reescreve a unidade do produto', () => {
    // A tela mostra a unidade OPERATIVA ('Un.') em campo de LEITURA. Deixá-la chegar ao
    // copy-on-write trocaria a unidade da EMBALAGEM ("Frasco"/"g") por "Un." no
    // catálogo — apagando a distinção entre a embalagem e o que está dentro dela.
    const estoque = semComentarios(leia('controllers/EstoqueController.js'));
    const fn = estoque.slice(estoque.indexOf('async function unidadeParaResolver'));
    expect(fn.slice(0, 120)).toMatch(/return undefined;/);
    const farmacia = leiaFront('pages/Farmacia.tsx');
    expect(farmacia).not.toMatch(/^\s*unidade:\s*unidadeSel/m);
  });

  test('as telas leem a MESMA regra — duas cópias divergem na primeira correção', () => {
    for (const tela of ['pages/Farmacia.tsx', 'pages/SubModuloPrescricao.tsx']) {
      expect(leiaFront(tela)).toMatch(/unidadeOperativaProduto/);
    }
    // E a prescrição não oferece mais subunidade (mL ↔ L): trocar a unidade da receita
    // é reintroduzir a divergência que esta regra existe para eliminar.
    expect(leiaFront('pages/SubModuloPrescricao.tsx')).not.toMatch(/getConversaoUnidade/);
  });
});

// ─── 6. A TELA DE PRODUTOS MOSTRA O DA CLÍNICA ANTES DO GLOBAL ───────────────
describe('ordem da lista de produtos', () => {
  test('empresa primeiro, global depois — e a ordenação é do BANCO', () => {
    const prod = semComentarios(leia('controllers/ProdutoController.js'));
    // `empresaId: 'asc'` é NULLS LAST no Postgres: o da empresa vem primeiro e o
    // global (empresa_id IS NULL) por último. 'desc' inverteria tudo.
    expect(prod).toMatch(/orderBy: \[\{ empresaId: 'asc' \}, \{ nome: 'asc' \}\]/);
    // Ordenar só a página recebida deixaria o item da clínica FORA dela: a consulta
    // corta em 60/100 sobre um catálogo global de milhares de linhas.
    expect(prod).toMatch(/take: busca \? 100 : 60/);
  });
});

// ─── 7. A RECEITA JA GRAVADA EM mL/g CONTRA O ESTOQUE EM EMBALAGENS ──────────
// 🔴 O DEFEITO MEDIDO (2026-09-17): item pendente escrito "20 mL" antes de o produto
// passar a ser contado em 'Un.'. `mesmoGrupo('mL','Un.')` e falso, entao a baixa caia
// no valor BRUTO: **20 EMBALAGENS** de um saldo de 2, e **R$ 2.000** numa dose cujo
// frasco custa R$ 100. A tela do plantao mostrava "20 mL" e nada acusava.
describe('receita em conteudo contra estoque em embalagens', () => {
  test('a dose vale UMA embalagem por aplicacao — nunca o numero bruto', () => {
    // 20 mL/dia, dose de 20 mL → 1 aplicacao → 1 embalagem.
    expect(qtdDoEstoque(20, 'mL', 'Un.', 20)).toBe(1);
    // 20 mL 2x/dia (qtd do dia = 40) → 2 aplicacoes → 2 embalagens.
    expect(qtdDoEstoque(40, 'mL', 'Un.', 20)).toBe(2);
    // O curso inteiro: 7 dias de 1x → 7 embalagens.
    expect(qtdDoEstoque(140, 'mL', 'Un.', 20)).toBe(7);
    // 🔴 o valor bruto seria 20/40/140 — vinte, quarenta e cento e quarenta frascos.
    expect(qtdDoEstoque(20, 'mL', 'Un.', 20)).not.toBe(20);
    // ⚠️ NAO so as unidades de conteudo: '%' ("Pasta 10%") nao tem grupo de conversao e
    // caia no bruto — 10 % debitava DEZ embalagens. Vale para toda unidade que nao seja
    // a avulsa.
    expect(qtdDoEstoque(10, '%', 'Un.', 10)).toBe(1);
    expect(qtdDoEstoque(2, 'UI', 'Un.', 2)).toBe(1);
    // Unidade VAZIA continua no bruto: sem rotulo, "2" ja se le como 2 unidades.
    expect(qtdDoEstoque(2, '', 'Un.', 2)).toBe(2);
  });

  test('item NOVO (ja em Un.) nao passa pela regra — 2 Un. sao 2 embalagens', () => {
    expect(qtdDoEstoque(2, 'Un.', 'Un.', 1)).toBe(2);
    expect(qtdDoEstoque(1, 'Un.', 'Un.', 1)).toBe(1);
    // Grafia diferente da mesma unidade tambem nao converte.
    expect(qtdDoEstoque(3, 'un', 'Un.', 1)).toBe(3);
  });

  test('a conversao entre unidades de CONTEUDO continua intacta', () => {
    expect(qtdDoEstoque(500, 'g', 'kg', 500)).toBeCloseTo(0.5, 6);
    expect(qtdDoEstoque(5, 'mL', 'mL', 5)).toBe(5);
  });

  test('sem dosagem utilizavel devolve o bruto — nao inventa divisao', () => {
    // Dosagem ausente/zero: dividir por ela daria Infinity, e um chute aqui vira
    // quantidade debitada e valor cobrado.
    expect(qtdDoEstoque(20, 'mL', 'Un.', null)).toBe(20);
    expect(qtdDoEstoque(20, 'mL', 'Un.', 0)).toBe(20);
  });

  test('a baixa e as verificacoes comparam na MESMA unidade', () => {
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    // A dosagem chega a `qtdDoEstoque` nos tres caminhos (baixa, dia e curso).
    expect(controller).toMatch(/qtdDoEstoque\(qtdDia, item\.unidade, unidadeEstoque, item\.dosagem\)/);
    expect(controller).toMatch(/qtdDoEstoque\(resolverQtd\(item\), item\.unidade, unidadeEstoque, item\.dosagem\)/);
    expect(controller).toMatch(/qtdDoEstoque\(calcularQuantidadeTotal\(item\), item\.unidade, unidadeEstoque, item\.dosagem\)/);
    // E o alerta de estoque nao compara mais a quantidade CRUA da receita com o saldo
    // em embalagens — era isso que acusava falta do que cabe.
    expect(controller).not.toMatch(/comparavel \? disponBase < necessarioBase/);
    expect(controller).toMatch(/const insuficiente\s+= totalEstoque < necessarioEstoque;/);
  });

  test('a fila do plantao devolve a unidade do ESTOQUE por item', () => {
    // Sem isso a tela mostra o snapshot ("20 mL") enquanto a baixa e a fatura falam em
    // embalagens — foi o defeito relatado.
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    expect(controller).toMatch(/unidadeEstoque: unidadeDoEstoque\(formasFila, i\)/);
    const tela = leiaFront('pages/ExecucaoPrescricao.tsx');
    expect(tela).toMatch(/unidadeEstoque\?: string \| null;/);
    expect(tela).toMatch(/const doseTxt = dosagemNaTela\(item\)/);
    // A lista de separacao do Painel Principal le a MESMA regra.
    expect(leiaFront('pages/PainelPrincipal.tsx')).toMatch(/doseDoEstoque\(i\)/);
  });

  test('a importacao de orcamento nao traz mais a unidade da EMBALAGEM', () => {
    // O item do orcamento guarda a unidade do catalogo; importa-la fazia nascer um item
    // NOVO divergente do estoque.
    const presc = leiaFront('pages/SubModuloPrescricao.tsx');
    expect(presc).toMatch(/unidadeDoProduto\(medicamentos\.find\(m => m\.id === i\.refId\)\)/);
  });
});

// ─── 8. A TELA DE ESTOQUE ROTULA O SALDO PELA UNIDADE OPERATIVA ──────────────
// 🔴 2026-09-17, a pedido: "Qtd em Estoque esta aparecendo 5 g, ou seja quantidade +
// unidade; precisa ser quantidade + Forma de Calculo (nesse caso Un.)".
// `medicamento.unidade` e a unidade da EMBALAGEM e nao diz em que o saldo esta contado —
// a entrada de um produto sem multidose grava EMBALAGENS. "5 g" para 5 bisnagas e o mesmo
// descasamento que a receita e a fatura ja tinham.
describe('rotulo do saldo na Farmacia', () => {
  // ⚠️ SEM COMENTÁRIOS: a regra é explicada citando `medicamento.unidade` como o que NÃO
  // se deve usar — um gate que reprova a própria documentação da regra é um gate que se
  // aprende a ignorar.
  const farmacia = semComentarios(leiaFront('pages/Farmacia.tsx'));

  test('nenhum numero da tela e rotulado com a unidade da EMBALAGEM', () => {
    // Cobre saldo, minimo/alarmante, historico de movimentos e Ajuste de Estoque: uma
    // unidade diferente em qualquer um deles e uma segunda versao da verdade na MESMA tela.
    expect(farmacia).not.toMatch(/medicamento\??\.unidade/);
  });

  test('o saldo sai por `unidadeOperativaMed`, que e a regra unica', () => {
    expect(farmacia).toMatch(/\{fmtQtd\(itemView\.qtdEstoque\)\} \{unidadeOperativaMed\(itemView\.medicamento\)\}/);
    expect(farmacia).toMatch(/\{fmtQtd\(item\.qtdEstoque\)\} \{unidadeOperativaMed\(item\.medicamento\)\}/);
    expect(farmacia).toMatch(/function unidadeOperativaMed[\s\S]{0,120}unidadeOperativaProduto\(med\)/);
  });
});
