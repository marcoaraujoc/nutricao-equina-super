// backend/src/services/lembreteDosePrescricaoService.js
// Aviso de WhatsApp para TODA A EQUIPE, 15 minutos antes da PRÓXIMA DOSE de cada
// item de prescrição elegível ao fluxo por dose (ver lib/agendaDoses.js).
//
// Idempotência via `Prescricao.proximaDoseAvisoEnviado`: guarda QUAL
// `proximaDoseEm` já recebeu o aviso. Como o horário é ROLLING (recalculado a cada
// execução — uma dose antecipada/atrasada desloca a próxima), comparar os dois
// campos resolve idempotência E reenvio na mesma condição, sem precisar de uma
// segunda coluna "já avisado" + lógica de expiração.
//
// Mesmo padrão de três momentos do `lembreteAgendamentoService.js` (LER → ENVIAR →
// MARCAR, nunca dentro da mesma transaction): envolver o envio (rede) numa
// transação seguraria conexão do pool pelo tempo de todas as chamadas ao provedor,
// e um rollback não desfaria mensagem já enviada.
'use strict';

const logger = require('../lib/logger');
const { comTenant } = require('../lib/tenantDb');
const { getWhatsAppProvider } = require('../messaging/whatsappProvider');
const { aplicarPerfilEmLista } = require('../lib/profissionalPerfil');
const { elegivelParaFluxoNovo, dosesTotaisEsperadas } = require('../lib/agendaDoses');
const { fusoDaEmpresa, formatarHoraNaEmpresa } = require('../lib/fusoEmpresa');

const MINUTO_MS = 60 * 1000;
const JANELA_MIN = 15;

/** Normaliza telefone BR para formato internacional (55 + DDD + número). */
function foneIntl(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

// 🔴 O horário sai no FUSO DA CLÍNICA, não em `America/Sao_Paulo` fixo. A mensagem
// vai para o WhatsApp de quem vai aplicar a dose: para uma equipe em Manaus (UTC−4),
// o texto anunciava a dose 1h adiantada em relação ao relógio dela.
function montarTexto(item, animalNome, fuso) {
  const hora = formatarHoraNaEmpresa(item.proximaDoseEm, fuso);
  return `Faltam ${JANELA_MIN} minutos para a próxima dose de ${item.medicamento} de ${animalNome} (às ${hora}).`;
}

async function enviarPara(provider, telefone, texto, contexto) {
  const para = foneIntl(telefone);
  if (!para) return false;
  await provider.enviarMensagem({ para, texto, contexto });
  return true;
}

/**
 * Varre os itens de prescrição da empresa com próxima dose nos próximos 15min e
 * ainda sem aviso enviado para ESSE horário, e dispara o WhatsApp para todos os
 * membros da equipe do animal (ou de qualquer equipe da empresa, sem uma equipe
 * própria do animal). Chamada pelo cron via `paraCadaEmpresaComEnvio`.
 * @param {number} empresaId
 * @param {Date} [agora]
 */
async function enviarLembretesDosePrescricao(empresaId, agora = new Date()) {
  const provider = getWhatsAppProvider();
  const limite = new Date(agora.getTime() + JANELA_MIN * MINUTO_MS);
  const fuso   = await fusoDaEmpresa(empresaId);

  // 1. LEITURA — transação curta, com o tenant carimbado.
  const itens = await comTenant(empresaId, (tx) => tx.prescricao.findMany({
    where: {
      ativo:      true,
      // 🔴 `horaInicio: { not: null }` saiu daqui (2026-08-23): Hora Início virou
      // opcional e o item sem ela ganha horário real assim que a 1ª dose é dada.
      // Quem prova que existe horário agendado é `proximaDoseEm` — que é também o
      // valor exibido no texto do aviso (`montarTexto`). Filtrar por `horaInicio`
      // deixaria justamente o curso já em andamento sem lembrete.
      frequencia: { notIn: ['agora', 'SOS', 'seNecessario'] },
      aplicadaPeloProprietario: false,
      proximaDoseEm: { gte: agora, lte: limite },
      grupo: { status: { in: ['FINALIZADO', 'CANCELADO_PARCIALMENTE'] } },
    },
    include: {
      animal: { select: { id: true, nome: true, equipeId: true } },
      grupo:  { select: { id: true, empresaId: true } },
    },
  }));

  let enviados = 0;
  const detalhes = [];

  for (const item of itens) {
    // Guard fino: `dosesTotaisEsperadas` não dá para expressar direto no WHERE
    // (é derivado de frequência × duração) — item já com todas as doses dadas não
    // deveria ter `proximaDoseEm` futuro, mas confere por segurança.
    if (!elegivelParaFluxoNovo(item) || (item.dosesExecutadas ?? 0) >= dosesTotaisEsperadas(item)) continue;
    // Idempotência + reenvio: só dispara se este horário específico ainda não foi avisado.
    const jaAvisado = item.proximaDoseAvisoEnviado
      && new Date(item.proximaDoseAvisoEnviado).getTime() === new Date(item.proximaDoseEm).getTime();
    if (jaAvisado) continue;

    const animalNome = item.animal?.nome ?? `paciente #${item.animalId}`;
    const texto       = montarTexto(item, animalNome, fuso);
    const contexto     = { prescricaoId: item.id, empresaId, equipeId: item.animal?.equipeId ?? null };

    // "Toda a equipe": todos os membros das equipes da empresa (ou só a do animal,
    // quando ele tiver uma equipe própria — mesmo escopo usado no resto do
    // atendimento clínico), com telefone cadastrado NAQUELA empresa.
    const membros = await comTenant(empresaId, async (tx) => {
      const equipeIds = item.animal?.equipeId
        ? [item.animal.equipeId]
        : (await tx.equipe.findMany({ where: { empresaId }, select: { id: true } })).map(e => e.id);
      if (equipeIds.length === 0) return [];
      const vinculos = await tx.membroEquipe.findMany({
        where:   { equipeId: { in: equipeIds } },
        include: { user: { select: { id: true, fullName: true, phone: true } } },
      });
      const users = vinculos.map(v => v.user);
      return aplicarPerfilEmLista(users, empresaId, tx);
    });

    const destinatarios = [];
    try {
      for (const membro of membros) {
        const ok = await enviarPara(provider, membro.phone, texto, contexto);
        if (ok) { enviados++; destinatarios.push(`${membro.fullName ?? ''} (${membro.phone})`); }
      }
    } catch (err) {
      logger.warn(`[Lembrete-Dose-WA] Falha ao enviar (prescrição item ${item.id}): ${err.message}`);
    }

    if (destinatarios.length > 0) {
      detalhes.push(`[${animalNome} · ${item.medicamento}] Para: ${destinatarios.join('; ')}\nMensagem: "${texto}"`);
    } else {
      logger.warn(`[Lembrete-Dose-WA] Item ${item.id}: nenhum membro da equipe com telefone — aviso não enviado a ninguém.`);
    }

    // 3. MARCA o flag — transação PRÓPRIA, já com o envio fora do caminho. Marca
    // mesmo sem nenhum destinatário (evita reprocessar o mesmo horário a cada ciclo).
    await comTenant(empresaId, (tx) => tx.prescricao.update({
      where: { id: item.id },
      data:  { proximaDoseAvisoEnviado: item.proximaDoseEm },
    }));
  }

  return { verificados: itens.length, enviados, detalhes };
}

module.exports = { enviarLembretesDosePrescricao, montarTexto, foneIntl };
