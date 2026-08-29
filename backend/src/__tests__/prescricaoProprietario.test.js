// backend/src/__tests__/prescricaoProprietario.test.js
//
// Prescrição cujo curso INTEIRO é aplicado pelo proprietário nunca chega ao plantão:
// `listarParaExecucao` descarta os itens com a flag e o grupo que fica sem nenhum some
// da fila. Por isso ela encerra no ÚLTIMO passo já na finalização, em vez de ficar para
// sempre em "Em Execução" esperando uma execução que, por construção, não acontece.
//
// O que quebra em silêncio aqui:
//
//   1. `[].every(...)` é `true` em JavaScript. Sem a guarda de lista vazia, um grupo
//      sem itens seria dado como concluído — e o modo de falhar é o pior: nenhum erro,
//      só um documento que aparece como encerrado sem nada dentro.
//   2. Documento MISTO (parte da clínica, parte do proprietário) tem de continuar
//      FINALIZADO. Encerrá-lo esconderia da enfermagem a dose que ela ainda tem de dar.
//   3. A flag chega por SQL cru (a coluna pode não estar no Client) e vem `undefined`
//      quando a leitura falha. `undefined` NÃO pode contar como "é do proprietário",
//      senão uma falha de leitura encerraria a prescrição sozinha — por isso a
//      comparação é `=== true`, não um teste de veracidade solto.
//   4. O rótulo "… pelo Proprietário" é composto no FRONT com a mesma condição. Se as
//      duas divergirem, a tela diz "Executado" onde o backend encerrou por conta do
//      proprietário (ou o contrário), e ninguém percebe — daí o teste de paridade.

const fs   = require('fs');
const path = require('path');
const { cursoTodoDoProprietario } = require('../lib/prescricaoProprietario');

const doProprietario = { id: 1, aplicadaPeloProprietario: true };
const daClinica      = { id: 2, aplicadaPeloProprietario: false };

describe('cursoTodoDoProprietario', () => {
  it('todos os itens do proprietário → encerra no último passo', () => {
    expect(cursoTodoDoProprietario([doProprietario, { id: 3, aplicadaPeloProprietario: true }])).toBe(true);
  });

  it('🔴 documento MISTO continua em execução — a clínica ainda tem dose a dar', () => {
    expect(cursoTodoDoProprietario([doProprietario, daClinica])).toBe(false);
  });

  it('nenhum item do proprietário → segue o fluxo normal do plantão', () => {
    expect(cursoTodoDoProprietario([daClinica])).toBe(false);
  });

  it('🔴 lista vazia é `false` — `[].every()` seria `true` e encerraria um grupo vazio', () => {
    expect(cursoTodoDoProprietario([])).toBe(false);
    expect(cursoTodoDoProprietario(null)).toBe(false);
    expect(cursoTodoDoProprietario(undefined)).toBe(false);
  });

  it('🔴 flag ausente/undefined NÃO conta como do proprietário', () => {
    // A coluna é lida por SQL cru e o helper devolve o item sem a flag quando a leitura
    // falha; tratar isso como `true` encerraria a prescrição por causa de um erro de
    // leitura, sem nada na tela indicando o porquê.
    expect(cursoTodoDoProprietario([{ id: 1 }])).toBe(false);
    expect(cursoTodoDoProprietario([doProprietario, { id: 4, aplicadaPeloProprietario: undefined }])).toBe(false);
  });

  it('valor "truthy" que não seja `true` também não conta', () => {
    expect(cursoTodoDoProprietario([{ id: 1, aplicadaPeloProprietario: 1 }])).toBe(false);
    expect(cursoTodoDoProprietario([{ id: 1, aplicadaPeloProprietario: 'sim' }])).toBe(false);
  });
});

describe('paridade com o front', () => {
  const front = fs.readFileSync(
    path.join(__dirname, '../../../frontend/src/pages/SubModuloPrescricao.tsx'), 'utf8');

  it('o front usa a MESMA condição (=== true, com guarda de lista vazia)', () => {
    const trecho = front.slice(front.indexOf('const todoDoProprietario'));
    expect(trecho).toContain('g.itens.length > 0');
    expect(trecho).toContain('aplicadaPeloProprietario === true');
  });

  it('o rótulo do front acrescenta o sufixo "pelo Proprietário"', () => {
    expect(front).toContain('pelo Proprietário');
  });
});
