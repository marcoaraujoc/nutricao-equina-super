// backend/src/__tests__/especialidadeCatalogoEmpresa.test.js
//
// `tb_especialidades` deixou de ser catálogo global puro e virou CATÁLOGO MISTO
// (migration 20260920000000): o encaminhamento a profissional EXTERNO cadastra a
// especialidade que falta, e essa linha é DA CLÍNICA.
//
// O que quebra em silêncio aqui — e por isso está coberto:
//
//   1. Criar sem `empresa_id` publicaria a especialidade de uma clínica no catálogo de
//      TODAS. Não estoura erro nenhum: só aparece meses depois, como item estranho na
//      lista de outra empresa. (O RLS recusaria a escrita — o `WITH CHECK` só aceita
//      `empresa_id = app_empresa_id()` — mas depender disso é deixar a regra existir
//      só na policy, invisível na revisão de código.)
//   2. Reaproveitar o item existente é o que impede o catálogo de encher de repetições:
//      encaminhar 10 vezes para "Quiropraxia" tem de continuar dando UMA linha.
//   3. A comparação é sem diferenciar maiúsculas — "Acupuntura" e "acupuntura" são a
//      mesma especialidade, e duas linhas fariam a lista mostrar o item duas vezes.
//   4. ENQUANTO a migration não é aplicada, o Prisma Client não conhece `empresaId` e
//      passar o campo LANÇA. O caminho tem de degradar para o comportamento antigo
//      (catálogo global puro, nada cadastrado pela clínica) — nunca cair com 500 nem,
//      pior, gravar a linha sem empresa. É o que `lib/especialidadeEscopo.js` decide, e
//      é por isso que os dois estados estão testados abaixo.

/** tx falsa: registra o que foi consultado/criado, sem tocar em banco. */
function txFake(existente = null) {
  const chamadas = { findFirst: [], create: [] };
  return {
    chamadas,
    especialidade: {
      findFirst: async (args) => { chamadas.findFirst.push(args); return existente; },
      create:    async (args) => { chamadas.create.push(args); return { id: 99, ...args.data }; },
    },
  };
}

/** Carrega `garantirEspecialidadeDaEmpresa` com a guarda do catálogo ligada/desligada. */
function carregar(ativo) {
  jest.resetModules();
  jest.doMock('../lib/especialidadeEscopo', () => ({
    catalogoPorEmpresaAtivo: ativo,
    escopoDaEmpresa: (empresaId) => (ativo
      ? { OR: [{ empresaId: null }, ...(empresaId ? [{ empresaId: Number(empresaId) }] : [])] }
      : {}),
  }));
  return require('../lib/catalogoManual').garantirEspecialidadeDaEmpresa;
}

afterEach(() => { jest.resetModules(); });

describe('garantirEspecialidadeDaEmpresa — catálogo por empresa DISPONÍVEL', () => {
  it('🔴 a linha nova nasce SEMPRE com empresaId — nunca global', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    const r = await garantir(tx, { nome: 'Quiropraxia', especieId: 1 }, 42);

    expect(tx.chamadas.create).toHaveLength(1);
    expect(tx.chamadas.create[0].data.empresaId).toBe(42);
    expect(tx.chamadas.create[0].data.empresaId).not.toBeNull();
    expect(r).toMatchObject({ nome: 'Quiropraxia', especieId: 1, empresaId: 42 });
  });

  it('busca no escopo VISÍVEL: global (empresaId null) + o próprio da empresa', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    await garantir(tx, { nome: 'Acupuntura', especieId: 3 }, 7);

    const { where } = tx.chamadas.findFirst[0];
    expect(where.OR).toEqual([{ empresaId: null }, { empresaId: 7 }]);
    expect(where.especieId).toBe(3);
    expect(where.ativo).toBe(true);
  });

  it('reaproveita o item existente em vez de duplicar', async () => {
    const garantir = carregar(true);
    const tx = txFake({ id: 5, nome: 'Cardiologia' });
    const r = await garantir(tx, { nome: 'Cardiologia', especieId: 1 }, 42);

    expect(tx.chamadas.create).toHaveLength(0);
    expect(r).toEqual({ id: 5, nome: 'Cardiologia' });
  });

  it('compara o nome sem diferenciar maiúsculas', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    await garantir(tx, { nome: 'acupuntura', especieId: 1 }, 42);
    expect(tx.chamadas.findFirst[0].where.nome).toEqual({ equals: 'acupuntura', mode: 'insensitive' });
  });

  it('🔴 sem empresa no contexto NÃO cria nada — criaria linha global', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    const r = await garantir(tx, { nome: 'Quiropraxia', especieId: 1 }, null);

    expect(tx.chamadas.create).toHaveLength(0);
    expect(r).toBeNull();
  });

  it('sem a espécie do paciente não cria — o catálogo é POR ESPÉCIE', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    const r = await garantir(tx, { nome: 'Quiropraxia', especieId: undefined }, 42);

    expect(tx.chamadas.create).toHaveLength(0);
    expect(r).toBeNull();
  });

  it('nome vazio não consulta nem cria', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    expect(await garantir(tx, { nome: '   ' }, 42)).toBeNull();
    expect(tx.chamadas.findFirst).toHaveLength(0);
    expect(tx.chamadas.create).toHaveLength(0);
  });

  it('corta o nome em 80 caracteres — é o limite da coluna', async () => {
    const garantir = carregar(true);
    const tx = txFake(null);
    const r = await garantir(tx, { nome: 'x'.repeat(200), especieId: 1 }, 42);
    expect(r.nome).toHaveLength(80);
  });
});

describe('garantirEspecialidadeDaEmpresa — antes da migration (guarda desligada)', () => {
  it('🔴 NÃO cria nada: a linha sairia global, no catálogo de todas as clínicas', async () => {
    const garantir = carregar(false);
    const tx = txFake(null);
    const r = await garantir(tx, { nome: 'Quiropraxia', especieId: 1 }, 42);

    expect(tx.chamadas.create).toHaveLength(0);
    expect(r).toBeNull();
  });

  it('a busca não menciona empresaId — o Client ainda não conhece o campo', async () => {
    const garantir = carregar(false);
    const tx = txFake(null);
    await garantir(tx, { nome: 'Quiropraxia', especieId: 1 }, 42);

    expect(JSON.stringify(tx.chamadas.findFirst[0].where)).not.toContain('empresaId');
  });

  it('achando o item do catálogo global, devolve normalmente', async () => {
    const garantir = carregar(false);
    const tx = txFake({ id: 5, nome: 'Cardiologia' });
    expect(await garantir(tx, { nome: 'Cardiologia', especieId: 1 }, 42)).toEqual({ id: 5, nome: 'Cardiologia' });
  });
});

describe('lib/especialidadeEscopo', () => {
  it('o escopo é INERTE exatamente quando o Client não conhece empresaId', () => {
    jest.resetModules();
    const { catalogoPorEmpresaAtivo, escopoDaEmpresa } = require('../lib/especialidadeEscopo');
    if (catalogoPorEmpresaAtivo) {
      expect(escopoDaEmpresa(42)).toEqual({ OR: [{ empresaId: null }, { empresaId: 42 }] });
    } else {
      expect(escopoDaEmpresa(42)).toEqual({});
    }
  });
});
