// backend/src/__tests__/notaFiscalNormalizar.test.js
//
// `normalizar()` (services/notaFiscalService.js) deixou de confiar cegamente no
// `ehNotaFiscal` que o Gemini devolve.
//
// 🔴 MEDIDO AO VIVO em 2026-09-22, repetindo a MESMA chamada real ao Gemini com o
// MESMO cupom ("ORÇAMENTO — SEM VALOR FISCAL", loja GAMA BEZERRA): em 2 de 3
// tentativas o modelo devolveu `ehNotaFiscal: false` e AINDA ASSIM extraiu
// certinho o fornecedor (nome, endereço, bairro, cidade) e os dois itens com
// quantidade e valor. O modelo leu o documento — só errou o próprio comentário
// sobre o que acabou de fazer. Confiar cegamente nesse booleano fazia a tela
// dizer "não identifiquei uma compra" sobre um cupom que, na prática, tinha sido
// lido corretamente, e mandava a pessoa refotografar um documento perfeito.
//
// A regra agora: `ehNotaFiscal: false` só é aceito quando o modelo TAMBÉM não
// extraiu nada aproveitável (sem fornecedor.nome, ou sem item com valor). Havendo
// fornecedor + item com valor, a extração vence o sinalizador — não é "inventar
// valor" (§12, 26/08): o dado já estava na resposta do modelo, só o rótulo mentia.

// `notaFiscalService` importa `ai/geminiClient` (TypeScript) e `lib/prisma` só para
// montar a chamada de IA — `normalizar()` é função pura e não usa nenhum dos dois,
// mas o `require` do módulo os carrega. Mocks virtuais evitam o babel-jest tentar
// transpilar `.ts` (mesmo motivo dos mocks em `documentosCentral.test.js`).
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../ai', () => ({ MODULOS_IA: { PRODUTOS: 'PRODUTOS' } }), { virtual: true });
jest.mock('../ai/geminiClient', () => ({ gerarConteudo: jest.fn(), PROVEDOR: 'google', MODELO_PADRAO: 'gemini-3.1-flash-lite' }), { virtual: true });

const { normalizar } = require('../services/notaFiscalService');

const cupomReal = {
  ehNotaFiscal: false, // o modelo errou isto — ver o cabeçalho do arquivo
  numero: '29477',
  dataEmissao: '2026-08-05',
  fornecedor: {
    nome: 'GAMA BEZERRA PROD.VETERINARIOS',
    cnpj: null,
    cpf: null,
    telefone: null,
    email: null,
    cep: null,
    endereco: 'AVN BORGES DE MEDEIROS, 2225',
    bairro: 'PTE VILA HIPICA',
    cidade: 'LAGOA',
    estado: null,
  },
  itens: [
    { nome: 'OLEO LINHACA LITRO', tipo: 'medicamento', quantidade: 1, unidade: null, valorUnitario: 115, valorTotal: 115, lote: null, validade: null },
    { nome: 'POS RACING BOTUPHARMA', tipo: 'medicamento', quantidade: 2, unidade: null, valorUnitario: 55, valorTotal: 110, lote: null, validade: null },
  ],
};

describe('notaFiscalService.normalizar — rede de segurança contra o ehNotaFiscal', () => {
  test('promove para true o caso REAL medido: false do modelo + fornecedor e itens com valor', () => {
    const r = normalizar(cupomReal);
    expect(r.ehNotaFiscal).toBe(true);
    expect(r.fornecedor.nome).toBe('GAMA BEZERRA PROD.VETERINARIOS');
    expect(r.itens).toHaveLength(2);
    expect(r.itens[0].valorTotal).toBe(115);
  });

  test('recusa de verdade quando NÃO há fornecedor nem item com valor', () => {
    const r = normalizar({ ehNotaFiscal: false, numero: null, dataEmissao: null, fornecedor: {}, itens: [] });
    expect(r.ehNotaFiscal).toBe(false);
    expect(r.motivo).toMatch(/não foi possível identificar uma compra/i);
  });

  test('recusa quando há fornecedor mas NENHUM item tem valor (não promove por nome sozinho)', () => {
    const r = normalizar({
      ehNotaFiscal: false,
      fornecedor: { nome: 'Qualquer Loja' },
      itens: [{ nome: 'Item sem preço', quantidade: 1, valorUnitario: null, valorTotal: null }],
    });
    expect(r.ehNotaFiscal).toBe(false);
  });

  test('recusa quando há item com valor mas SEM nome de fornecedor', () => {
    const r = normalizar({
      ehNotaFiscal: false,
      fornecedor: { nome: null },
      itens: [{ nome: 'Item', quantidade: 1, valorUnitario: 10, valorTotal: 10 }],
    });
    expect(r.ehNotaFiscal).toBe(false);
  });

  test('caso comum continua intacto: ehNotaFiscal true do modelo passa direto', () => {
    const r = normalizar({
      ehNotaFiscal: true,
      numero: '123',
      dataEmissao: '2026-01-01',
      fornecedor: { nome: 'Fornecedor X' },
      itens: [{ nome: 'Item Y', quantidade: 1, valorUnitario: 50, valorTotal: 50 }],
    });
    expect(r.ehNotaFiscal).toBe(true);
    expect(r.numero).toBe('123');
  });

  test('resposta fora do formato (não-objeto) continua recusada com o motivo próprio', () => {
    expect(normalizar(null).motivo).toBe('A resposta não veio no formato esperado.');
    expect(normalizar('lixo').motivo).toBe('A resposta não veio no formato esperado.');
  });
});
