// backend/src/lib/prescricaoProprietario.js
//
// Regra PURA (sem banco) sobre o item marcado "Será aplicada pelo Proprietário".
// Mora aqui, e não no controller, porque o `PrescricaoGrupoController` importa
// `lib/prisma` (TypeScript) e não pode ser carregado direto pelo Jest — regra sem
// teste é regra que ninguém defende na próxima alteração.
'use strict';

/**
 * O curso INTEIRO é aplicado pelo proprietário?
 *
 * É o que decide se a prescrição encerra no ÚLTIMO passo já na finalização: ela nunca
 * chega ao plantão (`listarParaExecucao` descarta os itens com a flag, e o grupo que
 * fica sem nenhum some da fila), então parar em FINALIZADO ("Em Execução") a deixaria
 * para sempre esperando uma execução que, por construção, não vai acontecer.
 *
 * ⚠️ Lista VAZIA responde `false`: `[].every(...)` é `true` em JS, e sem essa guarda um
 * grupo sem itens seria dado como concluído.
 *
 * ⚠️ A comparação é `=== true`, nunca um teste de veracidade solto. A flag é lida por
 * SQL cru (a coluna pode não estar no Prisma Client) e volta `undefined` quando a
 * leitura falha — tratar isso como "é do proprietário" faria uma falha de leitura
 * encerrar a prescrição sozinha, sem nada na tela explicando o porquê.
 *
 * Espelho no front: `todoDoProprietario` em `pages/SubModuloPrescricao.tsx`, que compõe
 * o rótulo "… pelo Proprietário". As duas precisam concordar — divergirem faz a tela
 * dizer "Executado" onde o backend encerrou por conta do proprietário, ou o contrário.
 * `__tests__/prescricaoProprietario.test.js` compara as duas.
 *
 * @param {Array<{aplicadaPeloProprietario?: boolean}>|null|undefined} itens
 * @returns {boolean}
 */
function cursoTodoDoProprietario(itens) {
  const lista = itens ?? [];
  return lista.length > 0 && lista.every(i => i?.aplicadaPeloProprietario === true);
}

module.exports = { cursoTodoDoProprietario };
