// backend/src/lib/erroResposta.js
//
// 🔴 ERRO CRU NUNCA CHEGA À TELA DO USUÁRIO (2026-09-16).
//
// O QUE ACONTECEU: `ProdutoController.criar` respondia
// `res.status(500).json({ error: err.message || 'Erro ao cadastrar o produto.' })`.
// O `||` parece uma rede de segurança e é o oposto disso: `err.message` do Prisma
// SEMPRE existe, então o fallback amigável nunca era usado e o que ia para a tela era
// o dump da invocação — nome do método, CAMINHO ABSOLUTO do arquivo no servidor e o
// trecho do código. Foi exatamente o que a pessoa viu ao alterar um medicamento.
//
// Três razões para isso nunca acontecer:
//   1. quem usa o sistema não tem o que fazer com "Invalid `tx.medicamento.create()`
//      invocation in D:\Projetos\...\unidadeMedicamento.js:111" — a mensagem não diz o
//      que ELA pode corrigir;
//   2. é vazamento de informação: caminho de arquivo, nome de tabela e estrutura
//      interna do servidor;
//   3. esconde o defeito, porque "apareceu um erro na tela" vira suporte e não
//      correção — o rastro que serve para investigar é o LOG, com stack.
//
// O handler global de `server.ts` JÁ segue esta regra (status 500 → "Erro interno do
// servidor", nunca `err.message`). O vazamento mora nos try/catch PRÓPRIOS dos
// controllers, que respondem antes de o erro chegar lá. Este módulo é o que esses
// catch usam para fazer a mesma coisa que o handler global faz.
//
// ⚠️ NÃO confundir com o erro de REGRA DE NEGÓCIO. `UnidadeIndisponivelError`,
// `FaturaPagaError` e afins carregam texto ESCRITO PARA A PESSOA ("este item já teve
// saída de estoque…") e devem continuar chegando inteiros à tela — eles têm `status` e
// `code` próprios, e é por isso que este helper os reconhece e os repassa.
'use strict';

const logger = require('./logger');

/**
 * Erro de regra de negócio é o que foi LANÇADO DE PROPÓSITO com status HTTP e texto
 * para a pessoa ler. O que vem de biblioteca (Prisma, rede, JSON) não tem `status`.
 */
function ehErroDeNegocio(err) {
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500 && typeof err?.message === 'string';
}

/**
 * Erros do Prisma que têm tradução honesta para quem está na tela.
 *
 * ⚠️ NADA de `err.meta.target` na resposta: ali vêm os NOMES DAS COLUNAS do banco
 * ("nome, formaFarmaceutica, apresentacao"), que é jargão interno — e, quando o índice
 * não está no schema, o próprio Prisma devolve "(not available)", o que na tela viraria
 * uma frase sem sentido.
 */
const PRISMA = {
  P2002: { status: 409, mensagem: 'Já existe um registro com esses dados.' },
  P2003: { status: 409, mensagem: 'Este registro está vinculado a outros e não pode ser alterado assim.' },
  P2025: { status: 404, mensagem: 'Registro não encontrado.' },
};

/**
 * Responde o erro SEM vazar nada do servidor, e registra o original no log.
 *
 * @param {object} res
 * @param {unknown} err
 * @param {object} opcoes
 * @param {string} opcoes.contexto   de onde veio, para achar no log ("ProdutoController.criar")
 * @param {string} opcoes.mensagem   o que a PESSOA lê quando não há tradução melhor
 * @returns a própria resposta, para o controller poder `return responderErro(...)`
 */
function responderErro(res, err, { contexto, mensagem }) {
  // Regra de negócio passa inteira — é texto escrito para ser lido.
  if (ehErroDeNegocio(err)) {
    return res.status(Number(err.status ?? err.statusCode)).json({
      sucesso:  false,
      error:    err.message,
      mensagem: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }

  // Quota de IA estourada não é erro do servidor: é limite do PLANO do cliente, e a
  // mensagem é escrita para ser lida ("o plano desta clínica atingiu o teto do mês").
  // Mesmo tratamento que o handler global de server.ts dá — 429 com o código, para a
  // tela distinguir "acabou a cota" de "deu erro".
  if (err?.code === 'IA_QUOTA_EXCEDIDA') {
    logger.warn(`${contexto} — quota de IA excedida`);
    return res.status(429).json({
      sucesso: false, code: 'IA_QUOTA_EXCEDIDA',
      error: err.message, mensagem: err.message,
    });
  }

  const traduzido = PRISMA[err?.code];

  // O log recebe TUDO: código, mensagem original e stack. É aqui que se investiga.
  logger.error(`${contexto}: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`, {
    stack: err?.stack,
  });

  const status = traduzido?.status ?? 500;
  const texto  = traduzido?.mensagem ?? mensagem;
  // `error` e `mensagem` juntos porque as telas leem ora um, ora outro; `sucesso`
  // acompanha o formato do handler global de `server.ts`.
  return res.status(status).json({ sucesso: false, error: texto, mensagem: texto });
}

module.exports = { responderErro, ehErroDeNegocio };
