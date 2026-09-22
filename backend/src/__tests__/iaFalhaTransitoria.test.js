// backend/src/__tests__/iaFalhaTransitoria.test.js
//
// Duas regras que só aparecem quando o provedor de IA está fora do ar — e é
// justamente aí que elas precisam funcionar:
//
//   1. `modelo` NUNCA pode ser `undefined` no log de uso. Quando a chamada falha,
//      não existe resposta de onde tirar o modelo, e `logAiUsage` morria com
//      "Argument `modelo` is missing" — perdendo o registro DA FALHA que se quer
//      investigar. Aconteceu de verdade ao ler um laudo durante um 503 do Gemini.
//   2. 503 "high demand" é falha do MINUTO, não do arquivo: retenta. Mas SÓ para
//      falha transitória — erro de conteúdo não melhora repetindo, e insistir
//      multiplica a espera antes de cair no mesmo lugar.
//   3. A mensagem que vai à TELA tem de apontar a causa CERTA: "espere um pouco" e
//      "troque a foto" são ações diferentes, e mandar a errada custa o trabalho de
//      refazer um documento que estava correto.
//
// ⚠️ Os casos de "repete UMA vez" foram INVERTIDOS em 2026-09-19 (de 2 chamadas para
// 3): o 503 medido em produção (log 517, 91,8 s) mostrou que a segunda tentativa, a
// 1,5 s fixos da primeira, cai no mesmo pico de demanda. A regra que CONTINUA valendo
// — e que os testes travam — é que erro de CONTEÚDO nunca é repetido.

const fs   = require('fs');
const path = require('path');

const { comRetentativa, ehFalhaTransitoria, TENTATIVAS } = require('../ai/retentativa');

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

  test('o timeout do NOSSO lado conta como falha do provedor', () => {
    // O `AbortSignal.timeout` do geminiClient é o mesmo evento do 503, visto do outro
    // lado do fio: o provedor parou de responder. Sem isto, a chamada que estourou o
    // teto não seria repetida e a pessoa levaria a falha na primeira demora.
    const t = new Error('Gemini API timeout: o provedor demorou demais para responder (60000ms, modelo x)');
    t.name = 'TimeoutError';
    expect(ehFalhaTransitoria(t)).toBe(true);

    const abortado = new Error('The operation was aborted');
    abortado.name = 'AbortError';
    expect(ehFalhaTransitoria(abortado)).toBe(true);
  });
});

