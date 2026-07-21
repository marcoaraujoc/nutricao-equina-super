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
function montarTexto(ag) {
  const d    = new Date(ag.dataHora);
  const dia  = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
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
async function enviarLembretesWhatsapp(agora = new Date()) {
  const provider = getWhatsAppProvider();
  // Janela de varredura: até 60min à frente (o tier mais distante) + folga.
  const limite = new Date(agora.getTime() + (TIER_1H_MIN + 5) * MINUTO_MS);

  const agendamentos = await prisma.agendamentoClinico.findMany({
    where: {
      ativo: true, status: { in: ['AGENDADO', 'ATRASADA'] },
      dataHora: { gte: agora, lte: limite },
    },
    include: {
      animal:      { include: { user: { select: { fullName: true, phone: true } } } },
      veterinario: { select: { fullName: true, phone: true } },
    },
  });

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

    const texto     = montarTexto(ag);
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

    // Marca o flag mesmo sem telefone (evita reprocessar o mesmo tier a cada ciclo).
    await prisma.agendamentoClinico.update({
      where: { id: ag.id },
      data:  tier === '1H' ? { lembreteWa1hEnviadoEm: agora } : { lembreteWa15minEnviadoEm: agora },
    });
  }

  return { verificados: agendamentos.length, enviados, detalhes };
}

module.exports = { enviarLembretesWhatsapp, montarTexto, foneIntl };
