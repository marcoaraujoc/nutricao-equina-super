// src/pages/VetDashboard.tsx
// Dashboard exclusivo para veterinários
// Mostra: solicitações pendentes, animais aceitos, seletor de animal ativo

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock, Utensils,
  FlaskConical, FileText, ClipboardList, ChevronDown,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnimalResumido {
  id: number; nome: string; photoUrl?: string | null;
  dataNascimento?: string | null; idadeAnos?: number | null;
  peso?: number | null; sexo?: string | null;
  categoriaAnimal?: string | null; tipoExercicio?: string | null;
  especie?: { nome: string } | null;
  raca?:   { nome: string } | null;
  user?:   { fullName: string; email: string } | null;
}

interface Solicitacao {
  id: number; status: string; createdAt: string;
  mensagem?: string | null; animal: AnimalResumido;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const calcularIdade = (dn: string): string => {
  const p = dn.split('T')[0].split('-').map(Number);
  const nasc = new Date(p[0], p[1] - 1, p[2]);
  const h    = new Date();
  let anos = h.getFullYear() - p[0];
  let meses = h.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (h.getDate() < p[2]) meses--;
  const dias = Math.floor((h.getTime() - nasc.getTime()) / 86400000);
  if (dias < 30)  return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (a: AnimalResumido) =>
  a.dataNascimento ? calcularIdade(a.dataNascimento)
  : a.idadeAnos    ? `${a.idadeAnos} ${a.idadeAnos === 1 ? 'ano' : 'anos'}`
  : '—';

// ─── Sub-componente: Card de solicitação ─────────────────────────────────────

function SolicitacaoCard({
  sol, onResponder,
}: {
  sol: Solicitacao;
  onResponder: (id: number, status: 'ACEITO' | 'RECUSADO') => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          {sol.animal.photoUrl
            ? <img src={sol.animal.photoUrl} alt={sol.animal.nome} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xl">🐾</div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900">{sol.animal.nome}</p>
          <p className="text-xs text-gray-500">
            {sol.animal.especie?.nome} · {sol.animal.raca?.nome} · {idadeDisplay(sol.animal)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Proprietário: {sol.animal.user?.fullName ?? '—'}
          </p>
          {sol.mensagem && (
            <p className="text-xs text-gray-600 mt-1 italic">"{sol.mensagem}"</p>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onResponder(sol.id, 'ACEITO')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors">
          <CheckCircle2 size={15} /> Aceitar
        </button>
        <button
          onClick={() => onResponder(sol.id, 'RECUSADO')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 text-sm font-semibold rounded-xl transition-colors">
          <XCircle size={15} /> Recusar
        </button>
      </div>
    </div>
  );
}

// ─── Sub-componente: Animal ativo ─────────────────────────────────────────────

function AnimalAtivoCard({
  animal, onNavigate,
}: { animal: AnimalResumido; onNavigate: (path: string) => void }) {
  const atalhos = [
    { label: 'Dieta',      icon: Utensils,     path: `/dieta/${animal.id}`                  },
    { label: 'Exames',     icon: FlaskConical,  path: `/exames/${animal.id}`                 },
    { label: 'Relatório',  icon: FileText,      path: `/relatorio-nutricional/${animal.id}`  },
    { label: 'Prontuário', icon: ClipboardList, path: `/animal/${animal.id}`                 },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-3xl shadow-md border border-gray-100 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <div className="w-full sm:w-48 h-40 sm:h-auto bg-gray-200 flex-shrink-0">
            <img
              src={animal.photoUrl || 'https://picsum.photos/id/1015/400/400'}
              alt={animal.nome}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 p-5 sm:p-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">{animal.nome}</h2>
            <p className="text-emerald-600 font-medium mt-1">
              {animal.raca?.nome || animal.especie?.nome || '—'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {[
                { l: 'Espécie',  v: animal.especie?.nome },
                { l: 'Sexo',     v: animal.sexo },
                { l: 'Idade',    v: idadeDisplay(animal) },
                { l: 'Peso',     v: animal.peso ? `${animal.peso} kg` : '—' },
                { l: 'Perfil NRC', v: animal.categoriaAnimal ? `${animal.categoriaAnimal} · ${animal.tipoExercicio}` : 'Não informado' },
                { l: 'Proprietário', v: animal.user?.fullName },
              ].filter(i => i.v).map(({ l, v }) => (
                <div key={l}>
                  <span className="block text-[10px] uppercase text-gray-400 tracking-wider mb-0.5">{l}</span>
                  <span className="text-sm font-semibold text-gray-900">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {atalhos.map(({ label, icon: Icon, path }) => (
          <button key={label} onClick={() => onNavigate(path)}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-md hover:border-emerald-200 transition-all p-4 flex flex-col items-center gap-2 text-center">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
              <Icon size={20} />
            </div>
            <span className="text-xs font-semibold text-gray-700">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VetDashboard() {
  const { user }                              = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();

  const [meusAnimais,    setMeusAnimais]    = useState<AnimalResumido[]>([]);
  const [solicitacoes,   setSolicitacoes]   = useState<Solicitacao[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [animalAtivo,    setAnimalAtivo]    = useState<AnimalResumido | null>(null);
  const [showDropdown,   setShowDropdown]   = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [animaisRes, solRes] = await Promise.all([
        api.get('/veterinarios/meus-animais'),
        api.get('/veterinarios/solicitacoes?status=PENDENTE'),
      ]);
      const animais   = animaisRes.data?.dados ?? [];
      const sols      = solRes.data?.dados    ?? [];
      setMeusAnimais(animais);
      setSolicitacoes(sols);

      // Auto-seleciona o primeiro animal ou mantém o selecionado
      if (animais.length > 0) {
        const current = animais.find((a: AnimalResumido) => a.id === selectedAnimal?.id);
        const toSelect = current ?? animais[0];
        setAnimalAtivo(toSelect);
        setSelectedAnimal({ ...toSelect, photoUrl: toSelect.photoUrl ?? undefined });
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const handleResponder = async (id: number, status: 'ACEITO' | 'RECUSADO') => {
    try {
      await api.patch(`/veterinarios/solicitacoes/${id}`, { status });
      toast.success(status === 'ACEITO' ? 'Animal aceito!' : 'Solicitação recusada.');
      carregar();
    } catch {
      toast.error('Erro ao responder solicitação');
    }
  };

  const handleSelecionarAnimal = (animal: AnimalResumido) => {
    setAnimalAtivo(animal);
    setSelectedAnimal({ ...animal, photoUrl: animal.photoUrl ?? undefined });
    setShowDropdown(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Olá, Dr(a). {user?.fullName?.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Painel clínico veterinário</p>
        </div>

        {/* Solicitações pendentes badge */}
        {solicitacoes.length > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2">
            <Clock size={16} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-700">
              {solicitacoes.length} solicitação{solicitacoes.length > 1 ? 'ões' : ''} pendente{solicitacoes.length > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Solicitações pendentes */}
      {solicitacoes.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-700 mb-3">Solicitações de vínculo pendentes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {solicitacoes.map(s => (
              <SolicitacaoCard key={s.id} sol={s} onResponder={handleResponder} />
            ))}
          </div>
        </div>
      )}

      {/* Seletor de animal ativo */}
      {meusAnimais.length > 1 && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Animal em acompanhamento
          </label>
          <div className="relative">
            <button
              onClick={() => setShowDropdown(d => !d)}
              className="w-full flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 text-left shadow-sm hover:border-emerald-400 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  {animalAtivo?.photoUrl
                    ? <img src={animalAtivo.photoUrl} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-400">🐾</div>
                  }
                </div>
                <span className="font-semibold text-gray-900 truncate">{animalAtivo?.nome ?? 'Selecionar animal'}</span>
              </div>
              <ChevronDown size={16} className={`text-gray-400 flex-shrink-0 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-10 overflow-hidden">
                {meusAnimais.map(a => (
                  <button key={a.id} onClick={() => handleSelecionarAnimal(a)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${animalAtivo?.id === a.id ? 'bg-emerald-50' : ''}`}>
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                      {a.photoUrl
                        ? <img src={a.photoUrl} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">🐾</div>
                      }
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{a.nome}</p>
                      <p className="text-xs text-gray-400">{a.especie?.nome} · {idadeDisplay(a)}</p>
                    </div>
                    {animalAtivo?.id === a.id && <CheckCircle2 size={14} className="text-emerald-600 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Animal ativo */}
      {animalAtivo ? (
        <AnimalAtivoCard animal={animalAtivo} onNavigate={navigate} />
      ) : meusAnimais.length === 0 && solicitacoes.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-3xl mb-4">🩺</p>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Nenhum animal sob sua responsabilidade</h2>
          <p className="text-gray-500 text-sm">
            Quando proprietários solicitarem seu vínculo, eles aparecerão aqui para aprovação.
          </p>
        </div>
      ) : null}

    </div>
  );
}