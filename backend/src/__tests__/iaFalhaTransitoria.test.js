// backend/src/__tests__/iaFalhaTransitoria.test.js
//
// Duas regras que só aparecem quando o provedor de IA está fora do ar — e é
// justamente aí que elas precisam funcionar:
//
//   1. `modelo` NUNCA pode ser `undefined` no log de uso. Quando a chamada falha,
//      não existe resposta de onde tirar o modelo, e `logAiUsage` morria com
//      "Argument `modelo` is missing" — perdendo o registro DA FALHA que se quer
//      investigar. Aconteceu de verdade ao ler um laudo durante um 503 do Gemini.
//   2. 503 "high demand" é falha do MINUTO, não do arquivo: uma retentativa. Mas
//      SÓ para falha transitória — erro de conteúdo não melhora repetindo, e
//      insistir dobra a espera antes de cair no mesmo lugar.

const fs   = require('fs');
const path = require('path');

const { comRetentativa, ehFalhaTransitoria } = require('../ai/retentativa');

const servico = (nome) =>
  fs.readFileSync(path.join(__dirname, '..', 'services', nome), 'utf8');

describe('Falha transitória do provedor', () => {
  test('reconhece o 503 de alta demanda tal como o geminiClient o escreve', () => {
    expect(ehFalhaTransitoria(new Error(
      'Gemini API error 503: {"error":{"code":503,"message":"This model is currently ' +
      'experiencing high demand.","status":"UNAVAILABLE"}}'))).toBe(true);
  });

  test('reconhece 429, 500, 502 e 504', () => {
    for (const cod of [429, 500, 502, 504]) {
      expect(ehFalhaTransitoria(new Error(`Gemini API error ${cod}: falhou`))).toBe(true);
    }
  });

  test('NÃO trata erro de conteúdo como transitório', () => {
    expect(ehFalhaTransitoria(new Error('Gemini API error 400: prompt inválido'))).toBe(false);
    expect(ehFalhaTransitoria(new Error('Modelo retornou resposta em formato inválido'))).toBe(false);
    expect(ehFalhaTransitoria(undefined)).toBe(false);
  });

  test('número solto no corpo não passa por código de erro', () => {
    // Sem a âncora "error ", um id "1429" na mensagem viraria retentativa à toa.
    expect(ehFalhaTransitoria(new Error('Requisição 1429 não encontrada'))).toBe(false);
  });
});

describe('comRetentativa', () => {
  test('não repete quando a primeira tentativa passa', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(comRetentativa(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('repete UMA vez na falha transitória e devolve o resultado da segunda', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Gemini API error 503: high demand'))
      .mockResolvedValueOnce('na segunda');
    await expect(comRetentativa(fn)).resolves.toBe('na segunda');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('falhando as duas vezes, propaga o erro — não engole a falha', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Gemini API error 503: high demand'));
    await expect(comRetentativa(fn)).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('erro de conteúdo NÃO é repetido', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Gemini API error 400: prompt inválido'));
    await expect(comRetentativa(fn)).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── Gate estrutural ────────────────────────────────────────────────────────────
// O modo de reintroduzir o defeito é escrever `let modelo;` num serviço novo que
// logue uso de IA — e o sintoma só aparece quando o provedor cai.
describe('Nenhum serviço de IA loga uso com `modelo` indefinido', () => {
  const COM_LOG_MANUAL = [
    'exameParserService.js',
    'documentoConversaoService.js',
    'composicaoParserService.js',
  ];

  test.each(COM_LOG_MANUAL)('%s inicializa modelo com MODELO_PADRAO', (nome) => {
    const src = servico(nome);
    expect(src).toMatch(/let modelo = MODELO_PADRAO;/);
    expect(src).not.toMatch(/let modelo;/);
  });

  test.each(['exameParserService.js', 'documentoConversaoService.js'])(
    '%s protege a chamada multimodal com retentativa', (nome) => {
      expect(servico(nome)).toMatch(/comRetentativa\(\(\) => gerarConteudo\(/);
    });

  test('a regra da retentativa mora em UM lugar só', () => {
    // Ela nasceu duplicada em documentoConversaoService; duas cópias divergiriam na
    // primeira vez que o provedor mudasse o texto do erro.
    for (const nome of COM_LOG_MANUAL) {
      expect(servico(nome)).not.toMatch(/async function comRetentativa/);
    }
  });
});
