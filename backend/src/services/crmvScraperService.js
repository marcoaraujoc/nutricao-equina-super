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
// 🔴 2026-09-18 — DOIS defeitos corrigidos, os dois SILENCIOSOS (ver as constantes
// DIGITOS_INSCRICAO e CAMPO_CHALLENGE para a evidência de cada um):
//   1. a inscrição ia SEM zero-padding, e a busca "Idêntico" do SISCAD compara contra
//      o número de 5 dígitos — de 1 a 9999 nada casava, e o índice só tinha registros
//      de 10000 para cima (medido: 11.750 linhas, nenhuma abaixo de 10000);
//   2. o SISCAD passou a exigir um token de sessão de consulta (`consulta_challenge`),
//      sem o qual TODA chamada responde "Sessão de consulta inválida" — o job estava
//      trazendo zero.
// Nenhum dos dois derrubava a execução: o job terminava "com sucesso" e sem trabalho.
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

// 🔴 A INSCRIÇÃO VAI COM 5 DÍGITOS, ZERO-PADDED (2026-09-18). Não é preferência de
// formatação: a busca é "Idêntico" e o SISCAD compara contra a inscrição gravada com
// 5 dígitos, então "1000" NÃO casa com "01000". O próprio site faz esse padding antes
// de consultar — `searchMethodMask` em /paginas/busca:
//     $(alvo).val(("00000" + $(alvo).val()).slice(-5));
// Sem ele, os números de 1 a 9999 devolviam "Sua pesquisa não retornou nenhum
// resultado" e o índice só se enchia de 10000 em diante, quando o número decimal cru
// já tem 5 dígitos e casa por acidente.
// MEDIDO no banco antes da correção: 11.750 registros, TODOS de 5 dígitos, menor 10000
// e maior 23768 — ZERO abaixo de 10000. E ao vivo, COM o padding, "00001" devolve
// ALUISIO PEREIRA DE FIGUEIREDO (ativo), "01000" DIANA ASSIS DE OLIVEIRA, "07500"
// DANYELLE MARCHIORI MOREIRA, "09999" FLAVIA BORGES TAVARES — todos ativos e todos
// fora do índice. Era ~40% da faixa varrida saindo em silêncio.
const DIGITOS_INSCRICAO = 5;

// 🔴 O SISCAD passou a exigir um TOKEN DE SESSÃO DE CONSULTA (2026-09-18). Sem ele
// TODA chamada responde `{"type":"error","message":"Sessão de consulta inválida.
// Recarregue a página e tente novamente.","challengeToken":"..."}` — ou seja, o job
// não trazia mais NADA, e o único freio era a guarda de `diffECommitUF` (que ignora a
// UF quando o resultado volta totalmente vazio).
// O valor nasce no DOM (`#consulta_challenge`) e é RENOVADO a cada resposta: o
// `challengeToken` devolvido vale para a chamada SEGUINTE. `website_url` é o honeypot
// do formulário e vai VAZIO — preenchê-lo é o que denuncia um robô.
const CAMPO_CHALLENGE = 'consulta_challenge';
const CAMPO_HONEYPOT  = 'website_url';
const MSG_SESSAO_INVALIDA = 'sessão de consulta inválida';

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

// ── Sessão de consulta (challenge + honeypot) ─────────────────────────────────
// A sessão é um OBJETO MUTÁVEL de propósito: o challenge muda a cada resposta e
// precisa atravessar as ~25 mil chamadas da varredura. Guardá-lo numa variável de
// módulo faria duas execuções simultâneas embaralharem o token uma da outra.

