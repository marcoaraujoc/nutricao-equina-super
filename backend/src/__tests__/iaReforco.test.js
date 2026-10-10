// REFORÇO da chamada de IA (hedged request) — ai/geminiClient.ts#gerarComReforco.
//
// A Memória Clínica levava de 3 a 23 s com o MESMO prompt: a geração custa ~3 s e o
// resto é fila do provedor. O reforço dispara uma 2ª chamada idêntica quando a 1ª
// passa do tempo normal e fica com a que responder primeiro.
//
// O geminiClient é TypeScript e o jest deste projeto não o transpila: o arquivo é
// transpilado aqui com `ts.transpileModule` e executado com `fetch` falso, para o
// teste exercitar o código REAL, não uma cópia dele.
'use strict';

const fs   = require('fs');
const path = require('path');
const ts   = require('typescript');

function carregarCliente() {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'ai', 'geminiClient.ts'), 'utf8');
  const { outputText } = ts.transpileModule(fonte, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require);
  return mod.exports;
}

const resposta = (texto) => ({
  ok: true,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: texto }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  }),
});

// fetch falso: cada chamada recebe o roteiro da vez — { apos: ms, texto } ou { apos, erro }.
// Respeita o AbortSignal, como o fetch de verdade.
function fetchRoteirizado(roteiro) {
  const chamadas = [];
  const fn = (url, init) => {
    const passo = roteiro[chamadas.length];
    chamadas.push({ abortada: false });
    const registro = chamadas[chamadas.length - 1];
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        if (passo.erro) resolve({ ok: false, status: passo.erro, text: async () => 'falhou' });
        else resolve(resposta(passo.texto));
      }, passo.apos);
      init.signal.addEventListener('abort', () => {
        registro.abortada = true;
        clearTimeout(t);
        const e = new Error('aborted'); e.name = 'AbortError';
        reject(e);
      });
    });
  };
  fn.chamadas = chamadas;
  return fn;
}

describe('gerarComReforco — a chamada presa na fila não segura a pessoa', () => {
  const fetchOriginal = global.fetch;
  beforeAll(() => { process.env.GEMINI_API_KEY = 'teste'; });
  afterEach(() => { global.fetch = fetchOriginal; });

  test('🔴 a 1ª presa: o reforço nasce e VENCE, e a presa é cancelada', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 500, texto: 'lenta' }, { apos: 20, texto: 'reforco' }]);
    const t0 = Date.now();
    const r = await gerarComReforco([{ text: 'x' }], { reforcoAposMs: 50 });
    expect(r.text).toBe('reforco');
    expect(Date.now() - t0).toBeLessThan(300);
    expect(global.fetch.chamadas).toHaveLength(2);
    expect(global.fetch.chamadas[0].abortada).toBe(true);
  });

  test('a 1ª responde no tempo normal: NENHUM reforço é disparado (custo zero)', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 10, texto: 'rapida' }]);
    const r = await gerarComReforco([{ text: 'x' }], { reforcoAposMs: 100 });
    expect(r.text).toBe('rapida');
    await new Promise(res => setTimeout(res, 150));
    expect(global.fetch.chamadas).toHaveLength(1);
  });

  test('a 1ª ainda vence se terminar antes do reforço — e o reforço é cancelado', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 80, texto: 'primeira' }, { apos: 500, texto: 'reforco' }]);
    const r = await gerarComReforco([{ text: 'x' }], { reforcoAposMs: 30 });
    expect(r.text).toBe('primeira');
    expect(global.fetch.chamadas[1].abortada).toBe(true);
  });

  test('falha ANTES do reforço é devolvida (não vira retentativa disfarçada)', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 5, erro: 400 }, { apos: 5, texto: 'nunca' }]);
    await expect(gerarComReforco([{ text: 'x' }], { reforcoAposMs: 100 })).rejects.toThrow('400');
    await new Promise(res => setTimeout(res, 150));
    expect(global.fetch.chamadas).toHaveLength(1);
  });

  test('com as duas no ar, a falha de uma espera a outra', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 200, texto: 'primeira' }, { apos: 5, erro: 503 }]);
    const r = await gerarComReforco([{ text: 'x' }], { reforcoAposMs: 20 });
    expect(r.text).toBe('primeira');
  });

  test('as duas falhando, vale o erro da 1ª', async () => {
    const { gerarComReforco } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 60, erro: 503 }, { apos: 5, erro: 500 }]);
    await expect(gerarComReforco([{ text: 'x' }], { reforcoAposMs: 20 })).rejects.toThrow('503');
  });

  test('gerarTexto sem reforcoAposMs segue o caminho de sempre (uma chamada)', async () => {
    const { gerarTexto } = carregarCliente();
    global.fetch = fetchRoteirizado([{ apos: 60, texto: 'unica' }]);
    const r = await gerarTexto('x');
    expect(r.text).toBe('unica');
    expect(global.fetch.chamadas).toHaveLength(1);
  });
});

describe('gate — a Memória Clínica usa o reforço', () => {
  test('resumoAtendimentoService passa reforcoAposMs ao callAI e o provider o repassa', () => {
    const svc = fs.readFileSync(path.join(__dirname, '..', 'services', 'resumoAtendimentoService.js'), 'utf8');
    const prov = fs.readFileSync(path.join(__dirname, '..', 'ai', 'providers', 'GeminiProvider.ts'), 'utf8');
    expect(svc).toMatch(/reforcoAposMs:\s*\d+/);
    expect(prov).toMatch(/reforcoAposMs:\s*opts\.reforcoAposMs/);
  });
});
