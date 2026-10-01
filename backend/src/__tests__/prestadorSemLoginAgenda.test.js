// backend/src/__tests__/prestadorSemLoginAgenda.test.js
//
// 🔴 PRESTADOR SEM LOGIN: "Gerenciar Acesso" e AGENDA (2026-09-30).
//
// A designação ("Gerenciar Acesso") e o agendamento eram gravados pelo LOGIN. O
// prestador cadastrado sem "Terá acesso ao sistema" não tinha login — o botão sumia
// para ele e não havia como agendá-lo. Agora a autorização é pelo CADASTRO
// (`tb_designacoes_prestador_cadastro`) e o agendamento guarda o prestador em
// `prestador_cadastro_id`.
//
// O que este gate trava, porque tudo aqui falha EM SILÊNCIO:
//   • a autorização é a UNIÃO das duas fontes (cadastro + login) e só da EMPRESA do
//     cadastro — sem a união, designação antiga some; sem o recorte, a de outra
//     clínica passaria a valer aqui;
//   • com login, conceder/revogar espelha na designação por login (é ela que dá
//     acesso ao sistema); sem login, NÃO tenta espelhar;
//   • sem a migration, escrever recusa com MIGRATION_PENDENTE (nunca 500 mudo);
//   • o `criar` do agendamento confere a autorização e grava o prestador na MESMA
//     transaction; trocar de responsável limpa o prestador;
//   • a equipe do cartão é a da EMPRESA do cadastro (defeito medido na base).

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const lib = require('../lib/designacaoPrestadorCadastro');

// Banco falso: responde ao to_regclass, às linhas da tabela nova e ao client tipado.
function bancoFalso({ temTabela = true, linhasCadastro = [], porLogin = [], membros = [] } = {}) {
  const chamadas = { exec: [], upserts: [], updateMany: [] };
  const db = {
    $queryRawUnsafe: jest.fn(async (sql) => {
      if (sql.includes('to_regclass')) return [{ ok: temTabela }];
      if (sql.includes('prestador_id = ANY')) return linhasCadastro;
      return linhasCadastro;
    }),
    $executeRawUnsafe: jest.fn(async (sql, ...args) => { chamadas.exec.push({ sql, args }); return 1; }),
    designacaoPrestador: {
      findMany: jest.fn(async ({ where }) => porLogin.filter(d =>
        (where.prestadorId?.in ? where.prestadorId.in.includes(d.prestadorId) : d.prestadorId === where.prestadorId)
        && (!where.equipe || d.equipe?.empresaId === where.equipe.empresaId))),
      upsert:     jest.fn(async (a) => { chamadas.upserts.push(a); return {}; }),
      updateMany: jest.fn(async (a) => { chamadas.updateMany.push(a); return { count: 1 }; }),
    },
    membroEquipe: {
      findFirst: jest.fn(async ({ where }) => membros.find(m =>
        m.userId === where.userId && m.empresaId === where.equipe.empresaId) ?? null),
    },
  };
  return { db, chamadas };
}

describe('autorização = UNIÃO das duas fontes, só da empresa do cadastro', () => {
  it('soma a do cadastro e a do login, e ignora a designação feita em OUTRA empresa', async () => {
    const { db } = bancoFalso({
      linhasCadastro: [{ animalId: 10, motivo: null, dataInicio: new Date() }],
      porLogin: [
        { prestadorId: 500, animalId: 20, equipe: { empresaId: 64 } },
        { prestadorId: 500, animalId: 30, equipe: { empresaId: 59 } }, // outra clínica
      ],
    });
    const mapa = await lib.autorizacoesDoPrestador(db, { id: 7, userId: 500, empresaId: 64 });
    expect([...mapa.keys()].sort()).toEqual([10, 20]);
    expect(await lib.prestadorAutorizado(db, { id: 7, userId: 500, empresaId: 64 }, 30)).toBe(false);
  });

  it('prestador SEM login: vale só o cadastro, sem consultar a designação por login', async () => {
    const { db } = bancoFalso({ linhasCadastro: [{ animalId: 10 }] });
    const mapa = await lib.autorizacoesDoPrestador(db, { id: 7, userId: null, empresaId: 64 });
    expect([...mapa.keys()]).toEqual([10]);
    expect(db.designacaoPrestador.findMany).not.toHaveBeenCalled();
  });

  it('em lote (grade da Agenda) aplica o mesmo recorte por empresa', async () => {
    const { db } = bancoFalso({
      linhasCadastro: [{ prestadorId: 7, animalId: 10 }],
      porLogin: [
        { prestadorId: 500, animalId: 20, equipe: { empresaId: 64 } },
        { prestadorId: 500, animalId: 30, equipe: { empresaId: 59 } },
      ],
    });
    const mapa = await lib.autorizacoesEmLote(db, [{ id: 7, userId: 500, empresaId: 64 }, { id: 8, userId: null, empresaId: 64 }]);
    expect([...mapa.get(7)].sort()).toEqual([10, 20]);
    expect([...mapa.get(8)]).toEqual([]);
  });
});

