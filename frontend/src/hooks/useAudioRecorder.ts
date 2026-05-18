// frontend/src/hooks/useAudioRecorder.ts
// Hook de gravação estilo WhatsApp:
// - Segurar para gravar / soltar para parar (mobile)
// - Clique para iniciar / clique para parar (desktop)
// - Waveform via AnalyserNode
// - Cancelar descarta sem processar

import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioRecorderState {
  isRecording:   boolean;
  isPreparing:   boolean;   // abrindo microfone
  duration:      number;    // segundos gravados
  waveform:      number[];  // array 0-1 para renderizar barras
  blob:          Blob | null;
  error:         string | null;
}

export interface UseAudioRecorderReturn extends AudioRecorderState {
  startRecording:  () => Promise<void>;
  stopRecording:   () => void;        // para e retorna blob
  cancelRecording: () => void;        // descarta
  clearBlob:       () => void;
}

const WAVEFORM_BARS = 40;

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    isPreparing: false,
    duration:    0,
    waveform:    new Array(WAVEFORM_BARS).fill(0),
    blob:        null,
    error:       null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const streamRef        = useRef<MediaStream | null>(null);
  const analyserRef      = useRef<AnalyserNode | null>(null);
  const animFrameRef     = useRef<number>(0);
  const timerRef         = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationRef      = useRef(0);

  // ── Cleanup total ─────────────────────────────────────────────────────────

  const cleanup = useCallback((manter_stream = false) => {
    cancelAnimationFrame(animFrameRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (!manter_stream) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    durationRef.current = 0;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Waveform loop ─────────────────────────────────────────────────────────

  const startWaveform = useCallback((analyser: AnalyserNode) => {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray    = new Uint8Array(bufferLength);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);

      // Pega WAVEFORM_BARS amostras distribuídas pelo buffer
      const step    = Math.floor(bufferLength / WAVEFORM_BARS);
      const bars    = Array.from({ length: WAVEFORM_BARS }, (_, i) => {
        const sample = dataArray[i * step] / 128 - 1; // -1 a 1
        return Math.abs(sample);                        // 0 a 1
      });

      setState(prev => ({ ...prev, waveform: bars }));
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Iniciar gravação ──────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    setState(prev => ({ ...prev, isPreparing: true, error: null, blob: null }));
    audioChunksRef.current = [];

    try {
      const stream      = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Analyser para waveform
      const audioCtx    = new AudioContext();
      const source      = audioCtx.createMediaStreamSource(stream);
      const analyser    = audioCtx.createAnalyser();
      analyser.fftSize  = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder
      const mediaRecorder   = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setState(prev => ({
          ...prev,
          isRecording: false,
          isPreparing: false,
          blob,
          waveform: new Array(WAVEFORM_BARS).fill(0),
        }));
        cleanup(false);
      };

      mediaRecorder.start(500); // chunk a cada 500ms

      // Timer de duração
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setState(prev => ({ ...prev, duration: durationRef.current }));
      }, 1000);

      startWaveform(analyser);

      setState(prev => ({
        ...prev,
        isRecording: true,
        isPreparing: false,
        duration:    0,
        waveform:    new Array(WAVEFORM_BARS).fill(0),
      }));
    } catch (err) {
      cleanup();
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Permissão de microfone negada. Libere nas configurações do navegador.'
        : 'Não foi possível acessar o microfone.';
      setState(prev => ({ ...prev, isPreparing: false, isRecording: false, error: msg }));
    }
  }, [cleanup, startWaveform]);

  // ── Parar gravação (gera blob via onstop) ─────────────────────────────────

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // ── Cancelar (descarta blob) ──────────────────────────────────────────────

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    cleanup();
    audioChunksRef.current = [];
    setState({
      isRecording: false,
      isPreparing: false,
      duration:    0,
      waveform:    new Array(WAVEFORM_BARS).fill(0),
      blob:        null,
      error:       null,
    });
  }, [cleanup]);

  const clearBlob = useCallback(() => {
    setState(prev => ({ ...prev, blob: null, duration: 0 }));
  }, []);

  return { ...state, startRecording, stopRecording, cancelRecording, clearBlob };
}