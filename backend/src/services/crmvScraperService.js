'use strict';

// Scraper diário do SISCAD/CFMV — varredura SEQUENCIAL por NÚMERO de inscrição.
// (Reescrito em 2026-08-20 — substituiu a varredura recursiva por PREFIXO DE NOME
// que existia antes. Ver o histórico dessa versão anterior no git log, se precisar
// resgatar a lógica de busca por nome/prefixo.)
//
// POR QUÊ a mudança: a busca por nome tinha um teto REAL do servidor (20 registros
// por resposta, LIMITE_SERVIDOR) e uma profundidade máxima de refino de prefixo (8
// caracteres) — nomes/sobrenomes muito comuns em português (Maria, Da Silva...)
// ficavam de fora do índice mesmo com a sincronização "bem-sucedida". A varredura
// por INSCRIÇÃO não tem esse problema: cada número é uma busca EXATA
// (filtro_procurar=2 "Inscrição" + filtro_tp_texto=1 "Idêntico"), sempre 0 ou 1
// resultado — sem truncamento e sem necessidade de refino recursivo.
//
// O número de inscrição é SEQUENCIAL e, segundo o usuário, às vezes REAPROVEITADO
// (pedido de 2026-08-20) — por isso a varredura é EXAUSTIVA (1..MAX_POR_UF) a cada
// execução, não incremental por delta de números: um número que era de um
// veterinário inativo ontem pode ter sido reatribuído hoje.
//
// GUARDADO EM CLARO (nome + número) — reverte a política anterior da tabela
// ("nunca em claro", só hash SHA-256). Decisão de 2026-08-20: sem o nome em claro
// não dá pra reportar QUEM mudou no diff diário, que é o pedido explícito (ver
// `diffECommitUF`/`formatarLista` abaixo). Só entra no índice quem está `atuante`
// (ativo) no SISCAD — "traga todos os veterinários ativos".
//
// Rollout por REGIONALIDADE (mantido da versão anterior): MAX_POR_UF hoje cobre só
// o RJ, como piloto — cada estado tem a PRÓPRIA numeração (o "10000" do RJ não é o
// "10000" de SP), por isso o teto é por UF, nunca um valor global único. RJ hoje
// vai até ~23700; 25000 é a folga pedida pelo usuário para uma eventual ordem não
// estritamente sequencial. Expandir para outro estado = acrescentar uma entrada em
// MAX_POR_UF com o teto daquele estado.
// `crmvService.js#validarCRMV` NÃO bloqueia CRMV de UF ainda fora de MAX_POR_UF/sem
// dado no índice — só a UF que já tem cobertura é validada de fato; as demais
// devolvem `valido: null` (desconhecido, não nega acesso).
//
// Persistência: INCREMENTAL por UF — ao terminar de varrer um estado, o resultado
// fresco é comparado com o que já está no banco PARA AQUELE ESTADO (nunca full
// delete+reinsert). O que é novo entra, o que sumiu/ficou inativo é removido, o que
// mudou de nome/classe é atualizado, e o resultado já fica commitado antes de
// passar para o próximo estado — se o processo cair no meio, os estados já
// processados não se perdem e a próxima execução só refaz a diferença.

const puppeteer = require('puppeteer');
const prisma    = require('../lib/prisma').default;
const logger    = require('../lib/logger');

// Piloto: só RJ por enquanto — ver nota de regionalidade acima.
const MAX_POR_UF = { RJ: 25000 };
const UFS        = Object.keys(MAX_POR_UF);

const SISCAD_URL        = 'https://siscad.cfmv.gov.br/paginas/busca';
const RECAPTCHA_KEY     = '6LeGZxEdAAAAAE6maxxCGJuYLzDhFh2fW4tBRHc9';
const DELAY_ENTRE_CALLS = 400;  // ms entre chamadas para evitar throttling — mesmo valor de antes
const TIPO_SUCESSO_API  = 'sucess'; // sic — a API do SISCAD devolve "sucess" (sem o 2º "s"), não "success"

// filtro_procurar=2 ("Inscrição") + filtro_tp_texto=1 ("Idêntico") — confirmado ao
// vivo contra o SISCAD (2026-08-20): busca EXATA por número, sempre 0 ou 1 resultado.
const FILTRO_TP_IDENTICO        = 1;
const FILTRO_PROCURAR_INSCRICAO = 2;

