'use strict';

/**
 * A LINHA DO MULTIDOSE EM mL SAI EM mL NA FATURA (2026-10-02, a pedido).
 *
 * Até aqui a linha do medicamento multidose contava DOSES ("Quant.: 3 · Unitário:
 * preço da dose"). Agora conta o que saiu do frasco: "Quant.: 15 mL · Unitário: R$/mL".
 * O TOTAL não muda — muda a leitura. Isto quebra em SILÊNCIO em três lugares:
 *   · `debitarEstoqueDia` deixar de anotar o mL → a linha volta a "1 dose";
 *   · um dos três lançamentos deixar de passar a `unidade` → "Quant.: 5" sem unidade,
 *     lido como cinco doses;
 *   · a consolidação ignorar a unidade → mL somado numa linha legada de doses.
 */

jest.mock('../lib/prisma', () => ({ default: { $queryRawUnsafe: async () => [] } }), { virtual: true });

const fs = require('fs');
const path = require('path');
const unidade = require('../lib/faturaItemUnidade');

const raiz = path.join(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(raiz, rel), 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('lib/faturaItemUnidade', () => {
  test('só o mL tem unidade — o resto segue sendo dose/unidade', () => {
    expect(unidade.normalizarUnidade('mL')).toBe('mL');
    expect(unidade.normalizarUnidade(' ml ')).toBe('mL');
    expect(unidade.normalizarUnidade('ML')).toBe('mL');
    expect(unidade.normalizarUnidade('g')).toBeNull();
    expect(unidade.normalizarUnidade('Un.')).toBeNull();
    expect(unidade.normalizarUnidade(null)).toBeNull();
  });

  test('gravarUnidade descarta o que não é mL ANTES de tocar no banco', async () => {
    const exec = jest.fn();
    await unidade.gravarUnidade({ $executeRawUnsafe: exec }, 7, 'g');
    await unidade.gravarUnidade({ $executeRawUnsafe: exec }, 7, null);
    expect(exec).not.toHaveBeenCalled();
  });

  test('lista vazia não consulta o banco', async () => {
    const q = jest.fn();
    expect((await unidade.unidadesDosItens({ $queryRawUnsafe: q }, [])).size).toBe(0);
    expect(q).not.toHaveBeenCalled();
  });

  test('a leitura é UMA consulta para a lista toda, por ANY($1::int[])', () => {
    const lib = semComentarios(ler('backend/src/lib/faturaItemUnidade.js'));
    expect(lib).toMatch(/WHERE "id" = ANY\(\$1::int\[\]\) AND "unidade" IS NOT NULL/);
    expect(lib).toMatch(/SET "unidade" = \$1 WHERE "id" = \$2/);
  });
});

describe('gate estrutural — a quantidade em mL chega à fatura', () => {
  const presc = semComentarios(ler('backend/src/controllers/PrescricaoGrupoController.js'));
  const utils = semComentarios(ler('backend/src/lib/faturaUtils.js'));

  test('debitarEstoqueDia anota o mL debitado como quantidade da linha', () => {
    const fn = presc.slice(presc.indexOf('async function debitarEstoqueDia'));
    expect(fn).toMatch(/itemUnidade\.normalizarUnidade\(unidadeEstoque\) && debitadoTotal > 0/);
    expect(fn).toMatch(/unidadesDaLinha\.set\(item\.id, itemUnidade\.UNIDADE_ML\)/);
  });

  test('os TRÊS lançamentos de medicamento passam a unidade', () => {
    expect(presc).toMatch(/unidade:\s+unidadeFaturada,/);    // execução no plantão
    expect(presc).toMatch(/unidade:\s+unidadeDaEntrega,/);   // entrega ao proprietário
    expect(presc).toMatch(/unidade:\s+unidadeLinha,/);       // execução dispensada
  });

  test('a fração de mL não é arredondada para 1 na execução dispensada', () => {
    expect(presc).toMatch(/quantidade = unidadeLinha\s*\?/);
  });

  test('a consolidação só soma linha de MESMA unidade', () => {
    const fn = utils.slice(utils.indexOf('async function adicionarOuSomarFaturaItem'));
    expect(fn.slice(0, 2500)).toMatch(/\(unidades\.get\(Number\(c\.id\)\) \?\? null\) === unidadeNova/);
    expect(utils).toMatch(/if \(unidade\) await itemUnidade\.gravarUnidade\(tx, criado\.id, unidade\)/);
  });

  test('a fatura devolvida à tela traz a unidade de cada item', () => {
    const ctrl = semComentarios(ler('backend/src/controllers/FaturaController.js'));
    expect(ctrl).toMatch(/itemUnidade\.anexarUnidadeNosItens\(/);
    expect(ctrl).toMatch(/unidade:\s+unidades\.get\(Number\(item\.id\)\) \?\? null/);
  });

  test('tela, impressão e CSV exibem a quantidade com a unidade', () => {
    const tela = ler('frontend/src/pages/Faturamento.tsx');
    expect(tela).toMatch(/Quant\.: \{formatarQtdItem\(item\.quantidade, item\.unidade\)\}/);
    const exp = ler('frontend/src/utils/FaturaExport.ts');
    expect(exp).toMatch(/<td class="center">\$\{formatarQtdItem\(i\.quantidade, i\.unidade\)\}<\/td>/);
    expect(exp).toMatch(/formatarQtdItem\(item\.quantidade, item\.unidade\),/);
  });

  test('a migration é aditiva e sem backfill', () => {
    const sql = ler('backend/prisma/migrations/20261101000000_fatura_item_unidade/migration.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "unidade" VARCHAR\(20\)/);
    expect(semComentarios(sql.replace(/^--.*$/gm, ''))).not.toMatch(/UPDATE|DELETE/i);
  });
});
