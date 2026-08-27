'use strict';

/**
 * BLOQUEIO DE CONTA POR SENHA ERRADA — contagem e, sobretudo, QUEM DESBLOQUEIA.
 *
 * A regra de autorização é o motivo destes testes existirem. Ela falha em silêncio nos
 * dois sentidos, e os dois são graves:
 *
 * - Frouxa demais → o gestor da clínica A destrava a conta de alguém da clínica B, ou
 *   um gestor destrava outro gestor. Como gestor tem bypass total no controle de acesso
 *   (CLAUDE.md §4), destravar gestor é entregar a chave inteira; e dois gestores da
 *   mesma empresa poderiam se destravar em círculo, esvaziando a trava.
 * - Apertada demais → ninguém consegue destravar ninguém, e a única saída vira mexer no
 *   banco à mão.
 *
 * ⚠️ Nenhum teste aqui depende de `req.membroCargo`. As rotas de `routes/equipes.js`
 * não passam por `checkPermission`, então aquele campo não existe lá — a regra consulta
 * o banco, e é essa consulta que está sob teste (com um Prisma falso).
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const bloqueio = require('../lib/bloqueioLogin');

/**
 * Prisma falso. O "banco" é declarativo: quem é dono de quê, quem é membro de qual
 * equipe com qual cargo, e a que empresa cada equipe pertence.
 */
/** Espelha o filtro de cargo da lib: singular OU dentro do array `cargos`. */
function casaCargo(m, where) {
  if (m.userId !== where.userId) return false;
  if (!where.OR) return !where.cargo || m.cargo === where.cargo;
  return where.OR.some(cond =>
    (cond.cargo && m.cargo === cond.cargo) ||
    (cond.cargos?.has && (m.cargos ?? []).includes(cond.cargos.has)),
  );
}

function bancoFalso({ empresas = [], membros = [], vinculos = [], usuarios = [] } = {}) {
  const equipeEmpresa = new Map(membros.map(m => [m.equipeId, m.empresaId]));
  return {
    empresa: {
      count:    async ({ where }) => empresas.filter(e => e.ownerId === where.ownerId).length,
      findMany: async ({ where }) => empresas.filter(e => e.ownerId === where.ownerId).map(e => ({ id: e.id })),
    },
    membroEquipe: {
      // Reproduz o `OR: [{cargo:'GESTOR'}, {cargos:{has:'GESTOR'}}]` da lib — sem isso o
      // teste do acúmulo de cargos passaria por acidente, medindo o mock e não a regra.
      count:    async ({ where }) => membros.filter(m => casaCargo(m, where)).length,
      findMany: async ({ where }) =>
        membros
          .filter(m => casaCargo(m, where))
          .map(m => ({ equipe: { empresaId: equipeEmpresa.get(m.equipeId) ?? m.empresaId } })),
    },
    usuarioEmpresa: {
      findMany: async ({ where }) =>
        vinculos.filter(v => v.userId === where.userId).map(v => ({ empresaId: v.empresaId })),
    },
    user: {
      update: async ({ where, data, select }) => {
        const u = usuarios.find(x => x.id === where.id);
        if (data.tentativasLogin?.increment) u.tentativasLogin += data.tentativasLogin.increment;
        if (data.tentativasLogin === 0)      u.tentativasLogin = 0;
        if ('bloqueadoEm' in data)           u.bloqueadoEm = data.bloqueadoEm;
        return select ? { tentativasLogin: u.tentativasLogin, bloqueadoEm: u.bloqueadoEm } : u;
      },
    },
  };
}

const req = ({ id = 10, role = 'VETERINARIO' } = {}) => ({ user: { id, role, userTypeGlobal: role } });

