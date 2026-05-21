// src/services/whisperService.ts
// Transcrição offline via Whisper rodando no browser (WebAssembly)
// Instalação: npm install @xenova/transformers
//
// Na primeira execução baixa ~80MB (Xenova/whisper-small) e armazena em cache.
// Nas execuções seguintes o modelo já está em cache — totalmente offline.

type ProgressCallback = (progress: number) => void;

// Singleton — o pipeline é carregado uma vez e reutilizado
let transcriber: ((audio: string, opts?: object) => Promise<{ text: string }>) | null = null;
let carregando = false;

export async function carregarModelo(onProgress?: ProgressCallback): Promise<void> {
  if (transcriber || carregando) return;
  carregando = true;

  try {
    const { pipeline } = await import('@huggingface/transformers');

    transcriber = await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-small',
      {
        progress_callback: (info: Record<string, unknown>) => {
            if (onProgress && typeof info.progress === 'number') {
                onProgress(Math.round(info.progress));
            }
            },
      }
    ) as unknown as typeof transcriber; // ← única mudança
  } finally {
    carregando = false;
  }
}

/**
 * Transcreve um Blob de áudio offline usando Whisper local.
 * @param audioBlob  Blob em formato webm/opus ou wav
 * @returns Texto transcrito em português
 */
export async function transcreverOffline(audioBlob: Blob): Promise<string> {
  if (!transcriber) {
    await carregarModelo();
  }
  if (!transcriber) throw new Error('Modelo Whisper não disponível');

  const url = URL.createObjectURL(audioBlob);
  try {
    const resultado = await transcriber(url, {
      language:       'portuguese',
      task:           'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return resultado?.text?.trim() ?? '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Retorna true se o navegador está online */
export function estaOnline(): boolean {
  return navigator.onLine;
}

/** Detecta se está em dispositivo mobile (touch) */
export function isMobile(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 0)
  );
}