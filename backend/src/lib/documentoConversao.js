// backend/src/lib/documentoConversao.js
'use strict';

/**
 * PORT DE CONVERSÃO DE DOCUMENTO + adapter LibreOffice headless.
 *
 * POR QUE EXISTE: `.doc` (formato binário OLE do Word 97-2003) não tem NENHUM caminho
 * de leitura no sistema — `mammoth` só abre `.docx`, e o Gemini não aceita `.doc` como
 * anexo (é a origem do `ArquivoSemTranscricaoError` de `exameParserService`). Na tela
 * de Resultado de Exames isso aparecia duas vezes: o laudo `.doc` era anexado mas não
 * era lido pela IA, e o visualizador dizia "Pré-visualização não disponível" — o
 * usuário tinha de baixar o arquivo e abrir no Word para conferir o que estava no
 * prontuário.
 *
 * ESTRATÉGIA — convert-on-ingest: o `.doc` é convertido para `.docx` NO UPLOAD e o
 * `.docx` derivado vira o artefato canônico (é ele que fica no storage). O visualizador
 * nunca renderiza `.doc`; tudo a jusante (pré-visualização, leitura por IA, download)
 * enxerga um `.docx` comum e não precisa saber que houve conversão.
 * `GET /api/midia/:chave/preview` converte SOB DEMANDA como retaguarda — é o que faz os
 * `.doc` JÁ GRAVADOS no banco (anexados antes desta mudança) ficarem visíveis também.
 *
 * 🔴 DEGRADAÇÃO GRACIOSA É REGRA, NÃO CORTESIA. LibreOffice é binário de SISTEMA e pode
 * não estar instalado — no Docker é uma linha no Dockerfile, mas no Windows do dia a dia
 * é instalação à parte. Sem ele, `normalizarDocLegado` devolve o arquivo ORIGINAL e o
 * upload segue exatamente como sempre seguiu. Derrubar o lançamento de um resultado
 * clínico porque um conversor de formato legado não está no ambiente seria trocar um
 * inconveniente (não pré-visualizar) por perda de trabalho clínico.
 *
 * TROCA DE ADAPTER: quem chama usa `normalizarDocLegado` / `converterDocParaDocx`, nunca
 * o `soffice`. Para migrar a conversão para um worker de fila ou um serviço externo,
 * basta reescrever `converterComLibreOffice` — nenhum controller muda.
 */

const { execFile }  = require('child_process');
const { promisify } = require('util');
const fs     = require('fs/promises');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

const MIME_DOC  = 'application/msword';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Binário do LibreOffice. No Linux/Docker `soffice` está no PATH; no Windows costuma
// ficar em `C:\Program Files\LibreOffice\program\soffice.exe` — ali a env é obrigatória.
const LIBREOFFICE_BIN = process.env.LIBREOFFICE_BIN || 'soffice';
// Teto rígido: o LibreOffice headless trava em documento corrompido e ficaria segurando
// a requisição de upload até o timeout do proxy.
const TIMEOUT_MS = Number(process.env.LIBREOFFICE_TIMEOUT_MS || 30000);
// Documento gigante não vale a conversão síncrona dentro do upload.
const TAMANHO_MAX = Number(process.env.LIBREOFFICE_MAX_BYTES || 25 * 1024 * 1024);

class ConversaoIndisponivelError extends Error {
  constructor(mensagem) {
    super(mensagem ?? 'Conversor de documentos indisponível.');
    this.name = 'ConversaoIndisponivelError';
    this.code = 'CONVERSAO_INDISPONIVEL';
  }
}

// Memória de curto prazo do "LibreOffice não está aqui": sem isto, cada `.doc` de cada
// upload paga um spawn que vai falhar com ENOENT. A janela é curta para que instalar o
// binário passe a valer sem reiniciar o backend.
let indisponivelAte = 0;
const JANELA_INDISPONIVEL_MS = 5 * 60 * 1000;

/** `.doc` legado? Casa por MIME **e** por extensão: navegador antigo manda
 *  `application/octet-stream` num `.doc`, e há quem renomeie `.docx` para `.doc`. */
function ehDocLegado(file) {
  if (!file) return false;
  const nome = String(file.originalname ?? '').toLowerCase();
  if (/\.docx$/.test(nome)) return false;          // `.docx` nunca é legado
  return file.mimetype === MIME_DOC || /\.doc$/.test(nome);
}

function nomeComoDocx(nomeOriginal) {
  const base = String(nomeOriginal ?? 'documento').replace(/\.doc$/i, '');
  return `${base}.docx`;
}

/**
 * Converte um `.doc` em `.docx` com LibreOffice headless.
 *
 * @param {Buffer} buffer conteúdo do `.doc`
 * @returns {Promise<Buffer>} conteúdo do `.docx`
 * @throws {ConversaoIndisponivelError} binário ausente, timeout, arquivo inválido
 */
