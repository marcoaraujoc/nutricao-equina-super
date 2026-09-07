// backend/src/__tests__/clienteAtivoNaEmpresa.test.js
//
// "O CLIENTE ESTÁ ATIVO?" É PERGUNTA DA CLÍNICA, NÃO DO LOGIN.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: `users.ativo` é o LOGIN e é GLOBAL — cai quando a
// pessoa é inativada como PROFISSIONAL em QUALQUER clínica. Enquanto ele entrava no
// `ativo` efetivo do cliente, a cliente ATIVA da clínica A aparecia INATIVA lá porque
// a clínica B desligou o acesso dela ao sistema, e não havia nada que A pudesse fazer.
// Caso real: cadastro ativo na MarcoVet, login desligado na Patyvet três semanas antes.
//
// A regra tem de casar com `lib/visibilidade.js`: se as duas divergirem, o paciente
// aparece na lista e o dono dele consta como inativo na tela ao lado.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const perfilProp = require('../lib/proprietarioPerfil');

/** `aplicarPerfil` com um client falso que devolve o perfil informado. */
async function comPerfil(user, perfil) {
  const client = {
    proprietarioPerfil: {
      findUnique: async () => (perfil ? { userId: user.id, empresaId: 7, ...perfil } : null),
      findMany:   async () => (perfil ? [{ userId: user.id, empresaId: 7, ...perfil }] : []),
    },
  };
  return perfilProp.aplicarPerfil(user, 7, client);
}

describe('o `ativo` do cliente', () => {
  test('🔴 cadastro ATIVO aqui vence o login global desligado', async () => {
    const r = await comPerfil(
      { id: 159, fullName: 'Laura', ativo: false },          // login desligado em OUTRA clínica
      { ativo: true, fullName: 'Patricia Costa' },           // cliente ativa NESTA
    );
    expect(r.ativo).toBe(true);
    // E o nome exibido é o desta clínica (§36) — quem atende reconhece este, não o global.
    expect(r.fullName).toBe('Patricia Costa');
  });

  test('cadastro INATIVO aqui esconde, mesmo com o login em dia', async () => {
    // É o caso legítimo: a clínica removeu o cliente (`removerDaEmpresa`).
    const r = await comPerfil(
      { id: 1, fullName: 'Ana', ativo: true },
      { ativo: false, fullName: 'Ana' },
    );
    expect(r.ativo).toBe(false);
  });

  test('cliente LEGADO (sem cadastro na empresa) cai no `ativo` global', async () => {
    // Sem perfil aqui não existe outro sinal; ignorá-lo faria reaparecer o cliente que
    // a única clínica dele havia inativado.
    const inativo = await comPerfil({ id: 2, fullName: 'Beto', ativo: false }, null);
    const ativo   = await comPerfil({ id: 3, fullName: 'Caio', ativo: true },  null);
    expect(inativo.ativo).toBe(false);
    expect(ativo.ativo).toBe(true);
  });
});

describe('as duas regras concordam', () => {
  test('o `ativo` do cliente e a visibilidade do paciente usam o MESMO critério', () => {
    // Se uma olhar o login global e a outra não, o paciente aparece na lista e o dono
    // consta como inativo na tela ao lado — foi assim que o defeito foi relatado.
    const fs   = require('fs');
    const path = require('path');
    const semComentarios = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const perfil = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'lib/proprietarioPerfil.js'), 'utf8'));
    const visib  = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'lib/visibilidade.js'), 'utf8'));

    // Nenhuma das duas pode voltar a exigir o `ativo` global de quem TEM cadastro aqui.
    expect(perfil).not.toMatch(/user\.ativo !== false && perfil\.ativo/);
    expect(perfil).toMatch(/out\.ativo = perfil\.ativo !== false/);
    // Na visibilidade, o `ativo: true` do user só pode aparecer no ramo do LEGADO
    // (junto do `none`), nunca no nível de cima do filtro.
    expect(visib).toMatch(/proprietarioPerfis: \{ none:[\s\S]{0,120}ativo: true/);
  });
});
