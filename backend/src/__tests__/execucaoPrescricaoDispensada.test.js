// backend/src/__tests__/execucaoPrescricaoDispensada.test.js
//
// ETAPA DE EXECUÇÃO DE PRESCRIÇÃO OPCIONAL POR EMPRESA (2026-09-24).
//
// Configurações → "Não utilizar a etapa de Execução de Prescrição". Marcada, a fatura,
// a baixa de estoque e o pagamento do prestador saem na FINALIZAÇÃO da prescrição
// (medicamento e procedimento) e da vacina, e o documento já nasce EXECUTADO.
//
// 🔴 Os elos quebram EM SILÊNCIO: se `finalizar` deixar de consultar a opção, a
// clínica sem plantão simplesmente nunca cobra — nada falha, a fatura só fica vazia.
// E se a CASCATA da finalização do atendimento não encerrar o que promove, a prescrição
// fechada junto da evolução fica FINALIZADA para sempre. Este gate trava os dois.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const semComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
/** Corpo de uma função a partir da sua assinatura, contando chaves. */
function corpoDe(src, assinatura) {
  const ini = src.indexOf(assinatura);
  if (ini < 0) throw new Error(`assinatura não encontrada: ${assinatura}`);
  // O corpo começa na `{` logo depois do `)` da lista de parâmetros (ou do `=>`) —
  // NUNCA na primeira `{`, que pode ser a desestruturação da assinatura.
  const abre = /\)\s*(=>\s*)?\{/g;
  abre.lastIndex = ini;
  const m = abre.exec(src);
  const i = m.index + m[0].length - 1;
  let prof = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') prof++;
    else if (src[j] === '}' && --prof === 0) return src.slice(ini, j + 1);
  }
  throw new Error('corpo não fechado');
}

const etapa = require('../lib/etapaExecucaoPrescricao');

describe('lib/etapaExecucaoPrescricao — a opção', () => {
  beforeEach(() => etapa.invalidarCache());

  it('normaliza o que vem do multipart', () => {
    expect(etapa.normalizarDispensa(undefined)).toEqual({ valor: undefined });
    expect(etapa.normalizarDispensa('true')).toEqual({ valor: true });
    expect(etapa.normalizarDispensa('false')).toEqual({ valor: false });
    expect(etapa.normalizarDispensa('')).toEqual({ valor: false });
    expect(etapa.normalizarDispensa(true)).toEqual({ valor: true });
    expect(etapa.normalizarDispensa('talvez').erro).toBeTruthy();
  });

  it('sem empresa, NÃO dispensa (comportamento de sempre)', async () => {
    const client = { $queryRawUnsafe: jest.fn() };
    expect(await etapa.execucaoDispensada(client, null)).toBe(false);
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('base sem a coluna (migration pendente) NÃO dispensa e não lança', async () => {
    const client = { $queryRawUnsafe: jest.fn(async () => { throw new Error('column does not exist'); }) };
    expect(await etapa.execucaoDispensada(client, 5)).toBe(false);
  });

  it('lê o valor gravado — e prefere a linha da EMPRESA à de uma equipe', async () => {
    const client = { $queryRawUnsafe: jest.fn(async () => [{ v: true }]) };
    expect(await etapa.execucaoDispensada(client, 7)).toBe(true);
    expect(client.$queryRawUnsafe.mock.calls[0][0]).toMatch(/ORDER BY "equipeId" NULLS FIRST/);
  });

  it('gravar false numa base sem a coluna é ignorado; gravar true devolve 400', async () => {
    const semColuna = { $executeRawUnsafe: jest.fn(async () => {
      throw new Error('column "dispensar_execucao_prescricao" does not exist');
    }) };
    await expect(etapa.salvarDispensa(semColuna, 1, null, false)).resolves.toBeUndefined();
    await expect(etapa.salvarDispensa(semColuna, 1, null, true)).rejects.toMatchObject({ status: 400 });
  });

  it('a migration é ADITIVA e NÃO nasce marcada', () => {
    const dir = path.join(__dirname, '..', '..', 'prisma', 'migrations',
      '20261023000000_empresa_dispensar_execucao_prescricao');
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "dispensar_execucao_prescricao" BOOLEAN NOT NULL DEFAULT false/);
    expect(sql).not.toMatch(/UPDATE/i);
  });
});

describe('cascata da finalização do atendimento — empresa sem etapa de execução', () => {
  function carregar({ dispensada }) {
    jest.resetModules();
    jest.doMock('../lib/prisma', () => ({ default: {} }), { virtual: true });
    jest.doMock('../lib/faturaUtils', () => ({ lancarExameNaFatura: jest.fn() }));
    jest.doMock('../lib/concorrenciaRegistro', () => ({ invalidarVersoes: jest.fn(async () => {}) }));
    jest.doMock('../lib/etapaExecucaoPrescricao', () => ({ execucaoDispensada: jest.fn(async () => dispensada) }));
    const encerrarGrupoSemExecucao = jest.fn(async () => ({ lancados: 1 }));
    const executarNaFinalizacao    = jest.fn(async () => true);
    jest.doMock('../controllers/PrescricaoGrupoController', () => ({ encerrarGrupoSemExecucao }));
    jest.doMock('../controllers/VacinaClinicaController', () => ({ executarNaFinalizacao }));
    const { cascataDaFinalizacao } = require('../lib/finalizacaoEvolucao');
    return { cascataDaFinalizacao, encerrarGrupoSemExecucao, executarNaFinalizacao };
  }

  function txFalso() {
    return {
      agendamentoClinico: { updateMany: async () => ({ count: 0 }) },
      prescricaoGrupo: {
        findMany:   async () => [{ id: 7 }],
        updateMany: async () => ({ count: 1 }),
      },
      prescricao:      { updateMany: async () => ({ count: 1 }) },
      evolucaoClinica: { findUnique: async () => ({ empresaId: 42 }) },
      $queryRawUnsafe:   jest.fn(async () => [{ id: 5 }]),
      $executeRawUnsafe: jest.fn(async () => 1),
    };
  }

  afterEach(() => jest.resetModules());

  it('🔴 DISPENSADA: encerra a prescrição e a vacina promovidas, na MESMA transação', async () => {
    const m  = carregar({ dispensada: true });
    const tx = txFalso();
    const r  = await m.cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });
    expect(m.encerrarGrupoSemExecucao).toHaveBeenCalledWith(tx, 7, expect.objectContaining({ empresaId: 42, porUsuarioId: 9 }));
    expect(m.executarNaFinalizacao).toHaveBeenCalledWith(tx, 5, expect.objectContaining({ empresaId: 42, veterinarioId: 9 }));
    expect(r.encerradosSemExecucao).toBe(2);
  });

  it('PADRÃO (não dispensada): nada é encerrado — os filhos vão ao plantão', async () => {
    const m  = carregar({ dispensada: false });
    const tx = txFalso();
    const r  = await m.cascataDaFinalizacao(tx, 50, { porUsuarioId: 9 });
    expect(m.encerrarGrupoSemExecucao).not.toHaveBeenCalled();
    expect(m.executarNaFinalizacao).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(r.encerradosSemExecucao).toBe(0);
  });
});

