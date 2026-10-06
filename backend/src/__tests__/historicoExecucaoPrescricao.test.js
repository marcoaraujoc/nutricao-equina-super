// backend/src/__tests__/historicoExecucaoPrescricao.test.js
//
// HISTÓRICO DA EXECUÇÃO DE PRESCRIÇÃO — duas correções de 2026-10-05.
//
// 1. 🔴 A HORA DA VACINA SAÍA 3h ATRASADA. O Histórico tira o QUANDO da vacina do
//    AuditLog (`VacinaClinica` não tem coluna de execução), e os INSERTs de
//    `lib/auditoria.js` deixavam o `timestamp` no DEFAULT da coluna,
//    `CURRENT_TIMESTAMP`: `timestamptz` convertido para o fuso da SESSÃO
//    (America/Sao_Paulo) ao cair numa coluna `timestamp` sem fuso. O Prisma lê a
//    coluna como UTC naive — aplicada às 14:39, exibida "às 11:39". Todo INSERT do
//    arquivo passou a gravar `NOW() AT TIME ZONE 'UTC'` (CLAUDE.md §6).
//
// 2. A LINHA DA PRESCRIÇÃO NÃO DIZIA O QUE FOI REALIZADO. A da vacina sempre trouxe
//    o nome da vacina (`detalhe`); a de procedimento/medicamento mostrava só paciente,
//    número e "Executada". `LinhaGrupo` passou a montar o `detalhe` com os itens do
//    TIPO do card, e todo `<LinhaGrupo>` passa o `tipo`.
//
// Varredura de CÓDIGO, ignorando comentários para não aprovar/reprovar a própria
// explicação da regra.
'use strict';

const fs   = require('fs');
const path = require('path');

function semComentarios(texto) {
  return texto
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const AUDITORIA = semComentarios(fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'auditoria.js'), 'utf8'));
const TELA = semComentarios(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages', 'ExecucaoPrescricao.tsx'), 'utf8'));

describe('AuditLog grava o instante em UTC', () => {
  const inserts = AUDITORIA.split('INSERT INTO schs2vet.tb_audit_logs').slice(1)
    .map(trecho => trecho.slice(0, trecho.indexOf('`')));

  it('o arquivo tem inserts a conferir', () => {
    expect(inserts.length).toBeGreaterThan(0);
  });

  it.each(inserts.map((sql, i) => [i + 1, sql]))(
    'insert %i informa "timestamp" com NOW() AT TIME ZONE \'UTC\'', (_n, sql) => {
      expect(sql).toMatch(/"timestamp"\s*\)/);
      expect(sql).toMatch(/NOW\(\) AT TIME ZONE 'UTC'\s*\)/);
    });
});

describe('linha da prescrição nomeia o que foi realizado', () => {
  const linhaGrupo = TELA.slice(TELA.indexOf('function LinhaGrupo('),
    TELA.indexOf('function LinhaGrupo(') + 4000);

  it('LinhaGrupo repassa `detalhe` ao LinhaExecucao', () => {
    expect(linhaGrupo).toMatch(/detalhe=\{detalhe\}/);
  });

  it('o detalhe recorta pelos itens do TIPO do card', () => {
    expect(linhaGrupo).toMatch(/i\.tipo === tipo/);
  });

  it('todo <LinhaGrupo> informa o tipo', () => {
    const usos = TELA.split('<LinhaGrupo').slice(1).map(t => t.slice(0, t.indexOf('/>')));
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) expect(uso).toMatch(/tipo=\{tipo\}/);
  });
});
