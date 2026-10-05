'use strict';

/**
 * Gate: TODA pílula/aba de status da aplicação mostra a sua quantidade (2026-10-02).
 *
 * O pedido nasceu do histórico de Exames, que só contava o "Todos". A falha é
 * SILENCIOSA nos dois sentidos — a aba sem número continua funcionando, e a aba com
 * número contado por OUTRA regra mostra um valor que a lista não confirma. Por isso o
 * gate trava (a) o helper do backend e (b) cada tela/controller que passou a contar.
 */

const fs   = require('fs');
const path = require('path');

const { querContagens, contarAtivosInativos } = require('../lib/contagemAtivos');

const RAIZ  = path.join(__dirname, '..', '..', '..');
const ler   = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('lib/contagemAtivos', () => {
  test('só conta quando a tela pede (opt-in)', () => {
    expect(querContagens({ contagens: '1' })).toBe(true);
    expect(querContagens({ contagens: 'true' })).toBe(true);
    expect(querContagens({})).toBe(false);
    expect(querContagens(undefined)).toBe(false);
  });

  test('conta sobre o MESMO where, sem o próprio filtro de ativo', async () => {
    const chamadas = [];
    const delegate = {
      count: async ({ where }) => { chamadas.push(where); return where.ativo ? 7 : 3; },
    };
    const where = { ativo: true, empresaId: 58, OR: [{ nome: 'x' }] };
    const r = await contarAtivosInativos(delegate, where);
    expect(r).toEqual({ all: 10, ativo: 7, inativo: 3 });
    // Busca e escopo continuam valendo; só o `ativo` é trocado.
    expect(chamadas).toEqual([
      { empresaId: 58, OR: [{ nome: 'x' }], ativo: true },
      { empresaId: 58, OR: [{ nome: 'x' }], ativo: false },
    ]);
    // E não mexe no where original (a lista ainda o usa).
    expect(where.ativo).toBe(true);
  });
});

describe('backend — cada listagem devolve `contagens`', () => {
  const casos = [
    ['EvolucaoController',            /evolucaoClinica\.groupBy/],
    ['OrcamentoController',           /orcamento\.groupBy/],
    ['FornecedorController',          /contarAtivosInativos\(prisma\.fornecedor/],
    ['PrestadorController',           /contarAtivosInativos\(prisma\.prestador/],
    ['TratadorController',            /contarAtivosInativos\(prisma\.tratador/],
    ['LocalizacaoAnimalController',   /contarAtivosInativos\(prisma\.localizacaoAnimal/],
    ['ProdutoController',             /contarAtivosInativos\(prisma\.medicamento/],
    ['MedicamentoController',         /contarAtivosInativos\(prisma\.medicamento/],
    ['ProcedimentoCadastroController', /querContagens\(req\.query\)/],
    ['EstoqueController',             /querContagens\(req\.query\)/],
    ['ProprietarioController',        /inativosNaLista/],
  ];
  test.each(casos)('%s conta e responde', (ctrl, padrao) => {
    const codigo = semComentarios(ler(`backend/src/controllers/${ctrl}.js`));
    expect(codigo).toMatch(padrao);
    expect(codigo).toMatch(/contagens[,\s}]/);
  });

  test('Evolução e Orçamento contam SEM o próprio filtro de status', () => {
    for (const ctrl of ['EvolucaoController', 'OrcamentoController']) {
      const codigo = semComentarios(ler(`backend/src/controllers/${ctrl}.js`));
      expect(codigo).toMatch(/const \{ status: _semStatus, \.\.\.whereContagem \} = where/);
    }
  });

  test('a aba "Controlados" da Farmácia recorta de verdade', () => {
    const codigo = semComentarios(ler('backend/src/controllers/EstoqueController.js'));
    expect(codigo).toMatch(/controlado === 'true'/);
  });
});

describe('frontend — cada barra de status exibe a quantidade', () => {
  test('Exames conta TODA pílula pela mesma regra do filtro', () => {
    const t = semComentarios(ler('frontend/src/pages/SubModuloExames.tsx'));
    expect(t).toMatch(/acc\[getStatusExame\(ex\)\]\+\+/);
    expect(t).toMatch(/contagemExames\[f\.key\]/);
    // O "só no Todos" de 2026-09-30 não volta.
    expect(t).not.toMatch(/f\.key === 'todos' && \(/);
  });

  test('Evolução lê as contagens do backend', () => {
    const t = semComentarios(ler('frontend/src/pages/SubModuloEvolucao.tsx'));
    expect(t).toMatch(/setContagens\(res\.data\.contagens/);
    expect(t).toMatch(/contagens\[f\.value\]/);
  });

  test('Orçamento e Agenda numeram as opções do seletor', () => {
    expect(semComentarios(ler('frontend/src/pages/Orcamento.tsx'))).toMatch(/contagensOrc\.RASCUNHO/);
    const ag = semComentarios(ler('frontend/src/pages/Agendamentos.tsx'));
    expect(ag).toMatch(/statusCasaFiltro\(ag\.status, filtro\)/);
    expect(ag).toMatch(/contagemStatus\('ABERTOS'\)/);
  });

  test.each([
    'CadastroFornecedor', 'CadastroPrestador', 'CadastroTratador', 'CadastroLocalizacao',
    'CadastroProprietario', 'CadastroProcedimento', 'Produtos', 'Equipe', 'AnimaisVet', 'Medicamentos',
  ])('%s mostra a quantidade em Todos/Ativos/Inativos', (tela) => {
    const t = semComentarios(ler(`frontend/src/pages/${tela}.tsx`));
    expect(t).toMatch(/sufixoContagem\(/);
  });

  test('as telas que filtram no SERVIDOR pedem a contagem', () => {
    for (const tela of ['CadastroFornecedor', 'CadastroPrestador', 'CadastroTratador',
      'CadastroLocalizacao', 'CadastroProcedimento', 'Produtos', 'Medicamentos', 'Farmacia']) {
      expect(semComentarios(ler(`frontend/src/pages/${tela}.tsx`))).toMatch(/contagens['"]?\s*[:,=]\s*['"]?1|'contagens', '1'/);
    }
  });

  test('Estoque de Vacinas conta pela MESMA função que filtra', () => {
    const t = semComentarios(ler('frontend/src/pages/EstoqueVacina.tsx'));
    expect(t).toMatch(/lotesDaAba = lotes\.filter\(l => loteNaAba\(l, filtroTab\)\)/);
    expect(t).toMatch(/contarAba\(key\)/);
  });
});
