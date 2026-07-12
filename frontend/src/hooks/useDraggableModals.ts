// src/hooks/useDraggableModals.ts
// Torna os modais da aplicação arrastáveis no desktop (mouse), sem precisar
// alterar cada modal individualmente. Funciona por delegação global de eventos:
//
//   - Alça de arraste: o cabeçalho do modal (.rounded-t-2xl — padrão da app),
//     títulos (h2/h3) de modais sem cabeçalho colorido, ou qualquer elemento
//     com [data-drag-handle].
//   - O painel movido é o elemento `position: fixed` do modal, ou o filho
//     direto do overlay fixed de tela cheia (padrão overlay + painel centrado).
//   - Overlays de tela cheia (backdrop escuro) nunca são movidos.
//   - Só ativa com mouse e viewport >= 768px (mobile mantém o comportamento atual).
//   - O deslocamento vive no próprio nó DOM (CSS translate) — fechar e reabrir
//     o modal recria o nó e ele volta à posição original.
//
// Montado uma única vez em App.tsx: useDraggableModals();

import { useEffect } from 'react';

const HANDLE_SELECTOR = '[data-drag-handle], .rounded-t-2xl, .rounded-t-3xl, h2, h3';
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, label, [role="button"], [contenteditable="true"]';
const DESKTOP_MIN_WIDTH = 768;
// Faixa mínima do painel que deve permanecer visível na viewport (px)
const MIN_VISIVEL = 80;

// Backdrop/overlay de tela cheia (inset-0): cobre a viewport por inteiro.
// Painéis grandes (ex: fixed inset-x-4 top-[4vh]) NÃO cobrem — têm margens.
function cobreViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.left <= 1 && r.top <= 1 &&
         r.right >= window.innerWidth - 1 && r.bottom >= window.innerHeight - 1;
}

// Sobe na árvore a partir da alça até achar o painel do modal:
// o primeiro ancestral `fixed` (painel posicionado diretamente) ou o filho
// direto de um overlay `fixed` de tela cheia (painel centrado via flex).
function resolverPainel(handle: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = handle;
  while (el) {
    if (getComputedStyle(el).position === 'fixed') {
      return cobreViewport(el) ? null : el;
    }
    const pai: HTMLElement | null = el.parentElement;
    if (!pai) return null;
    if (getComputedStyle(pai).position === 'fixed') {
      return cobreViewport(pai) ? el : pai;
    }
    el = pai;
  }
  return null;
}

export function useDraggableModals(): void {
  useEffect(() => {
    let painel: HTMLElement | null = null;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let moveu = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      if (window.innerWidth < DESKTOP_MIN_WIDTH) return;
      const alvo = e.target as HTMLElement | null;
      if (!alvo || alvo.closest(INTERACTIVE_SELECTOR)) return;
      const handle = alvo.closest<HTMLElement>(HANDLE_SELECTOR);
      if (!handle) return;
      const p = resolverPainel(handle);
      if (!p) return;

      painel = p;
      moveu = false;
      startX = e.clientX;
      startY = e.clientY;
      baseX = Number(p.dataset.dragX ?? 0);
      baseY = Number(p.dataset.dragY ?? 0);
      // Evita seleção de texto durante o arraste
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!painel) return;
      if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) moveu = true;
      const rect = painel.getBoundingClientRect();
      const curX = Number(painel.dataset.dragX ?? 0);
      const curY = Number(painel.dataset.dragY ?? 0);
      // Posição natural do painel (sem o offset de arraste atual)
      const naturalLeft = rect.left - curX;
      const naturalTop  = rect.top - curY;

      let dx = baseX + (e.clientX - startX);
      let dy = baseY + (e.clientY - startY);

      // Mantém o modal ao alcance: parte dele sempre visível na viewport
      if (naturalLeft + rect.width + dx < MIN_VISIVEL) dx = MIN_VISIVEL - rect.width - naturalLeft;
      if (naturalLeft + dx > window.innerWidth - MIN_VISIVEL) dx = window.innerWidth - MIN_VISIVEL - naturalLeft;
      if (naturalTop + dy < 0) dy = -naturalTop;
      if (naturalTop + dy > window.innerHeight - 48) dy = window.innerHeight - 48 - naturalTop;

      painel.dataset.dragX = String(dx);
      painel.dataset.dragY = String(dy);
      painel.style.setProperty('translate', `${dx}px ${dy}px`);
    };

    const soltar = () => {
      if (!painel) return;
      painel = null;
      document.body.style.userSelect = '';
      if (moveu) {
        // Soltar o arraste sobre o backdrop dispararia um `click` no overlay
        // (o navegador emite o click no ancestral comum entre down e up) e
        // fecharia modais com close-on-backdrop. Suprime o click pós-arraste.
        const suprimirClick = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', suprimirClick, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', suprimirClick, true), 0);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', soltar, true);
    document.addEventListener('pointercancel', soltar, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', soltar, true);
      document.removeEventListener('pointercancel', soltar, true);
    };
  }, []);
}
