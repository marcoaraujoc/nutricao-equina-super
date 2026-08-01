// src/components/FotoEditorModal.tsx
//
// Editor de foto: ZOOM (redimensionar) + ARRASTAR (reposicionar) dentro de um quadro
// fixo, devolvendo um arquivo já recortado. Sem biblioteca externa — a conta é a mesma
// dos dois lados (preview e canvas), só muda a escala de saída.
//
// POR QUE RECORTAR NO CLIENTE: a foto é exibida como avatar quadrado (`object-cover`),
// que corta pelo centro. Retrato em pé vira "queixo e testa"; o usuário não tinha como
// escolher o enquadramento. Aqui ele escolhe, e o que sobe já é o que se vê.
import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, Loader2, Move } from 'lucide-react';

const QUADRO_MAX = 288; // lado máximo do quadro de recorte na tela (px)
const SAIDA      = 512; // lado do arquivo final (px) — avatar de 48px com folga para retina
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;

interface Props {
  /** Arquivo escolhido OU URL de uma foto já salva (mesma origem — /uploads). */
  origem: File | string;
  onConfirmar: (arquivo: File) => void;
  onCancelar: () => void;
}

export default function FotoEditorModal({ origem, onConfirmar, onCancelar }: Props) {
  const [src, setSrc]         = useState<string | null>(null);
  const [zoom, setZoom]       = useState(1);
  const [offset, setOffset]   = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [gerando, setGerando] = useState(false);

  const imgRef    = useRef<HTMLImageElement | null>(null);
  const quadroRef = useRef<HTMLDivElement | null>(null);
  const arrasteRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // O quadro encolhe em tela estreita (`max-w-md` + paddings). A conta do recorte PRECISA
  // usar o lado REAL: com um valor fixo, o que o canvas gera deixa de ser o que a
  // pessoa enquadrou — a imagem é clipada pela largura real, não pela constante.
  const [lado, setLado] = useState(QUADRO_MAX);
  useEffect(() => {
    const el = quadroRef.current;
    if (!el) return;
    const medir = () => setLado(el.getBoundingClientRect().width || QUADRO_MAX);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // File → dataURL; string já é URL. O objectURL é revogado no cleanup.
  useEffect(() => {
    if (typeof origem === 'string') { setSrc(origem); return; }
    const url = URL.createObjectURL(origem);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [origem]);

  // Escala que faz a imagem COBRIR o quadro (nunca sobra borda vazia), vezes o zoom.
  const escala = natural ? Math.max(lado / natural.w, lado / natural.h) * zoom : 1;
  const larg   = natural ? natural.w * escala : 0;
  const alt    = natural ? natural.h * escala : 0;

  // Limite de arraste: a imagem não pode descolar do quadro e mostrar vazio.
  const limite = { x: Math.max(0, (larg - lado) / 2), y: Math.max(0, (alt - lado) / 2) };
  const prender = (v: number, max: number) => Math.min(max, Math.max(-max, v));

  // Ao mudar o zoom, o offset atual pode estourar o novo limite — reprende.
  useEffect(() => {
    setOffset(o => ({ x: prender(o.x, limite.x), y: prender(o.y, limite.y) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, natural, lado]);

  // Pointer events cobrem mouse E toque com o mesmo código (mobile-first).
  const aoPressionar = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    arrasteRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const aoMover = (e: React.PointerEvent) => {
    const a = arrasteRef.current;
    if (!a) return;
    setOffset({
      x: prender(a.ox + (e.clientX - a.x), limite.x),
      y: prender(a.oy + (e.clientY - a.y), limite.y),
    });
  };
  const aoSoltar = () => { arrasteRef.current = null; };

  const confirmar = () => {
    const img = imgRef.current;
    if (!img || !natural) return;
    setGerando(true);

    const canvas = document.createElement('canvas');
    canvas.width = SAIDA; canvas.height = SAIDA;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SAIDA, SAIDA);

    // MESMA conta do preview, só multiplicada pela razão entre o quadro e a saída.
    const k = SAIDA / lado;
    ctx.drawImage(
      img,
      SAIDA / 2 - (larg * k) / 2 + offset.x * k,
      SAIDA / 2 - (alt  * k) / 2 + offset.y * k,
      larg * k,
      alt  * k,
    );

    canvas.toBlob(blob => {
      setGerando(false);
      if (!blob) { onCancelar(); return; }
      onConfirmar(new File([blob], 'foto.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
    }, 'image/jpeg', 0.85);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <h3 className="text-sm font-bold text-gray-800">Ajustar foto</h3>
          <button type="button" onClick={onCancelar}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4 overflow-y-auto">
          <div
            ref={quadroRef}
            className="relative overflow-hidden rounded-2xl bg-gray-100 cursor-grab active:cursor-grabbing touch-none select-none w-full"
            style={{ maxWidth: QUADRO_MAX, aspectRatio: '1 / 1' }}
            onPointerDown={aoPressionar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt="Foto a ajustar"
                draggable={false}
                onLoad={e => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                  setOffset({ x: 0, y: 0 });
                  setZoom(1);
                }}
                style={{
                  position: 'absolute',
                  width:  larg  || undefined,
                  height: alt   || undefined,
                  left: lado / 2 - larg / 2 + offset.x,
                  top:  lado / 2 - alt  / 2 + offset.y,
                  maxWidth: 'none',
                }}
              />
            )}
            {/* Guia do recorte circular — o avatar da Equipe é arredondado */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-black/10" />
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <Move size={12} /> Arraste a imagem para reposicionar
          </p>

          <div className="w-full flex items-center gap-3">
            <ZoomIn size={16} className="text-gray-400 flex-shrink-0" />
            <input
              type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.01} value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="flex-1 accent-emerald-600 cursor-pointer"
              aria-label="Ampliar ou reduzir a foto"
            />
            <span className="text-xs text-gray-400 w-10 text-right tabular-nums">{zoom.toFixed(1)}×</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3 border-t border-gray-100">
          <button type="button" onClick={onCancelar}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button type="button" onClick={confirmar} disabled={!natural || gerando}
            className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
            {gerando && <Loader2 size={13} className="animate-spin" />}
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
