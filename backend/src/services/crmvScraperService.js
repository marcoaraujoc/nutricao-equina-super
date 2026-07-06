'use strict';

// Scraper diário do SISCAD/CFMV usando Puppeteer.
// Estratégia: para cada UF, busca por letra A-Z com "contém" no nome.
// Se uma letra retorna >= 98 resultados (próximo do limite do servidor),
// faz sub-buscas com 2 letras (AA, AB, ...) para cobrir todo o universo.
// Os CRMVs são armazenados como SHA-256(numero_6digits + UF) — nunca em claro.

const puppeteer = require('puppeteer');
const crypto    = require('crypto');
const prisma    = require('../lib/prisma').default;
const logger    = require('../lib/logger');

const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES',
  'GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC',
  'SP','SE','TO',
];

const LETRAS            = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SISCAD_URL        = 'https://siscad.cfmv.gov.br/paginas/busca';
const RECAPTCHA_KEY     = '6LeGZxEdAAAAAE6maxxCGJuYLzDhFh2fW4tBRHc9';
const LIMITE_SERVIDOR   = 98;   // se >= LIMITE, faz sub-busca com 2 letras
const DELAY_ENTRE_CALLS = 400;  // ms entre chamadas para evitar throttling

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
    const url = `/pf/consultaInscricao/${encodeURIComponent(filtroTexto)}/2/1/${uf}/${token}`;

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
  if (resp?.type !== 'success' || !Array.isArray(resp.data) || resp.data.length === 0) {
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

// ── Scraping de uma UF ────────────────────────────────────────────────────────

async function scraperUF(page, uf) {
  const hashes = new Set();
  let primeiroRow = true;

  for (const letra of LETRAS) {
    const resp = await buscarPorFiltro(page, letra, uf);

    if (resp?.type === 'success' && resp.data?.length > 0) {
      // Loga o primeiro row para descobrir os nomes de campo
      if (primeiroRow) {
        logger.info(`[CRMV-Scraper] Sample row UF=${uf}: ${JSON.stringify(resp.data[0])}`);
        primeiroRow = false;
      }

      extrairHashes(resp, uf).forEach(h => hashes.add(h));

      // Sub-busca com 2 letras se próximo do limite
      if (resp.data.length >= LIMITE_SERVIDOR) {
        logger.info(`[CRMV-Scraper] UF=${uf} letra="${letra}" hit limite (${resp.data.length}) — sub-buscando AA–ZZ`);

        for (const letra2 of LETRAS) {
          const sub = await buscarPorFiltro(page, letra + letra2, uf);
          extrairHashes(sub, uf).forEach(h => hashes.add(h));
          await sleep(DELAY_ENTRE_CALLS);
        }
      }
    }

    await sleep(DELAY_ENTRE_CALLS);
  }

  logger.info(`[CRMV-Scraper] UF=${uf} concluída: ${hashes.size} CRMVs`);
  return [...hashes];
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

    // Coleta hashes de todas as UFs
    const todosHashes = [];
    for (const uf of UFS) {
      try {
        const hashes = await scraperUF(page, uf);
        hashes.forEach(hash => todosHashes.push({ hash, uf }));
      } catch (err) {
        logger.error(`[CRMV-Scraper] Erro UF=${uf}: ${err.message}`);
      }
    }

    // Grava no banco em transação: limpa tudo e reinsere
    logger.info(`[CRMV-Scraper] Gravando ${todosHashes.length} hashes no banco...`);

    await prisma.crmvValido.deleteMany();

    const LOTE = 2000;
    for (let i = 0; i < todosHashes.length; i += LOTE) {
      await prisma.crmvValido.createMany({
        data: todosHashes.slice(i, i + LOTE),
        skipDuplicates: true,
      });
    }

    totalInseridos = await prisma.crmvValido.count();
    logger.info(`[CRMV-Scraper] Concluído: ${totalInseridos} CRMVs em ${Math.round((Date.now() - inicio) / 1000)}s`);

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
        totalRegistros: totalInseridos,
        duracao:        Math.round((Date.now() - inicio) / 1000),
        sucesso:        !erroMsg,
        erro:           erroMsg,
      },
    });
  }

  return { totalInseridos, erro: erroMsg };
}

module.exports = { executarScraping };