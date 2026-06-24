// src/components/resenha/ResenhaStage.tsx

import { useEffect } from 'react';
import type { FocoVista, RegiaoAnatomicaEquino, TipoMarcacaoResenha } from '../../types/resenhaGrafica';
import { DOCUMENTO_RESENHA_DIMENSOES } from '../../types/resenhaGrafica';
import { useResenhaCanvas } from './useResenhaCanvas';
import resenhaEquinaFielUrl from '../../assets/resenha/resenha-equina-fiel.svg';

interface ResenhaStageProps {
  foco: FocoVista;
  regioesDaVista: RegiaoAnatomicaEquino[];
  tipoMarcacaoAtivo: TipoMarcacaoResenha;
  somenteLeitura?: boolean;
  onCanvasReady?: (controlador: ReturnType<typeof useResenhaCanvas>) => void;
}

/**
 * Renderiza o documento de resenha gráfica COMPLETO (todas as 6 vistas
 * sempre presentes no SVG, exatamente como o documento oficial), e usa
 * transform CSS (scale + translate) + clip-path para dar a impressão
 * visual de "zoom isolado" numa vista — sem nunca recortar o desenho via
 * viewBox e sem vazar partes de vistas vizinhas.
 *
 * Histórico de correção (não reabrir sem reler):
 * 1ª versão: recorte por viewBox parcial — cortava partes do cavalo.
 * 2ª versão: scale+translate sem clip-path — não cortava mais o desenho,
 *   mas cada vista vazava pedaços de vistas vizinhas nas bordas (bug
 *   relatado em produção com prints específicos por vista).
 * 3ª versão (atual): scale+translate + clip-path por vista, calibrado
 *   visualmente vista a vista, cercando cada uma das vizinhas para
 *   confirmar isolamento real antes de fixar os valores em FOCOS_VISTA.
 *
 * O clip-path é aplicado no MESMO elemento que recebe o transform de
 * zoom, e em unidades percentuais do próprio documento (não da tela),
 * então ele continua correto independente do tamanho do container.
 */
export function ResenhaStage({
  foco,
  regioesDaVista,
  tipoMarcacaoAtivo,
  somenteLeitura = false,
  onCanvasReady,
}: ResenhaStageProps) {
  const { width: docW, height: docH } = DOCUMENTO_RESENHA_DIMENSOES;

  const controlador = useResenhaCanvas({
    larguraViewBox: docW,
    alturaViewBox: docH,
    regioesDaVista,
  });

  useEffect(() => {
    onCanvasReady?.(controlador);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlador.tracos]);

  useEffect(() => {
    controlador.redesenharTudo();
  }, [controlador]);

  const transformCamera = `scale(${foco.escala}) translate(${foco.tx}%, ${foco.ty}%)`;
  const cropHeight = foco.cropHeight ?? 1.0;

  return (
    /*
     * Container externo: corta o espaço vazio abaixo da região de interesse
     * (ex: tabelas administrativas abaixo dos cavalos na vista LATERAL).
     * aspect-ratio = docW / (docH × cropHeight).
     * overflow-hidden aqui só corta verticalmente — sem alterar zoom.
     */
    <div
      className="relative w-full max-w-2xl mx-auto rounded-3xl border border-slate-200 overflow-hidden bg-white"
      style={{ aspectRatio: `${docW} / ${docH * cropHeight}` }}
    >
      {/*
       * Container interno: proporção exata do documento via padding-top trick
       * (mais confiável que aspect-ratio em elementos absolute).
       * paddingTop = docH/docW × 100% → altura = largura × ratio do SVG.
       * Ele se estende abaixo do container externo; overflow-hidden o corta.
       * SVG e canvas ficam em absolute inset-0 dentro deste div, garantindo
       * mapeamento idêntico de coordenadas — sem letterbox nem drift de traços.
       */}
      <div style={{ paddingTop: `${(docH / docW) * 100}%`, position: 'relative' }}>
        <div
          className="absolute inset-0 transition-transform duration-300"
          style={{
            transform: transformCamera,
            transformOrigin: '50% 50%',
            clipPath: foco.clipPath ?? undefined,
          }}
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
            ref={controlador.canvasRef}
            width={docW}
            height={docH}
            className="absolute inset-0 w-full h-full touch-none"
            style={{ pointerEvents: somenteLeitura ? 'none' : 'auto' }}
            onPointerDown={controlador.aoIniciarTraco}
            onPointerMove={controlador.aoMoverPonteiro}
            onPointerUp={() => controlador.aoFinalizarTraco(tipoMarcacaoAtivo)}
            onPointerLeave={() => controlador.aoFinalizarTraco(tipoMarcacaoAtivo)}
          />
        </div>
      </div>
    </div>
  );
}
