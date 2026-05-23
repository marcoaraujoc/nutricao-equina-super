// frontend/src/hooks/useProprietarioNotificacoes.ts
// Polling de status de solicitações para proprietários.
// Mostra toast quando um vet aceita ou recusa o vínculo.
import { useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

interface SolicitacaoStatus {
  id:               number;
  tipo:             string;
  status:           string;
  updatedAt:        string;
  animal:           { nome: string };
  veterinario:      { fullName: string };
  novoVeterinario?: { fullName: string } | null;
}

function notificarAceito(s: SolicitacaoStatus): void {
  if (s.tipo === 'DESVINCULO') {
    toast.success(
      `Dr(a). ${s.veterinario.fullName} confirmou a remoção do acesso ao animal ${s.animal.nome}`,
      { duration: 10000, icon: '🔓' },
    );
  } else if (s.tipo === 'TROCA_VET') {
    const novoVet = s.novoVeterinario?.fullName ?? 'novo veterinário';
    toast.success(
      `Dr(a). ${s.veterinario.fullName} aprovou a troca para Dr(a). ${novoVet} no animal ${s.animal.nome}`,
      { duration: 10000, icon: '🔄' },
    );
  } else {
    toast.success(
      `Dr(a). ${s.veterinario.fullName} aceitou o vínculo com ${s.animal.nome}`,
      { duration: 10000, icon: '✅' },
    );
  }
}

function notificarRecusado(s: SolicitacaoStatus): void {
  if (s.tipo === 'DESVINCULO') {
    toast.success(
      `Dr(a). ${s.veterinario.fullName} manteve o acesso ao animal ${s.animal.nome}`,
      { duration: 10000, icon: '🔒' },
    );
  } else if (s.tipo === 'TROCA_VET') {
    toast.error(
      `Dr(a). ${s.veterinario.fullName} recusou a troca de veterinário para o animal ${s.animal.nome}`,
      { duration: 10000 },
    );
  } else {
    toast.error(
      `Dr(a). ${s.veterinario.fullName} recusou o vínculo com ${s.animal.nome}`,
      { duration: 10000 },
    );
  }
}

export function useProprietarioNotificacoes(): void {
  const { user }      = useAuth();
  const prevStatusRef = useRef<Map<number, string> | null>(null);

  const role          = (user?.role     ?? '').toUpperCase();
  const userTypeUpper = (user?.userType ?? '').toUpperCase();
  const isProprietario = role !== 'VETERINARIO' && role !== 'ADMIN'
                      && userTypeUpper !== 'VETERINARIO';

  const buscar = useCallback(async () => {
    try {
      const res  = await api.get<{ dados: SolicitacaoStatus[] }>('/animais/minhas-solicitacoes');
      const list = res.data.dados ?? [];

      if (prevStatusRef.current === null) {
        // Primeira carga — apenas inicializa o mapa sem notificar
        const mapa = new Map<number, string>();
        list.forEach(s => mapa.set(s.id, s.status));
        prevStatusRef.current = mapa;
        return;
      }

      list.forEach(s => {
        const anterior = prevStatusRef.current!.get(s.id);

        if (anterior === 'PENDENTE') {
          // Transição normal — vet respondeu entre dois polls
          if (s.status === 'ACEITO')        notificarAceito(s);
          else if (s.status === 'RECUSADO') notificarRecusado(s);
        } else if (anterior === undefined && s.status !== 'PENDENTE') {
          // Registro apareceu já resolvido — vet respondeu no mesmo intervalo de 30s
          // em que o proprietário criou a solicitação; notifica se recente (<90s)
          const ageMs = s.updatedAt
            ? Date.now() - new Date(s.updatedAt).getTime()
            : Infinity;
          if (ageMs < 90_000) {
            if (s.status === 'ACEITO')   notificarAceito(s);
            if (s.status === 'RECUSADO') notificarRecusado(s);
          }
        }

        prevStatusRef.current!.set(s.id, s.status);
      });
    } catch {
      // silencioso — notificação é informativa
    }
  }, []);

  useEffect(() => {
    if (!isProprietario) return;

    buscar();
    const interval = setInterval(buscar, 30_000);
    return () => clearInterval(interval);
  }, [isProprietario, buscar]);
}