// Cap de linhas listadas por seção no e-mail do diff — sem isso, a 1ª execução
// desta versão nova (em que TUDO é "novo", ~23 mil linhas) geraria um e-mail
// inviável. O TOTAL sempre aparece no cabeçalho da seção, só a listagem é capada.
const LIMITE_LISTA_EMAIL = 30;

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

// ── Chamada à API do SISCAD (via browser context) — busca EXATA por número ────

async function buscarPorNumero(page, numero, uf) {
  try {
    const token = await obterToken(page);
    const url = `/pf/consultaInscricao/${numero}/${FILTRO_TP_IDENTICO}/${FILTRO_PROCURAR_INSCRICAO}/${uf}/${token}`;

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
    logger.warn(`[CRMV-Scraper] Erro na busca número=${numero} uf=${uf}: ${err.message}`);
    return { type: 'error', data: [] };
  }
}

// ── Extração do registro (se ATIVO) ────────────────────────────────────────────
// "traga todos os veterinários ativos" — número sem resultado (não cadastrado) ou
// com `atuante !== true` (cancelado/suspenso/etc.) simplesmente não entra no índice.
function extrairRegistroAtivo(resp, numero, uf) {
  if (resp?.type !== TIPO_SUCESSO_API || !Array.isArray(resp.data) || resp.data.length === 0) {
    return null;
  }
  const row = resp.data[0];
  if (row.atuante !== true) return null;

  return {
    numero,
    uf,
    nome:          String(row.nome_preferencial ?? '').trim(),
    classe:        row.pf_classe ? String(row.pf_classe) : null,
    dataInscricao: row.dt_inscricao ? new Date(row.dt_inscricao) : null,
  };
}

// ── Varredura sequencial de uma UF ─────────────────────────────────────────────

async function varrerUF(page, uf) {
  const max = MAX_POR_UF[uf];
  const ativos = [];

  for (let numero = 1; numero <= max; numero++) {
    const resp = await buscarPorNumero(page, numero, uf);
    await sleep(DELAY_ENTRE_CALLS);

    const registro = extrairRegistroAtivo(resp, numero, uf);
    if (registro) ativos.push(registro);
  }

  logger.info(`[CRMV-Scraper] UF=${uf} varredura concluída: ${ativos.length} ativos em ${max} números`);
  return ativos;
}

// ── Diff e commit de uma UF ─────────────────────────────────────────────────────
// Compara os ativos frescos (recém-varridos) com o que já está no banco PARA
// AQUELE ESTADO e aplica só a diferença — novo entra, sumido/inativado sai, e quem
// mudou de nome/classe (correção de cadastro, por ex.) é atualizado no lugar.
async function diffECommitUF(uf, frescos) {
  const existentes       = await prisma.crmvValido.findMany({ where: { uf } });
  const existentePorNum  = new Map(existentes.map(e => [e.numero, e]));
  const frescoPorNumero  = new Map(frescos.map(f => [f.numero, f]));

  // Guarda de segurança: resultado vazio quando já havia dados é sinal de falha na
  // varredura (bloqueio temporário, reCAPTCHA rejeitado em massa, etc.), não de que
  // o estado ficou sem nenhum veterinário ativo. Sem essa guarda, uma falha
  // silenciosa apagaria o estado inteiro do índice.
  if (frescoPorNumero.size === 0 && existentePorNum.size > 0) {
    logger.warn(`[CRMV-Scraper] UF=${uf} voltou vazio mas já havia ${existentePorNum.size} registros — ignorando (provável falha de varredura, não removendo nada)`);
    return { adicionados: [], removidos: [], atualizados: [] };
  }

  const adicionados = [];
  const atualizados  = [];
  for (const [numero, fresco] of frescoPorNumero) {
    const existente = existentePorNum.get(numero);
    if (!existente) { adicionados.push(fresco); continue; }
    if (existente.nome !== fresco.nome || existente.classe !== fresco.classe) {
      atualizados.push({ antes: existente, depois: fresco });
    }
  }
  const removidos = [...existentePorNum.values()].filter(e => !frescoPorNumero.has(e.numero));

  if (adicionados.length === 0 && removidos.length === 0 && atualizados.length === 0) {
    return { adicionados: [], removidos: [], atualizados: [] };
  }

  await prisma.$transaction(async (tx) => {
    if (adicionados.length > 0) {
      await tx.crmvValido.createMany({
        data: adicionados.map(({ numero, uf: ufItem, nome, classe, dataInscricao }) => ({ numero, uf: ufItem, nome, classe, dataInscricao })),
        skipDuplicates: true,
      });
    }
    if (removidos.length > 0) {
      await tx.crmvValido.deleteMany({ where: { uf, numero: { in: removidos.map(r => r.numero) } } });
    }
    for (const { depois } of atualizados) {
      await tx.crmvValido.update({
        where: { numero_uf: { numero: depois.numero, uf } },
        data:  { nome: depois.nome, classe: depois.classe, dataInscricao: depois.dataInscricao },
      });
    }
  });

  return { adicionados, removidos, atualizados };
}

