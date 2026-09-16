// backend/src/__tests__/erroNaoVazaParaTela.test.js
//
// 🔴 ERRO CRU NUNCA CHEGA À TELA DO USUÁRIO.
//
// O CASO QUE ORIGINOU ESTE ARQUIVO (2026-09-16): alterar um medicamento em
// "/cadastro/produtos" mostrava, NA TELA, o dump do Prisma — "Invalid
// tx.medicamento.create() invocation in ...backend/src/lib/unidadeMedicamento.js:111"
// seguido de "Unique constraint failed on the (not available)" —, com o CAMINHO
// ABSOLUTO do arquivo no servidor e o trecho do código.
//
// A causa era uma linha que PARECE uma rede de segurança e é o oposto dela:
//     res.status(500).json({ error: err.message || 'Erro ao cadastrar o produto.' })
// A mensagem do Prisma SEMPRE existe quando ele falha, então o texto amigável do "||"
// nunca era usado. O handler global de server.ts já fazia a coisa certa (500 → "Erro
// interno do servidor"); o vazamento morava nos try/catch PRÓPRIOS dos controllers,
// que respondem ANTES de o erro chegar lá.
//
// Este arquivo tranca as DUAS metades, porque as duas quebram em silêncio:
//   1. o COMPORTAMENTO de lib/erroResposta.js (o que sai na resposta);
//   2. um GATE ESTRUTURAL que varre os controllers e reprova quem volte a devolver a
//      mensagem do erro num 500 — é assim que a regressão entraria: uma linha nova,
//      escrita com boa intenção, num catch qualquer.
'use strict';

const fs   = require('fs');
const path = require('path');

const { responderErro } = require('../lib/erroResposta');

/** Resposta falsa que guarda status e corpo. */
function resFake() {
  const r = { statusCode: null, corpo: null };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json   = (b) => { r.corpo = b; return r; };
  return r;
}

// A barra invertida vem de fromCharCode só para o FONTE deste teste não depender de
// escape; o que importa é o texto ter um caminho Windows de verdade dentro dele.
const BARRA = String.fromCharCode(92);
const DUMP_PRISMA = [
  'Invalid tx.medicamento.create() invocation in',
  'D:' + BARRA + 'Projetos' + BARRA + 'backend' + BARRA + 'src' + BARRA + 'lib'
    + BARRA + 'unidadeMedicamento.js:111:38',
  '  111   const copia = await tx.medicamento.create(',
  'Unique constraint failed on the (not available)',
].join(String.fromCharCode(10));

