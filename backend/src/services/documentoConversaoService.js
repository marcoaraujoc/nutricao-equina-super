// backend/src/services/documentoConversaoService.js
//
// DOCUMENTO ENVIADO PELA CLÍNICA → MODELO DE BLOCOS.
//
// 🔴 O QUE MUDA COM ISTO. Até aqui, enviar um documento produzia uma FOTOGRAFIA: o
// arquivo virava blocos `imagem`, uma por página (`modules/documentos/upload.ts`).
// Ele imprimia, ia por WhatsApp e entrava no histórico como qualquer outro — mas era
// papel morto: não se preenchia sozinho com o paciente selecionado e não tinha um
// único campo para digitar. Aqui ele passa a ser um modelo DE VERDADE, com
// `{{variáveis}}` (o que o S2Vet já sabe) e `[[lacunas]]` (o que ele não sabe, e que
// a tela de emissão apresenta como formulário).
//
// 🔴 NENHUM DADO DO ARQUIVO DE EXEMPLO SOBREVIVE. O que a clínica envia é uma via já
// emitida de outro paciente. Se o nome do animal, o CRMV ou a dose do exemplo
// vazassem para o modelo, TODA emissão futura sairia com o dado de outra pessoa — e
// nada no sistema acusaria. A regra é do prompt; aqui está a rede de segurança que
// vem depois dele (`variaveisDesconhecidas`), que transforma em CAMPO EM BRANCO toda
// chave que não resolve, em vez de deixá-la sumir calada na emissão.
//
// ⚠️ MULTIMODAL: as páginas vão anexadas (`inlineData`), então a chamada NÃO passa
// por `callAI` (que só aceita texto) — vai por `gerarConteudo`, como
// `exameParserService` e `composicaoParserService`. Consequência: o log de uso e o
// GATE DE QUOTA (§7) são feitos aqui à mão. Esquecer o gate deixaria este caminho
// fora do teto do plano do cliente.
'use strict';

const { gerarConteudo, PROVEDOR, MODELO_PADRAO } = require('../ai/geminiClient');
// Retentativa única para 503/429 do provedor — regra extraída daqui para `ai/retentativa`
// quando o exameParser passou a precisar dela. Ver o porquê lá.
const { comRetentativa } = require('../ai/retentativa');
const { MODULOS_IA }    = require('../ai');
const { buildPrompt }   = require('../ai/prompts');
const { logAiUsage }    = require('./aiLogger.service');
const { garantirQuota } = require('./iaQuotaService');
const { normalizarBlocos, VARIAVEIS_VALIDAS } = require('./documentoLLMService');

/**
 * Teto de páginas enviadas ao modelo. Modelo de documento com mais que isso é raro, e
 * cada página é uma imagem inteira dentro do prompt.
 */
const MAX_PAGINAS = 4;

/** Espelha `CATEGORIAS_PADRAO` do `DocumentoTemplateController`. */
const CATEGORIAS = [
  'atendimento', 'receituarios', 'laudos', 'reproducao', 'cirurgias', 'sanidade',
  'rebanho', 'transporte', 'consentimentos', 'financeiro', 'personalizados',
];

const RE_VAR = /\{\{\s*([\w.]+)\s*\}\}/g;

const VALIDAS = new Set(VARIAVEIS_VALIDAS);

/**
 * "cliente.inscricaoEstadual" → "Inscricao Estadual".
 *
 * Serve de RÓTULO da lacuna quando o modelo inventou uma chave que não existe. Não é
 * bonito, mas é honesto: o campo aparece no formulário com um nome reconhecível, em
 * vez de sumir do papel sem ninguém notar.
 */
function rotuloDaChave(chave) {
  const ultimo = String(chave).split('.').pop() || String(chave);
  const separado = ultimo.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return separado.charAt(0).toUpperCase() + separado.slice(1);
}

/**
 * Troca `{{chave}}` que NÃO resolve por `[[Rótulo]]`.
 *
 * POR QUÊ isto existe, e por que não apaga: chave desconhecida resolve para string
 * VAZIA na emissão (regra "nada de inventar valor"), o que é correto para o modelo
 * feito à mão — lá alguém escolheu a variável de uma lista fechada. Aqui a chave foi
 * ESCRITA PELO MODELO DE LINGUAGEM, e uma chave alucinada viraria um buraco
 * silencioso no papel: o campo desaparece e ninguém é avisado. Virando lacuna, ele
 * aparece no formulário da emissão e uma pessoa decide o que escrever ali.
 */
function variaveisDesconhecidas(texto) {
  if (typeof texto !== 'string' || !texto.includes('{{')) return texto;
  return texto.replace(RE_VAR, (todo, chave) => (VALIDAS.has(chave) ? todo : `[[${rotuloDaChave(chave)}]]`));
}

/**
 * Aplica `variaveisDesconhecidas` a TODO campo textual do bloco — a mesma varredura de
 * `aplicarEmBlocos` (lib/documentoVariaveis.js): a chave pode estar dentro de uma
 * célula de tabela ou de um item de checklist, e cuidar só de `conteudo.texto`
 * deixaria a alucinação passar pela tabela.
 */
