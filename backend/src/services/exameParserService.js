// backend/src/services/exameParserService.js
'use strict';

const fs       = require('fs');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const { MODULOS_IA } = require('../ai');
const { buildPrompt } = require('../ai/prompts');
const { gerarConteudo, PROVEDOR } = require('../ai/geminiClient');
const { logAiUsage } = require('./aiLogger.service');
// Gate de quota — chamado direto porque este arquivo não passa mais por `callAI`
// (que é texto-puro) para o laudo Laboratorial/Bioquímico: a chamada virou
// MULTIMODAL (documento anexado + texto), então usa `gerarConteudo` como o
// laudo de Imagem já usava. `callAI` continua sendo a única porta para operações
// de texto puro do resto do sistema.
const { garantirQuota } = require('./iaQuotaService');

// =====================================================================
// EXTRAÇÃO DE TEXTO — PDF, DOCX, TXT
// =====================================================================

async function extrairTextoPDF(fileBuffer) {
  const data = await pdfParse(fileBuffer);
  return data.text || '';
}

/** .docx (Office Open XML) — mammoth lê o XML zipado e devolve o texto corrido.
 *  Não cobre .doc (binário OLE antigo, formato bem mais complicado de extrair) —
 *  rejeitado antes daqui, no `fileFilter` da rota. */
async function extrairTextoDocx(fileBuffer) {
  const { value } = await mammoth.extractRawText({ buffer: fileBuffer });
  return value || '';
}

const MIME_TXT  = 'text/plain';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC  = 'application/msword';

/**
 * Formato aceito no upload (fileFilter da rota já libera .doc) mas sem NENHUM
 * caminho de leitura — nem texto (binário OLE antigo, sem lib madura no
 * projeto) nem visão (Gemini não entende `.doc` como inlineData). O arquivo
 * ainda assim é armazenado normalmente (o upload/anexo é um loop À PARTE desta
 * extração, em `salvarResultado`/`criarNaoPedido`) — só não tem prévia
 * automática. Controllers capturam pelo `code` para avisar o usuário em vez de
 * logar como falha de IA.
 */
class ArquivoSemTranscricaoError extends Error {
  constructor(nomeArquivo) {
    super(`O arquivo "${nomeArquivo}" não é suportado para ser interpretado, ele será somente salvo no resultado. Os formatos suportados para leitura automática são PDF, DOCX, TXT ou imagem.`);
    this.code = 'FORMATO_SEM_TRANSCRICAO';
  }
}

/**
 * @param {Buffer} fileBuffer  — conteúdo do arquivo já em memória
 * @param {number} [userId]    — id do usuário que disparou a ação (para log)
 * @param {number} [animalId]  — id do animal relacionado (para log)
 * @param {number} [empresaId] — empresa do contexto (quota + log)
 * @param {string} [mimetype]  — mime type do arquivo. Decide COMO extrair texto
 *   (PDF via pdf-parse, .docx via mammoth, .txt lido direto) e se o arquivo
 *   também vai ANEXADO à IA como imagem/documento (PDF e foto) — é o anexo, não
 *   o texto, que permite reconhecer a LOGOMARCA do laboratório. .docx/.txt não
 *   têm essa camada visual (não há o que a IA "veja" ali), então vão SÓ como
 *   texto — mandar os bytes crus como anexo nem funcionaria: o Gemini só aceita
 *   inlineData nos mimeTypes de mídia que conhece (imagem/PDF/áudio/vídeo).
 * @param {string} [nomeArquivo] — só para a mensagem de `ArquivoSemTranscricaoError`.
 */