async function converterComLibreOffice(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ConversaoIndisponivelError('Arquivo vazio.');
  }
  if (buffer.length > TAMANHO_MAX) {
    throw new ConversaoIndisponivelError('Arquivo grande demais para conversão.');
  }
  if (Date.now() < indisponivelAte) {
    throw new ConversaoIndisponivelError('Conversor indisponível neste ambiente.');
  }

  // Diretório PRÓPRIO por conversão. Além do isolamento de concorrência (o
  // `-env:UserInstallation` abaixo), é o que garante nome previsível na saída e cleanup
  // completo — o LibreOffice grava o resultado com o mesmo nome base, trocando a extensão.
  // ⚠️ O nome é GERADO, nunca o `originalname`: escrever em disco um nome vindo do
  // cliente é o caminho clássico de path traversal.
  const raiz     = await fs.mkdtemp(path.join(os.tmpdir(), 's2vet-doc-'));
  const nomeBase = crypto.randomBytes(8).toString('hex');
  const entrada  = path.join(raiz, `${nomeBase}.doc`);
  const saida    = path.join(raiz, `${nomeBase}.docx`);
  const perfil   = path.join(raiz, 'profile');

  try {
    await fs.writeFile(entrada, buffer);
    await execFileAsync(
      LIBREOFFICE_BIN,
      [
        // Perfil de usuário PRÓPRIO desta conversão. Sem isto, duas conversões
        // simultâneas disputam o perfil padrão e a segunda falha em silêncio (ou
        // reaproveita um processo já aberto e nunca chega a escrever a saída).
        `-env:UserInstallation=file:///${perfil.replace(/\\/g, '/')}`,
        '--headless', '--norestore', '--nolockcheck', '--nodefault',
        '--convert-to', 'docx:MS Word 2007 XML',
        '--outdir', raiz,
        entrada,
      ],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    return await fs.readFile(saida);
  } catch (err) {
    // ENOENT no BINÁRIO (não no arquivo de saída) = LibreOffice não instalado.
    if (err?.code === 'ENOENT' && !String(err?.path ?? '').endsWith('.docx')) {
      indisponivelAte = Date.now() + JANELA_INDISPONIVEL_MS;
      throw new ConversaoIndisponivelError('LibreOffice não encontrado (defina LIBREOFFICE_BIN).');
    }
    throw new ConversaoIndisponivelError(`Falha ao converter .doc: ${err?.message ?? 'erro desconhecido'}`);
  } finally {
    // Cleanup SEMPRE — inclusive no caminho de erro, onde o LibreOffice pode ter deixado
    // o perfil inteiro (dezenas de MB) para trás.
    await fs.rm(raiz, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * `.doc` → `.docx`. Nome público do port: é isto que os controllers chamam.
 * @throws {ConversaoIndisponivelError}
 */
async function converterDocParaDocx(buffer) {
  return converterComLibreOffice(buffer);
}

/**
 * Normaliza UM arquivo de upload (formato multer: `{ buffer, originalname, mimetype }`).
 * `.doc` vira `.docx`; qualquer outro formato passa intacto.
 *
 * ⚠️ NUNCA lança. Falha de conversão devolve o arquivo ORIGINAL — ver a degradação
 * graciosa no topo do arquivo. O objeto devolvido é NOVO (não muta o do multer): o
 * mesmo `file` pode ser lido depois por outro caminho, e alterá-lo no lugar faria a
 * segunda leitura enxergar um buffer que já não corresponde ao nome que ela espera.
 */
async function normalizarDocLegado(file) {
  if (!ehDocLegado(file)) return file;
  try {
    const docx = await converterDocParaDocx(file.buffer);
    return {
      ...file,
      buffer:          docx,
      size:            docx.length,
      originalname:    nomeComoDocx(file.originalname),
      mimetype:        MIME_DOCX,
      convertidoDeDoc: true,
    };
  } catch (err) {
    console.warn(`documentoConversao: mantendo .doc original ("${file?.originalname}") — ${err.message}`);
    return file;
  }
}

/** `normalizarDocLegado` para a lista inteira do multer. Sequencial de propósito: o
 *  LibreOffice é pesado, e um lote de laudos convertidos em paralelo derruba o processo. */
async function normalizarDocsLegados(arquivos) {
  if (!Array.isArray(arquivos) || arquivos.length === 0) return arquivos;
  const saida = [];
  for (const file of arquivos) saida.push(await normalizarDocLegado(file));
  return saida;
}

module.exports = {
  MIME_DOC,
  MIME_DOCX,
  ConversaoIndisponivelError,
  ehDocLegado,
  nomeComoDocx,
  converterDocParaDocx,
  normalizarDocLegado,
  normalizarDocsLegados,
};
