// 🔴 PRODUTO QUE JÁ TEM SALDO E PASSA A SER MULTIDOSE (2026-10-01).
//
// Caso real (Patyvet, Zoovit C - frasco 20 mL): entrada de 10 frascos feita no item
// GLOBAL (contado em 'Un.'); em seguida o produto foi marcado multidose de 20 mL, o que
// criou a CÓPIA da clínica. O saldo foi reapontado CRU — 10 frascos viraram "10 mL" — e
// o Ajuste de Estoque, sem o conteúdo na linha, gravou "0 → 10" querendo dizer 10 frascos.
// Três elos, todos silenciosos:
//   1. o copy-on-write reconverte o saldo do GLOBAL antes de movê-lo para a cópia;
//   2. a VACINA ganhou a mesma reconversão (lote + reserva) e o lote acompanha a cópia;
//   3. os dois Ajustes de Estoque oferecem FRASCOS a partir do conteúdo do PRODUTO/LOTE.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../controllers/EstoqueController', () => ({
  // R$/unidade = valor ÷ conteúdo (fator 1 em mL) — basta para o teste.
  calcPrecoUnitarioBase: (valor, conteudo) => Number(valor) / (Number(conteudo) || 1),
}));

jest.mock('../controllers/VacinaClinicaController', () => ({ criarReservaVacina: jest.fn(async () => {}) }));

const cat = require('../lib/catalogoEmpresa');
const { criarReservaVacina } = require('../controllers/VacinaClinicaController');
const { dosagemNaUnidadeDoLote } = require('../lib/vacinaDosagemLote');

