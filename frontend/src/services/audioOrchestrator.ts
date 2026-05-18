// frontend/src/services/audioOrchestrator.ts
// Coordena: gravação → backend → Groq Whisper (áudio→texto) + Groq LLM (texto→ações)
// Quando offline: salva blob na fila IndexedDB e processa quando internet voltar
// Chave Groq fica APENAS no backend — nunca exposta no browser

import api from './api';
import {
  adicionarNaFila,
  atualizarItem,
  listarPendentes,
  type ItemFila,
  type AcaoLLM,
  type ContextoAudio,
} from './audioQueueService';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ResultadoOrchestracao {
  textoTranscrito:   string;
  evolucaoTexto:     string;
  acoes:             AcaoLLM[];
  processadoOffline: boolean;
}

export interface OrchestratorCallbacks {
  onTranscrevendo?:        () => void;
  onAnalisando?:           () => void;
  onLLMConcluido?:         (resultado: ResultadoOrchestracao) => void;
  onErro?:                 (msg: string) => void;
}

// ─── Verificação de conectividade ─────────────────────────────────────────────

function temInternet(): boolean {
  return navigator.onLine;
}

// ─── Chamada ao backend (Whisper + LLM em um único request) ──────────────────

async function chamarBackend(
  blob:     Blob,
  contexto: ContextoAudio,
): Promise<{ textoTranscrito: string; evolucaoTexto: string; acoes: AcaoLLM[] }> {
  const formData = new FormData();
  formData.append('audio', blob, 'audio.webm');
  formData.append('contexto', contexto);

  const res = await api.post('/clinica/audio/processar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000, // 60s — Whisper pode demorar em áudios longos
  });

  return res.data.dados;
}

// ─── Orquestrador principal ───────────────────────────────────────────────────

export async function processarAudio(
  blob:      Blob,
  contexto:  ContextoAudio,
  animalId:  number,
  vetId:     number,
  callbacks: OrchestratorCallbacks = {},
): Promise<ResultadoOrchestracao> {
  const { onTranscrevendo, onAnalisando, onLLMConcluido, onErro } = callbacks;

  // Offline — salva na fila e retorna imediatamente
  if (!temInternet()) {
    await adicionarNaFila({ blob, contexto, animalId, vetId });

    const resultado: ResultadoOrchestracao = {
      textoTranscrito:   '',
      evolucaoTexto:     '',
      acoes:             [],
      processadoOffline: true,
    };
    onLLMConcluido?.(resultado);
    return resultado;
  }

  // Online — envia para o backend que faz Whisper + LLM em sequência
  try {
    onTranscrevendo?.();

    // Backend sinaliza progresso via response — enquanto aguarda mostramos "analisando"
    const processarPromise = chamarBackend(blob, contexto);

    // Simula transição de estado após ~3s (tempo médio do Whisper no Groq)
    const analisandoTimer = setTimeout(() => onAnalisando?.(), 3000);

    const { textoTranscrito, evolucaoTexto, acoes } = await processarPromise;
    clearTimeout(analisandoTimer);

    const resultado: ResultadoOrchestracao = {
      textoTranscrito,
      evolucaoTexto,
      acoes,
      processadoOffline: false,
    };
    onLLMConcluido?.(resultado);
    return resultado;

  } catch (err) {
    // Backend falhou — salva na fila para reprocessar quando conexão voltar
    const itemFila = await adicionarNaFila({ blob, contexto, animalId, vetId });
    await atualizarItem(itemFila.id, { status: 'pendente' });

    const msg = 'Áudio salvo na fila — será processado quando a conexão for restabelecida.';
    onErro?.(msg);

    const resultado: ResultadoOrchestracao = {
      textoTranscrito:   '',
      evolucaoTexto:     '',
      acoes:             [],
      processadoOffline: true,
    };
    onLLMConcluido?.(resultado);
    return resultado;
  }
}

// ─── Processador da fila (chamado quando internet volta) ─────────────────────

export async function processarFila(
  onItemConcluido?: (item: ItemFila, resultado: { evolucaoTexto: string; acoes: AcaoLLM[] }) => void,
  onItemErro?:      (item: ItemFila, erro: string) => void,
): Promise<void> {
  if (!temInternet()) return;

  const pendentes = await listarPendentes();
  if (pendentes.length === 0) return;

  for (const item of pendentes) {
    await atualizarItem(item.id, { status: 'processando' });

    try {
      const { evolucaoTexto, acoes } = await chamarBackend(item.blob, item.contexto);

      await atualizarItem(item.id, {
        status:          'concluido',
        textoTranscrito: evolucaoTexto,
        acoesLLM:        acoes,
      });

      onItemConcluido?.(item, { evolucaoTexto, acoes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      await atualizarItem(item.id, { status: 'erro', erro: msg });
      onItemErro?.(item, msg);
    }
  }
}

// ─── Listener de reconexão ────────────────────────────────────────────────────

let listenerAtivo = false;

export function iniciarListenerReconexao(
  onItemConcluido?: (item: ItemFila, resultado: { evolucaoTexto: string; acoes: AcaoLLM[] }) => void,
  onItemErro?:      (item: ItemFila, erro: string) => void,
): () => void {
  if (listenerAtivo) return () => {};

  const handler = () => {
    console.log('[AudioOrchestrator] Conexão restaurada — processando fila...');
    processarFila(onItemConcluido, onItemErro);
  };

  window.addEventListener('online', handler);
  listenerAtivo = true;

  return () => {
    window.removeEventListener('online', handler);
    listenerAtivo = false;
  };
}