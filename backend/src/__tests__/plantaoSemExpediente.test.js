'use strict';

/**
 * 🔴 A EXECUÇÃO DE PRESCRIÇÃO NÃO SEGUE O EXPEDIENTE DA EMPRESA (2026-09-22).
 *
 * A fila do plantão é recortada por `buildAnimalScopeWhere`, e a opção "Atender
 * somente no local de trabalho" (`MembroEquipe.restringirPorLocal`) estreitava esse
 * recorte pelos locais em que o profissional trabalha **HOJE**. Como os dias do
 * local são VALIDADOS contra o expediente da empresa
 * (`EquipeController.validarLocaisContraExpedienteEmpresa`), numa clínica seg–sex
 * ninguém consegue sequer ser cadastrado para o sábado — e a fila do fim de semana
 * nascia VAZIA, com as doses daquele dia sendo depois canceladas pelo cron de dose
 * perdida.
 *
 * 🔴 O MODO DE QUEBRAR ISTO É SILENCIOSO: nenhuma tela dá erro, nenhum log registra
 * nada. A prescrição simplesmente não aparece, e quem está de plantão conclui que
 * "não tem nada para aplicar hoje". Por isso o gate é metade EXECUTÁVEL (a regra de
 * quais locais a restrição libera) e metade ESTRUTURAL (o elo que some sem aviso: a
 * opção que o plantão passa ao escopo).
 *
 * ⚠️ O que este gate NÃO afrouxa: o recorte por LOCAL. Quem atende só no Haras A
 * continua sem enxergar o paciente do Haras B — a restrição é de ONDE, e é o DIA que
 * não pode decidir se uma dose já prescrita pode ser aplicada.
 */

// `lib/prisma` é TypeScript e o babel-jest deste projeto não tem preset de TS.
// `{ virtual: true }` pelo mesmo motivo dos demais testes: sem ele o jest RESOLVE o
// módulo antes de trocá-lo (falha só no run COMPLETO).
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * Comentário NÃO é código. Sem isto a varredura se satisfaz com o próprio comentário
 * que EXPLICA a regra — e um gate que aprova a documentação em vez do comportamento
 * é um gate que se aprende a ignorar (mesma lição de `cargoPrestador`).
 */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Recorta o corpo de uma função nomeada, para a asserção não vazar para o arquivo todo. */
function corpoDaFuncao(src, nome) {
  const i = src.indexOf(nome);
  expect(i).toBeGreaterThan(-1);
  const abre = src.indexOf('{', i);
  let nivel = 0;
  for (let p = abre; p < src.length; p++) {
    if (src[p] === '{') nivel++;
    if (src[p] === '}') { nivel--; if (nivel === 0) return src.slice(abre, p + 1); }
  }
  throw new Error(`corpo de ${nome} não fechou`);
}

const { locaisPermitidos } = require('../lib/animalScope');

// Segunda a sexta — é o que o expediente da empresa permite cadastrar numa clínica
// que não abre no fim de semana.
const SEG_A_SEX = '1,2,3,4,5';
const locais = [
  { localizacaoId: 10, diasTrabalho: SEG_A_SEX },
  { localizacaoId: 20, diasTrabalho: '3,4' },
];

// `locaisPermitidos` lê o dia de HOJE do relógio do servidor (`new Date().getDay()`),
// então o teste fixa o relógio em vez de depender do dia em que a suíte roda.
function comDiaDaSemana(diaSemana, fn) {
  const real = Date.prototype.getDay;
  // 0=Dom … 6=Sáb — o mesmo mapa de `diaDaSemanaLocal`.
  Date.prototype.getDay = function getDayFixo() { return diaSemana; };
  try { return fn(); } finally { Date.prototype.getDay = real; }
}

