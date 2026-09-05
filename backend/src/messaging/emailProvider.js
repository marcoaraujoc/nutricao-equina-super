// backend/src/messaging/emailProvider.js
// Abstração de envio de e-mail — mesmo princípio do messaging/whatsappProvider.js
// e do StorageProvider: o restante da aplicação (emailService.js, AuthController)
// nunca fala diretamente com o transporte, só com este contrato.
//
// Trocar de provedor é MUDAR VARIÁVEL DE AMBIENTE, nunca código:
//
//   Brevo (SMTP, padrão recomendado — 300 e-mails/dia no plano gratuito)
//     EMAIL_HOST=smtp-relay.brevo.com
//     EMAIL_PORT=587
//     EMAIL_USER=<login SMTP do Brevo, algo como 9a1b2c001@smtp-brevo.com>
//     EMAIL_PASS=<SMTP key do Brevo>
//     EMAIL_FROM=contato@suaclinica.com.br     <- remetente verificado no Brevo
//
//   Gmail (legado)
//     EMAIL_HOST=smtp.gmail.com  EMAIL_PORT=587
//     EMAIL_USER=seu@gmail.com   EMAIL_PASS=<senha de app>
//     (EMAIL_FROM pode ser omitido — cai no EMAIL_USER, comportamento antigo)
//
//   Resend (HTTPS, sem SMTP)
//     npm install resend
//     EMAIL_PROVIDER=resend  RESEND_API_KEY=re_...  EMAIL_FROM=contato@suaclinica.com.br
//
// Formato de `opts` é o MESMO que nodemailer.sendMail já recebia
// (`{ from, to, subject, html, text?, attachments? }`) de propósito: foi o que
// permitiu trocar o transporte sem tocar em nenhum template.
'use strict';

const nodemailer = require('nodemailer');
const logger = require('../lib/logger');

// -- Remetente ----------------------------------------------------------------
//
// 🔴 `EMAIL_USER` É CREDENCIAL, NÃO REMETENTE. Com o Gmail os dois coincidiam
// (o login É o endereço), e por isso 19 pontos escreviam
// `from: "S2Vet" <${process.env.EMAIL_USER}>` direto. No Brevo o login SMTP é
// gerado por eles (`9a1b2c001@smtp-brevo.com`) e NÃO é um endereço de onde se
// possa enviar: usá-lo como remetente faz o e-mail sair com um "De:" que não
// existe — recusado pelo provedor, ou entregue e marcado como spam.
// Vale o mesmo para SES, Mailgun e SendGrid, que também separam as duas coisas.
//
// `EMAIL_FROM` ausente cai em `EMAIL_USER`: nenhuma instalação Gmail existente
// muda de comportamento ao subir esta versão.
const NOME_PADRAO = 'S2Vet';

/** Endereço de envio (só o e-mail, sem nome de exibição). */
function remetenteEmail() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
}

/**
 * Cabeçalho `From` completo — `"Nome" <endereco>`.
 * @param {string} [nome] sobrescreve o nome exibido (default: EMAIL_FROM_NAME ou "S2Vet").
 */
function remetente(nome) {
  const exibicao = nome || process.env.EMAIL_FROM_NAME || NOME_PADRAO;
  return `"${exibicao}" <${remetenteEmail()}>`;
}

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

