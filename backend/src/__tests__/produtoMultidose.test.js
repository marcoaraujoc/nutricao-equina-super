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

const { qtdDoEstoque, entregaPorEmbalagem, embalagensDaExecucao } = Prescricao;
const leia = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const leiaFront = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', rel), 'utf8');
// Comentários explicam a regra CITANDO as mesmas palavras; um gate que se satisfaz
// com a própria documentação é um gate que se aprende a ignorar.
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ─── 0. O CURSO QUE NÃO CABE NUMA EMBALAGEM (2026-09-19) ─────────────────────
//
// 🔴 O CASO, como foi relatado: "foi comprado um frasco de 100 mL mas foi receitado
// 5 doses de 25 mL — é preciso na prescrição informar que serão usados dois frascos e
// lançar na fatura os dois frascos".
//
// O QUE QUEBRAVA: `entregaPorEmbalagem` assumia UMA embalagem para o curso inteiro
// (2026-09-18), porque o produto SEM multidose não declarava quanto cabia nela. A
// clínica entregava dois frascos e cobrava um — sem erro em tela nenhuma.
//
// ⚠️ VALE SÓ PARA O PRODUTO SEM MULTIDOSE (a pedido). No multidose a sobra do frasco
// volta para a prateleira e a cobrança é PROPORCIONAL ao prescrito; arredondar ali
// cobraria um frasco inteiro de cada paciente que recebesse uma dose dele.
describe('curso que consome mais de uma embalagem', () => {
  const PRODUTO = { multidose: false, dosesPorEmbalagem: 100, unidade: 'mL' };

  test('o conteúdo só existe no produto SEM multidose', () => {
    expect(forma.conteudoDaEmbalagem(PRODUTO)).toBe(100);
    // 🔴 No multidose ele responde `null`: lá quem manda é `qtdPorEmbalagemDe`, que
    // muda a UNIDADE OPERATIVA (o estoque passa a ser contado em mL). Se os dois
    // respondessem juntos, todo produto que declarasse o conteúdo viraria multidose
    // por acidente e a cobrança voltaria a ser proporcional.
    expect(forma.conteudoDaEmbalagem({ ...PRODUTO, multidose: true })).toBeNull();
    expect(forma.conteudoDaEmbalagem({ multidose: false, dosesPorEmbalagem: null })).toBeNull();
  });

  test('declarar o conteúdo NÃO transforma o item em multidose', () => {
    // A unidade operativa continua 'Un.' — é ela que faz o estoque ser contado em
    // EMBALAGENS. Virar 'mL' aqui devolveria a cobrança proporcional pela porta dos
    // fundos, e o cadastro nunca pediu isso.
    expect(forma.unidadeOperativa(PRODUTO)).toBe('Un.');
    // E a receita continua escrita na unidade do produto, que é o que o vet digita.
    expect(forma.unidadePrescricao(PRODUTO)).toBe('mL');
  });

  test('125 mL de um frasco de 100 mL são DOIS frascos (arredonda para cima)', () => {
    expect(forma.embalagensPara(125, 100)).toBe(2);
    expect(forma.embalagensPara(100, 100)).toBe(1);
    expect(forma.embalagensPara(101, 100)).toBe(2);
    expect(forma.embalagensPara(250, 100)).toBe(3);
  });

  test('sem conteúdo declarado continua valendo UMA embalagem — nada muda na base atual', () => {
    expect(forma.embalagensPara(125, null)).toBe(1);
    expect(forma.embalagensPara(125, 0)).toBe(1);
    // ⚠️ Nunca 0: zero faria o curso sair sem baixa de estoque e sem linha de fatura.
    expect(forma.embalagensPara(0, 100)).toBe(1);
  });

  test('o ruído de ponto flutuante não inventa uma embalagem a mais', () => {
    // 3 doses de 0,1 somam 0.30000000000000004 — sem a tolerância, `ceil` daria 2.
    expect(forma.embalagensPara(0.1 + 0.1 + 0.1, 0.3)).toBe(1);
  });

  test('a quantidade que sai do estoque é a do CURSO em embalagens', () => {
    // 4º argumento = conteúdo. Sem ele, a resposta é a de sempre (1 embalagem).
    expect(qtdDoEstoque(125, 'mL', 'Un.', 100)).toBe(2);
    expect(qtdDoEstoque(125, 'mL', 'Un.')).toBe(1);
  });

  test('receita escrita em Un. NÃO entra na regra — ali o número já É de embalagens', () => {
    // "2 Un. por dia durante 5 dias" são 10 embalagens de verdade, não ceil(10/100).
    expect(entregaPorEmbalagem('Un.', 'Un.')).toBe(false);
    expect(qtdDoEstoque(10, 'Un.', 'Un.', 100)).toBe(10);
  });

  // ─── A SEQUÊNCIA DO CASO RELATADO ──────────────────────────────────────────
  describe('a baixa é INCREMENTAL — o 2º frasco só abre quando o 1º acaba', () => {
    /** Roda o curso inteiro e devolve quantas embalagens cada dose entregou. */
    const curso = ({ dose, doses, conteudo }) =>
      Array.from({ length: doses }, (_, i) =>
        embalagensDaExecucao({ jaConsumido: dose * i, qtdAgora: dose, conteudo }));

    test('frasco de 100 mL, 5 doses de 25 mL → 1,0,0,0,1 = 2 frascos no curso', () => {
      const entregas = curso({ dose: 25, doses: 5, conteudo: 100 });
      expect(entregas).toEqual([1, 0, 0, 0, 1]);
      expect(entregas.reduce((a, b) => a + b, 0)).toBe(2);
    });

    test('🔴 curso interrompido no meio NÃO cobra o frasco que ninguém abriu', () => {
      // É a razão de a conta ser acumulada em vez de `ceil(curso inteiro)` na 1ª dose:
      // cancelado na 2ª aplicação, o cliente pagou UM frasco, que é o que foi aberto.
      const entregas = curso({ dose: 25, doses: 5, conteudo: 100 }).slice(0, 2);
      expect(entregas.reduce((a, b) => a + b, 0)).toBe(1);
    });

    test('dose maior que a embalagem abre várias de uma vez', () => {
      // 250 mL num frasco de 100 mL: a primeira dose já abre três.
      expect(embalagensDaExecucao({ jaConsumido: 0, qtdAgora: 250, conteudo: 100 })).toBe(3);
    });

    test('sem conteúdo declarado: 1 na primeira dose e 0 nas seguintes (a regra antiga)', () => {
      expect(curso({ dose: 25, doses: 4, conteudo: null })).toEqual([1, 0, 0, 0]);
    });

    test('a dose que cabe no frasco aberto não entrega nada', () => {
      expect(embalagensDaExecucao({ jaConsumido: 25, qtdAgora: 25, conteudo: 100 })).toBe(0);
    });

    test('o curso que fecha exatamente na embalagem não abre a seguinte', () => {
      // 4 doses de 25 = 100 mL: um frasco, nunca dois.
      const entregas = curso({ dose: 25, doses: 4, conteudo: 100 });
      expect(entregas.reduce((a, b) => a + b, 0)).toBe(1);
    });
  });

  // ─── A VACINA NÃO É ARRASTADA PARA A REGRA NOVA ────────────────────────────
  test('🔴 o lote de vacina NÃO herda o conteúdo de um produto sem multidose', () => {
    // A vacina tem contagem PRÓPRIA: `tb_lotes_vacina.doses_por_frasco`, e o saldo do
    // lote é contado em DOSES. O frasco de dose única nasce com 1, então cada aplicação
    // já consome (e cobra) o frasco inteiro — a regra das embalagens inteiras não tem o
    // que corrigir ali.
    //
    // 🔴 MAS `dosesDoCatalogo` usa `doses_por_embalagem` como PADRÃO do lote, e desde
    // 2026-09-19 essa coluna também guarda o conteúdo do produto SEM multidose (100 mL
    // por frasco). Sem o filtro `multidose = true`, um frasco de vacina nasceria com
    // "100 doses" e cada aplicação passaria a custar um CENTÉSIMO do frasco — sem erro
    // nenhum em tela, só a receita da clínica minguando.
    const fn = semComentarios(leia('controllers/EstoqueVacinaController.js'));
    const corpo = fn.slice(fn.indexOf('async function dosesDoCatalogo'), fn.indexOf('async function dosesDoCatalogo') + 700);
    expect(corpo).toMatch(/multidose = true/);
    expect(corpo).toMatch(/doses_por_embalagem IS NOT NULL/);
  });
});

