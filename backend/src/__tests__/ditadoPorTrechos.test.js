// backend/src/__tests__/ditadoPorTrechos.test.js
//
// DITADO DA EVOLUÇÃO POR TRECHOS — a fala não se perde quando a internet cai.
//
// 🔴 O DEFEITO (2026-10-10): no celular (e no notebook sem internet) a gravação inteira
// ficava na MEMÓRIA e só ia ao servidor quando a pessoa parava. Falha no envio, aba
// fechada pelo sistema ou página recarregada jogavam fora minutos de fala — o `catch`
// mostrava um erro e o áudio sumia.
//
// Agora a fala é cortada em trechos, cada trecho é gravado no aparelho (IndexedDB)
// ENQUANTO é falado e só sai de lá depois que o texto dele entrou no campo.
//
// O que este gate trava, porque quebra EM SILÊNCIO:
//   1. erro de REDE espera a conexão — nunca vira "erro" (que pararia de tentar);
//   2. o trecho descartado (formulário zerado) não ressuscita quando a transcrição volta;
//   3. a ordem do texto é a ordem da fala;
//   4. a tela não volta a juntar a gravação inteira em memória;
//   5. Salvar/Finalizar esperam a fala pendente virar texto;
//   6. o Cancelar com fala gravada não para o gravador antes de fechar (isso gravaria o
//      último trecho DEPOIS do descarte, e ele voltaria na próxima abertura).
//
// Parte EXECUTA o código real do front (transpilado), parte é varredura estrutural —
// o projeto não tem runner de componente React.
'use strict';

const fs   = require('fs');
const path = require('path');
const ts   = require('typescript');

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const HOOK  = fs.readFileSync(path.join(FRONT, 'hooks', 'useTranscricaoPorTrechos.ts'), 'utf8');
const STORE = fs.readFileSync(path.join(FRONT, 'services', 'trechosTranscricaoStore.ts'), 'utf8');
const TELA  = fs.readFileSync(path.join(FRONT, 'pages', 'SubModuloEvolucao.tsx'), 'utf8');

