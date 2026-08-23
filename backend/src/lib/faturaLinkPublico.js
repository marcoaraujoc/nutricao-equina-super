// backend/src/lib/faturaLinkPublico.js
//
// Link público de fatura — envio por WhatsApp/e-mail passa a mandar um LINK
// para abrir o PDF (já salvo no storage), não o arquivo anexado. Pedido do
// usuário (2026-09-10): o PDF em anexo dependia do Puppeteer + upload à
// Evolution TERMINAREM dentro da janela de espera do cliente (ver
// utils/compartilharPdf.ts no frontend); o link é gerado UMA VEZ pelo servidor
// e a mensagem em si é só texto — rápida e sem esse acoplamento.
//
// SEGURANÇA — capability URL "pura" (decisão do usuário em 2026-09-11,
// revertendo uma camada de código de acesso de 4 caracteres que existiu por
// um instante): não há segundo fator para abrir o link, então toda a
// segurança está no TOKEN em si. Por isso ele é 64 caracteres sorteados do
// alfabeto base64url (`A-Za-z0-9-_`) — 384 bits de entropia, e é o ÚNICO
// identificador na URL pública (`/#/fatura/:token`): sem `faturaId`/
// `proprietarioId` na rota, então não existe "troca um caractere e vê a
// fatura de outro" — não há nada de menor para adivinhar.
//
// ⚠️ `#` ficou de fora do alfabeto de propósito, mesmo pedido pelo usuário
// junto com `-`/`_`: este app usa HashRouter (`/#/rota`) — um `#` DENTRO do
// token quebraria o roteamento no PRÓPRIO navegador antes de qualquer
// requisição sair (só o primeiro `#` de uma URL inicia o fragmento; um
// segundo dentro do token vira parte do "path" que o HashRouter tenta
// casar, terreno não testado e arriscado). `-`/`_` são seguros em URL e
// entraram normalmente.
//
// MULTI-TENANT: a leitura pública (sem sessão, sem `req.empresaId`) roda em
// ESCOPO DE PLATAFORMA (`comEscopoPlataforma`) — mesmo mecanismo do
// `registrarAcessoNegado` de login/2FA (CLAUDE.md, sessão 2026-08-22). A
// policy de `tb_fatura_links_publicos` é fail-closed: sem esse escopo, a
// leitura pelo token não enxergaria NADA.
'use strict';

const crypto = require('crypto');
const prisma = require('./prisma').default;
const { comEscopoPlataforma } = require('./prismaTenant');
const { enviarArquivo } = require('./midiaEnvio');

const DIAS_VALIDADE       = 30;
const TAMANHO_TOKEN_BYTES = 48; // 48 bytes → 64 caracteres em base64url, sem padding
const MAX_TENTATIVAS_CRIACAO = 5; // colisão de token é ~impossível; isto é só o teto de segurança

function gerarToken() {
  // base64url = exatamente o alfabeto A-Za-z0-9-_ que foi pedido.
  return crypto.randomBytes(TAMANHO_TOKEN_BYTES).toString('base64url');
}

/**
 * Cria o link público para um PDF JÁ SALVO no storage (`midiaChave` = chave em
 * `tb_midia_arquivos`, devolvida por `storage.upload()`). Roda dentro do
 * contexto AUTENTICADO de quem está enviando a fatura (vet/gestor) — o tenant
 * já está carimbado pelo middleware normal, nada de escopo especial aqui.
 *
 * Re-sorteia o token em caso de colisão (P2002 do `@unique`) — praticamente
 * nunca deve acontecer com 384 bits de entropia, mas "nunca um igual ao
 * outro" é tratado como garantia, não como probabilidade.
 */
async function criarLink({ faturaId, empresaId, proprietarioId, midiaChave, criadoPorId }) {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CRIACAO; tentativa++) {
    const token = gerarToken();
    try {
      await prisma.faturaLinkPublico.create({
        data: {
          faturaId:       Number(faturaId),
          empresaId:      Number(empresaId),
          proprietarioId: Number(proprietarioId),
          token,
          midiaChave,
          expiraEm:    new Date(Date.now() + DIAS_VALIDADE * 86_400_000),
          criadoPorId: criadoPorId ?? null,
        },
      });
      const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
      return { token, url: `${appUrl}/#/fatura/${token}` };
    } catch (err) {
      if (err.code === 'P2002') continue; // colisão de token — tenta de novo
      throw err;
    }
  }
  throw new Error('Não foi possível gerar um link único para a fatura.');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Resolve o token e ESCREVE o PDF direto na resposta (`enviarArquivo`) — é
 * por isso que recebe `req`/`res`: não há passo intermediário que devolva o
 * PDF como JSON/base64, o corpo da resposta HTTP de sucesso JÁ É o arquivo.
 *
 * @returns {Promise<{ jaRespondido: true } | { status: number, corpo: object }>}
 *   `jaRespondido` quando o PDF foi escrito na resposta (sucesso); senão, quem
 *   chama faz `res.status(status).json(corpo)`.
 */
async function abrirLink({ req, res, token }) {
  if (!TOKEN_RE.test(String(token ?? ''))) return { status: 404, corpo: { mensagem: 'Link não encontrado.' } };

  return comEscopoPlataforma(async () => {
    const link = await prisma.faturaLinkPublico.findUnique({ where: { token: String(token) } });
    if (!link) return { status: 404, corpo: { mensagem: 'Link não encontrado.' } };
    if (link.expiraEm.getTime() < Date.now()) {
      return { status: 410, corpo: { mensagem: 'Este link expirou. Peça um novo à clínica.', expirado: true } };
    }

    const midia = await prisma.midiaArquivo.findUnique({
      where:  { chave: link.midiaChave },
      select: { id: true, mimeType: true, nomeOriginal: true, tamanho: true, publico: true },
    });
    if (!midia) return { status: 404, corpo: { mensagem: 'Arquivo da fatura não encontrado.' } };

    await enviarArquivo(req, res, midia);
    return { jaRespondido: true };
  });
}

module.exports = { criarLink, abrirLink };