// ─── 1. A CONTA QUE VAI PARA O ESTOQUE E PARA A FATURA ───────────────────────
describe('quantidade que sai do estoque', () => {
  test('receita e estoque na MESMA unidade: 5 mL saem de 60 mL, sem conversão', () => {
    expect(qtdDoEstoque(5, 'mL', 'mL')).toBeCloseTo(5, 6);
  });

  test('unidades do mesmo grupo continuam convertendo: 500 g -> 0,5 kg', () => {
    expect(qtdDoEstoque(500, 'g', 'kg')).toBeCloseTo(0.5, 6);
    expect(qtdDoEstoque(2, 'L', 'mL')).toBeCloseTo(2000, 6);
  });

  test('receita em conteúdo contra estoque em embalagens: UMA embalagem', () => {
    // ⚠️ INVERTIDO em 2026-09-18: era `10` (o valor bruto, dez frascos) até 2026-09-17,
    // e depois "1 por aplicação". Agora a prescrição escrita em conteúdo consome a
    // embalagem UMA vez no curso inteiro — ver a seção 7.
    expect(qtdDoEstoque(10, 'mL', 'Un.')).toBe(1);
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
  // É o que `calcPrecoUnitarioBase` grava na entrada: o valor de UMA embalagem ÷ o que
  // ela contém (2026-09-17). O saldo saiu da conta — ver o bloco do valor por embalagem.
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

  test('🔴 a unidade da RECEITA diverge da do ESTOQUE no não-multidose (2026-09-18)', () => {
    // As duas respostas eram a MESMA ('Un.') até 2026-09-17, e a divergência agora é
    // deliberada: o veterinário prescreve "5 mL de xarope", nunca "0,1 frasco", mas o
    // saldo continua sendo contado em embalagens.
    expect(forma.unidadePrescricao({ multidose: false, unidade: 'mL' })).toBe('mL');
    expect(forma.unidadeOperativa({ multidose: false, unidade: 'mL' })).toBe('Un.');
    expect(forma.unidadePrescricao({ multidose: false, unidade: 'g' })).toBe('g');
    // MULTIDOSE: as duas voltam a coincidir na forma de cálculo — ali o estoque é
    // contado por dentro e a receita é escrita na mesma unidade.
    const med = { multidose: true, formaCalculo: 'mL', qtdPorEmbalagem: 20, unidade: 'Frasco' };
    expect(forma.unidadePrescricao(med)).toBe('mL');
    expect(forma.unidadeOperativa(med)).toBe('mL');
    // Sem unidade no catálogo o campo não pode sair em branco: o número da dosagem
    // sozinho não diz o que significa, e ele vira o SNAPSHOT da receita.
    expect(forma.unidadePrescricao({ multidose: false, unidade: null })).toBe('Un.');
    expect(forma.unidadePrescricao(null)).toBe('Un.');
  });

  test('a tela da Prescrição usa a unidade da RECEITA; a Farmácia, a do ESTOQUE', () => {
    // Trocar uma pela outra não quebra nada visível: a tela só passa a mostrar a
    // unidade errada, e o snapshot da receita nasce com ela.
    const frontUtil = leiaFront('utils/formaCalculo.ts');
    expect(frontUtil).toMatch(/export function unidadePrescricaoProduto\(/);
    expect(frontUtil).toMatch(/return p\.unidade \|\| UNIDADE_AVULSA;/);

    const presc = semComentarios(leiaFront('pages/SubModuloPrescricao.tsx'));
    expect(presc).toMatch(/unidadePrescricaoProduto\(m\)/);
    expect(presc).not.toMatch(/unidadeOperativaProduto\(m\)/);

    // A Farmácia rotula o SALDO, que continua em embalagens.
    const farmacia = leiaFront('pages/Farmacia.tsx');
    expect(farmacia).toMatch(/unidadeOperativaProduto\(med\)/);
  });

  test('a execução mostra o PRESCRITO e a separação omite a embalagem já entregue', () => {
    // ⚠️ SEM COMENTÁRIOS: os comentários abaixo documentam a regra CITANDO o texto
    // antigo, e a varredura crua reprovaria a própria documentação dela.
    const exec = semComentarios(leiaFront('pages/ExecucaoPrescricao.tsx'));
    // ⚠️ REVERTE o "20 mL · 1 Un. por aplicação" de 2026-09-17 (a pedido): quem aplica
    // lê o que o veterinário indicou.
    expect(exec).not.toMatch(/por aplicação/);
    expect(exec).toMatch(/if \(item\.unidade\) return `\$\{item\.dosagem\} \$\{item\.unidade\}`;/);
    // A quantidade de embalagens virou assunto da SEPARAÇÃO, e o item já entregue sai
    // da lista — senão a farmácia separaria um frasco por dia durante dez dias.
    expect(exec).toMatch(/jaEntregue: boolean/);
    expect(exec).toMatch(/const jaEntregue = !!item\.executadoEm;/);
    const painel = semComentarios(leiaFront('pages/PainelPrincipal.tsx'));
    expect(painel).toMatch(/if \(jaEntregue\) continue;/);
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
    // ⚠️ ATUALIZADO em 2026-09-19: a baixa passou a ter DOIS ramos — na entrega por
    // embalagem quem manda é a conta acumulada (`embalagensAgora`), e só fora dela a
    // quantidade sai de `qtdDoEstoque`. O que o gate trava continua sendo o mesmo: a
    // quantidade debitada nasce da unidade resolvida, nunca do número cru da receita.
    expect(controller).toMatch(/let restante = entregaUnica[\s\S]{0,200}qtdDoEstoque\(qtdDia, item\.unidade, unidadeEstoque,/);
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
    // 🔴 O 2º ARGUMENTO É O CONTEÚDO DA EMBALAGEM, NUNCA O SALDO (2026-09-17). Voltar a
    // passar `qtdEstoque` faria o preço mudar quando o estoque é ajustado — e o valor
    // gravado, que agora é por embalagem, seria dividido uma segunda vez.
    expect(estoque).toMatch(/calcPrecoUnitarioBase\(Number\(valorRepassado\), conteudoEmb, unidadeConta\)/);
    expect(estoque).not.toMatch(/calcPrecoUnitarioBase\([^)]*qtdEstoque/);
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
    // ⚠️ `semComentarios`, e não uma janela maior: o corpo é curto, o que cresceu foi a
    // documentação. Medir código com o comentário dentro faz o gate reprovar por
    // TAMANHO do texto — que foi o que aconteceu em 2026-09-19.
    const lib = semComentarios(leia('lib/catalogoEmpresa.js'));
    const fn  = lib.slice(lib.indexOf('async function gravarMultidose'));
    expect(fn.slice(0, 1600)).toMatch(/temColunaFormaCalculo\(client\)/);
    expect(fn.slice(0, 1600)).toMatch(/\.catch\(\(\) => \{\}\)/);
    // 🔴 O NÚMERO NÃO É MAIS ZERADO ao desmarcar (2026-09-19): ele passou a ser o
    // CONTEÚDO da embalagem também no não-multidose, e é dele que sai "o curso usa dois
    // frascos". Voltar a `marcado ? qtd : null` apaga esse cadastro no primeiro salvar.
    expect(fn.slice(0, 1600)).toMatch(/const qtd\s+= numeroPositivo\(dosesPorEmbalagem\);/);
    // A FORMA continua exclusiva do multidose — é ela que muda a unidade operativa.
    expect(fn.slice(0, 1600)).toMatch(/const forma\s+= marcado \? normalizarFormaCalculo\(formaCalculo\) : null;/);
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

  test('a linha da fatura é o Valor Repassado da EMBALAGEM', () => {
    // 🔴 O VALOR JÁ É O DE UMA EMBALAGEM (2026-09-17): a tela deixou de multiplicar
    // pela Qtd Produto, então R$ 30 digitados são R$ 30 por embalagem — comprar 10 ou
    // 100 não muda o preço da dose. O 2º argumento é o CONTEÚDO, e sem multidose ele
    // não existe (`null` = a embalagem é a própria unidade).
    const preco = calcPrecoUnitarioBase(30, null, 'Un.');
    expect(preco).toBe(30);
    expect(qtdDoEstoque(1, 'Un.', 'Un.') * preco).toBe(30);
    // E o curso inteiro cobra o que saiu, nunca mais que isso.
    expect(qtdDoEstoque(10, 'Un.', 'Un.') * preco).toBe(300);
  });

  test('🔴 o preço NÃO se move quando a quantidade comprada muda', () => {
    // A prova de que o saldo saiu da conta: a mesma embalagem de R$ 30 custa R$ 30 na
    // dose, tenha a clínica comprado 1 ou 500. Enquanto a tela multiplicava e o
    // controller dividia pelo saldo, as duas contas se cancelavam — mas bastava um
    // ajuste de estoque para o preço da dose mudar sozinho.
    expect(calcPrecoUnitarioBase(30, null, 'Un.')).toBe(30);
    // E o conteúdo declarado é o único divisor: frasco de 20 mL por R$ 100 → R$ 5/mL.
    expect(calcPrecoUnitarioBase(100, 20, 'mL')).toBeCloseTo(5, 6);
  });

  test('🔴 em kg/L o fator de base NÃO entra mais na conta', () => {
    // O caso que saía mil vezes errado: um produto cadastrado em 'kg'. Com a unidade do
    // CATÁLOGO o preço virava R$/g sobre um número que conta embalagens, e a receita de
    // 1 unidade cobrava R$ 0,10. Em 'Un.' o fator é 1 e o preço é o da embalagem.
    expect(calcPrecoUnitarioBase(100, 1, 'kg')).toBeCloseTo(0.1, 6);
    expect(calcPrecoUnitarioBase(100, null, 'Un.')).toBe(100);
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
    // CORTA sobre um catálogo global de milhares de linhas.
    // ⚠️ O que se trava aqui é a EXISTÊNCIA do corte, não o número: ele subiu de
    // 60/100 para 300 em 2026-09-22 (a lista precisava ser rolável até o fim do
    // catálogo da clínica) e vai subir de novo. Fixar o literal transformava um
    // ajuste de teto num teste vermelho sem defeito nenhum por trás.
    expect(prod).toMatch(/take: LIMITE/);
    expect(prod).toMatch(/const LIMITE = \d+/);
  });
});

// ─── 7. RECEITA EM CONTEUDO CONTRA ESTOQUE EM EMBALAGENS ────────────────────
// 🔴 A REGRA (2026-09-18, a pedido): produto SEM multidose e prescrito na unidade do
// CATALOGO ("5 mL de xarope"), mas o estoque dele conta EMBALAGENS. Nao ha conversao
// possivel — o produto nao declara quanto cabe no frasco —, e o que existe e o fato: a
// clinica ENTREGA a embalagem, uma vez. O curso inteiro consome UM frasco.
//
//     Xarope 50 mL, R$ 60,00 o frasco · receita 5 mL 1x/dia por 10 dias
//       estoque : -1 frasco       fatura : 1 x R$ 60,00
//
// ⚠️ HISTORICO das duas inversoes, para nao voltar a nenhuma delas:
//   ate 2026-09-17 : valor BRUTO      -> 20 mL debitavam 20 frascos de um saldo de 2
//   2026-09-17     : 1 por APLICACAO  -> 10 dias cobravam DEZ frascos
//   2026-09-18     : 1 por CURSO      -> um frasco, entregue na 1a execucao
describe('receita em conteudo contra estoque em embalagens', () => {
  test('o curso inteiro consome UMA embalagem — nao o bruto, nem uma por aplicacao', () => {
    // A dose do dia, a dose dobrada e o curso de 7 dias dao todos a MESMA resposta:
    // o que sai do estoque e o frasco, e ele sai uma vez.
    expect(qtdDoEstoque(20, 'mL', 'Un.')).toBe(1);
    expect(qtdDoEstoque(40, 'mL', 'Un.')).toBe(1);
    expect(qtdDoEstoque(140, 'mL', 'Un.')).toBe(1);
    // 🔴 o valor bruto seria 20/40/140 — vinte, quarenta e cento e quarenta frascos.
    expect(qtdDoEstoque(20, 'mL', 'Un.')).not.toBe(20);
    // 🔴 e "1 por aplicacao" daria 7 frascos no curso de 7 dias.
    expect(qtdDoEstoque(140, 'mL', 'Un.')).not.toBe(7);
    // ⚠️ NAO so as unidades de conteudo: '%' ("Pasta 10%") e 'UI' nao tem grupo de
    // conversao e caiam no bruto. Vale para toda unidade que nao seja a avulsa.
    expect(qtdDoEstoque(10, '%', 'Un.')).toBe(1);
    expect(qtdDoEstoque(2, 'UI', 'Un.')).toBe(1);
    // Unidade VAZIA continua no bruto: sem rotulo, "2" ja se le como 2 unidades.
    expect(qtdDoEstoque(2, '', 'Un.')).toBe(2);
  });

  test('receita em Un. NAO entra na regra — 2 Un. sao 2 embalagens de verdade', () => {
    // Aqui o veterinario prescreveu EMBALAGENS (a ampola, o comprimido), e duas por dia
    // durante cinco dias sao dez. Confundir os dois casos faria a clinica que aplica
    // dose a dose cobrar uma embalagem pelo tratamento inteiro.
    expect(qtdDoEstoque(2, 'Un.', 'Un.')).toBe(2);
    expect(qtdDoEstoque(10, 'Un.', 'Un.')).toBe(10);
    // Grafia diferente da mesma unidade tambem nao converte.
    expect(qtdDoEstoque(3, 'un', 'Un.')).toBe(3);
  });

  test('a conversao entre unidades de CONTEUDO continua intacta (multidose)', () => {
    expect(qtdDoEstoque(500, 'g', 'kg')).toBeCloseTo(0.5, 6);
    expect(qtdDoEstoque(5, 'mL', 'mL')).toBe(5);
    // O proporcional do multidose e o que o pedido chama de "proporcional prescrito".
    expect(qtdDoEstoque(2.5, 'mL', 'mL')).toBeCloseTo(2.5, 6);
  });

  test('`entregaPorEmbalagem` e a fonte unica de QUEM entra na regra', () => {
    expect(entregaPorEmbalagem('mL', 'Un.')).toBe(true);
    expect(entregaPorEmbalagem('%',  'Un.')).toBe(true);
    // Estoque medido por dentro (multidose): a receita e a baixa falam a mesma lingua.
    expect(entregaPorEmbalagem('mL', 'mL')).toBe(false);
    // Receita ja em embalagens, e as duas grafias da avulsa.
    expect(entregaPorEmbalagem('Un.', 'Un.')).toBe(false);
    expect(entregaPorEmbalagem('un',  'Un.')).toBe(false);
    // Sem unidade na receita nao ha o que deduzir.
    expect(entregaPorEmbalagem('',   'Un.')).toBe(false);
    expect(entregaPorEmbalagem(null, 'Un.')).toBe(false);
    // Unidades do MESMO grupo convertem (L -> mL), nao entregam embalagem.
    expect(entregaPorEmbalagem('L', 'mL')).toBe(false);
  });

  test('🔴 a embalagem entregue NAO e cobrada de novo nas doses seguintes', () => {
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    // A guarda vive em `debitarEstoqueDia` e sai de la pelos dois conjuntos que o
    // `executar` consome. Sem ela a linha da fatura somaria quantidade a cada dose —
    // dez frascos por um — e a conta a pagar do fornecedor repetiria a compra.
    // ⚠️ ATUALIZADO em 2026-09-19: a guarda deixou de ser "ja executou uma vez" e virou
    // a conta ACUMULADA (o curso pode consumir varias embalagens). O que ela impede e o
    // mesmo: a dose que sai de um frasco JA ABERTO nao gera cobranca nova.
    const fn = controller.slice(controller.indexOf('async function debitarEstoqueDia'));
    expect(fn.slice(0, 3200)).toMatch(/entregaPorEmbalagem\(item\.unidade, unidadeEstoque\)/);
    expect(fn.slice(0, 3200)).toMatch(/if \(embalagensAgora <= 0\) \{ jaEntregues\.add\(item\.id\); continue; \}/);
    // 🔴 O LEGADO NAO TEM CONTADOR: `dosesExecutadas` so e incrementado no fluxo por
    // dose. Sem esta perna, um item legado ja executado cai na conta com "nada
    // consumido" e volta a debitar/cobrar uma embalagem A CADA execucao.
    expect(fn.slice(0, 3200)).toMatch(/if \(item\.executadoEm && doses === 0\) \{ jaEntregues\.add\(item\.id\); continue; \}/);
    expect(fn).toMatch(/return \{ precos, unidades, jaEntregues, porEmbalagem, entregas \};/);
    // E o `executar` PRECISA usar os conjuntos: recebe-los e ignora-los e o modo
    // silencioso de a regra deixar de existir.
    expect(controller).toMatch(/const \{ precos, jaEntregues, porEmbalagem, entregas \} = await debitarEstoqueDia\(/);
    expect(controller).toMatch(/const entregaJaFeita = jaEntregues\.has\(item\.id\);/);
    expect(controller).toMatch(/if \(!item\.medicamentoCliente && !entregaJaFeita\)/);
    // 🔴 A QUANTIDADE E A DE EMBALAGENS ABERTAS NESTA EXECUCAO, nunca 1 fixo: uma dose
    // maior que o frasco abre varias de uma vez, e `1` cobraria (e compraria) uma so.
    expect(controller).toMatch(/const embalagensEntregues = porEmbalagem\.has\(item\.id\) \? \(entregas\.get\(item\.id\) \?\? 1\) : 1;/);
    expect(controller).toMatch(/quantidade:   embalagensEntregues,/);
    // ⚠️ E o valor da linha precisa ser o UNITARIO: com a quantidade acima e o TOTAL no
    // `valor`, a fatura multiplicaria de novo o que ja saiu multiplicado.
    expect(controller).toMatch(/valor:        valorDaDose \/ embalagensEntregues,/);
    expect(controller).toMatch(/item\.medicamentoCatId && !entregaJaFeita\)/);
  });

  test('🔴 a ENTREGA ao proprietario debita estoque e tem preco (era valor ZERO)', () => {
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    // O item que a clinica FORNECE e o proprietario APLICA nunca chega ao plantao: a
    // finalizacao e a unica chance de cobra-lo, e ate 2026-09-18 ele ia com valor 0.
    expect(controller).toMatch(/incluirDoProprietario = false/);
    expect(controller).toMatch(/if \(item\.aplicadaPeloProprietario && !incluirDoProprietario\) continue;/);
    const trecho = controller.slice(controller.indexOf('const itensParaFaturarAgora'));
    expect(trecho.slice(0, 1200)).toMatch(/calcularQuantidadeTotal,[\s\S]{0,120}incluirDoProprietario: true/);
    expect(trecho.slice(0, 3000)).toMatch(/precosDaEntrega\.get\(item\.medicamentoCatId\)/);
    // ⚠️ Quantidade do CURSO INTEIRO: e o que o cliente leva para casa. A dose do dia
    // cobraria um decimo do que saiu da prateleira.
    expect(trecho.slice(0, 1200)).not.toMatch(/calcularQuantidadeDiaria/);
    // 🔴 E A LINHA CONTA AS EMBALAGENS (2026-09-19): o curso que nao cabe num frasco
    // leva dois, e `quantidade: 1` mostraria o valor de dois ao lado de "Quant.: 1".
    expect(trecho.slice(0, 4000)).toMatch(/quantidade:   embalagensDaEntrega,/);
    // ⚠️ OS DOIS ANDAM JUNTOS: `valorDaEntrega` e o TOTAL do que saiu do estoque, e a
    // linha multiplica de volta por `quantidade`. Quantidade sem o unitario dobra a
    // cobranca; unitario sem a quantidade a divide. Nenhum dos dois acusa nada.
    expect(trecho.slice(0, 4000)).toMatch(/valor:        valorDaEntrega \/ embalagensDaEntrega,/);
  });

  test('a baixa e as verificacoes comparam na MESMA unidade', () => {
    const controller = semComentarios(leia('controllers/PrescricaoGrupoController.js'));
    // ⚠️ A DOSAGEM SAIU da assinatura (2026-09-18): ela servia para CONTAR APLICACOES, e
    // a regra deixou de contar aplicacoes. `item.dosagem` aqui e sinal de que alguem
    // reintroduziu a divisao — e e ISSO que o gate trava, nao o numero de argumentos.
    // ⚠️ O 4o argumento de 2026-09-19 e o CONTEUDO DA EMBALAGEM, que nao divide nada:
    // ele so diz quantas embalagens o curso gasta (125 mL de um frasco de 100 sao 2).
    expect(controller).toMatch(/qtdDoEstoque\(qtdDia, item\.unidade, unidadeEstoque, conteudoDoItem\(conteudos, item\)\)/);
    expect(controller).toMatch(/qtdDoEstoque\(resolverQtd\(item\), item\.unidade, unidadeEstoque, conteudo\)/);
    expect(controller).toMatch(/qtdDoEstoque\(calcularQuantidadeTotal\(item\), item\.unidade, unidadeEstoque, conteudo\)/);
    expect(controller).not.toMatch(/qtdDoEstoque\([^)]*item\.dosagem\)/);
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

// ─── 8. O NÚMERO DE EMBALAGENS FICA NO DOCUMENTO, NÃO SÓ NO FORMULÁRIO ────────
//
// 🔴 O pedido é "é preciso NA PRESCRIÇÃO informar que serão usados dois frascos", e até
// 2026-09-22 a resposta vivia só na faixa azul do formulário: inserido o item, o número
// sumia. O documento salvo, o finalizado e a visualização em somente-leitura — que é
// onde o vet confere antes de finalizar e onde alguém pergunta "por que a fatura cobrou
// dois frascos?" — não o diziam em lugar nenhum.
//
// ⚠️ O que se trava aqui é a FONTE ÚNICA. Duas contas (uma no formulário, outra no item)
// divergem na primeira correção, e a divergência aparece como a tela prometendo um
// número que a fatura não cobra — sem erro nenhum.
describe('a prescrição informa as embalagens no item, não só no formulário', () => {
  const presc = semComentarios(leiaFront('pages/SubModuloPrescricao.tsx'));

  test('existe UMA função de módulo, e o formulário a CHAMA em vez de ter a conta', () => {
    expect(presc).toMatch(/function embalagensDoCurso\(args: \{/);
    expect(presc).toMatch(/const embalagensForm = embalagensDoCurso\(\{/);
    // A conta não pode voltar a ser inline no componente: se `embalagensParaQtd` for
    // chamada em mais de um lugar, há uma segunda regra.
    expect(presc.match(/embalagensParaQtd\(/g) ?? []).toHaveLength(1);
  });

  test('cada item da lista recebe o número — local (em criação) e salvo', () => {
    expect(presc.match(/embalagens=\{embalagensDoCurso\(\{/g) ?? []).toHaveLength(2);
    // O produto do item vem do catálogo COMPLETO: `medicamentos` é a lista filtrada
    // pela busca digitada, e o selo piscaria a cada tecla.
    expect(presc).toMatch(/const produtoDoItem = useCallback\(/);
    expect(presc).toMatch(/allMeds\.find\(m => m\.id === catId\) \?\? medicamentos\.find\(m => m\.id === catId\)/);
  });

  test('o ItemRow desenha o selo a partir da prop, sem recalcular nada', () => {
    expect(presc).toMatch(/embalagens\?: EmbalagensDoCurso \| null;/);
    expect(presc).toMatch(/\{embalagens\.qtd\} \{embalagens\.qtd === 1 \? 'embalagem' : 'embalagens'\}/);
  });

  test('a unidade do item vem do SNAPSHOT dele, nunca do catálogo de hoje', () => {
    // Ler `unidadeCatalogo` para um item antigo faria a conta usar a unidade atual do
    // produto — e o número exibido deixaria de bater com o que foi debitado.
    expect(presc).toMatch(/unidade: item\.unidade, dosagem: item\.dosagem,/);
  });
});

// ─── 9. O HISTÓRICO DIZ O QUE FOI PRESCRITO (2026-09-22, a pedido) ────────────
//
// A lista mostrava "#001 · 2 itens · 1M 1P" e nada mais: para saber O QUÊ era preciso
// abrir o documento. ⚠️ Vale nas DUAS apresentações, e o TABLET é a razão de a tabela
// entrar junto: o card só existe abaixo de `md` (768px) e daí para cima — iPad
// inclusive — quem responde é a tabela.
describe('nome do medicamento/procedimento no histórico de prescrições', () => {
  const presc = semComentarios(leiaFront('pages/SubModuloPrescricao.tsx'));

  test('a lista de nomes é uma função só, usada pelas duas apresentações', () => {
    expect(presc).toMatch(/const nomesDosItens = \(g: PrescricaoGrupo\) =>/);
    // card (< md) + tabela (>= md, o tablet) — duas chamadas de render mais o `title`
    // da tabela. Menos que isso significa que uma das duas ficou sem o nome.
    expect((presc.match(/nomesDosItens\(g\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('o nome sai do item, e o backend já o manda na listagem do grupo', () => {
    expect(presc).toMatch(/g\.itens\.map\(i => i\.medicamento\)/);
    // `GRUPO_INCLUDE` traz os itens do documento; sem eles a lista não teria o que exibir.
    expect(leia('controllers/PrescricaoGrupoController.js')).toMatch(/const GRUPO_INCLUDE = \{[\s\S]{0,400}itens: \{/);
  });
});

// ─── 10. O CADASTRO SEM CONTEÚDO DEIXOU DE FALHAR EM SILÊNCIO (2026-09-22) ────
//
// 🔴 Medido na base nesta data: **8.277 itens de catálogo, ZERO** sem multidose com
// `doses_por_embalagem` preenchido. A regra das N embalagens estava inteira, testada e
// DORMENTE — todo curso era debitado e faturado como uma embalagem, que é exatamente o
// defeito relatado. O código estava certo; o dado é que não existia, e nada na tela
// pedia por ele.
//
// ⚠️ O aviso é o NEGATIVO de `embalagensDoCurso` e usa as MESMAS guardas: os dois nunca
// aparecem juntos. Relaxar uma delas faria o aviso surgir no multidose (cobrança
// proporcional, sem embalagem inteira a contar) ou na receita já escrita em "2 Un.".
describe('produto sem conteúdo declarado avisa em vez de cobrar 1 em silêncio', () => {
  const presc = semComentarios(leiaFront('pages/SubModuloPrescricao.tsx'));

  test('o predicado existe e recusa multidose, unidade avulsa e dose vazia', () => {
    const fn = presc.slice(presc.indexOf('function faltaConteudoDaEmbalagem('));
    expect(fn).toBeTruthy();
    const corpo = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(corpo).toMatch(/if \(args\.produto\.multidose === true\) return false;/);
    expect(corpo).toMatch(/if \(conteudoDaEmbalagemProduto\(args\.produto\) != null\) return false;/);
    expect(corpo).toMatch(/un === 'un\.' \|\| un === 'un' \|\| un === 'unidade'/);
  });

  test('a tela avisa, e o aviso aponta o campo que resolve', () => {
    expect(presc).toMatch(/\{semConteudoDeclarado && \(/);
    expect(presc).toMatch(/Conteúdo da embalagem/);
    // ⚠️ AVISO, nunca bloqueio: prescrever não pode depender de arrumar o cadastro.
    expect(presc).not.toMatch(/semConteudoDeclarado[\s\S]{0,80}disabled/);
  });

  test('o campo que o aviso manda preencher existe no cadastro do produto', () => {
    expect(leiaFront('components/produtos/FormProduto.tsx')).toMatch(/Conteúdo da embalagem/);
  });
});
