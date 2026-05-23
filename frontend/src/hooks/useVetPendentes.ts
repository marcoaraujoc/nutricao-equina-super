// frontend/src/hooks/useVetPendentes.ts
// Polling de solicitações pendentes para vets.
// Mostra toast quando chega uma nova solicitação enquanto o vet está em outra tela.
import { useState, useEffect, useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function useVetPendentes(): number {
  const { user }          = useAuth();
  const [count, setCount] = useState(0);
  const prevCountRef      = useRef<number | null>(null); // null = primeira carga (sem toast)

  const isVet = (user?.role ?? '').toUpperCase() === 'VETERINARIO'
             || (user?.userType ?? '').toUpperCase() === 'VETERINARIO';

  const buscar = useCallback(async () => {
    try {
      const res  = await api.get('/veterinarios/solicitacoes/pendentes');
      const novo = res.data.dados?.length ?? 0;

      setCount(novo);

      // Notifica apenas quando o count AUMENTA e não é a primeira carga
      if (prevCountRef.current !== null && novo > prevCountRef.current) {
        const diff = novo - prevCountRef.current;
        toast.success(
          diff === 1
            ? 'Nova solicitação de vínculo pendente — veja em Pacientes'
            : `${diff} novas solicitações de vínculo pendentes — veja em Pacientes`,
          { duration: 8000, icon: '🔔' }
        );
      }

      prevCountRef.current = novo;
    } catch {
      // silencioso — badge é informativo
    }
  }, []);

  useEffect(() => {
    if (!isVet) return;

    buscar();
    const interval = setInterval(buscar, 30_000); // polling a cada 30s
    return () => clearInterval(interval);
  }, [isVet, buscar]);

  return count;
}