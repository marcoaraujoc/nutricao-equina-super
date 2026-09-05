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
 * ── 🔴 O RETORNO É NORMALIZADO PARA `Buffer` NA FONTE ────────────────────────
 * A partir do Puppeteer 23, `page.pdf()` devolve **`Uint8Array`, não `Buffer`** — e
 * `Uint8Array.prototype.toString('base64')` IGNORA o argumento e devolve os bytes
 * separados por vírgula (`"37,80,68,70,..."`). Não lança nada: cada consumidor
 * recebia uma string plausível que não é base64 de coisa alguma.
 *   - WhatsApp: a Evolution recusava com 400 "Owned media must be a url or base64",
 *     e a tela caía no fallback manual — o sintoma "manda como texto, não anexo".
 *   - E-mail: o anexo seguia com conteúdo corrompido.
 * Normalizar AQUI, e não em cada chamador, é o que faz `.toString('base64')`,
 * `.length` e `storage.upload({ buffer })` voltarem a significar o que aparentam —
 * inclusive nos caminhos que ainda não existem.
 * ⚠️ `Buffer.from(uint8)` COPIA os bytes; não use `Buffer.from(u8.buffer)`, que
 * compartilha o ArrayBuffer e pode carregar bytes de fora da view.
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
    const pdf = await page.pdf({
      format: 'A4',
      // `printBackground: false` (o padrão do próprio Puppeteer) — de propósito
      // IGUAL ao "Imprimir → Salvar como PDF" do navegador, que por padrão NÃO
      // imprime cor de fundo (só quem marca "gráficos de segundo plano" no
      // diálogo vê a diferença). Com `true`, o MESMO HTML (gerarHtmlFatura,
      // fonte única) saía com o cabeçalho verde preenchido e selos coloridos
      // SÓ nesta rota (WhatsApp/e-mail/link) — nunca na impressão, que é o
      // layout de referência. Manter os dois padrões IDÊNTICOS é o que faz
      // "é o mesmo componente" ser verdade no resultado, não só no código.
      printBackground: false,
      margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
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
 * @param {(pct:number, etapa:string) => void} [p.onProgresso] — marcos REAIS do envio.
 *   Só é chamado onde algo de fato aconteceu (prontidão conferida, PDF pronto com o
 *   tamanho medido, mensagem aceita). Quem exibe a barra não inventa número nenhum:
 *   entre um marco e o seguinte ela simplesmente não anda. Ver §"progresso" abaixo.
 * @returns {Promise<{sucesso:boolean, erro?:string, simulado?:boolean, id?:string}>}
 */
async function enviarDocumentoWhatsApp({
  empresaId, equipeId = null, telefone, html, nomeArquivo, legenda = '', contexto = {},
  onProgresso = null,
}) {
  const marco = (pct, etapa) => { try { onProgresso?.(pct, etapa); } catch { /* nunca derruba o envio */ } };
  if (!empresaId)  return { sucesso: false, erro: 'SEM_EMPRESA' };
  if (!html)       return { sucesso: false, erro: 'SEM_CONTEUDO' };

  const para = foneIntl(telefone);
  if (!para) return { sucesso: false, erro: 'TELEFONE_AUSENTE' };

  const provider = getWhatsAppProvider();

  marco(15, 'Verificando o WhatsApp da clínica');
  // Checagem RÁPIDA antes do Puppeteer — ver WhatsAppProvider#prontidaoParaEnviar.
  // Sem ela, toda clínica sem instância conectada pagava o custo de gerar o PDF
  // (segundos) só para o envio falhar em seguida por outro motivo — e esse atraso
  // extra, somado ao do fallback manual do front, arriscava perder o gesto do
  // usuário que abriria o WhatsApp (window.open silenciosamente bloqueado).
  const prontidao = await provider.prontidaoParaEnviar({ empresaId, equipeId });
  if (!prontidao.pronto) {
    // O motivo VIAJA até a tela (e vai para o log): sem ele, "a clínica nunca
    // conectou", "a sessão caiu" e "a Evolution está fora do ar" chegavam ao
    // usuário como o mesmo silêncio.
    logger.warn(`[DocumentoWhatsApp] Envio não realizado (empresa ${empresaId}, equipe ${equipeId ?? '—'}): ${prontidao.motivo}`);
    return { sucesso: false, erro: prontidao.motivo ?? 'PROVIDER_INDISPONIVEL' };
  }

  marco(25, 'Gerando o PDF');
  let base64;
  try {
    const pdf = await htmlParaPdf(html);
    base64 = pdf.toString('base64');
    marco(70, `PDF pronto (${Math.max(1, Math.round(pdf.length / 1024))} KB)`);
  } catch (err) {
    logger.error(`[DocumentoWhatsApp] Falha ao gerar PDF (${nomeArquivo}): ${err.message}`);
    return { sucesso: false, erro: 'ERRO_PDF' };
  }

  marco(85, 'Enviando ao WhatsApp');
  const envio = await provider.enviarDocumento({
    para,
    arquivo: { base64, nome: nomeArquivo },
    legenda,
    contexto: { ...contexto, empresaId, equipeId },
  });
  if (envio.sucesso) marco(100, 'Enviado');
  return envio;
}

module.exports = { enviarDocumentoWhatsApp, htmlParaPdf, foneIntl };
