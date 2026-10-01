'use strict';

/**
 * EXAME DE IMAGEM: VALOR ÚNICO × POR IMAGEM (2026-09-30).
 *
 * 🔴 O DEFEITO: pedido de radiografia com "Quantidade de imagens" = 3 e valor de
 * R$ 80 cadastrado no procedimento saía na fatura por R$ 80 — a quantidade nunca
 * entrava no preço. Agora o procedimento diz se o valor é do exame inteiro ou de UMA
 * imagem, e no segundo caso o pedido multiplica.
 *
 * Quebra em SILÊNCIO e no DINHEIRO: a fatura continua sendo gerada, só com o valor
 * de uma imagem. Por isso o gate cobre o cálculo E os elos (criação, recibo do
 * prestador, edição da quantidade, copy-on-write).
 */

const mockDb = {
  // nome (minúsculo) → { id, valorVenda, porImagem }
  procs: new Map(),
  // procedimentoId → valor padrão da empresa
  padrao: new Map(),
};

function mockConsulta(sql, ...args) {
  if (sql.includes('information_schema')) return [{ '?column?': 1 }];
  if (sql.includes('tb_procedimento_valores_empresa')) {
    const v = mockDb.padrao.get(Number(args[1]));
    return v == null ? [] : [{ valor: v }];
  }
  if (sql.includes('cobranca_por_imagem FROM')) {
    return [...mockDb.procs.values()]
      .filter(p => args.map(Number).includes(p.id))
      .map(p => ({ id: p.id, cobranca_por_imagem: p.porImagem }));
  }
  if (sql.includes('tb_procedimentos_vet')) {
    const p = mockDb.procs.get(String(args[1]).trim().toLowerCase());
    return p ? [{ id: p.id, valorVenda: p.valorVenda }] : [];
  }
  return [];
}

const fakeClient = { $queryRawUnsafe: async (sql, ...args) => mockConsulta(sql, ...args) };

jest.mock('../lib/prisma', () => ({
  default: { $queryRawUnsafe: async (sql, ...args) => mockConsulta(sql, ...args) },
}), { virtual: true });

jest.mock('../lib/procedimentoPrestador', () => ({
  resolverValoresPorNome: async (_c, _e, nome, prestadorId) =>
    (prestadorId === 7 && nome === 'Rx Membro')
      ? { valorCliente: null, valorPrestador: 30 }
      : { valorCliente: null, valorPrestador: null },
}));

const fs   = require('fs');
const path = require('path');
const exameValor = require('../lib/exameImagemValor');

