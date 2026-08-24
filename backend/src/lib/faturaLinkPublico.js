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
const { registrarAcessoPublico } = require('./auditoria');

const DIAS_VALIDADE       = 30;
const TAMANHO_TOKEN_BYTES = 48; // 48 bytes → 64 caracteres em base64url, sem padding
const MAX_TENTATIVAS_CRIACAO = 5; // colisão de token é ~impossível; isto é só o teto de segurança

// Backoff do REENVIO automático (services/faturaLinkCronService.js) — em ms,
// indexado por `tentativas` já feitas (0 = antes da 1ª tentativa nova). Depois
// da última posição, o link vira FALHOU_DEFINITIVO e o cron para de tentar.
const BACKOFF_REENVIO_MS = [10, 30, 120, 480].map(min => min * 60_000); // 10min,30min,2h,8h
const MAX_TENTATIVAS_ENVIO = BACKOFF_REENVIO_MS.length + 1; // 1ª tentativa (síncrona) + 4 reenvios

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
 *
 * ⚠️ `canal` e `destino` são OBRIGATÓRIOS: links sem eles não podem ser
 * reenviados pelo cron e viram linhas órfãs no banco. Se o destino será
 * decidido DEPOIS, passe null aqui e atualize com `UPDATE` ou `PATCH` antes
 * de tentar enviar.
 */
async function criarLink({ faturaId, empresaId, proprietarioId, midiaChave, criadoPorId, canal = null, destino = null }) {
  if (!canal || !destino) {
    throw new Error('Link público requer canal E destino (ex: WHATSAPP + número, EMAIL + e-mail).');
  }
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CRIACAO; tentativa++) {
    const token = gerarToken();
    try {
      const link = await prisma.faturaLinkPublico.create({
        data: {
          faturaId:       Number(faturaId),
          empresaId:      Number(empresaId),
          proprietarioId: Number(proprietarioId),
          token,
          midiaChave,
          expiraEm:    new Date(Date.now() + DIAS_VALIDADE * 86_400_000),
          criadoPorId: criadoPorId ?? null,
          canal,
          destino,
        },
      });
      const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
      // Caminho PLANO (sem "#") — ver routes/linkPublico.js. Alguns clientes de
      // mensagem/e-mail (sobretudo desktop) não linkificam `/#/rota` corretamente;
      // `/api/l/:token` redireciona para a SPA e funciona em qualquer lugar.
      return { id: link.id, token, url: `${appUrl}/api/l/${token}` };
    } catch (err) {
      if (err.code === 'P2002') continue; // colisão de token — tenta de novo
      throw err;
    }
  }
  throw new Error('Não foi possível gerar um link único para a fatura.');
}

/**
 * Grava o resultado de UMA tentativa de envio (a síncrona, feita na hora do
 * clique, ou uma das automáticas do cron de reenvio). Nunca lança — falha ao
 * gravar o resultado não pode derrubar quem chamou (o envio em si já aconteceu
 * ou já falhou; isto é só o registro).
 *
 * Se o link foi DELETADO/REVOGADO/EXPIRADO entre a tentativa de envio e o
 * registro, apenas loga o evento — não é erro de envio, é mudança de estado.
 *
 * Backoff fixo indexado por `tentativas` ANTES desta chamada (0-based): a 1ª
 * falha agenda para BACKOFF_REENVIO_MS[0], a 2ª para [1], etc. Esgotado o
 * array, o link vira FALHOU_DEFINITIVO e o cron para de considerá-lo.
 */
async function registrarEnvio(linkId, { sucesso, erro = null }) {
  try {
    if (sucesso) {
      await prisma.faturaLinkPublico.update({
        where: { id: Number(linkId) },
        data:  { status: 'ENVIADO', enviadoEm: new Date(), ultimoErro: null, proximaTentativaEm: null },
      }).catch(err => {
        if (err.code === 'P2025') {
          console.info(`[faturaLinkPublico] Link ${linkId} foi deletado/revogado entre o envio e o registro — ignorado.`);
          return;
        }
        throw err;
      });
      return;
    }

    const atual = await prisma.faturaLinkPublico.findUnique({
      where:  { id: Number(linkId) },
      select: { tentativas: true },
    });

    // Link foi deletado/revogado/expirou entre a tentativa de envio e agora.
    if (!atual) {
      console.info(`[faturaLinkPublico] Link ${linkId} não encontrado ao registrar falha — foi deletado/revogado/expirou.`);
      return;
    }

    const tentativasFeitas = atual.tentativas ?? 0;
    const proximoBackoff   = BACKOFF_REENVIO_MS[tentativasFeitas];

    await prisma.faturaLinkPublico.update({
      where: { id: Number(linkId) },
      data: {
        tentativas:         { increment: 1 },
        ultimoErro:         String(erro ?? 'Falha desconhecida').slice(0, 300),
        status:             proximoBackoff ? 'FALHOU' : 'FALHOU_DEFINITIVO',
        proximaTentativaEm: proximoBackoff ? new Date(Date.now() + proximoBackoff) : null,
      },
    });
  } catch (err) {
    console.warn('[faturaLinkPublico] falha ao registrar resultado do envio:', err.message);
  }
}