describe('conceder / revogar', () => {
  it('SEM login grava só pelo cadastro — nada de espelho', async () => {
    const { db, chamadas } = bancoFalso();
    const n = await lib.conceder(db, { prestador: { id: 7, userId: null, empresaId: 64 }, animalIds: [10, 10, 11] });
    expect(n).toBe(2);
    expect(chamadas.exec).toHaveLength(2);
    expect(chamadas.exec[0].sql).toMatch(/ON CONFLICT \(prestador_id, animal_id\)/);
    expect(chamadas.exec[0].sql).toMatch(/NOW\(\) AT TIME ZONE 'UTC'/);
    expect(chamadas.upserts).toHaveLength(0);
  });

  it('COM login + cartão espelha na designação por login, na equipe da empresa do cadastro', async () => {
    const { db, chamadas } = bancoFalso({ membros: [
      { userId: 500, empresaId: 59, equipeId: 58 },   // vínculo em OUTRA clínica
      { userId: 500, empresaId: 64, equipeId: 63 },
    ] });
    await lib.conceder(db, { prestador: { id: 7, userId: 500, empresaId: 64 }, animalIds: [10] });
    expect(chamadas.upserts).toHaveLength(1);
    expect(chamadas.upserts[0].where.animalId_prestadorId_equipeId).toEqual({ animalId: 10, prestadorId: 500, equipeId: 63 });
  });

  it('sem a migration, escrever recusa com MIGRATION_PENDENTE', async () => {
    jest.resetModules();
    jest.doMock('../lib/prisma', () => ({ default: {} }), { virtual: true });
    const libNova = require('../lib/designacaoPrestadorCadastro');
    const { db } = bancoFalso({ temTabela: false });
    await expect(libNova.conceder(db, { prestador: { id: 7, userId: null, empresaId: 64 }, animalIds: [10] }))
      .rejects.toMatchObject({ code: 'MIGRATION_PENDENTE' });
  });

  it('revogar atinge as DUAS fontes', async () => {
    const { db, chamadas } = bancoFalso({ linhasCadastro: [{ animalId: 10 }] });
    await lib.revogar(db, { prestador: { id: 7, userId: 500, empresaId: 64 }, animalId: 10 });
    expect(chamadas.exec.some(c => /SET ativo = false/.test(c.sql))).toBe(true);
    expect(chamadas.updateMany).toHaveLength(1);
    expect(chamadas.updateMany[0].where).toMatchObject({ prestadorId: 500, animalId: 10, equipe: { empresaId: 64 } });
  });
});

describe('equipe do cartão = a da EMPRESA do cadastro', () => {
  it('anexarEquipeDoAcesso não devolve o vínculo de outra clínica', async () => {
    jest.resetModules();
    jest.doMock('../lib/prisma', () => ({ default: {} }), { virtual: true });
    jest.doMock('../lib/logger', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));
    jest.doMock('../lib/usuarioEmpresa', () => ({ salvarVinculo: jest.fn(), salvarPagamentoEAcesso: jest.fn() }));
    const { anexarEquipeDoAcesso } = require('../lib/acessoExterno');
    const client = { membroEquipe: { findMany: async () => [
      { userId: 201, equipeId: 58, equipe: { empresaId: 59 } },
      { userId: 201, equipeId: 63, equipe: { empresaId: 64 } },
    ] } };
    const [r] = await anexarEquipeDoAcesso(client, [{ id: 7, userId: 201, empresaId: 64 }]);
    expect(r.acessoEquipeId).toBe(63);
  });
});

describe('🔴 os elos da AGENDA (gate estrutural)', () => {
  const ag = semComentarios(ler('controllers/AgendamentoController.js'));
  const criar = ag.slice(ag.indexOf('criar: async'), ag.indexOf('atualizarStatus: async'));

  it('o criar confere a autorização do paciente ANTES de criar', () => {
    const iAut = criar.indexOf('designacaoCadastro.prestadorAutorizado');
    const iCria = criar.indexOf('agendamentoClinico.create');
    expect(iAut).toBeGreaterThan(-1);
    expect(iAut).toBeLessThan(iCria);
    expect(criar).toMatch(/PRESTADOR_SEM_AUTORIZACAO/);
  });

  it('o prestador é gravado DENTRO da transaction do agendamento', () => {
    const tx = criar.slice(criar.indexOf('prisma.$transaction'), criar.indexOf('registrarAuditoria'));
    expect(tx).toMatch(/gravarPrestador\(tx,/);
  });

  // (2026-10-01) O EXTERNO passou a aceitar também o veterinário — ver
  // `prestadorExternoAgenda.test.js`. O da EQUIPE segue só com o gestor.
  it('prestador: gestor (ou ele mesmo) agenda; o externo aceita também o veterinário', () => {
    expect(criar).toMatch(/prestadorExterno \? podeAgendarPrestadorExterno\(req\) : podeAgendarParaOutro\(req\)/);
    expect(criar).toMatch(/!podeAgendarEste && Number\(prestadorAg\.userId\) !== Number\(req\.user\.id\)/);
  });

  it('a listagem anexa o prestador (senão o agendamento sem login aparece "Não atribuído")', () => {
    expect((ag.match(/anexarPrestadorEmLista\(itens\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('trocar de responsável limpa o prestador (funil marcarAssumido)', () => {
    const src = semComentarios(ler('lib/agendamentoAssumido.js'));
    const f = src.slice(src.indexOf('async function marcarAssumido'), src.indexOf('async function lerAssumidos'));
    expect(f).toMatch(/limparPrestador\(db, agendamentoId\)/);
  });

  it('a rota literal /agendamentos/prestadores vem ANTES das rotas com parâmetro', () => {
    const rotas = ler('routes/agenda.js');
    const iLit = rotas.indexOf("'/agendamentos/prestadores'");
    expect(iLit).toBeGreaterThan(-1);
    expect(iLit).toBeLessThan(rotas.indexOf("'/agendamentos/animal/:animalId'"));
  });

  it('o login que nasce depois recebe as autorizações do cadastro', () => {
    const src = semComentarios(ler('controllers/PrestadorController.js'));
    expect(src).toMatch(/designacaoCadastro\.sincronizarComLogin\(tx,/);
  });
});
