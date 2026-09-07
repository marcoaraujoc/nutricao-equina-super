// backend/src/__tests__/concorrenciaEdicao.test.js
//
// CONTROLE DE CONCORRÊNCIA DE EDIÇÃO — evolução e agendamento.
//
// 🔴 O QUE ESTE ARQUIVO PROTEGE: a regra "quem salva por último vence" NÃO pode
// voltar. Ela volta em silêncio — basta alguém trocar o UPDATE condicional por um
// `update` comum "para simplificar", e nada quebra: os testes de fluxo continuam
// verdes, as telas continuam funcionando, e o único sintoma é um texto clínico
// que desaparece de vez em quando sem ninguém entender por quê.
//
// Cobre também o GATE ESTRUTURAL do fim do arquivo, que reprova o `assumir` novo
// que grave o editor sem passar pela cláusula condicional.
'use strict';

const fs   = require('fs');
const path = require('path');

// `lib/prisma` é TypeScript (transpilado pelo ts-node em produção). Nenhum teste
// daqui toca o banco: o que se verifica é o SQL montado e as decisões da lib.
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../lib/logger', () => ({ warn: () => {}, error: () => {}, info: () => {} }), { virtual: true });

const {
  ConflitoEdicaoError, reservarVersao, assumirComLock, gravarComVersao,
  versaoDoBody, responderConflito, anexarControle, definirAutor,
  invalidarVersoes, TABELAS,
} = require('../lib/concorrenciaRegistro');

const eventos = require('../lib/eventosTempoReal');

