// frontend/src/contexts/PeriodoContext.tsx
// Período ativo dos Relatórios (Dia/Mês/Ano). Um único seletor no topo de cada
// submódulo de relatório compartilha este estado, então a seleção persiste ao
// navegar entre submódulos. A seleção é gravada em localStorage e enviada a cada
// endpoint de relatório via query params (granularidade + data) — ver periodoParams.
//
// Diferente de EmpresaContext: NÃO recarrega a aplicação ao trocar — as páginas
// de relatório re-buscam reativamente porque incluem { granularidade, data } nas
// deps do useEffect.

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Granularidade = 'dia' | 'semana' | 'mes' | 'ano';

export const GRAN_KEY = 's2vet_rel_gran';
export const DATA_KEY = 's2vet_rel_data';

interface PeriodoContextType {
  granularidade: Granularidade;
  data: Date;
  setGranularidade: (g: Granularidade) => void;
  setData: (d: Date) => void;
}

/** 'YYYY-MM-DD' em horário local (evita shift de fuso do toISOString). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Params para api.get(url, { params: periodoParams(...) }). */
export function periodoParams(granularidade: Granularidade, data: Date) {
  return { granularidade, data: toISODate(data) };
}

const PeriodoContext = createContext<PeriodoContextType>({
  granularidade: 'mes',
  data: new Date(),
  setGranularidade: () => undefined,
  setData: () => undefined,
});

function granInicial(): Granularidade {
  const g = localStorage.getItem(GRAN_KEY);
  return g === 'dia' || g === 'semana' || g === 'mes' || g === 'ano' ? g : 'mes';
}

function dataInicial(): Date {
  const raw = localStorage.getItem(DATA_KEY);
  const m = raw && /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}

export function PeriodoProvider({ children }: { children: ReactNode }) {
  const [granularidade, setGranularidadeState] = useState<Granularidade>(granInicial);
  const [data, setDataState] = useState<Date>(dataInicial);

  const setGranularidade = (g: Granularidade) => {
    localStorage.setItem(GRAN_KEY, g);
    setGranularidadeState(g);
  };
  const setData = (d: Date) => {
    localStorage.setItem(DATA_KEY, toISODate(d));
    setDataState(d);
  };

  const value = useMemo(
    () => ({ granularidade, data, setGranularidade, setData }),
    [granularidade, data],
  );

  return <PeriodoContext.Provider value={value}>{children}</PeriodoContext.Provider>;
}

export function usePeriodo() {
  return useContext(PeriodoContext);
}