function erroPrisma(code) {
  const e = new Error(DUMP_PRISMA);
  e.code = code;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('responderErro — o que a pessoa lê', () => {
  test('erro do Prisma NÃO leva a mensagem crua para a resposta', () => {
    const res = resFake();
    responderErro(res, erroPrisma('P2002'), {
      contexto: 'Teste.criar', mensagem: 'Não foi possível salvar o produto.',
    });
    const texto = JSON.stringify(res.corpo);
    expect(texto).not.toMatch(/invocation/i);
    expect(texto).not.toMatch(/unidadeMedicamento/);
    expect(texto).not.toMatch(/medicamento.create/);
    expect(texto).not.toMatch(/Unique constraint/);
    // Nem o caminho do servidor, que é vazamento de informação.
    expect(texto).not.toMatch(/D:/);
  });

  test('P2002 (chave única) vira 409 com texto que a pessoa entende', () => {
    const res = resFake();
    responderErro(res, erroPrisma('P2002'), { contexto: 'Teste.criar', mensagem: 'padrão' });
    expect(res.statusCode).toBe(409);
    expect(res.corpo.error).toBe('Já existe um registro com esses dados.');
  });

  test('P2025 (não encontrado) vira 404', () => {
    const res = resFake();
    responderErro(res, erroPrisma('P2025'), { contexto: 'Teste.criar', mensagem: 'padrão' });
    expect(res.statusCode).toBe(404);
  });

  test('erro desconhecido vira 500 com a mensagem que o controller escolheu', () => {
    const res = resFake();
    const err = new TypeError("Cannot read properties of undefined (reading 'nome')");
    responderErro(res, err, { contexto: 'Teste.criar', mensagem: 'Não foi possível salvar o produto.' });
    expect(res.statusCode).toBe(500);
    expect(res.corpo.error).toBe('Não foi possível salvar o produto.');
    expect(JSON.stringify(res.corpo)).not.toMatch(/Cannot read properties/);
  });

  test('erro de REGRA DE NEGÓCIO passa inteiro — é texto escrito para ser lido', () => {
    // UnidadeIndisponivelError e afins carregam a explicação que resolve o caso
    // ("inative a outra entrada antes de trocar a unidade"). Engoli-la seria trocar
    // uma instrução útil por "erro interno".
    const res = resFake();
    const err = Object.assign(new Error('Este item já teve saída de estoque na unidade atual (g).'), {
      status: 400, code: 'ESTOQUE_JA_MOVIMENTADO',
    });
    responderErro(res, err, { contexto: 'Teste.criar', mensagem: 'padrão' });
    expect(res.statusCode).toBe(400);
    expect(res.corpo.error).toMatch(/já teve saída de estoque/);
    expect(res.corpo.code).toBe('ESTOQUE_JA_MOVIMENTADO');
  });

  test('a stack e a mensagem original NUNCA vão na resposta', () => {
    const res = resFake();
    responderErro(res, new Error('boom'), { contexto: 'Teste.criar', mensagem: 'padrão' });
    expect(JSON.stringify(res.corpo)).not.toMatch(/at Object/);
    expect(JSON.stringify(res.corpo)).not.toMatch(/boom/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GATE ESTRUTURAL — o modo de a regressão voltar é uma linha nova num catch.
describe('gate: nenhum controller devolve a mensagem do erro num 500', () => {
  const DIR = path.join(__dirname, '..', 'controllers');

  function arquivos(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return arquivos(p);
      return d.name.endsWith('.js') ? [p] : [];
    });
  }

  // Comentário citando a regra NÃO pode reprovar o arquivo — senão o gate acusa a
  // própria documentação dela e vira ruído que se aprende a ignorar (mesma lição do
  // gate de e-mail, CLAUDE.md 2026-09-05).
  function semComentarios(txt) {
    return txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  }

  test('nenhum status(500) responde com a mensagem do erro', () => {
    const culpados = [];
    for (const arq of arquivos(DIR)) {
      const txt = semComentarios(fs.readFileSync(arq, 'utf8'));
      if (/status\(500\)[\s\S]{0,200}?\b(?:err|error|e)\.message/.test(txt)) {
        culpados.push(path.basename(arq));
      }
    }
    expect(culpados).toEqual([]);
  });

  test('nenhum campo de resposta usa a mensagem do erro com fallback', () => {
    // O padrão exato do defeito: uma CHAVE DE RESPOSTA (error/mensagem/motivo)
    // recebendo `err.message || 'texto amigável'` (ou `??`). O fallback existe só no
    // papel — a mensagem do erro quase sempre está preenchida —, então o que chega à
    // tela é sempre o texto cru. Cobre o `||` e o `??` porque os dois falham igual.
    const culpados = [];
    for (const arq of arquivos(DIR)) {
      const txt = semComentarios(fs.readFileSync(arq, 'utf8'));
      if (/(?:error|mensagem|motivo)\s*:\s*(?:err|error|e)\.message\s*(?:\|\||\?\?)/.test(txt)) {
        culpados.push(path.basename(arq));
      }
    }
    expect(culpados).toEqual([]);
  });

  test('ProdutoController.criar usa o helper (foi o caminho do defeito relatado)', () => {
    const txt = fs.readFileSync(path.join(DIR, 'ProdutoController.js'), 'utf8');
    expect(txt).toMatch(/lib\/erroResposta/);
    const criar = txt.slice(txt.indexOf('const criar = async'), txt.indexOf('const atualizar = async'));
    expect(criar).toMatch(/responderErro\(res, err, \{/);
  });
});
