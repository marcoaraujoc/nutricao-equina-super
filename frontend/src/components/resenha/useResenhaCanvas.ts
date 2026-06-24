// src/components/resenha/useResenhaCanvas.ts

import { useCallback, useRef, useState } from 'react';
import type {
  RegiaoAnatomicaEquino,
  TipoMarcacaoResenha,
  TracoResenha,
} from '../../types/resenhaGrafica';

/**
 * Testa se um ponto está dentro de um polígono via ray-casting.
 * Espelha exatamente a mesma lógica usada no backend
 * (resenhagraficaservice.js / pontoDentroDoPoligono), para garantir que
 * o feedback visual no cliente já bata com o que o servidor vai persistir.
 */
function pontoDentroDoPoligono(ponto: [number, number], poligono: [number, number][]): boolean {
  const [x, y] = ponto;
  let dentro = false;

  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    const intersecta = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersecta) dentro = !dentro;
  }

  return dentro;
}

function detectarRegioesDoTraco(
  pontos: [number, number][],
  regioes: RegiaoAnatomicaEquino[],
): string[] {
  const regioesDetectadas = new Set<string>();
  for (const ponto of pontos) {
    for (const regiao of regioes) {
      if (pontoDentroDoPoligono(ponto, regiao.poligono)) {
        regioesDetectadas.add(regiao.codigo);
      }
    }
  }
  return Array.from(regioesDetectadas);
}

export type FerramentaDesenho = 'caneta' | 'borracha';

interface UseResenhaCanvasParams {
  larguraViewBox: number;
  alturaViewBox: number;
  regioesDaVista: RegiaoAnatomicaEquino[];
}

interface TracoComMetadata extends TracoResenha {
  regioesDetectadas: string[];
}

export function useResenhaCanvas({
  larguraViewBox,
  alturaViewBox,
  regioesDaVista,
}: UseResenhaCanvasParams) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tracos, setTracos] = useState<TracoComMetadata[]>([]);
  const [ferramenta, setFerramenta] = useState<FerramentaDesenho>('caneta');
  const [corAtual, setCorAtual] = useState('#1D9E75');
  const desenhandoRef = useRef(false);
  const tracoAtualRef = useRef<[number, number][]>([]);

  const obterPosicaoNoCanvas = useCallback(
    (evento: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
      const canvas = canvasRef.current;
      if (!canvas) return [0, 0];
      const rect = canvas.getBoundingClientRect();
      const x = ((evento.clientX - rect.left) / rect.width) * larguraViewBox;
      const y = ((evento.clientY - rect.top) / rect.height) * alturaViewBox;
      return [x, y];
    },
    [larguraViewBox, alturaViewBox],
  );

  const redesenharTudo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  }, [tracos]);

  const aoIniciarTraco = useCallback(
    (evento: React.PointerEvent<HTMLCanvasElement>) => {
      const posicao = obterPosicaoNoCanvas(evento);

      if (ferramenta === 'borracha') {
        setTracos((anteriores) =>
          anteriores.filter(
            (traco) =>
              !traco.pontos.some(
                (ponto) =>
                  Math.hypot(ponto[0] - posicao[0], ponto[1] - posicao[1]) < larguraViewBox * 0.02,
              ),
          ),
        );
        return;
      }

      desenhandoRef.current = true;
      tracoAtualRef.current = [posicao];
    },
    [ferramenta, obterPosicaoNoCanvas, larguraViewBox],
  );

  const aoMoverPonteiro = useCallback(
    (evento: React.PointerEvent<HTMLCanvasElement>) => {
      if (!desenhandoRef.current) return;
      const posicao = obterPosicaoNoCanvas(evento);
      tracoAtualRef.current.push(posicao);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;

      redesenharTudo();
      ctx.beginPath();
      ctx.strokeStyle = corAtual;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      tracoAtualRef.current.forEach((ponto, indice) => {
        if (indice === 0) ctx.moveTo(ponto[0], ponto[1]);
        else ctx.lineTo(ponto[0], ponto[1]);
      });
      ctx.stroke();
    },
    [obterPosicaoNoCanvas, redesenharTudo, corAtual],
  );

  const aoFinalizarTraco = useCallback(
    (tipoMarcacao: TipoMarcacaoResenha) => {
      if (!desenhandoRef.current) return;
      desenhandoRef.current = false;

      const pontos = tracoAtualRef.current;
      if (pontos.length > 1) {
        const regioesDetectadas = detectarRegioesDoTraco(pontos, regioesDaVista);
        setTracos((anteriores) => [
          ...anteriores,
          { pontos, cor: corAtual, tipo: tipoMarcacao, regioesDetectadas },
        ]);
      }
      tracoAtualRef.current = [];
    },
    [corAtual, regioesDaVista],
  );

  const desfazerUltimoTraco = useCallback(() => {
    setTracos((anteriores) => anteriores.slice(0, -1));
  }, []);

  const limparTudo = useCallback(() => {
    setTracos([]);
  }, []);

  const carregarTracos = useCallback(
    (tracosCarregados: TracoResenha[]) => {
      const comMetadata = tracosCarregados.map((traco) => ({
        ...traco,
        regioesDetectadas: detectarRegioesDoTraco(traco.pontos, regioesDaVista),
      }));
      setTracos(comMetadata);
    },
    [regioesDaVista],
  );

  return {
    canvasRef,
    tracos,
    ferramenta,
    setFerramenta,
    corAtual,
    setCorAtual,
    aoIniciarTraco,
    aoMoverPonteiro,
    aoFinalizarTraco,
    desfazerUltimoTraco,
    limparTudo,
    carregarTracos,
    redesenharTudo,
  };
}