describe('comRetentativa', () => {
  // A espera real (1,5 s → 3 s, com jitter) passa dos 5 s de teto do jest. O spy
  // registra QUANTO seria esperado e dorme 0 — o comportamento é verificado sem que
  // a suíte pague a espera. ⚠️ Sem ele o teste não fica lento, fica VERMELHO.
  let esperas = [];
  beforeEach(() => {
    esperas = [];
    const real = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation((cb, ms) => { esperas.push(ms); return real(cb, 0); });
  });
  afterEach(() => { global.setTimeout.mockRestore(); });

  test('não repete quando a primeira tentativa passa', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(comRetentativa(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('repete na falha transitória e devolve o resultado da segunda', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Gemini API error 503: high demand'))
      .mockResolvedValueOnce('na segunda');
    await expect(comRetentativa(fn)).resolves.toBe('na segunda');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('o 503 que persiste ganha uma TERCEIRA chance', async () => {
    // O caso medido: a 2ª tentativa, a 1,5 s da 1ª, cai no mesmo pico de demanda.
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('Gemini API error 503: high demand'))
      .mockRejectedValueOnce(new Error('Gemini API error 503: high demand'))
      .mockResolvedValueOnce('na terceira');
    await expect(comRetentativa(fn)).resolves.toBe('na terceira');
    expect(fn).toHaveBeenCalledTimes(TENTATIVAS);
  });

  test('esgotadas as tentativas, propaga o erro — não engole a falha', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Gemini API error 503: high demand'));
    await expect(comRetentativa(fn)).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(TENTATIVAS);
  });

  test('a espera CRESCE entre as tentativas', async () => {
    // Espera fixa devolve a chamada ao mesmo pico. Sem isto, a 3ª tentativa não
    // acrescentaria nada à 2ª — o defeito de 2026-09-19 continuaria, só que mais caro.
    const fn = jest.fn().mockRejectedValue(new Error('Gemini API error 503: high demand'));
    await expect(comRetentativa(fn)).rejects.toThrow('503');
    expect(esperas).toHaveLength(TENTATIVAS - 1);
    expect(esperas[1]).toBeGreaterThan(esperas[0]);
  });

  test('ORÇAMENTO: não começa tentativa nova depois do teto de tempo', async () => {
    // Quem espera é uma PESSOA, e o front desiste em 180 s. Com o provedor LENTO
    // (o 503 medido levou ~45 s para chegar), insistir três vezes estouraria a
    // paciência antes do provedor se recuperar.
    // ⚠️ `setTimeout` está mockado para dormir 0, então o tempo tem de vir da PRÓPRIA
    // função: cada tentativa gasta 30 ms de relógio de verdade.
    const fn = jest.fn().mockImplementation(async () => {
      const ate = Date.now() + 30;
      while (Date.now() < ate) { /* queima relógio sem depender de timer */ }
      throw new Error('Gemini API error 503: high demand');
    });
    await expect(comRetentativa(fn, { orcamentoMs: 20 })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(1); // a 1ª já estourou o orçamento
  });

  test('erro de conteúdo NÃO é repetido', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('Gemini API error 400: prompt inválido'));
    await expect(comRetentativa(fn)).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── A mensagem que chega à tela ────────────────────────────────────────────────
// O defeito relatado em 2026-09-19 não foi a falha em si (o provedor cai mesmo): foi
// a tela dizer "confira se a foto está legível" sobre um cupom que estava perfeito e
// já tinha sido lido com sucesso minutos antes.
describe('NotaFiscalController distingue provedor fora do ar de documento ilegível', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'NotaFiscalController.js'), 'utf8');

  test('a mensagem é escolhida pela falha real, não fixa', () => {
    expect(src).toMatch(/ehFalhaTransitoria/);
    expect(src).toMatch(/motivo: motivoDaFalha\(err\)/);
  });

  test('sobrecarga do provedor NÃO manda conferir o documento', () => {
    const fn = src.slice(src.indexOf('function motivoDaFalha'));
    const ateORetorno = fn.slice(0, fn.indexOf('return \'Não foi possível ler'));
    expect(ateORetorno).toMatch(/sobrecarregado/i);
    expect(ateORetorno).not.toMatch(/leg[íi]vel/i);
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
    // Entrou em 2026-09-19: ele já seguia as duas regras, mas estava FORA do gate —
    // e foi justamente o serviço em que o 503 apareceu para o usuário.
    'notaFiscalService.js',
  ];

  test.each(COM_LOG_MANUAL)('%s inicializa modelo com MODELO_PADRAO', (nome) => {
    const src = servico(nome);
    expect(src).toMatch(/let modelo = MODELO_PADRAO;/);
    expect(src).not.toMatch(/let modelo;/);
  });

  test.each(['exameParserService.js', 'documentoConversaoService.js', 'notaFiscalService.js'])(
    '%s protege a chamada multimodal com retentativa', (nome) => {
      expect(servico(nome)).toMatch(/comRetentativa\(\(\) => gerarConteudo\(/);
    });

  test('o cliente do Gemini tem teto por chamada', () => {
    // Sem `AbortSignal.timeout` o `fetch` fica pendurado enquanto o provedor não
    // responder — e foi assim que uma leitura de 12 s virou 91,8 s de espera.
    const cli = fs.readFileSync(path.join(__dirname, '..', 'ai', 'geminiClient.ts'), 'utf8');
    expect(cli).toMatch(/AbortSignal\.timeout/);
    expect(cli).toMatch(/TIMEOUT_MS/);
  });

  test('a regra da retentativa mora em UM lugar só', () => {
    // Ela nasceu duplicada em documentoConversaoService; duas cópias divergiriam na
    // primeira vez que o provedor mudasse o texto do erro.
    for (const nome of COM_LOG_MANUAL) {
      expect(servico(nome)).not.toMatch(/async function comRetentativa/);
    }
  });
});
