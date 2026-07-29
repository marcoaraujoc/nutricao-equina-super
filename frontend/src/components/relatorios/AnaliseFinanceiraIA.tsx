// src/components/relatorios/AnaliseFinanceiraIA.tsx
// IA Financeira — painel gerencial do período em Relatórios > Financeiro.
// Highlights numéricos no topo, análise em texto abaixo. A IA descreve e
// compara os indicadores apurados; não recomenda ação (ver prompt
// 'analise_financeira' no backend).
//
// A chamada é SOB DEMANDA: o painel não dispara IA ao abrir a página — o gestor
// clica em "Analisar período". Assim o custo por token fica sob controle.

import { useEffect, useState } from 'react';
import {
  Sparkles, Loader2, TrendingUp, TrendingDown, Minus, RefreshCw,
} from 'lucide-react';
import api from '../../services/api';
import { periodoParams } from '../../contexts/PeriodoContext';
import type { Granularidade } from '../../contexts/PeriodoContext';

type TipoHighlight = 'FATURAMENTO' | 'INADIMPLENCIA' | 'CONCENTRACAO' | 'MARGEM' | 'TICKET';
type Direcao = 'aumento' | 'reducao' | 'estavel' | 'nao_aplicavel';

interface Highlight {
  texto:   string;
  tipo:    TipoHighlight;
  direcao: Direcao;
  valor:   number | null;
}

interface Analise {
  periodo:    string;
  highlights: Highlight[];
  analise:    string[];
  semDados:   boolean;
}

const COR_TIPO: Record<TipoHighlight, string> = {
  FATURAMENTO:   'bg-emerald-50 text-emerald-700 border-emerald-100',
  INADIMPLENCIA: 'bg-red-50 text-red-700 border-red-100',
  CONCENTRACAO:  'bg-blue-50 text-blue-700 border-blue-100',
  MARGEM:        'bg-violet-50 text-violet-700 border-violet-100',
  TICKET:        'bg-amber-50 text-amber-700 border-amber-100',
};

const LABEL_TIPO: Record<TipoHighlight, string> = {
  FATURAMENTO:   'Faturamento',
  INADIMPLENCIA: 'Inadimplência',
  CONCENTRACAO:  'Concentração',
  MARGEM:        'Margem',
  TICKET:        'Ticket médio',
};

const ICONE_DIRECAO = {
  aumento:       TrendingUp,
  reducao:       TrendingDown,
  estavel:       Minus,
  nao_aplicavel: Minus,
} as const;

interface Props {
  granularidade: Granularidade;
  dataRef:       Date;
}

export default function AnaliseFinanceiraIA({ granularidade, dataRef }: Props) {
  const [dados,      setDados]      = useState<Analise | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro,       setErro]       = useState(false);

  // Trocar o período invalida a análise — o gestor pede a nova quando quiser.
  useEffect(() => { setDados(null); setErro(false); }, [granularidade, dataRef]);

  const analisar = async () => {
    setCarregando(true);
    setErro(false);
    try {
      const res = await api.get('/relatorios/financeiro/analise-ia', {
        params: periodoParams(granularidade, dataRef),
      });
      if (!res.data) { setErro(true); return; }
      setDados(res.data.dados as Analise);
    } catch {
      setErro(true);
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center">
            <Sparkles size={15} className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Análise financeira por IA</h2>
            <p className="text-xs text-gray-400">
              {dados?.periodo ?? 'Leitura dos indicadores do período selecionado'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={analisar}
          disabled={carregando}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {carregando
            ? <Loader2 size={13} className="animate-spin" />
            : <RefreshCw size={13} />}
          {dados ? 'Analisar novamente' : 'Analisar período'}
        </button>
      </div>

      {carregando && (
        <p className="text-sm text-gray-400 py-6 text-center">Lendo os indicadores do período…</p>
      )}

      {!carregando && erro && (
        <p className="text-sm text-red-500 py-6 text-center">
          Não foi possível gerar a análise. Tente novamente.
        </p>
      )}

      {!carregando && !erro && dados?.semDados && (
        <p className="text-sm text-gray-400 py-6 text-center">
          Sem movimento financeiro registrado no período.
        </p>
      )}

      {!carregando && !erro && dados && !dados.semDados && (
        <div className="mt-4 space-y-4">
          {dados.highlights.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {dados.highlights.map((h, i) => {
                const Icone = ICONE_DIRECAO[h.direcao] ?? Minus;
                return (
                  <div key={i} className={`rounded-xl border px-3 py-2.5 ${COR_TIPO[h.tipo]}`}>
                    <div className="flex items-start gap-2">
                      <Icone size={14} className="flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium leading-snug">{h.texto}</p>
                        <p className="text-[10px] opacity-70 mt-1">{LABEL_TIPO[h.tipo]}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dados.analise.length > 0 && (
            <div className="space-y-2 border-t border-gray-50 pt-3">
              {dados.analise.map((p, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
              ))}
            </div>
          )}

          <p className="text-[10px] text-gray-400 flex items-center gap-1 pt-1">
            <Sparkles size={10} className="text-violet-400" />
            Leitura gerada por IA sobre os indicadores apurados no período
          </p>
        </div>
      )}

      {!carregando && !erro && !dados && (
        <p className="text-sm text-gray-400 py-6 text-center">
          Clique em <span className="font-medium text-gray-500">Analisar período</span> para gerar a leitura dos indicadores.
        </p>
      )}
    </div>
  );
}
