// backend/src/services/evolucaoCronService.js
//
// FINALIZAÇÃO AUTOMÁTICA DE ATENDIMENTO ABANDONADO.
//
// 🔴 POR QUE ESTE ARQUIVO NASCEU EM 2026-09-18: a rotina foi relatada como "já existe e
// não está executando". Ela NUNCA EXISTIU. O que existe é
// `agendamentoCronService.cancelarAgendamentosNaoRealizados`, que encerra o AGENDAMENTO
// pendurado em EM_ANDAMENTO — e que deixava a EVOLUÇÃO de fora DE PROPÓSITO, com o
// motivo escrito no próprio arquivo e no CLAUDE.md (sessão 2026-08-18, parte 2):
// "fechá-la sozinha é uma decisão maior do que a desta rotina".
// Essa decisão foi agora REVERTIDA a pedido — mas a cautela que a motivou continua
// valendo e virou a janela de 48h e a regra de autoria abaixo.
//
// CONSEQUÊNCIA de não existir, medida no comportamento: o agendamento era encerrado
// no fim do dia e a evolução ficava EM_ANDAMENTO para sempre. Ela seguia no banner
// "Atendimento em andamento", ocupava o bloqueio de "evolução própria já aberta"
// (`EvolucaoController.criar` recusa 400 quando a pessoa tem uma aberta para o mesmo
// agendamento) e mantinha prescrição/vacina SALVAS presas fora do plantão.
'use strict';

const prisma = require('../lib/prisma').default;
const { cascataDaFinalizacao } = require('../lib/finalizacaoEvolucao');
const { invalidarVersoes } = require('../lib/concorrenciaRegistro');
const { passo } = require('../lib/cronTrace');

// Texto gravado na justificativa, a pedido (2026-09-18). É ele que aparece na coluna
// "Justificativa" das listas do módulo Atendimento.
const JUSTIFICATIVA_SISTEMA = 'Finalizada pelo Sistema';

// ⚠️ 48h, contadas da ABERTURA (`dataInicio`), e não "do fim do dia" como no cron do
// agendamento. O atendimento legítimo que atravessa a virada da meia-noite — internação,
// plantão noturno, o vet que escreve a evolução na manhã seguinte — não pode ser fechado
// por baixo de quem ainda está escrevendo nele. Dois dias inteiros é o que separa
// "ainda em curso" de "ninguém voltou aqui".
const HORAS_ATE_FINALIZAR = 48;

/**
 * Finaliza as evoluções EM_ANDAMENTO abertas há mais de 48h.
 *
 * Roda POR EMPRESA (`lib/cronTenant.js`), então `db` é o CLIENTE DA TRANSAÇÃO com o
 * tenant já carimbado — o RLS limita a varredura à clínica da vez. Chamar sem `db`
 * depois da fase 7c é rodar sem tenant, e o RLS devolve zero linha.
 *
 * ⚠️ `veterinarioId` NÃO É REESCRITO. No Finalizar normal quem finaliza vira o
 * responsável porque ESCOLHEU fechar e responde pelo que declara; aqui ninguém conduziu
 * nada — é consequência administrativa, e carimbar um nome no prontuário alheio seria
 * falsear a autoria clínica. Mesma regra da finalização por inativação do paciente
 * (CLAUDE.md, 2026-09-06). Pelo mesmo motivo `porUsuarioId` vai `null` na cascata:
 * `finalizadoPorId` é `Int?` e "o sistema" não é um usuário.
 *
 * @returns ResultadoCron para o comAlerta/reportarCron (Monitoração + e-mail ADMIN).
 */
async function finalizarEvolucoesAbandonadas(db = prisma) {
  const limite = new Date(Date.now() - HORAS_ATE_FINALIZAR * 60 * 60 * 1000);

  const abertas = await db.evolucaoClinica.findMany({
    where:  { status: 'EM_ANDAMENTO', ativo: true, dataInicio: { lt: limite } },
    select: { id: true, animalId: true, agendamentoId: true, numero: true, dataInicio: true },
    orderBy: { dataInicio: 'asc' },
  });

  if (abertas.length === 0) return { ok: true, notificar: false };

  passo(`Evoluções abertas há mais de ${HORAS_ATE_FINALIZAR}h: ${abertas.length}`,
    { ids: abertas.map(e => e.id).join(',') });

  const agora = new Date();
  for (const ev of abertas) {
    // A cascata PRIMEIRO: é ela que leva prescrição SALVA e vacina SALVA ao plantão e
    // encerra o agendamento de origem. Sem ela, o atendimento fecharia deixando os
    // filhos pendurados num pai finalizado — exatamente o estado que esta rotina veio
    // desfazer, só que um nível abaixo.
    await cascataDaFinalizacao(db, ev.id, {
      agendamentoId: ev.agendamentoId,
      porUsuarioId:  null,
    });

    await db.evolucaoClinica.update({
      where: { id: ev.id },
      data: {
        status:                'FINALIZADA',
        dataFim:               agora,
        dataModificacao:       agora,
        justificativaExclusao: JUSTIFICATIVA_SISTEMA,
      },
    });
  }

  // A evolução mudou de estado: quem a tiver aberta na tela segura uma versão velha e
  // precisa levar 409 no próximo salvar, em vez de gravar por cima de um atendimento
  // que o sistema já fechou. Em LOTE, e não uma chamada por evolução.
  await invalidarVersoes(db, 'EVOLUCAO', abertas.map(e => e.id));

  return {
    ok: true,
    notificar: true,
    resumo: `${abertas.length} atendimento(s) em aberto há mais de ${HORAS_ATE_FINALIZAR}h `
          + `finalizado(s) automaticamente ("${JUSTIFICATIVA_SISTEMA}").`,
  };
}

module.exports = {
  finalizarEvolucoesAbandonadas,
  JUSTIFICATIVA_SISTEMA,
  HORAS_ATE_FINALIZAR,
};
