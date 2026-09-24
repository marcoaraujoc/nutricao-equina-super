'use strict';

/**
 * PAGAR A FATURA POR ANIMAL (2026-09-23) — a outra metade do fechamento por paciente.
 *
 * Fechar tira o bloco do `total` mas o mantém DEVIDO (`total_fechado`), porque fechar
 * não é receber. Pagar registra que o acerto à parte ACONTECEU: o valor sai de contas
 * a receber e vai para `total_pago_animal`.
 *
 * Quatro regras aqui quebram EM SILÊNCIO, e as quatro são dinheiro:
 *
 *  1. **PAGO vence FECHADO no recálculo.** Todo item pago também está fechado (quem
 *     paga, fecha). Contá-lo nos dois somaria o MESMO valor como recebido e como
 *     devido — e a fatura ainda fecharia "certa" na soma das linhas.
 *  2. **Pagar tem de FECHAR o que estava aberto.** Item pago e aberto ao mesmo tempo é
 *     uma linha que a fatura cobra e que o relatório já deu por recebida.
 *  3. **Reabrir não pode mexer no que já foi pago.** Reabrir devolve a linha à
 *     cobrança; sobre um bloco acertado, isso é cobrar de novo o que o cliente pagou.
 *  4. **Quem conta RECEBIDO tem de somar `total_pago_animal`.** O acerto por paciente
 *     numa fatura ainda ABERTA é dinheiro que entrou e que não aparece em lugar nenhum
 *     se o ranking olhar só as faturas quitadas.
 *
 * Por isso metade daqui é GATE ESTRUTURAL: o jeito de quebrar estas regras é apagar um
 * elo, e o sintoma é um número plausível — a mais ou a menos.
 */

const fs   = require('fs');
const path = require('path');

const { recalcularTotal, valorLiquidoItem } = require('../lib/faturaUtils');
const fechamento = require('../lib/faturaFechamentoAnimal');

const raiz = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (txt) =>
  txt.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// 1. O TOTAL — aberto cobra, fechado deve, pago entrou
// ─────────────────────────────────────────────────────────────────────────────

function clienteFalso(itens) {
  const gravado = { total: null };
  return {
    gravado,
    faturaItem: { findMany: async () => itens },
    fatura:     { update: async ({ data }) => { gravado.total = data.total; return data; } },
  };
}

const item = (id, valor, quantidade, extra = {}) => ({
  id, valor, quantidade, descontoTipo: null, descontoValor: 0, ...extra,
});

