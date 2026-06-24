// src/components/resenha/ResenhaImpressao.tsx

import { useEffect, useRef } from 'react';
import type { TracoResenha, VistaResenha } from '../../types/resenhaGrafica';
import { DOCUMENTO_RESENHA_DIMENSOES } from '../../types/resenhaGrafica';
import resenhaEquinaFielUrl from '../../assets/resenha/resenha-equina-fiel.svg';

interface VistaComTracos {
  vista: VistaResenha;
  tracos: TracoResenha[];
}

interface ResenhaImpressaoProps {
  carregando: boolean;
  vistasComTracos: VistaComTracos[];
  onVoltar: () => void;
  /** Quando true, oculta a barra de "Voltar/Imprimir" — usado quando este
   * componente é reaproveitado como preview somente-leitura na aba "Todos",
   * fora do fluxo dedicado de impressão. */
  ocultarBarraAcoes?: boolean;
}

/**
 * Renderiza o documento de resenha gráfica COMPLETO — todas as 6 vistas
 * juntas, exatamente como o layout do documento oficial — com todos os
 * traços desenhados em todas as vistas sobrepostos no mesmo SVG fiel.
 *
 * Esta é a visão usada para impressão / exportação em PDF do laudo, e
 * também reaproveitada (com ocultarBarraAcoes) como preview somente-leitura
 * na aba "Todos" do editor.
 * Diferente da tela de edição (que usa pan/zoom + clip-path por vista para
 * facilitar desenhar em mobile sem vazar vistas vizinhas), aqui não há
 * zoom nem recorte algum: o documento sai inteiro, em uma página única,
 * igual à referência original.
 */
export function ResenhaImpressao({
  carregando,
  vistasComTracos,
  onVoltar,
  ocultarBarraAcoes = false,
}: ResenhaImpressaoProps) {
  const { width: docW, height: docH } = DOCUMENTO_RESENHA_DIMENSOES;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (carregando) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const { tracos } of vistasComTracos) {
      for (const traco of tracos) {
        ctx.beginPath();
        ctx.strokeStyle = traco.cor;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        traco.pontos.forEach((ponto, indice) => {
          if (indice === 0) ctx.moveTo(ponto[0], ponto[1]);
          else ctx.lineTo(ponto[0], ponto[1]);
        });
        ctx.stroke();
      }
    }
  }, [carregando, vistasComTracos]);

  const handleImprimir = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {!ocultarBarraAcoes && (
        <div className="flex items-center justify-between print:hidden">
          <button
            type="button"
            onClick={onVoltar}
            className="rounded-full px-3 py-1.5 text-sm border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            ← Voltar para edição
          </button>
          <button
            type="button"
            onClick={handleImprimir}
            disabled={carregando}
            className="rounded-full bg-emerald-600 text-white px-5 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            Imprimir / Exportar PDF
          </button>
        </div>
      )}

      {carregando ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
          Carregando documento completo…
        </div>
      ) : (
        <div
          ref={containerRef}
          id="resenha-documento-impressao"
          className="relative w-full mx-auto rounded-3xl border border-slate-200 overflow-hidden bg-white print:rounded-none print:border-none"
          style={{ aspectRatio: `${docW} / ${docH}` }}
        >
          <svg
            viewBox={`0 0 ${docW} ${docH}`}
            className="absolute inset-0 w-full h-full text-slate-900"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            <image
              href={resenhaEquinaFielUrl}
              x={0}
              y={0}
              width={docW}
              height={docH}
              preserveAspectRatio="xMidYMid meet"
            />
          </svg>

          <canvas
            ref={canvasRef}
            width={docW}
            height={docH}
            className="absolute inset-0 w-full h-full"
          />
        </div>
      )}

      {/*
        Regras de impressão: isola o documento usando a técnica de
        "print isolation" — torna tudo invisível exceto o container do
        documento e seus descendentes, posicionando-o para ocupar a
        página inteira. Sem isso, body * { visibility: hidden } sozinho
        deixaria a página de impressão inteiramente branca, porque os
        filhos do container também ficariam escondidos.
        Ajustar @page conforme o tamanho de papel padrão da clínica
        (A4 é o mais comum no Brasil).
      */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          #resenha-documento-impressao,
          #resenha-documento-impressao * { visibility: visible; }
          #resenha-documento-impressao {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