describe('contagem de tentativas', () => {
  it('conta a falha e informa quantas restam, sem bloquear antes do teto', async () => {
    const alvo = { id: 1, tentativasLogin: 0, bloqueadoEm: null };
    const db = bancoFalso({ usuarios: [alvo] });

    const r1 = await bloqueio.registrarFalha(1, db);
    expect(r1.bloqueado).toBe(false);
    expect(r1.tentativas).toBe(1);
    expect(r1.restantes).toBe(bloqueio.MAX_TENTATIVAS - 1);
  });

  it('bloqueia EXATAMENTE na 6ª tentativa — nem antes, nem depois', async () => {
    const alvo = { id: 1, tentativasLogin: 0, bloqueadoEm: null };
    const db = bancoFalso({ usuarios: [alvo] });

    for (let i = 1; i < bloqueio.MAX_TENTATIVAS; i++) {
      const r = await bloqueio.registrarFalha(1, db);
      expect(r.bloqueado).toBe(false);   // 1ª a 5ª ainda passam
    }
    const ultima = await bloqueio.registrarFalha(1, db);
    expect(ultima.bloqueado).toBe(true);
    expect(alvo.bloqueadoEm).toBeInstanceOf(Date);
  });

  it('não reescreve o horário do bloqueio em tentativas posteriores', async () => {
    // O instante em que a conta travou é o dado que a auditoria usa. Reescrevê-lo a
    // cada nova tentativa apagaria justamente essa informação.
    const travadoEm = new Date('2026-08-20T10:00:00Z');
    const alvo = { id: 1, tentativasLogin: 6, bloqueadoEm: travadoEm };
    const db = bancoFalso({ usuarios: [alvo] });

    await bloqueio.registrarFalha(1, db);

    expect(alvo.bloqueadoEm).toBe(travadoEm);
  });

  it('zera o contador no login bem-sucedido — mas só quando há o que zerar', async () => {
    const db = bancoFalso({ usuarios: [{ id: 1, tentativasLogin: 3, bloqueadoEm: null }] });
    const espia = jest.spyOn(db.user, 'update');

    await bloqueio.limparTentativas({ id: 1, tentativasLogin: 0 }, db);
    expect(espia).not.toHaveBeenCalled();   // login normal não escreve em `users`

    await bloqueio.limparTentativas({ id: 1, tentativasLogin: 3 }, db);
    expect(espia).toHaveBeenCalled();
  });
});

