'use strict';

/**
 * A LINHA DA FATURA PASSOU A JUNTAR ATENDIMENTOS (2026-09-17).
 *
 * Antes, a chave de consolidação incluía a FK de origem e a descrição carregava o
 * número do atendimento — o mesmo medicamento, na mesma dose e pelo mesmo preço,
 * aplicado em dois atendimentos do mês, virava duas linhas idênticas fora o número.
 * Agora é UMA linha, e cada execução vira uma CONTRIBUIÇÃO (`tb_fatura_item_origens`)
 * com número, data e quantidade — a observação que a tela mostra.
 *
 * 🔴 TRÊS COISAS AQUI QUEBRAM EM SILÊNCIO, e as três são dinheiro ou estoque:
 *
 *   1. O ESTORNO. Era a FK na chave que impedia "cancelar uma prescrição levar embora
 *      a cobrança da outra". Quem impede agora são as contribuições: o cancelamento
 *      SUBTRAI o que era daquela origem. Se alguém voltar a apagar a linha inteira, o
 *      cliente deixa de ser cobrado por doses que recebeu — e a fatura fecha "certa"
 *      na soma das linhas, sem nenhum erro em lugar nenhum.
 *
 *   2. "JÁ FOI FATURADO?" pela FK. A FK guarda só a origem PRINCIPAL; a segunda vacina
 *      a cair na mesma linha foi cobrada e a FK não a menciona. É esse "sim" que, no
 *      CANCELAMENTO da vacina, prova que o lote foi debitado e autoriza devolver as
 *      doses ao estoque — um falso "não" ali deixa o estoque encolhido em silêncio.
 *
 *   3. A LINHA LEGADA (lançada antes da migration) não tem contribuição nenhuma. Se o
 *      estorno tratar "não sei" como "não sobrou nada a estornar", ela deixa de ser
 *      apagada e o cancelamento para de devolver dinheiro.
 */

const {
  adicionarFaturaItem,
  adicionarOuSomarFaturaItem,
  removerFaturaItensDaOrigem,
  valorLiquidoItem,
} = require('../lib/faturaUtils');
const itemOrigens = require('../lib/faturaItemOrigens');

