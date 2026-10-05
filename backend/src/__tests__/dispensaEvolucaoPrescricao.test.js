// PRESCRIÇÃO SEM EVOLUÇÃO (2026-10-03) — lib/dispensaEvolucaoPrescricao.js.
// Padrão: TODA prescrição exige evolução. O que a empresa libera em Cadastro da
// Empresa › Funcionamento (especialidade, procedimento ou classificação de
// medicamento) pode ser prescrito sem evolução — e a prescrição INTEIRA precisa estar
// liberada. Os gates estruturais travam os três pontos de entrada: sem eles, incluir
// ou trocar um item depois seria o atalho para o que a criação recusa.
'use strict';

const fs   = require('fs');
const path = require('path');
const lib  = require('../lib/dispensaEvolucaoPrescricao');

const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function clienteFalso({ regras = null, meds = [], procs = [], combos = [] } = {}) {
  return {
    $queryRawUnsafe: jest.fn(async () => [{ v: regras }]),
    medicamento:             { findMany: jest.fn(async () => meds) },
    procedimentoVeterinario: { findMany: jest.fn(async () => procs) },
    procedimentoCombo:       { findMany: jest.fn(async () => combos) },
  };
}

beforeEach(() => lib.invalidarCache());

describe('normalizarRegras', () => {
  it('undefined não altera; vazio vira "nada liberado"', () => {
    expect(lib.normalizarRegras(undefined)).toEqual({ valor: undefined });
    expect(lib.normalizarRegras('')).toEqual({ valor: { especialidades: [], procedimentos: [], classificacoes: [] } });
  });
  it('aceita JSON em string (multipart), tira repetido sem olhar caixa/acento', () => {
    const r = lib.normalizarRegras(JSON.stringify({ procedimentos: ['Ferrageamento', 'ferrageamento', ' '], classificacoes: ['Antibiótico', 'antibiotico'] }));
    expect(r.valor.procedimentos).toEqual(['Ferrageamento']);
    expect(r.valor.classificacoes).toEqual(['Antibiótico']);
  });
  it('recusa JSON inválido ou lista no lugar de objeto', () => {
    expect(lib.normalizarRegras('{x').erro).toBeTruthy();
    expect(lib.normalizarRegras('[1]').erro).toBeTruthy();
  });
});

describe('itemDispensado (puro)', () => {
  const regras = { especialidades: ['Fisioterapia'], procedimentos: ['Ferrageamento'], classificacoes: ['Antiparasitário'] };
  it('padrão (nada liberado) exige evolução para tudo', () => {
    expect(lib.itemDispensado(null, { tipo: 'PROCEDIMENTO', medicamento: 'Ferrageamento' })).toBe(false);
  });
  it('procedimento liberado pelo NOME, sem caixa nem acento', () => {
    expect(lib.itemDispensado(regras, { tipo: 'PROCEDIMENTO', medicamento: ' FERRAGEAMENTO ' })).toBe(true);
  });
  it('procedimento liberado pela ESPECIALIDADE resolvida no catálogo', () => {
    expect(lib.itemDispensado(regras, { tipo: 'PROCEDIMENTO', medicamento: 'Laser' }, { especialidades: ['fisioterapia'] })).toBe(true);
    expect(lib.itemDispensado(regras, { tipo: 'PROCEDIMENTO', medicamento: 'Laser' }, { especialidades: ['Cardiologia'] })).toBe(false);
  });
  it('medicamento liberado pela CLASSIFICAÇÃO; sem classificação nunca', () => {
    expect(lib.itemDispensado(regras, { tipo: 'MEDICAMENTO' }, { classificacao: 'antiparasitario' })).toBe(true);
    expect(lib.itemDispensado(regras, { tipo: 'MEDICAMENTO' }, { classificacao: null })).toBe(false);
  });
});

