// backend/src/__tests__/notificacaoAgendamento.test.js
//
// AVISO DO AGENDAMENTO AO PROFISSIONAL QUE VAI EXECUTÁ-LO (e-mail + WhatsApp).
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE — três modos de quebrar em silêncio:
//   1. ler o telefone do `users` (global) em vez do vínculo da EMPRESA e mandar o
//      WhatsApp para o número que OUTRA clínica cadastrou;
//   2. o prestador sem login sumir do aviso (ele não tem `users`);
//   3. o cadastro sem e-mail/telefone não voltar como aviso — o agendamento é salvo,
//      ninguém é avisado e quem agendou nunca fica sabendo.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');
const {
  contatoDoResponsavel, avisosDeContato, localDoAnimal, descricaoAtividade, mensagemWhatsAppProfissional,
} = require('../lib/notificacaoAgendamento');

function clienteFalso({ users = {}, vinculos = {} } = {}) {
  return {
    user: { findUnique: async ({ where }) => (users[where.id] ? { ...users[where.id] } : null) },
    usuarioEmpresa: {
      findUnique: async ({ where }) => {
        const { userId, empresaId } = where.userId_empresaId;
        return vinculos[`${userId}:${empresaId}`] ?? null;
      },
    },
  };
}

describe('contatoDoResponsavel', () => {
  test('telefone do profissional vem do cadastro DA EMPRESA, não do users', async () => {
    const client = clienteFalso({
      users:    { 7: { id: 7, email: 'marina@x.com', fullName: 'Marina (global)', phone: '11999990000' } },
      vinculos: { '7:3': { perfil: 'VETERINARIO', ativo: true, fullName: 'Marina', phone: '65988887777' } },
    });
    const c = await contatoDoResponsavel(client, { veterinarioId: 7, empresaId: 3 });
    expect(c).toEqual({ nome: 'Marina', email: 'marina@x.com', phone: '65988887777' });
  });

  test('vínculo sem telefone = sem telefone NESTA empresa (não cai no global)', async () => {
    const client = clienteFalso({
      users:    { 7: { id: 7, email: 'marina@x.com', fullName: 'Marina', phone: '11999990000' } },
      vinculos: { '7:3': { perfil: 'VETERINARIO', ativo: true, fullName: 'Marina', phone: null } },
    });
    const c = await contatoDoResponsavel(client, { veterinarioId: 7, empresaId: 3 });
    expect(c.phone).toBeNull();
  });

  test('prestador sem login usa o próprio cadastro', async () => {
    const c = await contatoDoResponsavel(clienteFalso(), {
      prestador: { id: 4, nome: 'Ferrador João', userId: null, email: '', telefone: '(65) 98888-1111' },
      empresaId: 3,
    });
    expect(c).toEqual({ nome: 'Ferrador João', email: null, phone: '(65) 98888-1111' });
  });

  test('prestador com login: o cadastro vence e o login completa o que falta', async () => {
    const client = clienteFalso({ users: { 9: { id: 9, email: 'login@x.com', fullName: 'Joao', phone: '6533334444' } } });
    const c = await contatoDoResponsavel(client, {
      prestador: { id: 4, nome: 'João Quiroprata', userId: 9, email: null, telefone: '65911112222' },
      empresaId: 3,
    });
    expect(c).toEqual({ nome: 'João Quiroprata', email: 'login@x.com', phone: '65911112222' });
  });

  test('agendamento sem responsável não tem a quem avisar', async () => {
    expect(await contatoDoResponsavel(clienteFalso(), { veterinarioId: null, empresaId: 3 })).toBeNull();
  });
});

describe('avisosDeContato', () => {
  test('sem e-mail e sem telefone', () => {
    const [a] = avisosDeContato({ nome: 'Marina', email: null, phone: null });
    expect(a).toMatch(/Marina não tem e-mail nem telefone cadastrado/);
  });
  test('só sem e-mail', () => {
    expect(avisosDeContato({ nome: 'Marina', email: null, phone: '659' })[0]).toMatch(/não tem e-mail cadastrado/);
  });
  test('só sem telefone', () => {
    expect(avisosDeContato({ nome: 'Marina', email: 'm@x', phone: null })[0]).toMatch(/não tem telefone cadastrado/);
  });
  test('tudo cadastrado ou sem responsável → nenhum aviso', () => {
    expect(avisosDeContato({ nome: 'Marina', email: 'm@x', phone: '659' })).toEqual([]);
    expect(avisosDeContato(null)).toEqual([]);
  });
});

describe('conteúdo da mensagem', () => {
  test('local: catálogo → legado, com a baia', () => {
    expect(localDoAnimal({ localizacao: { nome: 'Haras HP' }, local: 'antigo', baia: '12' })).toBe('Haras HP · Baia 12');
    expect(localDoAnimal({ localizacao: null, local: 'Hípica', baia: null })).toBe('Hípica');
    expect(localDoAnimal({ localizacao: null, local: null, baia: null })).toBeNull();
  });

  test('atividade não repete o título padrão da Agenda', () => {
    expect(descricaoAtividade({ tipo: 'CONSULTA', titulo: 'Consulta - Thor', especialidade: 'Dermatologia', animalNome: 'Thor' }))
      .toBe('Consulta · Dermatologia');
    expect(descricaoAtividade({ tipo: 'PROCEDIMENTO', titulo: 'Casqueamento', animalNome: 'Thor' }))
      .toBe('Casqueamento');
  });

  test('WhatsApp traz paciente, atividade, data, hora e local', () => {
    const msg = mensagemWhatsAppProfissional({
      animalNome: 'Thor', atividade: 'Consulta', dataFmt: 'segunda-feira, 05 de outubro de 2026',
      horaFmt: '14:00', local: 'Haras HP',
    });
    for (const parte of ['Thor', 'Consulta', '05 de outubro', '14:00', 'Haras HP']) expect(msg).toContain(parte);
  });
});

describe('gate estrutural — AgendamentoController.criar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'AgendamentoController.js'), 'utf8');
  const criar = src.slice(src.indexOf('criar: async'), src.indexOf('atualizarStatus: async'));

  test('resolve o contato ANTES de responder e devolve os avisos', () => {
    expect(criar.indexOf('contatoDoResponsavel(')).toBeGreaterThan(-1);
    expect(criar.indexOf('contatoDoResponsavel(')).toBeLessThan(criar.indexOf('res.status(201)'));
    expect(criar).toMatch(/avisosNotificacao:\s*avisosDeContato\(contatoProf\)/);
  });

  test('WhatsApp ao profissional sai pela instância da clínica', () => {
    expect(criar).toMatch(/whatsappService\.sendMessage\([\s\S]*?vet\.phone, msgVet/);
  });
});