/** Revoga um link ativo — distinto de expirar: some imediatamente, não em 30 dias. */
async function revogar(linkId, revogadoPorId) {
  return prisma.faturaLinkPublico.update({
    where: { id: Number(linkId) },
    data:  { revogadoEm: new Date(), revogadoPorId: revogadoPorId ?? null },
  });
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Valida o formato, busca o link e checa expiração/revogação — a MESMA sequência
 * que `abrirLink` (serve o PDF) e `obterResumo` (dados da página) precisam antes
 * de fazer qualquer coisa com o link. Roda DENTRO de `comEscopoPlataforma`: sem
 * sessão/tenant no contexto, é o único jeito de achar a linha pelo token.
 *
 * @returns {Promise<{ ok:true, link:object } | { ok:false, status:number, corpo:object }>}
 */
async function resolverToken(token) {
  if (!TOKEN_RE.test(String(token ?? ''))) {
    return { ok: false, status: 404, corpo: { mensagem: 'Link não encontrado.' } };
  }

  return comEscopoPlataforma(async () => {
    const link = await prisma.faturaLinkPublico.findUnique({ where: { token: String(token) } });
    if (!link) return { ok: false, status: 404, corpo: { mensagem: 'Link não encontrado.' } };

    if (link.revogadoEm) {
      return { ok: false, status: 410, corpo: { mensagem: 'Este link foi revogado pela clínica. Peça um novo.', revogado: true } };
    }
    if (link.expiraEm.getTime() < Date.now()) {
      return { ok: false, status: 410, corpo: { mensagem: 'Este link expirou. Peça um novo à clínica.', expirado: true } };
    }
    return { ok: true, link };
  });
}

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
  const resolvido = await resolverToken(token);
  if (!resolvido.ok) return { status: resolvido.status, corpo: resolvido.corpo };
  const { link } = resolvido;

  return comEscopoPlataforma(async () => {
    const midia = await prisma.midiaArquivo.findUnique({
      where:  { chave: link.midiaChave },
      select: { id: true, mimeType: true, nomeOriginal: true, tamanho: true, publico: true },
    });
    if (!midia) return { status: 404, corpo: { mensagem: 'Arquivo da fatura não encontrado.' } };

    await enviarArquivo(req, res, midia);
    return { jaRespondido: true };
  });
}

/**
 * Resumo estruturado da fatura para o CABEÇALHO da página pública (nome da
 * clínica, cliente, animal, status, total) — chamado UMA VEZ por visita, ANTES
 * do PDF. É este ponto, não `abrirLink`, que conta como "a fatura foi acessada":
 * incrementa `qtdAcessos`/`ultimoAcessoEm` e grava a trilha `ACESSO_PUBLICO`.
 *
 * @returns {Promise<{ ok:true, dados:object } | { ok:false, status:number, corpo:object }>}
 */
async function obterResumo({ token, ip = null }) {
  const resolvido = await resolverToken(token);
  if (!resolvido.ok) return { ok: false, status: resolvido.status, corpo: resolvido.corpo };
  const { link } = resolvido;

  return comEscopoPlataforma(async () => {
    const fatura = await prisma.fatura.findUnique({
      where:  { id: link.faturaId },
      select: {
        id: true, mesReferencia: true, total: true, status: true, criadoEm: true,
        empresaId: true,
        proprietario: { select: { fullName: true } },
        animal:       { select: { nome: true } },
        itens:        { select: { animal: { select: { nome: true } } }, take: 20 },
      },
    });
    if (!fatura) return { ok: false, status: 404, corpo: { mensagem: 'Fatura não encontrada.' } };

    // Fatura.empresaId é SEM FK de propósito (sobrevive à exclusão da empresa —
    // mesmo critério de EvolucaoClinica/AgendamentoClinico), então não há
    // relação Prisma para incluir — busca à parte, tolera empresa já excluída.
    const empresa = await prisma.empresa.findUnique({
      where:  { id: fatura.empresaId },
      select: { nome: true },
    }).catch(() => null);

    const animaisNomes = [...new Set(
      [fatura.animal?.nome, ...fatura.itens.map(i => i.animal?.nome)].filter(Boolean),
    )];

    // Fire-and-forget: nunca atrasa nem derruba a resposta ao cliente.
    prisma.faturaLinkPublico.update({
      where: { id: link.id },
      data:  { qtdAcessos: { increment: 1 }, ultimoAcessoEm: new Date() },
    }).catch(err => console.warn('[faturaLinkPublico] falha ao contar acesso:', err.message));
    registrarAcessoPublico({ entidade: 'FATURA_LINK', entidadeId: fatura.id, empresaId: fatura.empresaId, ip });

    return {
      ok: true,
      dados: {
        faturaId:      fatura.id,
        clinica:       empresa?.nome ?? 'Clínica',
        cliente:       fatura.proprietario?.fullName ?? null,
        animais:       animaisNomes,
        mesReferencia: fatura.mesReferencia,
        status:        fatura.status,
        total:         fatura.total,
        criadoEm:      fatura.criadoEm,
      },
    };
  });
}

module.exports = { criarLink, abrirLink, obterResumo, registrarEnvio, revogar, MAX_TENTATIVAS_ENVIO };