const lerFonte = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => {
  mockDb.procs = new Map([
    ['rx membro',      { id: 1, valorVenda: null, porImagem: true  }],
    ['us abdominal',   { id: 2, valorVenda: null, porImagem: false }],
    ['rx coluna',      { id: 3, valorVenda: 50,   porImagem: true  }],
  ]);
  mockDb.padrao = new Map([[1, 80], [2, 120]]);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('itensDoPedido — a quantidade é do GRUPO', () => {
  it('cada exame leva a quantidade do SEU grupo, não a soma do pedido', () => {
    const itens = exameValor.itensDoPedido({
      tipo: 'Imagem', qtdAmostra: 5,
      grupos: [
        { exames: ['Rx Membro'], qtdAmostra: 3 },
        { exames: ['US Abdominal', 'Rx Coluna'], qtdAmostra: 2 },
      ],
    });
    expect(itens).toEqual([
      { nome: 'Rx Membro', qtd: 3 },
      { nome: 'US Abdominal', qtd: 2 },
      { nome: 'Rx Coluna', qtd: 2 },
    ]);
  });

  it('sem grupos, usa os nomes com a quantidade do pedido', () => {
    expect(exameValor.itensDoPedido({ tipo: 'Imagem', descricao: 'Rx Membro', qtdAmostra: 3 }))
      .toEqual([{ nome: 'Rx Membro', qtd: 3 }]);
  });

  it('fora de Imagem a quantidade é de AMOSTRAS e não entra no preço', () => {
    expect(exameValor.itensDoPedido({ tipo: 'Laboratorial', nomes: ['Hemograma'], qtdAmostra: 4 }))
      .toEqual([{ nome: 'Hemograma', qtd: 1 }]);
  });

  it('quantidade inválida vira 1', () => {
    expect(exameValor.itensDoPedido({ tipo: 'Imagem', nomes: ['Rx Membro'], qtdAmostra: 0 }))
      .toEqual([{ nome: 'Rx Membro', qtd: 1 }]);
  });

  it('lê os grupos gravados na observação do pedido', () => {
    const obs = JSON.stringify({ grupos: [{ exames: ['Rx Membro'], qtdAmostra: 3 }] });
    expect(exameValor.gruposDaObservacao(obs)).toEqual([{ exames: ['Rx Membro'], qtdAmostra: 3 }]);
    expect(exameValor.gruposDaObservacao('não é json')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('precoDoPedido — valor por imagem multiplica', () => {
  it('🔴 o caso relatado: R$ 80 por imagem × 3 imagens = R$ 240, linha "80 × 3"', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, [{ nome: 'Rx Membro', qtd: 3 }]);
    expect(r.valorCliente).toBe(240);
    expect(r.linha).toEqual({ valor: 80, quantidade: 3 });
    expect(r.porImagem).toBe(true);
  });

  it('valor ÚNICO ignora a quantidade, como sempre ignorou', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, [{ nome: 'US Abdominal', qtd: 3 }]);
    expect(r.valorCliente).toBe(120);
    expect(r.linha).toEqual({ valor: 120, quantidade: 1 });
  });

  it('vários exames: soma cada um pela sua regra e a linha sai como TOTAL × 1', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, [
      { nome: 'Rx Membro', qtd: 3 },    // 80 × 3
      { nome: 'US Abdominal', qtd: 3 }, // 120 único
      { nome: 'Rx Coluna', qtd: 2 },    // 50 (catálogo) × 2
    ]);
    expect(r.valorCliente).toBe(240 + 120 + 100);
    expect(r.linha).toEqual({ valor: 460, quantidade: 1 });
  });

  it('o valor do PRESTADOR também é por imagem', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, [{ nome: 'Rx Membro', qtd: 3 }], 7);
    expect(r.valorPrestador).toBe(90);
  });

  it('nome solto (string) continua valendo qtd 1 — compatível com quem já chamava assim', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, ['Rx Membro']);
    expect(r.valorCliente).toBe(80);
  });

  it('null continua não sendo zero', async () => {
    const r = await exameValor.precoDoPedido(fakeClient, 58, [{ nome: 'Inexistente', qtd: 3 }]);
    expect(r.valorCliente).toBeNull();
    expect(r.linha).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('elos que somem em silêncio — varredura de código', () => {
  const exame   = semComentarios(lerFonte('controllers/ExameClinicoController.js'));
  const fatura  = semComentarios(lerFonte('lib/faturaUtils.js'));
  const cadastro = semComentarios(lerFonte('controllers/ProcedimentoCadastroController.js'));
  const fork    = semComentarios(lerFonte('lib/catalogoProcedimento.js'));

  it('a criação do pedido passa os GRUPOS (quantidade por grupo) e a linha da fatura', () => {
    expect(exame).toMatch(/itensDoPedido\(\{\s*tipo, grupos, nomes: examesNomes, descricao, qtdAmostra/);
    expect(exame).toMatch(/\{ \.\.\.criado, valorCobrado, linhaFatura \}/);
  });

  it('o recibo do prestador usa a quantidade de imagens', () => {
    const recibo = exame.slice(exame.indexOf('async function registrarPagamentoPrestadorDoExame'));
    expect(recibo).toMatch(/exameValor\.itensDoPedido\(/);
  });

  it('editar a quantidade de imagens repreça o exame', () => {
    expect(exame).toMatch(/item\.tipo === 'Imagem'[\s\S]{0,120}reprecificarQtdImagens\(/);
    expect(exame).toMatch(/reprecificarExameNaFatura\(tx, item\.id, linha\)/);
  });

  it('a fatura fechada/paga RECUSA a reprecificação', () => {
    const fn = fatura.slice(fatura.indexOf('async function reprecificarExameNaFatura'));
    expect(fn).toMatch(/FaturaPagaError/);
    expect(fn).toMatch(/faturaEditavel\(item\.fatura\.status\)/);
    expect(fn).toMatch(/estadoDoItem\(tx, item\.id\)/);
    // invariante: quantidade da linha = soma das contribuições
    expect(fn).toMatch(/tb_fatura_item_origens SET quantidade/);
  });

  it('lancarExameNaFatura respeita a linha "valor × N"', () => {
    expect(fatura).toMatch(/exame\.linhaFatura/);
    expect(fatura).toMatch(/quantidade:\s*linha\.quantidade/);
  });

  it('o cadastro grava a cobrança ANTES do valor (o valor vai para o id final)', () => {
    for (const fn of ['const criarProprio', 'const atualizarProprio']) {
      const corpo = cadastro.slice(cadastro.indexOf(fn));
      const iCob = corpo.indexOf('aplicarCobrancaPorImagem(');
      const iVal = corpo.indexOf('gravarValorDaEmpresa(');
      expect(iCob).toBeGreaterThan(-1);
      expect(iCob).toBeLessThan(iVal);
    }
  });

  it('item do sistema passa pelo copy-on-write, e a cópia herda a cobrança', () => {
    const fn = cadastro.slice(cadastro.indexOf('async function aplicarCobrancaPorImagem'));
    expect(fn).toMatch(/garantirCopiaProcedimento\(tx, base, empresaId\)/);
    expect(fork).toMatch(/copiarCobrancaPorImagem\(tx, base\.id, copia\.id\)/);
  });
});
