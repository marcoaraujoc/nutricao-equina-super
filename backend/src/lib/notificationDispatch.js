// backend/src/lib/notificationDispatch.js
//
// Ponto ÚNICO de despacho do envio de um link público de fatura (WhatsApp ou
// e-mail) — e o ponto de troca para uma fila real (Redis/BullMQ) no dia em que
// isso for necessário. Ver docs/NOTIFICACOES-PUSH-PLANO.md §11-§12: a análise
// daquele documento (Redis avaliado e recomendado NÃO instalar agora — instância
// única, sem estado de sessão, volume baixo) se aplica igualmente aqui, e o
// padrão que ele propõe (`enfileirarEnvio()` como função de UMA linha, hoje
// síncrona) é o que esta função segue.
//
// HOJE: tenta enviar NA HORA (mesmo comportamento que o usuário já vê — clicou
// em "Enviar", ou dá certo ou o cron tenta de novo mais tarde) e grava o
// resultado via `faturaLinkPublico.registrarEnvio`. O reenvio automático em
// caso de falha é feito por `services/faturaLinkCronService.js`, varrendo
// `FaturaLinkPublico.status`/`proximaTentativaEm` — não por esta função.
//
// NO DIA DA TROCA para fila real, a única mudança é o CORPO de
// `enfileirarEnvioFatura`: em vez de `await tentativaFn()` na hora, published
// `filaFatura.add('enviar-link', { linkId, tentativaFn: ... }, { attempts: 5,
// backoff: 'exponential' })`, e um Worker novo (`jobs/faturaLinkWorker.js`)
// consome a fila chamando a MESMA `tentativaFn`. `FaturaController` e o cron
// de reenvio não mudam nenhuma linha — os dois já chamam só esta função.
'use strict';

const { registrarEnvio } = require('./faturaLinkPublico');

/**
 * @param {number} linkId
 * @param {() => Promise<{ sucesso:boolean, erro?:string }>} tentativaFn
 *   Executa UMA tentativa de envio (WhatsApp ou e-mail) e devolve o resultado.
 *   Erros lançados são tratados como falha (não propagam ao chamador).
 * @returns {Promise<{ sucesso:boolean, erro?:string }>}
 */
async function enfileirarEnvioFatura(linkId, tentativaFn) {
  let resultado;
  try {
    resultado = await tentativaFn();
  } catch (err) {
    resultado = { sucesso: false, erro: err.message };
  }

  await registrarEnvio(linkId, resultado);
  return resultado;
}

module.exports = { enfileirarEnvioFatura };
