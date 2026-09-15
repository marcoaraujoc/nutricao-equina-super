// Unidade do medicamento escolhida pela clínica (2026-09-12).
//
// O QUE QUEBRA EM SILÊNCIO AQUI, e é por isso que o arquivo existe:
//   1. alterar a unidade de uma linha GLOBAL mudaria a unidade — e o preço — do
//      medicamento de TODAS as clínicas do SaaS. Nenhuma tela acusaria;
//   2. criar a cópia da empresa SEM reapontar o estoque deixaria a unidade nova sem
//      efeito nenhum, e a tela mostraria a antiga depois de salvar;
//   3. reapontar o estoque SEM reapontar a prescrição pendente faz
//      `consumirReservas`/`debitarEstoqueDia` não acharem o estoque
//      (`findFirst` → null → `continue`): a dose é executada sem baixa e sem linha na
//      fatura. Silêncio total;
//   4. `precoUnitarioBase` nulo para unidade contável joga a cobrança no cálculo
//      dinâmico, que SOBE conforme o estoque baixa.
'use strict';

const un = require('../lib/unidadeMedicamento');

// O controller só é carregado para o `calcPrecoUnitarioBase`; `lib/prisma` é .ts e o
// babel-jest não o transpila (§11) — daí o mock virtual, que só vale para ele.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
const EstoqueController = require('../controllers/EstoqueController');

// ─── Banco falso ─────────────────────────────────────────────────────────────
// Registra o que foi ESCRITO, para os testes afirmarem sobre a escrita e não sobre a
// intenção. As consultas imitam o que o Prisma faria com o mesmo `where`.
function bancoFalso({ medicamentos = [], estoquesAtivos = 0, saidas = 0 }) {
  const estado = {
    medicamentos: medicamentos.map((m) => ({ ...m })),
    criados: [], updates: [], viasCriadas: [], especiesCriadas: [],
    estoqueUpdateMany: [], prescricaoUpdateMany: [], raw: [],
  };
  let proximoId = 900;
  const achar = (id) => estado.medicamentos.find((m) => m.id === Number(id)) ?? null;
  const igual = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

  const tx = {
    medicamento: {
      findUnique: async ({ where }) => achar(where.id),
      findFirst: async ({ where }) => estado.medicamentos.find((m) =>
        igual(m.nome, where.nome?.equals) && Number(m.empresaId) === Number(where.empresaId)) ?? null,
      create: async ({ data }) => {
        const novo = { id: proximoId++, ...data };
        estado.medicamentos.push(novo);
        estado.criados.push(novo);
        return { id: novo.id };
      },
      update: async ({ where, data }) => {
        estado.updates.push({ id: Number(where.id), data });
        Object.assign(achar(where.id) ?? {}, data);
        return achar(where.id);
      },
    },
    medicamentoVia: {
      findMany: async () => [{ via: 'Oral' }, { via: 'IV' }],
      createMany: async ({ data }) => { estado.viasCriadas.push(...data); return { count: data.length }; },
    },
    medicamentoEspecie: {
      findMany: async () => [{ especieId: 1 }, { especieId: 3 }],
      createMany: async ({ data }) => { estado.especiesCriadas.push(...data); return { count: data.length }; },
    },
    estoqueClinica: {
      count: async () => estoquesAtivos,
      updateMany: async (args) => { estado.estoqueUpdateMany.push(args); return { count: 1 }; },
    },
    movimentoEstoque: { count: async () => saidas },
    prescricao: {
      updateMany: async (args) => { estado.prescricaoUpdateMany.push(args); return { count: 1 }; },
    },
    $executeRawUnsafe: async (...args) => { estado.raw.push(args); return 1; },
  };
  return { tx, estado };
}

const GLOBAL = {
  id: 10, nome: 'Dipirona', unidade: 'g', empresaId: null,
  formaFarmaceutica: 'Pó', apresentacao: 'Sachê 500 g',
  classificacao: 'Analgésico', fabricante: 'ACME', controlado: false, ativo: true,
};
const DA_EMPRESA = { ...GLOBAL, id: 11, empresaId: 42 };

// ─── Grafia da unidade ───────────────────────────────────────────────────────

