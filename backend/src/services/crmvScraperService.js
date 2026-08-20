'use strict';

// Scraper diário do SISCAD/CFMV usando Puppeteer.
// Estratégia: busca recursiva por PREFIXO do nome (modo "Iniciado com" da própria
// busca do site — filtro_tp_texto=3). Cada resposta devolve NO MÁXIMO 20 registros
// (limite real do servidor, empírico — não é configurável nem documentado). Prefixo
// que vier com 20 (cheio = truncado) é refinado acrescentando mais um caractere (A → AB →
// ABC...), até ficar abaixo de 20 ou até PROFUNDIDADE_MAXIMA.
// 🔴 CORRIGIDO em 2026 (caso real: "Laura Sereno..."/"Laura Maria do Rego Barros
// Noronha" ficaram fora do índice mesmo com o RJ "sincronizado com sucesso"):
// - O alfabeto de refinamento (`LETRAS`) inclui o ESPAÇO, não só A-Z. O nome no
//   SISCAD é "PRIMEIRO SEGUNDO TERCEIRO..." — depois de um primeiro nome comum
//   (Laura, Maria, Marina...) o próximo caractere de verdade é um espaço, nunca
//   outra letra colada. Sem o espaço no alfabeto, nenhum refino além do primeiro
//   nome jamais era tentado — "LAUR" ficava cheio (20/20, só "LAURA A..." até
//   "LAURA I...") e o robô desistia daquele ramo pra sempre, mesmo que o site
//   tivesse a resposta certa em "LAURA M" (testado ao vivo: 10 resultados, já
//   abaixo do limite).
// - `PROFUNDIDADE_MAXIMA` subiu de 4 para 8 para alcançar espaço + a 1ª letra do
//   nome seguinte nesses casos (ex.: "LAURA M" tem 7 caracteres).
// Nomes/sobrenomes muito comuns em português (DA, MA, SA, MARIA...) ainda podem
// estar cheios na profundidade máxima — nesse caso o excedente fica de fora do
// índice e um warning é logado; é uma escolha deliberada para não deixar o robô
// raspando por horas/gerando volume alto de tráfego no site do governo (ver
// decisão de 2026-08-18 abaixo). O aumento de profundidade só gera chamadas EXTRAS
// nos ramos que já estavam cheios (o próprio ponto cego) — um ramo que não está
// cheio termina a recursão na mesma hora de sempre, então o custo adicional é
// concentrado exatamente onde havia buraco de cobertura, não espalhado por todo o
// estado.
// `crmvService.js#validarCRMV` NUNCA bloqueia o cadastro por conta desse buraco —
// ver a nota de "não bloquear" em `crmvService.js`. Os CRMVs são armazenados como
// SHA-256(numero_6digits + UF) — nunca em claro.
//
// Rollout por REGIONALIDADE (decisão de 2026-08-18): UFS hoje cobre só o RJ, como
// piloto — trazer o Brasil inteiro nessa profundidade de busca geraria dezenas de
// milhares de chamadas por execução (SP sozinho já explodiu o teste). Expandir estado
// por estado conforme for validado. `crmvService.js#validarCRMV` NÃO bloqueia CRMV de
// UF ainda fora de `UFS`/sem dado no índice — só a UF que já tem cobertura é validada
// de fato; as demais devolvem `valido: null` (desconhecido, não nega acesso).
//
// Persistência: INCREMENTAL por UF — ao terminar de raspar um estado, o hash recém-
// coletado é comparado com o que já existe no banco PARA AQUELE ESTADO (nunca full
// delete+reinsert). O que é novo entra, o que sumiu é removido, e o resultado já fica
// commitado antes de passar para o próximo estado — se o processo cair no meio, os
// estados já processados não se perdem e a próxima execução só refaz a diferença.

const puppeteer = require('puppeteer');
const crypto    = require('crypto');
const prisma    = require('../lib/prisma').default;
const logger    = require('../lib/logger');

// Piloto: só RJ por enquanto — ver nota de regionalidade acima.
const UFS = ['RJ'];

// 27 caracteres: A-Z + ESPAÇO — o espaço é o que separa nome/sobrenome no SISCAD,
// e sem ele o refino nunca desce além do primeiro nome comum (ver nota acima).
const LETRAS             = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '.split('');
const SISCAD_URL         = 'https://siscad.cfmv.gov.br/paginas/busca';
const RECAPTCHA_KEY      = '6LeGZxEdAAAAAE6maxxCGJuYLzDhFh2fW4tBRHc9';
const LIMITE_SERVIDOR    = 20;   // limite REAL do servidor (medido empiricamente — não é 98)
const PROFUNDIDADE_MAXIMA = 8;   // não refina prefixo além de 8 caracteres (era 4 — ver nota acima)
const DELAY_ENTRE_CALLS  = 400;  // ms entre chamadas para evitar throttling
const TIPO_SUCESSO_API   = 'sucess'; // sic — a API do SISCAD devolve "sucess" (sem o 2º "s"), não "success"
const FILTRO_TP_INICIADO_COM = 3; // filtro_tp_texto=3 ("Iniciado com") — particiona MUITO
                                   // melhor que "Contendo todo o texto" (valor 2, usado antes):
                                   // "AZ" contendo-em-qualquer-lugar já vem cheio (20/20);
                                   // "AZ" começando-com vem com só 3 — convergência bem mais rápida
