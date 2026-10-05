'use strict';

/**
 * PACIENTE AVULSO (2026-10-04, a pedido).
 *
 * Checkbox no cadastro do paciente, gravado em coluna própria (`tb_animais.avulso`).
 * No avulso, LOCALIZAÇÃO e E-MAIL/TELEFONE do proprietário são obrigatórios — a tela
 * confere, mas é o backend que garante (`erroPacienteAvulso` em criar/atualizar).
 */

const fs   = require('fs');
const path = require('path');

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const { erroPacienteAvulso } = require('../lib/animalAvulso');

const DONO_OK = { email: 'dono@ex.com', phone: '(21) 99999-0000' };

describe('erroPacienteAvulso — a regra', () => {
  test('não avulso: nada é exigido', () => {
    expect(erroPacienteAvulso({ avulso: false, localizacaoId: null, proprietario: {}, exigirEmail: true })).toBeNull();
    expect(erroPacienteAvulso({ avulso: undefined, localizacaoId: null, proprietario: null, exigirEmail: true })).toBeNull();
  });

  test('avulso completo passa', () => {
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: 3, proprietario: DONO_OK, exigirEmail: true })).toBeNull();
  });

  test('avulso sem localização é recusado', () => {
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: null, proprietario: DONO_OK, exigirEmail: true }))
      .toMatch(/localização/);
  });

  test('avulso sem e-mail do proprietário é recusado na criação', () => {
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: 3, proprietario: { phone: '21999990000' }, exigirEmail: true }))
      .toMatch(/e-mail/);
  });

  test('avulso sem telefone do proprietário é recusado', () => {
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: 3, proprietario: { email: 'a@b.com', phone: '  ' }, exigirEmail: true }))
      .toMatch(/telefone/);
  });

  test('edição: e-mail não é exigido (o dono já existe), telefone sim', () => {
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: 3, proprietario: { phone: '21999990000' }, exigirEmail: false })).toBeNull();
    expect(erroPacienteAvulso({ avulso: true, localizacaoId: 3, proprietario: { phone: '' }, exigirEmail: false }))
      .toMatch(/telefone/);
  });

  test("multipart: 'false' (string) NÃO é avulso; 'true' é", () => {
    expect(erroPacienteAvulso({ avulso: 'false', localizacaoId: null, proprietario: null, exigirEmail: true })).toBeNull();
    expect(erroPacienteAvulso({ avulso: 'true', localizacaoId: null, proprietario: null, exigirEmail: true }))
      .toMatch(/localização/);
  });
});

describe('gate estrutural — os elos que somem em silêncio', () => {
  const ctrl = fs.readFileSync(path.join(__dirname, '../controllers/AnimalController.js'), 'utf8');
  const tela = fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/Animal.tsx'), 'utf8');

  test('criar e atualizar conferem a regra e gravam a coluna', () => {
    expect((ctrl.match(/erroPacienteAvulso\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((ctrl.match(/salvarAvulso\(prisma/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('a leitura anexa `avulso` (sem isso a edição abriria desmarcada e apagaria o valor)', () => {
    expect((ctrl.match(/anexarAvulso\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('a listagem de Pacientes devolve `avulso` (é o que alimenta o selo e o filtro)', () => {
    const listar = ctrl.slice(ctrl.indexOf('async listar('), ctrl.indexOf('async obterPorId('));
    expect(listar).toMatch(/anexarAvulso\(animais\)/);
    const lista = fs.readFileSync(path.join(__dirname, '../../../frontend/src/pages/AnimaisVet.tsx'), 'utf8');
    expect(lista).toMatch(/filtroAvulso === 'avulso'\s+&& !a\.avulso/);
    expect((lista.match(/<SeloAvulso /g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('a tela envia e carrega o campo', () => {
    expect(tela).toMatch(/avulso:\s+formData\.avulso/);
    expect(tela).toMatch(/avulso:\s+a\.avulso/);
  });
});
