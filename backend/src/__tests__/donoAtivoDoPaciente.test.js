// backend/src/__tests__/donoAtivoDoPaciente.test.js
//
// PACIENTE ATIVO ⇒ DONO ATIVO NESTA CLÍNICA.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: reativar o paciente sem reativar o dono devolve um
// cadastro que NASCE INVISÍVEL — a visibilidade esconde o animal de quem não é cliente
// ativo da empresa. A pessoa vê "reativado com sucesso" e o paciente não aparece em
// lugar nenhum. É o mesmo sintoma do "Horse1", por outro caminho.
//
// E protege o LIMITE da regra, que é tão importante quanto ela: reativar o cliente
// AQUI não pode religar o `users.ativo`, que é o login e é global — isso desfaria a
// decisão que outra clínica tomou sobre o acesso dela ao sistema.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/auditoria', () => ({ registrarAuditoria: jest.fn(async () => {}) }), { virtual: true });

const { garantirDonoAtivo } = require('../lib/donoAtivoDoPaciente');
const { registrarAuditoria } = require('../lib/auditoria');

const ANIMAL = { id: 9, nome: 'Thor', userId: 100, empresaId: 7 };
const REQ    = { user: { id: 1, fullName: 'Gestor' }, empresaId: 7 };

/** `tx` falso: registra o que foi escrito, para o teste olhar o EFEITO, não a chamada. */
function txFalso({ dono, perfil }) {
  const escritas = [];
  return {
    escritas,
    user: { findUnique: async () => dono },
    proprietarioPerfil: {
      findUnique: async () => perfil,
      upsert: async ({ update }) => { escritas.push({ tabela: 'proprietarioPerfil', update }); return { id: 1 }; },
    },
  };
}

beforeEach(() => registrarAuditoria.mockClear());

describe('o dono volta junto', () => {
  test('cadastro INATIVO na empresa → reativado com o mesmo motivo', async () => {
    const tx = txFalso({
      dono:   { id: 100, fullName: 'Laura', ativo: true },
      perfil: { id: 5, ativo: false, fullName: 'Patricia Costa' },
    });
    const r = await garantirDonoAtivo(tx, REQ, { animal: ANIMAL, motivo: 'volta a atender' });

    expect(r.reativou).toBe(true);
    expect(tx.escritas).toEqual([{ tabela: 'proprietarioPerfil', update: { ativo: true } }]);
    // Auditado à parte: quem abrir a trilha do CLIENTE precisa achar o porquê lá.
    expect(registrarAuditoria).toHaveBeenCalledWith(tx, REQ, expect.objectContaining({
      categoria: 'ATIVACAO', entidade: 'PROPRIETARIO', entidadeId: 100, motivo: 'volta a atender',
    }));
  });

  test('o nome vem do cadastro da EMPRESA, não de `users` (§36)', async () => {
    const tx = txFalso({
      dono:   { id: 100, fullName: 'Laura', ativo: true },
      perfil: { id: 5, ativo: false, fullName: 'Patricia Costa' },
    });
    const r = await garantirDonoAtivo(tx, REQ, { animal: ANIMAL, motivo: 'x' });
    expect(r.nome).toBe('Patricia Costa');
  });

  test('dono já ativo → não escreve nada nem audita', async () => {
    const tx = txFalso({
      dono:   { id: 100, fullName: 'Ana', ativo: true },
      perfil: { id: 5, ativo: true, fullName: 'Ana' },
    });
    const r = await garantirDonoAtivo(tx, REQ, { animal: ANIMAL, motivo: 'x' });
    expect(r.reativou).toBe(false);
    expect(tx.escritas).toHaveLength(0);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  test('cliente LEGADO (sem cadastro na empresa) não inventa um', async () => {
    // Sem perfil aqui, a visibilidade já não o esconde — criar um cadastro do nada
    // seria afirmar um vínculo que ninguém registrou.
    const tx = txFalso({ dono: { id: 100, fullName: 'Ana', ativo: true }, perfil: null });
    const r = await garantirDonoAtivo(tx, REQ, { animal: ANIMAL, motivo: 'x' });
    expect(r.reativou).toBe(false);
    expect(tx.escritas).toHaveLength(0);
  });
});

describe('o limite da regra', () => {
  test('🔴 NUNCA religa o `users.ativo` — o login é decisão de quem o desligou', async () => {
    const tx = txFalso({
      dono:   { id: 100, fullName: 'Laura', ativo: false },   // desativada em OUTRA clínica
      perfil: { id: 5, ativo: false, fullName: 'Patricia Costa' },
    });
    const r = await garantirDonoAtivo(tx, REQ, { animal: ANIMAL, motivo: 'x' });

    expect(r.reativou).toBe(true);                       // o cadastro daqui volta…
    expect(r.loginGlobalInativo).toBe(true);             // …e a tela é avisada do resto
    // Nenhuma escrita em `user`: se um dia aparecer, o acesso ao sistema volta sem
    // ninguém ter pedido, e a inativação feita na outra clínica é desfeita em silêncio.
    expect(tx.escritas.every(e => e.tabela !== 'user')).toBe(true);
  });

  test('animal sem dono ou sem empresa não faz nada', async () => {
    const tx = txFalso({ dono: null, perfil: null });
    expect((await garantirDonoAtivo(tx, REQ, { animal: { id: 1 }, motivo: 'x' })).reativou).toBe(false);
    expect(tx.escritas).toHaveLength(0);
  });
});

describe('gate estrutural — as duas rotas de ativação chamam o helper', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(path.join(__dirname, '..', 'controllers/AnimalController.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('`ativar` (descongelar) e `reativarExcluido` levam o dono junto', () => {
    // São dois estados diferentes do paciente, com a MESMA consequência: se um deles
    // esquecer o dono, o paciente volta invisível por aquele caminho.
    const ocorrencias = src.match(/garantirDonoAtivo\(tx, req/g) ?? [];
    expect(ocorrencias).toHaveLength(2);
  });

  test('a reativação do dono acontece DENTRO da transaction do paciente', () => {
    // Fora dela, um erro depois da reativação do animal deixaria o cliente reativado
    // sem o paciente ter voltado — o oposto do invariante.
    expect(src).toMatch(/\$transaction\(async \(tx\) => \{[\s\S]{0,900}garantirDonoAtivo\(tx, req/);
  });
});
