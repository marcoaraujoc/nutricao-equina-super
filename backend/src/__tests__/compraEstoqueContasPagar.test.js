'use strict';

/**
 * A COMPRA QUE ENTRA NO ESTOQUE VIRA CONTA A PAGAR (2026-09-19)
 *
 * 🔴 POR QUE ESTE GATE EXISTE — as regras abaixo quebram em SILÊNCIO, e no DINHEIRO:
 * o defeito só aparece quando alguém for pagar o fornecedor.
 *
 *   1. 🔴 `valor` DA LINHA É UNITÁRIO. Quem multiplica é `recalcularTotal`
 *      (`SUM(i.valor * i.quantidade)`) e a tela de Pagamentos (`it.valor *
 *      it.quantidade`). Mandar o TOTAL já multiplicado e a quantidade ao lado
 *      multiplica DUAS vezes — foi exatamente o que a farmácia fazia, e MEDIDO na
 *      base em 2026-09-19: uma compra de 10 × R$ 100 aparecia como R$ 10.000.
 *      Nada acusa: o número é plausível, e a conta fecha "certa" com o total errado.
 *
 *   2. 🔴 A QUANTIDADE É DE EMBALAGENS/FRASCOS, NUNCA O SALDO EM DOSES. Num produto
 *      multidose o saldo está no CONTEÚDO (3 frascos de 20 mL = 60), e usá-lo cru
 *      cobraria 60 frascos de quem entregou 3. É o "independente de doses" do pedido.
 *
 *   3. 🔴 O ELO. A entrada de estoque é o ÚNICO ponto em que a compra vira dívida.
 *      Removida a chamada, TUDO continua funcionando — o saldo sobe, a tela não acusa
 *      nada — e a clínica simplesmente para de saber o que deve ao fornecedor.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const lerFonte = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** Descarta comentários: um gate satisfeito pela própria documentação da regra é um
 *  gate que se aprende a ignorar. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Recorta o corpo de uma função pelo balanceamento de chaves.
 *
 * ⚠️ O `{` do CORPO vem depois do `)` que fecha os PARÂMETROS: as funções aqui
 * desestruturam um objeto na assinatura, e casar com o primeiro `{` depois do nome
 * recortaria a lista de parâmetros em vez do corpo — o gate passaria a olhar cinco
 * linhas e a aprovar qualquer coisa abaixo delas.
 */
const corpoDe = (src, assinatura) => {
  const ini = src.indexOf(assinatura);
  if (ini < 0) throw new Error('nao achei: ' + assinatura);
  // 1) fecha os parênteses da assinatura
  let par = 0, i = src.indexOf('(', ini);
  for (; i < src.length; i++) {
    if (src[i] === '(') par++;
    else if (src[i] === ')' && --par === 0) break;
  }
  // 2) o corpo começa no primeiro `{` depois disso
  let nivel = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) {
    if (src[j] === '{') nivel++;
    else if (src[j] === '}' && --nivel === 0) return src.slice(ini, j + 1);
  }
  throw new Error('corpo nao fechou: ' + assinatura);
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. A CONTA — valor unitário × quantidade de embalagens
// ─────────────────────────────────────────────────────────────────────────────
describe('quantas embalagens foram compradas (farmácia)', () => {
  // A função é pura e é ela que decide a QUANTIDADE da linha; exportada de propósito.
  const { embalagensCompradas } = require('../controllers/EstoqueController');

  it('usa a Qtd Produto quando ela vem informada', () => {
    expect(embalagensCompradas({ qtdEmbalagens: 10, qtdEstoque: 600, conteudoEmbalagem: 60 })).toBe(10);
  });

  it('🔴 sem Qtd Produto, DIVIDE o saldo pelo conteúdo — o saldo é doses, não frascos', () => {
    // 3 frascos de 20 mL: o saldo é 60 e a compra é de TRÊS embalagens.
    expect(embalagensCompradas({ qtdEmbalagens: null, qtdEstoque: 60, conteudoEmbalagem: 20 })).toBe(3);
  });

  it('sem conteúdo declarado (não-multidose), o saldo JÁ é a contagem de embalagens', () => {
    expect(embalagensCompradas({ qtdEmbalagens: null, qtdEstoque: 7, conteudoEmbalagem: null })).toBe(7);
    expect(embalagensCompradas({ qtdEmbalagens: 0,    qtdEstoque: 7, conteudoEmbalagem: 0 })).toBe(7);
  });

  it('entrada sem quantidade nenhuma não inventa embalagem', () => {
    expect(embalagensCompradas({ qtdEmbalagens: null, qtdEstoque: null, conteudoEmbalagem: 20 })).toBe(0);
  });
});