describe('mesmaUnidade — grafia não é troca de unidade', () => {
  test.each([['un', 'Un.'], ['UN', 'unidade'], ['kg', 'Kg'], ['ml', 'ML']])(
    '%s e %s são a mesma unidade', (a, b) => expect(un.mesmaUnidade(a, b)).toBe(true));

  test('g e Un. são unidades DIFERENTES', () => {
    expect(un.mesmaUnidade('g', 'Un.')).toBe(false);
    expect(un.mesmaUnidade('ml', 'g')).toBe(false);
  });
});

describe('garantirUnidadeAvulsa — a opção do pedido, sem criar duplicata', () => {
  test('acrescenta Un. quando o catálogo não tem nenhuma equivalente', () => {
    expect(un.garantirUnidadeAvulsa(['g', 'ml'])).toEqual(['g', 'ml', 'Un.']);
  });

  test('🔴 NÃO acrescenta quando já existe grafia equivalente — duas opções para a mesma unidade é a duplicata que dedupPorCaixa combate', () => {
    expect(un.garantirUnidadeAvulsa(['g', 'un'])).toEqual(['g', 'un']);
    expect(un.garantirUnidadeAvulsa(['unidade'])).toEqual(['unidade']);
    expect(un.garantirUnidadeAvulsa(['Un.'])).toEqual(['Un.']);
  });

  test('catálogo vazio ainda oferece a opção — senão o seletor abriria sem nada', () => {
    expect(un.garantirUnidadeAvulsa([])).toEqual(['Un.']);
    expect(un.garantirUnidadeAvulsa(undefined)).toEqual(['Un.']);
  });
});

// ─── definirUnidadeDoMedicamento ─────────────────────────────────────────────

describe('definirUnidadeDoMedicamento — nada a fazer', () => {
  test('unidade ausente não altera nada (cliente antigo, que não manda o campo)', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: undefined, empresaId: 42 });
    expect(r).toEqual({ id: 10, copiado: false, alterado: false, unidade: 'g' });
    expect(estado.criados).toHaveLength(0);
    expect(estado.updates).toHaveLength(0);
  });

  test('🔴 mesma unidade em OUTRA grafia não cria cópia — salvar a tela sem mexer na unidade não pode encher o catálogo de cópias', async () => {
    const med = { ...GLOBAL, unidade: 'un' };
    const { tx, estado } = bancoFalso({ medicamentos: [med] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });
    expect(r.copiado).toBe(false);
    expect(r.alterado).toBe(false);
    expect(estado.criados).toHaveLength(0);
  });

  test('mesma unidade é decidida ANTES dos guards — estoque com saída não impede salvar sem trocar a unidade', async () => {
    const { tx } = bancoFalso({ medicamentos: [GLOBAL], estoquesAtivos: 5, saidas: 9 });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'g', empresaId: 42 });
    expect(r.alterado).toBe(false);
  });
});