// ─────────────────────────────────────────────────────────────────────────────
// tx falso: guarda linhas e contribuições em memória. O roteador de SQL cru casa
// pelos fragmentos que cada consulta da lib tem de próprio — a lib fala SQL, e um
// mock que só devolvesse objetos não exercitaria o caminho real dela.
// ⚠️ `origensPorItem` (o JOIN grande, de LEITURA) fica de fora: ele não decide
// dinheiro nenhum e não há como validar o SQL sem banco.
// ─────────────────────────────────────────────────────────────────────────────
function txFalso(linhas = [], origens = []) {
  const estado = {
    linhas:  linhas.map(l => ({ ...l })),
    origens: origens.map(o => ({ ...o })),
    fatura:  { id: 1, total: 0, status: 'ABERTA' },
    seq: 100, seqOrigem: 500,
  };
  const casa = (l, where) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && Array.isArray(v.in)) return v.in.includes(l[k]);
    return (l[k] ?? null) === v;
  });

  const tx = {
    estado,
    faturaItem: {
      // `include: { fatura }` é o que o estorno usa para barrar fatura PAGA — sem
      // anexá-la, o teste passaria por um TypeError em vez de exercitar a regra.
      findMany: async ({ where, include }) => estado.linhas
        .filter(l => casa(l, where))
        .map(l => (include?.fatura ? { ...l, fatura: estado.fatura } : l)),
      findFirst: async ({ where, include }) => {
        const achado = estado.linhas.find(l => casa(l, where)) ?? null;
        if (!achado) return null;
        return include?.fatura ? { ...achado, fatura: estado.fatura } : achado;
      },
      create: async ({ data }) => {
        const nova = { id: ++estado.seq, descontoTipo: null, descontoValor: 0, ...data };
        estado.linhas.push(nova);
        return nova;
      },
      update: async ({ where, data }) => {
        const alvo = estado.linhas.find(l => l.id === where.id);
        if (data.quantidade?.increment != null) alvo.quantidade += data.quantidade.increment;
        else if (data.quantidade != null) alvo.quantidade = data.quantidade;
        if (data.descricao != null) alvo.descricao = data.descricao;
        if (data.valor != null) alvo.valor = data.valor;
        return alvo;
      },
      deleteMany: async ({ where }) => {
        const alvos = estado.linhas.filter(l => casa(l, where)).map(l => l.id);
        estado.linhas  = estado.linhas.filter(l => !alvos.includes(l.id));
        estado.origens = estado.origens.filter(o => !alvos.includes(o.fatura_item_id));
        return { count: alvos.length };
      },
    },
    fatura: {
      update: async ({ data }) => {
        if (data.total?.increment != null) estado.fatura.total += data.total.increment;
        else if (data.total != null) estado.fatura.total = data.total;
        return estado.fatura;
      },
      updateMany: async () => ({ count: 1 }),
    },
  };

  // Só as linhas que ainda existem contam — espelha o ON DELETE CASCADE do banco.
  const origensVivas = () =>
    estado.origens.filter(o => estado.linhas.some(l => l.id === o.fatura_item_id));

  tx.$executeRawUnsafe = async (sql, ...p) => {
    if (sql.includes('INSERT INTO schs2vet.tb_fatura_item_origens')) {
      const coluna = Object.values(itemOrigens.COLUNA_ORIGEM).find(c => sql.includes(`, ${c},`));
      estado.origens.push({
        id: ++estado.seqOrigem, fatura_item_id: p[0], [coluna]: p[1],
        quantidade: p[2], ocorrido_em: p[3] ?? new Date(),
      });
      return 1;
    }
    if (sql.includes('DELETE FROM schs2vet.tb_fatura_item_origens')) {
      const coluna = Object.values(itemOrigens.COLUNA_ORIGEM).find(c => sql.includes(`WHERE ${c} =`));
      const antes = estado.origens.length;
      estado.origens = estado.origens.filter(o => (o[coluna] ?? null) !== p[0]);
      return antes - estado.origens.length;
    }
    if (sql.includes('UPDATE schs2vet.tb_fatura_itens fi')) {
      const restantes = origensVivas()
        .filter(o => o.fatura_item_id === p[0])
        .sort((a, b) => new Date(a.ocorrido_em) - new Date(b.ocorrido_em) || a.id - b.id);
      const linha = estado.linhas.find(l => l.id === p[0]);
      if (linha && restantes[0]) {
        linha.exameClinicoId          = restantes[0].exame_clinico_id ?? null;
        linha.prescricaoId            = restantes[0].prescricao_id ?? null;
        linha.vacinaClinicaId         = restantes[0].vacina_clinica_id ?? null;
        linha.encaminhamentoClinicoId = restantes[0].encaminhamento_clinico_id ?? null;
      }
      return 1;
    }
    throw new Error(`SQL não previsto no tx falso: ${sql.slice(0, 60)}`);
  };

  tx.$queryRawUnsafe = async (sql, ...p) => {
    if (sql.includes('GROUP BY fatura_item_id')) {
      const coluna = Object.values(itemOrigens.COLUNA_ORIGEM).find(c => sql.includes(`WHERE ${c} =`));
      const porItem = new Map();
      for (const o of origensVivas().filter(o => (o[coluna] ?? null) === p[0])) {
        const atual = porItem.get(o.fatura_item_id) ?? { quantidade: 0, contribuicoes: 0 };
        atual.quantidade += o.quantidade;
        atual.contribuicoes += 1;
        porItem.set(o.fatura_item_id, atual);
      }
      return [...porItem].map(([faturaItemId, v]) => ({ faturaItemId, ...v }));
    }
    if (sql.includes('COUNT(*)::int AS total')) {
      const meus = origensVivas().filter(o => o.fatura_item_id === p[0]);
      return [{ total: meus.length, quantidade: meus.reduce((a, o) => a + o.quantidade, 0) }];
    }
    if (sql.includes('COUNT(*)::int AS fora')) {
      const coluna = Object.values(itemOrigens.COLUNA_ORIGEM).find(c => sql.includes(`(${c} IS DISTINCT`));
      const fora = origensVivas()
        .filter(o => o.fatura_item_id === p[0] && (o[coluna] ?? null) !== p[1]).length;
      return [{ fora }];
    }
    throw new Error(`SQL não previsto no tx falso: ${sql.slice(0, 60)}`);
  };

  return tx;
}

