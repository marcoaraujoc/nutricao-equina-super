// src/components/MemoriaClinicaPanel.tsx
// Memória Clínica do Paciente (IA) — três camadas, nesta ordem:
//   1. DESTAQUES: padrões factuais entre atendimentos. Clicar seleciona o
//      highlight e leva até a primeira linha que o comprova, realçando abaixo
//      apenas os registros que o sustentam.
//   2. O QUE MUDOU: antes × depois da última consolidação. Só aparece quando o
//      histórico do paciente mudou desde o resumo anterior.
//   3. RESUMO DAS ATIVIDADES: 10 a 20 linhas de narrativa agrupada por ATENDIMENTO
//      — o que houve na consulta, o que ela gerou e em que estado isso está.
//      Vem do prompt, não é montado aqui.
//   4. REGISTROS: um por evento. Clicar abre o registro de origem
//      (evolução, vacina, exame, prescrição, encaminhamento, documento).
// A IA aqui só descreve e correlaciona o que está registrado — não sugere
// conduta, não diagnostica, não emite laudo (ver prompt 'memoria_clinica').

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles, Loader2, TrendingDown, TrendingUp, Minus,
  Repeat, AlertCircle, ArrowRightLeft, ChevronRight, ExternalLink,
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
  /** Resumo das atividades em 10 a 20 linhas (prompt memoria_clinica@v3).
   *  Vazio em registro consolidado antes do v2 — a tela cai no `resumo` corrido. */
  resumoLinhas?: string[];
  /** O que mudou na ÚLTIMA consolidação (antes × depois). Vazio na primeira. */
  mudancas?: string[];
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
  DOCUMENTO:      'Documento',
};

// ─── Componente ───────────────────────────────────────────────────────────────

