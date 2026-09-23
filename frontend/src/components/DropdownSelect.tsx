// src/components/DropdownSelect.tsx
//
// Substituto do <select> nativo para os casos em que o navegador decide abrir
// as opções PARA CIMA (calcula que não há espaço embaixo — comum em modal perto
// do rodapé da tela) e a lista precisa sempre abrir PARA BAIXO. Não há CSS
// confiável para isso num <select> nativo entre navegadores; a saída é um
// dropdown próprio, com o painel sempre `absolute top-full` (mesma técnica do
// `ExameBuscaCombo` em pages/Exames.tsx).
//
// 🔴 `buscavel` (2026-09-18, a pedido) — o gatilho vira um <input> e a lista
// FILTRA ao digitar. Existe porque catálogo longo (raça, pelagem) rolado à mão é
// atrito puro: quem cadastra sabe o nome e quer digitar as três primeiras letras.
// 🔴 O QUE FOI DIGITADO SE COMPLETA SOZINHO AO SAIR DO CAMPO (2026-09-22, a
// pedido). Antes o blur DESCARTAVA o texto: quem digitava "manga", via a lista
// filtrar até uma única raça e saía com Tab ficava com o campo VAZIO — e nada
// explicava por quê. Agora `resolverDigitado` aceita o texto quando ele designa uma
// opção SEM AMBIGUIDADE: igualdade exata (sem acento/caixa), ou um único candidato
// restante no filtro (por prefixo primeiro, depois por conteúdo).
// ⚠️ O valor final continua saindo SEMPRE do CATÁLOGO — nunca do que foi digitado.
// Texto que casa com duas opções, ou com nenhuma, segue sendo descartado: o chamador
// converte nome → id casando pelo nome EXATO, e aceitar o resto gravaria um id nulo
// em silêncio.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/** Um bloco de opções com cabeçalho — ver `grupos` em Props. */
export interface GrupoOpcoes {
  label: string;
  options: string[];
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Opções sem agrupamento. Ignorado quando `grupos` é informado. */
  options?: string[];
  /**
   * Opções AGRUPADAS, com um cabeçalho por bloco (o `<optgroup>` que o dropdown
   * próprio não tinha). Existe porque o seletor do cadastro de procedimentos passou a
   * reunir DUAS listas de naturezas diferentes — especialidades clínicas e categorias
   * de exame de imagem —, e sem o cabeçalho elas viravam uma lista só, em que
   * "Radiografia" parecia mais uma especialidade.
   * ⚠️ O VALOR continua sendo o nome puro (sem prefixo): foi conferido que nenhuma
   * categoria de imagem colide com nome de especialidade do catálogo. Surgindo
   * colisão, é aqui que entra um valor qualificado — não no chamador.
   */
  grupos?: GrupoOpcoes[];
  placeholder?: string;
  className: string;
  disabled?: boolean;
  /**
   * Permite DIGITAR para filtrar as opções. Sem ele o componente é o de sempre
   * (botão + lista), então nenhum chamador existente muda de comportamento.
   */
  buscavel?: boolean;
}

