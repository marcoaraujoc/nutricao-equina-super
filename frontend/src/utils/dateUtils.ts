// frontend/src/utils/dateUtils.ts
// FONTE ÚNICA de formatação de data e hora do frontend.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 A REGRA QUE EVITA O BUG DE FUSO — leia antes de formatar qualquer data
// ─────────────────────────────────────────────────────────────────────────────
//
// Existem DOIS tipos de valor de data, e eles se formatam de maneiras OPOSTAS.
// Trocar um pelo outro é o bug que já custou caro aqui (horário aparecendo 3h
// atrás, dose da noite exibida no dia seguinte):
//
//   1. DATA PURA — um dia do calendário, SEM hora e SEM fuso.
//      Ex.: `dataInicio` da prescrição, `dataAplicacao` da vacina, `dataNascimento`.
//      Chegam do Prisma como "2026-08-24T00:00:00.000Z" (meia-noite UTC é só o
//      jeito de guardar "dia 24"), ou como "2026-08-24" puro.
//      ➜ Use `formatDate` / `formatDateShort`. Elas NÃO convertem fuso: o dia é
//        o que está escrito. Converter faria "24/08" virar "23/08" no Brasil.
//
//   2. INSTANTE — um ponto no tempo, com hora.
//      Ex.: `createdAt`, `executadoEm`, `proximaDoseEm`, `dataHora` do agendamento.
//      ➜ Use a família `formatHora` / `formatDiaMes` / `formatDiaMesHora` /
//        `formatDataHora` / `diaISO`. Elas convertem para o fuso de quem olha.
//
// ⚠️ NUNCA passe um INSTANTE para `formatDate`/`formatDateShort`: elas leem a
//    data em UTC (`split('T')`), então uma dose às 22:00 em Brasília (= 01:00 UTC
//    do dia seguinte) apareceria com a data ERRADA. Foi exatamente esse o bug.
// ⚠️ NUNCA use `.toISOString().slice(0, 10)` para saber "que dia é": isso dá o dia
//    em UTC, que a partir das 21h (BRT) já é amanhã. Use `diaISO()` / `hojeISO()`.
// ⚠️ NUNCA monte `new Date(ano, mes, dia, h, m)` com uma hora vinda de campo
//    "HH:MM" e depois grave com `setUTCHours` — o horário digitado é LOCAL.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 POR QUE NÃO EXISTE UM FUSO FIXO NESTE ARQUIVO
// ─────────────────────────────────────────────────────────────────────────────
//
// A aplicação roda em TODO O BRASIL, que tem QUATRO fusos:
//     UTC−2  Fernando de Noronha
//     UTC−3  Brasília, SP, Rio, Sul, Nordeste  (a maior parte)
//     UTC−4  Manaus, Cuiabá, Campo Grande, Porto Velho, Boa Vista
//     UTC−5  Rio Branco e o oeste do Amazonas
//
// Por isso a família de INSTANTE formata no fuso DE QUEM ESTÁ OLHANDO (o do
// dispositivo), e não num fuso fixo. A enfermeira em Manaus precisa ver a dose no
// relógio DELA; fixar `America/Sao_Paulo` — como este arquivo fazia em
// `formatDateTime` — mostraria 08:44 para uma dose das 07:44 em Manaus, e o
// plantão inteiro sairia uma hora deslocado.
//
// ✅ O fuso agora é da EMPRESA (`EmpresaConfiguracao.fusoHorario`, migration
// 20260823000000), e vale dos DOIS lados: aqui via `definirFusoDaEmpresa`, que o
// `EmpresaContext` alimenta, e no backend via `lib/fusoEmpresa.js` (fila do plantão,
// auditoria e lembrete de WhatsApp). Empresa sem fuso escolhido segue em
// America/Sao_Paulo no servidor e no fuso do dispositivo aqui — o comportamento
// que sempre existiu.

// Fuso da CLÍNICA do contexto ativo (IANA, ex.: "America/Manaus"), definido pelo
// `EmpresaContext` assim que a configuração da empresa carrega. `null` = ainda não
// carregou ou a empresa não escolheu — cai no fuso do dispositivo.
let fusoDaEmpresa: string | null = null;

/**
 * Define o fuso da clínica ativa. Chamado SÓ pelo `EmpresaContext` (e zerado na
 * troca de empresa). É por isto que este módulo continua sendo funções puras, sem
 * depender de React: quem tem o contexto empurra o valor para cá.
 */
