'use strict';

/**
 * 🔴 A VACINA É CORRIGÍVEL ATÉ A DOSE SER APLICADA (2026-09-23).
 *
 * Duas mudanças pedidas no mesmo dia, e as duas quebram EM SILÊNCIO se regredirem —
 * por isso o gate é ESTRUTURAL:
 *
 *   1. ALTERAR até a aplicação. `atualizar` recusava tudo fora de `SALVA`, então
 *      corrigir a dose de uma vacina que já estava na fila do plantão (FINALIZADA)
 *      exigia CANCELAR e registrar de novo — e cancelar pede justificativa e tira o
 *      registro do histórico útil. A FINALIZADA não tirou frasco da prateleira: ela
 *      tem RESERVA, e o débito e a cobrança só acontecem em `executar`.
 *      ⚠️ Alterar uma FINALIZADA precisa REFAZER o destino pela matriz "quem FORNECE
 *      × quem APLICA" — não basta gravar os campos. Sem isso, a reserva fica presa no
 *      lote da vacina ANTIGA e o plantão continua separando o frasco errado; e marcar
 *      "aplicada pelo proprietário" deixaria a dose esperando para sempre uma execução
 *      que, por construção, não vai acontecer — sem nunca ser cobrada.
 *
 *   2. SALDO não recusa o registro. `registrar`/`atualizar` devolviam
 *      400 'Lote sem saldo disponível'. Mesma decisão já tomada para a prescrição
 *      (`execucaoSemTravas.test.js`): estoque é CONTROLE, não autorização clínica.
 *      O recorte era perverso — só alcançava quem escolheu um lote, ou seja, a clínica
 *      que mantém o estoque cadastrado.
 *
 * ⚠️ O que este gate NÃO afrouxa:
 *   • a trava de VALIDADE (lote vencido) continua, e é ASSERTADA como presente:
 *     "acabou o saldo" e "o frasco está vencido" são perguntas diferentes, e a segunda
 *     é segurança do paciente;
 *   • EXECUTADA e CANCELADA seguem fechadas para edição — ali há fatura e baixa;
 *   • a BAIXA de estoque continua acontecendo em `executar`.
 */

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const lerFront = (rel) =>
  fs.readFileSync(path.join(RAIZ, '..', '..', 'frontend', 'src', rel), 'utf8');

/**
 * Comentário NÃO é código. Sem isto a varredura se satisfaz com o próprio comentário
 * que EXPLICA a regra — e um gate que aprova a documentação em vez do comportamento é
 * um gate que se aprende a ignorar.
 */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Corpo de uma função nomeada, para a asserção não vazar para o arquivo todo.
 *
 * ⚠️ O corpo começa na chave DEPOIS da lista de parâmetros, nunca na primeira `{`:
 * assinatura com desestruturação devolveria dois parâmetros como se fossem a função.
 */
function corpoDaFuncao(src, nome) {
  const i = src.indexOf(nome);
  expect(i).toBeGreaterThan(-1);
  let par = 0, fimAssinatura = -1;
  for (let p = i; p < src.length; p++) {
    if (src[p] === '(') par++;
    else if (src[p] === ')') { par--; if (par === 0) { fimAssinatura = p; break; } }
  }
  expect(fimAssinatura).toBeGreaterThan(-1);
  const abre = src.indexOf('{', fimAssinatura);
  let nivel = 0;
  for (let p = abre; p < src.length; p++) {
    if (src[p] === '{') nivel++;
    if (src[p] === '}') { nivel--; if (nivel === 0) return src.slice(abre, p + 1); }
  }
  throw new Error(`corpo de ${nome} não fechou`);
}

const CTRL = semComentarios(ler('controllers/VacinaClinicaController.js'));
const TELA = semComentarios(lerFront('pages/SubModuloVacina.tsx'));

