'use strict';
// WhatsappService — fachada de WhatsApp para o RESTANTE da aplicação.
//
// ▸ Integração Evolution API (2026-07-18): cada clínica possui uma INSTÂNCIA
//   exclusiva. O escopo de "clínica" é o MESMO da EmpresaConfiguracao
//   (empresa CNPJ → equipeId null; empresa pessoal → equipe). O telefone é o
//   campo `whatsapp` JÁ CADASTRADO na configuração — reutilizado, nunca pedido
//   de novo. Nenhum módulo além do EvolutionService conversa com a Evolution;
//   nenhum módulo além deste conhece instância/URL/chaves.
// ▸ API legada Z-API (sendWhatsApp) preservada para compatibilidade
//   (AgendamentoController) — suprimida quando Z-API não configurado.
//
// NOTA: wa_instance/wa_status/wa_status_em são acessados via SQL parametrizado
// (client Prisma pode estar desatualizado — mesmo padrão de lib/auditoria.js).

const prisma           = require('../lib/prisma').default;
const logger           = require('../lib/logger');
const EvolutionService = require('./EvolutionService');

// ═══════════════════════ Evolution — persistência (raw SQL) ══════════════════

async function buscarConfigDoEscopo(empresaId, equipeId) {
  const rows = equipeId
    ? await prisma.$queryRawUnsafe(
        `SELECT id, whatsapp, wa_instance AS "waInstance", wa_status AS "waStatus", wa_status_em AS "waStatusEm"
           FROM schs2vet.tb_empresa_configuracoes WHERE "empresaId" = $1 AND "equipeId" = $2 LIMIT 1`,
        empresaId, equipeId)
    : await prisma.$queryRawUnsafe(
        `SELECT id, whatsapp, wa_instance AS "waInstance", wa_status AS "waStatus", wa_status_em AS "waStatusEm"
           FROM schs2vet.tb_empresa_configuracoes WHERE "empresaId" = $1 AND "equipeId" IS NULL LIMIT 1`,
        empresaId);
  return rows[0] ?? null;
}