export function definirFusoDaEmpresa(fuso: string | null | undefined): void {
  fusoDaEmpresa = fuso && String(fuso).trim() ? String(fuso) : null;
}

/**
 * Fuso em que data e hora são exibidas: o da CLÍNICA quando configurado, senão o do
 * dispositivo.
 *
 * 🔴 Por que a clínica vence o dispositivo: o horário da dose é um fato da operação
 * da clínica, não do aparelho. O gestor que abre o plantão de Manaus a partir de um
 * notebook em São Paulo precisa ver o horário de MANAUS — é nele que a enfermeira
 * vai aplicar. Sem isso, a mesma dose apareceria em horas diferentes conforme quem
 * abre a tela, e o backend (que decide o dia pelo fuso da empresa) discordaria da
 * interface.
 */
export const fusoDeExibicao = (): string =>
  fusoDaEmpresa ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

// ─────────────────────────────────────────────────────────────────────────────
// 1. DATA PURA — dia do calendário, sem conversão de fuso
// ─────────────────────────────────────────────────────────────────────────────

/** DD/MM/YYYY de uma DATA PURA ("2026-08-24" ou coluna date-only do Prisma).
 *  Não converte fuso. Para um INSTANTE use `formatDiaMesAno`. */
export const formatDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const str = d instanceof Date ? d.toISOString() : String(d);
  const parts = str.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return '—';
  const [year, month, day] = parts;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
};

/**
 * ISO → BR e BR → ISO, para quem GRAVA a data no formato brasileiro.
 *
 * POR QUÊ existem, já que `formatDate` faz metade disso: `formatDate` devolve **"—"**
 * quando não há data — perfeito para EXIBIR, desastroso para GRAVAR (o travessão iria
 * para dentro do valor e sairia impresso no documento). Aqui o vazio é `''`.
 *
 * Uso: campos cujo VALOR ARMAZENADO é o texto que sai no papel (as lacunas e as
 * células de lista dos documentos), enquanto o `DateInput` fala ISO. A conversão fica
 * na borda, e nem o componente nem o papel precisam saber do outro formato.
 */