describe('quem pode desbloquear', () => {
  // Cenário: empresa 100 (gestor 10), empresa 200 (gestor 20).
  // Alvo 1 = veterinária da empresa 100. Alvo 2 = gestora da empresa 200.
  const cenario = () => bancoFalso({
    empresas: [{ id: 100, ownerId: 10 }, { id: 200, ownerId: 20 }],
    membros: [
      { userId: 10, equipeId: 1, empresaId: 100, cargo: 'GESTOR' },
      { userId: 20, equipeId: 2, empresaId: 200, cargo: 'GESTOR' },
      { userId: 1,  equipeId: 1, empresaId: 100, cargo: 'VETERINARIO' },
      { userId: 2,  equipeId: 2, empresaId: 200, cargo: 'GESTOR' },
      { userId: 3,  equipeId: 2, empresaId: 200, cargo: 'ESTAGIARIO' },
    ],
  });

  it('o gestor destrava quem é da empresa dele', async () => {
    expect(await bloqueio.podeDesbloquear(req({ id: 10 }), 1, cenario())).toEqual({ pode: true });
  });

  it('🔴 o gestor NÃO destrava quem é de outra empresa', async () => {
    const r = await bloqueio.podeDesbloquear(req({ id: 10 }), 3, cenario());
    expect(r.pode).toBe(false);
    expect(r.code).toBe('FORA_DA_EMPRESA');
  });

  it('🔴 gestor NÃO destrava gestor — escala para o ADMIN', async () => {
    // Vale inclusive para o gestor da MESMA empresa: sem isto, dois gestores se
    // destravam em círculo e a trava deixa de existir para quem tem bypass total.
    const r = await bloqueio.podeDesbloquear(req({ id: 20 }), 2, cenario());
    expect(r.pode).toBe(false);
    expect(r.code).toBe('ALVO_GESTOR');
  });

  it('o ADMIN da plataforma destrava qualquer um, inclusive gestor', async () => {
    expect(await bloqueio.podeDesbloquear(req({ id: 99, role: 'ADMIN' }), 2, cenario())).toEqual({ pode: true });
    expect(await bloqueio.podeDesbloquear(req({ id: 99, role: 'ADMIN' }), 1, cenario())).toEqual({ pode: true });
  });

  it('quem NÃO é gestor não destrava ninguém', async () => {
    const r = await bloqueio.podeDesbloquear(req({ id: 1 }), 3, cenario());
    expect(r.pode).toBe(false);
    expect(r.code).toBe('SEM_PERMISSAO');
  });

  it('🔴 ninguém destrava a PRÓPRIA conta — nem o ADMIN', async () => {
    // Sem esta trava, bastaria uma sessão ainda válida noutro dispositivo para a
    // pessoa contornar o próprio bloqueio.
    const r = await bloqueio.podeDesbloquear(req({ id: 10 }), 10, cenario());
    expect(r.pode).toBe(false);
    expect(r.code).toBe('AUTO_DESBLOQUEIO');

    const rAdmin = await bloqueio.podeDesbloquear(req({ id: 99, role: 'ADMIN' }), 99, cenario());
    expect(rAdmin.pode).toBe(false);
  });

  it('o motivo da recusa diz O QUE o alvo é, não onde ele está', async () => {
    // Gestor da empresa 100 tentando destravar a gestora da 200: as DUAS recusas se
    // aplicam. A que vale é ALVO_GESTOR — "não pertence à sua empresa" esconderia a
    // razão verdadeira e mandaria a pessoa procurar a solução errada.
    const r = await bloqueio.podeDesbloquear(req({ id: 10 }), 2, cenario());
    expect(r.code).toBe('ALVO_GESTOR');
  });

  it('🔴 GESTOR VENCE na disputa de cargos: quem acumula GESTOR + outra função é gestor', async () => {
    // O membro 4 tem cargo primário VETERINARIO, mas GESTOR está entre os `cargos` —
    // e as permissões de um membro são a UNIÃO dos cargos dele. Olhar só o campo
    // singular deixaria um GESTOR de fato ser destravado por outro gestor, em silêncio.
    const db = bancoFalso({
      empresas: [{ id: 100, ownerId: 10 }],
      membros: [
        { userId: 10, equipeId: 1, empresaId: 100, cargo: 'GESTOR' },
        { userId: 4,  equipeId: 1, empresaId: 100, cargo: 'VETERINARIO', cargos: ['VETERINARIO', 'GESTOR'] },
      ],
    });

    expect(await bloqueio.ehGestorEmAlgumaEmpresa(4, db)).toBe(true);

    const r = await bloqueio.podeDesbloquear(req({ id: 10 }), 4, db);
    expect(r.pode).toBe(false);
    expect(r.code).toBe('ALVO_GESTOR');
    expect(await bloqueio.mensagemBloqueio(4, db)).toBe(bloqueio.MSG_BLOQUEADO_GESTOR);
  });

  it('acumular cargos SEM gestor não escala para o ADMIN', async () => {
    // O contraponto do teste acima: sem esta garantia, bastaria ter mais de um cargo
    // para toda conta virar exclusividade do ADMIN e o gestor perder a autonomia.
    const db = bancoFalso({
      empresas: [{ id: 100, ownerId: 10 }],
      membros: [
        { userId: 10, equipeId: 1, empresaId: 100, cargo: 'GESTOR' },
        { userId: 5,  equipeId: 1, empresaId: 100, cargo: 'VETERINARIO', cargos: ['VETERINARIO', 'ESTAGIARIO'] },
      ],
    });
    expect(await bloqueio.podeDesbloquear(req({ id: 10 }), 5, db)).toEqual({ pode: true });
  });

  it('mensagem ao usuário travado aponta para quem pode destravá-lo', async () => {
    const db = cenario();
    expect(await bloqueio.mensagemBloqueio(1, db)).toBe(bloqueio.MSG_BLOQUEADO);        // gestor da equipe
    expect(await bloqueio.mensagemBloqueio(2, db)).toBe(bloqueio.MSG_BLOQUEADO_GESTOR); // administrador
  });
});