/**
 * Provider padrão — SMTP via nodemailer. Serve Brevo, Gmail, SES, Mailgun e
 * qualquer outro SMTP: o que muda é só EMAIL_HOST/EMAIL_PORT/EMAIL_USER/EMAIL_PASS.
 */
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
      // ⚠️ `host` explícito, NUNCA `service: 'gmail'`: o atalho do nodemailer
      // IGNORA EMAIL_HOST e prende o envio ao Gmail. Era o que fazia o
      // "esqueci minha senha" (AuthController, que tinha transporter próprio)
      // continuar batendo no Gmail depois de trocar as credenciais para o Brevo,
      // falhando com "Invalid login" enquanto o resto do sistema enviava normal.
      this._transporter = nodemailer.createTransport({
        host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
        port:   Number(process.env.EMAIL_PORT) || 587,
        // 587 = STARTTLS (secure:false; o TLS sobe depois do EHLO). 465 = TLS
        // direto, e aí sim EMAIL_SECURE=true. Marcar secure na 587 trava a
        // conexão até estourar o timeout, sem erro que explique.
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
 * Provider Resend — HTTPS API, sem SMTP (passa pela 443, então não esbarra no
 * bloqueio das portas 25/465/587 que várias VPS aplicam por padrão).
 *
 * Para ativar:
 *   1. `cd backend && npm install resend`
 *   2. `.env`: EMAIL_PROVIDER=resend · RESEND_API_KEY=re_... · EMAIL_FROM=...
 *   3. verificar o domínio de `EMAIL_FROM` no painel do Resend (SPF + DKIM)
 * Nenhuma chamada em emailService.js muda — todas já passam por getEmailProvider().
 *
 * ⚠️ O `require('resend')` é LAZY (dentro do construtor, não no topo do arquivo):
 * sem isso, quem não instalou a dependência não conseguiria nem CARREGAR este
 * módulo — e ele é importado por emailService.js, que sustenta 2FA, boas-vindas e
 * reset de senha. O backend inteiro deixaria de subir por causa de um provider
 * que ninguém está usando.
 */
class ResendEmailProvider extends EmailProvider {
  constructor() {
    super();
    let Resend;
    try {
      ({ Resend } = require('resend'));
    } catch {
      throw new Error(
        'EMAIL_PROVIDER=resend mas a dependência "resend" não está instalada. '
        + 'Rode `npm install resend` no backend.',
      );
    }
    this._client = new Resend(process.env.RESEND_API_KEY);
  }

  estaConfigurado() {
    return !!process.env.RESEND_API_KEY;
  }

  async enviar({ from, to, subject, html, text, attachments }) {
    if (!this.estaConfigurado()) {
      const err = new Error('Envio de e-mail não configurado (RESEND_API_KEY ausente).');
      err.code = 'EMAIL_NAO_CONFIGURADO';
      throw err;
    }
    const { data, error } = await this._client.emails.send({
      from, to, subject, html, text,
      // O anexo do nodemailer é `{ filename, content, contentType? }`, com
      // `content` em Buffer/base64 — o Resend aceita o mesmo par, e é isso que faz
      // o PDF de prescrição/exame/fatura funcionar nos dois sem adaptação.
      attachments: attachments?.map(a => ({ filename: a.filename, content: a.content })),
    });
    if (error) {
      // Mesma FORMA de falha do nodemailer (que lança), para o caller não precisar
      // saber qual provider está ativo.
      const err = new Error(error.message || 'Falha no envio pelo Resend.');
      err.code = 'EMAIL_FALHA_PROVIDER';
      throw err;
    }
    return { sucesso: true, id: data?.id ?? null };
  }
}

let instancia = null;

/** Fábrica singleton — troca por EMAIL_PROVIDER (env), nunca hardcoded. */
function getEmailProvider() {
  if (instancia) return instancia;
  const tipo = String(process.env.EMAIL_PROVIDER || 'nodemailer').toLowerCase();
  switch (tipo) {
    case 'resend':
      try {
        instancia = new ResendEmailProvider();
      } catch (err) {
        // ⚠️ NÃO derruba o processo: cai no SMTP, que é o que a instalação já
        // tinha funcionando. Trocar de provider não pode custar o 2FA de todo
        // mundo por causa de um `npm install` esquecido no deploy.
        logger.error(`[Email] ${err.message} Usando nodemailer (SMTP).`);
        instancia = new NodemailerEmailProvider();
      }
      break;
    default:
      if (tipo !== 'nodemailer') {
        logger.warn(`[Email] Provider "${tipo}" não implementado — usando nodemailer.`);
      }
      instancia = new NodemailerEmailProvider();
  }
  return instancia;
}

/** Só para teste — descarta o singleton para a env ser relida. */
function _resetProvider() {
  instancia = null;
}

module.exports = {
  getEmailProvider, remetente, remetenteEmail,
  EmailProvider, NodemailerEmailProvider, ResendEmailProvider,
  _resetProvider,
};
