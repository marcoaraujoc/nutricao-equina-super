// frontend/src/components/AudioRecorderButton.tsx
// Botão de gravação estilo WhatsApp com waveform e timer
// Processa via backend (Groq Whisper + LLM) — sem dependências vulneráveis

import { useEffect, useRef, useState } from 'react';
import { Mic, X, Check, Loader2, MicOff } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import type { ResultadoOrchestracao } from '../services/audioOrchestrator';
import type { ContextoAudio } from '../services/audioQueueService';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AudioRecorderButtonProps {
  contexto:    ContextoAudio;
  animalId:    number;
  vetId:       number;
  onResultado: (r: ResultadoOrchestracao) => void;
  disabled?:   boolean;
}

// ─── Formatador de duração ────────────────────────────────────────────────────

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// ─── Waveform canvas ──────────────────────────────────────────────────────────

function Waveform({ bars }: { bars: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const barW = W / bars.length;
    const minH = 3;
    const maxH = H * 0.85;

    bars.forEach((v, i) => {
      const barH = minH + v * (maxH - minH);
      const x    = i * barW + barW * 0.2;
      const y    = (H - barH) / 2;
      ctx.fillStyle = `rgba(5, 150, 105, ${0.4 + v * 0.6})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barW * 0.6, barH, 2);
      ctx.fill();
    });
  }, [bars]);

  return <canvas ref={canvasRef} width={160} height={36} className="flex-1" />;
}

// ─── Estados internos de processamento ───────────────────────────────────────

type ProcessState = 'idle' | 'transcrevendo' | 'analisando' | 'offline' | 'erro';

// ─── Componente ───────────────────────────────────────────────────────────────

export default function AudioRecorderButton({
  contexto,
  animalId,
  vetId,
  onResultado,
  disabled = false,
}: AudioRecorderButtonProps) {
  const recorder                        = useAudioRecorder();
  const [processState, setProcessState] = useState<ProcessState>('idle');
  const [erroMsg,      setErroMsg]      = useState('');

  // Quando o blob fica pronto (após stopRecording), processa automaticamente
  useEffect(() => {
    if (!recorder.blob) return;
    handleProcessar(recorder.blob);
  }, [recorder.blob]);

  const handleProcessar = async (blob: Blob) => {
    setProcessState('transcrevendo');
    try {
      const { processarAudio } = await import('../services/audioOrchestrator');

      const resultado = await processarAudio(blob, contexto, animalId, vetId, {
        onTranscrevendo: () => setProcessState('transcrevendo'),
        onAnalisando:    () => setProcessState('analisando'),
        onLLMConcluido:  (r) => setProcessState(r.processadoOffline ? 'offline' : 'idle'),
        onErro:          (msg) => { setProcessState('erro'); setErroMsg(msg); },
      });

      recorder.clearBlob();
      onResultado(resultado);
    } catch {
      setProcessState('erro');
      setErroMsg('Erro inesperado ao processar o áudio.');
      recorder.clearBlob();
    }
  };

  const resetar = () => { setProcessState('idle'); setErroMsg(''); };

  // ── Gravando ───────────────────────────────────────────────────────────────
  if (recorder.isRecording) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-2xl">
        <button
          onClick={recorder.cancelRecording}
          className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          title="Cancelar gravação"
        >
          <X size={16} />
        </button>

        <Waveform bars={recorder.waveform} />

        <span className="text-sm font-mono font-semibold text-red-700 flex-shrink-0 w-12 text-center">
          {formatDuration(recorder.duration)}
        </span>

        <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse flex-shrink-0" />

        <button
          onClick={recorder.stopRecording}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex-shrink-0"
          title="Parar e processar"
        >
          <Check size={15} />
        </button>
      </div>
    );
  }

  // ── Preparando microfone ───────────────────────────────────────────────────
  if (recorder.isPreparing) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-xs">
        <Loader2 size={14} className="animate-spin" />
        Abrindo microfone...
      </div>
    );
  }

  // ── Transcrevendo / Analisando ─────────────────────────────────────────────
  if (processState === 'transcrevendo' || processState === 'analisando') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-2xl text-blue-700 text-xs font-medium">
        <Loader2 size={14} className="animate-spin flex-shrink-0" />
        {processState === 'transcrevendo' ? 'Transcrevendo áudio...' : 'Analisando com IA...'}
      </div>
    );
  }

  // ── Na fila offline ────────────────────────────────────────────────────────
  if (processState === 'offline') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-2xl">
        <span className="text-xs text-amber-700 flex-1">
          🎤 Áudio na fila — será processado quando a conexão voltar.
        </span>
        <button onClick={resetar} className="text-amber-500 hover:text-amber-700 flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  // ── Erro ───────────────────────────────────────────────────────────────────
  if (processState === 'erro' || recorder.error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-2xl">
        <MicOff size={13} className="text-red-500 flex-shrink-0" />
        <span className="text-xs text-red-700 flex-1">{erroMsg || recorder.error}</span>
        <button onClick={resetar} className="text-red-400 hover:text-red-600 flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    );
  }

  // ── Idle ───────────────────────────────────────────────────────────────────
  return (
    <button
      onClick={recorder.startRecording}
      disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Mic size={13} />
      Gravar áudio
    </button>
  );
}