describe('🔴 o valor da linha é UNITÁRIO — multiplicar aqui cobra ao quadrado', () => {
  it('a farmácia passa o valor da EMBALAGEM, não o total da compra', () => {
    const fn = semComentarios(corpoDe(lerFonte('controllers/EstoqueController.js'),
      'async function lancarCompraDoFornecedor'));
    // valor = unitário; quantidade = embalagens. É o mesmo contrato dos outros três
    // chamadores de `lancarItem` (prescrição, vacina e prestador).
    expect(fn).toMatch(/valor:\s*Number\(valorEmbalagem\)/);
    expect(fn).toMatch(/quantidade:\s*embalagens/);
    // O total pré-multiplicado não pode voltar: era ele que dobrava a conta.
    expect(fn).not.toMatch(/const\s+total\s*=/);
    expect(fn).not.toMatch(/valor:\s*total/);
  });

  it('a vacina passa o valor do FRASCO × a quantidade de FRASCOS', () => {
    const fn = semComentarios(corpoDe(lerFonte('controllers/EstoqueVacinaController.js'),
      'async function lancarCompraDaVacina'));
    expect(fn).toMatch(/valor:\s*Number\(valorUnitario\)/);
    expect(fn).toMatch(/quantidade:\s*frascos/);
    // 🔴 `qtdTotal`/`qtdNovasDoses` são DOSES: usá-los cobraria 60 frascos de quem
    // entregou 3 num lote de 20 mL — o "independente de doses" do pedido.
    expect(fn).not.toMatch(/qtdTotal|qtdNovasDoses|dosesPorFrasco/);
  });

  it('a conta do mês é a SOMA de valor × quantidade — é isso que fecha o total', () => {
    const lib = semComentarios(lerFonte('lib/contasPagar.js'));
    expect(lib).toMatch(/SUM\(i\.valor \* i\.quantidade\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. O ELO — sem ele a dívida não nasce, e nada acusa
// ─────────────────────────────────────────────────────────────────────────────
describe('elos que não podem sumir', () => {
  it('a entrada de estoque da FARMÁCIA lança a compra nos dois caminhos', () => {
    const src = semComentarios(lerFonte('controllers/EstoqueController.js'));
    // Consolidação (soma no lote existente) E entrada nova: as duas são COMPRA.
    expect((src.match(/await lancarCompraDoFornecedor\(prisma, \{/g) || []).length).toBe(2);
    // O conteúdo da embalagem precisa chegar lá — é ele que converte saldo em frascos.
    expect((src.match(/conteudoEmbalagem:\s*conteudoEmb/g) || []).length).toBe(2);
  });

  it('a entrada de estoque da VACINA lança a compra nos dois caminhos', () => {
    const src = semComentarios(lerFonte('controllers/EstoqueVacinaController.js'));
    expect((src.match(/await lancarCompraDaVacina\(prisma, \{/g) || []).length).toBe(2);
  });

  it('a compra é lançada DEPOIS do commit, nunca dentro da transaction do estoque', () => {
    // A entrada é ato de ESTOQUE: ela não pode ser revertida porque a conta a pagar
    // falhou. Por isso o client é o `prisma`, não um `tx`.
    const casos = [
      ['controllers/EstoqueController.js',       'lancarCompraDoFornecedor'],
      ['controllers/EstoqueVacinaController.js', 'lancarCompraDaVacina'],
    ];
    for (const [arq, fn] of casos) {
      const src = semComentarios(lerFonte(arq));
      expect(src).not.toMatch(new RegExp(fn + '\\(tx,'));
    }
  });

  it('fornecedor de OUTRA empresa não vira dívida desta clínica', () => {
    // O id vem do CORPO da requisição: sem esta conferência, a conta a pagar nasceria
    // no nome de um fornecedor que a clínica não cadastrou.
    const casos = [
      ['controllers/EstoqueController.js',       'async function lancarCompraDoFornecedor'],
      ['controllers/EstoqueVacinaController.js', 'async function lancarCompraDaVacina'],
    ];
    for (const [arq, fn] of casos) {
      const corpo = semComentarios(corpoDe(lerFonte(arq), fn));
      expect(corpo).toMatch(/empresaId:\s*Number\(empresaId\)/);
      expect(corpo).toMatch(/if \(!fornecedor\) return null;/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. IDEMPOTÊNCIA — e por que a vacina é assimétrica
// ─────────────────────────────────────────────────────────────────────────────
describe('origem do lançamento', () => {
  it('a vacina NÃO repete o id do lote na consolidação', () => {
    // 🔴 A farmácia ancora a origem no MovimentoEstoque (um por COMPRA). A vacina não
    // tem tabela de movimento, então o id do LOTE se repetiria na consolidação: o
    // índice único parcial casaria no `ON CONFLICT` e a SEGUNDA compra do mesmo lote
    // seria descartada em silêncio — a clínica pagaria uma e deveria zero pela outra.
    const fn = semComentarios(corpoDe(lerFonte('controllers/EstoqueVacinaController.js'),
      'async function lancarCompraDaVacina'));
    expect(fn).toMatch(/origemId:\s*consolidado \? null :/);
    // A rastreabilidade fica de pé mesmo sem idempotência.
    expect(fn).toMatch(/origemTipo:\s*'ESTOQUE_VACINA_ENTRADA'/);
  });

  it('lançamento sem origem continua sendo aceito pelo índice parcial', () => {
    const lib = semComentarios(lerFonte('lib/contasPagar.js'));
    expect(lib).toMatch(/WHERE origem_tipo IS NOT NULL AND origem_id IS NOT NULL/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. FORNECEDOR NO LOTE DE VACINA — sem ele não há a quem dever
// ─────────────────────────────────────────────────────────────────────────────
describe('fornecedor e nota fiscal na entrada de vacina', () => {
  const src = semComentarios(lerFonte('controllers/EstoqueVacinaController.js'));

  it('o criar aceita fornecedor e nota fiscal do corpo', () => {
    expect(corpoDe(src, 'const criar = async')).toMatch(/fornecedorId,\s*\n\s*notaFiscal,/);
  });

  it('grava as colunas por SQL cru — o client pode não conhecê-las', () => {
    // As colunas são da migration 20261006000000: pelo client tipado, uma base ainda
    // não migrada derrubaria a ENTRADA DE VACINA inteira (§11).
    expect(src).toMatch(/produtoFornecedor\.gravarFornecedorNoLote\(prisma,/);
    const lib = semComentarios(lerFonte('lib/produtoFornecedor.js'));
    expect(lib).toMatch(/UPDATE schs2vet\.tb_lotes_vacina/);
    expect(lib).toMatch(/temColunasLote\(\)/);
  });

  it('a LISTAGEM devolve o fornecedor — senão a edição o apagaria em silêncio', () => {
    // Campo que existe no salvar e não é lido no abrir vira campo apagado: a lição do
    // `temposConsulta` (2026-07-28, parte 4).
    expect(src).toMatch(/produtoFornecedor\.fornecedoresDeLotes\(prisma, comTrilha\.map/);
  });

  it('editar o lote NÃO lança conta a pagar — corrigir cadastro não é comprar', () => {
    const fn = semComentarios(corpoDe(src, 'const atualizar = async'));
    expect(fn).not.toMatch(/lancarCompraDaVacina/);
    // `undefined` PRESERVA o gravado (PATCH parcial).
    expect(fn).toMatch(/fornecedorId !== undefined/);
  });

  it('a leitura em bloco nunca derruba a tela quando a coluna não existe', () => {
    const fn = semComentarios(corpoDe(lerFonte('lib/produtoFornecedor.js'),
      'async function fornecedoresDeLotes'));
    expect(fn).toMatch(/catch/);
    expect(fn).toMatch(/await temColunasLote\(\)\)\) return mapa;/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CARREGAR NOTA FISCAL no estoque de vacinas
// ─────────────────────────────────────────────────────────────────────────────
describe('leitura da nota no estoque de vacinas', () => {
  const rotas = semComentarios(lerFonte('routes/estoqueVacina.js'));

  it('usa o MESMO controller da farmácia — uma segunda leitura divergiria', () => {
    expect(rotas).toMatch(/NotaFiscalController\.ler/);
    expect(semComentarios(lerFonte('routes/farmacia.js'))).toMatch(/NotaFiscalController\.ler/);
  });

  it('gate de CRIAR: o resultado vira entrada e gasta a quota de IA da clínica', () => {
    expect(rotas).toMatch(/checkPermission\('vacina\.estoque\.criar', 'PROPRIO'\)[\s\S]{0,200}NotaFiscalController\.ler/);
  });

  it('a rota LITERAL vem antes de /:id — senão o Express a lê como um id', () => {
    const iLiteral = rotas.indexOf("'/documento-compra'");
    const iParam   = rotas.indexOf("'/:id'");
    expect(iLiteral).toBeGreaterThan(-1);
    expect(iParam).toBeGreaterThan(-1);
    expect(iLiteral).toBeLessThan(iParam);
  });

  it('tenantRls REENTRA depois do multer', () => {
    // O parsing do busboy se intercala entre o `authenticate` (que carimba o tenant) e
    // o controller, e pode fazer o AsyncLocalStorage não sobreviver até lá.
    expect(rotas).toMatch(/upload\.array\('paginas', MAX_PAGINAS\), tenantRls, NotaFiscalController\.ler/);
  });

  it('aceita só imagem, validando EXTENSÃO e mimetype', () => {
    // Validar só o mimetype aceita um .svg renomeado, e SVG é HTML executável.
    expect(rotas).toMatch(/path\.extname\(file\.originalname\)/);
    expect(rotas).toMatch(/permitido\.test\(file\.mimetype\)/);
  });
});
