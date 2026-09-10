// frontend/src/components/ImagemSeletorUnificado.tsx
//
// 🔴 SELETOR DE EXAME DE IMAGEM — CATEGORIA → PRESTADOR → EXAME (2026-09-09)
//
// Nasceu quando o exame de imagem deixou de viver num catálogo próprio e passou a ser
// um PROCEDIMENTO (`tb_procedimentos_vet`, tipo IMAGEM). Com isso ele ganhou o que já
// existia para procedimento: valor por empresa e vínculo com prestador (com os dois
// valores). A tela precisa refletir essa cadeia.
//
// ⚠️ A ORDEM não é estética: o PRESTADOR é quem define o Valor Cliente do exame (o
// vínculo é por par exame×prestador), então escolhê-lo DEPOIS do exame mostraria um
// preço que muda debaixo do que já foi marcado.
//
// ⚠️ O prestador é OPCIONAL — sem ele o exame é executado pela própria equipe e vale o
// valor padrão da empresa. Exigi-lo pararia o atendimento por causa de um cadastro que
// talvez ninguém tenha feito ainda.
//
// ⚠️ Prestador SEM vínculo no exame ganha aviso âmbar e NUNCA some da lista: é esse
// aviso que evita o exame sair na fatura por R$ 0,00 sem ninguém notar — a mesma
// decisão do campo de prestador da tela de prescrição.

import type { RefObject } from 'react';
import { Scan, Loader2, X, Check, ChevronDown, Plus } from 'lucide-react';

/** Exame de imagem vindo de `/clinica/imagem-exames/exames`. */
export interface ImagemExameProc {
  id:             number;
  codigo:         string | null;
  nome:           string;
  nomeAbreviado:  string | null;
  subcategoria:   string | null;
  especie:        string | null;
  valorPadrao:    number | null;
  /** Valor cobrado do cliente já resolvido (vínculo do prestador ou padrão da empresa). */
  valorCliente:   number | null;
  valorPrestador: number | null;
  /** O prestador escolhido tem vínculo NESTE exame? `false` = sairia sem valor próprio. */
  temVinculo:     boolean;
  empresaId:      number | null;
}

/** Prestador vindo de `/clinica/imagem-exames/prestadores`. */
export interface ImagemPrestador {
  id:          number;
  nome:        string;
  tipoServico: string | null;
  /** Já tem vínculo (e portanto valor) em algum exame desta categoria. */
  temValor:    boolean;
}

/** R$ para a tela do pedido. `null` vira "—": valor não informado não é zero. */
export const brlExame = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  categorias:            string[];
  categoria:             string;
  onCategoria:           (c: string) => void;
  prestadores:           ImagemPrestador[];
  prestadorId:           number | null;
  onPrestador:           (id: number | null) => void;
  carregandoPrestadores: boolean;
  exames:                ImagemExameProc[];
  carregandoExames:      boolean;
  selecionados:          string[];
  onToggleExame:         (nome: string) => void;
  busca:                 string;
  onBusca:               (v: string) => void;
  aberto:                boolean;
  onAberto:              (v: boolean) => void;
  // React 18: `useRef<T>(null)` produz RefObject<T>, e é o que a tela passa.
  dropdownRef:           RefObject<HTMLDivElement>;
  buscaRef:              RefObject<HTMLInputElement>;
  /** Leva ao cadastro de PRESTADORES e volta para cá. */
  onCadastrarPrestador:  () => void;
  /** Leva ao cadastro de PROCEDIMENTOS, na categoria de imagem escolhida. */
  onCadastrarExame:      () => void;
  /**
   * Nomes dos exames MARCADOS que o prestador escolhido ainda não executa por um valor
   * cadastrado. Vazio quando não há prestador (aí o valor padrão é o correto, não uma
   * pendência).
   */
  semValor:              string[];
  /** Abre o cadastro de procedimentos RECORTADO nesses exames, já com o prestador. */
  onCadastrarValores:    () => void;
}

const selectCls =
  'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-400 bg-white';

