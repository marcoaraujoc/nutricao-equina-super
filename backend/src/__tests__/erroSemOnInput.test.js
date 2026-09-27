// backend/src/__tests__/erroSemOnInput.test.js
//
// LIMPAR O ERRO DO FORMULÁRIO NÃO PODE REVERTER O <select>.
//
// 🔴 O DEFEITO (2026-09-26, relatado na Prescrição): "Frequência é obrigatória" não saía
// mais — escolhida a frequência e clicado Finalizar de novo, o erro voltava e o campo
// aparecia zerado. O contêiner do formulário limpava o erro em DOIS eventos:
//
//   <div onChange={() => setErro(null)} onInput={() => setErro(null)}>
//
// No <select> o navegador dispara `input` ANTES de `change`. Com o erro na tela, o
// `onInput` o limpava, o React re-renderizava NA HORA (evento discreto) e o select
// controlado voltava ao valor do estado — ainda vazio. Quando o `change` chegava, o
// `e.target.value` lido já era ''. Sem erro na tela o `setErro(null)` não muda nada e
// não re-renderiza, por isso o defeito só aparecia DEPOIS da primeira validação.
//
// `onChange` sozinho cobre tudo: o React normaliza o change para borbulhar, e em campo
// de texto ele já escuta o `input` nativo. O `onInput` não acrescentava nada — só o bug.
//
// Varredura de CÓDIGO (o projeto não tem runner de componente React), ignorando
// comentários para não reprovar a própria explicação da regra.
'use strict';

const fs   = require('fs');
const path = require('path');

const TELAS = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages');

function semComentarios(texto) {
  return texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const MODULOS = [
  { arquivo: 'SubModuloPrescricao.tsx',     setter: 'setErroAcao'   },
  { arquivo: 'SubModuloVacina.tsx',         setter: 'setErroForm'   },
  { arquivo: 'SubModuloEvolucao.tsx',       setter: 'setErroInline' },
  { arquivo: 'SubModuloExames.tsx',         setter: 'setErroInline' },
  { arquivo: 'SubModuloEncaminhamento.tsx', setter: 'setErro'       },
];

describe('Limpar o erro do formulário não reverte o <select>', () => {
  it.each(MODULOS)('$arquivo limpa o erro só por onChange', ({ arquivo, setter }) => {
    const src = semComentarios(fs.readFileSync(path.join(TELAS, arquivo), 'utf8'));
    // A limpeza por onChange continua lá — é ela que apaga o erro ao corrigir o campo.
    expect(src).toContain(`onChange={() => ${setter}(null)}`);
    // E nenhum contêiner limpa erro pelo `input` nativo.
    expect(src).not.toMatch(/onInput=\{\(\)\s*=>\s*set\w*\(null\)\}/);
  });
});
