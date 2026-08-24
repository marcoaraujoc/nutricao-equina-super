// backend/src/services/lembreteAgendamentoService.js
// Lembretes de agendamento por WhatsApp: 1 hora antes e 15 minutos antes, enviados
// tanto ao proprietário quanto ao veterinário responsável.
//
// Idempotência via colunas de controle em tb_agendamentos_clinicos
// (lembreteWa1hEnviadoEm / lembreteWa15minEnviadoEm) — cada tier dispara no máximo
// uma vez. Regra exata (cron roda a cada poucos minutos):
//   faltam > 60min                          → nada
//   faltam <= 60min, flag 1h NÃO marcada    → envia, marca flag 1h
//   faltam <= 60min, flag 1h JÁ marcada     → nada (mesmo se também <=15min, até
//                                              a 1h já ter sido processada)
//   faltam <= 15min, flag 15min NÃO marcada → envia, marca flag 15min
//   faltam <= 15min, flag 15min JÁ marcada  → nada
// O envio real é abstraído pelo whatsappProvider (noop por padrão), então o
// pipeline é testável sem credenciais (as mensagens aparecem no log).
'use strict';

const prisma = require('../lib/prisma').default;
const { fusoDaEmpresa, formatarDataNaEmpresa, formatarHoraNaEmpresa } = require('../lib/fusoEmpresa');
const logger = require('../lib/logger');
const { getWhatsAppProvider } = require('../messaging/whatsappProvider');

const MINUTO_MS = 60 * 1000;
const TIER_1H_MIN    = 60;
const TIER_15MIN_MIN = 15;