async function processarBuffer(fileBuffer, userId = null, animalId = null, empresaId = null, mimetype = '', nomeArquivo = 'arquivo') {
  if (mimetype === MIME_DOC) throw new ArquivoSemTranscricaoError(nomeArquivo);

  const isPdf  = mimetype === 'application/pdf';
  const isTxt  = mimetype === MIME_TXT;
  const isDocx = mimetype === MIME_DOCX;
  const somenteTexto = isTxt || isDocx;

  // Texto embutido do PDF continua sendo a fonte dos VALORES da tabela — mais
  // preciso que ler número em imagem. Foto/scan (sem texto) ou falha do
  // pdf-parse (PDF exótico) não impedem a extração: segue só com o documento
  // em anexo, abaixo — é ELE, multimodal, que carrega a logomarca.
  let texto = '';
  if (isPdf) {
    try {
      texto = await extrairTextoPDF(fileBuffer);
    } catch (err) {
      console.error('[exameParserService] Falha ao extrair texto do PDF, seguindo só com a imagem:', err.message);
    }
  } else if (isTxt) {
    texto = fileBuffer.toString('utf-8');
  } else if (isDocx) {
    try {
      texto = await extrairTextoDocx(fileBuffer);
    } catch (err) {
      console.error('[exameParserService] Falha ao extrair texto do .docx:', err.message);
    }
  }

  if (texto) {
    const logger = require('../lib/logger');
    logger.debug('[exameParser] Texto extraído do documento:\n' + texto.slice(0, 3000));
  }

  const { operacaoVers, prompt } = buildPrompt('parse_laudo', texto);

  // MULTIMODAL (PDF/foto): o documento vai ANEXADO, não só o texto — é o que
  // permite à IA reconhecer o laboratório pela LOGOMARCA (marca d'água, brasão,
  // papel timbrado) quando o nome não aparece em texto simples, ou quando não há
  // texto nenhum (foto/scan). .docx/.txt vão SÓ o texto (ver doc da função).
  // `callAI` não serve aqui — é texto-puro (ver comentário no topo do arquivo);
  // por isso o gate de quota é chamado direto.
  await garantirQuota(empresaId);
  const respostaTexto = await chamarGeminiComLog({
    parts: somenteTexto
      ? [{ text: prompt }]
      : [
          { inlineData: { mimeType: mimetype || 'application/pdf', data: fileBuffer.toString('base64') } },
          { text: prompt },
        ],
    promptTexto:  prompt,
    operacaoVers,
    userId, animalId, empresaId,
  });

  // Parse da resposta
  const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Não encontrou JSON na resposta do modelo');

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[exameParserService] Erro ao parsear JSON:', respostaTexto);
    throw new Error('Modelo retornou resposta em formato inválido');
  }
}

// =====================================================================
// TRANSCRIÇÃO DO LAUDO DE EXAME DE IMAGEM (radiografia, US, etc.)
//
// Diferente do laboratorial (que estrutura os valores numa tabela), o exame de
// Imagem permanece verbatim — a IA só TRANSCREVE o texto do documento, nunca
// interpreta o achado (mesma regra de produto do exame de Imagem, ver CLAUDE.md
// §12/28-d). É multimodal quando o arquivo é foto/scan: usa gerarConteudo com
// inlineData em vez de callAI() (que só aceita texto) — por isso o log de uso é
// feito aqui manualmente, como em composicaoParserService.chamarGemini.
// =====================================================================

async function chamarGeminiComLog({ parts, promptTexto, operacaoVers, userId, animalId, empresaId }) {
  const inicio = Date.now();
  let sucesso          = true;
  let erroMensagem     = null;
  let respostaTexto    = '';
  let tokensEntradaApi = null;
  let tokensSaidaApi   = null;
  let modelo;

  try {
    const r = await gerarConteudo(parts, { temperature: 0.1, maxTokens: 3000 });
    respostaTexto    = (r.text ?? '').trim();
    tokensEntradaApi = r.tokensEntrada;
    tokensSaidaApi   = r.tokensSaida;
    modelo           = r.modelo;
    return respostaTexto;

  } catch (err) {
    sucesso      = false;
    erroMensagem = err.message;
    throw err;

  } finally {
    await logAiUsage({
      operacao:   operacaoVers,
      modulo:     MODULOS_IA.EXAMES,
      modelo,
      provedor:   PROVEDOR,
      promptTexto,
      respostaTexto,
      tokensEntradaApi: tokensEntradaApi ?? undefined,
      tokensSaidaApi:   tokensSaidaApi   ?? undefined,
      latenciaMs: Date.now() - inicio,
      userId,
      animalId,
      empresaId,
      sucesso,
      erroMensagem,
    });
  }
}

function parseRespostaLaudoImagem(respostaTexto) {
  const jsonMatch = respostaTexto.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Não encontrou JSON na resposta do modelo');
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[exameParserService] Erro ao parsear JSON (laudo imagem):', respostaTexto);
    throw new Error('Modelo retornou resposta em formato inválido');
  }
}

