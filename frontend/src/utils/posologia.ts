// frontend/src/utils/posologia.ts
// Doses por dia, por frequência — espelha DOSES_POR_DIA do backend
// (backend/src/lib/agendaDoses.js). Usado para montar a PRÉVIA do regime
// prescrito (frequência × duração) na tela de criar/editar prescrição.
export const DOSES_POR_DIA: Record<string, number> = {
  '1xDia': 1, '12em12h': 2, '8em8h': 3, '6em6h': 4, '4em4h': 6, '1em1h': 24,
  'continuo': 1, 'seNecessario': 1, 'SOS': 1,
  '1x2dias': 1 / 2, '1x3dias': 1 / 3, '1xSemana': 1 / 7,
  '1x21dias': 1 / 21, '1x30dias': 1 / 30, '1x90dias': 1 / 90,
};

const FREQUENCIAS_SEM_RESUMO = new Set(['agora', 'SOS', 'seNecessario']);

/** Regime multi-dose/dia OU multi-dia → merece o resumo em destaque (vermelho/negrito). */
export function regimeExigeResumo(frequencia: string, duracaoDias: number): boolean {
  if (FREQUENCIAS_SEM_RESUMO.has(frequencia)) return false;
  const dosesPorDia = DOSES_POR_DIA[frequencia] ?? 1;
  return dosesPorDia > 1 || duracaoDias > 1;
}

const ORDINAIS = [
  'Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava', 'Nona', 'Décima',
];

function ordinal(n: number): string {
  return n <= ORDINAIS.length ? ORDINAIS[n - 1] : `${n}ª`;
}

// `dosesNoDia`/`simples` dizem ao caller se essa linha pertence a um dia com
// SÓ UMA dose (1x/dia, ou "1x a cada N dias") — nesse caso o rótulo ordinal
// ("Primeira Execução") não agrega nada, e a exibição vira só "DD/TT".
export interface DoseResumoLinha { rotulo: string; dia: number; totalDias: number; simples: boolean }

/**
 * Lista numerada de doses do curso inteiro — só a PRÉVIA do regime prescrito
 * (frequência × duração do formulário), sem depender de horário real nem de
 * chamada ao backend (esse é o rolling schedule real, feito na execução).
 */
export function gerarResumoDoses(frequencia: string, duracaoDiasInput: number): DoseResumoLinha[] {
  const duracaoDias = Math.max(Number(duracaoDiasInput) || 1, 1);
  const dosesPorDia = DOSES_POR_DIA[frequencia] ?? 1;
  const linhas: DoseResumoLinha[] = [];

  if (dosesPorDia >= 1) {
    const n = Math.max(1, Math.round(dosesPorDia));
    for (let dia = 1; dia <= duracaoDias; dia++) {
      for (let dose = 1; dose <= n; dose++) {
        linhas.push({ rotulo: ordinal(dose), dia, totalDias: duracaoDias, simples: n === 1 });
      }
    }
  } else {
    // Multi-dia ("1x a cada N dias"): uma dose só, repetida a cada N dias — sempre "simples".
    const intervaloDias = Math.max(1, Math.round(1 / dosesPorDia));
    for (let dia = 1; dia <= duracaoDias; dia += intervaloDias) {
      linhas.push({ rotulo: 'Única', dia, totalDias: duracaoDias, simples: true });
    }
  }
  return linhas;
}