describe('definirUnidadeDoMedicamento — copy-on-write do catálogo global', () => {
  test('🔴 a linha GLOBAL nunca é alterada: nasce uma CÓPIA da empresa', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });

    expect(r.copiado).toBe(true);
    expect(r.id).not.toBe(10);
    expect(estado.updates.filter((u) => u.id === 10)).toHaveLength(0);
    expect(estado.medicamentos.find((m) => m.id === 10).unidade).toBe('g');

    const copia = estado.criados[0];
    expect(copia.empresaId).toBe(42);
    expect(copia.unidade).toBe('Un.');
    expect(copia.nome).toBe('Dipirona');
    expect(copia.classificacao).toBe('Analgésico'); // carrega o recorte "é vacina?"
  });

  test('🔴 a cópia leva VIAS e ESPÉCIES — sem a espécie o item nasce invisível na busca do atendimento', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });
    expect(estado.viasCriadas.map((v) => v.via).sort()).toEqual(['IV', 'Oral']);
    expect(estado.especiesCriadas.map((e) => e.especieId).sort()).toEqual([1, 3]);
    expect(estado.especiesCriadas.every((e) => e.medicamentoId === r.id)).toBe(true);
  });

  test('🔴 o ESTOQUE da empresa é reapontado para a cópia — sem isso a unidade nova não valeria para nada', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });

    expect(estado.estoqueUpdateMany).toHaveLength(1);
    const { where, data } = estado.estoqueUpdateMany[0];
    expect(where).toEqual({ medicamentoId: 10, empresaId: 42, ativo: true });
    expect(data).toEqual({ medicamentoId: r.id });
  });

  test('🔴 a PRESCRIÇÃO PENDENTE é reapontada — o item apontando para o medicamento antigo executa dose SEM baixa e SEM fatura, em silêncio', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });

    expect(estado.prescricaoUpdateMany).toHaveLength(1);
    const { where, data } = estado.prescricaoUpdateMany[0];
    expect(where.medicamentoCatId).toBe(10);
    expect(where.grupo.empresaId).toBe(42);
    // Grupo já EXECUTADO/CANCELADO é histórico e fica de fora.
    expect(where.grupo.status).toEqual({ in: ['SALVO', 'FINALIZADO'] });
    expect(data).toEqual({ medicamentoCatId: r.id });
  });

  test('🔴 TODO reapontamento leva o empresaId no where — sem ele o updateMany alcançaria outra clínica', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });
    expect(estado.estoqueUpdateMany[0].where.empresaId).toBe(42);
    expect(estado.prescricaoUpdateMany[0].where.grupo.empresaId).toBe(42);
    expect(estado.raw[0]).toContain(42); // produto de fornecedor (SQL cru)
  });

  test('produto de fornecedor acompanha a cópia, e a tabela ausente não derruba a troca', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL] });
    tx.$executeRawUnsafe = () => Promise.reject(new Error('relation does not exist'));
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });
    expect(r.copiado).toBe(true);
    expect(estado.criados).toHaveLength(1);
  });

  test('cópia ANTERIOR da mesma empresa é reaproveitada e reativada — trocar a unidade duas vezes não empilha catálogo', async () => {
    const antiga = { id: 77, nome: 'Dipirona', unidade: 'mg', empresaId: 42, ativo: false };
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL, antiga] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });

    expect(r.id).toBe(77);
    expect(r.copiado).toBe(true);
    expect(estado.criados).toHaveLength(0);
    expect(estado.updates).toEqual([{ id: 77, data: { unidade: 'Un.', ativo: true } }]);
  });
});

describe('definirUnidadeDoMedicamento — medicamento que já é da empresa', () => {
  test('altera no lugar, sem cópia', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [DA_EMPRESA] });
    const r = await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 11, unidade: 'Un.', empresaId: 42 });
    expect(r).toEqual({ id: 11, copiado: false, alterado: true, unidade: 'Un.' });
    expect(estado.criados).toHaveLength(0);
    expect(estado.updates).toEqual([{ id: 11, data: { unidade: 'Un.' } }]);
    // Nada a reapontar: o estoque já aponta para este medicamento.
    expect(estado.estoqueUpdateMany).toHaveLength(0);
  });
});