export default function ImagemSeletorUnificado({
  categorias, categoria, onCategoria,
  prestadores, prestadorId, onPrestador, carregandoPrestadores,
  exames, carregandoExames, selecionados, onToggleExame,
  busca, onBusca, aberto, onAberto, dropdownRef, buscaRef,
  onCadastrarPrestador, onCadastrarExame, semValor, onCadastrarValores,
}: Props) {
  const prestadorEscolhido = prestadores.find(p => p.id === prestadorId) ?? null;

  const visiveis = busca.trim()
    ? exames.filter(e =>
        e.nome.toLowerCase().includes(busca.toLowerCase()) ||
        (e.codigo ?? '').toLowerCase().includes(busca.toLowerCase()) ||
        (e.subcategoria ?? '').toLowerCase().includes(busca.toLowerCase()))
    : exames;

  return (
    <div className="space-y-3">
      {/* ── 1. CATEGORIA ─────────────────────────────────────────────────── */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
          Categoria de Exame
        </label>
        <select value={categoria} onChange={e => onCategoria(e.target.value)} className={selectCls}>
          <option value="">Selecione a categoria...</option>
          {categorias.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* ── 2. PRESTADOR ─────────────────────────────────────────────────── */}
      <div>
        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
          Prestador{' '}
          <span className="text-gray-300 normal-case font-normal tracking-normal">(opcional)</span>
        </label>

        {!categoria ? (
          <p className="text-xs text-gray-400 italic py-2">Escolha a categoria para ver os prestadores.</p>
        ) : carregandoPrestadores ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
            <Loader2 size={13} className="animate-spin" /> Carregando prestadores...
          </div>
        ) : prestadores.length === 0 ? (
          /* Nenhum cadastrado na clínica: o caminho é o CADASTRO, não um campo de texto
             livre — o prestador só existe de verdade com nome E telefone. */
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-800 leading-snug">Nenhum prestador cadastrado nesta clínica.</p>
            <button type="button" onClick={onCadastrarPrestador}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline">
              <Plus size={12} /> Cadastrar prestador
            </button>
          </div>
        ) : (
          <>
            <select
              value={prestadorId ?? ''}
              onChange={e => onPrestador(Number(e.target.value) || null)}
              className={selectCls}
            >
              <option value="">Sem prestador — executado pela equipe</option>
              {/* Quem JÁ tem valor cadastrado vem em bloco próprio: é a diferença entre
                  "executa isto aqui" e "só está cadastrado na clínica". */}
              {prestadores.some(p => p.temValor) && (
                <optgroup label="Com valor cadastrado nesta categoria">
                  {prestadores.filter(p => p.temValor).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome}{p.tipoServico ? ` · ${p.tipoServico}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {prestadores.some(p => !p.temValor) && (
                <optgroup label="Sem valor cadastrado">
                  {prestadores.filter(p => !p.temValor).map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nome}{p.tipoServico ? ` · ${p.tipoServico}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <div className="flex items-center justify-between gap-2 mt-1">
              <p className="text-[10px] text-gray-400">
                Sem prestador, o exame é executado pela própria equipe.
              </p>
              <button type="button" onClick={onCadastrarPrestador}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline flex-shrink-0">
                <Plus size={11} /> Cadastrar prestador
              </button>
            </div>

            {prestadorEscolhido && !prestadorEscolhido.temValor && (
              <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5">
                <p className="text-[11px] text-amber-800 leading-snug">
                  <strong>{prestadorEscolhido.nome}</strong> ainda não tem valor cadastrado nesta
                  categoria — o exame sai pelo valor padrão da empresa.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 3. EXAME ─────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {categoria ? `Exames — ${categoria}` : 'Exames'}
          </label>
          {categoria && !carregandoExames && (
            <span className="text-[11px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
              {exames.length} disponíveis
            </span>
          )}
        </div>

        {!categoria ? (
          <p className="text-xs text-gray-400 italic py-2">
            Selecione a categoria acima para ver os exames disponíveis.
          </p>
        ) : carregandoExames ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-400 py-2">
            <Loader2 size={12} className="animate-spin" /> Carregando exames...
          </div>
        ) : exames.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-xs text-amber-800 leading-snug">Nenhum exame cadastrado nesta categoria.</p>
            <button type="button" onClick={onCadastrarExame}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline">
              <Plus size={12} /> Cadastrar exame
            </button>
          </div>
        ) : (
          <div className="relative" ref={dropdownRef}>
            {aberto ? (
              <div className="flex items-center gap-2 px-3 py-2.5 border border-emerald-400 rounded-xl bg-white">
                <Scan size={14} className="text-emerald-400 flex-shrink-0" />
                <input
                  ref={buscaRef}
                  autoFocus
                  type="text"
                  value={busca}
                  onChange={e => onBusca(e.target.value)}
                  placeholder={`Buscar em ${categoria}...`}
                  className="flex-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 placeholder:italic"
                />
                {busca && (
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); onBusca(''); buscaRef.current?.focus(); }}
                    className="text-gray-400 hover:text-gray-600">
                    <X size={12} />
                  </button>
                )}
                <ChevronDown size={14} className="text-gray-400 rotate-180 flex-shrink-0" />
              </div>
            ) : (
              <button type="button" onClick={() => onAberto(true)}
                className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm hover:border-emerald-400 transition-colors">
                <div className="flex items-center gap-2 text-gray-400 italic">
                  <Scan size={14} className="text-gray-300 flex-shrink-0" />
                  <span className="text-left truncate">
                    {selecionados.length === 0
                      ? `Clique e digite para buscar em ${categoria}...`
                      : `${selecionados.length} de ${exames.length} exame(s) marcado(s)`}
                  </span>
                </div>
                <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
              </button>
            )}

            {aberto && (
              <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-xl shadow-xl mt-1 max-h-56 overflow-y-auto">
                {visiveis.length === 0 ? (
                  <div className="px-4 py-3">
                    <p className="text-xs text-gray-400 italic">
                      Nenhum resultado para &ldquo;{busca}&rdquo;
                    </p>
                    {/* Exame que não existe no catálogo se cadastra na tela de
                        Procedimentos — é lá que ele ganha categoria, valor e prestador. */}
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={onCadastrarExame}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                      <Plus size={12} /> Cadastrar exame nesta categoria
                    </button>
                  </div>
                ) : visiveis.map(ex => {
                  const marcado = selecionados.includes(ex.nome);
                  return (
                    <label
                      key={ex.id}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => onToggleExame(ex.nome)}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${marcado ? 'bg-emerald-50/60' : ''}`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        marcado ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'
                      }`}>
                        {marcado && <Check size={10} className="text-white" strokeWidth={3} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className={`text-sm block truncate ${marcado ? 'text-emerald-800 font-medium' : 'text-gray-700'}`}>
                          {ex.nome}
                        </span>
                        {ex.subcategoria && <span className="text-[10px] text-gray-400">{ex.subcategoria}</span>}
                      </div>
                      {/* O VALOR mora na linha do exame: é o que se cobra do cliente por
                          ele, com ESTE prestador. "—" = ainda sem valor cadastrado. */}
                      <span className={`text-[11px] font-semibold flex-shrink-0 ${ex.valorCliente != null ? 'text-emerald-700' : 'text-gray-300'}`}>
                        {brlExame(ex.valorCliente)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PENDÊNCIA: exame marcado sem valor para este prestador ───────────
          🔴 O aviso é o que impede o exame sair na fatura sem o preço DELE. Vem
          DEPOIS da escolha, e não antes, porque só existe quando há exame marcado:
          alertar sobre 56 radiografias que ninguém pediu seria ruído.
          ⚠️ Não BLOQUEIA o pedido — o exame pode ser pedido e o valor ajustado
          depois; travar aqui pararia o atendimento por causa de um cadastro. */}
      {semValor.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-900 leading-snug">
            <strong>{semValor.length === 1 ? '1 exame marcado' : `${semValor.length} exames marcados`}</strong>{' '}
            sem valor cadastrado para este prestador
            {semValor.length <= 3 && <> — {semValor.join(', ')}</>}.
          </p>
          <button type="button" onClick={onCadastrarValores}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 hover:underline">
            <Plus size={12} /> Cadastrar os valores agora
          </button>
        </div>
      )}
    </div>
  );
}
