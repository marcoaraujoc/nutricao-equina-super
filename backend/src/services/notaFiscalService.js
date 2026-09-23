// backend/src/services/notaFiscalService.js
//
// NOTA FISCAL DO FORNECEDOR → itens de produto (2026-09-10)
//
// 🔴 O QUE ISTO RESOLVE: a clínica recebe a nota e redigita item por item na tela de
// Produtos — nome, quantidade, valor, e ainda o cadastro do fornecedor quando é a
// primeira compra dele. Aqui a nota é LIDA e o formulário nasce preenchido.
//
// 🔴 O RESULTADO É PROPOSTA, NUNCA CADASTRO. Nada é gravado por este serviço: ele
// devolve o que leu, a tela mostra, a pessoa confere e só então salva. É o que torna
// aceitável um erro de leitura — vira uma correção de campo, não um cadastro errado
// que ninguém revisa depois.
//
// ⚠️ FALHA NÃO É ERRO DE TELA. Arquivo que não é nota, JSON inválido ou IA fora do ar
// respondem 200 com `ehNotaFiscal: false` e o MOTIVO — a tela avisa e o cadastro segue
// manual, que é o comportamento de sempre e nunca falha. Perder o cadastro inteiro por
// um 500 do modelo seria trocar "digitar os campos" por "não conseguir cadastrar".
// O único erro propagado é o 429 de QUOTA, que é decisão do plano do cliente.
//
// ⚠️ MULTIMODAL — não passa por `callAI` (que só aceita texto): vai por
// `gerarConteudo`, então o log de uso e o GATE DE QUOTA são feitos à mão aqui.
// Esquecer o gate deixaria este caminho fora do teto do plano (§7).
'use strict';

const { gerarConteudo, PROVEDOR, MODELO_PADRAO } = require('../ai/geminiClient');
const { comRetentativa } = require('../ai/retentativa');
const { MODULOS_IA }     = require('../ai');
const { buildPrompt }    = require('../ai/prompts');
const { logAiUsage }     = require('./aiLogger.service');
const { garantirQuota }  = require('./iaQuotaService');

/**
 * Teto de páginas enviadas ao modelo. Nota fiscal de compra passa disso raramente, e
 * cada página é uma imagem inteira dentro do prompt.
 */
const MAX_PAGINAS = 4;

/** Só dígitos — CNPJ/CPF/telefone/CEP vão para o cadastro nesse formato. */
const digitos = (v) => String(v ?? '').replace(/\D/g, '') || null;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // A nota pode trazer "1.234,56" (pt-BR) mesmo com a instrução de devolver decimal
  // com ponto — o modelo às vezes ecoa o formato do documento. Normaliza os dois.
  const t = String(v).trim().replace(/\s/g, '');
  const bruto = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
};

