// frontend/src/utils/vacina.ts
// Constantes de Tipo de Dose / Via de Aplicação da vacina — fonte ÚNICA usada
// pela tela de Vacina (SubModuloVacina) e pelo Orçamento (aba Vacinas), que
// passou a capturar os mesmos dois campos para a importação já vir pronta.

// Tipo de dose, em ordem CRESCENTE. "Reforço Mensal"/"Reforço Anual" disparam o
// agendamento automático das doses seguintes na execução (ver INTERVALO_REFORCO_MESES).
export const DOSES = [
  '1ª Dose',
  '2ª Dose',
  '3ª Dose',
  'Dose Única',
  'Reforço Mensal',
  'Reforço Anual',
];

// Reforço periódico → intervalo entre as doses, em MESES. Tipo fora deste mapa não
// gera agendamento automático (dose avulsa/série sem periodicidade definida).
export const INTERVALO_REFORCO_MESES: Record<string, number> = {
  'Reforço Mensal': 1,
  'Reforço Anual':  12,
};

export const VIAS_PADRAO = [
  'Subcutânea (SC)',
  'Intramuscular (IM)',
  'Intranasal (IN)',
  'Intravenosa (IV)',
  'Oral',
];

const VIA_PREFIXES: [string, string][] = [
  ['SUBCUTÂNEA',    'Subcutânea (SC)'],
  ['SC',            'Subcutânea (SC)'],
  ['INTRAMUSCULAR', 'Intramuscular (IM)'],
  ['IM',            'Intramuscular (IM)'],
  ['INTRANASAL',    'Intranasal (IN)'],
  ['IN',            'Intranasal (IN)'],
  ['INTRAVENOSA',   'Intravenosa (IV)'],
  ['IV',            'Intravenosa (IV)'],
  ['ORAL',          'Oral'],
];

export function normalizeVia(via: string): string {
  const u = via.trim().toUpperCase();
  for (const [prefix, canonical] of VIA_PREFIXES) {
    if (u === prefix || u.startsWith(prefix + ' ') || u.startsWith(prefix + '(') || u.startsWith(prefix + ',')) {
      return canonical;
    }
  }
  return via;
}