async function abrirSessaoConsulta(page) {
  await page.goto(SISCAD_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.grecaptcha !== 'undefined', { timeout: 20_000 });

  // Seleciona Pessoa Física no formulário
  await page.evaluate(() => {
    const pfInput = document.querySelector('input[name="tipo"][value="pf"]');
    if (pfInput) pfInput.click();
  });

  const challenge = await page.evaluate(
    (campo) => document.querySelector(`#${campo}`)?.value ?? '',
    CAMPO_CHALLENGE
  );
  if (!challenge) {
    // Não é fatal — a 1ª chamada devolve um `challengeToken` novo junto do erro de
    // sessão, e a re-tentativa a aproveita. Mas é o sinal de que o formulário mudou.
    logger.warn(`[CRMV-Scraper] #${CAMPO_CHALLENGE} não encontrado na página — o formulário do SISCAD pode ter mudado`);
  }
  return { page, challenge };
}

const ehSessaoInvalida = (resp) =>
  String(resp?.message ?? '').toLowerCase().includes(MSG_SESSAO_INVALIDA);

// ── Chamada à API do SISCAD (via browser context) — busca EXATA por número ────
// Devolve `{ resp, falhou }`. `falhou` distingue "não existe esse número" (resposta
// legítima) de "não consegui perguntar" (sessão caída, rede, reCAPTCHA recusado) —
// tratar os dois como "não existe" é o que faria a varredura quebrada REMOVER o
// índice inteiro no diff, em silêncio.

async function consultarInscricao(sessao, numero, uf) {
  const valor = String(numero).padStart(DIGITOS_INSCRICAO, '0');
  const token = await obterToken(sessao.page);
  const url =
    `/pf/consultaInscricao/${valor}/${FILTRO_TP_IDENTICO}/${FILTRO_PROCURAR_INSCRICAO}/${uf}/${token}` +
    `?${CAMPO_CHALLENGE}=${encodeURIComponent(sessao.challenge)}&${CAMPO_HONEYPOT}=`;

  const resp = await sessao.page.evaluate(async (u) => {
    const r = await fetch(u, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json',
      },
    });
    return r.json();
  }, url);

  // O token da resposta vale para a chamada SEGUINTE — inclusive quando a resposta é
  // erro (é assim que a sessão se recupera sem recarregar a página).
  if (resp?.challengeToken) sessao.challenge = resp.challengeToken;
  return resp;
}

