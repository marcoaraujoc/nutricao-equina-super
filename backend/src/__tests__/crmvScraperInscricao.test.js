// JOB DE CARGA DO CRMV — "só está carregando os valores que têm 5 dígitos e precisa
// trazer todos" (2026-09-18).
//
// O QUE QUEBRAVA EM SILÊNCIO, e é por isso que este arquivo existe:
//   1. a inscrição ia CRUA na URL de consulta. A busca do SISCAD é "Idêntico" e compara
//      contra o número gravado com 5 DÍGITOS, então "1000" não casa com "01000" — de 1
//      a 9999 a resposta era sempre "Sua pesquisa não retornou nenhum resultado".
//      MEDIDO no banco antes da correção: 11.750 registros, TODOS de 5 dígitos, o menor
//      10000 e o maior 23768 — ZERO abaixo de 10000, numa varredura que percorre 1..25000.
//      E ao vivo, COM o padding: 00001 → ALUISIO PEREIRA DE FIGUEIREDO, 01000 → DIANA
//      ASSIS DE OLIVEIRA, 07500 → DANYELLE MARCHIORI MOREIRA, 09999 → FLAVIA BORGES
//      TAVARES, todos ATIVOS e todos fora do índice;
//   2. o SISCAD passou a exigir o token de sessão `consulta_challenge`. Sem ele TODA
//      chamada responde "Sessão de consulta inválida" — o job não trazia nada, e o
//      único freio era a guarda de "voltou vazio" do diff.
//
// Nenhum dos dois derruba a execução: o job termina "com sucesso" e sem trabalho. Por
// isso os casos abaixo EXECUTAM o código real com um `page` falso e conferem a URL que
// sai — varredura de texto aprovaria um `padStart` que existe e não é usado.
'use strict';

