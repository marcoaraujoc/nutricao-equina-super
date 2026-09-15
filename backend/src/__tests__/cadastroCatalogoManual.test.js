// backend/src/__tests__/cadastroCatalogoManual.test.js
//
// CADASTRO RÁPIDO de medicamento/vacina pelas telas (Prescrição, Vacina e Entrada de
// Estoque), via `garantirMedicamentoDaEmpresa`.
//
// O que quebra em SILÊNCIO aqui — e por isso está coberto:
//
//   1. 🔴 `classificacao` NULA. O recorte de "não é vacina", usado por
//      `paraAtendimento` (busca da Prescrição) e por `listar` (lista da Farmácia), é
//      `NOT: { classificacao: { contains: 'vacin' } }` — e em SQL o NOT sobre NULL não
//      é verdadeiro. Item criado com classificação nula nasce FORA das duas buscas e
//      fora desta própria função, que então cria uma linha nova a cada chamada. Nada
//      estoura: a tela só mostra o catálogo sem o item que acabou de ser cadastrado.
//      Medido na base antes da correção: das 32 linhas com classificação nula, ZERO
//      passavam pelo filtro.
//   2. Reaproveitar o existente é o que mantém a função idempotente por (nome+empresa):
//      prescrever o mesmo nome duas vezes tem de continuar dando UMA linha.
//   3. Item EXISTENTE não pode ter forma/unidade/apresentação/vias reescritas — ele
//      pode ser do catálogo GLOBAL, que a clínica não edita (e o RLS recusaria).
//   4. O caminho ANTIGO (só o nome, do salvar da prescrição) tem de continuar valendo,
//      com os padrões de sempre — endurecer aqui quebraria toda chamada existente.
//   5. Vias repetidas violariam o unique (medicamentoId, via); vias em branco virariam
//      opção vazia no seletor.

const { garantirMedicamentoDaEmpresa } = require('../lib/catalogoManual');

/** tx falsa: registra o que foi consultado/criado, sem tocar em banco. */
function txFake(existente = null) {
  const chamadas = { findFirst: [], create: [], vias: [], especies: [] };
  return {
    chamadas,
    medicamento: {
      findFirst: async (args) => { chamadas.findFirst.push(args); return existente; },
      create:    async (args) => { chamadas.create.push(args); return { id: 77 }; },
    },
    medicamentoVia: {
      createMany: async (args) => { chamadas.vias.push(args); return { count: args.data.length }; },
    },
    medicamentoEspecie: {
      findFirst: async () => null,
      create:    async (args) => { chamadas.especies.push(args.data); return args.data; },
    },
  };
}

const FORM = {
  nome: 'Dipirona 500 mg/mL',
  formaFarmaceutica: 'Solução Injetável',
  unidade: 'mL',
  apresentacao: 'Frasco ampola',
  controlado: true,
  vias: ['Intramuscular', 'Intravenosa (IV)'],
};

/** O MESMO recorte que `paraAtendimento` e `listar` aplicam, com a semântica do SQL. */
const passaNoFiltroNaoVacina = (classificacao) =>
  classificacao != null && !/vacin/i.test(classificacao);