const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const ler = (rel) => semComentarios(fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8'));
const trechoDe = (src, inicio, fim) => {
  const i = src.indexOf(inicio);
  const j = fim ? src.indexOf(fim, i + 1) : -1;
  return src.slice(i, j > i ? j : undefined);
};

function txFalso({ entradas = [], reservas = [], lotes = [], vacinasReservadas = [] } = {}) {
  const estado = { entradas, reservas, lotes, rawReserva: [] };
  return {
    estado,
    estoqueClinica: {
      findMany: async ({ where }) => estado.entradas.filter((e) =>
        e.medicamentoId === where.medicamentoId && e.empresaId === where.empresaId && e.ativo),
      update: async ({ where, data }) => Object.assign(estado.entradas.find((e) => e.id === where.id), data),
    },
    reservaEstoque: {
      findMany: async ({ where }) => estado.reservas.filter((r) => where.estoqueId.in.includes(r.estoqueId)),
      update: async ({ where, data }) => Object.assign(estado.reservas.find((r) => r.id === where.id), data),
    },
    loteVacina: {
      findMany: async ({ where }) => estado.lotes.filter((l) =>
        l.medicamentoCatId === where.medicamentoCatId && l.empresaId === where.empresaId && l.ativo),
      update: async ({ where, data }) => Object.assign(estado.lotes.find((l) => l.id === where.id), data),
    },
    $executeRawUnsafe: async (sql, fator, loteId) => { estado.rawReserva.push({ sql, fator, loteId }); return 1; },
    $queryRawUnsafe: async () => vacinasReservadas,
  };
}

const NAO_MULTIDOSE = { multidose: false, dosesPorEmbalagem: null, formaCalculo: null, unidade: 'mL' };
const MULTIDOSE_20  = { multidose: true, dosesPorEmbalagem: 20, formaCalculo: 'mL', unidade: 'mL' };

describe('farmácia — o saldo e a RESERVA acompanham o conteúdo', () => {
  test('10 frascos em Un. viram 200 mL, e a reserva de 2 frascos vira 40 mL', async () => {
    const tx = txFalso({
      entradas: [{ id: 1, medicamentoId: 5, empresaId: 59, ativo: true, qtdEstoque: 10,
        estoqueMinimo: 1, estoqueAlarmante: 2, valorRepassado: 100 }],
      reservas: [{ id: 7, estoqueId: 1, quantidade: 2 }],
    });
    await cat.reconverterEstoqueAtivo(tx, 5, NAO_MULTIDOSE, MULTIDOSE_20, 59);
    expect(tx.estado.entradas[0]).toMatchObject({ qtdEstoque: 200, estoqueMinimo: 20, pesoPorEmbalagem: 20, precoUnitarioBase: 5 });
    expect(tx.estado.reservas[0].quantidade).toBe(40);
  });

  test('entrada de OUTRA empresa no mesmo item não é tocada', async () => {
    const tx = txFalso({ entradas: [{ id: 1, medicamentoId: 5, empresaId: 42, ativo: true, qtdEstoque: 10, estoqueMinimo: 0, estoqueAlarmante: 0, valorRepassado: 0 }] });
    await cat.reconverterEstoqueAtivo(tx, 5, NAO_MULTIDOSE, MULTIDOSE_20, 59);
    expect(tx.estado.entradas[0].qtdEstoque).toBe(10);
  });
});

describe('vacina — o LOTE é reconvertido pela mesma regra', () => {
  const lote = () => ({ id: 3, medicamentoCatId: 8, empresaId: 59, ativo: true,
    qtdTotal: 3, qtdDisponivel: 3, qtdFrascos: 3, dosesPorFrasco: 1, estoqueMinimo: 1, estoqueAlarmante: 0 });

  beforeEach(() => criarReservaVacina.mockClear());

  test('3 frascos contados em frasco viram 60 mL; qtd_frascos (o físico) não muda; a reserva é REFEITA com o produto novo', async () => {
    const tx = txFalso({ lotes: [lote()], vacinasReservadas: [{ id: 70, animalId: 5, quantidade: 1, medicamentoCatId: 8 }] });
    await cat.reconverterLotesVacinaAtivos(tx, 8, MULTIDOSE_20, 59);
    expect(tx.estado.lotes[0]).toMatchObject({ qtdTotal: 60, qtdDisponivel: 60, qtdFrascos: 3, dosesPorFrasco: 20, estoqueMinimo: 20 });
    expect(criarReservaVacina).toHaveBeenCalledWith(tx, expect.objectContaining({
      vacinaId: 70, medicamentoCatId: 8, quantidade: 1, empresaId: 59, produto: MULTIDOSE_20,
    }));
  });

  test('IDEMPOTENTE — lote já no conteúdo novo não é reconvertido nem tem a reserva refeita', async () => {
    const tx = txFalso({ lotes: [{ ...lote(), qtdDisponivel: 60, qtdTotal: 60, dosesPorFrasco: 20 }],
      vacinasReservadas: [{ id: 70, animalId: 5, quantidade: 1, medicamentoCatId: 8 }] });
    await cat.reconverterLotesVacinaAtivos(tx, 8, MULTIDOSE_20, 59);
    expect(tx.estado.lotes[0].qtdDisponivel).toBe(60);
    expect(criarReservaVacina).not.toHaveBeenCalled();
  });

  test('desmarcar o multidose volta o lote a frascos (a embalagem é a própria unidade)', async () => {
    const tx = txFalso({ lotes: [{ ...lote(), qtdDisponivel: 50, qtdTotal: 60, dosesPorFrasco: 20 }] });
    await cat.reconverterLotesVacinaAtivos(tx, 8, NAO_MULTIDOSE, 59);
    expect(tx.estado.lotes[0]).toMatchObject({ qtdDisponivel: 2.5, qtdTotal: 3, dosesPorFrasco: 1 });
  });

  test('sem empresa NÃO reconverte — nunca o item global de todas as clínicas', async () => {
    await expect(cat.reconverterLotesVacinaAtivos(txFalso(), 8, MULTIDOSE_20, null)).rejects.toThrow(/empresaId/);
  });

  test('salvar o produto SEM mudar o conteúdo não reescreve lote legado divergente', async () => {
    const tx = txFalso({ lotes: [{ ...lote(), dosesPorFrasco: 100, qtdDisponivel: 90 }] });
    await cat.reconverterSaldosDoProduto(tx, 8, NAO_MULTIDOSE, { ...NAO_MULTIDOSE }, 59);
    expect(tx.estado.lotes[0].qtdDisponivel).toBe(90);
  });
});

describe('vacina pendente — a dosagem SNAPSHOT na unidade do lote, nos dois sentidos', () => {
  test('mesma regra do registro: dose em mL com produto multidose sai crua', () => {
    expect(dosagemNaUnidadeDoLote(2, 'mL', MULTIDOSE_20)).toBe(2);
  });
  test('🔴 INVERSO: "2 mL" com o produto DESMARCADO tira UM frasco, não dois', () => {
    expect(dosagemNaUnidadeDoLote(2, 'mL', NAO_MULTIDOSE)).toBe(1);
  });
  test('inverso com conteúdo ainda declarado (frasco de 20): 45 mL = 3 frascos', () => {
    expect(dosagemNaUnidadeDoLote(45, 'mL', { ...NAO_MULTIDOSE, dosesPorEmbalagem: 20 })).toBe(3);
  });
  test('🔴 DIRETO: "1" dose registrada antes do multidose tira o frasco inteiro (20 mL)', () => {
    expect(dosagemNaUnidadeDoLote(1, null, MULTIDOSE_20)).toBe(20);
  });
  test('sem multidose e sem forma: a dose é a embalagem, como sempre', () => {
    expect(dosagemNaUnidadeDoLote(1, null, NAO_MULTIDOSE)).toBe(1);
  });
  test('LEGADO multidose sem forma: não multiplica (a dose já está no conteúdo)', () => {
    expect(dosagemNaUnidadeDoLote(5, null, { multidose: true, dosesPorEmbalagem: 20, formaCalculo: null, unidade: 'mL' })).toBe(5);
  });
});

describe('os elos que somem em silêncio', () => {
  const lib = ler('backend/src/lib/catalogoEmpresa.js');
  const reap = ler('backend/src/lib/unidadeMedicamento.js');

  test('🔴 copy-on-write: reconverte o saldo do GLOBAL ANTES de reapontá-lo para a cópia', () => {
    const ramo = trechoDe(lib, 'const estadoGlobal', 'async function aplicarCampos');
    const iConv = ramo.indexOf('reconverterSaldosDoProduto(tx, med.id, estadoGlobal, estadoCopia, empresa)');
    const iReap = ramo.indexOf('reapontarParaCopia(tx, med.id, novoId, empresa)');
    expect(iConv).toBeGreaterThan(-1);
    expect(iReap).toBeGreaterThan(iConv);
  });

  test('gravarMultidose reconverte farmácia E vacina (não só a farmácia)', () => {
    const fn = trechoDe(lib, 'async function gravarMultidose', 'async function reconverterSaldosDoProduto');
    expect(fn).toMatch(/reconverterSaldosDoProduto\(/);
  });

  test('🔴 o lote de vacina (e a vacina pendente) acompanham a cópia, sempre com a empresa no where', () => {
    const fn = trechoDe(reap, 'async function reapontarParaCopia', 'async function definirUnidadeDoMedicamento');
    expect(fn).toMatch(/loteVacina\.updateMany\(\{\s*where: \{ medicamentoCatId: deId, empresaId: empresa, ativo: true \}/);
    expect(fn).toMatch(/vacinaClinica\.updateMany/);
    expect(fn).toMatch(/animal:\s*\{ empresaId: empresa \}/);
  });

  test('🔴 Ajuste da Farmácia: o conteúdo do frasco sai do PRODUTO, nunca da linha', () => {
    const tela = ler('frontend/src/pages/Farmacia.tsx');
    const bloco = trechoDe(tela, 'const itemAjuste =', 'const fecharAjuste');
    expect(bloco).toMatch(/conteudoDaEmbalagem\(item\?\.medicamento/);
    expect(bloco).not.toMatch(/pesoPorEmbalagem/);
    expect(tela).not.toMatch(/const mpf = i\.pesoPorEmbalagem/);
  });

  test('🔴 reserva E baixa da vacina passam pela conversão (nunca a dosagem crua no lote)', () => {
    const ctrl = ler('backend/src/controllers/VacinaClinicaController.js');
    const reserva = trechoDe(ctrl, 'async function criarReservaVacina', 'async function consumirReservaVacina');
    expect(reserva).toMatch(/let restante = await qtdNoLoteDaVacina\(/);
    const baixa = trechoDe(ctrl, 'async function darBaixaEFaturar', 'contasPagar.lancarItem');
    expect(baixa).toMatch(/const qtdLote = await qtdNoLoteDaVacina\(/);
    expect(baixa).toMatch(/qtdDisponivel: \{ decrement: qtdLote \}/);
    expect(baixa).not.toMatch(/decrement: qtd \}/);
  });

  test('Ajuste do Estoque de Vacinas oferece FRASCOS (conteúdo do lote ≠ 1)', () => {
    const tela = ler('frontend/src/pages/EstoqueVacina.tsx');
    expect(tela).toMatch(/setAjusteQtd\(arred2\(f \* conteudoAjuste\)\)/);
    expect(tela).toMatch(/const usaFrascosAjuste = !!loteAjuste && conteudoAjuste !== 1/);
  });
});
