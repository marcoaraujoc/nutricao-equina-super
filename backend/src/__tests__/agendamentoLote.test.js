// backend/src/__tests__/agendamentoLote.test.js
//
// AGENDAMENTO EM LOTE POR LOCALIDADE + tipo VERMIFUGAÇÃO (2026-10-04).
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE — modos de quebrar em silêncio:
//   1. o lote gravar METADE: um paciente recusado no meio deixaria os anteriores
//      agendados (as conferências precisam acontecer TODAS antes de gravar, e a
//      criação numa transaction só);
//   2. o conflito do profissional ser conferido POR PACIENTE — aí o 2º animal do
//      lote colidiria com o 1º (mesmo horário, mesmo profissional) e o lote nunca
//      passaria de um;
//   3. a tela mandar `VERMIFUGACAO` e o backend recusar por não conhecer o tipo, ou
//      o tipo aparecer cru ("VERMIFUGACAO") no aviso e no card do paciente.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');
const { TIPO_LABEL, descricaoAtividade } = require('../lib/notificacaoAgendamento');

const RAIZ = path.join(__dirname, '..', '..', '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const controller = semComentarios(ler('backend/src/controllers/AgendamentoController.js'));
const criar = controller.slice(controller.indexOf('criar: async'), controller.indexOf('atualizarStatus: async'));

describe('tipo VERMIFUGACAO', () => {
  test('o backend aceita o tipo', () => {
    expect(controller).toMatch(/TIPOS_VALIDOS\s*=\s*\[[^\]]*'VERMIFUGACAO'/);
  });
  test('cabe na coluna VarChar(20) — sem migration', () => {
    expect('VERMIFUGACAO'.length).toBeLessThanOrEqual(20);
  });
  test('o aviso escreve o rótulo, não a constante', () => {
    expect(TIPO_LABEL.VERMIFUGACAO).toBe('Vermifugação');
    expect(descricaoAtividade({ tipo: 'VERMIFUGACAO', titulo: 'Vermifugação - Mel', animalNome: 'Mel' }))
      .toBe('Vermifugação');
  });
  test('a tela oferece e rotula o tipo (agenda e card do paciente)', () => {
    expect(ler('frontend/src/pages/Agendamentos.tsx')).toMatch(/value: 'VERMIFUGACAO', label: 'Vermifugação'/);
    expect(ler('frontend/src/pages/AnimalDetail.tsx')).toMatch(/VERMIFUGACAO: 'Vermifugação'/);
  });
});

describe('criar em LOTE', () => {
  test('aceita animalIds e tem teto', () => {
    expect(criar).toMatch(/Array\.isArray\(animalIds\)/);
    expect(criar).toMatch(/ids\.length > LOTE_MAX_ANIMAIS/);
  });

  test('todas as conferências por paciente rodam ANTES da transaction (tudo-ou-nada)', () => {
    const loopConferencia = criar.indexOf('for (const idAnimal of ids)');
    const transacao       = criar.indexOf('prisma.$transaction');
    expect(loopConferencia).toBeGreaterThan(-1);
    expect(transacao).toBeGreaterThan(loopConferencia);
    const conferencias = criar.slice(loopConferencia, transacao);
    for (const trava of ['verificarAcessoAnimal', 'animalFoiExcluido', 'animalEstaInativo', 'HORARIO_OCUPADO', 'prestadorAutorizado']) {
      expect(conferencias).toContain(trava);
    }
  });

  test('a criação de TODOS os pacientes está dentro da MESMA transaction', () => {
    const transacao = criar.slice(criar.indexOf('prisma.$transaction'));
    const ateFimTx  = transacao.slice(0, transacao.indexOf('return criados;'));
    expect(ateFimTx).toMatch(/for \(const idAnimal of ids\)/);
    expect(ateFimTx).toContain('agendamentoClinico.create');
  });

  test('o conflito do PROFISSIONAL é conferido uma vez, fora do laço dos pacientes', () => {
    const loop     = criar.slice(criar.indexOf('for (const idAnimal of ids)'), criar.indexOf('const espIdNum'));
    expect(loop).not.toContain('conflitoDeAgenda');
    expect(criar.split('conflitoDeAgenda(vetIdNum').length - 1).toBe(1);
  });

  test('a tela manda o lote com animalIds e o tipo escolhido', () => {
    const tela = ler('frontend/src/pages/Agendamentos.tsx');
    expect(tela).toMatch(/animalIds: ids/);
    expect(tela).toMatch(/tipo: bookingTipo/);
    expect(tela).toContain('<SeletorPacientesLocalidade');
  });
});
