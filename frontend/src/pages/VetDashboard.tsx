// src/pages/VetDashboard.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock, Plus,
  Unlink, Search, Pencil, LayoutDashboard,
} from 'lucide-react';

interface AnimalResumido {
  id:               number;
  nome:             string;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  peso?:            number | null;
  sexo?:            string | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  especie?:         { nome: string } | null;
  raca?:            { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
}

interface Solicitacao {
  id:        number;
  status:    string;
  createdAt: string;
  mensagem?: string | null;
  animal:    AnimalResumido;
}

type FiltroCampo = 'animal' | 'proprietario';

const calcularIdade = (dn: string): string => {
  const p    = dn.split('T')[0].split('-').map(Number);
  const nasc = new Date(p[0], p[1] - 1, p[2]);
  const h    = new Date();
  let anos  = h.getFullYear() - p[0];
  let meses = h.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (h.getDate() < p[2]) meses--;
  const dias = Math.floor((h.getTime() - nasc.getTime()) / 86400000);
  if (dias  < 30) return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (a: AnimalResumido): string =>
  a.dataNascimento ? calcularIdade(a.dataNascimento)
  : a.idadeAnos    ? `${a.idadeAnos} ${a.idadeAnos === 1 ? 'ano' : 'anos'}`
  : '—';

const nullToUndefined = (a: AnimalResumido) => ({
  ...a,
  photoUrl:        a.photoUrl        ?? undefined,
  dataNascimento:  a.dataNascimento  ?? undefined,
  idadeAnos:       a.idadeAnos       ?? undefined,
  peso:            a.peso            ?? undefined,
  sexo:            a.sexo            ?? undefined,
  categoriaAnimal: a.categoriaAnimal ?? undefined,
  tipoExercicio:   a.tipoExercicio   ?? undefined,
  raca:            a.raca            ?? undefined,
  especie:         a.especie         ?? undefined,
  user:            a.user            ?? undefined,
});

// ─── Card de solicitação pendente ─────────────────────────────────────────────
function SolicitacaoCard({ sol, onResponder }: {
  sol:         Solicitacao;
  onResponder: (id: number, status: 'ACEITO' | 'RECUSADO') => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          {sol.animal.photoUrl
            ? <img src={sol.animal.photoUrl} alt={sol.animal.nome} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xl">🐾</div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{sol.animal.nome}</p>
          <p className="text-xs text-gray-500 truncate">
            {sol.animal.especie?.nome} · {sol.animal.raca?.nome} · {idadeDisplay(sol.animal)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Proprietário: {sol.animal.user?.fullName ?? '—'}</p>
          {sol.mensagem && <p className="text-xs text-gray-600 mt-1 italic">"{sol.mensagem}"</p>}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => onResponder(sol.id, 'ACEITO')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors">
          <CheckCircle2 size={14} /> Aceitar
        </button>
        <button onClick={() => onResponder(sol.id, 'RECUSADO')}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 text-sm font-semibold rounded-xl transition-colors">
          <XCircle size={14} /> Recusar
        </button>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VetDashboard() {
  const { user }                    = useAuth();
  const { setSelectedAnimal }       = useSelectedAnimal();
  const navigate                    = useNavigate();

  const [meusAnimais,    setMeusAnimais]    = useState<AnimalResumido[]>([]);
  const [solicitacoes,   setSolicitacoes]   = useState<Solicitacao[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [animalToUnlink, setAnimalToUnlink] = useState<AnimalResumido | null>(null);
  const [unlinking,      setUnlinking]      = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [animaisRes, solRes] = await Promise.all([
        api.get('/animais'),
        api.get('/veterinarios/solicitacoes?status=PENDENTE'),
      ]);
      setMeusAnimais(animaisRes.data?.dados ?? []);
      setSolicitacoes(solRes.data?.dados    ?? []);
    } catch {
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

  // Navegar para o detalhe do animal selecionando-o no contexto
  const irParaAnimal = (animal: AnimalResumido) => {
    setSelectedAnimal(nullToUndefined(animal));
    navigate(`/animal/${animal.id}`);
  };

  const confirmDesvincular = async () => {
    if (!animalToUnlink) return;
    setUnlinking(true);
    try {
      await api.delete(`/animais/${animalToUnlink.id}/desvincular-vet`);
      setAnimalToUnlink(null);
      toast.success(`${animalToUnlink.nome} removido da sua lista`);
      carregar();
    } catch {
      toast.error('Erro ao desvincular');
    } finally {
      setUnlinking(false);
    }
  };

  // Filtro por tipo
  const animaisFiltrados = meusAnimais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
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
          <p className="text-sm text-gray-500 mt-0.5">
            {meusAnimais.length > 0
              ? `${meusAnimais.length} paciente${meusAnimais.length !== 1 ? 's' : ''} sob sua responsabilidade`
              : 'Nenhum paciente ainda'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {solicitacoes.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-1.5">
              <Clock size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-amber-700">
                {solicitacoes.length} pendente{solicitacoes.length > 1 ? 's' : ''}
              </span>
            </div>
          )}
          <button onClick={() => navigate('/animais')}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors">
            <Plus size={16} /> Novo Paciente
          </button>
        </div>
      </div>

      {/* Solicitações pendentes */}
      {solicitacoes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Solicitações de vínculo pendentes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {solicitacoes.map(s => <SolicitacaoCard key={s.id} sol={s} onResponder={handleResponder} />)}
          </div>
        </div>
      )}

      {/* Busca com seletor */}
      {meusAnimais.length > 0 && (
        <div className="flex gap-2">
          <select
            value={filtroCampo}
            onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
            className="border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-emerald-600 bg-white min-w-[170px]"
          >
            <option value="animal">Buscar por animal</option>
            <option value="proprietario">Buscar por proprietário</option>
          </select>
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Tabela de pacientes */}
      {meusAnimais.length > 0 ? (
        animaisFiltrados.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">Nenhum resultado para "{busca}"</p>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* Cabeçalho */}
            <div className="grid grid-cols-[40px_1fr_150px_80px_60px_110px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
              <span />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Idade</span>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sexo</span>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Ações</span>
            </div>

            {/* Linhas */}
            <div className="divide-y divide-gray-50">
              {animaisFiltrados.map(animal => (
                <div
                  key={animal.id}
                  onClick={() => irParaAnimal(animal)}
                  className="grid grid-cols-[40px_1fr_150px_80px_60px_110px] items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors group"
                >
                  {/* Foto */}
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                    {animal.photoUrl
                      ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-xl">🐴</div>
                    }
                  </div>

                  {/* Nome + proprietário */}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                      {animal.nome}
                    </p>
                    {animal.user?.fullName && (
                      <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                    )}
                  </div>

                  {/* Raça */}
                  <p className="text-sm text-gray-600 truncate">
                    {animal.raca?.nome || animal.especie?.nome || '—'}
                  </p>

                  {/* Idade */}
                  <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>

                  {/* Sexo */}
                  <p className="text-sm text-gray-600">{animal.sexo ?? '—'}</p>

                  {/* Ações */}
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      onClick={() => irParaAnimal(animal)}
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      title="Ver dashboard"
                    >
                      <LayoutDashboard size={15} />
                    </button>
                    <button
                      onClick={() => navigate(`/animais/${animal.id}`)}
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => setAnimalToUnlink(animal)}
                      className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                      title="Desvincular"
                    >
                      <Unlink size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Rodapé */}
            <div className="px-5 py-3 border-t border-gray-50 text-center">
              <p className="text-xs text-gray-400">
                {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )
      ) : solicitacoes.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-4">🩺</p>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Nenhum animal sob sua responsabilidade</h2>
          <p className="text-gray-500 text-sm mb-6">Cadastre um paciente ou aguarde solicitações de vínculo.</p>
          <button onClick={() => navigate('/animais')}
            className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-3 rounded-2xl font-semibold transition-colors">
            <Plus size={18} /> Cadastrar Paciente
          </button>
        </div>
      ) : null}

      {/* Modal — Desvincular */}
      {animalToUnlink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Unlink size={24} className="text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Desvincular paciente?</h2>
            <p className="text-gray-500 text-sm mb-6">
              Você não será mais o veterinário responsável por{' '}
              <strong className="text-gray-700">{animalToUnlink.nome}</strong>.
              O proprietário será notificado.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setAnimalToUnlink(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={confirmDesvincular} disabled={unlinking}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 text-white rounded-2xl text-sm font-semibold">
                {unlinking ? 'Removendo...' : 'Desvincular'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}