async function criarConfigVazia(empresaId, equipeId) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO schs2vet.tb_empresa_configuracoes ("empresaId", "equipeId", "updatedAt")
     VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`,
    empresaId, equipeId ?? null);
  return buscarConfigDoEscopo(empresaId, equipeId);
}

async function salvarInstancia(configId, instanceName, status) {
  await prisma.$executeRawUnsafe(
    `UPDATE schs2vet.tb_empresa_configuracoes
        SET wa_instance = $1, wa_status = $2, wa_status_em = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $3`,
    instanceName, status, configId);
}

async function salvarStatus(configId, status) {
  await prisma.$executeRawUnsafe(
    `UPDATE schs2vet.tb_empresa_configuracoes
        SET wa_status = $1, wa_status_em = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $2`,
    status, configId);
}

// ═══════════════════════ Evolution — helpers ═════════════════════════════════

// Nome determinístico da instância da clínica (nunca exposto ao frontend)
function nomeInstancia(empresaId, equipeId) {
  return equipeId ? `s2vet_e${empresaId}_q${equipeId}` : `s2vet_e${empresaId}`;
}

// 'open' | 'connecting' | 'close' (Evolution) → status interno
function mapearEstado(state) {
  if (state === 'open')       return 'CONECTADO';
  if (state === 'connecting') return 'AGUARDANDO_QR';
  return 'DESCONECTADO';
}

// Resolve o escopo de configuração da clínica a partir de empresa(+equipe):
// empresa com CNPJ → equipeId null; empresa pessoal → equipe informada ou a 1ª.
async function resolverEscopoClinica(empresaId, equipeId = null) {
  const empresa = await prisma.empresa.findUnique({ where: { id: Number(empresaId) }, select: { id: true, cnpj: true } });
  if (!empresa) return null;
  if (empresa.cnpj) return { empresaId: empresa.id, equipeId: null };
  let eqId = equipeId ?? null;
  if (!eqId) {
    const eq = await prisma.equipe.findFirst({ where: { empresaId: empresa.id }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!eq) return null;
    eqId = eq.id;
  }
  return { empresaId: empresa.id, equipeId: eqId };
}

const jaExiste = (err) => /already in use|already exists/i.test(JSON.stringify(err?.detalhes ?? err?.message ?? ''));

// ═══════════════════════ Evolution — API pública ═════════════════════════════

/**
 * Garante a instância exclusiva da clínica na Evolution (idempotente).
 * Rollback: se a criação remota falhar, nada é salvo no banco.
 */
async function garantirInstancia(empresaId, equipeId = null) {
  let config = await buscarConfigDoEscopo(empresaId, equipeId);
  if (!config) config = await criarConfigVazia(empresaId, equipeId);
  if (!config) throw new Error('Configuração da clínica não encontrada');
  if (config.waInstance) return { config, instanceName: config.waInstance };

  const instanceName = nomeInstancia(empresaId, equipeId);
  try {
    await EvolutionService.createInstance(instanceName, { numero: config.whatsapp ?? null });
  } catch (err) {
    if (!jaExiste(err)) throw err; // instância órfã no servidor → apenas adota
  }
  await salvarInstancia(config.id, instanceName, 'DESCONECTADO');
  logger.info(`[WhatsappService] Instância registrada no banco: ${instanceName}`);
  return { config: { ...config, waInstance: instanceName, waStatus: 'DESCONECTADO' }, instanceName };
}

/**
 * Provisão automática ao CADASTRAR a clínica (best-effort, nunca lança):
 * falha vira log e a instância é criada depois, no primeiro "Conectar".
 */
async function provisionarPorEmpresa(empresaId) {
  try {
    if (!EvolutionService.configurado()) return;
    const escopo = await resolverEscopoClinica(empresaId);
    if (!escopo) return;
    await garantirInstancia(escopo.empresaId, escopo.equipeId);
    logger.info(`[WhatsappService] Instância provisionada para empresa ${empresaId}`);
  } catch (err) {
    logger.warn(`[WhatsappService] Provisão automática falhou (empresa ${empresaId}): ${err.message}`);
  }
}

/** Status persistido + estado ao vivo (sincroniza o banco). */
async function obterStatus(empresaId, equipeId = null) {
  const config = await buscarConfigDoEscopo(empresaId, equipeId);
  if (!config?.waInstance) {
    return { status: 'NAO_PROVISIONADO', temTelefone: Boolean(config?.whatsapp), atualizadoEm: null };
  }
  let status = config.waStatus ?? 'DESCONECTADO';
  try {
    const live   = await EvolutionService.getStatus(config.waInstance);
    const estado = live?.instance?.state ?? live?.state;
    if (estado) {
      status = mapearEstado(estado);
      if (status !== config.waStatus) await salvarStatus(config.id, status);
    }
  } catch { /* Evolution fora do ar → mantém o status persistido */ }
  return { status, temTelefone: Boolean(config.whatsapp), atualizadoEm: config.waStatusEm };
}

/** Conectar: garante instância, busca QR e marca AGUARDANDO_QR. */
async function conectar(empresaId, equipeId = null) {
  const { config, instanceName } = await garantirInstancia(empresaId, equipeId);
  const dados  = await EvolutionService.connect(instanceName);
  const base64 = dados?.base64 ?? dados?.qrcode?.base64 ?? null;
  const code   = dados?.code   ?? dados?.qrcode?.code   ?? null;
  if (base64 || code) {
    await salvarStatus(config.id, 'AGUARDANDO_QR');
    return { status: 'AGUARDANDO_QR', qrcodeBase64: base64, pairingCode: code };
  }
  // Sem QR na resposta = possivelmente já conectado → sincroniza
  const s = await obterStatus(empresaId, equipeId);
  return { status: s.status, qrcodeBase64: null, pairingCode: null };
}

async function desconectar(empresaId, equipeId = null) {
  const config = await buscarConfigDoEscopo(empresaId, equipeId);
  if (!config?.waInstance) return { status: 'NAO_PROVISIONADO' };
  try { await EvolutionService.logout(config.waInstance); }
  catch (err) { if (err.code !== 'INSTANCIA_NAO_ENCONTRADA') throw err; }
  await salvarStatus(config.id, 'DESCONECTADO');
  logger.info(`[WhatsappService] Instância desconectada: ${config.waInstance}`);
  return { status: 'DESCONECTADO' };
}

/** Reconectar = restart na Evolution + novo ciclo de conexão/QR. */
async function reconectar(empresaId, equipeId = null) {
  const config = await buscarConfigDoEscopo(empresaId, equipeId);
  if (config?.waInstance) {
    try { await EvolutionService.restart(config.waInstance); }
    catch (err) { if (err.code !== 'INSTANCIA_NAO_ENCONTRADA') throw err; }
  }
  return conectar(empresaId, equipeId);
}

/**
 * Envio de texto — API para o restante da aplicação.
 * @param {{empresaId:number, equipeId?:number}|number} clinic
 * @param {string} phone   — qualquer formato; normalizado internamente
 * @param {string} message
 */
async function sendMessage(clinic, phone, message) {
  const empresaId  = typeof clinic === 'object' ? clinic.empresaId : clinic;
  const equipeIdIn = typeof clinic === 'object' ? (clinic.equipeId ?? null) : null;

  const escopo = await resolverEscopoClinica(empresaId, equipeIdIn);
  if (!escopo) return { sucesso: false, erro: 'CLINICA_NAO_ENCONTRADA' };

  const config = await buscarConfigDoEscopo(escopo.empresaId, escopo.equipeId);
  if (!config?.waInstance) return { sucesso: false, erro: 'WHATSAPP_NAO_PROVISIONADO' };

  const { status } = await obterStatus(escopo.empresaId, escopo.equipeId);
  if (status !== 'CONECTADO') return { sucesso: false, erro: 'WHATSAPP_DESCONECTADO', status };

  const numero = formatPhone(phone);
  if (numero.length < 12) return { sucesso: false, erro: 'TELEFONE_INVALIDO' };

  try {
    const res = await EvolutionService.sendText(config.waInstance, numero, message);
    return { sucesso: true, id: res?.key?.id ?? null };
  } catch (err) {
    logger.error(`[WhatsappService] Falha no envio (empresa ${empresaId}): ${err.message}`);
    return { sucesso: false, erro: err.code ?? 'ERRO_ENVIO' };
  }
}

/** Atualização de status vinda do WEBHOOK da Evolution (por instância). */
async function atualizarStatusPorInstancia(instanceName, statusInterno) {
  const count = await prisma.$executeRawUnsafe(
    `UPDATE schs2vet.tb_empresa_configuracoes
        SET wa_status = $1, wa_status_em = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE wa_instance = $2`,
    statusInterno, instanceName);
  if (count > 0) logger.info(`[WhatsappService] Webhook: ${instanceName} → ${statusInterno}`);
  return count > 0;
}

// ═══════════════════════ API legada (Z-API) — compatibilidade ════════════════

const ZAPI_BASE = 'https://api.z-api.io';

function isConfigured() {
  return !!(process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN);
}

// Normaliza telefone para formato internacional sem + (ex: 5511999999999)
function formatPhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  return digits;
}

/**
 * (Legado) Envia texto via Z-API global — mantido para os callers existentes.
 * Silencioso se Z-API não estiver configurado ou telefone ausente.
 */
async function sendWhatsApp(phone, message) {
  if (!isConfigured()) {
    console.info('[whatsapp] Z-API não configurado (ZAPI_INSTANCE_ID/ZAPI_TOKEN ausentes) — mensagem suprimida');
    return { sent: false, reason: 'not_configured' };
  }

  if (!phone) {
    return { sent: false, reason: 'no_phone' };
  }

  const phoneFormatted = formatPhone(phone);
  if (phoneFormatted.length < 12) {
    console.warn(`[whatsapp] Telefone inválido: "${phone}" → "${phoneFormatted}"`);
    return { sent: false, reason: 'invalid_phone' };
  }

  const { ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_SECURITY_TOKEN } = process.env;
  const url = `${ZAPI_BASE}/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`;

  const headers = { 'Content-Type': 'application/json' };
  if (ZAPI_SECURITY_TOKEN) headers['Client-Token'] = ZAPI_SECURITY_TOKEN;

  try {
    const response = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ phone: phoneFormatted, message }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[whatsapp] Erro ao enviar para ${phoneFormatted}: ${response.status} — ${err}`);
      return { sent: false, reason: `api_error_${response.status}` };
    }

    const data = await response.json();
    console.info(`[whatsapp] Mensagem enviada → ${phoneFormatted}`);
    return { sent: true, data };
  } catch (err) {
    console.error(`[whatsapp] Falha de rede: ${err.message}`);
    return { sent: false, reason: 'network_error' };
  }
}

module.exports = {
  // Evolution (instância por clínica)
  garantirInstancia,
  provisionarPorEmpresa,
  obterStatus,
  conectar,
  desconectar,
  reconectar,
  sendMessage,
  atualizarStatusPorInstancia,
  mapearEstado,
  // Legado (Z-API global) — não remover: AgendamentoController depende
  sendWhatsApp,
  isConfigured,
};