function semComentarios(texto) {
  return texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function transpilar(src) {
  return ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

/** Corpo de uma função/const de nível de módulo, pelo nome. */
function funcaoDoModulo(fonte, nome) {
  const sf = ts.createSourceFile('x.ts', fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === nome) return st.getText(sf);
  }
  throw new Error(`função ${nome} ausente`);
}

/** Trecho de código de uma função interna do hook (const nome = useCallback(...)). */
function blocoInterno(fonte, nome) {
  const ini = fonte.indexOf(`const ${nome} = useCallback(`);
  if (ini < 0) throw new Error(`${nome} ausente no hook`);
  const fim = fonte.indexOf('\n  }, [', ini);
  return fonte.slice(ini, fim);
}

// ─── 1. Classificação do resultado do envio (executa o código real) ─────────────

function carregarTranscrever({ online, post, whisperPronto = false }) {
  const src = [
    funcaoDoModulo(HOOK, 'extensaoDoAudio'),
    funcaoDoModulo(HOOK, 'transcrever').replace(/^async function/, 'exports.transcrever = async function'),
  ].join('\n\n');
  const mod = {};
  new Function('exports', 'api', 'navigator', 'modeloPronto', 'transcreverOffline', transpilar(src))(
    mod,
    { post },
    { onLine: online },
    () => whisperPronto,
    async () => 'texto offline',
  );
  return mod.transcrever;
}

const trecho = { dados: new ArrayBuffer(8), mime: 'audio/webm;codecs=opus' };
const erroHttp = (status, mensagem) => Object.assign(new Error('x'), {
  response: { status, data: mensagem ? { mensagem } : {} },
});

describe('Envio de um trecho: o que espera, o que repete, o que desiste', () => {
  it('sucesso devolve o texto', async () => {
    const t = carregarTranscrever({ online: true, post: async () => ({ data: { dados: { texto: 'febre há dois dias' } } }) });
    expect(await t(trecho)).toEqual({ tipo: 'ok', texto: 'febre há dois dias' });
  });

  it('🔴 queda de rede (sem resposta) ESPERA a conexão — nunca vira erro', async () => {
    const t = carregarTranscrever({ online: true, post: async () => { throw new Error('Network Error'); } });
    expect(await t(trecho)).toEqual({ tipo: 'esperar' });
  });

  it('navegador offline sem o Whisper carregado espera, sem tentar o servidor', async () => {
    const post = jest.fn();
    const t = carregarTranscrever({ online: false, post });
    expect(await t(trecho)).toEqual({ tipo: 'esperar' });
    expect(post).not.toHaveBeenCalled();
  });

  it('offline com o Whisper JÁ carregado transcreve no aparelho', async () => {
    const t = carregarTranscrever({ online: false, post: jest.fn(), whisperPronto: true });
    expect(await t(trecho)).toEqual({ tipo: 'ok', texto: 'texto offline' });
  });

  it.each([500, 502, 504, 524, 429, 408])('HTTP %i é falha do servidor: repete depois', async (status) => {
    const t = carregarTranscrever({ online: true, post: async () => { throw erroHttp(status); } });
    expect((await t(trecho)).tipo).toBe('falha');
  });

  it('401 espera (a sessão é renovada pelo interceptor)', async () => {
    const t = carregarTranscrever({ online: true, post: async () => { throw erroHttp(401); } });
    expect(await t(trecho)).toEqual({ tipo: 'esperar' });
  });

  it('4xx do servidor é recusa definitiva, com o motivo dele', async () => {
    const t = carregarTranscrever({ online: true, post: async () => { throw erroHttp(415, 'Tipo de arquivo não suportado'); } });
    expect(await t(trecho)).toEqual({ tipo: 'definitivo', mensagem: 'Tipo de arquivo não suportado' });
  });

  it('o arquivo vai com a extensão do formato gravado (o servidor converte por ela)', async () => {
    let nome;
    const t = carregarTranscrever({
      online: true,
      post: async (_url, fd) => { nome = fd.get('audio').name; return { data: { dados: { texto: '' } } }; },
    });
    await t({ dados: new ArrayBuffer(8), mime: 'audio/mp4' });
    expect(nome).toBe('trecho.m4a');
  });
});

// ─── 2. Store: ordem e não-ressurreição (executa o store real, sem IndexedDB) ────

function carregarStore() {
  const mod = {};
  // Sem `indexedDB` no Node: o store cai no fallback em memória — o mesmo caminho da
  // aba privada antiga. A lógica de ordem e de "só atualiza se existir" é a mesma.
  new Function('exports', transpilar(STORE))(mod);
  return mod;
}

const novoTrecho = (id, ordem, seq, extra = {}) => ({
  id, chave: 'ev:1:10:novo', sessao: 's', ordem, seq, dados: new ArrayBuffer(1),
  mime: 'audio/webm', status: 'pendente', tentativas: 0, criadoEm: Date.now(), ...extra,
});

describe('Trechos guardados no aparelho', () => {
  it('lista na ordem da fala (instante do início, depois a sequência)', async () => {
    const s = carregarStore();
    await s.salvarTrecho(novoTrecho('c', 2000, 3));
    await s.salvarTrecho(novoTrecho('a', 1000, 1));
    await s.salvarTrecho(novoTrecho('b', 1000, 2));
    expect((await s.listarTrechos('ev:1:10:novo')).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('🔴 transcrição que volta DEPOIS do descarte não ressuscita o trecho', async () => {
    const s = carregarStore();
    await s.salvarTrecho(novoTrecho('a', 1000, 1));
    await s.descartarTrechos('ev:1:10:novo');
    const existia = await s.atualizarTrechoSeExistir('a', { status: 'concluido', texto: 'x' });
    expect(existia).toBe(false);
    expect(await s.listarTrechos('ev:1:10:novo')).toEqual([]);
  });

  it('descartar um formulário não toca no áudio de outro', async () => {
    const s = carregarStore();
    await s.salvarTrecho(novoTrecho('a', 1000, 1));
    await s.salvarTrecho(novoTrecho('b', 1000, 1, { chave: 'ev:1:10:55' }));
    await s.descartarTrechos('ev:1:10:novo');
    expect((await s.listarTrechos('ev:1:10:55')).map(t => t.id)).toEqual(['b']);
  });

  it('o áudio é guardado como ArrayBuffer, nunca como Blob (Safari antigo)', () => {
    expect(semComentarios(STORE)).toMatch(/dados:\s+ArrayBuffer;/);
    expect(semComentarios(HOOK)).toMatch(/\.arrayBuffer\(\)/);
  });
});

// ─── 3. Hook: as garantias que somem sem erro ───────────────────────────────────

describe('Gravador por trechos', () => {
  const hook = semComentarios(HOOK);

  it('um MediaRecorder por trecho (pedaço do meio de um WebM não é arquivo legível)', () => {
    const abrir = blocoInterno(hook, 'abrirTrecho');
    expect(abrir).toMatch(/new MediaRecorder\(/);
    expect(blocoInterno(hook, 'cortar')).toMatch(/abrirTrecho\(\)[\s\S]*antigo\.stop\(\)/);
  });

  it('o trecho em fala é gravado no aparelho a cada pedaço, e reconfere o descarte DEPOIS do await', () => {
    const gravar = blocoInterno(hook, 'gravarNoAparelho');
    expect(gravar).toMatch(/await new Blob[\s\S]*arrayBuffer\(\);\s*if \(t\.encerrado\) return;\s*await salvarTrecho/);
    expect(blocoInterno(hook, 'abrirTrecho')).toMatch(/gravarNoAparelho\(t, 'gravando'\)/);
  });

  it('🔴 o texto só é entregue DEPOIS de o trecho ser marcado concluído, e só então é apagado', () => {
    const fila = blocoInterno(hook, 'processarFila');
    expect(fila).toMatch(/atualizarTrechoSeExistir\(proximo\.id, \{ status: 'concluido'[\s\S]*aoTextoRef\.current\(r\.texto\.trim\(\)\);\s*await removerTrecho\(proximo\.id\)/);
  });

  it('🔴 a fila para no primeiro trecho sem rede (ordem da fala), em vez de pular', () => {
    const fila = blocoInterno(hook, 'processarFila');
    expect(fila).toMatch(/r\.tipo === 'esperar'[\s\S]*?agendarNovaTentativa\(\);\s*break;/);
  });

  it('o trecho sendo falado agora segura a fila; o órfão de sessão interrompida é recuperado', () => {
    const fila = blocoInterno(hook, 'processarFila');
    expect(fila).toMatch(/t\.sessao === sessaoRef\.current\) break;/);
    expect(fila).toMatch(/atualizarTrechoSeExistir\(t\.id, \{ status: 'pendente' \}\)/);
  });

  it('volta da internet reprocessa a fila na hora', () => {
    expect(hook).toMatch(/addEventListener\('online',\s*aoVoltarRede\)/);
  });

  it('desmontar o formulário encerra o trecho em curso sem gravá-lo depois', () => {
    expect(hook).toMatch(/if \(t\) t\.encerrado = true;/);
  });
});

// ─── 4. Tela da evolução ────────────────────────────────────────────────────────

describe('Formulário da evolução', () => {
  // ⚠️ `accept="image/*,video/*,audio/*"` tem `/*` dentro da string: sem neutralizá-lo,
  // o removedor de comentários engoliria código até o próximo `*/` do arquivo.
  const tela = semComentarios(TELA.replace(/accept="[^"]*"/g, 'accept=""'));

  it('🔴 não junta mais a gravação inteira em memória', () => {
    expect(tela).not.toMatch(/audioChunksRef/);
    expect(tela).not.toMatch(/iniciarMediaRecorder/);
    expect(tela).toMatch(/useTranscricaoPorTrechos\(/);
  });

  it('Salvar e Finalizar esperam a fala pendente virar texto', () => {
    expect(tela).toMatch(/const aguardandoTexto = transcrevendo \|\| trechos\.pendentes > 0;/);
    expect(tela).toMatch(/onClick=\{onSalvar\} disabled=\{desativado \|\| gravacaoAtiva \|\| aguardandoTexto/);
    expect(tela).toMatch(/onClick=\{onFinalizar\} disabled=\{desativado \|\| gravacaoAtiva \|\| aguardandoTexto/);
  });

  it('o ditado ao vivo que falha (internet caiu) passa para os trechos', () => {
    const ini    = tela.indexOf('const passarParaGravacao');
    const passar = tela.slice(ini, tela.indexOf('rec.onerror = (e', ini));
    expect(passar).toMatch(/iniciarTrechos\(\)/);
  });

  it('🔴 Cancelar com fala gravada pergunta, e não para o gravador antes de fechar', () => {
    expect(tela).toMatch(/if \(temAudioGuardado\) \{ setConfirmarCancelar\(true\); return; \}/);
    expect(tela).toMatch(/onConfirmar=\{\(\) => \{ setConfirmarCancelar\(false\); onClose\(\); \}\}/);
  });

  it('formulário zerado leva junto o áudio dele; o texto recuperado inclui o usuário na chave', () => {
    expect(tela).toMatch(/const fecharModal = \(\) => \{\s*descartarAudioERascunhoEdicao\(\);/);
    expect(tela).toMatch(/const trocarFiltroStatus = \(status: string\) => \{\s*descartarAudioERascunhoEdicao\(\);/);
    expect(tela).toMatch(/`ev:\$\{user\.id\}:\$\{animalId\}:novo`/);
  });

  it('o rascunho da EDIÇÃO é descartado (não restaurado) quando a evolução foi gravada depois', () => {
    const fn = tela.slice(tela.indexOf('const textoComRascunhoEdicao'), tela.indexOf('const chaveTranscricao'));
    expect(fn).toMatch(/\(d\.versao \?\? null\) !== \(ev\.versao \?\? null\)\)\s*\{\s*localStorage\.removeItem\(chave\);/);
  });
});
