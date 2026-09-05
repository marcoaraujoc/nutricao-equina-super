// backend/src/controllers/DocumentoCompartilharController.js
// Componente reutilizável de envio de documento (HTML → PDF) por WhatsApp e e-mail.
// Qualquer tela que já monte o HTML de impressão do que quer mandar (mesmo
// gerador usado pelo botão "Imprimir") chama aqui — não duplique geração de PDF
// nem chamada de provider. PDF sempre pelo Puppeteer (documentoWhatsappService),
// nunca por captura de tela no navegador: texto selecionável, sem artefato de
// compressão, sem risco de CORS estourar num screenshot em branco.
'use strict';

const { enviarDocumentoWhatsApp, htmlParaPdf } = require('../services/documentoWhatsappService');
const emailService = require('../services/emailService');
const logger = require('../lib/logger');

/**
 * Motivo LEGÍVEL para a tela. O front só sabe que não deu — e, sem uma frase, o
 * usuário via apenas "PDF baixado, anexe na conversa" com o WhatsApp da clínica
 * conectado, sem nada que explicasse por quê (nem no log do backend). Cada código
 * abaixo pede uma AÇÃO diferente de quem está na frente da tela, então eles não
 * podem colapsar numa mensagem só.
 */
const MOTIVO_WHATSAPP = {
  NAO_PROVISIONADO:      'a clínica ainda não tem WhatsApp configurado (Configurações › WhatsApp).',
  DESCONECTADO:          'o WhatsApp da clínica está desconectado — leia o QR Code em Configurações.',
  AGUARDANDO_QR:         'o WhatsApp da clínica está aguardando a leitura do QR Code.',
  SERVIDOR_INDISPONIVEL: 'o servidor de WhatsApp não respondeu.',
  SEM_EMPRESA:           'não há empresa no contexto ativo.',
  TELEFONE_AUSENTE:      'o cliente está sem telefone cadastrado.',
  TELEFONE_INVALIDO:     'o telefone do cliente é inválido.',
  WHATSAPP_NAO_PROVISIONADO:      'a clínica ainda não tem WhatsApp configurado (Configurações › WhatsApp).',
  WHATSAPP_DESCONECTADO:          'o WhatsApp da clínica está desconectado — leia o QR Code em Configurações.',
  WHATSAPP_SERVIDOR_INDISPONIVEL: 'o servidor de WhatsApp não respondeu.',
  EVOLUTION_INDISPONIVEL:         'o servidor de WhatsApp recusou o envio.',
  INSTANCIA_NAO_ENCONTRADA:       'a instância de WhatsApp da clínica não existe mais no servidor.',
  ARQUIVO_VAZIO:         'o PDF saiu vazio.',
  CLINICA_NAO_ENCONTRADA: 'a clínica do contexto não foi encontrada.',
};
const motivoLegivel = (codigo) => MOTIVO_WHATSAPP[codigo] ?? 'o envio pelo WhatsApp da clínica falhou.';

/**
 * PROGRESSO EM TEMPO REAL — NDJSON, uma linha por marco.
 *
 * O envio é uma requisição só que leva ~7s (Puppeteer sobe um Chromium e a
 * Evolution ainda faz o upload da mídia), e o cliente não tinha NENHUM sinal no
 * meio: ou o botão ficava girando, ou a barra teria de ser preenchida por
 * estimativa de relógio — número inventado, que é o que este projeto não faz.
 * Com o streaming, cada avanço da barra corresponde a um fato que ACONTECEU aqui.
 *
 * Só entra em modo streaming quando o cliente pede (`Accept: application/x-ndjson`).
 * Sem isso a resposta é o JSON único de sempre — o contrato antigo continua
 * valendo para qualquer outro consumidor.
 *
 * ⚠️ O status HTTP é enviado com o PRIMEIRO chunk e não pode mais ser trocado: por
 * isso o streaming responde SEMPRE 200, e quem carrega o veredito é a linha final
 * (`tipo: 'fim'`). O cliente lê o resultado de lá, nunca do código HTTP.
 * ⚠️ `flushHeaders()` é obrigatório: sem ele o Node segura os primeiros bytes no
 * buffer e todos os marcos chegam juntos, no fim — uma barra que salta de 0 a 100
 * é pior que barra nenhuma, porque promete um acompanhamento que não existe.
 */