/** Normaliza telefone BR para formato internacional (55 + DDD + número). */
function foneIntl(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

// "A consulta do(a) <Animal> está agendada para <Dia> às <horas> com o Dr(a) <Veterinário>"
// 🔴 Data e hora no FUSO DA CLÍNICA, não em Brasília fixo: a mensagem vai para o
// PROPRIETÁRIO, que está na praça da clínica. Numa clínica de Manaus (UTC−4) o aviso
// anunciava a consulta 1h adiantada — e, para consulta no início da manhã, no DIA
// ERRADO (07:00 de Manaus é 08:00 em Brasília; 23:00 vira 00:00 do dia seguinte).
function montarTexto(ag, fuso) {
  const dia  = formatarDataNaEmpresa(ag.dataHora, fuso);
  const hora = formatarHoraNaEmpresa(ag.dataHora, fuso);
  const animalNome = ag.animal?.nome ?? 'seu animal';
  const vetNome    = ag.veterinario?.fullName ? `Dr(a) ${ag.veterinario.fullName}` : 'o(a) veterinário(a) responsável';
  return `A consulta do(a) ${animalNome} está agendada para ${dia} às ${hora} com o ${vetNome}`;
}

async function enviarPara(provider, telefone, texto, contexto) {
  const para = foneIntl(telefone);
  if (!para) return false;
  await provider.enviarMensagem({ para, texto, contexto });
  return true;
}

/**
 * Varre agendamentos AGENDADO/ATRASADA próximos e dispara os lembretes pendentes
 * (1h e 15min antes), para proprietário e veterinário. Chamada pelo cron; também
 * isolável em teste (recebe `agora` opcional).
 * @param {Date} [agora]
 */
// ⚠️ Recebe a EMPRESA, não o cliente da transação — e a diferença é o ponto principal.
//
// O cron chama esta função uma vez por empresa ativa (`paraCadaEmpresaComEnvio`), SEM
// transação aberta. Aqui dentro há três momentos, nesta ordem, e eles NÃO podem virar
// um só:
//   1. LER a janela  → transação curta, com o tenant carimbado;
//   2. ENVIAR        → FORA de qualquer transação (é rede);
//   3. MARCAR o flag → transação curta e INDEPENDENTE, por agendamento.
//
// Envolver os três numa transação só (como cheguei a fazer) tem duas consequências: o
// rollback desfaz os flags mas NÃO desfaz as mensagens já enviadas — o cliente recebe
// tudo de novo cinco minutos depois —, e a transação fica aberta durante todas as
// chamadas ao provedor, segurando conexão do pool.
async function enviarLembretesWhatsapp(empresaId, agora = new Date()) {
  const fuso = await fusoDaEmpresa(empresaId);
  const { comTenant } = require('../lib/tenantDb');
  const provider = getWhatsAppProvider();
  // Janela de varredura: até 60min à frente (o tier mais distante) + folga.
  const limite = new Date(agora.getTime() + (TIER_1H_MIN + 5) * MINUTO_MS);

  // 1. LEITURA — transação curta, só para trazer a janela desta empresa.
  const agendamentos = await comTenant(empresaId, (tx) => tx.agendamentoClinico.findMany({
    where: {
      ativo: true, status: { in: ['AGENDADO', 'ATRASADA'] },
      dataHora: { gte: agora, lte: limite },
    },
    include: {
      animal:      { include: { user: { select: { fullName: true, phone: true } } } },
      veterinario: { select: { fullName: true, phone: true } },
    },
  }));

  let enviados = 0;
  // Detalhe por envio (quem recebeu, o quê) — exibido na tela de Monitoração ao
  // clicar na execução, para o admin poder auditar o que o cron realmente mandou.
  const detalhes = [];

  for (const ag of agendamentos) {
    const minutosAte = (new Date(ag.dataHora).getTime() - agora.getTime()) / MINUTO_MS;

    // Um único tier por execução: 1h tem prioridade (só cai para 15min depois que
    // o flag de 1h já estiver marcado, conforme a regra especificada).
    let tier = null;
    if (minutosAte <= TIER_1H_MIN && !ag.lembreteWa1hEnviadoEm) tier = '1H';
    else if (minutosAte <= TIER_15MIN_MIN && !ag.lembreteWa15minEnviadoEm) tier = '15MIN';
    if (!tier) continue;

    const texto     = montarTexto(ag, fuso);
    const contexto  = { agendamentoId: ag.id, tier, empresaId: ag.animal?.empresaId ?? null, equipeId: ag.animal?.equipeId ?? null };
    const tierLabel = tier === '1H' ? '1h antes' : '15min antes';
    const animalNome = ag.animal?.nome ?? `agendamento #${ag.id}`;
    const destinatarios = [];

    try {
      const okProp = await enviarPara(provider, ag.animal?.user?.phone, texto, contexto);
      const okVet  = await enviarPara(provider, ag.veterinario?.phone, texto, contexto);
      if (okProp) { enviados++; destinatarios.push(`proprietário ${ag.animal?.user?.fullName ?? ''} (${ag.animal?.user?.phone})`); }
      if (okVet)  { enviados++; destinatarios.push(`Dr(a) ${ag.veterinario?.fullName ?? ''} (${ag.veterinario?.phone})`); }
      if (!okProp) logger.warn(`[Lembrete-WA] Agendamento ${ag.id} sem telefone do proprietário — lembrete ${tier} ao proprietário ignorado.`);
      if (!okVet)  logger.warn(`[Lembrete-WA] Agendamento ${ag.id} sem telefone do veterinário — lembrete ${tier} ao veterinário ignorado.`);
    } catch (err) {
      logger.warn(`[Lembrete-WA] Falha ao enviar (agendamento ${ag.id}, ${tier}): ${err.message}`);
    }

    if (destinatarios.length > 0) {
      detalhes.push(`[${animalNome} · ${tierLabel}] Para: ${destinatarios.join('; ')}\nMensagem: "${texto}"`);
    }

    // 3. MARCA o flag — transação PRÓPRIA, já com a mensagem fora do caminho. Marca
    // mesmo sem telefone (evita reprocessar o mesmo tier a cada ciclo). Commit por
    // agendamento: uma falha adiante não desfaz o que já foi avisado.
    await comTenant(empresaId, (tx) => tx.agendamentoClinico.update({
      where: { id: ag.id },
      data:  tier === '1H' ? { lembreteWa1hEnviadoEm: agora } : { lembreteWa15minEnviadoEm: agora },
    }));
  }

  return { verificados: agendamentos.length, enviados, detalhes };
}

module.exports = { enviarLembretesWhatsapp, montarTexto, foneIntl };