async function buscarPorNumero(sessao, numero, uf) {
  try {
    let resp = await consultarInscricao(sessao, numero, uf);

    // Sessão caiu: reabre a página (challenge novo) e tenta UMA vez. Sem isso, uma
    // expiração no meio de uma varredura de horas transformaria todo o resto do
    // estado em "não existe".
    if (ehSessaoInvalida(resp)) {
      logger.warn(`[CRMV-Scraper] Sessão de consulta expirou em número=${numero} uf=${uf} — reabrindo`);
      const nova = await abrirSessaoConsulta(sessao.page);
      if (nova.challenge) sessao.challenge = nova.challenge;
      resp = await consultarInscricao(sessao, numero, uf);
      if (ehSessaoInvalida(resp)) return { resp, falhou: true };
    }

    return { resp, falhou: false };
  } catch (err) {
    logger.warn(`[CRMV-Scraper] Erro na busca número=${numero} uf=${uf}: ${err.message}`);
    return { resp: { type: 'error', data: [] }, falhou: true };
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

  // Defesa: a busca é EXATA, então a inscrição devolvida tem de ser a que foi pedida.
  // Se um dia o filtro deixar de ser exato, sem esta checagem gravaríamos o NOME de um
  // veterinário sob o NÚMERO de outro — e o índice passaria a validar CRMV errado.
  const devolvida = row.pf_inscricao ?? row.inscricao;
  if (devolvida != null && Number(devolvida) !== Number(numero)) {
    logger.warn(`[CRMV-Scraper] Inscrição divergente: pedida=${numero} devolvida=${devolvida} uf=${uf} — descartada`);
    return null;
  }

  return {
    numero,
    uf,
    nome:          String(row.nome_preferencial ?? '').trim(),
    classe:        row.pf_classe ? String(row.pf_classe) : null,
    dataInscricao: row.dt_inscricao ? new Date(row.dt_inscricao) : null,
  };
}

// ── Varredura sequencial de uma UF ─────────────────────────────────────────────

async function varrerUF(sessao, uf) {
  const max = MAX_POR_UF[uf];
  const ativos = [];
  let falhas = 0;

  for (let numero = 1; numero <= max; numero++) {
    const { resp, falhou } = await buscarPorNumero(sessao, numero, uf);
    await sleep(DELAY_ENTRE_CALLS);

    if (falhou) { falhas++; continue; }

    const registro = extrairRegistroAtivo(resp, numero, uf);
    if (registro) ativos.push(registro);
  }

  // ⚠️ Varredura com QUALQUER falha não autoriza REMOÇÃO: o número que não pôde ser
  // consultado é indistinguível, no resultado, do que não existe — e a remoção é a
  // única parte do diff que destrói dado. Com falhas, só entra o que é novo.
  const confiavel = falhas === 0;
  const aviso = confiavel ? '' : ` — ${falhas} consultas falharam, nenhuma remoção será aplicada`;
  logger.info(`[CRMV-Scraper] UF=${uf} varredura concluída: ${ativos.length} ativos em ${max} números${aviso}`);
  return { ativos, confiavel, falhas };
}

// ── Diff e commit de uma UF ─────────────────────────────────────────────────────
// Compara os ativos frescos (recém-varridos) com o que já está no banco PARA
// AQUELE ESTADO e aplica só a diferença — novo entra, sumido/inativado sai, e quem
// mudou de nome/classe (correção de cadastro, por ex.) é atualizado no lugar.
async function diffECommitUF(uf, frescos, confiavel = true) {
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
  // Varredura com falhas só ACRESCENTA (ver `varrerUF`): o número que não pôde ser
  // consultado chega aqui igualzinho ao que não existe, e removê-lo apagaria do índice
  // um veterinário ativo por causa de uma queda de rede.
  const removidos = confiavel
    ? [...existentePorNum.values()].filter(e => !frescoPorNumero.has(e.numero))
    : [];

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

    // Carrega a página uma vez — dela saem o reCAPTCHA e o challenge da sessão de
    // consulta, reaproveitados por todas as buscas (e renovados a cada resposta).
    logger.info('[CRMV-Scraper] Carregando SISCAD...');
    const sessao = await abrirSessaoConsulta(page);

    // Para cada UF: varre por número e já commita a diferença antes de seguir para
    // a próxima — nunca acumula tudo em memória para gravar só no final.
    for (const uf of UFS) {
      try {
        const { ativos, confiavel, falhas } = await varrerUF(sessao, uf);
        const { adicionados, removidos, atualizados } = await diffECommitUF(uf, ativos, confiavel);
        totalAdicionados += adicionados.length;
        totalRemovidos   += removidos.length;
        if (adicionados.length > 0 || removidos.length > 0 || atualizados.length > 0) {
          logger.info(`[CRMV-Scraper] UF=${uf} sincronizada: +${adicionados.length} -${removidos.length} ~${atualizados.length}`);
        }
        resumoHtml +=
          `<strong>${uf}:</strong> ${ativos.length} veterinários ativos (${MAX_POR_UF[uf]} números varridos)` +
          (confiavel ? '' : `<br><strong style="color:#b45309">⚠️ ${falhas} consultas falharam — nenhuma remoção foi aplicada nesta UF.</strong>`) +
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

// As internas saem EXPORTADAS para teste porque as duas regras que este arquivo
// carrega quebram em SILÊNCIO — sem o padding e sem o challenge o job termina "com
// sucesso" e simplesmente não traz nada. Varredura de texto não basta: é preciso
// EXECUTAR e conferir a URL que sai daqui.
module.exports = {
  executarScraping,
  __internos: { consultarInscricao, buscarPorNumero, extrairRegistroAtivo, varrerUF, diffECommitUF, MAX_POR_UF },
};