describe('ALTERAR vale para SALVA e FINALIZADA', () => {
  const atualizar = corpoDaFuncao(CTRL, 'async function atualizar');

  test('a lista de status alteráveis existe e tem as DUAS', () => {
    expect(CTRL).toMatch(/const STATUS_ALTERAVEIS = \['SALVA', 'FINALIZADA'\]/);
  });

  test('`atualizar` decide pela lista, não por igualdade com SALVA', () => {
    expect(atualizar).toMatch(/STATUS_ALTERAVEIS\.includes\(infoAntes\.status\)/);
    expect(atualizar).not.toMatch(/infoAntes\.status !== 'SALVA'/);
  });

  test('EXECUTADA e CANCELADA ficam de fora (a lista não as inclui)', () => {
    const lista = CTRL.match(/const STATUS_ALTERAVEIS = \[[^\]]*\]/)[0];
    expect(lista).not.toMatch(/EXECUTADA|CANCELADA/);
  });

  test('a tela espelha a mesma lista — botão que a rota recusa é a armadilha 28-d', () => {
    expect(TELA).toMatch(/const STATUS_ALTERAVEIS_VAC: StatusVacina\[\] = \['SALVA', 'FINALIZADA'\]/);
    expect(TELA).toMatch(/STATUS_ALTERAVEIS_VAC\.includes\(getStatus\(v\)\)/);
    // A condição antiga não pode voltar em lugar nenhum da tela.
    expect(TELA).not.toMatch(/getStatus\(v\) === 'SALVA'/);
  });
});

describe('alterar uma FINALIZADA refaz o destino pela matriz', () => {
  const atualizar = corpoDaFuncao(CTRL, 'async function atualizar');

  test('a reserva antiga é apagada — senão o plantão separa o lote da vacina anterior', () => {
    expect(atualizar).toMatch(/DELETE FROM schs2vet\.tb_reservas_estoque_vacina/);
  });

  test('a dose que segue no plantão é RESERVADA de novo, com a quantidade corrigida', () => {
    expect(atualizar).toMatch(/criarReservaVacina\(tx, \{/);
  });

  test('"proprietário aplica × clínica fornece" debita, fatura e agenda AQUI', () => {
    expect(atualizar).toMatch(/const cobrarAgora = isAplicadaProp && !isCliente/);
    expect(atualizar).toMatch(/darBaixaEFaturar\(tx, \{/);
    expect(atualizar).toMatch(/agendarReforcos\(tx, \{/);
  });

  test('a cobrança dupla é impedida por `origemJaFaturada`, não pela FK', () => {
    expect(atualizar).toMatch(/origemJaFaturada\(tx, 'vacinaClinicaId', vacina\.id\)/);
  });

  test('quem aplica em casa já nasce EXECUTADA — não fica esperando o plantão', () => {
    expect(atualizar).toMatch(/isAplicadaProp \? 'EXECUTADA' : 'FINALIZADA'/);
  });

  test('a troca de quadrante vai para a AUDITORIA', () => {
    expect(atualizar).toMatch(/aplicadaPeloProprietario: \{ de: infoAntes\.aplicadaPeloProprietario/);
    expect(atualizar).toMatch(/status: \{ de: infoAntes\.status/);
  });
});

describe('SALDO não recusa o registro da vacina', () => {
  test('nenhum 400 de saldo sobrou em `registrar`/`atualizar`', () => {
    expect(CTRL).not.toMatch(/Lote sem saldo dispon/);
    expect(CTRL).not.toMatch(/qtdDisponivel < qtdFinal/);
  });

  test('a trava de VALIDADE continua de pé nos dois pontos', () => {
    expect((CTRL.match(/está vencido \(validade:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test('a BAIXA continua acontecendo — o que saiu foi o bloqueio, não o débito', () => {
    const baixa = corpoDaFuncao(CTRL, 'async function darBaixaEFaturar');
    expect(baixa).toMatch(/qtdDisponivel: \{ decrement: qtd \}/);
  });
});
