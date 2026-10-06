// backend/src/lib/agendamentoLote.js
//
// AGENDAMENTO EM LOTE — horário de cada paciente (2026-10-05).
//
// O lote é UMA visita do MESMO profissional, em SEQUÊNCIA: o 1º paciente no horário
// escolhido e cada seguinte quando o anterior termina, pelo tempo de consulta de quem
// atende (o mesmo `duracaoMin` do agendamento avulso — tempo do local/especialidade do
// profissional, tempo do cadastro do prestador externo e, sem nada definido, o padrão
// da empresa). Função pura: quem resolve a duração é o controller.
'use strict';

/** Instante do paciente na posição `indice` (0 = o primeiro) de um lote. */
function horarioDoLote(inicio, indice, duracaoMin) {
  const passo = Number(duracaoMin) > 0 ? Number(duracaoMin) : 0;
  return new Date(new Date(inicio).getTime() + Math.max(0, Number(indice) || 0) * passo * 60_000);
}

module.exports = { horarioDoLote };
