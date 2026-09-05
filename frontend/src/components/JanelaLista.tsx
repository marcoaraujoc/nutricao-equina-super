// frontend/src/components/JanelaLista.tsx
// Janela de rolagem para listas de HISTÓRICO: mostra os N primeiros itens (5, por
// padrão) e o resto se alcança rolando — vertical para os itens, horizontal para a
// tabela larga.
//
// POR QUÊ: um histórico com 40 linhas empurrava o resto da tela para fora da dobra,
// e a página inteira virava a rolagem daquele card. Com a janela, o histórico ocupa
// uma altura previsível em toda tela do sistema e o que está ABAIXO dele volta a ser
// alcançável.
//
// 🔴 A ALTURA É MEDIDA, não estimada. Um `max-h` fixo em `rem` erraria em quase todo
// lugar: a linha de tabela do desktop tem ~40px, o card do mobile passa de 120px, e
// o mesmo card cresce quando o registro tem justificativa de cancelamento. Medir os
// N primeiros itens de verdade é o que faz "5 primeiros" significar cinco itens em
// qualquer uma dessas situações.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Quantos itens ficam visíveis antes de precisar rolar. */
  maxItens?:  number;
  /**
   * Como achar os itens. O padrão cobre os dois formatos do sistema: linha de
   * tabela no desktop e card no mobile (`data-item-lista`). Passe outro seletor
   * quando a lista não for nenhum dos dois.
   */
  seletor?:   string;
  className?: string;
  children:   ReactNode;
}

/** Sobra para a linha seguinte "espiar" na borda — é o que sinaliza que há mais. */
const ESPIA_PX = 14;

export default function JanelaLista({
  maxItens = 5, seletor = 'tbody > tr, [data-item-lista]', className = '', children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | null>(null);

  useLayoutEffect(() => {
    const caixa = ref.current;
    if (!caixa) return;

    const medir = () => {
      // Fallback para os filhos DIRETOS: nem toda lista é tabela ou card marcado —
      // o histórico do shell de Atendimento, por exemplo, alterna `<button>` (item
      // avulso) e `<div>` (grupo com evolução). Exigir um marcador em cada forma
      // seria espalhar detalhe da janela por dentro de cada tela.
      const achados = Array.from(caixa.querySelectorAll<HTMLElement>(seletor));
      const itens = achados.length > 0
        ? achados
        : Array.from(caixa.children) as HTMLElement[];
      // Menos itens que o teto: sem janela nenhuma. Um `max-height` aqui só criaria
      // um espaço vazio embaixo de uma lista que já cabia inteira.
      if (itens.length <= maxItens) { setAltura(null); return; }

      const usados = itens.slice(0, maxItens)
        .reduce((soma, el) => soma + el.getBoundingClientRect().height, 0);
      // O cabeçalho da tabela fica FIXO no topo da janela (`sticky`, abaixo), então
      // ele não é um dos itens: a altura dele entra por fora, senão a janela mostra
      // quatro linhas e meia em vez de cinco.
      const thead = caixa.querySelector<HTMLElement>('thead');
      const cabecalho = thead?.getBoundingClientRect().height ?? 0;

      setAltura(usados > 0 ? Math.round(usados + cabecalho + ESPIA_PX) : null);
    };

    medir();
    // A altura de um item muda com o conteúdo (justificativa longa, quebra de linha
    // ao estreitar a tela) e a lista muda com filtro/paginação — as duas coisas
    // precisam remedir, ou a janela congela na medida da primeira renderização.
    const ro = new ResizeObserver(medir);
    ro.observe(caixa);
    const mo = new MutationObserver(medir);
    mo.observe(caixa, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [maxItens, seletor, children]);

  // Remede na troca de tamanho da janela: desktop → mobile troca tabela por card, e
  // a altura de 5 itens é outra.
  useEffect(() => {
    const aoRedimensionar = () => setAltura(a => (a === null ? a : a));
    window.addEventListener('resize', aoRedimensionar);
    return () => window.removeEventListener('resize', aoRedimensionar);
  }, []);

  return (
    <div
      ref={ref}
      // `overflow-auto` cobre os DOIS eixos: vertical para os itens e horizontal
      // para a tabela larga, que antes forçava a página inteira a rolar de lado.
      // O `[&_thead_th]:sticky` prende o cabeçalho no topo da janela sem exigir
      // alteração em nenhuma das tabelas que passam por aqui.
      className={`overflow-auto overscroll-contain
                  [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10
                  ${className}`}
      style={altura ? { maxHeight: altura } : undefined}
    >
      {children}
    </div>
  );
}
