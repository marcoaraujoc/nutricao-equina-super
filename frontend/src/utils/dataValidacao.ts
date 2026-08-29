// src/utils/dataValidacao.ts
//
// Validação de data digitada no padrão brasileiro, com MENSAGEM ESPECÍFICA.
//
// POR QUE EXISTE: `DateInput` e `DateInputBR` já sabiam recusar 31/02/2026 — mas
// recusavam EM SILÊNCIO. O `DateInput` ainda fazia pior: ao sair do campo, voltava ao
// último valor válido. Quem digitava uma data errada via o campo "consertar-se"
// sozinho para a data ANTERIOR e salvava aquela, achando que tinha trocado.
//
// 🔴 A MENSAGEM DIZ O QUE ESTÁ ERRADO, não "data inválida". Quem digitou 31/02 e lê
// "data inválida" olha para os quatro campos sem saber qual mexer; quem lê "fevereiro
// de 2026 tem 28 dias" corrige na hora. É a diferença entre avisar e ajudar.
//
// Fonte única dos dois componentes de data — a regra estava implícita e duplicada em
// cada um, com resultados diferentes (um revertia, o outro pintava de vermelho).

/** Fora desta faixa é dedo trocado, não data — 0202 e 20226 caem aqui. */
const ANO_MIN = 1900;
const ANO_MAX = 2200;

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Dias do mês, já considerando ano bissexto. */
export function diasNoMes(mes: number, ano: number): number {
  return new Date(ano, mes, 0).getDate();
}

const doisDigitos = (n: number | string) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' (só para citar min/max na mensagem). */
function isoParaBR(iso: string): string {
  const [d] = iso.split('T');
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

export interface ResultadoData {
  /** ISO válido ('YYYY-MM-DD' ou 'YYYY-MM-DDTHH:MM'), ou '' quando não há data. */
  iso:  string;
  /** Mensagem para o usuário, ou `null` quando está tudo certo (ou vazio). */
  erro: string | null;
  /** `true` enquanto a pessoa ainda está digitando — não é erro, é meio do caminho. */
  incompleta: boolean;
}

export interface OpcoesData {
  withTime?: boolean;
  /** ISO — data mínima aceita. */
  min?: string;
  /** ISO — data máxima aceita. */
  max?: string;
}

/**
 * Valida o texto digitado (mascarado ou não) e devolve o ISO + o erro.
 *
 * A ORDEM das checagens é a ordem em que a pessoa lê o campo: ano, mês, dia, hora.
 * Assim `31/13/2026` reclama do MÊS (o erro mais à esquerda), e não do dia — apontar
 * o dia num mês que não existe manda a pessoa consertar a coisa errada.
 */
export function validarDataBR(texto: string, opcoes: OpcoesData = {}): ResultadoData {
  const { withTime = false, min, max } = opcoes;
  const digitos = String(texto ?? '').replace(/\D/g, '');
  const necessarios = withTime ? 12 : 8;

  if (digitos.length === 0) return { iso: '', erro: null, incompleta: false };
  if (digitos.length < necessarios) {
    return { iso: '', erro: 'Data incompleta', incompleta: true };
  }

  const d = Number(digitos.slice(0, 2));
  const m = Number(digitos.slice(2, 4));
  const y = Number(digitos.slice(4, 8));
  const hh = withTime ? Number(digitos.slice(8, 10)) : 0;
  const mm = withTime ? Number(digitos.slice(10, 12)) : 0;

  if (y < ANO_MIN || y > ANO_MAX) {
    return { iso: '', erro: `Ano inválido (use entre ${ANO_MIN} e ${ANO_MAX})`, incompleta: false };
  }
  if (m < 1 || m > 12) {
    return { iso: '', erro: 'Mês inválido (use de 01 a 12)', incompleta: false };
  }
  const limite = diasNoMes(m, y);
  if (d < 1) return { iso: '', erro: 'Dia inválido (o mês começa no dia 01)', incompleta: false };
  if (d > limite) {
    // Cita o mês por extenso e o total de dias: é o que resolve 31/04 e 29/02.
    return { iso: '', erro: `Dia inválido — ${MESES[m - 1]} de ${y} tem ${limite} dias`, incompleta: false };
  }
  if (withTime && hh > 23) return { iso: '', erro: 'Hora inválida (00 a 23)', incompleta: false };
  if (withTime && mm > 59) return { iso: '', erro: 'Minutos inválidos (00 a 59)', incompleta: false };

  const iso = withTime
    ? `${y}-${doisDigitos(m)}-${doisDigitos(d)}T${doisDigitos(hh)}:${doisDigitos(mm)}`
    : `${y}-${doisDigitos(m)}-${doisDigitos(d)}`;

  // min/max: comparação de STRING ISO funciona porque o formato é ordenável por
  // natureza (ano-mês-dia com zero à esquerda). Compara só a parte da data quando o
  // limite vem sem hora — senão '2026-08-28' > '2026-08-28T10:00' daria falso positivo.
  const soData = iso.slice(0, 10);
  if (min && (min.length > 10 ? iso < min : soData < min.slice(0, 10))) {
    return { iso: '', erro: `Data anterior ao permitido (${isoParaBR(min)})`, incompleta: false };
  }
  if (max && (max.length > 10 ? iso > max : soData > max.slice(0, 10))) {
    return { iso: '', erro: `Data posterior ao permitido (${isoParaBR(max)})`, incompleta: false };
  }

  return { iso, erro: null, incompleta: false };
}
