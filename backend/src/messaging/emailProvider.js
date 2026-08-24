// backend/src/messaging/emailProvider.js
// Abstração de envio de e-mail — mesmo princípio do messaging/whatsappProvider.js
// e do StorageProvider: o restante da aplicação (emailService.js) nunca fala
// diretamente com o transporte, só com este contrato. Hoje só o
// NodemailerEmailProvider está implementado (SMTP do Gmail, já configurado via
// EMAIL_HOST/EMAIL_USER/EMAIL_PASS). Quando houver conta/API key do Resend (ou
// outro provedor HTTPS), a troca é: implementar a classe abaixo (comentada) e
// mudar EMAIL_PROVIDER — nenhum método de emailService.js muda.
//
// Formato de `opts` é o MESMO que nodemailer.sendMail já recebe em todo
// emailService.js (`{ from, to, subject, html, text?, attachments? }`) de propósito:
// a troca de `createTransporter().sendMail(...)` por `getEmailProvider().enviar(...)`
// foi feita como find/replace mecânico, sem tocar em nenhum template/payload — o
// mesmo formato também é aceito, com pouca adaptação, por APIs como a do Resend.
'use strict';

const nodemailer = require('nodemailer');
const logger = require('../lib/logger');

/** Contrato que todo provider deve implementar. */
class EmailProvider {
  /**
   * @param {{ from:string, to:string, subject:string, html?:string, text?:string,
   *           attachments?:Array }} opts — mesmo shape de nodemailer.sendMail
   * @returns {Promise<{ sucesso:boolean, id?:string, erro?:string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async enviar(opts) {
    throw new Error('EmailProvider.enviar não implementado');
  }

  /** Checagem síncrona e barata — "dá para enviar e-mail agora?" (sem rede). */
  estaConfigurado() {
    return false;
  }
}

/** Provider padrão — SMTP via nodemailer (hoje: Gmail, EMAIL_HOST/EMAIL_USER/EMAIL_PASS). */
class NodemailerEmailProvider extends EmailProvider {
  constructor() {
    super();
    this._transporter = null;
  }

  estaConfigurado() {
    return !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
  }

  _transportador() {
    if (!this._transporter) {
      this._transporter = nodemailer.createTransport({
        host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
        port:   Number(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    }
    return this._transporter;
  }

  async enviar(opts) {
    if (!this.estaConfigurado()) {
      const err = new Error('Envio de e-mail não configurado (EMAIL_USER/EMAIL_PASS ausentes).');
      err.code = 'EMAIL_NAO_CONFIGURADO';
      throw err;
    }
    const info = await this._transportador().sendMail(opts);
    return { sucesso: true, id: info?.messageId ?? null };
  }
}

/**
 * Provider Resend — HTTPS API, sem SMTP próprio. NÃO instalado ainda (falta a
 * dependência `resend` no package.json e a conta/API key/domínio verificado).
 * Quando for ativado:
 *   1. `npm install resend` no backend;
 *   2. descomentar a classe abaixo;
 *   3. `RESEND_API_KEY=...` no .env;
 *   4. `EMAIL_PROVIDER=resend`.
 * Nenhuma chamada em emailService.js muda — todas já passam por getEmailProvider().
 */
// class ResendEmailProvider extends EmailProvider {
//   constructor() {
//     super();
//     const { Resend } = require('resend');
//     this._client = new Resend(process.env.RESEND_API_KEY);
//   }
//   estaConfigurado() {
//     return !!process.env.RESEND_API_KEY;
//   }
//   async enviar({ from, to, subject, html, text, attachments }) {
//     const { data, error } = await this._client.emails.send({
//       from, to, subject, html, text,
//       attachments: attachments?.map(a => ({ filename: a.filename, content: a.content })),
//     });
//     if (error) return { sucesso: false, erro: error.message };
//     return { sucesso: true, id: data?.id ?? null };
//   }
// }

let instancia = null;

/** Fábrica singleton — troca por EMAIL_PROVIDER (env), nunca hardcoded. */
function getEmailProvider() {
  if (instancia) return instancia;
  const tipo = String(process.env.EMAIL_PROVIDER || 'nodemailer').toLowerCase();
  switch (tipo) {
    // case 'resend': instancia = new ResendEmailProvider(); break;
    default:
      if (tipo !== 'nodemailer') {
        logger.warn(`[Email] Provider "${tipo}" não implementado — usando nodemailer.`);
      }
      instancia = new NodemailerEmailProvider();
  }
  return instancia;
}

module.exports = { getEmailProvider, EmailProvider, NodemailerEmailProvider };
