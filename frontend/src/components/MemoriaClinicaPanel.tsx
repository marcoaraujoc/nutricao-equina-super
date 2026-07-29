// src/components/MemoriaClinicaPanel.tsx
// Memória Clínica do Paciente (IA) — duas camadas, nesta ordem:
//   1. HIGHLIGHTS: padrões factuais entre atendimentos. Clicar seleciona o
//      highlight e realça, abaixo, apenas os tópicos que o comprovam.
//   2. RESUMO: um tópico por evento. Clicar abre o registro de origem
//      (evolução, vacina, exame, prescrição, encaminhamento).
// A IA aqui só descreve e correlaciona o que está registrado — não sugere
// conduta, não diagnostica, não emite laudo (ver prompt 'memoria_clinica').

import { useMemo, useRef, useState } from 'react';
import {
  Sparkles, Loader2, TrendingDown, TrendingUp, Minus,
  Repeat, AlertCircle, ArrowRightLeft, ChevronRight,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoHighlight = 'TENDENCIA' | 'RECORRENCIA' | 'PENDENCIA' | 'ALTERACAO';
export type DirecaoHighlight = 'aumento' | 'reducao' | 'estavel' | 'nao_aplicavel';

export interface HighlightMemoria {
  texto:   string;
  tipo:    TipoHighlight;
  direcao: DirecaoHighlight;
  topicos: string[];
}

export interface TopicoMemoria {
  id:     string;
  ref:    string;
  data:   string;
  origem: string;
  texto:  string;
}

export interface MemoriaClinica {
  resumo:        string;
  highlights:    HighlightMemoria[];
  topicos:       TopicoMemoria[];
  atualizadoEm:  string | null;
  totalEventos:  number;
  desatualizado: boolean;
}

interface Props {
  memoria:     MemoriaClinica | null;
  atualizando: boolean;
  /** Abre o registro de origem do tópico. Ausente = tópico não clicável. */
  onAbrirRef?: (ref: string) => void;
  /** Refs que o histórico carregado consegue abrir. */
  refsAbriveis?: Set<string>;
}

// ─── Estilo por tipo de highlight ─────────────────────────────────────────────

const ICONE_DIRECAO = {
  reducao:        TrendingDown,
  aumento:        TrendingUp,
  estavel:        Minus,
  nao_aplicavel:  Minus,
} as const;

const ICONE_TIPO = {
  TENDENCIA:   null,            // usa o ícone de direção
  RECORRENCIA: Repeat,
  PENDENCIA:   AlertCircle,
  ALTERACAO:   ArrowRightLeft,
} as const;

const COR_TIPO: Record<TipoHighlight, string> = {
  TENDENCIA:   'bg-violet-50 text-violet-700 border-violet-100',
  RECORRENCIA: 'bg-blue-50 text-blue-700 border-blue-100',
  PENDENCIA:   'bg-amber-50 text-amber-700 border-amber-100',
  ALTERACAO:   'bg-sky-50 text-sky-700 border-sky-100',
};

const LABEL_TIPO: Record<TipoHighlight, string> = {
  TENDENCIA:   'Tendência',
  RECORRENCIA: 'Recorrência',
  PENDENCIA:   'Pendência',
  ALTERACAO:   'Alteração',
};

const LABEL_ORIGEM: Record<string, string> = {
  ATENDIMENTO:    'Atendimento',
  VACINA:         'Vacina',
  EXAME:          'Exame',
  PRESCRICAO:     'Prescrição',
  ENCAMINHAMENTO: 'Encaminhamento',
  FATURA_MANUAL:  'Serviço',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function MemoriaClinicaPanel({
  memoria, atualizando, onAbrirRef, refsAbriveis,
}: Props) {
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const topicoRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const highlights = memoria?.highlights ?? [];
  const topicos    = memoria?.topicos    ?? [];

  // Tópicos que sustentam o highlight selecionado
  const realcados = useMemo(() => {
    if (selecionado === null) return null;
    return new Set(highlights[selecionado]?.topicos ?? []);
  }, [selecionado, highlights]);

  const selecionarHighlight = (i: number) => {
    const proximo = selecionado === i ? null : i;
    setSelecionado(proximo);
    if (proximo === null) return;
    const primeiro = highlights[proximo]?.topicos?.[0];
    if (primeiro) {
      topicoRefs.current[primeiro]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const podeAbrir = (ref: string) => Boolean(onAbrirRef && refsAbriveis?.has(ref));

  const temConteudo = topicos.length > 0 || Boolean(memoria?.resumo);

  return (
    <div className="w-full lg:w-80 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-violet-50 rounded-xl flex items-center justify-center">
            <Sparkles size={15} className="text-violet-600" />
          </div>
          <h2 className="font-bold text-gray-900 text-sm">Memória Clínica</h2>
        </div>
        {atualizando && <Loader2 size={14} className="animate-spin text-violet-500 flex-shrink-0" />}
      </div>

      <div className="p-4 flex-1 min-h-0 max-h-[60vh] lg:max-h-none overflow-y-auto">
        {!temConteudo ? (
          atualizando ? (
            <div className="text-center py-10">
              <Loader2 size={18} className="animate-spin text-violet-400 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Analisando o histórico…</p>
            </div>
          ) : (
            <p className="text-center text-sm text-gray-300 py-10">Sem atendimentos para analisar</p>
          )
        ) : (
          <>
            {/* ── 1. Highlights ── */}
            {highlights.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Destaques
                </p>
                <ul className="space-y-2">
                  {highlights.map((h, i) => {
                    const Icone = ICONE_TIPO[h.tipo] ?? ICONE_DIRECAO[h.direcao] ?? Minus;
                    const ativo = selecionado === i;
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          onClick={() => selecionarHighlight(i)}
                          aria-pressed={ativo}
                          className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${COR_TIPO[h.tipo]} ${
                            ativo ? 'ring-2 ring-violet-400 ring-offset-1' : 'hover:brightness-95'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <Icone size={14} className="flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium leading-snug">{h.texto}</p>
                              <p className="text-[10px] opacity-70 mt-1">
                                {LABEL_TIPO[h.tipo]} · {h.topicos.length} registros
                                {ativo ? ' · exibindo abaixo' : ''}
                              </p>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ── 2. Resumo por tópicos ── */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                Resumo
              </p>
              {selecionado !== null && (
                <button
                  type="button"
                  onClick={() => setSelecionado(null)}
                  className="text-[10px] text-violet-600 hover:text-violet-800 font-medium"
                >
                  Ver tudo
                </button>
              )}
            </div>

            {topicos.length > 0 ? (
              <ul className="space-y-1.5">
                {topicos.map((t) => {
                  const realcado  = realcados?.has(t.id) ?? false;
                  const atenuado  = realcados !== null && !realcado;
                  const clicavel  = podeAbrir(t.ref);
                  const Wrapper   = clicavel ? 'button' : 'div';
                  return (
                    <li
                      key={t.id}
                      ref={(el) => { topicoRefs.current[t.id] = el; }}
                    >
                      <Wrapper
                        {...(clicavel
                          ? { type: 'button' as const, onClick: () => onAbrirRef?.(t.ref) }
                          : {})}
                        className={`w-full text-left rounded-lg px-2.5 py-2 border transition-all ${
                          realcado
                            ? 'border-violet-200 bg-violet-50/60'
                            : 'border-transparent hover:border-gray-100 hover:bg-gray-50'
                        } ${atenuado ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] text-gray-400 font-medium">
                              {t.data} · {LABEL_ORIGEM[t.origem] ?? t.origem}
                            </p>
                            <p className="text-sm text-gray-700 leading-snug mt-0.5">{t.texto}</p>
                          </div>
                          {clicavel && (
                            <ChevronRight size={13} className="text-gray-300 flex-shrink-0 mt-1" />
                          )}
                        </div>
                      </Wrapper>
                    </li>
                  );
                })}
              </ul>
            ) : (
              // Registro salvo antes da estrutura por tópicos
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {memoria?.resumo}
              </p>
            )}

            <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50 flex items-center gap-1">
              <Sparkles size={10} className="text-violet-400" />
              Análise gerada por IA sobre os registros
              {memoria?.atualizadoEm &&
                ` · atualizada em ${new Date(memoria.atualizadoEm).toLocaleDateString('pt-BR')}`}
              {atualizando && ' · atualizando…'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
