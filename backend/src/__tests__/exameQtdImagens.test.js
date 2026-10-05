// backend/src/__tests__/exameQtdImagens.test.js
//
// CONFERÊNCIA DA QUANTIDADE DE IMAGENS no resultado de exame de IMAGEM (2026-10-02).
//
// O pedido de imagem informa a "Quantidade de imagens" (`qtdAmostra`). Ao carregar o
// resultado em /exames/:animalId?tipo=imagem, a tela passou a conferir quantas imagens
// foram anexadas contra a quantidade pedida — irmã da conferência "o exame é o mesmo
// que foi pedido?" (`conferirExame`). Como ela, NUNCA bloqueia: pergunta no salvar.
//
// O teste EXECUTA a regra real do front (`utils/exameConferencia.ts`, transpilado) e
// mantém um gate estrutural nos elos do modal que sumiriam sem erro.
'use strict';

const fs   = require('fs');
const path = require('path');
const ts   = require('typescript');

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const UTIL  = fs.readFileSync(path.join(FRONT, 'utils', 'exameConferencia.ts'), 'utf8');
const PAINEL = fs.readFileSync(path.join(FRONT, 'components', 'ExamesSolicitadosPanel.tsx'), 'utf8');

function carregarUtil() {
  const js = ts.transpileModule(UTIL, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}

const { conferirQtdImagens, ehArquivoDeImagem } = carregarUtil();

/** Código sem comentários — o gate não pode se satisfazer com a prosa que explica a regra. */
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('conferirQtdImagens — a regra', () => {
  test('quantidade igual à pedida combina', () => {
    expect(conferirQtdImagens(3, 3)).toEqual({ combina: true, motivo: '' });
  });

  test('menos imagens que o pedido diverge, com as duas contagens na frase', () => {
    const r = conferirQtdImagens(3, 2);
    expect(r.combina).toBe(false);
    expect(r.motivo).toBe('O pedido informa 3 imagens e foram anexadas 2 imagens.');
  });

  test('mais imagens que o pedido também diverge', () => {
    expect(conferirQtdImagens(1, 2).combina).toBe(false);
    expect(conferirQtdImagens(1, 2).motivo).toBe('O pedido informa 1 imagem e foram anexadas 2 imagens.');
  });

  test('nenhuma imagem anexada tem frase própria (singular/plural corretos)', () => {
    expect(conferirQtdImagens(2, 0).motivo).toBe('O pedido informa 2 imagens e nenhuma imagem foi anexada.');
    expect(conferirQtdImagens(2, 1).motivo).toBe('O pedido informa 2 imagens e foi anexada 1 imagem.');
  });

  test('pedido SEM quantidade não afirma divergência', () => {
    for (const p of [null, undefined, 0, -1, NaN]) {
      expect(conferirQtdImagens(p, 5).combina).toBe(true);
    }
  });
});

describe('ehArquivoDeImagem — o laudo não conta como imagem', () => {
  test('MIME image/* é imagem, mesmo sem extensão no nome', () => {
    expect(ehArquivoDeImagem('IMG_0001', 'image/jpeg')).toBe(true);
  });

  test('extensões de imagem contam (anexo salvo só tem o nome)', () => {
    for (const n of ['rx1.jpg', 'RX2.JPEG', 'us.png', 'foto.heic', 'scan.tif', 'a.webp']) {
      expect(ehArquivoDeImagem(n)).toBe(true);
    }
  });

  test('laudo PDF/DOCX/TXT não conta', () => {
    expect(ehArquivoDeImagem('laudo.pdf', 'application/pdf')).toBe(false);
    expect(ehArquivoDeImagem('laudo.docx')).toBe(false);
    expect(ehArquivoDeImagem('laudo.txt', 'text/plain')).toBe(false);
    expect(ehArquivoDeImagem(null, null)).toBe(false);
  });
});

describe('modal de resultado — elos que sumiriam sem erro', () => {
  const codigo = semComentarios(PAINEL);

  test('o pedido traz a quantidade (qtdAmostra) para a tela', () => {
    expect(codigo).toMatch(/qtdAmostra\?:\s*number \| null/);
  });

  test('só confere em pedido de IMAGEM com quantidade informada', () => {
    expect(codigo).toMatch(/const qtdImagensPedida = isImagem && ex && \(ex\.qtdAmostra \?\? 0\) > 0/);
  });

  test('conta as imagens já salvas E as anexadas agora', () => {
    expect(codigo).toMatch(/arquivos\.filter\(f => ehArquivoDeImagem\(f\.name, f\.type\)\)/);
    expect(codigo).toMatch(/\(arquivosSalvos \?\? \[\]\)\.filter\(a => ehArquivoDeImagem\(a\.nome\)\)/);
  });

  test('o salvar pergunta antes de gravar quando a quantidade diverge', () => {
    const corpo = codigo.slice(codigo.indexOf('const confirmar = () =>'));
    const ate = corpo.slice(0, corpo.indexOf('gravar();'));
    expect(ate).toMatch(/conferirQtdImagens\(qtdImagensPedida, qtdImagensAnexadas\)/);
    expect(ate).toMatch(/setDivergenciaQtd\(conf\.motivo\); return;/);
  });

  test('"Salvar mesmo assim" grava sem reabrir a pergunta para a mesma contagem', () => {
    expect(codigo).toMatch(/setQtdImagensAceita\(qtdImagensAnexadas\); setDivergenciaQtd\(null\); gravar\(\);/);
  });
});
