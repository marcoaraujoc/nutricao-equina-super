// frontend/src/hooks/useVetSolicitacaoMonitor.ts
// Polling de alterações de status de solicitações para vets.
// Mostra toast quando uma solicitação ACEITA/PENDENTE é cancelada pelo proprietário.
import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface SolicitacaoInfo {
  id:            number;
  status:        string;
  mensagem:      string | null;
  vetUserId:     number | null;
  solicitanteId: number | null;
  animal:        { nome: string };
}

export function useVetSolicitacaoMonitor(): void {
  const { user }  = useAuth();
  const prevRef   = useRef<Map<number, string> | null>(null); // null = primeira carga

  const role          = (user?.role     ?? '').toUpperCase();
  const userTypeUpper = (user?.userType ?? '').toUpperCase();
  // Backend controla quem pode receber solicitações (podeReceberSolicitacoes).
  // SÓCIO convidado tem isConvidado=true mas ainda pode gerenciar vínculos.
  const isVet         = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';

  const buscar = useCallback(async () => {
    try {
      const res  = await api.get<{ dados: SolicitacaoInfo[] }>('/veterinarios/solicitacoes');
      const list = res.data.dados ?? [];

      if (prevRef.current === null) {
        const mapa = new Map<number, string>();
        list.forEach(s => mapa.set(s.id, s.status));
        prevRef.current = mapa;
        return;
      }

      list.forEach(s => {
        const anterior = prevRef.current!.get(s.id);
        if ((anterior === 'PENDENTE' || anterior === 'ACEITO') && s.status === 'CANCELADO') {
          const texto = s.mensagem
            ?? `Acesso ao animal ${s.animal.nome} foi alterado pelo proprietário`;
          toast(texto, { duration: 10000, icon: '⚠️' });
        }
        // Nova solicitação recebida (não iniciada pelo próprio vet)
        const vetIniciou = s.solicitanteId != null && s.vetUserId != null
          && s.solicitanteId === s.vetUserId;
        if (anterior === undefined && s.status === 'PENDENTE' && !vetIniciou) {
          toast(`Nova solicitação pendente para ${s.animal.nome}`, { duration: 8000, icon: '🔔' });
        }
        prevRef.current!.set(s.id, s.status);
      });

      // Adiciona ao mapa solicitações que não estavam antes (ex: recém-criadas já CANCELADAS)
      list.forEach(s => {
        if (!prevRef.current!.has(s.id)) prevRef.current!.set(s.id, s.status);
      });
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    if (!isVet) return;

    buscar();
    const interval = setInterval(buscar, 30_000);
    return () => clearInterval(interval);
  }, [isVet, buscar]);
}