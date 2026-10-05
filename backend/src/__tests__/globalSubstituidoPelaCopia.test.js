'use strict';
/**
 * 🔴 ITEM GLOBAL NUNCA É ALTERADO; HAVENDO A CÓPIA DA EMPRESA, SÓ ELA APARECE (2026-10-02).
 *
 * Caso real (Patyvet): "Ourovac® Raiva - frasco 50 mL" editada em /cadastro/produtos
 * criou a cópia da clínica; a entrada de estoque de vacinas listava as DUAS, a pessoa
 * escolheu a global e o lote nasceu nela — a Prescrição (que só mostra a cópia) ficou
 * sem estoque, em silêncio. Este gate trava os pontos que esconderiam o global e o
 * desvio do lote para a cópia.
 */
const fs   = require('fs');
const path = require('path');

const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const trecho = (src, ini, fim) => {
  const a = src.indexOf(ini);
  const b = src.indexOf(fim, a + ini.length);
  return src.slice(a, b === -1 ? undefined : b);
};

describe('global substituído pela cópia da empresa', () => {
  const vac  = semComentarios(ler('controllers/EstoqueVacinaController.js'));
  const prod = semComentarios(ler('controllers/ProdutoController.js'));
  const med  = semComentarios(ler('controllers/MedicamentoController.js'));

  test('seletor da Entrada de Estoque de vacinas esconde o global homônimo', () => {
    const fn = trecho(vac, 'const listarVacinasPorFabricante', 'const listarCatalogoComEstoque');
    expect(fn).toMatch(/empresa_id AS "empresaId"/);
    expect(fn).toMatch(/rows = preferirCopiaDaEmpresa\(rows\)/);
  });

  test('catálogo com estoque também prefere a cópia', () => {
    const fn = trecho(vac, 'const listarCatalogoComEstoque', 'function normLote');
    expect(fn).toMatch(/preferirCopiaDaEmpresa/);
    expect(fn).toMatch(/empresa_id AS "empresaId"/);
  });

  test('o lote é desviado para a cópia ANTES de ler o conteúdo do frasco do catálogo', () => {
    const fn = trecho(vac, 'const criar = async', 'const atualizar');
    const iDesvio = fn.indexOf('copiaExistente(prisma');
    const iDoses  = fn.indexOf('dosesDoCatalogo(');
    expect(iDesvio).toBeGreaterThan(-1);
    expect(iDoses).toBeGreaterThan(iDesvio);
    expect(fn).toMatch(/medicamentoCatId = copia\.id/);
  });

  test('Cadastro > Produtos filtra o global substituído NO BANCO (paginação)', () => {
    expect(prod).toMatch(/idsGlobaisSubstituidos\(prisma, req\.empresaId\)/);
    expect(prod).toMatch(/id: \{ notIn: substituidos \}/);
  });

  test('listarVacinas (catálogo) prefere a cópia', () => {
    const fn = trecho(med, 'const listarVacinas', 'const listarEspecies');
    expect(fn).toMatch(/preferirCopiaDaEmpresa\(vacinas\)/);
  });
});

describe('idsGlobaisSubstituidos', () => {
  const { idsGlobaisSubstituidos } = require('../lib/catalogoManual');

  test('sem empresa não consulta e devolve vazio', async () => {
    const client = { $queryRawUnsafe: jest.fn() };
    await expect(idsGlobaisSubstituidos(client, null)).resolves.toEqual([]);
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  test('consulta globais com cópia DA EMPRESA pelo nome sem caixa/espaço', async () => {
    const client = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 1582 }]) };
    await expect(idsGlobaisSubstituidos(client, 59)).resolves.toEqual([1582]);
    const [sql, emp] = client.$queryRawUnsafe.mock.calls[0];
    expect(sql).toMatch(/g\.empresa_id IS NULL/);
    expect(sql).toMatch(/c\.empresa_id = \$1/);
    expect(sql).toMatch(/lower\(btrim\(c\.nome\)\) = lower\(btrim\(g\.nome\)\)/);
    expect(emp).toBe(59);
  });
});
