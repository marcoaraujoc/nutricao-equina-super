// frontend/src/components/AudioQueueBadge.tsx
// Exibe badge de áudios pendentes de processamento LLM (ficaram na fila offline)
// Quando internet volta, processa automaticamente e notifica

import { useState, useEffect, useCallback } from 'react';
import { Clock, Wifi, X, CheckCircle2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  contarPendentes,
  limparConcluidos,
  type ItemFila,
  type AcaoLLM,
} from '../services/audioQueueService';
import {
  processarFila,
  iniciarListenerReconexao,
} from '../services/audioOrchestrator';

interface AudioQueueBadgeProps {
  /** Chamado quando um item da fila for processado (para atualizar UI pai) */
  onItemProcessado?: (item: ItemFila, acoes: AcaoLLM[]) => void;
}

export default function AudioQueueBadge({ onItemProcessado }: AudioQueueBadgeProps) {
  const [pendentes,     setPendentes]     = useState(0);
  const [processando,   setProcessando]   = useState(false);
  const [showDetalhes,  setShowDetalhes]  = useState(false);
  const [isOnline,      setIsOnline]      = useState(navigator.onLine);

  // ── Atualiza contagem ─────────────────────────────────────────────────────

  const atualizarContagem = useCallback(async () => {
    const count = await contarPendentes();
    setPendentes(count);
  }, []);

  // ── Processar fila manualmente ────────────────────────────────────────────

  const handleProcessarAgora = async () => {
    if (!isOnline || processando) return;
    setProcessando(true);

    let concluidos = 0;

    await processarFila(
      async (item, { acoes }) => {
        concluidos++;
        onItemProcessado?.(item, acoes);
      },
      (item, erro) => {
        console.error(`Erro ao processar item ${item.id}:`, erro);
      },
    );

    await limparConcluidos();
    await atualizarContagem();
    setProcessando(false);

    if (concluidos > 0) {
      toast.success(`${concluidos} áudio${concluidos !== 1 ? 's' : ''} processado${concluidos !== 1 ? 's' : ''} com sucesso!`);
    }
  };

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    atualizarContagem();

    // Listener de online/offline
    const handleOnline  = () => { setIsOnline(true);  atualizarContagem(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listener de reconexão — processa fila automaticamente
    const cleanup = iniciarListenerReconexao(
      async (item, { acoes }) => {
        onItemProcessado?.(item, acoes);
        await atualizarContagem();
        toast.success('Áudio da fila processado!');
      },
      (item, erro) => {
        console.error(`Fila: erro no item ${item.id}:`, erro);
      },
    );

    // Verifica contagem a cada 30s (caso outro componente adicione à fila)
    const interval = setInterval(atualizarContagem, 30000);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      cleanup();
      clearInterval(interval);
    };
  }, [atualizarContagem, onItemProcessado]);

  // Não renderiza se não há pendentes
  if (pendentes === 0) return null;

  return (
    <div className="relative">
      {/* Badge compacto */}
      <button
        onClick={() => setShowDetalhes(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
          isOnline
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
            : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
        }`}
      >
        {isOnline
          ? <Wifi size={12} className="flex-shrink-0" />
          : <Clock size={12} className="flex-shrink-0" />
        }
        {pendentes} áudio{pendentes !== 1 ? 's' : ''} na fila
      </button>

      {/* Painel de detalhes */}
      {showDetalhes && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl border border-gray-100 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-gray-500" />
              <span className="text-sm font-semibold text-gray-900">Fila de áudios</span>
            </div>
            <button onClick={() => setShowDetalhes(false)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>

          <div className="p-4">
            {/* Status de conexão */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium mb-3 ${
              isOnline
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {isOnline
                ? <><CheckCircle2 size={13} /> Online — pronto para processar</>
                : <><AlertCircle size={13} /> Offline — processará quando conectar</>
              }
            </div>

            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              {isOnline
                ? `${pendentes} áudio${pendentes !== 1 ? 's foram transcritos' : ' foi transcrito'} mas ainda não ${pendentes !== 1 ? 'foram analisados' : 'foi analisado'} pela IA. Clique para processar agora.`
                : `${pendentes} áudio${pendentes !== 1 ? 's aguardam' : ' aguarda'} conexão com a internet para análise pela IA.`
              }
            </p>

            {isOnline && (
              <button
                onClick={handleProcessarAgora}
                disabled={processando}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                {processando
                  ? <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processando...</>
                  : <>Processar {pendentes} áudio{pendentes !== 1 ? 's' : ''} agora</>
                }
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}