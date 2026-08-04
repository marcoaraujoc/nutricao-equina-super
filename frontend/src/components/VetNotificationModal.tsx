// frontend/src/components/VetNotificationModal.tsx
// Modal bloqueante que aparece para vets quando há solicitações não lidas.
// Tracking de "visto" via localStorage — evita re-exibir após dismiss.
import { useState, useMemo } from 'react';
import { Bell, CheckCircle2, XCircle, Clock } from 'lucide-react';
import FotoAnimal from './FotoAnimal';

export interface SolicitacaoNotif {
  id:               number;
  tipo:             string; // 'VINCULO' | 'DESVINCULO' | 'TROCA_VET'
  status:           string;
  solicitanteId?:   number | null;
  animal: {
    id:       number;
    nome:     string;
    photoUrl?: string | null;
    especie?:  { nome: string } | null;
    raca?:     { nome: string } | null;
    user?:     { fullName: string; phone?: string | null } | null;
  };
  novoVeterinario?: { fullName: string } | null;
}

interface Props {
  solicitations: SolicitacaoNotif[];
  vetId:         number;
  onResponder:   (id: number, status: 'ACEITO' | 'RECUSADO') => Promise<void>;
  onDismiss:     () => void;
}

const STORAGE_KEY = 's2vet_vet_seen_ids';

const getSeenIds = (vetId: number): Set<number> => {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${vetId}`);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
};

const markAsSeen = (vetId: number, ids: number[]): void => {
  const seen = getSeenIds(vetId);
  ids.forEach(id => seen.add(id));
  localStorage.setItem(`${STORAGE_KEY}_${vetId}`, JSON.stringify([...seen]));
};

export function VetNotificationModal({ solicitations, vetId, onResponder, onDismiss }: Props) {
  const seen = useMemo(() => getSeenIds(vetId), [vetId]);

  const unseen = useMemo(
    () => solicitations.filter(s => !seen.has(s.id)),
    [solicitations, seen]
  );

  const [responding, setResponding] = useState<number | null>(null);
  const [dismissed, setDismissed]   = useState(false);

  if (dismissed || unseen.length === 0) return null;

  const handleResponder = async (id: number, status: 'ACEITO' | 'RECUSADO') => {
    setResponding(id);
    try {
      await onResponder(id, status);
      const remaining = unseen.filter(s => s.id !== id);
      if (remaining.length === 0) handleFechar();
    } finally {
      setResponding(null);
    }
  };

  const handleFechar = () => {
    markAsSeen(vetId, unseen.map(s => s.id));
    setDismissed(true);
    onDismiss();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bell size={18} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900">
              {unseen.length === 1 ? 'Nova solicitação pendente' : `${unseen.length} novas solicitações`}
            </h2>
            <p className="text-xs text-gray-500">Responda agora ou feche para ver depois</p>
          </div>
          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 flex-shrink-0">
            <Clock size={11} className="text-amber-600" />
            <span className="text-xs font-semibold text-amber-700">{unseen.length}</span>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {unseen.map(sol => {
            const isDesvinculo = sol.tipo === 'DESVINCULO';
            const isTroca      = sol.tipo === 'TROCA_VET';
            const isLoading    = responding === sol.id;

            return (
              <div
                key={sol.id}
                className={`rounded-2xl border p-4 ${
                  isDesvinculo ? 'border-red-200 bg-red-50/30'
                  : isTroca    ? 'border-orange-200 bg-orange-50/30'
                  :              'border-amber-200 bg-amber-50/30'
                }`}
              >
                {(isDesvinculo || isTroca) && (
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl mb-3 ${
                    isDesvinculo ? 'text-red-700 bg-red-100' : 'text-orange-700 bg-orange-100'
                  }`}>
                    <XCircle size={11} />
                    {isDesvinculo ? 'Solicitação de remoção de acesso' : 'Solicitação de troca de veterinário'}
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    <FotoAnimal url={sol.animal.photoUrl} nome={sol.animal.nome} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{sol.animal.nome}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {[sol.animal.especie?.nome, sol.animal.raca?.nome].filter(Boolean).join(' · ')}
                    </p>
                    {isTroca && sol.novoVeterinario && (
                      <p className="text-xs text-orange-700 mt-0.5">
                        → Novo vet: Dr(a). {sol.novoVeterinario.fullName}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5 font-medium">
                      Proprietário: {sol.animal.user?.fullName ?? '—'}
                    </p>
                    {sol.animal.user?.phone && (
                      <p className="text-xs text-gray-400">Tel: {sol.animal.user.phone}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  {isDesvinculo ? (
                    <>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'ACEITO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <CheckCircle2 size={12} /> Aceitar remoção
                      </button>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'RECUSADO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <XCircle size={12} /> Manter acesso
                      </button>
                    </>
                  ) : isTroca ? (
                    <>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'ACEITO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <CheckCircle2 size={12} /> Aceitar troca
                      </button>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'RECUSADO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 hover:border-orange-300 hover:text-orange-600 text-gray-600 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <XCircle size={12} /> Manter vínculo
                      </button>
                    </>
                  ) : (
                    <>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'ACEITO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <CheckCircle2 size={12} /> Aceitar
                      </button>
                      <button disabled={isLoading} onClick={() => handleResponder(sol.id, 'RECUSADO')}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 hover:border-red-300 hover:text-red-600 text-gray-600 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50">
                        <XCircle size={12} /> Recusar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={handleFechar}
            className="w-full py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Ver depois
          </button>
        </div>
      </div>
    </div>
  );
}