function querStream(req) {
  return String(req.headers.accept ?? '').includes('application/x-ndjson');
}

/**
 * "O cliente desistiu?" — o botão Cancelar da barra aborta a requisição, e é aqui
 * que o servidor fica sabendo. Sem isto o cancelamento seria só de fachada: o front
 * pararia de esperar, o Chromium continuaria gerando o PDF e a mensagem sairia
 * mesmo assim, com a tela dizendo "cancelado".
 * ⚠️ `close` no request dispara TAMBÉM no fim normal da resposta; o que separa
 * "acabou" de "abortou" é `res.writableEnded`. Sem essa checagem, todo envio
 * bem-sucedido seria marcado como cancelado no final.
 */
function detectorDeDesistencia(req, res) {
  let saiu = false;
  req.on('close', () => { if (!res.writableEnded) saiu = true; });
  return () => saiu;
}

function abrirStream(res) {
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx/proxy não pode bufferizar o stream
  res.flushHeaders?.();
  const linha = (obj) => { res.write(JSON.stringify(obj) + '\n'); res.flush?.(); };
  return {
    progresso: (pct, etapa) => linha({ tipo: 'progresso', pct, etapa }),
    fim:       (payload)    => { linha({ tipo: 'fim', ...payload }); res.end(); },
  };
}