describe('recalcularTotal separa cobrar, dever e já ter recebido', () => {
  let espioes = [];
  const mapa = (ids, campo, valor) =>
    new Map(ids.map(id => [id, { [campo]: valor, [`${campo.replace('Em', '')}PorId`]: 1 }]));

  const comEstado = ({ fechados = [], pagos = [] }) => {
    espioes.push(
      jest.spyOn(fechamento, 'fechadosDaFatura')
        .mockResolvedValue(mapa(fechados, 'fechadoEm', '2026-09-23T10:00:00')),
      jest.spyOn(fechamento, 'pagosDaFatura')
        .mockResolvedValue(mapa(pagos, 'pagoEm', '2026-09-23T11:00:00')),
    );
  };

  const capturarTotais = () => {
    const capturado = {};
    espioes.push(jest.spyOn(fechamento, 'gravarTotais')
      .mockImplementation(async (_c, _id, totais) => { Object.assign(capturado, totais); }));
    return capturado;
  };

  afterEach(() => { espioes.forEach(e => e.mockRestore()); espioes = []; });

  it('🔴 o item PAGO sai do total E do totalFechado — não é contado duas vezes', async () => {
    // O item 2 está nos DOIS mapas, que é o estado real de todo item pago.
    comEstado({ fechados: [2], pagos: [2] });
    const capturado = capturarTotais();
    await recalcularTotal(clienteFalso([item(1, 100, 1), item(2, 50, 2)]), 1);
    expect(capturado.total).toBeCloseTo(100, 2);
    expect(capturado.totalFechado).toBe(0);
    expect(capturado.totalPagoAnimal).toBeCloseTo(100, 2);
  });

  it('🔴 os três totais somados continuam sendo a soma das linhas — nada é perdido', async () => {
    comEstado({ fechados: [2, 3], pagos: [3] });
    const capturado = capturarTotais();
    await recalcularTotal(clienteFalso([item(1, 100, 1), item(2, 50, 1), item(3, 30, 1)]), 1);
    const soma = capturado.total + capturado.totalFechado + capturado.totalPagoAnimal;
    expect(soma).toBeCloseTo(180, 2);
    expect(capturado.total).toBeCloseTo(100, 2);          // aberto: cobra
    expect(capturado.totalFechado).toBeCloseTo(50, 2);    // fechado: ainda deve
    expect(capturado.totalPagoAnimal).toBeCloseTo(30, 2); // pago: entrou
  });

  it('🔴 "a receber" (total + totalFechado) deixa de incluir o que foi pago', async () => {
    comEstado({ fechados: [1, 2], pagos: [2] });
    const capturado = capturarTotais();
    await recalcularTotal(clienteFalso([item(1, 100, 1), item(2, 100, 1)]), 1);
    const aReceber = capturado.total + capturado.totalFechado;
    expect(aReceber).toBeCloseTo(100, 2);  // só o bloco fechado e NÃO pago
  });

  it('o DESCONTO do item é respeitado também no que foi pago', async () => {
    comEstado({ fechados: [2], pagos: [2] });
    const capturado = capturarTotais();
    const pagoComDesconto = item(2, 100, 1, { descontoTipo: 'VALOR', descontoValor: 25 });
    await recalcularTotal(clienteFalso([item(1, 100, 1), pagoComDesconto]), 1);
    expect(capturado.totalPagoAnimal).toBeCloseTo(valorLiquidoItem(pagoComDesconto), 2); // 75
  });

  it('base ainda NÃO migrada segue como antes: nada pago, total é a soma de tudo', async () => {
    // Sem as colunas, `pagosDaFatura` devolve mapa vazio — o comportamento anterior ao
    // pagamento por animal, que é o que preserva a fatura de quem não migrou.
    const client = clienteFalso([item(1, 100, 1), item(2, 50, 2)]);
    const total = await recalcularTotal(client, 1);
    expect(total).toBeCloseTo(200, 2);
    expect(client.gravado.total).toBeCloseTo(200, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GATE — o SQL do pagamento
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: o SQL de pagar/estornar o bloco do paciente', () => {
  const lib = ler('lib/faturaFechamentoAnimal.js');
  const trechoDe = (fn) => lib.slice(lib.indexOf(`async function ${fn}`),
                                     lib.indexOf(`async function ${fn}`) + 1400);

  it('🔴 pagar FECHA o que estava aberto antes de dar a baixa', () => {
    const trecho = trechoDe('pagarAnimal');
    expect(trecho).toMatch(/"fechado_em" = NOW\(\) AT TIME ZONE 'UTC'/);
    expect(trecho).toMatch(/"pago_em" = NOW\(\) AT TIME ZONE 'UTC'/);
  });

  it('🔴 pagar só marca o que ainda NÃO foi pago — a data do acerto anterior fica de pé', () => {
    expect(trechoDe('pagarAnimal')).toMatch(/"pago_em" IS NULL/);
  });

  it('🔴 reabrir NÃO devolve à cobrança o que já foi pago', () => {
    const trecho = trechoDe('reabrirAnimal');
    expect(trecho).toMatch(/temColunasPagamento\(\)/);
    expect(trecho).toMatch(/"pago_em" IS NULL/);
  });

  it('🔴 "fechado à parte" conta só o que NÃO foi pago (senão o cliente deve de novo)', () => {
    expect(trechoDe('contarFechadosDoAnimal')).toMatch(/"pago_em" IS NULL/);
  });

  it('estornar só mexe no que está PAGO', () => {
    expect(trechoDe('desfazerPagamentoAnimal')).toMatch(/"pago_em" IS NOT NULL/);
  });

  it('o recorte é sempre (fatura, animal) — nunca só o animal, que alcançaria outras faturas', () => {
    for (const fn of ['pagarAnimal', 'desfazerPagamentoAnimal', 'contarPagosDoAnimal', 'contarNaoPagosDoAnimal']) {
      expect(trechoDe(fn)).toMatch(/"faturaId" = \$1 AND "animalId" = \$2/);
    }
  });

  it('base com fechamento e SEM pagamento devolve o pago ao `total_fechado` (segue cobrando)', () => {
    const trecho = lib.slice(lib.indexOf('async function gravarTotais'));
    expect(trecho).toMatch(/temColunasPagamento\(\)/);
    expect(trecho).toMatch(/totalFechado\) \|\| 0\) \+ \(Number\(totalPagoAnimal\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. GATE — controller, rotas e indicadores
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: quem pode dar a baixa, e o que ela NÃO faz', () => {
  const ctrl  = ler('controllers/FaturaController.js');
  const rotas = ler('routes/fatura.js');
  const trecho = ctrl.slice(ctrl.indexOf('async function alterarFechamentoDoAnimal'),
                            ctrl.indexOf('const FaturaController = {'));

  it('as duas rotas existem e usam o slug de EDITAR (o mesmo de marcar a fatura como paga)', () => {
    expect(rotas).toMatch(/animais\/:animalId\/pagar.*financeiro\.faturas\.editar/);
    expect(rotas).toMatch(/animais\/:animalId\/estornar.*financeiro\.faturas\.editar/);
  });

  it('🔴 ESTORNAR é ato de gestor — desfazer baixa devolve à cobrança o que foi recebido', () => {
    expect(trecho).toMatch(/acao === 'estornar' && !ehGestorNoContexto\(req\)/);
  });

  it('base sem a migration do pagamento diz que está indisponível, em vez de fingir que pagou', () => {
    expect(trecho).toMatch(/temColunasPagamento\(\)/);
    expect(trecho).toMatch(/PAGAMENTO_ANIMAL_INDISPONIVEL/);
  });

  it('🔴 pagar o bloco NÃO mexe no status da fatura (ela segue cobrando os outros pacientes)', () => {
    const limpo = semComentarios(trecho);
    expect(limpo).not.toMatch(/status:\s*'PAGA'/);
    expect(limpo).not.toMatch(/fatura\.update/);
  });

  it('🔴 o ranking de RECEBIDO soma `total_pago_animal` (acerto em fatura aberta é dinheiro que entrou)', () => {
    const ger = ler('controllers/RelatorioGerencialController.js');
    expect(ger).toMatch(/totalPagoAnimalPorFatura/);
    const bloco = ger.slice(ger.indexOf('async function blocoMelhoresPagadores'));
    expect(bloco).toMatch(/pagoBloco/);
  });

  it('a leitura da fatura anexa `pagoEm` aos itens (sem isso a tela mostra o pago como devido)', () => {
    const anexar = ler('lib/faturaFechamentoAnimal.js');
    const trechoAnexar = anexar.slice(anexar.indexOf('async function anexarFechamento'),
                                      anexar.indexOf('async function contarAbertosDoAnimal'));
    expect(trechoAnexar).toMatch(/pagosDaFatura/);
    expect(trechoAnexar).toMatch(/pagoEm:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GATE — migration e tela
// ─────────────────────────────────────────────────────────────────────────────

describe('gate: migration e tela', () => {
  const sql = fs.readFileSync(
    path.join(raiz, '../prisma/migrations/20261021000000_fatura_pagamento_por_animal/migration.sql'), 'utf8');

  it('a migration é ADITIVA — item existente nasce não pago e nenhuma fatura muda de valor', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "pago_em"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "total_pago_animal" DOUBLE PRECISION NOT NULL DEFAULT 0/);
    expect(sql).not.toMatch(/UPDATE\s+"schs2vet"/i);
  });

  it('🔴 o bloco do paciente tem as MESMAS ações da fatura inteira', () => {
    const tela = ler('../../frontend/src/pages/Faturamento.tsx');
    const bloco = tela.slice(tela.indexOf('function ResumoDoBloco'), tela.indexOf('function PainelFatura'));
    for (const rotulo of ['Fechar paciente', 'Marcar como Pago', 'E-mail', 'WhatsApp', 'Imprimir', 'Exportar']) {
      expect(bloco).toContain(rotulo);
    }
  });

  it('🔴 o documento do paciente leva o total DELE, nunca o da fatura inteira', () => {
    const tela = semComentarios(ler('../../frontend/src/pages/Faturamento.tsx'));
    const recorte = tela.slice(tela.indexOf('const faturaDoAnimal'), tela.indexOf('const animaisDoDocumento'));
    // O total sai dos itens ABERTOS daquele animal — copiar `fatura.total` mandaria ao
    // cliente uma folha com os lançamentos de um cavalo e o valor de todos.
    expect(recorte).toMatch(/itens\.filter\(i => !i\.fechadoEm\)\.reduce/);
    expect(recorte).not.toMatch(/total:\s*fatura\.total/);
  });
});