describe('cadastro rápido no catálogo da empresa', () => {
  test('🔴 medicamento NUNCA nasce com classificação nula — senão some das buscas', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, FORM, 59);

    const { classificacao } = tx.chamadas.create[0].data;
    expect(classificacao).not.toBeNull();
    expect(classificacao).toBeDefined();
    // É este filtro que decide se o item aparece na Prescrição e na Farmácia.
    expect(passaNoFiltroNaoVacina(classificacao)).toBe(true);
  });

  test('vacina nasce classificada como Vacina (é o que o recorte dela procura)', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, { ...FORM, vacina: true, unidade: 'dose' }, 59);

    const { classificacao } = tx.chamadas.create[0].data;
    expect(/vacin/i.test(classificacao)).toBe(true);
    expect(passaNoFiltroNaoVacina(classificacao)).toBe(false);
  });

  test('grava os campos do formulário e nasce PRIVADO da empresa', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, FORM, 59);

    expect(tx.chamadas.create[0].data).toMatchObject({
      nome:              'Dipirona 500 mg/mL',
      formaFarmaceutica: 'Solução Injetável',
      unidade:           'mL',
      apresentacao:      'Frasco ampola',
      controlado:        true,
      empresaId:         59,
      ativo:             true,
    });
  });

  test('vias entram no item novo, sem repetição e sem vazio', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, {
      ...FORM, vias: ['Oral', 'Oral', '  ', 'Tópica'],
    }, 59);

    expect(tx.chamadas.vias).toHaveLength(1);
    expect(tx.chamadas.vias[0].data.map(v => v.via)).toEqual(['Oral', 'Tópica']);
    expect(tx.chamadas.vias[0].skipDuplicates).toBe(true);
  });

  test('sem vias informadas não escreve nada em tb_medicamento_vias', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, { nome: 'X', unidade: 'mL' }, 59);
    expect(tx.chamadas.vias).toHaveLength(0);
  });

  test('caminho ANTIGO (só o nome) segue valendo, com os padrões de sempre', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, { nome: 'Item solto' }, 59);

    const d = tx.chamadas.create[0].data;
    expect(d.formaFarmaceutica).toBe('Manual');
    expect(d.apresentacao).toBe('Manual');
    expect(d.unidade).toBe('un');
    expect(d.controlado).toBe(false);
    expect(passaNoFiltroNaoVacina(d.classificacao)).toBe(true);
  });

  test('item EXISTENTE é reaproveitado e NÃO tem os campos reescritos', async () => {
    // `empresaId: null` = linha do catálogo GLOBAL: a clínica não a edita.
    const tx = txFake({ id: 12, empresaId: null });
    const id = await garantirMedicamentoDaEmpresa(tx, FORM, 59);

    expect(id).toBe(12);
    expect(tx.chamadas.create).toHaveLength(0);
    expect(tx.chamadas.vias).toHaveLength(0);
  });

  test('a espécie é vinculada — é ela que faz o item aparecer na busca depois', async () => {
    const tx = txFake();
    await garantirMedicamentoDaEmpresa(tx, { ...FORM, especieIds: [1, 1, 2, 0, null] }, 59);
    expect(tx.chamadas.especies.map(e => e.especieId)).toEqual([1, 2]);
  });

  test('sem nome não cria nada', async () => {
    const tx = txFake();
    expect(await garantirMedicamentoDaEmpresa(tx, { nome: '   ' }, 59)).toBeNull();
    expect(tx.chamadas.create).toHaveLength(0);
  });

  test('fabricante entra na VACINA e em branco grava NULL (nunca string vazia)', async () => {
    const comFab = txFake();
    await garantirMedicamentoDaEmpresa(comFab, { ...FORM, vacina: true, fabricante: '  Zoetis  ' }, 59);
    expect(comFab.chamadas.create[0].data.fabricante).toBe('Zoetis');

    // Vazio viraria um "fabricante sem nome" no filtro do Estoque de Vacinas.
    const semFab = txFake();
    await garantirMedicamentoDaEmpresa(semFab, { ...FORM, vacina: true, fabricante: '   ' }, 59);
    expect(semFab.chamadas.create[0].data.fabricante).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Opções dos seletores da tela de cadastro (GET /medicamentos/opcoes-catalogo).
//
// O que quebra em SILÊNCIO: o catálogo tem 'kg' e 'Kg', 'Frasco' e 'FRASCO'. Com
// `distinct` puro, o seletor mostra as duas como se fossem valores diferentes — quem
// cadastra escolhe uma ou outra e o catálogo passa a acumular variação do MESMO valor.
// Medido na base: formas 71 → 63, unidades 12 → 11, apresentações 522 → 513.
// ─────────────────────────────────────────────────────────────────────────────

const { dedupPorCaixa } = require('../lib/catalogoManual');

const linha = (valor, n) => ({ unidade: valor, _count: { _all: n } });

describe('opções do catálogo — uma por valor, ignorando a caixa', () => {
  test('🔴 kg e Kg viram UMA opção, na grafia mais usada', () => {
    expect(dedupPorCaixa([linha('Kg', 3), linha('kg', 40)], 'unidade')).toEqual(['kg']);
    // e o desempate é pela contagem, não pela ordem alfabética
    expect(dedupPorCaixa([linha('kg', 2), linha('Kg', 40)], 'unidade')).toEqual(['Kg']);
  });

  test('espaço em volta não cria uma segunda opção', () => {
    expect(dedupPorCaixa([linha('mL', 10), linha(' mL ', 2)], 'unidade')).toEqual(['mL']);
  });

  test('valor vazio ou nulo não vira opção em branco no seletor', () => {
    expect(dedupPorCaixa([linha('', 5), linha('   ', 5), linha(null, 5), linha('mg', 1)], 'unidade'))
      .toEqual(['mg']);
  });

  test('não inventa grafia — devolve um valor que EXISTE no catálogo', () => {
    const saida = dedupPorCaixa([linha('FRASCO', 9), linha('frasco', 1)], 'unidade');
    expect(saida).toEqual(['FRASCO']);
    expect(saida[0]).not.toBe('Frasco');
  });

  test('ordena em pt-BR (acento entra na ordem certa)', () => {
    const saida = dedupPorCaixa(
      [linha('Óleo', 1), linha('Ampola', 1), linha('Cápsula', 1), linha('Bolsa', 1)], 'unidade');
    expect(saida).toEqual(['Ampola', 'Bolsa', 'Cápsula', 'Óleo']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Curadoria do seletor de VIAS (`viaExcluidaDoSeletor`) — pedido do usuário depois
// de ver o catálogo bruto na tela: bare abreviações duplicando a forma por extenso,
// via de espécie que não é a atendida, "Endovenosa" duplicando "Intravenosa", e duas
// entradas quase idênticas (uma delas ilegível ou com typo).
//
// 🔴 NÃO apaga nada do banco — só filtra o que o `opcoesCatalogo` OFERECE no
// seletor. Confirmado ao vivo contra a base: MEDICAMENTO 114 → 93 vias, VACINA
// 13 → 9.
// ─────────────────────────────────────────────────────────────────────────────

const { viaExcluidaDoSeletor } = require('../lib/catalogoManual');

describe('curadoria do seletor de vias', () => {
  test('vacina: exclui as 4 abreviações soltas/de espécie, mas NADA além disso', () => {
    for (const v of ['SC', 'sc', 'IM', 'im', 'SC (bovinos)', 'IM (equinos)']) {
      expect(viaExcluidaDoSeletor(v, true)).toBe(true);
    }
    // As formas por extenso continuam oferecidas — são o que substitui as siglas.
    expect(viaExcluidaDoSeletor('Subcutânea (SC)', true)).toBe(false);
    expect(viaExcluidaDoSeletor('Intramuscular (IM)', true)).toBe(false);
    expect(viaExcluidaDoSeletor('Intranasal', true)).toBe(false);
  });

  test('medicamento: SC e IM soltos NÃO são excluídos — a regra ali é outra', () => {
    // A vacina teve as duas siglas retiradas por causa da forma por extenso
    // duplicada no MESMO catálogo; o de medicamento não tem esse duplo e não foi
    // pedido para removê-las.
    expect(viaExcluidaDoSeletor('SC', false)).toBe(false);
    expect(viaExcluidaDoSeletor('IM', false)).toBe(false);
  });

  test('medicamento: qualquer via com "bovin" ou "vitela" é excluída', () => {
    for (const v of [
      'SC (bovinos)', 'SC (apenas em bovinos)', 'IM (bovinos e equinos)',
      'Intrarruminal (bovinos)', 'SC (vitelas)',
      'Tópica (com aplicação em toda linha dorsal dos bovinos, do meio do pescoço (cernelha) até a inserção da cauda)',
    ]) expect(viaExcluidaDoSeletor(v, false)).toBe(true);

    // "equinos" não é bovino — continua oferecida.
    expect(viaExcluidaDoSeletor('IM (equinos)', false)).toBe(false);
  });

  test('🔴 medicamento: TODAS as variantes de EV são excluídas — IV cobre a via', () => {
    for (const v of [
      'EV', 'EV Lenta', 'EV (equinos)', 'EV (bovinos e equinos)',
      'EV Lenta (bovinos e equinos)', 'EV (em caso de intoxicação aguda, aplicando lentamente 25% da dose indicada.)',
    ]) expect(viaExcluidaDoSeletor(v, false)).toBe(true);

    // IV (a via que fica) nunca pode cair na mesma regra.
    for (const v of ['IV', 'IV Lenta', 'IV Rápida', 'IV (equinos)', 'IV Muito Lenta'])
      expect(viaExcluidaDoSeletor(v, false)).toBe(false);
  });

  test('medicamento: duplicata do Epidural sacrococcígeo — mantém a grafia PLURAL', () => {
    expect(viaExcluidaDoSeletor('Epidural (nos espaços sacrococcígeo)', false)).toBe(true);
    expect(viaExcluidaDoSeletor('Epidural (nos espaços sacrococcígeos)', false)).toBe(false);
    // O bare "Epidural" e a variante de bloqueio nervoso não são a duplicata.
    expect(viaExcluidaDoSeletor('Epidural', false)).toBe(false);
    expect(viaExcluidaDoSeletor('Epidural (Bloqueio Nervoso)', false)).toBe(false);
  });

  test('medicamento: Ambiental com descrição longa sai; o "Ambiental" curto fica', () => {
    expect(viaExcluidaDoSeletor(
      'Ambiental (Aplicar EXCLUSIVAMENTE SOBRE SUPERFÍCIES INANIMADAS (instalações, equipamentos e iscas).',
      false,
    )).toBe(true);
    expect(viaExcluidaDoSeletor('Ambiental', false)).toBe(false);
  });

  test('vazio/nulo não é excluído por engano (a lista já filtra vazio antes)', () => {
    expect(viaExcluidaDoSeletor('', false)).toBe(false);
    expect(viaExcluidaDoSeletor(null, true)).toBe(false);
  });
});
