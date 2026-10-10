// O PACIENTE NA AUDITORIA DA EMPRESA (2026-10-09).
//
// Cadastrar e alterar paciente não deixava rastro: a trilha mostrava o paciente sendo
// inativado sem nunca ter mostrado quem o cadastrou nem quem mudou o local dele. Os
// outros cadastros (Proprietário, Tratador, Fornecedor, Prestador, Localização) já
// gravavam CRIACAO e ALTERACAO; o paciente, que é o cadastro central, não.
//
// A falha é SILENCIOSA nos dois sentidos — nada quebra, a tela funciona, e a trilha
// só não tem aquelas linhas. Por isso o gate é estrutural além do comportamento.
'use strict';

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fonte = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'AnimalController.js'), 'utf8');
const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function corpoDe(metodo) {
  const ini = semComentarios.indexOf(`async ${metodo}(req, res)`);
  expect(ini).toBeGreaterThan(-1);
  const fim = semComentarios.indexOf('\n  async ', ini + 10);
  return semComentarios.slice(ini, fim === -1 ? undefined : fim);
}

describe('gate — criar e atualizar o paciente gravam na auditoria', () => {
  test('🔴 criar grava CRIACAO ANIMAL', () => {
    const c = corpoDe('criar');
    expect(c).toMatch(/registrarAuditoria\([\s\S]{0,80}categoria:\s*'CRIACAO'[\s\S]{0,40}entidade:\s*'ANIMAL'/);
  });

  test('🔴 atualizar grava ALTERACAO ANIMAL com o antes → depois', () => {
    const c = corpoDe('atualizar');
    expect(c).toMatch(/registrarAlteracao\(prisma, req, \{[\s\S]{0,40}entidade:\s*'ANIMAL'/);
    expect(c).toMatch(/camposAlteradosDoAnimal\(animalAntes, animalAtualizado\)/);
    // O ANTES é lido antes do update — lido depois, o diff sairia sempre vazio.
    expect(c.indexOf('const animalAntes')).toBeLessThan(c.indexOf('prisma.animal.update'));
  });
});

describe('camposAlteradosDoAnimal — o diff é legível', () => {
  let camposAlteradosDoAnimal;
  beforeAll(() => {
    // O controller puxa meio backend; só as duas funções puras interessam aqui.
    const ini = fonte.indexOf('function retratoAuditavelDoAnimal');
    const fim = fonte.indexOf('class AnimalController');
    const mod = { exports: {} };
    new Function('module', `${fonte.slice(ini, fim)}\nmodule.exports = { camposAlteradosDoAnimal };`)(mod);
    ({ camposAlteradosDoAnimal } = mod.exports);
  });

  const base = {
    nome: 'Thor', especie: { nome: 'Equino' }, raca: { nome: 'Mangalarga' }, sexo: 'M',
    peso: 450, localizacao: { nome: 'Haras A' }, baia: '3', registradoFei: false, avulso: false,
  };

  const mudados = (campos) => Object.entries(campos)
    .filter(([, v]) => String(v.de ?? '') !== String(v.para ?? ''))
    .map(([k]) => k);

  test('salvar sem mudar nada não produz campo alterado (nenhuma linha na trilha)', () => {
    expect(mudados(camposAlteradosDoAnimal(base, { ...base }))).toEqual([]);
  });

  test('local e espécie saem pelo NOME, nunca pelo id', () => {
    const c = camposAlteradosDoAnimal(base, { ...base, localizacao: { nome: 'Haras B' }, peso: 470 });
    expect(mudados(c).sort()).toEqual(['Local', 'Peso']);
    expect(c.Local).toEqual({ de: 'Haras A', para: 'Haras B' });
  });

  test('booleanos viram sim/não', () => {
    const c = camposAlteradosDoAnimal(base, { ...base, registradoFei: true });
    expect(c['Cadastrado na FEI']).toEqual({ de: 'não', para: 'sim' });
  });
});