// ── Formatação do diff para o e-mail de monitoração ───────────────────────────

function formatarLista(titulo, itens, linha) {
  if (itens.length === 0) return '';
  const visiveis = itens.slice(0, LIMITE_LISTA_EMAIL).map(linha).join('<br>');
  const resto = itens.length > LIMITE_LISTA_EMAIL
    ? `<br>… e mais ${itens.length - LIMITE_LISTA_EMAIL}`
    : '';
  return `<br><br><strong>${titulo} (${itens.length}):</strong><br>${visiveis}${resto}`;
}

// ── Execução principal ────────────────────────────────────────────────────────

async function executarScraping() {
  const inicio = Date.now();
  logger.info('[CRMV-Scraper] Iniciando varredura diária por número de inscrição (SISCAD/CFMV)...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      // Linux: necessário em containers sem sandbox
      ...(process.platform !== 'win32' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });

  let totalRegistros   = 0;
  let totalAdicionados = 0;
  let totalRemovidos   = 0;
  let erroMsg          = null;
  let resumoHtml       = '';

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

    // Para cada UF: varre por número e já commita a diferença antes de seguir para
    // a próxima — nunca acumula tudo em memória para gravar só no final.
    for (const uf of UFS) {
      try {
        const ativos = await varrerUF(page, uf);
        const { adicionados, removidos, atualizados } = await diffECommitUF(uf, ativos);
        totalAdicionados += adicionados.length;
        totalRemovidos   += removidos.length;
        if (adicionados.length > 0 || removidos.length > 0 || atualizados.length > 0) {
          logger.info(`[CRMV-Scraper] UF=${uf} sincronizada: +${adicionados.length} -${removidos.length} ~${atualizados.length}`);
        }
        resumoHtml +=
          `<strong>${uf}:</strong> ${ativos.length} veterinários ativos (${MAX_POR_UF[uf]} números varridos)` +
          formatarLista('Novos ativos', adicionados, r => `${r.numero}/${uf} — ${r.nome}`) +
          formatarLista('Deixaram de aparecer como ativos', removidos, r => `${r.numero}/${uf} — ${r.nome}`) +
          formatarLista('Nome/classe atualizados', atualizados, ({ antes, depois }) => `${depois.numero}/${uf} — ${antes.nome} → ${depois.nome}`);
      } catch (err) {
        logger.error(`[CRMV-Scraper] Erro UF=${uf}: ${err.message}`);
        resumoHtml += `<br><br><strong>${uf}: falhou</strong> — ${err.message}`;
      }
    }

    totalRegistros = await prisma.crmvValido.count();
    logger.info(`[CRMV-Scraper] Concluído: ${totalRegistros} veterinários ativos no índice (+${totalAdicionados} -${totalRemovidos}) em ${Math.round((Date.now() - inicio) / 1000)}s`);

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
        totalRegistros,
        totalAdicionados,
        totalRemovidos,
        duracao:          Math.round((Date.now() - inicio) / 1000),
        sucesso:          !erroMsg,
        erro:             erroMsg,
      },
    });
  }

  return { totalRegistros, totalAdicionados, totalRemovidos, erro: erroMsg, resumoHtml };
}

module.exports = { executarScraping };