const FILTRO_PROCURAR_NOME   = 1; // filtro_procurar=1 ("Nome")

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashCrmv(numero, uf) {
  const n = String(numero).replace(/\D/g, '').padStart(6, '0');
  return crypto.createHash('sha256').update(`${n}${uf.toUpperCase()}`).digest('hex');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── reCAPTCHA ─────────────────────────────────────────────────────────────────

async function obterToken(page) {
  return page.evaluate(
    (key) => new Promise((resolve, reject) => {
      if (!window.grecaptcha) { reject(new Error('grecaptcha não disponível')); return; }
      window.grecaptcha.ready(() =>
        window.grecaptcha.execute(key, { action: 'busca' }).then(resolve).catch(reject)
      );
    }),
    RECAPTCHA_KEY
  );
}

// ── Chamada à API do SISCAD (via browser context) ─────────────────────────────

async function buscarPorFiltro(page, filtroTexto, uf) {
  try {
    const token = await obterToken(page);
    const url = `/pf/consultaInscricao/${encodeURIComponent(filtroTexto)}/${FILTRO_TP_INICIADO_COM}/${FILTRO_PROCURAR_NOME}/${uf}/${token}`;

    const resp = await page.evaluate(async (u) => {
      const r = await fetch(u, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
      });
      return r.json();
    }, url);

    return resp;
  } catch (err) {
    logger.warn(`[CRMV-Scraper] Erro na busca filtro="${filtroTexto}" uf="${uf}": ${err.message}`);
    return { type: 'error', data: [] };
  }
}

// ── Extração de hashes da resposta da API ──────────────────────────────────────

function extrairHashes(resp, uf) {
  if (resp?.type !== TIPO_SUCESSO_API || !Array.isArray(resp.data) || resp.data.length === 0) {
    return [];
  }

  return resp.data
    .map(row => {
      // Tentativa de múltiplos nomes de campo — ajuste após o primeiro run pelo log
      const num =
        row.pf_inscricao        ??
        row.pf_numero_inscricao ??
        row.pf_crmv             ??
        row.inscricao           ??
        row.numero              ??
        null;
      if (!num) return null;
      return hashCrmv(String(num), uf);
    })
    .filter(Boolean);
}

// ── Busca recursiva por prefixo ─────────────────────────────────────────────────
// Refina o prefixo (A → AB → ABC...) enquanto a resposta vier cheia (== LIMITE_SERVIDOR)
// e ainda houver profundidade disponível. Resposta abaixo do limite = capturou tudo
// daquele prefixo, não precisa refinar mais.
async function buscarRecursivo(page, prefixo, uf, hashesAcumulados) {
  const resp = await buscarPorFiltro(page, prefixo, uf);
  await sleep(DELAY_ENTRE_CALLS);

  if (resp?.type !== TIPO_SUCESSO_API || !Array.isArray(resp.data)) return;

  extrairHashes(resp, uf).forEach(h => hashesAcumulados.add(h));

  if (resp.data.length < LIMITE_SERVIDOR) return; // não truncado, terminou este ramo

  if (prefixo.length >= PROFUNDIDADE_MAXIMA) {
    logger.warn(`[CRMV-Scraper] UF=${uf} prefixo="${prefixo}" ainda cheio (${resp.data.length}) na profundidade máxima (${PROFUNDIDADE_MAXIMA}) — parte do resultado pode ficar de fora do índice`);
    return;
  }

  for (const letra of LETRAS) {
    await buscarRecursivo(page, prefixo + letra, uf, hashesAcumulados);
  }
}

// ── Scraping de uma UF ────────────────────────────────────────────────────────

async function scraperUF(page, uf) {
  const hashes = new Set();

  for (const letra of LETRAS) {
    await buscarRecursivo(page, letra, uf, hashes);
  }

  logger.info(`[CRMV-Scraper] UF=${uf} concluída: ${hashes.size} CRMVs`);
  return [...hashes];
}