describe('definirUnidadeDoMedicamento — recusas', () => {
  const esperaErro = async (args, code, status) => {
    await expect(un.definirUnidadeDoMedicamento(args.tx, args.dados))
      .rejects.toMatchObject({ code, status });
  };

  test('medicamento inexistente → 404', async () => {
    const { tx } = bancoFalso({ medicamentos: [] });
    await esperaErro({ tx, dados: { medicamentoId: 99, unidade: 'Un.', empresaId: 42 } },
      'MEDICAMENTO_NAO_ENCONTRADO', 404);
  });

  test('sem empresa no contexto → 400 (não há de quem a cópia seria)', async () => {
    const { tx } = bancoFalso({ medicamentos: [GLOBAL] });
    await esperaErro({ tx, dados: { medicamentoId: 10, unidade: 'Un.', empresaId: null } },
      'SEM_EMPRESA', 400);
  });

  test('🔴 medicamento PRIVADO de outra clínica → 404, nunca alterado', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [{ ...GLOBAL, id: 12, empresaId: 58 }] });
    await esperaErro({ tx, dados: { medicamentoId: 12, unidade: 'Un.', empresaId: 42 } },
      'MEDICAMENTO_DE_OUTRA_EMPRESA', 404);
    expect(estado.updates).toHaveLength(0);
    expect(estado.criados).toHaveLength(0);
  });

  test('🔴 OUTRA entrada de estoque ativa → 400: a quantidade dela está na unidade antiga', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL], estoquesAtivos: 2 });
    await esperaErro({ tx, dados: { medicamentoId: 10, unidade: 'Un.', empresaId: 42 } },
      'OUTRAS_ENTRADAS_DE_ESTOQUE', 400);
    expect(estado.criados).toHaveLength(0);
  });

  test('a entrada que está sendo salva NÃO conta como "outra" — é nela que a quantidade é reexpressa', async () => {
    // `count` do banco falso já devolve 0 quando o teste diz 0: o que se afirma aqui é
    // que o `where` recebe a exclusão do próprio id.
    const { tx } = bancoFalso({ medicamentos: [GLOBAL] });
    let whereRecebido = null;
    tx.estoqueClinica.count = async (args) => { whereRecebido = args.where; return 0; };
    await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42, ignorarEstoqueId: 5 });
    expect(whereRecebido.id).toEqual({ not: 5 });
    expect(whereRecebido.empresaId).toBe(42);
    expect(whereRecebido.ativo).toBe(true);
  });

  test('🔴 estoque com SAÍDA registrada → 400: já houve consumo (e fatura) na unidade antiga', async () => {
    const { tx, estado } = bancoFalso({ medicamentos: [GLOBAL], saidas: 1 });
    await esperaErro({ tx, dados: { medicamentoId: 10, unidade: 'Un.', empresaId: 42 } },
      'ESTOQUE_JA_MOVIMENTADO', 400);
    expect(estado.criados).toHaveLength(0);
  });

  test('a SAÍDA é contada só na empresa do contexto', async () => {
    const { tx } = bancoFalso({ medicamentos: [GLOBAL] });
    let whereRecebido = null;
    tx.movimentoEstoque.count = async (args) => { whereRecebido = args.where; return 0; };
    await un.definirUnidadeDoMedicamento(tx, { medicamentoId: 10, unidade: 'Un.', empresaId: 42 });
    expect(whereRecebido).toEqual({ tipo: 'SAIDA', estoque: { medicamentoId: 10, empresaId: 42 } });
  });
});

// ─── Global × cópia na mesma lista ───────────────────────────────────────────

describe('preferirCopiaDaEmpresa — o global homônimo sai da lista', () => {
  const { preferirCopiaDaEmpresa } = require('../lib/catalogoManual');

  test('🔴 com a cópia da empresa, a linha global de mesmo nome não aparece — duas "Dipirona" na busca são indistinguíveis', () => {
    const lista = [
      { id: 10, nome: 'Dipirona',   empresaId: null },
      { id: 90, nome: 'Dipirona',   empresaId: 42 },
      { id: 20, nome: 'Flunixina',  empresaId: null },
    ];
    expect(preferirCopiaDaEmpresa(lista).map((m) => m.id)).toEqual([90, 20]);
  });

  test('comparação sem caixa nem espaço em volta', () => {
    const lista = [
      { id: 10, nome: ' DIPIRONA ', empresaId: null },
      { id: 90, nome: 'dipirona',   empresaId: 42 },
    ];
    expect(preferirCopiaDaEmpresa(lista).map((m) => m.id)).toEqual([90]);
  });

  test('sem nenhum item próprio a lista sai intacta', () => {
    const lista = [{ id: 1, nome: 'A', empresaId: null }, { id: 2, nome: 'B', empresaId: null }];
    expect(preferirCopiaDaEmpresa(lista)).toHaveLength(2);
    expect(preferirCopiaDaEmpresa([])).toEqual([]);
  });
});

// ─── Preço na unidade contável ───────────────────────────────────────────────

