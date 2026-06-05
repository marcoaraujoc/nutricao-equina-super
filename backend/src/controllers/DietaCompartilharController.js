'use strict';

const emailService = require('../services/emailService');

const DietaCompartilharController = {

  /**
   * POST /api/dietas/compartilhar
   * Body: { emailDestinatario, nomeProprietario, nomeAnimal, planoNome, pdfBase64 }
   */
  async compartilhar(req, res) {
    const { emailDestinatario, nomeProprietario, nomeAnimal, planoNome, pdfBase64 } = req.body;

    if (!emailDestinatario || !pdfBase64) {
      return res.status(400).json({ sucesso: false, mensagem: 'emailDestinatario e pdfBase64 são obrigatórios' });
    }

    try {
      await emailService.enviarDieta({
        emailDestinatario,
        nomeProprietario: nomeProprietario || 'Proprietário',
        nomeAnimal,
        planoNome,
        pdfBase64,
      });

      return res.json({ sucesso: true, mensagem: 'E-mail enviado com sucesso' });
    } catch (error) {
      console.error('[DietaCompartilhar] Erro ao enviar e-mail:', error);
      return res.status(500).json({ sucesso: false, mensagem: 'Erro ao enviar e-mail' });
    }
  },
};

module.exports = DietaCompartilharController;