// ── Diff e commit de uma UF ─────────────────────────────────────────────────────
// Compara o hash fresco (recém-raspado) com o que já está no banco PARA AQUELE
// ESTADO e aplica só a diferença (insere o que é novo, remove o que sumiu).
async function diffECommitUF(uf, hashesFrescos) {
  const existentes = await prisma.crmvValido.findMany({ where: { uf }, select: { hash: true } });
  const setExistente = new Set(existentes.map(e => e.hash));
  const setFresco = new Set(hashesFrescos);

  // Guarda de segurança: resultado vazio quando já havia dados é sinal de falha na
  // raspagem (bloqueio temporário, reCAPTCHA rejeitado, etc.), não de que o estado
  // ficou sem nenhum CRMV. Sem essa guarda, uma falha silenciosa apagaria o estado
  // inteiro — exatamente o tipo de bug que motivou essa correção.
  if (setFresco.size === 0 && setExistente.size > 0) {
    logger.warn(`[CRMV-Scraper] UF=${uf} voltou vazio mas já havia ${setExistente.size} registros — ignorando (provável falha de raspagem, não removendo nada)`);
    return { adicionados: 0, removidos: 0 };
  }

  const paraInserir = [...setFresco].filter(h => !setExistente.has(h));
  const paraRemover = [...setExistente].filter(h => !setFresco.has(h));

  if (paraInserir.length === 0 && paraRemover.length === 0) {
    return { adicionados: 0, removidos: 0 };
  }

  await prisma.$transaction(async (tx) => {
    if (paraInserir.length > 0) {
      await tx.crmvValido.createMany({
        data: paraInserir.map(hash => ({ hash, uf })),
        skipDuplicates: true,
      });
    }
    if (paraRemover.length > 0) {
      await tx.crmvValido.deleteMany({ where: { uf, hash: { in: paraRemover } } });
    }
  });

  return { adicionados: paraInserir.length, removidos: paraRemover.length };
}

// ── Execução principal ────────────────────────────────────────────────────────

async function executarScraping() {
  const inicio = Date.now();
  logger.info('[CRMV-Scraper] Iniciando sincronização diária do SISCAD/CFMV...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      // Linux: necessário em containers sem sandbox
      ...(process.platform !== 'win32' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  let totalInseridos = 0;
  let totalAdicionados = 0;
  let totalRemovidos = 0;
  let erroMsg = null;

  try {
    const page = await browser.newPage();

    // User-agent realista para evitar bloqueio por bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    // Carrega a página uma vez — reutiliza o reCAPTCHA para todas as buscas
    logger.info('[CRMV-Scraper] Carregando SISCAD...');
    await page.goto(SISCAD_URL, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Aguarda o reCAPTCHA v3 estar disponível
    await page.waitForFunction(
      () => typeof window.grecaptcha !== 'undefined',
      { timeout: 20_000 }
    );

    // Seleciona Pessoa Física no formulário
    await page.evaluate(() => {
      const pfInput = document.querySelector('input[name="tipo"][value="pf"]');
      if (pfInput) pfInput.click();
    });

    // Para cada UF: raspa e já commita a diferença antes de seguir para a próxima —
    // nunca acumula tudo em memória para gravar só no final.
    for (const uf of UFS) {
      try {
        const hashes = await scraperUF(page, uf);
        const { adicionados, removidos } = await diffECommitUF(uf, hashes);
        totalAdicionados += adicionados;
        totalRemovidos   += removidos;
        if (adicionados > 0 || removidos > 0) {
          logger.info(`[CRMV-Scraper] UF=${uf} sincronizada: +${adicionados} -${removidos}`);
        }
      } catch (err) {
        logger.error(`[CRMV-Scraper] Erro UF=${uf}: ${err.message}`);
      }
    }

    totalInseridos = await prisma.crmvValido.count();
    logger.info(`[CRMV-Scraper] Concluído: ${totalInseridos} CRMVs no total (+${totalAdicionados} -${totalRemovidos} nesta execução) em ${Math.round((Date.now() - inicio) / 1000)}s`);

  } catch (err) {
    erroMsg = err.message;
    logger.error(`[CRMV-Scraper] Falha geral: ${err.stack}`);
  } finally {
    // Windows: o Chrome pode segurar lock no perfil temporário por alguns
    // instantes (EBUSY em first_party_sets.db) — falha de limpeza não pode
    // derrubar o cron nem impedir a gravação do log de sincronização.
    try { await browser.close(); }
    catch (err) { logger.warn(`[CRMV-Scraper] Falha ao fechar o browser (ignorada): ${err.message}`); }

    await prisma.crmvSyncLog.create({
      data: {
        totalRegistros:   totalInseridos,
        totalAdicionados,
        totalRemovidos,
        duracao:          Math.round((Date.now() - inicio) / 1000),
        sucesso:          !erroMsg,
        erro:             erroMsg,
      },
    });
  }

  return { totalInseridos, totalAdicionados, totalRemovidos, erro: erroMsg };
}

module.exports = { executarScraping };