function sanearVariaveis(blocos) {
  return blocos.map((b) => {
    const c = { ...(b.conteudo || {}) };
    if (typeof c.texto  === 'string') c.texto  = variaveisDesconhecidas(c.texto);
    if (typeof c.rotulo === 'string') c.rotulo = variaveisDesconhecidas(c.rotulo);
    if (Array.isArray(c.itens))   c.itens   = c.itens.map(variaveisDesconhecidas);
    if (Array.isArray(c.colunas)) c.colunas = c.colunas.map(variaveisDesconhecidas);
    if (Array.isArray(c.linhas))  c.linhas  = c.linhas.map(l => (Array.isArray(l) ? l.map(variaveisDesconhecidas) : l));
    // ⚠️ `campoAuto` fica FORA da troca: variável que não resolve ali já vira campo do
    // formulário sozinha (`coletarCampos`, origem CADASTRO, chaveada pelo rótulo). O
    // que ele precisa é ter rótulo, e o prompt sempre pede um.
    if (b.tipo !== 'campoAuto' && typeof c.variavel === 'string') {
      c.variavel = variaveisDesconhecidas(c.variavel);
    }
    return { ...b, conteudo: c };
  });
}

/**
 * Só UM bloco `titulo`, e só o primeiro.
 *
 * O cabeçalho da folha ABSORVE o primeiro `titulo` (ver
 * `modules/documentos/cabecalho.ts`). Um segundo, no meio do documento, é quase sempre
 * o cabeçalho do papel original — que o prompt manda ignorar e que às vezes escapa
 * assim mesmo; impresso, ele duplicaria o título logo abaixo do cabeçalho.
 */
function umTituloSo(blocos) {
  let visto = false;
  return blocos.filter((b) => {
    if (b.tipo !== 'titulo') return true;
    if (visto) return false;
    visto = true;
    return true;
  });
}

async function chamarComLog({ parts, promptTexto, operacaoVers, userId, empresaId }) {
  const inicio = Date.now();
  let sucesso = true;
  let erroMensagem = null;
  let respostaTexto = '';
  // ⚠️ Começa no modelo padrão em vez de `undefined`: quando a chamada FALHA, `r` não
  // existe e `modelo` ficaria vazio — e `logAiUsage` morre com "Argument `modelo` is
  // missing", perdendo justamente o registro da falha que se quer investigar.
  let modelo = MODELO_PADRAO;
  let tokensEntradaApi = null;
  let tokensSaidaApi = null;

  try {
    const r = await comRetentativa(() => gerarConteudo(parts, { temperature: 0.1, maxTokens: 8000 }));
    respostaTexto    = (r.text || '').trim();
    tokensEntradaApi = r.tokensEntrada;
    tokensSaidaApi   = r.tokensSaida;
    modelo           = r.modelo;
    return respostaTexto;
  } catch (err) {
    sucesso = false;
    erroMensagem = err.message;
    throw err;
  } finally {
    await logAiUsage({
      operacao: operacaoVers,
      modulo:   MODULOS_IA.DOCUMENTOS,
      modelo,
      provedor: PROVEDOR,
      promptTexto,
      respostaTexto,
      tokensEntradaApi: tokensEntradaApi ?? undefined,
      tokensSaidaApi:   tokensSaidaApi   ?? undefined,
      latenciaMs: Date.now() - inicio,
      userId,
      empresaId,
      sucesso,
      erroMensagem,
    });
  }
}

/**
 * Converte as páginas de um documento enviado nos blocos do modelo.
 *
 * @param {object} req
 * @param {object} entrada
 * @param {Array}  entrada.paginas — [{ buffer, mimetype }], na ordem das páginas
 * @param {string} entrada.texto   — texto extraído no navegador (opcional)
 * @param {string} entrada.nome    — nome que a clínica deu ao documento
 * @returns {Promise<{ ehDocumento: boolean, titulo: string|null, categoria: string|null, blocos: Array }>}
 */
async function converter(req, { paginas = [], texto = '', nome = '' } = {}) {
  const usadas = paginas.slice(0, MAX_PAGINAS);
  if (usadas.length === 0) throw new Error('Nenhuma página para converter.');

  // Gate ANTES de gastar token — `callAI` faria isto sozinho, mas o caminho multimodal
  // não passa por ele. Lança QuotaIaExcedidaError (429 no error handler de server.ts).
  await garantirQuota(req.empresaId ?? null);

  const { operacaoVers, prompt } = buildPrompt('converter_documento', {
    variaveis:  VARIAVEIS_VALIDAS,
    categorias: CATEGORIAS,
    texto,
    nome,
  });

  const parts = [
    { text: prompt },
    ...usadas.map(p => ({
      inlineData: { mimeType: p.mimetype || 'image/jpeg', data: p.buffer.toString('base64') },
    })),
  ];

  const respostaTexto = await chamarComLog({
    parts,
    promptTexto: prompt,
    operacaoVers,
    userId:    req.user?.id ?? null,
    empresaId: req.empresaId ?? null,
  });

  const bruto = respostaTexto.match(/\{[\s\S]*\}/);
  if (!bruto) throw new Error('LLM não retornou JSON');
  let parsed;
  try {
    parsed = JSON.parse(bruto[0]);
  } catch {
    throw new Error('LLM retornou JSON inválido');
  }

  if (parsed && parsed.ehDocumento === false) {
    return { ehDocumento: false, titulo: null, categoria: null, blocos: [] };
  }

  const blocos = umTituloSo(sanearVariaveis(normalizarBlocos(parsed && parsed.blocos)));
  const cat = typeof (parsed && parsed.categoria) === 'string' ? parsed.categoria.trim().toLowerCase() : '';

  return {
    // Conversão que não produziu bloco nenhum não é conversão: quem chama cai no envio
    // como IMAGEM, que é o comportamento de sempre e nunca falha.
    ehDocumento: blocos.length > 0,
    titulo:    typeof (parsed && parsed.titulo) === 'string' ? parsed.titulo.trim().slice(0, 160) : null,
    categoria: CATEGORIAS.includes(cat) ? cat : null,
    blocos,
  };
}

module.exports = { converter, rotuloDaChave, variaveisDesconhecidas, umTituloSo, MAX_PAGINAS };
