// backend/src/services/faturaLinkCronService.js
// Reenvio AUTOMÁTICO do link público de fatura (WhatsApp/e-mail) quando a
// tentativa síncrona — feita na hora do clique em "Enviar" — falhou. Ver
// lib/faturaLinkPublico.js (registrarEnvio, backoff) e
// lib/notificationDispatch.js (ponto de troca para fila real).
//
// Mesmo padrão de I/O externo de services/lembreteAgendamentoService.js: LER a
// janela dentro de uma transação curta (`comTenant`), ENVIAR fora de qualquer
// transação (é rede), MARCAR o resultado numa transação curta e independente
// por link — nunca as três coisas dentro de uma transação só (ver
// lib/cronTenant.js, o comentário sobre "rollback não desfaz mensagem enviada").
'use strict';

const logger = require('../lib/logger');
const whatsappService = require('./whatsappService');
const emailService = require('./emailService');
const { MAX_TENTATIVAS_ENVIO } = require('../lib/faturaLinkPublico');
const { enfileirarEnvioFatura } = require('../lib/notificationDispatch');

function urlDoLink(token) {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${appUrl}/#/fatura/${token}`;
}

/**
 * Reenvia os links PENDENTES/FALHOS da empresa cuja `proximaTentativaEm` já
 * chegou. Chamada pelo cron, uma vez por empresa ativa (`paraCadaEmpresaComEnvio`).
 *
 * ⚠️ O texto do reenvio é o PADRÃO do canal (não o texto customizado que o vet
 * digitou no clique original — esse não é persistido, de propósito: o essencial
 * a preservar no retry é o LINK, não a mensagem de acompanhamento). Documentado
 * aqui porque é uma degradação intencional, não um esquecimento.
 *
 * @param {number} empresaId
 * @param {Date} [agora]
 * @returns {Promise<{ verificados:number, enviados:number, detalhes:string[] }>}
 */
async function reenviarLinksPendentes(empresaId, agora = new Date()) {
  const { comTenant } = require('../lib/tenantDb');

  const links = await comTenant(empresaId, (tx) => tx.faturaLinkPublico.findMany({
    where: {
      empresaId,
      status:             { in: ['PENDENTE', 'FALHOU'] },
      revogadoEm:         null,
      expiraEm:           { gt: agora },
      tentativas:         { lt: MAX_TENTATIVAS_ENVIO },
      OR: [
        { proximaTentativaEm: { lte: agora } },
        { proximaTentativaEm: null, status: 'PENDENTE' }, // 1ª tentativa síncrona nunca rodou/foi perdida
      ],
    },
    select: {
      id: true, token: true, canal: true, destino: true,
      fatura: { select: { proprietario: { select: { fullName: true } } } },
    },
  }));

  let enviados = 0;
  const detalhes = [];

  for (const link of links) {
    if (!link.canal || !link.destino) {
      logger.warn(`[FaturaLink-Retry] Link ${link.id} sem canal/destino gravado — ignorado.`);
      continue;
    }
    const url = urlDoLink(link.token);

    const resultado = await enfileirarEnvioFatura(link.id, async () => {
      if (link.canal === 'WHATSAPP') {
        // `equipeId` não é persistido no link (empresa CNPJ não precisa dele; empresa
        // pessoal/CPF cai no fallback de resolverEscopoClinica — 1ª equipe da empresa).
        const mensagem = `📄 Abra a fatura pelo link: ${url}`;
        const res = await whatsappService.sendMessage({ empresaId, equipeId: null }, link.destino, mensagem);
        return res?.sucesso ? { sucesso: true } : { sucesso: false, erro: res?.erro ?? 'ERRO_ENVIO' };
      }
      if (link.canal === 'EMAIL') {
        if (!emailService.estaConfigurado()) return { sucesso: false, erro: 'EMAIL_NAO_CONFIGURADO' };
        await emailService.enviarLinkFatura({
          proprietarioEmail: link.destino,
          proprietarioNome:  link.fatura?.proprietario?.fullName ?? 'Cliente',
          assunto: 'Sua fatura está disponível',
          corpo: '',
          url,
        });
        return { sucesso: true };
      }
      return { sucesso: false, erro: 'CANAL_DESCONHECIDO' };
    });

    if (resultado.sucesso) {
      enviados++;
      detalhes.push(`[link ${link.id} · ${link.canal}] reenviado para ${link.destino}`);
    } else {
      detalhes.push(`[link ${link.id} · ${link.canal}] falhou de novo: ${resultado.erro}`);
    }
  }

  return { verificados: links.length, enviados, detalhes };
}

module.exports = { reenviarLinksPendentes };
