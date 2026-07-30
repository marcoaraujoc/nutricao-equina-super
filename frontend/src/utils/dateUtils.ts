// frontend/src/utils/dateUtils.ts
// Utilitários de formatação de data — sempre DD/MM/YYYY, sempre fuso América/São Paulo.
// Usa parsing manual para evitar dependência de locale do browser.

// DD/MM/YYYY — para campos date-only ou datetime ISO
export const formatDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const str = d instanceof Date ? d.toISOString() : String(d);
  const parts = str.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return '—';
  const [year, month, day] = parts;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
};

// DD/MM — versão curta para gráficos e resumos
export const formatDateShort = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const str = d instanceof Date ? d.toISOString() : String(d);
  const parts = str.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return '—';
  const [, month, day] = parts;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

/**
 * Tolerância de relógio para "o horário marcado já chegou?" — espelha
 * TOLERANCIA_INICIO_MS do EvolucaoController. NÃO é folga de antecipação:
 * atender antes da hora exige REAGENDAR o agendamento.
 */
export const TOLERANCIA_INICIO_MS = 60_000;

/**
 * true quando o agendamento ainda não chegou — iniciar a evolução dele seria
 * ANTECIPAR o atendimento, o que o backend recusa (AGENDAMENTO_ANTECIPADO).
 */
export const agendamentoAntecipado = (dataHora: string | Date | null | undefined): boolean => {
  if (!dataHora) return false;
  const t = (dataHora instanceof Date ? dataHora : new Date(dataHora)).getTime();
  if (isNaN(t)) return false;
  return t - Date.now() > TOLERANCIA_INICIO_MS;
};

// DD/MM/YYYY HH:MM — para timestamps com hora, exibidos no fuso Brasil
export const formatDateTime = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};