const dose = (extra = {}) => ({
  faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
  descricao: 'Ivermectina — 10mL × 4/4h',
  valor: 20, quantidade: 1, prescricaoId: 55, ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────

describe('a linha junta atendimentos diferentes', () => {
  it('mesmo item, mesmo preço, PRESCRIÇÕES diferentes → UMA linha com a soma', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));

    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].quantidade).toBe(3);
    expect(tx.estado.fatura.total).toBe(60);
  });

  it('cada execução vira uma CONTRIBUIÇÃO, com a própria data e quantidade', async () => {
    const tx = txFalso();
    const d1 = new Date('2026-09-15T12:00:00Z');
    const d2 = new Date('2026-09-17T12:00:00Z');
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55, ocorridoEm: d1 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56, ocorridoEm: d2 }));

    expect(tx.estado.origens).toHaveLength(2);
    expect(tx.estado.origens.map(o => o.prescricao_id)).toEqual([55, 56]);
    expect(tx.estado.origens.map(o => o.ocorrido_em)).toEqual([d1, d2]);
  });

  it('a soma das contribuições é a quantidade da linha — o invariante', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56, quantidade: 2 }));

    const linha = tx.estado.linhas[0];
    const soma  = tx.estado.origens.reduce((a, o) => a + o.quantidade, 0);
    expect(soma).toBe(linha.quantidade);
  });

  it('preço unitário diferente continua abrindo linha própria', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55, valor: 20 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56, valor: 31.5 }));
    expect(tx.estado.linhas).toHaveLength(2);
  });

  // 🔴 CASO INVERTIDO em 2026-09-19 (a pedido): a posologia SAIU da descrição, então o
  // mesmo remédio com frequências diferentes passa a ser UMA linha. Antes ele travava o
  // contrário ("posologia diferente abre linha própria", 2026-09-17). O que continua
  // separando o que precisa ser separado é o VALOR UNITÁRIO, testado logo acima.
  it('posologia diferente passa a CONSOLIDAR (a descrição é o produto)', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55, descricao: 'Amoxicilina' }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56, descricao: 'Amoxicilina' }));
    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].quantidade).toBe(2);
  });

  it('animal diferente continua abrindo linha própria (a fatura é rateada por paciente)', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55, animalId: 7 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56, animalId: 8 }));
    expect(tx.estado.linhas).toHaveLength(2);
  });

  it('linha criada por `adicionarFaturaItem` também nasce com contribuição', async () => {
    // Sem isso, a linha teria quantidade 1 e ZERO contribuição — e o estorno dela
    // subtrairia menos do que devia, deixando cobrança órfã na fatura.
    const tx = txFalso();
    await adicionarFaturaItem(tx, dose({ vacinaClinicaId: 9, prescricaoId: null }));
    expect(tx.estado.origens).toHaveLength(1);
    expect(tx.estado.origens[0].vacina_clinica_id).toBe(9);
  });
});

describe('🔴 estorno: cancelar UMA origem não pode levar a cobrança das outras', () => {
  it('a linha compartilhada é SUBTRAÍDA, não apagada', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));
    expect(tx.estado.linhas[0].quantidade).toBe(3);

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);

    expect(tx.estado.linhas).toHaveLength(1);      // a linha sobreviveu
    expect(tx.estado.linhas[0].quantidade).toBe(1); // só a dose da 56 continua devida
    expect(tx.estado.fatura.total).toBe(20);
  });

  it('a FK de origem principal passa para quem ficou', async () => {
    // Deixá-la apontando para a prescrição CANCELADA faria o link da tela levar a um
    // registro que não existe mais, e o agrupamento do insumo casar com o errado.
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));
    expect(tx.estado.linhas[0].prescricaoId).toBe(55);

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);
    expect(tx.estado.linhas[0].prescricaoId).toBe(56);
  });

  it('cancelar a ÚLTIMA origem apaga a linha', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);
    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 56);

    expect(tx.estado.linhas).toHaveLength(0);
    expect(tx.estado.fatura.total).toBe(0);
  });

  it('linha LEGADA (sem contribuição nenhuma) continua sendo apagada inteira', async () => {
    // É o comportamento anterior, e ele tem de sobreviver: linha lançada antes da
    // migration não tem contribuição, e tratar "não sei" como "nada a estornar" faria
    // o cancelamento parar de devolver dinheiro.
    const tx = txFalso([{
      id: 1, faturaId: 1, animalId: 7, tipo: 'MEDICAMENTO',
      descricao: '[AG-0012] Ivermectina — 10mL × 4/4h',
      valor: 20, quantidade: 4, prescricaoId: 55,
    }]);

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);
    expect(tx.estado.linhas).toHaveLength(0);
  });

  it('não mexe na linha de outra origem', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 77, descricao: 'Dipirona — 5mL × 8/8h' }));

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);

    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].descricao).toBe('Dipirona — 5mL × 8/8h');
  });

  it('o desconto acompanha a linha que sobrou (é do MEDICAMENTO, não da dose)', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));
    tx.estado.linhas[0].descontoTipo  = 'PERCENTUAL';
    tx.estado.linhas[0].descontoValor = 10;

    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);

    const linha = tx.estado.linhas[0];
    expect(linha.quantidade).toBe(1);
    expect(valorLiquidoItem(linha)).toBeCloseTo(18, 2);   // 20 − 10%
    expect(tx.estado.fatura.total).toBeCloseTo(18, 2);
  });
});

