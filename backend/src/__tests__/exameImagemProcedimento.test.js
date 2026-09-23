'use strict';

/**
 * EXAME DE IMAGEM COMO PROCEDIMENTO — catálogo, preço e recibo (2026-09-09).
 *
 * 🔴 POR QUE ESTE GATE EXISTE: as três regras abaixo quebram em SILÊNCIO, e duas
 * delas no DINHEIRO — o defeito só aparece no fim do mês.
 *
 *   1. `null` NÃO É ZERO no preço. "Não sei quanto custa" e "é de graça" precisam
 *      continuar distintos: colapsar os dois faz o exame entrar na fatura por R$ 0,00
 *      afirmando que a clínica não cobra por ele, e ninguém confere uma linha zerada
 *      que "sempre foi assim".
 *
 *   2. O ELO da fatura. `lancarExameNaFatura` é o ÚNICO ponto em que o exame vira
 *      cobrança; se alguém devolver o `valor: 0` fixo, TUDO continua funcionando —
 *      pedido criado, fatura gerada, tela sem erro — e o faturamento some.
 *
 *   3. O ELO do recibo. A conclusão do exame é o que faz nascer a linha do prestador;
 *      removida a chamada, o cliente segue sendo cobrado e o prestador desaparece do
 *      recibo, sem nada acusar.
 *
 * A varredura de código no fim é o que impede 2 e 3 de passarem despercebidos.
 */

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const {
  CATEGORIAS_IMAGEM, CATEGORIA_POR_GRUPO, TIPO_IMAGEM, ESPECIALIDADE_IMAGEM,
} = require('../seeds/005_procedimentos_imagem.seed');
const { GRUPOS, ITENS } = require('../seeds/004_imagem_exames.seed');

const lerFonte = (rel) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** Descarta comentários: um gate que se satisfaz com a própria documentação da regra
 *  é um gate que se aprende a ignorar. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ─────────────────────────────────────────────────────────────────────────────
