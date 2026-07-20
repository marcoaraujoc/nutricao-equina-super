// backend/src/services/lembreteAgendamentoService.js
// Lembretes de agendamento por WhatsApp: D-1 (1 dia antes) e 2 horas antes.
// Idempotência via colunas de controle em tb_agendamentos_clinicos
// (lembreteWa1DiaEnviadoEm / lembreteWa2hEnviadoEm) — cada tier é disparado no
// máximo uma vez. O envio real é abstraído pelo whatsappProvider (noop por padrão),
// então o pipeline é testável sem credenciais (as mensagens aparecem no log).
'use strict';

const prisma = require('../lib/prisma').default;
const logger = require('../lib/logger');
const { getWhatsAppProvider } = require('../messaging/whatsappProvider');

const HORA_MS = 60 * 60 * 1000;

/** Normaliza telefone BR para formato internacional (55 + DDD + número). */
function foneIntl(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

function montarTexto(tier, ag) {
  const d     = new Date(ag.dataHora);
  const data  = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora  = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const quando = tier === '2H' ? 'hoje' : 'amanhã';
  const complemento = tier === '2H' ? ' (em cerca de 2 horas)' : '';
  const nomeProp = ag.animal?.user?.fullName ? `, ${ag.animal.user.fullName}` : '';
  return [
    `Olá${nomeProp}!`,
    `Lembrete: ${ag.titulo} de ${ag.animal?.nome ?? 'seu animal'} está agendado para ${quando}, ${data} às ${hora}${complemento}.`,
  ].join('\n');
}

/**
 * Varre agendamentos AGENDADO próximos e dispara os lembretes pendentes.
 * Chamada pelo cron; também isolável em teste (recebe `agora` opcional).
 * @param {Date} [agora]
 */
async function enviarLembretesWhatsapp(agora = new Date()) {
  const provider = getWhatsAppProvider();
  // Janela de varredura: do momento atual até ~26h à frente (cobre o tier de 24h
  // com folga; o tier de 2h é decidido pelo tempo restante de cada agendamento).
  const limite = new Date(agora.getTime() + 26 * HORA_MS);

  const agendamentos = await prisma.agendamentoClinico.findMany({
    where:   { ativo: true, status: 'AGENDADO', dataHora: { gte: agora, lte: limite } },
    include: { animal: { include: { user: { select: { fullName: true, phone: true } } } } },
  });

  let enviados = 0;

  for (const ag of agendamentos) {
    const msAte = new Date(ag.dataHora).getTime() - agora.getTime();
    const para  = foneIntl(ag.animal?.user?.phone);

    // Decide o tier: 2h tem prioridade sobre D-1 (se ambos ainda pendentes e
    // faltam <=2h, envia o de 2h). Um envio por execução por agendamento.
    let tier = null;
    if (msAte <= 2 * HORA_MS && !ag.lembreteWa2hEnviadoEm)   tier = '2H';
    else if (msAte <= 24 * HORA_MS && !ag.lembreteWa1DiaEnviadoEm) tier = '1DIA';
    if (!tier) continue;

    if (para) {
      try {
        await provider.enviarMensagem({
          para,
          texto:    montarTexto(tier, ag),
          // empresaId/equipeId do animal → provider Evolution resolve a instância da clínica
          contexto: { agendamentoId: ag.id, tier, empresaId: ag.animal?.empresaId ?? null, equipeId: ag.animal?.equipeId ?? null },
        });
        enviados++;
      } catch (err) {
        logger.warn(`[Lembrete-WA] Falha ao enviar (agendamento ${ag.id}, ${tier}): ${err.message}`);
      }
    } else {
      logger.warn(`[Lembrete-WA] Agendamento ${ag.id} sem telefone do proprietário — lembrete ${tier} ignorado.`);
    }

    // Marca como processado mesmo sem telefone (evita reprocessar a cada ciclo).
    await prisma.agendamentoClinico.update({
      where: { id: ag.id },
      data:  tier === '2H' ? { lembreteWa2hEnviadoEm: agora } : { lembreteWa1DiaEnviadoEm: agora },
    });
  }

  return { verificados: agendamentos.length, enviados };
}

module.exports = { enviarLembretesWhatsapp, montarTexto, foneIntl };