describe('🔴 "já foi faturado?" não pode depender só da FK', () => {
  it('a 2ª vacina da linha compartilhada responde SIM — é o que devolve doses ao lote', async () => {
    const tx = txFalso();
    await adicionarOuSomarFaturaItem(tx, dose({
      tipo: 'VACINA', descricao: 'Antirrábica — 1 dose', prescricaoId: null, vacinaClinicaId: 9,
    }));
    await adicionarOuSomarFaturaItem(tx, dose({
      tipo: 'VACINA', descricao: 'Antirrábica — 1 dose', prescricaoId: null, vacinaClinicaId: 10,
    }));

    // A FK da linha guarda só a PRIMEIRA — pela FK, a segunda "nunca foi cobrada".
    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].vacinaClinicaId).toBe(9);
    expect(await tx.faturaItem.findFirst({ where: { vacinaClinicaId: 10 } })).toBeNull();

    expect(await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', 10)).toBe(true);
  });

  it('vacina que nunca foi cobrada responde NÃO', async () => {
    const tx = txFalso();
    expect(await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', 42)).toBe(false);
  });

  it('linha LEGADA (FK preenchida, sem contribuição) responde SIM', async () => {
    const tx = txFalso([{
      id: 1, faturaId: 1, animalId: 7, tipo: 'VACINA',
      descricao: '[VC-0004] Antirrábica', valor: 50, quantidade: 1, vacinaClinicaId: 9,
    }]);
    expect(await itemOrigens.origemJaFaturada(tx, 'vacinaClinicaId', 9)).toBe(true);
  });
});

describe('base ainda NÃO migrada não pode quebrar a cobrança', () => {
  // Sem a tabela, todo caminho da lib devolve vazio/null — e o sistema tem de cair no
  // comportamento anterior, nunca em erro na tela nem em cobrança errada.
  const txSemTabela = (linhas = []) => {
    const tx = txFalso(linhas);
    tx.$executeRawUnsafe = async () => { throw new Error('relation does not exist'); };
    tx.$queryRawUnsafe   = async () => { throw new Error('relation does not exist'); };
    return tx;
  };

  it('a consolidação continua funcionando (só sem observação)', async () => {
    const tx = txSemTabela();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 56 }));
    expect(tx.estado.linhas).toHaveLength(1);
    expect(tx.estado.linhas[0].quantidade).toBe(2);
    expect(tx.estado.fatura.total).toBe(40);
  });

  it('o estorno cai no comportamento antigo: apaga a linha', async () => {
    const tx = txSemTabela();
    await adicionarOuSomarFaturaItem(tx, dose({ prescricaoId: 55 }));
    await removerFaturaItensDaOrigem(tx, 'prescricaoId', 55);
    expect(tx.estado.linhas).toHaveLength(0);
  });
});