// ── Banco falso ─────────────────────────────────────────────────────────────
// Uma tabela em memória com a semântica que importa: `UPDATE ... WHERE versao = x`
// afeta 0 linhas quando a versão já mudou. É exatamente a garantia do Postgres que
// a regra usa; simular só o `findUnique` não testaria nada.
function bancoFalso(linhas) {
  const dados = new Map(linhas.map(l => [l.id, { ...l }]));
  const chamadas = [];

  function executar(sql, params) {
    chamadas.push({ sql, params });
    const id = Number(params[0]);
    const linha = dados.get(id);

    if (/^SELECT/i.test(sql.trim())) {
      if (!linha) return [];
      return [{ versao: linha.versao, editorId: linha.editor ?? null, autorId: linha.autor ?? null }];
    }

    // UPDATE — reproduz a cláusula WHERE que a lib montou.
    if (!linha) return [];
    const exigeVersao = /"versao" = \$2/.test(sql);
    if (exigeVersao && linha.versao !== Number(params[1])) return [];   // perdeu a corrida

    const exigeEditor = /IS NOT DISTINCT FROM \$(\d+)/.exec(sql);
    if (exigeEditor) {
      const esperado = params[Number(exigeEditor[1]) - 1];
      const atual = linha.editor ?? null;
      if ((esperado ?? null) !== atual) return [];                      // outro já assumiu
    }

    if (/"veterinarioId" = \$3|"veterinario_id" = \$3/.test(sql)) linha.editor = Number(params[2]);
    const setTexto = /"texto" = \$(\d+)/.exec(sql);
    if (setTexto) linha.texto = params[Number(setTexto[1]) - 1];
    const setAutor = /"autor_id" = \$2/.test(sql);
    if (setAutor) { if (linha.autor == null) linha.autor = Number(params[1]); return 1; }

    if (/"versao" = "versao" \+ 1/.test(sql)) linha.versao += 1;
    return [{ versao: linha.versao }];
  }

  return {
    dados,
    chamadas,
    $queryRawUnsafe:   async (sql, ...params) => executar(sql, params),
    $executeRawUnsafe: async (sql, ...params) => { const r = executar(sql, params); return Array.isArray(r) ? r.length : r; },
    user: { findUnique: async ({ where }) => ({ id: where.id, fullName: `Dr. ${where.id}` }) },
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe('TRAVA OTIMISTA — a segunda gravação sobre dado velho é RECUSADA', () => {

  test('TESTE 11 — dois profissionais salvam ao mesmo tempo: só a versão válida persiste', async () => {
    const db = bancoFalso([{ id: 1, versao: 5, editor: 10, texto: 'original' }]);

    // A e B leram a MESMA versão (5) e escrevem cada um o seu texto.
    const vA = await gravarComVersao(db, 'EVOLUCAO', 1, 5, { '"texto"': 'texto do A' });
    expect(vA).toBe(6);
    expect(db.dados.get(1).texto).toBe('texto do A');

    // B chega depois, ainda com a versão 5 na mão.
    const vB = await gravarComVersao(db, 'EVOLUCAO', 1, 5, { '"texto"': 'texto do B' });
    expect(vB).toBeNull();                        // recusado
    expect(db.dados.get(1).texto).toBe('texto do A');  // 🔴 o texto de A NÃO foi sobrescrito
    expect(db.dados.get(1).versao).toBe(6);       // e a versão não avançou por engano
  });

  test('TESTE 7 — salvar com versão antiga responde VERSAO_CONFLITO (409)', async () => {
    const db = bancoFalso([{ id: 1, versao: 13, editor: 10 }]);
    await expect(reservarVersao(db, 'EVOLUCAO', 1, 12))
      .rejects.toMatchObject({ code: 'VERSAO_CONFLITO', status: 409 });
  });

  test('o conflito diz a versão vigente e a que o cliente mandou', async () => {
    const db = bancoFalso([{ id: 1, versao: 13, editor: 42 }]);
    const err = await reservarVersao(db, 'EVOLUCAO', 1, 12).catch(e => e);
    expect(err).toBeInstanceOf(ConflitoEdicaoError);
    expect(err.versaoAtual).toBe(13);
    expect(err.versaoCliente).toBe(12);
    expect(err.editorId).toBe(42);       // quem detém o registro agora
    // A mensagem é para PESSOA: nunca "optimistic locking failed".
    expect(err.message).toMatch(/modificada por outro profissional/i);
    expect(err.message).not.toMatch(/lock|version|conflict/i);
  });

  test('versão CERTA passa e incrementa', async () => {
    const db = bancoFalso([{ id: 1, versao: 7, editor: 10 }]);
    await expect(reservarVersao(db, 'EVOLUCAO', 1, 7)).resolves.toBe(8);
  });

  test('cliente que NÃO declara versão não é bloqueado — mas incrementa, para quem declara ver', async () => {
    // Compatibilidade: endurecer isto quebraria toda chamada existente de uma vez.
    const db = bancoFalso([{ id: 1, versao: 3, editor: 10 }]);
    await expect(reservarVersao(db, 'EVOLUCAO', 1, null)).resolves.toBeNull();
    expect(db.dados.get(1).versao).toBe(4);
    // ...e quem tinha a versão 3 na tela agora recebe o conflito.
    await expect(reservarVersao(db, 'EVOLUCAO', 1, 3)).rejects.toMatchObject({ code: 'VERSAO_CONFLITO' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('ASSUNÇÃO ATÔMICA — dois não podem assumir o mesmo registro', () => {

  test('TESTE 6 — B e C assumem quase ao mesmo tempo: um vence, o outro leva 409', async () => {
    const db = bancoFalso([{ id: 1, versao: 4, editor: 10 }]);   // editor atual = A (10)

    // Os dois LERAM o mesmo estado antes de agir — é a corrida real.
    const estadoLido = { deEditorId: 10, versaoEsperada: 4 };

    const b = await assumirComLock(db, 'EVOLUCAO', 1, { ...estadoLido, paraEditorId: 20 });
    const c = await assumirComLock(db, 'EVOLUCAO', 1, { ...estadoLido, paraEditorId: 30 });

    // 🔴 EXATAMENTE UM sucesso. Nunca os dois.
    expect([b, c].filter(Boolean)).toHaveLength(1);
    expect(b).not.toBeNull();
    expect(c).toBeNull();
    expect(db.dados.get(1).editor).toBe(20);   // ficou com B, não com o último a chamar
  });

  test('assumir registro SEM responsável funciona (editor anterior nulo)', async () => {
    // `NULL = NULL` é NULL no Postgres: com `=` em vez de `IS NOT DISTINCT FROM`,
    // assumir um agendamento "Não atribuído" falharia sempre.
    const db = bancoFalso([{ id: 1, versao: 1, editor: null }]);
    const r = await assumirComLock(db, 'AGENDAMENTO', 1, {
      deEditorId: null, versaoEsperada: 1, paraEditorId: 20,
    });
    expect(r).toMatchObject({ versao: 2 });
    expect(db.dados.get(1).editor).toBe(20);
  });

  test('assumir com versão desatualizada (alguém editou no meio) também é recusado', async () => {
    const db = bancoFalso([{ id: 1, versao: 9, editor: 10 }]);
    const r = await assumirComLock(db, 'EVOLUCAO', 1, {
      deEditorId: 10, versaoEsperada: 8, paraEditorId: 20,
    });
    expect(r).toBeNull();
    expect(db.dados.get(1).editor).toBe(10);
  });

  test('a coluna do editor difere por tabela — evolução em camelCase, agenda em snake_case', async () => {
    // Armadilha 41: escrever o nome errado devolve `column does not exist` em runtime,
    // e o erro só aparece com o banco na frente. O SQL montado é conferido aqui.
    const db = bancoFalso([{ id: 1, versao: 1, editor: 10 }]);
    await assumirComLock(db, 'EVOLUCAO', 1, { deEditorId: 10, versaoEsperada: 1, paraEditorId: 2 });
    expect(db.chamadas.at(-1).sql).toContain('"veterinarioId"');

    const db2 = bancoFalso([{ id: 1, versao: 1, editor: 10 }]);
    await assumirComLock(db2, 'AGENDAMENTO', 1, { deEditorId: 10, versaoEsperada: 1, paraEditorId: 2 });
    expect(db2.chamadas.at(-1).sql).toContain('"veterinario_id"');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('AUTORIA — quem criou não é apagado por quem assume', () => {

  test('assumir troca o EDITOR e preserva o AUTOR', async () => {
    const db = bancoFalso([{ id: 1, versao: 1, editor: 10, autor: 10 }]);
    await assumirComLock(db, 'EVOLUCAO', 1, { deEditorId: 10, versaoEsperada: 1, paraEditorId: 20 });
    expect(db.dados.get(1).editor).toBe(20);   // quem conduz agora
    expect(db.dados.get(1).autor).toBe(10);    // 🔴 quem criou, intacto
  });

  test('definirAutor só grava quando ainda está vazio — nunca reescreve a autoria', async () => {
    const db = bancoFalso([{ id: 1, versao: 1, editor: 10, autor: null }]);
    await definirAutor(db, 'EVOLUCAO', 1, 10);
    expect(db.dados.get(1).autor).toBe(10);
    await definirAutor(db, 'EVOLUCAO', 1, 99);   // tentativa de sobrescrever
    expect(db.dados.get(1).autor).toBe(10);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('LEITURA — a versão viaja com o registro', () => {

  test('anexarControle preenche versao/autorId na lista', async () => {
    const db = bancoFalso([
      { id: 1, versao: 4, editor: 10, autor: 7 },
      { id: 2, versao: 1, editor: 11, autor: 11 },
    ]);
    // `ANY($1::int[])` recebe o array inteiro no primeiro parâmetro.
    db.$queryRawUnsafe = async (_sql, ids) =>
      ids.map(id => ({ id, versao: db.dados.get(id).versao, autorId: db.dados.get(id).autor }));

    const lista = [{ id: 1 }, { id: 2 }];
    await anexarControle(db, 'EVOLUCAO', lista);
    expect(lista[0]).toMatchObject({ versao: 4, autorId: 7 });
    expect(lista[1]).toMatchObject({ versao: 1, autorId: 11 });
  });

  test('coluna ainda não migrada NÃO derruba a listagem — cai em versao 1', async () => {
    const db = bancoFalso([{ id: 1, versao: 1 }]);
    db.$queryRawUnsafe = async () => { throw new Error('column "versao" does not exist'); };
    const lista = [{ id: 1 }];
    await expect(anexarControle(db, 'EVOLUCAO', lista)).resolves.toBeDefined();
    expect(lista[0].versao).toBe(1);
  });

  test('versaoDoBody ignora lixo — valor inválido é "sem proteção", nunca conflito', () => {
    expect(versaoDoBody({ versao: 12 })).toBe(12);
    expect(versaoDoBody({ _versao: '7' })).toBe(7);
    expect(versaoDoBody({})).toBeNull();
    expect(versaoDoBody({ versao: 'abc' })).toBeNull();
    expect(versaoDoBody({ versao: 0 })).toBeNull();
    expect(versaoDoBody({ versao: -3 })).toBeNull();
    expect(versaoDoBody(null)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('RESPOSTA HTTP — 409 legível, nunca jargão', () => {

  test('responderConflito devolve 409 com code, editor e as duas versões', () => {
    let status = null, corpo = null;
    const res = { status: (s) => { status = s; return res; }, json: (c) => { corpo = c; return res; } };
    const err = new ConflitoEdicaoError('REGISTRO_ASSUMIDO', 'Esta evolução foi assumida por Dr. Carlos.', {
      versaoAtual: 14, versaoCliente: 12, editor: { id: 9, nome: 'Dr. Carlos' },
    });
    responderConflito(res, err, { assumidaEm: '2026-09-05T19:42:00Z' });

    expect(status).toBe(409);
    expect(corpo.code).toBe('REGISTRO_ASSUMIDO');
    expect(corpo.editor).toEqual({ id: 9, nome: 'Dr. Carlos' });
    expect(corpo.versaoAtual).toBe(14);
    expect(corpo.assumidaEm).toBe('2026-09-05T19:42:00Z');
    // `error` E `mensagem`: os controllers do projeto divergem no nome do campo.
    expect(corpo.error).toBe(corpo.mensagem);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('TEMPO REAL — avisa, mas não é a fonte da verdade', () => {
  afterEach(() => eventos.encerrarTudo());

  function telaFalsa() {
    const escrito = [];
    return { escrito, write: (t) => escrito.push(t), end: () => {}, set: () => {}, flushHeaders: () => {} };
  }

  test('TESTE 4 — quem perdeu o registro recebe o evento; quem assumiu, não', () => {
    const a = telaFalsa(); const b = telaFalsa();
    eventos.abrirCanal(10, a);
    eventos.abrirCanal(20, b);

    eventos.publicar([10], {
      tipo: eventos.EVENTOS.EVOLUCAO_ASSUMIDA, evolucaoId: 1,
      porUsuario: { id: 20, nome: 'Dr. Carlos' },
    });

    expect(a.escrito.join('')).toContain('EVOLUCAO_ASSUMIDA');
    expect(a.escrito.join('')).toContain('Dr. Carlos');
    expect(b.escrito.join('')).toHaveLength(0);   // não avisa quem assumiu
  });

  test('as DUAS abas da mesma pessoa recebem', () => {
    const t1 = telaFalsa(); const t2 = telaFalsa();
    eventos.abrirCanal(10, t1);
    eventos.abrirCanal(10, t2);
    eventos.publicar([10], { tipo: 'X' });
    expect(t1.escrito).toHaveLength(1);
    expect(t2.escrito).toHaveLength(1);
  });

  test('TESTE 12 — publicar para quem NÃO está conectado não lança nada', () => {
    // É o cenário do médico A com o WebSocket/SSE caído: o evento se perde e a
    // operação de B, que já foi gravada, não pode ser afetada por isso.
    expect(() => eventos.publicar([999], { tipo: 'X' })).not.toThrow();
  });

  test('conexão morta é descartada e não derruba a publicação para as demais', () => {
    const viva = telaFalsa();
    const morta = { write: () => { throw new Error('EPIPE'); }, end: () => {} };
    eventos.abrirCanal(10, morta);
    eventos.abrirCanal(10, viva);
    expect(() => eventos.publicar([10], { tipo: 'X' })).not.toThrow();
    expect(viva.escrito).toHaveLength(1);
    expect(eventos.estatisticas().conexoes).toBe(1);   // a morta saiu do registro
  });

  test('encerrarTudo LIMPA o heartbeat, não só o socket', () => {
    // 🔴 REGRESSÃO REAL (achada pelo jest como 'open handle'): a primeira versão
    // de `encerrarTudo` chamava `res.end()` direto e deixava o `setInterval` do
    // heartbeat vivo — ele seguia tentando escrever numa resposta morta a cada
    // 25s, para sempre. Em produção é um timer vazado por conexão encerrada fora
    // do caminho do 'close'; no processo, é o que impede o encerramento limpo.
    jest.useFakeTimers();
    try {
      const t = telaFalsa();
      eventos.abrirCanal(10, t);
      eventos.encerrarTudo();
      const antes = t.escrito.length;
      jest.advanceTimersByTime(eventos.HEARTBEAT_MS * 3);
      expect(t.escrito.length).toBe(antes);         // nenhum ping depois de encerrado
      expect(jest.getTimerCount()).toBe(0);         // e nenhum timer pendurado
    } finally { jest.useRealTimers(); }
  });

  test('fechar o canal remove a conexão do registro', () => {
    const t = telaFalsa();
    const fechar = eventos.abrirCanal(10, t);
    expect(eventos.estatisticas()).toMatchObject({ usuarios: 1, conexoes: 1 });
    fechar();
    expect(eventos.estatisticas()).toMatchObject({ usuarios: 0, conexoes: 0 });
  });

  test('TESTE 5/12 — evento perdido NÃO compromete a integridade: o banco recusa igual', async () => {
    // 19:30 A abre (versão 5) · 19:35 B assume e grava · 19:36 SSE de A cai ·
    // 19:40 A tenta salvar com a versão que tinha na tela.
    const db = bancoFalso([{ id: 1, versao: 5, editor: 10, texto: 'de A' }]);
    await assumirComLock(db, 'EVOLUCAO', 1, { deEditorId: 10, versaoEsperada: 5, paraEditorId: 20 });
    await gravarComVersao(db, 'EVOLUCAO', 1, 6, { '"texto"': 'de B' });

    // Nenhum evento foi publicado — A não sabe de nada. Mesmo assim:
    await expect(reservarVersao(db, 'EVOLUCAO', 1, 5))
      .rejects.toMatchObject({ code: 'VERSAO_CONFLITO' });
    expect(db.dados.get(1).texto).toBe('de B');   // o texto de B sobreviveu
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('ARRASTO — quem assume trava o profissional anterior AUTOMATICAMENTE', () => {

  test('🔴 invalidar a versão barra até o GESTOR anterior (a autoria não barrava)', async () => {
    // Este é o ponto da regra. A autoria sozinha NÃO resolve: `podeOperarRegistro`
    // tem bypass de GESTOR, então um gestor que perdeu o atendimento continuava
    // podendo gravar por cima do novo responsável. A versão não tem bypass nenhum.
    const db = bancoFalso([{ id: 1, versao: 3, editor: 10 }]);   // prescrição de A

    // B assume a evolução → o arrasto move a prescrição E invalida a versão.
    db.dados.get(1).editor = 20;
    await invalidarVersoes(db, 'PRESCRICAO_GRUPO', [1]);

    // A (gestor, tela aberta desde antes) tenta salvar com a versão 3.
    await expect(reservarVersao(db, 'PRESCRICAO_GRUPO', 1, 3))
      .rejects.toMatchObject({ code: 'VERSAO_CONFLITO' });
    // E B, que recarregou depois do arrasto, grava normalmente.
    await expect(reservarVersao(db, 'PRESCRICAO_GRUPO', 1, 4)).resolves.toBe(5);
  });

  test('invalida vários registros de uma vez (o arrasto é em lote)', async () => {
    const db = bancoFalso([
      { id: 1, versao: 1, editor: 10 },
      { id: 2, versao: 7, editor: 10 },
    ]);
    db.$executeRawUnsafe = async (sql, ids) => {
      expect(sql).toContain('ANY($1::int[])');
      for (const id of ids) db.dados.get(id).versao += 1;
      return ids.length;
    };
    await invalidarVersoes(db, 'EXAME_CLINICO', [1, 2]);
    expect(db.dados.get(1).versao).toBe(2);
    expect(db.dados.get(2).versao).toBe(8);
  });

  test('lista vazia não emite SQL — arrasto sem filhos não toca no banco', async () => {
    let chamou = false;
    const db = { $executeRawUnsafe: async () => { chamou = true; } };
    await invalidarVersoes(db, 'EXAME_CLINICO', []);
    await invalidarVersoes(db, 'EXAME_CLINICO', null);
    expect(chamou).toBe(false);
  });

  test('prescrição e exame estão declarados, com a coluna de editor CERTA', () => {
    // Armadilha 41: `veterinarioId` NÃO tem @map nestas duas tabelas (camelCase),
    // ao contrário do agendamento (`veterinario_id`). Errar aqui só aparece em
    // runtime, com o banco na frente.
    expect(TABELAS.PRESCRICAO_GRUPO.tabela).toBe('schs2vet.tb_prescricao_grupos');
    expect(TABELAS.PRESCRICAO_GRUPO.colEditor).toBe('"veterinarioId"');
    expect(TABELAS.EXAME_CLINICO.tabela).toBe('schs2vet.tb_exames_clinicos');
    expect(TABELAS.EXAME_CLINICO.colEditor).toBe('"veterinarioId"');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GATE ESTRUTURAL — o modo de quebrar esta regra é trocar o UPDATE condicional
// por um `update` comum. Isso não falha teste de fluxo nenhum e não aparece na
// tela: o sintoma é dado clínico que some de vez em quando.
describe('GATE — os caminhos de assunção passam pelo lock condicional', () => {
  const CONTROLLERS = path.join(__dirname, '..', 'controllers');

  const ALVOS = [
    ['EvolucaoController.js',    'assumir'],
    ['AgendamentoController.js', 'assumir'],
  ];

  test.each(ALVOS)('%s#%s usa assumirComLock', (arquivo, handler) => {
    const fonte = fs.readFileSync(path.join(CONTROLLERS, arquivo), 'utf8');
    const i = fonte.search(new RegExp(`^\\s{2}${handler}:\\s*async`, 'm'));
    expect(i).toBeGreaterThan(-1);
    // Recorte generoso: o handler inteiro cabe folgado em 8k caracteres.
    const corpo = fonte.slice(i, i + 8000);
    expect(corpo).toContain('assumirComLock');
    // E o conflito precisa virar 409 — sem isto ele sai como 500 "Erro interno",
    // e a pessoa não fica sabendo que perdeu a corrida.
    expect(corpo).toMatch(/ConflitoEdicaoError/);
  });

  test.each([
    ['EvolucaoController.js',    'atualizar'],
    ['AgendamentoController.js', 'atualizar'],
  ])('%s#%s reserva a versão antes de gravar', (arquivo, handler) => {
    const fonte = fs.readFileSync(path.join(CONTROLLERS, arquivo), 'utf8');
    const i = fonte.search(new RegExp(`^\\s{2}${handler}:\\s*async`, 'm'));
    expect(i).toBeGreaterThan(-1);
    const corpo = fonte.slice(i, i + 12000);
    expect(corpo).toContain('reservarVersao');
    expect(corpo).toContain('versaoDoBody');
  });

  test.each([
    ['PrescricaoGrupoController.js', 'atualizarItem'],
    ['PrescricaoGrupoController.js', 'adicionarItem'],
    ['PrescricaoGrupoController.js', 'removerItem'],
    ['ExameClinicoController.js',    'atualizar'],
    ['ExameClinicoController.js',    'salvarResultado'],
  ])('%s#%s reserva a versão antes de gravar', (arquivo, handler) => {
    const fonte = fs.readFileSync(path.join(CONTROLLERS, arquivo), 'utf8');
    // Busca LITERAL, sem regex: escapar barra-s em template literal produz
    // falso negativo silencioso — o gate passaria sem testar nada.
    const i = Math.max(
      fonte.indexOf(`const ${handler} = async`),
      fonte.indexOf(`  ${handler}: async`),
    );
    expect(i).toBeGreaterThan(-1);
    const corpo = fonte.slice(i, i + 14000);
    expect(corpo).toContain('reservarVersao');
    expect(corpo).toContain('ConflitoEdicaoError');
  });

  test('🔴 o ARRASTO invalida a versão dos filhos — sem isso o gestor anterior sobrescreve', () => {
    // A regra depende disto e nada mais na tela acusa se sumir: o atendimento
    // muda de mãos, a autoria barra o não-gestor, e o GESTOR anterior segue
    // gravando por cima do novo responsável em silêncio.
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'transferenciaAtendimento.js'), 'utf8');
    expect(fonte).toContain('invalidarVersoes');
    // Dentro do laço dos filhos, não só no arrasto do agendamento.
    const i = fonte.indexOf('async function transferirFilhosDasEvolucoes');
    expect(fonte.slice(i, fonte.indexOf('async function transferirEvolucoesDoAgendamento')))
      .toContain('invalidarVersoes');
  });

  test('🔴 editar item de prescrição RECALCULA a reserva de estoque', () => {
    // Grupo FINALIZADO reservou pela quantidade ANTIGA. Sem o recálculo, dobrar a
    // duração mantinha a reserva velha e trocar o medicamento deixava a reserva do
    // anterior ÓRFÃ, segurando estoque que ninguém mais consome.
    const fonte = fs.readFileSync(path.join(CONTROLLERS, 'PrescricaoGrupoController.js'), 'utf8');
    const i = fonte.search(/^const atualizarItem = async/m);
    expect(i).toBeGreaterThan(-1);
    // ⚠️ Aponta para o grupo de ORIGEM (`item.grupo`), não só "a função aparece":
    // o handler também recalcula o grupo de DESTINO quando o item é roteado, e um
    // gate frouxo passaria com a chamada da origem removida. Foi o que aconteceu na
    // primeira versão deste teste — verificado por sabotagem.
    expect(fonte.slice(i, i + 14000)).toContain('recalcularReservasDoGrupo(tx, item.grupo)');
    // E o helper tem de sair cedo em rascunho (SALVO não tem reserva a refazer).
    const h = fonte.indexOf('async function recalcularReservasDoGrupo');
    expect(h).toBeGreaterThan(-1);
    expect(fonte.slice(h, h + 900)).toMatch(/status === 'SALVO'/);
  });

  test('o evento é publicado FORA da transaction (nunca dentro)', () => {
    // Publicar dentro do `$transaction` faz um rollback avisar a tela de algo que
    // não aconteceu — e uma falha de entrega reverteria a operação clínica.
    for (const [arquivo] of ALVOS) {
      const fonte = fs.readFileSync(path.join(CONTROLLERS, arquivo), 'utf8');
      const re = /\$transaction\(async \(tx\) => \{([\s\S]*?)\n {6}\}\);/g;
      let m;
      while ((m = re.exec(fonte)) !== null) {
        expect(m[1]).not.toContain('publicar(');
      }
    }
  });
});