const DocumentoCompartilharController = {

  /**
   * POST /api/documentos/compartilhar/whatsapp
   * Body: { telefone, html, nomeArquivo, legenda? }
   * `sucesso:false, code:'PROVIDER_INDISPONIVEL'` → clínica sem WhatsApp
   * provisionado/conectado: o front cai no fallback manual (baixar + abrir o app).
   */
  async whatsapp(req, res) {
    const { telefone, html, nomeArquivo, legenda } = req.body;
    if (!telefone) return res.status(400).json({ sucesso: false, error: 'Informe o telefone.' });
    if (!html || !nomeArquivo) {
      return res.status(400).json({ sucesso: false, error: 'html e nomeArquivo são obrigatórios.' });
    }
    if (!req.empresaId) {
      return res.status(400).json({ sucesso: false, error: 'Sem empresa no contexto.', code: 'SEM_EMPRESA' });
    }

    const stream = querStream(req) ? abrirStream(res) : null;
    const desistiu = detectorDeDesistencia(req, res);
    stream?.progresso(5, 'Preparando o envio');

    try {
      const r = await enviarDocumentoWhatsApp({
        empresaId: req.empresaId,
        equipeId:  req.equipeId ?? null,
        telefone,
        html,
        nomeArquivo,
        legenda: legenda ?? '',
        contexto: { userId: req.user?.id },
        onProgresso: stream ? stream.progresso : null,
        cancelado:   desistiu,
      });
      // Cancelado = o cliente já foi embora; não há a quem responder, e escrever num
      // socket fechado só produziria ruído de erro no log.
      if (r.erro === 'CANCELADO') {
        logger.info(`[DocumentoCompartilhar] Envio cancelado pelo usuário (empresa ${req.empresaId}, ${nomeArquivo}).`);
        return;
      }
      if (!r.sucesso) {
        // ERRO_PDF é bug nosso (500); os demais (SEM_EMPRESA/TELEFONE_AUSENTE/falha
        // do provider) são "não dá para mandar assim" — o front decide o fallback.
        const status = r.erro === 'ERRO_PDF' ? 500 : 200;
        logger.warn(`[DocumentoCompartilhar] WhatsApp não enviado (empresa ${req.empresaId}, ${nomeArquivo}): ${r.erro}`);
        const corpo = {
          sucesso: false, error: r.erro, code: r.erro ?? 'PROVIDER_INDISPONIVEL',
          motivo: motivoLegivel(r.erro),
        };
        if (stream) return stream.fim(corpo);
        return res.status(status).json(corpo);
      }
      if (stream) return stream.fim({ sucesso: true, simulado: !!r.simulado });
      return res.json({ sucesso: true, simulado: !!r.simulado });
    } catch (err) {
      logger.error(`[DocumentoCompartilhar] Falha ao enviar WhatsApp: ${err.message}`);
      const corpo = { sucesso: false, error: 'Erro ao enviar pelo WhatsApp.', motivo: 'houve um erro no servidor ao enviar.' };
      if (stream) return stream.fim(corpo);
      return res.status(500).json(corpo);
    }
  },

  /**
   * POST /api/documentos/compartilhar/email
   * Body: { email, assunto, corpo, html, nomeArquivo }
   * `sucesso:false, code:'EMAIL_NAO_CONFIGURADO'` → servidor sem SMTP configurado:
   * o front cai no fallback manual (baixar + abrir o cliente de e-mail).
   */
  async email(req, res) {
    const { email, assunto, corpo, html, nomeArquivo } = req.body;
    if (!email)    return res.status(400).json({ sucesso: false, error: 'Informe o e-mail de destino.' });
    if (!html || !nomeArquivo) {
      return res.status(400).json({ sucesso: false, error: 'html e nomeArquivo são obrigatórios.' });
    }
    // Checagem RÁPIDA antes do Puppeteer — sem SMTP configurado não há como
    // enviar, e gerar o PDF à toa custa segundos (mesmo motivo do lado do
    // WhatsApp — ver documentoWhatsappService.js).
    const semSmtp = {
      sucesso: false, error: 'Envio de e-mail não configurado.', code: 'EMAIL_NAO_CONFIGURADO',
      motivo: 'o servidor de e-mail da aplicação não está configurado.',
    };
    // A checagem vem ANTES de abrir o stream: sem SMTP não há envio nenhum a
    // acompanhar, e uma barra que nasce e morre no mesmo instante é ruído.
    if (!emailService.estaConfigurado()) return res.status(200).json(semSmtp);

    const stream = querStream(req) ? abrirStream(res) : null;
    stream?.progresso(5, 'Preparando o envio');
    stream?.progresso(25, 'Gerando o PDF');

    let pdfBase64;
    try {
      const pdf = await htmlParaPdf(html);
      pdfBase64 = pdf.toString('base64');
      stream?.progresso(70, `PDF pronto (${Math.max(1, Math.round(pdf.length / 1024))} KB)`);
    } catch (err) {
      logger.error(`[DocumentoCompartilhar] Falha ao gerar PDF (${nomeArquivo}): ${err.message}`);
      const falhaPdf = { sucesso: false, error: 'Erro ao gerar o PDF.', motivo: 'não foi possível gerar o PDF.' };
      if (stream) return stream.fim(falhaPdf);
      return res.status(500).json(falhaPdf);
    }

    try {
      stream?.progresso(85, 'Enviando o e-mail');
      await emailService.enviarDocumento({
        emailDestinatario: email,
        assunto: assunto || nomeArquivo,
        corpo:   corpo || '',
        nomeArquivo,
        pdfBase64,
      });
      stream?.progresso(100, 'Enviado');
      if (stream) return stream.fim({ sucesso: true });
      return res.json({ sucesso: true });
    } catch (err) {
      if (err.code === 'EMAIL_NAO_CONFIGURADO') {
        if (stream) return stream.fim(semSmtp);
        return res.status(200).json(semSmtp);
      }
      logger.error(`[DocumentoCompartilhar] Falha ao enviar e-mail: ${err.message}`);
      const falha = { sucesso: false, error: 'Erro ao enviar o e-mail.', motivo: 'houve um erro no servidor ao enviar o e-mail.' };
      if (stream) return stream.fim(falha);
      return res.status(500).json(falha);
    }
  },

  /**
   * POST /api/documentos/pdf
   * Body: { html, nomeArquivo? }
   * Só GERA o PDF (mesmo pipeline do Puppeteer usado no envio real — texto
   * selecionável, paginação nativa do Chrome via `page.pdf()`) e devolve o
   * binário. Usado pelo fallback manual do front (utils/compartilharPdf.ts)
   * quando não há envio real disponível: preferir SEMPRE este caminho a gerar o
   * PDF por captura de tela no navegador, que é mais frágil.
   */
  async pdf(req, res) {
    const { html, nomeArquivo } = req.body;
    if (!html) return res.status(400).json({ error: 'html é obrigatório.' });

    try {
      const pdf = await htmlParaPdf(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${String(nomeArquivo || 'documento.pdf').replace(/[^\w.-]/g, '_')}"`);
      return res.send(pdf);
    } catch (err) {
      logger.error(`[DocumentoCompartilhar] Falha ao gerar PDF avulso (${nomeArquivo}): ${err.message}`);
      return res.status(500).json({ error: 'Erro ao gerar o PDF.' });
    }
  },
};

module.exports = DocumentoCompartilharController;