describe('locaisPermitidos — o DIA recorta a lista de Pacientes, não o plantão', () => {
  test('sem a opção: sábado não libera nenhum local (é o comportamento da tela de Pacientes)', () => {
    expect(comDiaDaSemana(6, () => locaisPermitidos(locais))).toEqual([]);
  });

  test('sem a opção: quarta libera só os locais daquele dia', () => {
    expect(comDiaDaSemana(3, () => locaisPermitidos(locais)).sort()).toEqual([10, 20]);
    expect(comDiaDaSemana(1, () => locaisPermitidos(locais))).toEqual([10]);
  });

  test('COM a opção: sábado e domingo liberam TODOS os locais do profissional', () => {
    for (const fimDeSemana of [0, 6]) {
      const ids = comDiaDaSemana(fimDeSemana, () => locaisPermitidos(locais, true));
      expect(ids.sort()).toEqual([10, 20]);
    }
  });

  test('COM a opção: a lista não muda conforme o dia — a dose não espera a clínica abrir', () => {
    const porDia = [0, 1, 2, 3, 4, 5, 6]
      .map(d => comDiaDaSemana(d, () => locaisPermitidos(locais, true)).sort().join(','));
    expect(new Set(porDia).size).toBe(1);
  });

  test('o LOCAL continua recortando: local de outro profissional nunca entra', () => {
    const ids = comDiaDaSemana(6, () => locaisPermitidos(locais, true));
    expect(ids).not.toContain(99);
  });

  test('local repetido não duplica o id (o filtro vira `in: [...]`)', () => {
    const repetidos = [
      { localizacaoId: 10, diasTrabalho: '1' },
      { localizacaoId: 10, diasTrabalho: '6' },
    ];
    expect(comDiaDaSemana(6, () => locaisPermitidos(repetidos, true))).toEqual([10]);
  });

  test('restrição ligada e NENHUM local cadastrado segue sendo lista vazia', () => {
    // Não é regressão: quem ligou a opção decidiu que aquele profissional só alcança
    // o que lhe foi dado. Colapsar isto em "sem restrição" daria acesso à base inteira.
    expect(comDiaDaSemana(6, () => locaisPermitidos([], true))).toEqual([]);
    expect(comDiaDaSemana(6, () => locaisPermitidos(null, true))).toEqual([]);
  });
});

describe('o elo que some sem aviso — quem passa a opção, e quem não passa', () => {
  const plantao = semComentarios(ler('controllers/PrescricaoGrupoController.js'));

  test('listarParaExecucao pede o escopo IGNORANDO o dia de trabalho', () => {
    const corpo = corpoDaFuncao(plantao, 'const listarParaExecucao');
    expect(corpo).toMatch(/buildAnimalScopeWhere\(\s*req\s*,\s*\{\s*ignorarDiaDeTrabalho:\s*true\s*\}\s*\)/);
  });

  test('a lista de Pacientes NÃO passa a opção — lá o recorte por dia é o sentido da regra', () => {
    const animais = semComentarios(ler('controllers/AnimalController.js'));
    expect(animais).not.toMatch(/ignorarDiaDeTrabalho/);
  });

  test('buildAnimalScopeWhere repassa a opção às DUAS restrições (membro e prestador)', () => {
    const escopo = semComentarios(ler('lib/animalScope.js'));
    expect(escopo).toMatch(/localizacoesRestritasDeHoje\(\s*userId\s*,\s*req\.equipeId\s*,\s*ignorarDiaDeTrabalho\s*\)/);
    expect(escopo).toMatch(/localizacoesRestritasDoPrestador\(\s*userId\s*,\s*ignorarDiaDeTrabalho\s*\)/);
  });

  test('a designação continua sendo ESTREITADA pelo local do prestador, nunca substituída', () => {
    // Trocar o AND por uma substituição daria ao prestador paciente que ninguém designou.
    const escopo = semComentarios(ler('lib/animalScope.js'));
    expect(escopo).toMatch(/AND:\s*\[\s*designacoesBase\s*,\s*\{\s*localizacaoId:\s*\{\s*in:\s*restricaoPrestador\s*\}/);
  });
});
