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

    try {
      const r = await enviarDocumentoWhatsApp({
        empresaId: req.empresaId,
        equipeId:  req.equipeId ?? null,
        telefone,
        html,
        nomeArquivo,
        legenda: legenda ?? '',
        contexto: { userId: req.user?.id },
      });
      if (!r.sucesso) {
        // ERRO_PDF é bug nosso (500); os demais (SEM_EMPRESA/TELEFONE_AUSENTE/falha
        // do provider) são "não dá para mandar assim" — o front decide o fallback.
        const status = r.erro === 'ERRO_PDF' ? 500 : 200;
        return res.status(status).json({ sucesso: false, error: r.erro, code: 'PROVIDER_INDISPONIVEL' });
      }
      return res.json({ sucesso: true, simulado: !!r.simulado });
    } catch (err) {
      logger.error(`[DocumentoCompartilhar] Falha ao enviar WhatsApp: ${err.message}`);
      return res.status(500).json({ sucesso: false, error: 'Erro ao enviar pelo WhatsApp.' });
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

    let pdfBase64;
    try {
      pdfBase64 = (await htmlParaPdf(html)).toString('base64');
    } catch (err) {
      logger.error(`[DocumentoCompartilhar] Falha ao gerar PDF (${nomeArquivo}): ${err.message}`);
      return res.status(500).json({ sucesso: false, error: 'Erro ao gerar o PDF.' });
    }

    try {
      await emailService.enviarDocumento({
        emailDestinatario: email,
        assunto: assunto || nomeArquivo,
        corpo:   corpo || '',
        nomeArquivo,
        pdfBase64,
      });
      return res.json({ sucesso: true });
    } catch (err) {
      if (err.code === 'EMAIL_NAO_CONFIGURADO') {
        return res.status(200).json({ sucesso: false, error: err.message, code: err.code });
      }
      logger.error(`[DocumentoCompartilhar] Falha ao enviar e-mail: ${err.message}`);
      return res.status(500).json({ sucesso: false, error: 'Erro ao enviar o e-mail.' });
    }
  },
};

module.exports = DocumentoCompartilharController;
