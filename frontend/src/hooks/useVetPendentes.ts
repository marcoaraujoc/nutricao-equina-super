// frontend/src/hooks/useVetPendentes.ts
import { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function useVetPendentes(): number {
  const { user }    = useAuth();
  const [count, setCount] = useState(0);

  const isVet = (user?.role ?? '').toUpperCase() === 'VETERINARIO'
             || (user?.userType ?? '').toUpperCase() === 'VETERINARIO';

  useEffect(() => {
    if (!isVet) return;

    const buscar = async () => {
      try {
        const res = await api.get('/veterinarios/solicitacoes/pendentes');
        setCount(res.data.dados?.length ?? 0);
      } catch {
        // silencioso — badge é informativo
      }
    };

    buscar();
    const interval = setInterval(buscar, 60_000); // polling leve a cada 60s
    return () => clearInterval(interval);
  }, [isVet]);

  return count;
}