describe('verificarItensSemEvolucao (catálogo)', () => {
  const regras = { especialidades: ['Fisioterapia'], procedimentos: [], classificacoes: ['Antiparasitário'] };

  it('passa quando TODOS os itens estão liberados', async () => {
    const client = clienteFalso({
      regras,
      meds:  [{ id: 7, classificacao: 'Antiparasitário' }],
      procs: [{ nome: 'Laser', especialidade: 'Fisioterapia' }],
    });
    const r = await lib.verificarItensSemEvolucao(client, 58, [
      { tipo: 'MEDICAMENTO', medicamento: 'Ivermectina', medicamentoCatId: 7 },
      { tipo: 'PROCEDIMENTO', medicamento: 'laser' },
    ]);
    expect(r.ok).toBe(true);
  });

  it('um item não liberado recusa a prescrição inteira e diz QUAL', async () => {
    const client = clienteFalso({ regras, meds: [{ id: 9, classificacao: 'Antibiótico' }] });
    const r = await lib.verificarItensSemEvolucao(client, 58, [
      { tipo: 'MEDICAMENTO', medicamento: 'Penicilina', medicamentoCatId: 9 },
    ]);
    expect(r.ok).toBe(false);
    expect(lib.mensagemExigeEvolucao(r.item)).toMatch(/Penicilina/);
  });

  it('medicamento DIGITADO À MÃO (sem catálogo) nunca é liberado', async () => {
    const client = clienteFalso({ regras });
    const r = await lib.verificarItensSemEvolucao(client, 58, [{ tipo: 'MEDICAMENTO', medicamento: 'Qualquer' }]);
    expect(r.ok).toBe(false);
  });

  it('a especialidade vem do CATÁLOGO, não do corpo da requisição', async () => {
    const client = clienteFalso({ regras, procs: [{ nome: 'Cirurgia', especialidade: 'Cirurgia' }] });
    const r = await lib.verificarItensSemEvolucao(client, 58, [
      { tipo: 'PROCEDIMENTO', medicamento: 'Cirurgia', especialidade: 'Fisioterapia' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('sem nada liberado (padrão) recusa sem consultar o catálogo', async () => {
    const client = clienteFalso({ regras: null });
    const r = await lib.verificarItensSemEvolucao(client, 58, [{ tipo: 'PROCEDIMENTO', medicamento: 'X' }]);
    expect(r.ok).toBe(false);
    expect(client.procedimentoVeterinario.findMany).not.toHaveBeenCalled();
  });

  it('coluna ausente (migration não aplicada) = nada liberado', async () => {
    const client = clienteFalso();
    client.$queryRawUnsafe = jest.fn(async () => { throw new Error('column does not exist'); });
    const r = await lib.verificarItensSemEvolucao(client, 58, [{ tipo: 'PROCEDIMENTO', medicamento: 'X' }]);
    expect(r.ok).toBe(false);
  });
});

describe('salvarRegras sem a coluna', () => {
  const semColuna = () => ({ $executeRawUnsafe: jest.fn(async () => { const e = new Error('column "dispensa_evolucao_prescricao" does not exist'); throw e; }) });
  it('gravar "nada" é ignorado; gravar alguma liberação devolve 400', async () => {
    await expect(lib.salvarRegras(semColuna(), 58, null, { procedimentos: [] })).resolves.toBeUndefined();
    await expect(lib.salvarRegras(semColuna(), 58, null, { procedimentos: ['X'] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('GATE estrutural — os três pontos de entrada da prescrição', () => {
  const src = semComentarios(fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'PrescricaoGrupoController.js'), 'utf8'));
  const corpo = (nome) => {
    const ini = src.indexOf(`const ${nome} = async`);
    expect(ini).toBeGreaterThan(-1);
    return src.slice(ini, src.indexOf('\n};', ini));
  };

  it('criar NÃO recusa a falta de evolução sem consultar a liberação', () => {
    const c = corpo('criar');
    expect(c).not.toMatch(/if \(!evolucaoId\) return res\.status\(400\)/);
    expect(c).toMatch(/verificarItensSemEvolucao/);
    expect(c).toMatch(/evolucaoId:\s*evolucaoId \? Number\(evolucaoId\) : null/);
  });
  it('adicionarItem e atualizarItem conferem a liberação em grupo sem evolução', () => {
    expect(corpo('adicionarItem')).toMatch(/!grupo\.evolucaoId[\s\S]*verificarItensSemEvolucao/);
    expect(corpo('atualizarItem')).toMatch(/!item\.grupo\?\.evolucaoId[\s\S]*verificarItensSemEvolucao/);
  });
  it('a rota de leitura das regras é LITERAL e vem antes de /:id', () => {
    const rotas = fs.readFileSync(path.join(__dirname, '..', 'routes', 'prescricoes.js'), 'utf8');
    const iLit = rotas.indexOf("'/dispensa-evolucao'");
    expect(iLit).toBeGreaterThan(-1);
    expect(iLit).toBeLessThan(rotas.indexOf("'/:id'"));
  });
});