// `puppeteer` é ESM e o babel-jest não o transpila; e ele não é exercitado aqui — quem
// abre o browser é `executarScraping`, e os casos abaixo usam um `page` falso.
jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../lib/prisma', () => ({ default: { crmvValido: {}, $transaction: jest.fn() } }), { virtual: true });
jest.mock('../lib/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { __internos } = require('../services/crmvScraperService');
const { consultarInscricao, buscarPorNumero, extrairRegistroAtivo, varrerUF, diffECommitUF, MAX_POR_UF } = __internos;

// UF de teste com teto minúsculo: a real (RJ) tem 25 mil números e 400ms de espera
// entre chamadas — varrê-la aqui levaria horas. O teto por UF já é a configuração do
// serviço, então dar um estado curto ao teste não distorce o que está sendo exercitado.
MAX_POR_UF.XX = 3;

const RESP_SEM_RESULTADO = {
  type: 'error', data: [],
  message: 'Sua pesquisa não retornou nenhum resultado. Deseja pesquisar novamente?',
};
const RESP_SESSAO_INVALIDA = {
  type: 'error', data: [],
  message: 'Sessão de consulta inválida. Recarregue a página e tente novamente.',
  challengeToken: 'token-novo',
};
const respAtivo = (inscricao, nome = 'FULANO DE TAL') => ({
  type: 'sucess', // sic — a API devolve "sucess"
  data: [{ pf_inscricao: inscricao, nome_preferencial: nome, atuante: true, pf_classe: 'VP', dt_inscricao: '2010-05-01' }],
});

/**
 * `page` falso: registra as URLs consultadas e devolve o que o caso pedir.
 * `page.evaluate` é usado para DUAS coisas no serviço — pegar o token do reCAPTCHA e
 * fazer o fetch —, e é a presença da URL no 2º argumento que distingue as duas.
 */
function fakePage(respostas) {
  const urls = [];
  const fila = Array.isArray(respostas) ? [...respostas] : null;
  return {
    urls,
    goto: jest.fn(async () => {}),
    waitForFunction: jest.fn(async () => {}),
    evaluate: jest.fn(async (fn, arg) => {
      if (typeof arg === 'string' && arg.startsWith('/pf/consultaInscricao')) {
        urls.push(arg);
        const r = fila ? fila.shift() : respostas;
        return r ?? RESP_SEM_RESULTADO;
      }
      return 'recaptcha-token'; // obterToken / seleção de PF / leitura do challenge
    }),
  };
}

const paramsDe = (url) => new URLSearchParams(url.split('?')[1] ?? '');
const inscricaoDe = (url) => url.split('?')[0].split('/')[3];

describe('URL de consulta — inscrição com 5 dígitos', () => {
  test.each([
    [1,     '00001'],
    [100,   '00100'],
    [1000,  '01000'],
    [9999,  '09999'],
    [10000, '10000'],
    [23768, '23768'],
  ])('número %i vai como "%s"', async (numero, esperado) => {
    const page = fakePage(RESP_SEM_RESULTADO);
    await consultarInscricao({ page, challenge: 'c1' }, numero, 'RJ');
    expect(inscricaoDe(page.urls[0])).toBe(esperado);
  });

  test('🔴 número de 4 dígitos NUNCA sai cru — era o defeito relatado', async () => {
    const page = fakePage(RESP_SEM_RESULTADO);
    await consultarInscricao({ page, challenge: 'c1' }, 9999, 'RJ');
    expect(inscricaoDe(page.urls[0])).not.toBe('9999');
  });

  test('a UF e os filtros de busca EXATA por inscrição continuam na URL', async () => {
    const page = fakePage(RESP_SEM_RESULTADO);
    await consultarInscricao({ page, challenge: 'c1' }, 7500, 'RJ');
    // /pf/consultaInscricao/<numero>/<tp_texto=1 Idêntico>/<procurar=2 Inscrição>/<uf>/<token>
    const partes = page.urls[0].split('?')[0].split('/');
    expect(partes.slice(2, 7)).toEqual(['consultaInscricao', '07500', '1', '2', 'RJ']);
  });
});

describe('Sessão de consulta (challenge + honeypot)', () => {
  test('o challenge vai na query e o honeypot vai VAZIO', async () => {
    const page = fakePage(RESP_SEM_RESULTADO);
    await consultarInscricao({ page, challenge: 'challenge-abc' }, 1, 'RJ');
    const p = paramsDe(page.urls[0]);
    expect(p.get('consulta_challenge')).toBe('challenge-abc');
    expect(p.get('website_url')).toBe('');
  });

  test('o token devolvido pela resposta é usado na chamada SEGUINTE', async () => {
    const page = fakePage([
      { ...respAtivo('00001'), challengeToken: 'segundo-token' },
      RESP_SEM_RESULTADO,
    ]);
    const sessao = { page, challenge: 'primeiro-token' };
    await consultarInscricao(sessao, 1, 'RJ');
    await consultarInscricao(sessao, 2, 'RJ');
    expect(paramsDe(page.urls[0]).get('consulta_challenge')).toBe('primeiro-token');
    expect(paramsDe(page.urls[1]).get('consulta_challenge')).toBe('segundo-token');
  });

  test('sessão inválida: reabre a página e tenta de novo (e o número NÃO se perde)', async () => {
    const page = fakePage([RESP_SESSAO_INVALIDA, respAtivo('01000', 'DIANA')]);
    const { resp, falhou } = await buscarPorNumero({ page, challenge: 'velho' }, 1000, 'RJ');
    expect(page.goto).toHaveBeenCalled();          // reabriu para renovar o challenge
    expect(falhou).toBe(false);
    expect(extrairRegistroAtivo(resp, 1000, 'RJ').nome).toBe('DIANA');
  });

  test('sessão inválida PERSISTENTE é FALHA, não "número inexistente"', async () => {
    const page = fakePage([RESP_SESSAO_INVALIDA, RESP_SESSAO_INVALIDA]);
    const { falhou } = await buscarPorNumero({ page, challenge: 'velho' }, 1000, 'RJ');
    expect(falhou).toBe(true);
  });

  test('"não retornou nenhum resultado" NÃO é falha — é resposta legítima', async () => {
    const page = fakePage(RESP_SEM_RESULTADO);
    const { falhou, resp } = await buscarPorNumero({ page, challenge: 'c' }, 100, 'RJ');
    expect(falhou).toBe(false);
    expect(extrairRegistroAtivo(resp, 100, 'RJ')).toBeNull();
  });
});

describe('extrairRegistroAtivo', () => {
  test('só entra no índice quem está ATUANTE', () => {
    const inativo = { type: 'sucess', data: [{ pf_inscricao: '00001', nome_preferencial: 'X', atuante: false }] };
    expect(extrairRegistroAtivo(inativo, 1, 'RJ')).toBeNull();
  });

  test('inscrição divergente da pedida é DESCARTADA', () => {
    // Sem esta guarda, gravaríamos o NOME de um veterinário sob o NÚMERO de outro —
    // e o índice passaria a validar CRMV errado.
    expect(extrairRegistroAtivo(respAtivo('09999'), 1000, 'RJ')).toBeNull();
  });

  test('inscrição com zeros à esquerda casa com o número pedido', () => {
    const r = extrairRegistroAtivo(respAtivo('00001', 'ALUISIO'), 1, 'RJ');
    expect(r).toMatchObject({ numero: 1, uf: 'RJ', nome: 'ALUISIO', classe: 'VP' });
  });
});

describe('Varredura com falha não destrói o índice', () => {
  test('falha em qualquer consulta marca a varredura como NÃO confiável', async () => {
    const page = fakePage([
      respAtivo('00001'),
      RESP_SESSAO_INVALIDA, RESP_SESSAO_INVALIDA, // 2ª consulta falha nas duas tentativas
      respAtivo('00003'),
    ]);
    const { ativos, confiavel, falhas } = await varrerUF({ page, challenge: 'c' }, 'XX');
    expect(falhas).toBe(1);
    expect(confiavel).toBe(false);
    expect(ativos.map(a => a.numero)).toEqual([1, 3]); // o que respondeu continua entrando
  });

  test('🔴 varredura NÃO confiável não remove nada do índice', async () => {
    const prisma = require('../lib/prisma').default;
    prisma.crmvValido.findMany = jest.fn(async () => ([
      { numero: 1, uf: 'RJ', nome: 'A', classe: 'VP' },
      { numero: 2, uf: 'RJ', nome: 'B', classe: 'VP' },
    ]));
    prisma.$transaction = jest.fn(async () => {});
    // O 2 sumiu do resultado fresco — mas a varredura falhou, então "sumiu" pode ser
    // "não consegui perguntar". Removê-lo apagaria um veterinário ativo do índice.
    const { removidos } = await diffECommitUF('RJ', [{ numero: 1, uf: 'RJ', nome: 'A', classe: 'VP', dataInscricao: null }], false);
    expect(removidos).toEqual([]);
  });

  test('varredura confiável remove quem deixou de aparecer', async () => {
    const prisma = require('../lib/prisma').default;
    prisma.crmvValido.findMany = jest.fn(async () => ([
      { numero: 1, uf: 'RJ', nome: 'A', classe: 'VP' },
      { numero: 2, uf: 'RJ', nome: 'B', classe: 'VP' },
    ]));
    prisma.$transaction = jest.fn(async () => {});
    const { removidos } = await diffECommitUF('RJ', [{ numero: 1, uf: 'RJ', nome: 'A', classe: 'VP', dataInscricao: null }], true);
    expect(removidos.map(r => r.numero)).toEqual([2]);
  });
});

describe('Gate estrutural — os elos que somem em silêncio', () => {
  const fonte = require('fs').readFileSync(
    require('path').join(__dirname, '../services/crmvScraperService.js'), 'utf8'
  );
  // Ignora COMENTÁRIOS: eles CITAM as regras para explicá-las, e sem o filtro o gate
  // passaria só pela própria documentação.
  const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  test('a URL de consulta usa padStart de 5 dígitos', () => {
    expect(semComentarios).toMatch(/padStart\(\s*DIGITOS_INSCRICAO\s*,\s*'0'\s*\)/);
    expect(semComentarios).toMatch(/DIGITOS_INSCRICAO\s*=\s*5/);
  });

  test('a URL de consulta leva challenge e honeypot', () => {
    expect(semComentarios).toMatch(/CAMPO_CHALLENGE\}=\$\{encodeURIComponent\(sessao\.challenge\)/);
    expect(semComentarios).toMatch(/CAMPO_HONEYPOT\}=/);
  });

  test('o challenge da resposta é guardado na sessão', () => {
    expect(semComentarios).toMatch(/resp\?\.challengeToken\)\s*sessao\.challenge\s*=\s*resp\.challengeToken/);
  });
});