describe('GATE ESTRUTURAL — os elos que somem em silêncio', () => {
  const presc = semComentarios(ler('controllers/PrescricaoGrupoController.js'));
  const vac   = semComentarios(ler('controllers/VacinaClinicaController.js'));

  it('`finalizar` da prescrição consulta a opção, não reserva e encerra na mesma transação', () => {
    const fin = corpoDe(presc, 'const finalizar = async (req, res)');
    expect(fin).toMatch(/etapaExecucao\.execucaoDispensada\(prisma, empresaIdEfetivo\)/);
    expect(fin).toMatch(/if \(!semExecucao\) \{\s*await criarReservas\(/);
    expect(fin).toMatch(/if \(semExecucao\) \{\s*await encerrarGrupoSemExecucao\(tx, grupoId/);
  });

  it('`encerrarGrupoSemExecucao` cobra só o que a CLÍNICA aplica, sem cobrar duas vezes', () => {
    const fn = corpoDe(presc, 'async function encerrarGrupoSemExecucao(');
    expect(fn).toMatch(/!i\.aplicadaPeloProprietario/);
    expect(fn).toMatch(/!item\.medicamentoCliente/);
    expect(fn).toMatch(/itemOrigens\.origemJaFaturada\(tx, 'prescricaoId', item\.id\)/);
    expect(fn).toMatch(/debitarEstoqueDia\(tx, itens, empresaIdEfetivo, grupo\.id, calcularQuantidadeTotal\)/);
    expect(fn).toMatch(/vinculoPrestador\.registrarExecucao\(/);
    expect(fn).toMatch(/contasPagar\.lancarItem\(/);
    expect(fn).toMatch(/status: 'EXECUTADO'/);
    expect(fn).toMatch(/liberarReservas\(tx, grupo\.id\)/);
  });

  it('`finalizar` da vacina encerra na hora quando a opção está ligada — e só o que a clínica aplica', () => {
    const fin = corpoDe(vac, 'async function finalizar(req, res)');
    expect(fin).toMatch(/!aplicaDono && await etapaExecucao\.execucaoDispensada\(prisma, empresaIdEfetivo\)/);
    expect(fin).toMatch(/executarNaFinalizacao\(tx, vacina\.id/);
    const fn = corpoDe(vac, 'async function executarNaFinalizacao(');
    expect(fn).toMatch(/info\.aplicadaPeloProprietario === true\) return false/);
    expect(fn).toMatch(/itemOrigens\.origemJaFaturada\(tx, 'vacinaClinicaId', vacina\.id\)/);
    expect(fn).toMatch(/SET status = 'EXECUTADA'/);
    expect(fn).toMatch(/agendarReforcos\(tx,/);
  });

  it('Configurações lê e grava a opção (backend e tela)', () => {
    const eq = semComentarios(ler('controllers/EquipeController.js'));
    expect(eq).toMatch(/dispensarExecucaoPrescricao: dispensaExecucao/);
    expect(eq).toMatch(/etapaExecucao\.salvarDispensa\(prisma, escopo\.empresaId, escopo\.equipeId, dispensa\.valor\)/);
    const front = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
    const hook  = fs.readFileSync(path.join(front, 'hooks', 'useConfiguracaoOperacional.ts'), 'utf8');
    expect(hook).toMatch(/fd\.append\('dispensarExecucaoPrescricao'/);
    expect(hook).toMatch(/useState\(false\)/);
    const tela  = fs.readFileSync(path.join(front, 'pages', 'CadastroEmpresa.tsx'), 'utf8');
    expect(tela).toMatch(/checked=\{op\.dispensarExecucao\}/);
  });
});