describe('calcPrecoUnitarioBase — a conta que vai para a fatura', () => {
  const calc = EstoqueController.calcPrecoUnitarioBase;

  test('🔴 unidade CONTÁVEL passou a ter preço FIXO por unidade (antes devolvia null)', () => {
    // 10 frascos por R$ 300 → R$ 30 por frasco, congelado na entrada.
    expect(calc(300, 10, 'Un.')).toBeCloseTo(30, 6);
    expect(calc(300, 10, 'un')).toBeCloseTo(30, 6);
    expect(calc(300, 10, 'Comprimido')).toBeCloseTo(30, 6);
  });

  test('peso e volume não mudaram de conta — R$/g e R$/mL', () => {
    expect(calc(300, 1, 'kg')).toBeCloseTo(0.3, 6);   // 1 kg = 1000 g
    expect(calc(300, 1000, 'g')).toBeCloseTo(0.3, 6);
    expect(calc(100, 1, 'l')).toBeCloseTo(0.1, 6);
  });

  test('sem quantidade ou sem preço não inventa valor', () => {
    expect(calc(300, 0, 'Un.')).toBeNull();
    expect(calc(0, 10, 'Un.')).toBeNull();
    expect(calc(null, 10, 'Un.')).toBeNull();
  });
});

// ─── GATE ESTRUTURAL ─────────────────────────────────────────────────────────
// O modo de quebrar isto é ESQUECER a chamada num dos caminhos de gravação do estoque,
// ou "simplificar" a cópia para um UPDATE na linha global. Os dois passam nos testes de
// unidade acima e não derrubam tela nenhuma — por isso a varredura é no CÓDIGO.
describe('gate — a unidade é resolvida onde o estoque é gravado', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler  = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  // Comentário que EXPLICA a regra não pode fazer o gate passar sozinho.
  const semComentarios = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  test('criar e atualizar do estoque passam por definirUnidadeDoMedicamento', () => {
    const src = semComentarios(ler('controllers', 'EstoqueController.js'));
    expect(src).toMatch(/definirUnidadeDoMedicamento/);
    // `criar` resolve antes de escolher o medicamento da entrada...
    expect(src).toMatch(/const medicamentoIdFinal = unidadeResolvida\.id/);
    expect(src).toMatch(/medicamentoId:\s+medicamentoIdFinal/);
    // ...e `atualizar` resolve DENTRO da transaction da gravação: fora dela, a unidade
    // mudaria mesmo quando o salvar é recusado por outra validação.
    const corpoAtualizar = src.slice(
      src.indexOf('const atualizar = async'),
      src.indexOf('const toggle = async'),
    );
    expect(corpoAtualizar.length).toBeGreaterThan(0);
    const iTx    = corpoAtualizar.indexOf('prisma.$transaction(');
    const iDefin = corpoAtualizar.indexOf('definirUnidadeDoMedicamento(tx');
    const iUpd   = corpoAtualizar.indexOf('tx.estoqueClinica.update(');
    expect(iTx).toBeGreaterThan(-1);
    expect(iDefin).toBeGreaterThan(iTx);
    expect(iUpd).toBeGreaterThan(iDefin);
  });

  test('🔴 a lib NUNCA grava empresaId na linha que está alterando — seria roubar o medicamento global para uma clínica', () => {
    const src = semComentarios(ler('lib', 'unidadeMedicamento.js'));
    // Os únicos `medicamento.update` são os de unidade (própria e cópia reaproveitada).
    const updates = src.match(/medicamento\.update\(\{[\s\S]*?\}\)/g) ?? [];
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).not.toMatch(/empresaId/);
    // O `empresaId` só entra em `create` — a cópia.
    expect(src).toMatch(/medicamento\.create\(\{[\s\S]*?empresaId:\s+Number\(empresaId\)/);
  });

  test('o seletor de unidade da tela recebe a garantia do Un.', () => {
    const src = semComentarios(ler('controllers', 'MedicamentoController.js'));
    expect(src).toMatch(/garantirUnidadeAvulsa\(limpar\(unidades, 'unidade'\)\)/);
  });

  test('as duas listagens do catálogo escondem o global homônimo', () => {
    const src = semComentarios(ler('controllers', 'MedicamentoController.js'));
    expect(src).toMatch(/dados: preferirCopiaDaEmpresa\(medicamentos\)/);          // listar
    expect(src).toMatch(/preferirCopiaDaEmpresa\(medicamentos\)\.map\(m => \{/);   // paraAtendimento
  });
});
