// backend/src/__tests__/prestadorExternoAgenda.test.js
//
// 🔴 PRESTADOR EXTERNO NA AGENDA (2026-10-01, a pedido).
//
// Dois tipos de prestador na Agenda:
//   • INTEGRA A EQUIPE — foi incluído como MEMBRO na tela Equipe (MembroEquipe com
//     cargo que NÃO é de prestador). Vem de /equipes/membros e segue as regras da
//     empresa (expediente, locais, tempo por especialidade).
//   • EXTERNO — todo o resto do cadastro de Prestador. Gestor OU veterinário agendam,
//     para QUALQUER paciente, em QUALQUER dia e horário; só valem o conflito de agenda
//     e a duração do `tempo_consulta_min` do cadastro.
//
// Tudo aqui falha EM SILÊNCIO: sem o recorte da listagem o membro aparece duas vezes
// (a segunda sem expediente); sem a dispensa no `criar` o externo esbarra no
// expediente que a tela não mostra; e sem o tempo próprio a grade e o backend
// discordam da duração.

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('tempo de consulta do prestador (lib/prestadorTempoConsulta.js)', () => {
  const { normalizarTempoConsulta } = require('../lib/prestadorTempoConsulta');

  it('undefined não mexe; vazio/null volta ao padrão da empresa', () => {
    expect(normalizarTempoConsulta(undefined)).toEqual({ erro: null, valor: undefined });
    expect(normalizarTempoConsulta('')).toEqual({ erro: null, valor: null });
    expect(normalizarTempoConsulta(null)).toEqual({ erro: null, valor: null });
  });

  it('aceita múltiplo de 5 entre 5 e 480', () => {
    expect(normalizarTempoConsulta('45').valor).toBe(45);
    expect(normalizarTempoConsulta(480).valor).toBe(480);
  });

  it('recusa fora da régua', () => {
    for (const v of [0, 3, 47, 485, 'abc', 12.5]) expect(normalizarTempoConsulta(v).erro).toBeTruthy();
  });
});

describe('quem INTEGRA A EQUIPE (lib/agendamentoPrestador.js)', () => {
  it('é membro da EMPRESA com cargo que não é de prestador', async () => {
    const { loginsQueIntegramEquipe } = require('../lib/agendamentoPrestador');
    let where = null;
    const db = { membroEquipe: { findMany: async (q) => { where = q.where; return [{ userId: 9 }]; } } };
    const r = await loginsQueIntegramEquipe(db, [9, null, 9, 11], 64);
    expect([...r]).toEqual([9]);
    expect(where).toEqual({
      userId: { in: [9, 11] }, equipe: { empresaId: 64 }, cargo: { notIn: ['FORNECEDOR', 'PRESTADOR'] },
    });
  });

  it('sem login ou sem empresa ninguém integra (não consulta)', async () => {
    const { loginsQueIntegramEquipe } = require('../lib/agendamentoPrestador');
    const db = { membroEquipe: { findMany: async () => { throw new Error('não deveria consultar'); } } };
    expect((await loginsQueIntegramEquipe(db, [], 64)).size).toBe(0);
    expect((await loginsQueIntegramEquipe(db, [9], null)).size).toBe(0);
  });
});

describe('🔴 os elos no AgendamentoController (gate estrutural)', () => {
  const ag = semComentarios(ler('controllers/AgendamentoController.js'));
  const listar = ag.slice(ag.indexOf('listarPrestadoresAgendaveis: async'), ag.indexOf('listarPorAnimal: async'));
  const criar  = ag.slice(ag.indexOf('criar: async'), ag.indexOf('atualizarStatus: async'));

  it('a listagem deixa de fora quem integra a equipe — e não recorta mais por paciente autorizado', () => {
    expect(listar).toMatch(/loginsQueIntegramEquipe\(prisma,/);
    expect(listar).toMatch(/\.filter\(p => !\(p\.userId && integram\.has\(Number\(p\.userId\)\)\)\)/);
    expect(listar).not.toMatch(/animalIds\.length > 0/);
    expect(listar).toMatch(/tempoConsultaMin:/);
  });

  it('o veterinário agenda o externo (userType do CONTEXTO)', () => {
    const f = ag.slice(ag.indexOf('function podeAgendarPrestadorExterno'), ag.indexOf('function ehMinhaAgenda'));
    expect(f).toMatch(/ehGestorNoContexto\(req\) \|\| req\.user\?\.userType === 'VETERINARIO'/);
  });

  it('o externo não exige autorização de paciente nem expediente', () => {
    expect(criar).toMatch(/prestadorAg && !prestadorExterno && !\(await designacaoCadastro\.prestadorAutorizado/);
    expect(criar).toMatch(/!prestadorExterno && \(!\(await dentroDoExpedientePrestador/);
  });

  it('o externo continua com a trava de CONFLITO de agenda', () => {
    const iConf = criar.indexOf('conflitoDoPrestador(prestadorAg.id');
    expect(iConf).toBeGreaterThan(-1);
    expect(criar.slice(iConf - 200, iConf)).not.toMatch(/prestadorExterno/);
  });

  it('a duração do externo sai do cadastro (lerTemposConsulta)', () => {
    expect(criar).toMatch(/if \(prestadorExterno\) \{\s*const proprio = \(await lerTemposConsulta\(\[prestadorAg\.id\]\)\)/);
  });
});

describe('cadastro do prestador grava e devolve o tempo', () => {
  const src = semComentarios(ler('controllers/PrestadorController.js'));
  it('criar e atualizar validam e gravam', () => {
    expect((src.match(/normalizarTempoConsulta\(tempoConsultaMin\)/g) ?? []).length).toBe(2);
    expect((src.match(/gravarTempoConsulta\(tx,/g) ?? []).length).toBe(2);
  });
  it('listar, buscar por e-mail, obter, criar e atualizar devolvem', () => {
    expect((src.match(/anexarTempoConsulta\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  it('a coluna NÃO está no schema (generate antes da migration derrubaria o findMany)', () => {
    const schema = fs.readFileSync(path.join(RAIZ, '..', 'prisma', 'schema.prisma'), 'utf8');
    const model = schema.slice(schema.indexOf('model Prestador {'), schema.indexOf('@@map("tb_prestadores")'));
    expect(model).not.toMatch(/^\s*tempoConsultaMin\s/m);
  });
});