// 1. CATÁLOGO — todo grupo tem categoria, e toda categoria é oferecida na tela
// ─────────────────────────────────────────────────────────────────────────────
describe('catálogo de imagem → categorias', () => {
  it('todo grupo do catálogo tem categoria mapeada', () => {
    const semMapa = GRUPOS.filter(g => !CATEGORIA_POR_GRUPO[g.nome]).map(g => g.nome);
    // Grupo sem mapa é ignorado pelo seed: os exames dele simplesmente não existiriam
    // como procedimento, e a categoria some da tela sem erro nenhum.
    expect(semMapa).toEqual([]);
  });

  it('toda categoria usada no mapa é oferecida no seletor', () => {
    const usadas = new Set(Object.values(CATEGORIA_POR_GRUPO).map(m => m.categoria));
    for (const c of usadas) expect(CATEGORIAS_IMAGEM).toContain(c);
  });

  it('as categorias pedidas existem', () => {
    for (const c of ['Radiografia', 'Ultrassonografia', 'Endoscopia', 'Termografia', 'Laparoscopia']) {
      expect(CATEGORIAS_IMAGEM).toContain(c);
    }
  });

  it('todo exame tem código — é ele que torna o seed idempotente', () => {
    const semCodigo = [];
    for (const g of GRUPOS) for (const it of (ITENS[g.nome] ?? [])) {
      if (!it.codigo) semCodigo.push(it.nome);
    }
    expect(semCodigo).toEqual([]);
  });

  it('não há código repetido — `codigo` é @unique e o upsert sobrescreveria o irmão', () => {
    const vistos = new Set();
    const repetidos = [];
    for (const g of GRUPOS) for (const it of (ITENS[g.nome] ?? [])) {
      if (vistos.has(it.codigo)) repetidos.push(it.codigo);
      vistos.add(it.codigo);
    }
    expect(repetidos).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEED — projeta em tb_procedimentos_vet sem tocar no que é da empresa
// ─────────────────────────────────────────────────────────────────────────────
describe('seed 005', () => {
  const src = semComentarios(lerFonte('seeds/005_procedimentos_imagem.seed.js'));

  it('grava o exame como GLOBAL (empresa_id NULL)', () => {
    expect(src).toMatch(/empresa_id[\s\S]{0,200}NULL/);
  });

  it('a inativação dos genéricos NÃO alcança procedimento da empresa', () => {
    // Procedimento que a própria clínica cadastrou é DELA — inativá-lo daqui apagaria
    // da tela um item que ninguém pediu para remover.
    const update = src.slice(src.indexOf('UPDATE schs2vet.tb_procedimentos_vet'));
    expect(update).toMatch(/empresa_id IS NULL/);
  });

  it('inativa, nunca APAGA — o genérico pode estar em orçamento já fechado', () => {
    expect(src).toMatch(/SET ativo = false/);
    expect(src).not.toMatch(/DELETE\s+FROM\s+schs2vet\.tb_procedimentos_vet/i);
  });

  it('não inativa os próprios exames de imagem que acabou de inserir', () => {
    expect(src).toMatch(/"tipoProcedimento" IS DISTINCT FROM/);
  });

  it('usa NOW() AT TIME ZONE \'UTC\', nunca NOW() puro', () => {
    // NOW() puro em coluna `timestamp` grava a hora LOCAL como se fosse UTC e volta
    // 3h atrasada (armadilha registrada no CLAUDE.md §6).
    const nows = src.match(/NOW\(\)(?!\s+AT TIME ZONE)/g) ?? [];
    expect(nows).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PREÇO — "não sei" é null, nunca 0
// ─────────────────────────────────────────────────────────────────────────────
describe('preço do exame', () => {
  const src = semComentarios(lerFonte('lib/exameImagemValor.js'));

  it('precoDoPedido devolve null quando nada resolve', () => {
    // Se virasse 0, a fatura afirmaria que o pedido é gratuito.
    expect(src).toMatch(/let cliente = null/);
    expect(src).toMatch(/valorCliente: cent\(cliente\)/);
  });

  it('a soma só sai do null quando ALGUM exame tem preço', () => {
    expect(src).toMatch(/if \(p\.valorCliente\s*!= null\) cliente = \(cliente \?\? 0\) \+ p\.valorCliente/);
  });

  it('arredonda ao centavo — percentual fecha em 55.000000000000004', () => {
    expect(src).toMatch(/Math\.round\(v \* 100\) \/ 100/);
  });

  it('a cadeia é vínculo → padrão da empresa → catálogo', () => {
    expect(src).toMatch(/doVinculo\.valorCliente \?\? padrao \?\? num\(proc\.valorVenda\)/);
  });

  it('só enxerga catálogo global ou da PRÓPRIA empresa', () => {
    expect(src).toMatch(/empresa_id IS NULL OR empresa_id = \$3/);
  });

  it('gravar prestador/valor nunca derruba a criação do exame', () => {
    const trecho = src.slice(src.indexOf('async function gravarPrestadorEValor'));
    expect(trecho).toMatch(/catch \{ return false; \}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GATES ESTRUTURAIS — os elos que somem em silêncio
// ─────────────────────────────────────────────────────────────────────────────
describe('elos que não podem sumir', () => {
  it('lancarExameNaFatura cobra o valor do exame, não um 0 fixo', () => {
    const src = semComentarios(lerFonte('lib/faturaUtils.js'));
    const fn  = src.slice(src.indexOf('async function lancarExameNaFatura'));
    expect(fn).toMatch(/valor:\s*valorCobrado \?\? 0/);
    // `??` e não `||`: com `||` um valor legitimamente 0 seria substituído por 0 de
    // novo — inofensivo aqui, mas o padrão errado migra para onde não é.
    expect(fn).not.toMatch(/valor:\s*valorCobrado \|\|/);
  });

  it('lancarExameNaFatura busca o valor quando o chamador não o traz', () => {
    // Os quatro gatilhos (criação, finalização da evolução, conclusão do exame) têm de
    // cobrar o MESMO valor; sem esta busca, três deles lançariam zerado.
    const src = semComentarios(lerFonte('lib/faturaUtils.js'));
    const fn  = src.slice(src.indexOf('async function lancarExameNaFatura'));
    expect(fn).toMatch(/lerPrestadorEValor/);
  });

  it('a criação do exame resolve e grava o preço', () => {
    const src = semComentarios(lerFonte('controllers/ExameClinicoController.js'));
    expect(src).toMatch(/exameValor\.precoDoPedido\(/);
    expect(src).toMatch(/exameValor\.gravarPrestadorEValor\(/);
  });

  it('a conclusão do exame alimenta o recibo E a conta a pagar do prestador', () => {
    // 2026-09-22: `registrarReciboDoExame` virou `registrarPagamentoPrestadorDoExame`
    // e passou a escrever as DUAS metades. Só o ledger deixava o exame fora da tela
    // de Pagamentos — que é onde o financeiro descobre que a clínica deve algo.
    const src = semComentarios(lerFonte('controllers/ExameClinicoController.js'));
    const fn  = src.slice(src.indexOf('async function registrarPagamentoPrestadorDoExame'));
    expect(fn).toMatch(/vinculoPrestador\.registrarExecucao\(/);
    expect(fn).toMatch(/contasPagar\.lancarItem\(tx, \{/);
    expect(fn).toMatch(/origemTipo:\s*contasPagar\.ORIGENS\.EXAME_PRESTADOR/);
    // O ledger precisa dizer de QUAL exame veio — é o que sustenta a idempotência
    // (índice único parcial da migration 20261019000000).
    expect(fn).toMatch(/exameClinicoId:\s*exame\.id/);
    // Sem prestador não há dívida: exame da própria equipe não gera linha nenhuma.
    expect(fn).toMatch(/if \(!dados\?\.prestadorId\) return;/);
    // Recibo e conta apuram o MESMO número: dois cálculos dariam duas dívidas
    // diferentes para o mesmo serviço.
    expect(fn).toMatch(/vinculoPrestador\.calcularValorAPagar\(/);
  });

  it('a CONCLUSÃO de verdade (salvarResultado) registra o pagamento, não só finalizar', () => {
    // 🔴 `PATCH /clinica/exames/:id/finalizar` não é chamada por NENHUMA tela — quem
    // conclui o exame é `salvarResultado` (status REALIZADO). Enquanto o registro
    // vivia só em `finalizar`, o pagamento ao prestador era código morto.
    const src = semComentarios(lerFonte('controllers/ExameClinicoController.js'));
    const fn  = src.slice(src.indexOf('salvarResultado: async'), src.indexOf('finalizar: async'));
    // Os DOIS ramos (Imagem e Laboratorial/Bioquímico) têm de registrar.
    const chamadas = fn.match(/registrarPagamentoPrestadorDoExame\(tx, req, exame/g) ?? [];
    expect(chamadas.length).toBe(2);
    // E o prestador escolhido na tela tem de ser gravado antes.
    expect(fn).toMatch(/exameValor\.gravarPrestador\(tx, exame\.id, prestadorEscolhido\)/);
  });

  it('o cadastro de procedimentos não oferece mais "Diagnóstico por Imagem"', () => {
    const src = semComentarios(lerFonte('controllers/ProcedimentoCadastroController.js'));
    expect(src).toMatch(/nomes = nomes\.filter\(n => n !== ESPECIALIDADE_IMAGEM\)/);
    expect(src).toMatch(/imagemCategorias: CATEGORIAS_IMAGEM/);
  });

  it('o exame de imagem não é escondido pelo filtro de especialidades atendidas', () => {
    // A especialidade dele ('Diagnóstico por Imagem') pode não estar entre as da
    // empresa; sem esta isenção, os 119 exames sumiriam da tela sem explicação.
    const src = semComentarios(lerFonte('controllers/ProcedimentoCadastroController.js'));
    expect(src).toMatch(/if \(p\.tipoProcedimento !== TIPO_IMAGEM\)/);
  });

  it('a aba Imagem tem desvio para a base sem o seed 005', () => {
    const src = semComentarios(lerFonte('controllers/ImagemExameController.js'));
    expect(src).toMatch(/recursos: \{ porProcedimento \}/);
    // O catálogo antigo continua respondendo — sem ele a aba abriria vazia.
    expect(src).toMatch(/listarGrupos/);
    expect(src).toMatch(/listarItensPorGrupo/);
  });

  it('a marca da linha de imagem é a mesma no seed e nos leitores', () => {
    expect(TIPO_IMAGEM).toBe('IMAGEM');
    expect(ESPECIALIDADE_IMAGEM).toBe('Diagnóstico por Imagem');
  });
});