const texto = (v, max = 255) => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/** "AAAA-MM-DD" ou null — data em qualquer outro formato não vira palpite. */
const data = (v) => {
  const t = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/** Extrai o JSON da resposta, tolerando cerca de markdown que o modelo às vezes põe. */
function extrairJson(txt) {
  const limpo = String(txt ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const ini = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (ini === -1 || fim === -1 || fim <= ini) return null;
  try { return JSON.parse(limpo.slice(ini, fim + 1)); } catch { return null; }
}

/**
 * REDE DE SEGURANÇA depois do modelo. O prompt manda devolver `null` no que não
 * existe, mas prompt é instrução, não garantia — e aqui o campo inventado vira
 * estoque e dívida. Tudo que não converter vira `null`.
 *
 * ⚠️ Item SEM NOME é descartado: sem ele não há o que cadastrar, e uma linha em
 * branco no formulário é pior que uma linha a menos.
 * ⚠️ Quantidade e valor NEGATIVOS são descartados (viram `null`): costumam ser a
 * linha de desconto ou devolução, que o prompt já manda ignorar.
 */
function normalizar(bruto) {
  if (!bruto || typeof bruto !== 'object') {
    return { ehNotaFiscal: false, motivo: 'A resposta não veio no formato esperado.' };
  }

  const f = bruto.fornecedor ?? {};
  const positivo = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };

  const itens = (Array.isArray(bruto.itens) ? bruto.itens : [])
    .map(i => ({
      nome:          texto(i?.nome, 90),
      // Só "vacina" quando o modelo afirmou; o resto cai em medicamento, que é o
      // caso comum e o que o prompt manda usar na dúvida.
      tipo:          String(i?.tipo ?? '').toLowerCase() === 'vacina' ? 'vacina' : 'medicamento',
      quantidade:    positivo(i?.quantidade),
      unidade:       texto(i?.unidade, 30),
      valorUnitario: positivo(i?.valorUnitario),
      valorTotal:    positivo(i?.valorTotal),
      lote:          texto(i?.lote, 100),
      validade:      data(i?.validade),
    }))
    .filter(i => i.nome);

  // 🔴 REDE DE SEGURANÇA CONTRA O PRÓPRIO `ehNotaFiscal` (2026-09-22). Medido ao vivo,
  // repetindo a MESMA chamada real ao Gemini com o MESMO cupom: em 2 de 3 tentativas o
  // modelo devolveu `ehNotaFiscal: false` MAS ainda assim extraiu certinho o fornecedor
  // (nome, endereço, bairro, cidade) e os dois itens com quantidade e valor — ou seja,
  // ele LEU o documento, só errou o próprio sinalizador. `ehNotaFiscal` é comentário do
  // modelo sobre o que ele acabou de fazer, não parte do que ele extraiu, e comentário
  // é o tipo de coisa que um modelo erra sem que o conteúdo ao lado esteja errado.
  // Confiar cegamente nele fazia a tela dizer "não identifiquei" sobre um documento que,
  // na prática, TINHA sido lido corretamente — a pessoa refotografava um cupom perfeito.
  // ⚠️ A promoção exige fornecedor.nome E ao menos um item com nome+valor: é a MESMA
  // extração que o prompt já produz para o caso aceito, nunca um dado novo — não fere
  // "nada é inventado" (o valor já estava ali, só o booleano mentia sobre ele).
  const extraiuCompra = Boolean(texto(f.nome, 255))
    && itens.some(i => i.valorUnitario != null || i.valorTotal != null);

  if (bruto.ehNotaFiscal === false && !extraiuCompra) {
    // ⚠️ A recusa precisa dizer o que É aceito. A v1 respondia só "não parece ser uma
    // nota fiscal", e quem estava com um ORÇAMENTO DE BALCÃO na mão — que agora é
    // aceito — não tinha como saber se o problema era o papel, a foto ou o sistema.
    return {
      ehNotaFiscal: false,
      motivo: 'Não foi possível identificar uma compra neste arquivo. Vale nota fiscal, '
            + 'cupom, orçamento de balcão ou recibo — desde que mostre o fornecedor e os '
            + 'itens comprados, com quantidade e valor.',
    };
  }

  return {
    ehNotaFiscal: true,
    numero:      texto(bruto.numero, 100),
    dataEmissao: data(bruto.dataEmissao),
    fornecedor: {
      nome:     texto(f.nome, 255),
      cnpj:     digitos(f.cnpj),
      cpf:      digitos(f.cpf),
      telefone: digitos(f.telefone),
      email:    texto(f.email, 255),
      cep:      digitos(f.cep),
      endereco: texto(f.endereco, 500),
      bairro:   texto(f.bairro, 255),
      cidade:   texto(f.cidade, 255),
      // UF é sempre 2 letras — o que vier diferente disso não é UF.
      estado:   /^[A-Za-z]{2}$/.test(String(f.estado ?? '').trim())
                  ? String(f.estado).trim().toUpperCase() : null,
    },
    itens,
  };
}

async function chamarComLog({ parts, promptTexto, operacaoVers, userId, empresaId }) {
  const inicio = Date.now();
  let sucesso = true;
  let erroMensagem = null;
  let respostaTexto = '';
  // Começa no modelo padrão, e não em `undefined`: quando a chamada FALHA não há `r`,
  // e `logAiUsage` morre com "Argument `modelo` is missing" — perdendo justamente o
  // registro da falha que se quer investigar (defeito achado em 2026-09-01).
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
      modulo:   MODULOS_IA.PRODUTOS,
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
 * Lê a nota e devolve os dados para o formulário.
 *
 * @param {object} req
 * @param {Array}  paginas — [{ buffer, mimetype }], na ordem
 * @param {string} texto   — texto embutido do PDF, extraído no navegador (opcional)
 */
async function ler(req, { paginas = [], texto: textoEmbutido = '' } = {}) {
  const usadas = paginas.slice(0, MAX_PAGINAS);
  if (usadas.length === 0) throw new Error('Nenhuma página para ler.');

  // Gate ANTES de gastar token. Lança QuotaIaExcedidaError → 429 no error handler.
  await garantirQuota(req.empresaId ?? null);

  const { operacaoVers, prompt } = buildPrompt('ler_nota_fiscal', { texto: textoEmbutido });

  // O texto embutido viaja JUNTO das imagens, não no lugar delas: o texto dá os
  // números exatos (nenhum OCR erra um dígito que já está lá) e a imagem dá a
  // ESTRUTURA (o que é coluna de quantidade, o que é de valor). Um só perde metade.
  const parts = [
    { text: prompt },
    ...usadas.map(p => ({
      inlineData: { mimeType: p.mimetype || 'image/jpeg', data: p.buffer.toString('base64') },
    })),
  ];

  const resposta = await chamarComLog({
    parts,
    promptTexto: prompt,
    operacaoVers,
    userId:    req.user?.id ?? null,
    empresaId: req.empresaId ?? null,
  });

  return normalizar(extrairJson(resposta));
}

module.exports = { ler, MAX_PAGINAS, normalizar };