export default function MemoriaClinicaPanel({
  memoria, atualizando, onAbrirRef, refsAbriveis,
}: Props) {
  const [selecionado, setSelecionado] = useState<number | null>(null);
  // Registros nascem FECHADOS: quem abre a tela quer o resumo e os destaques, não a
  // lista evento a evento — que é o detalhe para quem já leu os dois de cima.
  const [registrosAbertos, setRegistrosAbertos] = useState(false);
  const topicoRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const scrollRef  = useRef<HTMLDivElement | null>(null);

  const highlights   = memoria?.highlights   ?? [];
  const topicos      = memoria?.topicos      ?? [];
  const resumoLinhas = memoria?.resumoLinhas ?? [];
  const mudancas     = memoria?.mudancas     ?? [];

  // Tópicos que sustentam o highlight selecionado
  const realcados = useMemo(() => {
    if (selecionado === null) return null;
    return new Set(highlights[selecionado]?.topicos ?? []);
  }, [selecionado, highlights]);

  const topicoPorId = useMemo(
    () => new Map(topicos.map(t => [t.id, t])), [topicos]);

  // Os registros que PROVAM o highlight, na ordem em que a IA os ancorou.
  // Id que não casa com tópico nenhum é descartado (o serviço já valida isso, mas
  // uma lista com buraco aqui viraria linha em branco na tela).
  const provasDoHighlight = (h: HighlightMemoria) =>
    h.topicos.map(id => topicoPorId.get(id)).filter((t): t is TopicoMemoria => Boolean(t));

  // Rola até um registro DENTRO do painel. Usado quando a prova do destaque não tem
  // tela de detalhe (item de fatura, por exemplo): não dá para abrir, mas dá para
  // mostrar a linha.
  // O scroll é calculado dentro do painel (scrollRef), nunca por scrollIntoView:
  // aquele rola todos os ancestrais roláveis — incluindo o <main> do shell — e
  // arrancava a página inteira do lugar só para mover uma lista de 300px.
  const irParaTopico = (topicoId: string) => {
    // A lista de Registros nasce fechada: sem abri-la primeiro o <li> nem existe no
    // DOM e o scroll não teria alvo. O rAF espera o re-render que a monta.
    setRegistrosAbertos(true);
    requestAnimationFrame(() => {
      const caixa = scrollRef.current;
      const alvo  = topicoRefs.current[topicoId];
      if (!caixa || !alvo) return;
      const deslocamento = alvo.offsetTop - caixa.offsetTop
        - (caixa.clientHeight / 2) + (alvo.offsetHeight / 2);
      caixa.scrollTo({ top: Math.max(0, deslocamento), behavior: 'smooth' });
    });
  };

  // Clicar no destaque ABRE ali mesmo os registros que o comprovam, cada um levando
  // ao documento de origem. NÃO rola mais para a lista de baixo: agora o conteúdo
  // aparece sob o próprio destaque, e rolar tiraria a pessoa de onde ela clicou.
  // A lista de Registros continua realçando os mesmos itens, como contexto.
  const selecionarHighlight = (i: number) => {
    setSelecionado(selecionado === i ? null : i);
  };

  const podeAbrir = (ref: string) => Boolean(onAbrirRef && refsAbriveis?.has(ref));

  // ── Âncoras do resumo: [[ref|texto]] vira o texto clicável ──────────────────
  // SEM parênteses (decisão de 03/09): quem marca o link é a cor, não a pontuação —
  // parêntese no meio da frase competia com o "(0% executado)" que é texto de verdade.
  // O backend já trocou o id do tópico pela `ref` e derrubou a marcação de id que
  // não existe (ver resumoAtendimentoService#resolverAmarras), então tudo que
  // chega aqui marcado aponta para um registro real. O que ainda pode faltar é a
  // TELA de detalhe — aí sai como texto simples, nunca como link morto.
  const MARCA = /\[\[([^\]|]+)\|([^\]]+)\]\]/g;

  const comAncoras = (linha: string): ReactNode[] => {
    const partes: ReactNode[] = [];
    let ultimo = 0;
    let m: RegExpExecArray | null;
    // `exec` em laço exige regex NOVA por chamada: /g guarda `lastIndex`, e uma
    // constante de módulo compartilhada pularia trechos da linha seguinte.
    const re = new RegExp(MARCA.source, 'g');
    while ((m = re.exec(linha)) !== null) {
      if (m.index > ultimo) partes.push(linha.slice(ultimo, m.index));
      const [, ref, texto] = m;
      partes.push(
        podeAbrir(ref)
          ? <button
              key={`${ref}-${m.index}`}
              type="button"
              onClick={() => onAbrirRef?.(ref)}
              title={`Abrir ${texto}`}
              className="text-violet-700 font-medium underline decoration-violet-300 underline-offset-2 hover:decoration-violet-600"
            >{texto}</button>
          : <span key={`${ref}-${m.index}`}>{texto}</span>,
      );
      ultimo = m.index + m[0].length;
    }
    if (ultimo < linha.length) partes.push(linha.slice(ultimo));
    return partes;
  };

  const temConteudo = topicos.length > 0 || resumoLinhas.length > 0 || Boolean(memoria?.resumo);

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

      <div ref={scrollRef} className="p-4 flex-1 min-h-0 max-h-[60vh] lg:max-h-none overflow-y-auto">
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
            {/* ── 1. Resumo das atividades (10 a 20 linhas, vindas da IA) ── */}
            {resumoLinhas.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Resumo das atividades
                </p>
                {/* Parágrafos, não bullets: o resumo é narrativa contínua, e a lista
                    picotada era justamente a leitura telegráfica que o v3 saiu de. */}
                <div className="rounded-xl bg-gray-50/70 border border-gray-100 px-3 py-2.5 space-y-2">
                  {resumoLinhas.map((linha, i) => (
                    <p key={i} className="text-xs text-gray-700 leading-relaxed">{comAncoras(linha)}</p>
                  ))}
                </div>
              </div>
            )}

            {/* ── 2. O que mudou desde a consolidação anterior (antes × depois) ── */}
            {mudancas.length > 0 && (
              <div className="mb-5">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  O que mudou
                </p>
                <ul className="space-y-1.5 rounded-xl bg-amber-50/70 border border-amber-100 px-3 py-2.5">
                  {mudancas.map((linha, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <ArrowRightLeft size={11} className="text-amber-500 flex-shrink-0 mt-[3px]" />
                      <p className="text-xs text-amber-900 leading-relaxed">{comAncoras(linha)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── 3. Destaques ── */}
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
                      // O <li> é a caixa; o cabeçalho é o botão que abre. As provas
                      // NÃO podem ficar dentro dele — botão dentro de botão é HTML
                      // inválido e o clique interno não chegaria ao registro.
                      <li key={i} className={`rounded-xl border transition-all ${COR_TIPO[h.tipo]} ${
                        ativo ? 'ring-2 ring-violet-400 ring-offset-1' : ''
                      }`}>
                        <button
                          type="button"
                          onClick={() => selecionarHighlight(i)}
                          aria-expanded={ativo}
                          className={`w-full text-left px-3 py-2.5 ${ativo ? '' : 'hover:brightness-95'}`}
                        >
                          <div className="flex items-start gap-2">
                            <Icone size={14} className="flex-shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium leading-snug">{h.texto}</p>
                              <p className="text-[10px] opacity-70 mt-1">
                                {LABEL_TIPO[h.tipo]} · {h.topicos.length} registros
                                {ativo ? '' : ' · ver de onde veio'}
                              </p>
                            </div>
                            <ChevronRight
                              size={13}
                              className={`flex-shrink-0 mt-0.5 opacity-50 transition-transform ${ativo ? 'rotate-90' : ''}`}
                            />
                          </div>
                        </button>

                        {/* Aberto: os registros que PROVAM o destaque, cada um levando
                            ao seu documento de origem. Antes o clique só dizia
                            "exibindo abaixo" e obrigava a procurar a linha na lista. */}
                        {ativo && (
                          <ul className="px-2 pb-2 space-y-1">
                            {provasDoHighlight(h).map(t => {
                              const clicavel = podeAbrir(t.ref);
                              return (
                                <li key={t.id}>
                                  {/* NÃO usar `disabled` aqui: ele impede o onClick, e o
                                      ramo de rolar até a linha viraria código morto.
                                      Registro sem tela de detalhe (item de fatura) não
                                      abre nada, mas ainda leva à sua linha na lista. */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (clicavel) onAbrirRef?.(t.ref);
                                      else irParaTopico(t.id);
                                    }}
                                    title={clicavel
                                      ? `Abrir ${LABEL_ORIGEM[t.origem] ?? t.origem} de ${t.data}`
                                      : 'Este registro não tem tela de detalhe — mostrar na lista abaixo'}
                                    className="w-full text-left rounded-lg bg-white/70 px-2 py-1.5 transition-colors hover:bg-white"
                                  >
                                    <div className="flex items-start gap-1.5">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[10px] font-semibold opacity-70">
                                          {t.data} · {LABEL_ORIGEM[t.origem] ?? t.origem}
                                        </p>
                                        <p className="text-[11px] leading-snug opacity-90 line-clamp-2">{t.texto}</p>
                                      </div>
                                      {clicavel && (
                                        <ExternalLink size={11} className="flex-shrink-0 mt-1 opacity-50" />
                                      )}
                                    </div>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* ── 4. Registros (um por evento) — FECHADO por padrão ── */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setRegistrosAbertos(v => !v)}
                aria-expanded={registrosAbertos}
                className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide hover:text-gray-600 transition-colors"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform ${registrosAbertos ? 'rotate-90' : ''}`}
                />
                Registros
                {topicos.length > 0 && ` (${topicos.length})`}
              </button>
              {registrosAbertos && selecionado !== null && (
                <button
                  type="button"
                  onClick={() => setSelecionado(null)}
                  className="text-[10px] text-violet-600 hover:text-violet-800 font-medium"
                >
                  Ver tudo
                </button>
              )}
            </div>

            {!registrosAbertos ? null : topicos.length > 0 ? (
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
            ) : resumoLinhas.length === 0 ? (
              // Registro salvo antes da estrutura por tópicos
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {memoria?.resumo}
              </p>
            ) : (
              <p className="text-xs text-gray-300">Sem registros individuais</p>
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
