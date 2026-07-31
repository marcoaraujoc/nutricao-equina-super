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
 * Tolerância de relógio para comparações de "já passou?" — espelha o 1 min que o
 * AgendamentoController usa em DATA_PASSADA.
 */
export const TOLERANCIA_INICIO_MS = 60_000;

/**
 * true quando o horário marcado ainda não chegou.
 *
 * ATENÇÃO: isto NÃO bloqueia nada. ADIANTAR um atendimento é permitido (o paciente
 * chegou antes, o profissional vagou) — o backend deixou de recusar com
 * AGENDAMENTO_ANTECIPADO. O que continua proibido é mover a agenda para TRÁS do
 * relógio (`DATA_PASSADA` em criar/atualizar). Use esta função só para INFORMAR
 * ("marcado para as 14h"), nunca para desabilitar o botão de iniciar.
 */
export const agendamentoAntecipado = (dataHora: string | Date | null | undefined): boolean => {
  if (!dataHora) return false;
  const t = (dataHora instanceof Date ? dataHora : new Date(dataHora)).getTime();
  if (isNaN(t)) return false;
  return t - Date.now() > TOLERANCIA_INICIO_MS;
};

/** true quando a data/hora já passou (com a tolerância de relógio). */
export const dataHoraNoPassado = (dataHora: string | Date | null | undefined): boolean => {
  if (!dataHora) return false;
  const t = (dataHora instanceof Date ? dataHora : new Date(dataHora)).getTime();
  if (isNaN(t)) return false;
  return t < Date.now() - TOLERANCIA_INICIO_MS;
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
