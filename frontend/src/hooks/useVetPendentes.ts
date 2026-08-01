// frontend/src/hooks/useVetPendentes.ts
// Polling de solicitações pendentes para vets.
// Mostra toast quando chega uma nova solicitação enquanto o vet está em outra tela.
//
// STORE ÚNICO no módulo: o hook é consumido em DOIS lugares (o sino do AppHeader e o
// badge de "Pacientes" na Sidebar). Um estado por componente significaria duas
// requisições a cada 30s e DOIS toasts para a mesma solicitação nova. Aqui há um só
// interval, compartilhado por todos os assinantes, encerrado quando o último sai.
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const INTERVALO_MS = 30_000;

let contagem = 0;
let contagemAnterior: number | null = null;  // null = primeira carga (sem toast)
let timer: ReturnType<typeof setInterval> | null = null;
const assinantes = new Set<(n: number) => void>();

async function buscar() {
  try {
    const res  = await api.get('/veterinarios/solicitacoes/pendentes');
    if (!res.data) return;                    // GET 403 → data null (armadilha #23)
    const novo = res.data.dados?.length ?? 0;

    // Notifica apenas quando o count AUMENTA e não é a primeira carga
    if (contagemAnterior !== null && novo > contagemAnterior) {
      const diff = novo - contagemAnterior;
      toast.success(
        diff === 1
          ? 'Nova solicitação de vínculo pendente — veja em Pacientes'
          : `${diff} novas solicitações de vínculo pendentes — veja em Pacientes`,
        { duration: 8000, icon: '🔔' },
      );
    }

    contagemAnterior = novo;
    contagem = novo;
    assinantes.forEach((notificar) => notificar(novo));
  } catch {
    // silencioso — badge é informativo
  }
}

export function useVetPendentes(): number {
  const { user }          = useAuth();
  const [count, setCount] = useState(contagem);

  const isVet = (user?.role ?? '').toUpperCase() === 'VETERINARIO'
             || (user?.userType ?? '').toUpperCase() === 'VETERINARIO';

  useEffect(() => {
    if (!isVet) return;

    assinantes.add(setCount);
    setCount(contagem);

    // Só o primeiro assinante liga o polling
    if (!timer) {
      buscar();
      timer = setInterval(buscar, INTERVALO_MS);
    }

    return () => {
      assinantes.delete(setCount);
      if (assinantes.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
        contagem = 0;
        contagemAnterior = null;   // próxima sessão recomeça sem toast retroativo
      }
    };
  }, [isVet]);

  return isVet ? count : 0;
}
