// backend/src/services/documentoWhatsappService.js
// COMPONENTE REUTILIZÁVEL: HTML → PDF → WhatsApp.
//
// Qualquer módulo que precise mandar um documento ao cliente (orçamento, fatura,
// relatório, receituário) usa daqui — não duplique geração de PDF nem chamada de
// provider. O contrato é só: me dê um HTML, um telefone e o escopo da clínica.
//
//   const { enviarDocumentoWhatsApp } = require('./documentoWhatsappService');
//   await enviarDocumentoWhatsApp({
//     empresaId, equipeId, telefone, html, nomeArquivo: 'fatura-001.pdf',
//     legenda: 'Segue sua fatura', contexto: { faturaId: 12 },
//   });
//
// O PDF sai do Puppeteer (texto selecionável e paginação nativa do Chrome), e o
// envio passa pelo WhatsAppProvider — então trocar de provedor não afeta quem chama.
'use strict';

const logger = require('../lib/logger');
const { getWhatsAppProvider } = require('../messaging/whatsappProvider');

/** Normaliza para o formato internacional do Brasil (55 + DDD + número). */
function foneIntl(telefone) {
  const d = String(telefone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

/**
 * Renderiza HTML em PDF (A4) e devolve o Buffer.
 * O Puppeteer é carregado sob demanda: é pesado e nem todo deploy usa esta rota.
 *
 * ── Isolamento de rede (SSRF) ───────────────────────────────────────────────
 * O navegador headless roda DENTRO do perímetro: um `<img src>`, `@font-face` ou
 * `@import` apontando para `http://localhost:5432`, para a metadata da nuvem ou
 * para qualquer serviço interno seria buscado por ele. Como parte do HTML vem de
 * dado de tenant, auditar o conteúdo não é garantia suficiente.
 *
 * Por isso a rede é cortada na origem: TODA requisição que não seja `data:` é
 * abortada. Consequência prática — imagens e fontes precisam vir embutidas como
 * data URI; uma URL http simplesmente não carrega (degrada para espaço em branco,
 * nunca para uma requisição de saída). JavaScript também fica desligado: os
 * templates são estáticos e não precisam dele.
 *
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
async function htmlParaPdf(html) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({
    headless: 'new',
    // --no-sandbox só é necessário rodando como root (container). Se o processo
    // roda como usuário sem privilégio, REMOVA: o sandbox é a principal barreira
    // caso o renderer seja comprometido.
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      // O próprio setContent entra como document data:/about:blank
      if (url.startsWith('data:') || url === 'about:blank') return req.continue();
      logger.warn(`[DocumentoWhatsApp] Requisição externa bloqueada no PDF: ${url.slice(0, 120)}`);
      return req.abort();
    });

    // Sem rede não há o que aguardar além do parse do documento
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }
}

/**
 * Gera o PDF a partir do HTML e envia por WhatsApp.
 *
 * @param {object} p
 * @param {number}  p.empresaId   — escopo da instância de WhatsApp (obrigatório)
 * @param {number} [p.equipeId]
 * @param {string}  p.telefone    — qualquer formato; normalizado internamente
 * @param {string}  p.html        — documento completo (<html>…</html>)
 * @param {string}  p.nomeArquivo — ex: 'orcamento-0007.pdf'
 * @param {string} [p.legenda]    — texto que acompanha o documento
 * @param {object} [p.contexto]   — metadados livres para log/rastreio
 * @returns {Promise<{sucesso:boolean, erro?:string, simulado?:boolean, id?:string}>}
 */
async function enviarDocumentoWhatsApp({
  empresaId, equipeId = null, telefone, html, nomeArquivo, legenda = '', contexto = {},
}) {
  if (!empresaId)  return { sucesso: false, erro: 'SEM_EMPRESA' };
  if (!html)       return { sucesso: false, erro: 'SEM_CONTEUDO' };

  const para = foneIntl(telefone);
  if (!para) return { sucesso: false, erro: 'TELEFONE_AUSENTE' };

  const provider = getWhatsAppProvider();

  // Checagem RÁPIDA antes do Puppeteer — ver WhatsAppProvider#estaProntoParaEnviar.
  // Sem ela, toda clínica sem instância conectada pagava o custo de gerar o PDF
  // (segundos) só para o envio falhar em seguida por outro motivo — e esse atraso
  // extra, somado ao do fallback manual do front, arriscava perder o gesto do
  // usuário que abriria o WhatsApp (window.open silenciosamente bloqueado).
  if (!(await provider.estaProntoParaEnviar({ empresaId, equipeId }))) {
    return { sucesso: false, erro: 'PROVIDER_INDISPONIVEL' };
  }

  let base64;
  try {
    const pdf = await htmlParaPdf(html);
    base64 = pdf.toString('base64');
  } catch (err) {
    logger.error(`[DocumentoWhatsApp] Falha ao gerar PDF (${nomeArquivo}): ${err.message}`);
    return { sucesso: false, erro: 'ERRO_PDF' };
  }

  return provider.enviarDocumento({
    para,
    arquivo: { base64, nome: nomeArquivo },
    legenda,
    contexto: { ...contexto, empresaId, equipeId },
  });
}

module.exports = { enviarDocumentoWhatsApp, htmlParaPdf, foneIntl };