/**
 * @param {Buffer} fileBuffer  — conteúdo do arquivo já em memória
 * @param {string} [mimetype]  — mime type do arquivo. Só PDF/DOCX/TXT têm
 *   transcrição automática — a leitura por VISÃO (foto/scan) foi desativada
 *   por ser lenta demais para este fluxo; imagem e `.doc` caem no mesmo
 *   `ArquivoSemTranscricaoError` do `.doc` (arquivo é anexado normalmente,
 *   só sem prévia — o usuário digita o laudo à mão).
 * @param {string} [nomeArquivo] — só para a mensagem de `ArquivoSemTranscricaoError`.
 */
async function processarLaudoImagemBuffer(fileBuffer, mimetype = '', userId = null, animalId = null, empresaId = null, nomeArquivo = 'arquivo') {
  const isPdf  = mimetype === 'application/pdf';
  const isTxt  = mimetype === MIME_TXT;
  const isDocx = mimetype === MIME_DOCX;

  if (!isPdf && !isTxt && !isDocx) throw new ArquivoSemTranscricaoError(nomeArquivo);

  let texto = '';
  if (isPdf) {
    texto = await extrairTextoPDF(fileBuffer);
  } else if (isTxt) {
    texto = fileBuffer.toString('utf-8');
  } else {
    texto = await extrairTextoDocx(fileBuffer);
  }

  if (!texto.trim()) {
    // PDF escaneado (sem texto embutido) — não há renderização de página em
    // imagem no repositório, e a leitura por visão foi desativada (ver acima).
    throw new Error('Não foi possível extrair texto do arquivo. Digite o laudo abaixo à mão.');
  }

  const { operacaoVers, prompt } = buildPrompt('parse_laudo_imagem_texto', texto);
  const respostaTexto = await chamarGeminiComLog({
    parts: [{ text: prompt }], promptTexto: prompt, operacaoVers, userId, animalId, empresaId,
  });

  return parseRespostaLaudoImagem(respostaTexto);
}

// =====================================================================
// EXPORTAÇÃO PRINCIPAL
// =====================================================================

module.exports = {
  /**
   * @param {string} filePath   — caminho absoluto do PDF/imagem em disco
   * @param {number} [userId]   — id do usuário que disparou a ação (para log)
   * @param {number} [animalId] — id do animal relacionado (para log)
   * @param {number} [empresaId]
   * @param {string} [mimetype] — mime type do arquivo (decide extração de texto
   *   e o mimeType do anexo multimodal — ver `processarBuffer`)
   * @param {string} [nomeArquivo] — nome original, só para a mensagem de erro
   *   quando o formato não tem transcrição (`.doc`).
   */
  async processarExame(filePath, userId = null, animalId = null, empresaId = null, mimetype = '', nomeArquivo = 'arquivo') {
    const fileBuffer = fs.readFileSync(filePath);
    return processarBuffer(fileBuffer, userId, animalId, empresaId, mimetype, nomeArquivo);
  },

  // Mesma extração, mas a partir de um buffer em memória (multer.memoryStorage) —
  // usada pela ANÁLISE do exame "não pedido", que não deve gravar nada em disco
  // antes de o usuário confirmar a criação do registro.
  processarBuffer,

  /**
   * Transcreve o laudo de exame de IMAGEM a partir do arquivo em disco.
   * @param {string} filePath   — caminho absoluto do arquivo em disco
   * @param {string} [mimetype] — mime type do arquivo
   * @param {number} [userId]   — id do usuário que disparou a ação (para log)
   * @param {number} [animalId] — id do animal relacionado (para log)
   * @param {string} [nomeArquivo] — nome original, só para a mensagem de erro
   *   quando o formato não tem transcrição (`.doc`).
   */
  async processarLaudoImagem(filePath, mimetype = '', userId = null, animalId = null, empresaId = null, nomeArquivo = 'arquivo') {
    const fileBuffer = fs.readFileSync(filePath);
    return processarLaudoImagemBuffer(fileBuffer, mimetype, userId, animalId, empresaId, nomeArquivo);
  },

  // Mesma transcrição, a partir de um buffer em memória (multer.memoryStorage) —
  // usada pela ANÁLISE do exame "não pedido" de Imagem.
  processarLaudoImagemBuffer,

  // Marcador de "aceito no upload, sem caminho de leitura" (.doc) — controllers
  // capturam pelo `code` (FORMATO_SEM_TRANSCRICAO) para avisar em vez de logar
  // como falha de IA.
  ArquivoSemTranscricaoError,
};