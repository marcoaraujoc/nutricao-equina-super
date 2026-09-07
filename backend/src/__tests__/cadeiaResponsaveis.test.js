// backend/src/__tests__/cadeiaResponsaveis.test.js
//
// CADEIA DE RESPONSÁVEIS — quem já respondeu pelo registro, em ordem.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: a cadeia é escrita por SQL cru e lida por SQL cru,
// então nada nela é verificado pelo compilador. Os três modos de quebrá-la são
// silenciosos: (1) empilhar `null` e a tela riscar um nome em branco; (2) empilhar o
// mesmo id duas vezes e o nome sair riscado em duplicata; (3) perder a ORDEM na
// leitura e a história ser contada de trás para frente.
'use strict';

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const {
  empilharResponsavel, empilharDosMovidos, lerCadeia, anexarCadeiaEmLista,
} = require('../lib/cadeiaResponsaveis');

// ── Banco falso ─────────────────────────────────────────────────────────────
// Guarda a cadeia de cada linha e reproduz o que importa do SQL: o `array_append`
// e a guarda "não repete o último elemento".
function bancoFalso(linhas, { semColuna = false } = {}) {
  const dados = new Map(linhas.map(l => [l.id, { ...l, cadeia: [...(l.cadeia ?? [])] }]));
  const sqls  = [];

  return {
    dados,
    sqls,
    async $executeRawUnsafe(sql, ids, valor) {
      sqls.push(sql);
      if (semColuna) throw new Error('column "responsaveis_anteriores" does not exist');
      // ⚠️ A guarda do "não repete o último" é DERIVADA DO SQL, não codificada aqui:
      // o mock só a aplica quando a cláusula existe na consulta. Sem isso o teste
      // estaria checando o próprio mock, e remover a cláusula da lib passaria batido.
      const temGuarda = /<>[\s\S]*\$2::int/.test(sql);
      for (const id of ids) {
        const linha = dados.get(Number(id));
        if (!linha) continue;
        if (temGuarda && linha.cadeia[linha.cadeia.length - 1] === Number(valor)) continue;
        linha.cadeia.push(Number(valor));
      }
      return ids.length;
    },
    async $queryRawUnsafe(sql, ids) {
      sqls.push(sql);
      if (semColuna) throw new Error('column "responsaveis_anteriores" does not exist');
      // Idem para a ORDEM: sem `ORDER BY ... ord` no SQL, o banco não promete ordem
      // nenhuma — o mock devolve embaralhado para o teste acusar.
      const ordenaPorOrd = /ORDER BY[\s\S]*e\.ord/i.test(sql);
      const saida = [];
      for (const id of ids) {
        const linha = dados.get(Number(id));
        if (!linha) continue;
        linha.cadeia.forEach((uid, i) => {
          saida.push({ id: linha.id, ord: i + 1, usuarioId: uid, nome: linha.nomes?.[uid] ?? null });
        });
      }
      return ordenaPorOrd ? saida : saida.slice().reverse();
    },
  };
}

describe('escrita da cadeia', () => {
  test('empilha o dono anterior no FIM (ordem cronológica)', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [10] }]);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 20);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 30);
    expect(db.dados.get(1).cadeia).toEqual([10, 20, 30]);
  });

  test('NÃO empilha null — agendamento sem responsável não deixa um vão riscado', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [] }]);
    await empilharResponsavel(db, 'AGENDAMENTO', [1], null);
    await empilharResponsavel(db, 'AGENDAMENTO', [1], undefined);
    expect(db.dados.get(1).cadeia).toEqual([]);
    expect(db.sqls).toHaveLength(0);   // nem chega ao banco
  });

  test('NÃO repete o último — dois caminhos podem carimbar a mesma troca', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [10] }]);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 10);
    expect(db.dados.get(1).cadeia).toEqual([10]);
  });

  test('mesma pessoa reaparece quando a passagem é OUTRA (A → B → A)', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [] }]);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 10);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 20);
    await empilharResponsavel(db, 'EVOLUCAO', [1], 10);
    expect(db.dados.get(1).cadeia).toEqual([10, 20, 10]);
  });

  test('cada registro arrastado empilha o SEU dono anterior', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [] }, { id: 2, cadeia: [] }]);
    await empilharDosMovidos(db, 'EVOLUCAO', [
      { entidadeId: 1, deVetId: 10 },
      { entidadeId: 2, deVetId: 99 },
      { entidadeId: 3, deVetId: null },   // órfão: nada a riscar
    ]);
    expect(db.dados.get(1).cadeia).toEqual([10]);
    expect(db.dados.get(2).cadeia).toEqual([99]);
  });

  test('coluna ainda não migrada NÃO derruba a operação clínica', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [] }], { semColuna: true });
    await expect(empilharResponsavel(db, 'EVOLUCAO', [1], 10)).resolves.toBeUndefined();
  });
});

describe('leitura da cadeia', () => {
  test('devolve os nomes na ordem em que responderam', async () => {
    const db = bancoFalso([
      { id: 1, cadeia: [10, 20, 30], nomes: { 10: 'Marco Araújo', 20: 'Marina', 30: 'Cláudio Araújo' } },
    ]);
    const mapa = await lerCadeia('EVOLUCAO', [1], db);
    expect(mapa.get(1).map(r => r.fullName)).toEqual(['Marco Araújo', 'Marina', 'Cláudio Araújo']);
  });

  test('anexa à lista e devolve [] para quem nunca trocou de mãos', async () => {
    const db = bancoFalso([
      { id: 1, cadeia: [10], nomes: { 10: 'Marco Araújo' } },
      { id: 2, cadeia: [] },
    ]);
    const lista = [{ id: 1 }, { id: 2 }];
    await anexarCadeiaEmLista('EVOLUCAO', lista, db);
    expect(lista[0].responsaveisAnteriores).toEqual([{ id: 10, fullName: 'Marco Araújo' }]);
    expect(lista[1].responsaveisAnteriores).toEqual([]);
  });

  test('profissional removido do sistema entra com nome nulo (a tela decide)', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [10], nomes: {} }]);
    const mapa = await lerCadeia('EVOLUCAO', [1], db);
    expect(mapa.get(1)).toEqual([{ id: 10, fullName: null }]);
  });

  test('coluna ainda não migrada devolve vazio, sem quebrar a listagem', async () => {
    const db = bancoFalso([{ id: 1, cadeia: [10] }], { semColuna: true });
    const lista = [{ id: 1 }];
    await anexarCadeiaEmLista('EVOLUCAO', lista, db);
    expect(lista[0].responsaveisAnteriores).toEqual([]);
  });
});

describe('gate estrutural', () => {
  const fs   = require('fs');
  const path = require('path');
  const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

  test('marcarAssumido empilha a cadeia — é o funil das quatro trocas do agendamento', () => {
    const src = ler('lib/agendamentoAssumido.js');
    const corpo = src.slice(src.indexOf('async function marcarAssumido'));
    expect(corpo).toMatch(/empilharResponsavel\([^)]*'AGENDAMENTO'/);
  });

  test('o arrasto empilha o dono anterior de cada evolução movida', () => {
    const src = ler('lib/transferenciaAtendimento.js');
    expect(src).toMatch(/empilharResponsavel\(tx, 'EVOLUCAO', \[e\.id\], e\.veterinarioId\)/);
  });

  test('assumir a evolução empilha quem a perdeu', () => {
    const src = ler('controllers/EvolucaoController.js');
    expect(src).toMatch(/empilharResponsavel\(tx, 'EVOLUCAO', \[existente\.id\], anteriorId\)/);
  });
});