describe('GATE ESTRUTURAL — os elos que somem em silêncio', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler  = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // Comentário que EXPLICA a regra citando o padrão proibido faria a varredura passar
  // (ou reprovar) pelo motivo errado — é a própria documentação acusando o código.
  const semComentarios = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  it('a descrição da PRESCRIÇÃO não carrega mais o nº do atendimento', () => {
    // Com o `[AG-0012]` de volta no texto, a chave nunca casa entre atendimentos: a
    // consolidação continua existindo no código e deixa de acontecer na prática.
    const src = semComentarios(ler('controllers/PrescricaoGrupoController.js'));
    expect(src).toMatch(/function descricaoItemFatura\(item\)/);
    expect(src).not.toMatch(/\[\$\{atendNum\}\]/);
  });

  it('a descrição da PRESCRIÇÃO é só o PRODUTO — sem dosagem nem frequência', () => {
    // 2026-09-19: devolver a posologia ao texto volta a partir em duas linhas o mesmo
    // remedio prescrito com frequencias diferentes, e nada acusa. A assercao e por
    // STRING LITERAL, e nao regex sobre o corpo: o que precisa sumir e exatamente a
    // interpolacao que montava a posologia NA FATURA - a de `debitarEstoqueDia`
    // descreve o MOVIMENTO de estoque e continua valendo.
    const src = semComentarios(ler('controllers/PrescricaoGrupoController.js'));
    expect(src).not.toContain("${item.unidade ?? ''} × ${item.frequencia}");
    expect(src).toContain('return item.medicamento;');
  });

  it('a descrição da VACINA não carrega mais VC-/AG- e ela consolida', () => {
    const src = semComentarios(ler('controllers/VacinaClinicaController.js'));
    expect(src).not.toMatch(/\[\$\{vcNum\}\]/);
    expect(src).toMatch(/adicionarOuSomarFaturaItem\(tx, \{[\s\S]{0,400}vacinaClinicaId: vacina\.id/);
  });

  it('a chave de consolidação NÃO inclui a FK de origem', () => {
    // Reintroduzir a origem na chave desfaz a consolidação sem apagar uma linha sequer
    // — o código continua "certo" e a fatura volta a repetir linhas.
    const src = semComentarios(ler('lib/faturaUtils.js'));
    const chave = src.match(/const candidatos = await tx\.faturaItem\.findMany\(\{[\s\S]*?\}\);/)[0];
    expect(chave).toContain('faturaId, tipo, descricao');
    expect(chave).not.toMatch(/origem|prescricaoId|vacinaClinicaId/);
  });

  it('o estorno passa pelas contribuições', () => {
    const src = semComentarios(ler('lib/faturaUtils.js'));
    const fn  = src.match(/async function removerFaturaItensDaOrigem[\s\S]*?\n\}/)[0];
    expect(fn).toContain('itemOrigens.contribuicoesDaOrigem');
    expect(fn).toContain('itemOrigens.resumoDaLinha');
    expect(fn).toContain('itemOrigens.reapontarOrigemPrincipal');
  });

  it('TODO "já foi faturado?" da vacina passa por `origemJaFaturada`', () => {
    // 🔴 São QUATRO desde 2026-09-23: `registrar`, `finalizar`, `executar` e o
    // `atualizar` — que passou a poder mover uma vacina FINALIZADA para o quadrante
    // "clínica fornece × proprietário aplica", onde a cobrança acontece na hora.
    // ⚠️ O número é o que impede um ponto novo nascer com a FK crua: a linha da fatura
    // é COMPARTILHADA e a FK guarda só a PRIMEIRA vacina que caiu nela, então pela FK
    // a segunda pareceria nunca cobrada e seria cobrada de novo.
    const vac = semComentarios(ler('controllers/VacinaClinicaController.js'));
    expect(vac.match(/origemJaFaturada\(/g) ?? []).toHaveLength(4);
    // O padrão antigo (FK crua) não pode voltar em nenhum deles.
    expect(vac).not.toMatch(/faturaItem\.findFirst\(\{\s*\n?\s*where: \{ vacinaClinicaId/);
  });

  it('a FINALIZAÇÃO também consolida — a fatura não pode ter duas regras', () => {
    // O item que o proprietário aplica em casa é cobrado na finalização (nunca chega
    // ao plantão). Se ele abrisse linha nova enquanto a dose executada soma, a MESMA
    // fatura teria dois comportamentos para a mesma pergunta.
    const src = semComentarios(ler('controllers/PrescricaoGrupoController.js'));
    expect(src).not.toContain('adicionarFaturaItem(');
    expect(src.match(/adicionarOuSomarFaturaItem\(tx, \{/g) ?? []).toHaveLength(3);
  });

  it('a fatura devolve as contribuições de cada item', () => {
    const src = semComentarios(ler('controllers/FaturaController.js'));
    expect(src).toContain('origensPorItem');
    // Uma consulta para a fatura inteira, nunca uma por item.
    expect(src).toMatch(/origensPorItem\(prisma, fatura\.itens\.map/);
  });
});
