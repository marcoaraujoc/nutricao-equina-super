'use strict';

const prisma       = require('../lib/prisma').default;
const logger       = require('../lib/logger');
const emailService = require('./emailService');
// Reaproveita o resolvedor de destinatários do alerta de cron (CronAlertaConfig →
// ADMIN_ALERT_EMAIL → todo userType=ADMIN) — é a mesma pergunta ("quem é o ADMIN
// que deve ser avisado?"), só que fora do contexto de uma tarefa agendada.
const { getConfig: getConfigAlerta, getEmailsAlerta } = require('../lib/cronAlert');

const CRMV_REGEX = /^(\d{1,6})\/(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i;

async function validarCRMV(crmv) {
  const match = (crmv ?? '').trim().toUpperCase().match(CRMV_REGEX);
  if (!match) return { valido: false, motivo: 'formato_invalido' };

  const [, numeroStr, uf] = match;
  const numero = Number(numeroStr);

  // Rollout por UF (ver crmvScraperService.js#MAX_POR_UF): enquanto o índice não
  // tiver NENHUM registro daquele estado (nunca varrido, ou ainda fora do piloto),
  // não dá pra afirmar nada — devolve "desconhecido" em vez de "não encontrado",
  // pra não travar o cadastro de um veterinário legítimo só porque o estado dele
  // ainda não foi varrido. Checagem é POR UF, não pelo total geral do índice.
  const totalDoEstado = await prisma.crmvValido.count({ where: { uf } });
  if (totalDoEstado === 0) {
    return { valido: null, motivo: 'estado_nao_sincronizado' };
  }

  const encontrado = await prisma.crmvValido.findUnique({ where: { numero_uf: { numero, uf } } });

  return encontrado
    ? { valido: true,  uf }
    : { valido: false, motivo: 'nao_encontrado' };
}

// ── Verificação SILENCIOSA no cadastro — nunca bloqueia (2026) ────────────────
// Decisão de produto: o índice do CFMV é uma cópia raspada, sempre incompleta por
// natureza (ver a nota de cobertura em crmvScraperService.js — nomes comuns como
// "Laura"/"Marina" já ficaram fora mesmo com uma sincronização "bem-sucedida").
// Travar o cadastro de um profissional real por um buraco de raspagem é pior do
// que deixar passar um número digitado errado. Por isso:
//   - `UserController.updateMe` NUNCA usa o resultado desta função para barrar o
//     salvamento — o cadastro é sempre gravado com o CRMV informado.
//   - O usuário NUNCA vê se o número "bateu" ou não no índice (a tela de Cadastro
//     Pessoal não exibe mais nenhum status de verificação).
//   - Quando o índice não confirma o número, quem decide se é erro de digitação
//     ou tentativa de fraude é o ADMIN, avisado por e-mail — nunca uma tela
//     bloqueando o profissional.
// Fire-and-forget por natureza: falha ao notificar não pode derrubar o cadastro.
async function notificarAdminSeNaoEncontrado({ crmv, nome, telefone, tipoUsuario }) {
  try {
    const resultado = await validarCRMV(crmv);
    if (!(resultado.valido === false && resultado.motivo === 'nao_encontrado')) return;

    const config = await getConfigAlerta();
    const para   = await getEmailsAlerta(config);
    if (para.length === 0) {
      logger.warn('[CRMV] Nenhum destinatário ADMIN configurado para o alerta de CRMV não encontrado');
      return;
    }

    await emailService.enviarCrmvNaoEncontrado({ para, nome, telefone, tipoUsuario, crmv });
  } catch (err) {
    logger.error(`[CRMV] Falha ao notificar ADMIN sobre CRMV não encontrado: ${err.message}`);
  }
}

async function statusIndice() {
  const [total, syncLog] = await Promise.all([
    prisma.crmvValido.count(),
    prisma.crmvSyncLog.findFirst({ orderBy: { executadoEm: 'desc' } }),
  ]);

  return {
    totalCrmvs:           total,
    ultimaSincronizacao:  syncLog?.executadoEm      ?? null,
    duracao:              syncLog?.duracao           ?? null,
    sucesso:              syncLog?.sucesso           ?? null,
    erro:                 syncLog?.erro              ?? null,
    totalAdicionados:     syncLog?.totalAdicionados  ?? null,
    totalRemovidos:       syncLog?.totalRemovidos    ?? null,
  };
}

module.exports = { validarCRMV, statusIndice, notificarAdminSeNaoEncontrado };