const semAcento = (v: string) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export default function DropdownSelect({ value, onChange, options, grupos, placeholder, className, disabled, buscavel }: Props) {
  const [aberto, setAberto] = useState(false);
  // `null` = não está digitando (o campo mostra o valor escolhido). String = busca em
  // curso. São estados DIFERENTES: com '' o campo pareceria vazio depois de escolher.
  const [busca, setBusca] = useState<string | null>(null);
  const [destaque, setDestaque] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickFora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setAberto(false); setBusca(null); }
    };
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  const selecionar = (v: string) => { onChange(v); setAberto(false); setBusca(null); };

  // `grupos` vence `options` — um chamador que passe os dois quer a lista agrupada.
  const blocos: GrupoOpcoes[] = grupos ?? [{ label: '', options: options ?? [] }];
  const chaveBlocos = JSON.stringify(blocos);

  // ⚠️ Enquanto o texto for o RÓTULO do já escolhido, ele NÃO conta como busca —
  // senão reabrir a lista depois de escolher mostraria "nenhum resultado" para o
  // PRÓPRIO item selecionado (a armadilha do combo de animal da Agenda, §12).
  const termo = busca !== null && semAcento(busca) !== semAcento(value) ? semAcento(busca) : '';

  const blocosFiltrados = useMemo(() => {
    const base: GrupoOpcoes[] = JSON.parse(chaveBlocos);
    if (!termo) return base;
    return base
      .map(b => ({ ...b, options: b.options.filter(o => semAcento(o).includes(termo)) }))
      .filter(b => b.options.length > 0);
  }, [termo, chaveBlocos]);

  const planas = useMemo(() => blocosFiltrados.flatMap(b => b.options), [blocosFiltrados]);
  const vazio = planas.length === 0;

  useEffect(() => { setDestaque(0); }, [termo, aberto]);

  const aoTeclar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { setAberto(true); return; }
      setDestaque(i => {
        const prox = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return Math.max(0, Math.min(planas.length - 1, prox));
      });
      return;
    }
    if (e.key === 'Enter') {
      // preventDefault SEMPRE: este campo vive dentro de um <form>, e o Enter
      // solto submeteria o cadastro inteiro no meio da escolha da raça.
      e.preventDefault();
      if (aberto && planas[destaque]) selecionar(planas[destaque]);
      else setAberto(true);
      return;
    }
    if (e.key === 'Escape') { setAberto(false); setBusca(null); }
  };

  /**
   * O texto digitado designa UMA opção sem ambiguidade? Devolve-a, ou `null`.
   * Ordem deliberada: igualdade exata vence tudo (quem digitou o nome inteiro não
   * pode ser levado para outro), depois o único que COMEÇA com o termo, e só então
   * o único que o CONTÉM. Dois candidatos = ninguém escolhe pela pessoa.
   */
  const resolverDigitado = (texto: string): string | null => {
    const t = semAcento(texto);
    if (!t) return null;
    const todas = blocos.flatMap(b => b.options);
    const exata = todas.find(o => semAcento(o) === t);
    if (exata) return exata;
    const prefixo = todas.filter(o => semAcento(o).startsWith(t));
    if (prefixo.length === 1) return prefixo[0];
    const contem = todas.filter(o => semAcento(o).includes(t));
    return contem.length === 1 ? contem[0] : null;
  };

  const painel = aberto && (
    // `onMouseDown` com preventDefault: sem isso o blur do input fecharia a lista
    // ANTES de o clique na opção registrar, e escolher com o mouse não funcionaria.
    <div
      onMouseDown={e => e.preventDefault()}
      className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-56 overflow-y-auto"
    >
      {placeholder && !termo && (
        <button type="button" onClick={() => selecionar('')}
          className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50">
          {placeholder}
        </button>
      )}
      {vazio ? (
        <p className="text-xs text-gray-400 italic px-3 py-2">
          {termo ? 'Nenhuma opção encontrada' : 'Nenhuma opção disponível'}
        </p>
      ) : blocosFiltrados.map(bloco => (
        <div key={bloco.label || '_'}>
          {/* Grupo VAZIO não vira cabeçalho solto: um título sem nada embaixo é
              ruído, e sugere que a lista falhou em carregar. */}
          {bloco.label && bloco.options.length > 0 && (
            <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-50/60 sticky top-0">
              {bloco.label}
            </p>
          )}
          {bloco.options.map(o => (
            <button key={o} type="button" onClick={() => selecionar(o)}
              onMouseEnter={() => setDestaque(planas.indexOf(o))}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                o === value ? 'bg-emerald-50 text-emerald-800 font-medium'
                : planas[destaque] === o ? 'bg-gray-100 text-gray-900'
                : 'text-gray-700 hover:bg-gray-50'
              }`}>
              {o}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  if (buscavel) {
    return (
      <div className="relative" ref={ref}>
        <input
          type="text"
          disabled={disabled}
          value={busca ?? value}
          // Abre por CLICK além do FOCUS: escolhida uma opção, o input continua
          // focado, e `focus` não dispara de novo num campo já focado — só com
          // `onFocus` a lista não reabriria no clique seguinte.
          onFocus={e => { setAberto(true); e.target.select(); }}
          onClick={() => setAberto(true)}
          onChange={e => { setBusca(e.target.value); setAberto(true); }}
          onKeyDown={aoTeclar}
          // Sair do campo COMPLETA o que foi digitado, quando o texto designa uma
          // opção só; sendo ambíguo ou desconhecido, o campo volta ao valor
          // escolhido (nunca grava opção fora do catálogo).
          onBlur={() => {
            if (busca !== null) {
              const achada = resolverDigitado(busca);
              if (achada && achada !== value) onChange(achada);
            }
            setAberto(false);
            setBusca(null);
          }}
          placeholder={placeholder ?? '— Selecionar —'}
          autoComplete="off"
          className={`${className} pr-9 disabled:bg-gray-50 disabled:cursor-not-allowed`}
        />
        <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none transition-transform ${aberto ? 'rotate-180' : ''}`} />
        {painel}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled}
        onClick={() => setAberto(a => !a)}
        className={`${className} flex items-center justify-between gap-2 text-left disabled:bg-gray-50 disabled:cursor-not-allowed`}>
        <span className={value ? '' : 'text-gray-400'}>{value || (placeholder ?? '— Selecionar —')}</span>
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {painel}
    </div>
  );
}