export const isoParaBR = (iso: string | null | undefined): string => {
  const p = String(iso ?? '').split('T')[0].split('-');
  if (p.length !== 3) return '';
  const [a, m, d] = p;
  if (!/^\d{4}$/.test(a) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return '';
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${a}`;
};

/** "16/08/2027" → "2027-08-16". Texto que não seja uma data completa → `''`. */
export const brParaISO = (br: string | null | undefined): string => {
  const m = String(br ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** DD/MM de uma DATA PURA — versão curta para gráficos e resumos.
 *  Não converte fuso. Para um INSTANTE use `formatDiaMes`. */
export const formatDateShort = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const str = d instanceof Date ? d.toISOString() : String(d);
  const parts = str.split('T')[0].split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return '—';
  const [, month, day] = parts;
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. INSTANTE — sempre no fuso de quem está olhando
// ─────────────────────────────────────────────────────────────────────────────

/** Converte a entrada em Date válido, ou null. Base de toda a família de instante.
 *  ⚠️ Rejeita null/''/undefined ANTES do construtor: `new Date(null)` é a época
 *  (1970), NÃO data inválida — sem isto uma data ausente viraria "31/12/1969". */
const paraData = (v: string | Date | null | undefined): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

interface PartesData {
  ano: string; mes: string; dia: string; hora: string; minuto: string;
}

/** Componentes do instante NO FUSO DE EXIBIÇÃO. É por aqui que passa toda a família
 *  de instante — `getHours()`/`getDate()` do Date leem o fuso do DISPOSITIVO e
 *  ignorariam o fuso configurado na clínica. */
const partesNoFuso = (v: string | Date | null | undefined): PartesData | null => {
  const d = paraData(v);
  if (!d) return null;
  const montar = (timeZone: string) => new Intl.DateTimeFormat('pt-BR', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = montar(fusoDeExibicao());
  } catch {
    // Fuso inválido não pode derrubar a tela — cai no do dispositivo.
    partes = montar(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    partes.find(p => p.type === t)?.value ?? '';
  return {
    ano: get('year'), mes: get('month'), dia: get('day'),
    hora: get('hour'), minuto: get('minute'),
  };
};

/** "07:44" — hora de um INSTANTE, no fuso de exibição. */
export const formatHora = (v: string | Date | null | undefined): string | null => {
  const p = partesNoFuso(v);
  return p ? `${p.hora}:${p.minuto}` : null;
};

/** "24/08" — dia/mês de um INSTANTE, no fuso de exibição.
 *  ⚠️ É esta, e NÃO `formatDateShort`, que deve receber timestamp com hora. */
export const formatDiaMes = (v: string | Date | null | undefined): string | null => {
  const p = partesNoFuso(v);
  return p ? `${p.dia}/${p.mes}` : null;
};

/** "24/08/2026" — data de um INSTANTE, no fuso de exibição. */
export const formatDiaMesAno = (v: string | Date | null | undefined): string | null => {
  const p = partesNoFuso(v);
  return p ? `${p.dia}/${p.mes}/${p.ano}` : null;
};

/** "24/08 às 07:44" — dia e hora de um INSTANTE. Formato das doses previstas na
 *  Execução de Prescrição ("Dose 03/10 - Prevista para 24/08 às 07:44"). */
export const formatDiaMesHora = (v: string | Date | null | undefined): string | null => {
  const dia = formatDiaMes(v);
  const hora = formatHora(v);
  return dia && hora ? `${dia} às ${hora}` : null;
};

/** "24/08/2026 07:44" — data completa com hora de um INSTANTE. */
export const formatDataHora = (v: string | Date | null | undefined): string | null => {
  const data = formatDiaMesAno(v);
  const hora = formatHora(v);
  return data && hora ? `${data} ${hora}` : null;
};

/** "às 07:44" / "às 07:44 de 24/08" — o "de DD/MM" só entra quando o instante cai
 *  em dia diferente de `diaRef` (YYYY-MM-DD), para a frase não repetir a data que
 *  a própria tela já mostra. */
export const formatHoraComDia = (
  v: string | Date | null | undefined,
  diaRef: string,
): string | null => {
  const hora = formatHora(v);
  if (!hora) return null;
  const dia = diaISO(v);
  return dia && dia !== diaRef ? `${hora} de ${formatDiaMes(v)}` : hora;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. CHAVES DE DIA — para COMPARAR "é o mesmo dia?", nunca para exibir
// ─────────────────────────────────────────────────────────────────────────────

/** "2026-08-24" — o dia de um INSTANTE no fuso de exibição.
 *  ⚠️ Substitui `.toISOString().slice(0, 10)`, que devolve o dia em UTC e a
 *  partir das 21h (BRT) já aponta para amanhã. */
export const diaISO = (v: string | Date | null | undefined): string | null => {
  const p = partesNoFuso(v);
  return p ? `${p.ano}-${p.mes}-${p.dia}` : null;
};

/** "2026-08-24" — hoje, no fuso de quem olha. */
export const hojeISO = (): string => diaISO(new Date())!;

/** Dois instantes caem no mesmo dia (fuso de quem olha)? */
export const mesmoDia = (
  a: string | Date | null | undefined,
  b: string | Date | null | undefined,
): boolean => {
  const da = diaISO(a);
  return !!da && da === diaISO(b);
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Comparações de "já passou?"
// ─────────────────────────────────────────────────────────────────────────────

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
  const d = paraData(dataHora);
  return !!d && d.getTime() - Date.now() > TOLERANCIA_INICIO_MS;
};

/** true quando a data/hora já passou (com a tolerância de relógio). */
export const dataHoraNoPassado = (dataHora: string | Date | null | undefined): boolean => {
  const d = paraData(dataHora);
  return !!d && d.getTime() < Date.now() - TOLERANCIA_INICIO_MS;
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Compatibilidade
// ─────────────────────────────────────────────────────────────────────────────

/** DD/MM/YYYY HH:MM de um INSTANTE. Mantida pelos ~15 call sites existentes;
 *  em código novo prefira `formatDataHora`, que é a mesma coisa.
 *  🔴 Fixava `timeZone: 'America/Sao_Paulo'` — errado para clínica em Manaus
 *  (UTC−4) ou Rio Branco (UTC−5), que viam 1-2h a mais. Agora segue o fuso de
 *  quem olha, como o resto da família de instante. */
export const formatDateTime = (d: string | Date | null | undefined): string =>
  formatDataHora(d) ?? '—';
