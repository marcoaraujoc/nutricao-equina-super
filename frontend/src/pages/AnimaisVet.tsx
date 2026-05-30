// src/pages/AnimaisVet.tsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Pencil, Unlink, Search, LayoutDashboard, ArrowLeft, CheckCircle2, XCircle, Clock, UserPlus, X } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { VetNotificationModal, type SolicitacaoNotif } from '../components/VetNotificationModal';

interface Solicitacao {
  id:               number;
  tipo:             string; // 'VINCULO' | 'DESVINCULO' | 'TROCA_VET'
  status:           string;
  solicitanteId?:   number | null;
  mensagem?:        string | null;
  novoVeterinario?: { fullName: string } | null;
  animal: {
    id:       number;
    nome:     string;
    photoUrl?: string | null;
    especie?:  { nome: string } | null;
    raca?:     { nome: string } | null;
    dataNascimento?: string | null;
    idadeAnos?:      number | null;
    user?:     { fullName: string; email: string; phone?: string | null } | null;
  };
}

interface Animal {
  id:               number;
  nome:             string;
  sexo:             string;
  peso:             number;
  photoUrl?:        string | null;
  dataNascimento?:  string | null;
  idadeAnos?:       number | null;
  categoriaAnimal?: string | null;
  tipoExercicio?:   string | null;
  raca?:            { nome: string } | null;
  especie?:         { nome: string } | null;
  user?:            { fullName: string; email: string } | null;
}

interface BuscaResultado {
  id:             number;
  nome:           string;
  temVet:         boolean;
  vetDaMinhaEquipe: boolean;
  proprietario:   { id: number; fullName: string; email: string; phone?: string | null } | null;
}

type FiltroCampo = 'animal' | 'proprietario';

const calcularIdade = (dataNascimento: string): string => {
  const p       = dataNascimento.split('T')[0].split('-').map(Number);
  const nasc    = new Date(p[0], p[1] - 1, p[2]);
  const hoje    = new Date();
  let anos      = hoje.getFullYear() - p[0];
  let meses     = hoje.getMonth() - (p[1] - 1);
  if (meses < 0) { anos--; meses += 12; }
  if (hoje.getDate() < p[2]) meses--;
  const dias = Math.floor((hoje.getTime() - nasc.getTime()) / 86400000);
  if (dias < 30)  return `${dias}d`;
  if (anos === 0) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
};

const idadeDisplay = (animal: Animal): string => {
  if (animal.dataNascimento) return calcularIdade(animal.dataNascimento);
  if (animal.idadeAnos)      return `${animal.idadeAnos} ${animal.idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '—';
};

// ─── Card mobile ──────────────────────────────────────────────────────────────
function AnimalCardMobile({ animal, onDashboard, onEditar, onDesvincular }: {
  animal:        Animal;
  onDashboard:   () => void;
  onEditar:      () => void;
  onDesvincular: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        {animal.photoUrl
          ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🐴</div>
        }
      </div>

      <div className="flex-1 min-w-0" onClick={onDashboard}>
        <p className="font-semibold text-gray-900 truncate">{animal.nome}</p>
        <p className="text-xs text-gray-500 truncate">
          {animal.raca?.nome || animal.especie?.nome || '—'}
        </p>
        {animal.user?.fullName && (
          <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
            {idadeDisplay(animal)}
          </span>
          {animal.sexo && (
            <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
              {animal.sexo}
            </span>
          )}
          {animal.categoriaAnimal && (
            <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 truncate max-w-[120px]">
              {animal.categoriaAnimal}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        <button onClick={onDashboard}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Ver detalhes">
          <LayoutDashboard size={15} />
        </button>
        <button onClick={onEditar}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Editar">
          <Pencil size={15} />
        </button>
        <button onClick={onDesvincular}
          className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
          title="Desvincular">
          <Unlink size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── SolicitacaoCard ──────────────────────────────────────────────────────────
function SolicitacaoCard({ sol, onResponder }: {
  sol:         Solicitacao;
  onResponder: (id: number, status: 'ACEITO' | 'RECUSADO') => void;
}) {
  const isDesvinculo = sol.tipo === 'DESVINCULO';
  const isTroca      = sol.tipo === 'TROCA_VET';
  const age = sol.animal.dataNascimento ? calcularIdade(sol.animal.dataNascimento)
    : sol.animal.idadeAnos ? `${sol.animal.idadeAnos} ${sol.animal.idadeAnos === 1 ? 'ano' : 'anos'}`
    : '—';
  const borderClass = isDesvinculo ? 'border-red-200' : isTroca ? 'border-orange-200' : 'border-amber-200';
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${borderClass}`}>
      <div className={`flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-1.5 mb-3 ${
        isDesvinculo ? 'text-red-600 bg-red-50'
        : isTroca    ? 'text-orange-600 bg-orange-50'
        :              'text-amber-600 bg-amber-50'
      }`}>
        {isDesvinculo ? <><XCircle size={12} /> Solicitação de remoção de acesso</>
         : isTroca    ? <><XCircle size={12} /> Solicitação de troca de veterinário</>
         :              <><Clock size={12} /> Nova solicitação de vínculo</>}
      </div>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          {sol.animal.photoUrl
            ? <img src={sol.animal.photoUrl} alt={sol.animal.nome} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-xl">🐾</div>
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{sol.animal.nome}</p>
          <p className="text-xs text-gray-500 truncate">
            {sol.animal.especie?.nome} · {sol.animal.raca?.nome} · {age}
          </p>
          {isTroca && sol.novoVeterinario && (
            <p className="text-xs text-orange-700 mt-0.5">→ Novo vet: Dr(a). {sol.novoVeterinario.fullName}</p>
          )}
          <p className="text-xs text-gray-500 mt-0.5 font-medium">Proprietário: {sol.animal.user?.fullName ?? '—'}</p>
          <p className="text-xs text-gray-400">Tel: {sol.animal.user?.phone || 'Não informado'}</p>
          <p className="text-xs text-gray-400">{sol.animal.user?.email || '—'}</p>
          {sol.mensagem && !isDesvinculo && !isTroca && (
            <p className="text-xs text-gray-600 mt-1 italic">"{sol.mensagem}"</p>
          )}
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        {isDesvinculo ? (
          <>
            <button onClick={() => onResponder(sol.id, 'ACEITO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
              <CheckCircle2 size={14} /> Aceitar remoção
            </button>
            <button onClick={() => onResponder(sol.id, 'RECUSADO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors">
              <XCircle size={14} /> Manter acesso
            </button>
          </>
        ) : isTroca ? (
          <>
            <button onClick={() => onResponder(sol.id, 'ACEITO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-xl transition-colors">
              <CheckCircle2 size={14} /> Aceitar troca
            </button>
            <button onClick={() => onResponder(sol.id, 'RECUSADO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600 text-sm font-semibold rounded-xl transition-colors">
              <XCircle size={14} /> Manter vínculo
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onResponder(sol.id, 'ACEITO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors">
              <CheckCircle2 size={14} /> Aceitar
            </button>
            <button onClick={() => onResponder(sol.id, 'RECUSADO')}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600 text-sm font-semibold rounded-xl transition-colors">
              <XCircle size={14} /> Recusar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const AnimaisVet = () => {
  const { user }                                     = useAuth();
  const { setSelectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const navigate                                     = useNavigate();

  const [animais,        setAnimais]        = useState<Animal[]>([]);
  const [solicitacoes,   setSolicitacoes]   = useState<Solicitacao[]>([]);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [loading,        setLoading]        = useState(true);
  const [animalToUnlink, setAnimalToUnlink] = useState<Animal | null>(null);
  const [unlinking,      setUnlinking]      = useState(false);
  const [showBuscarModal,  setShowBuscarModal]  = useState(false);
  const [buscaAnimal,      setBuscaAnimal]      = useState('');
  const [resultadoBusca,   setResultadoBusca]   = useState<BuscaResultado | null>(null);
  const [buscando,         setBuscando]         = useState(false);
  const [solicitando,      setSolicitando]      = useState(false);

  const loadAnimais = async () => {
    try {
      const [animaisRes, solRes] = await Promise.all([
        api.get('/animais'),
        api.get('/veterinarios/solicitacoes?status=PENDENTE'),
      ]);
      setAnimais(animaisRes.data?.dados ?? animaisRes.data ?? []);
      setSolicitacoes(solRes.data?.dados ?? solRes.data ?? []);
    } catch {
      toast.error('Erro ao carregar pacientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user?.id) loadAnimais(); }, [user?.id]);

  const animaisFiltrados = animais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  const irParaAnimal = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animal/${animal.id}`);
  };

  const irParaEditar = (animal: Animal) => {
    setSelectedAnimal({
      ...animal,
      photoUrl:        animal.photoUrl        ?? undefined,
      dataNascimento:  animal.dataNascimento  ?? undefined,
      idadeAnos:       animal.idadeAnos       ?? undefined,
      categoriaAnimal: animal.categoriaAnimal ?? undefined,
      tipoExercicio:   animal.tipoExercicio   ?? undefined,
      raca:            animal.raca            ?? undefined,
      especie:         animal.especie         ?? undefined,
      user:            animal.user            ?? undefined,
    });
    navigate(`/animais/${animal.id}`);
  };

  const handleResponder = async (id: number, status: 'ACEITO' | 'RECUSADO') => {
    const sol = solicitacoes.find(s => s.id === id);
    try {
      await api.patch(`/veterinarios/solicitacoes/${id}`, { status });
      setSolicitacoes(prev => prev.filter(s => s.id !== id));
      if (status === 'ACEITO') {
        if (sol?.tipo === 'DESVINCULO') {
          toast.success(`Remoção de ${sol.animal.nome} confirmada.`);
        } else if (sol?.tipo === 'TROCA_VET') {
          toast.success(`Troca de veterinário para ${sol.animal.nome} aceita.`);
        } else {
          toast.success(`${sol?.animal.nome ?? 'Animal'} adicionado à sua lista.`);
        }
      } else {
        if (sol?.tipo === 'DESVINCULO') {
          toast(`Você manteve o acesso ao animal ${sol.animal.nome}.`, { icon: '🔒', duration: 8000 });
        } else if (sol?.tipo === 'TROCA_VET') {
          toast(`Você manteve o vínculo com ${sol.animal.nome}. A troca foi recusada.`, { icon: '🔄', duration: 8000 });
        } else {
          toast(`Solicitação de vínculo com ${sol?.animal.nome ?? 'o animal'} recusada.`, { icon: '❌', duration: 8000 });
        }
      }
      loadAnimais();
    } catch {
      toast.error('Erro ao responder solicitação');
    }
  };

  const confirmDesvincular = async () => {
    if (!animalToUnlink) return;
    setUnlinking(true);
    try {
      await api.delete(`/animais/${animalToUnlink.id}/desvincular-vet`);
      setAnimalToUnlink(null);
      await refreshSelectedAnimal();
      loadAnimais();
      toast.success(`Solicitação de desvinculação enviada ao proprietário de ${animalToUnlink.nome}`);
    } catch {
      toast.error('Erro ao desvincular');
    } finally {
      setUnlinking(false);
    }
  };

  const handleResponderModal = async (id: number, status: 'ACEITO' | 'RECUSADO') => {
    const sol = solicitacoes.find(s => s.id === id);
    try {
      await api.patch(`/veterinarios/solicitacoes/${id}`, { status });
      if (status === 'ACEITO') {
        if (sol?.tipo === 'DESVINCULO') {
          toast.success(`Remoção de ${sol.animal.nome} confirmada.`);
        } else if (sol?.tipo === 'TROCA_VET') {
          toast.success(`Troca de veterinário para ${sol.animal.nome} aceita.`);
        } else {
          toast.success(`${sol?.animal.nome ?? 'Animal'} adicionado à sua lista.`);
        }
      } else {
        if (sol?.tipo === 'DESVINCULO') {
          toast(`Você manteve o acesso ao animal ${sol.animal.nome}.`, { icon: '🔒', duration: 8000 });
        } else if (sol?.tipo === 'TROCA_VET') {
          toast(`Você manteve o vínculo com ${sol.animal.nome}. A troca foi recusada.`, { icon: '🔄', duration: 8000 });
        } else {
          toast(`Solicitação de vínculo com ${sol?.animal.nome ?? 'o animal'} recusada.`, { icon: '❌', duration: 8000 });
        }
      }
      loadAnimais();
    } catch {
      toast.error('Erro ao responder solicitação');
    }
  };

  const handleBuscarAnimal = async () => {
    if (!buscaAnimal.trim()) return;
    setBuscando(true);
    setResultadoBusca(null);
    try {
      const res = await api.get(`/animais/buscar-por-nome?nome=${encodeURIComponent(buscaAnimal.trim())}`);
      setResultadoBusca(res.data?.dados ?? null);
    } catch {
      toast.error('Erro ao buscar animal');
    } finally {
      setBuscando(false);
    }
  };

  const handleSolicitarVinculoVet = async () => {
    if (!resultadoBusca) return;
    setSolicitando(true);
    try {
      await api.post('/veterinarios/solicitar-vinculo', { animalId: resultadoBusca.id });
      toast.success('Solicitação enviada! Aguarde a aprovação do proprietário.');
      setShowBuscarModal(false);
      setBuscaAnimal('');
      setResultadoBusca(null);
      loadAnimais();
    } catch (err: any) {
      toast.error(err?.response?.data?.mensagem ?? 'Erro ao solicitar vínculo');
    } finally {
      setSolicitando(false);
    }
  };

  const solicitacoesRecebidas = solicitacoes.filter(
    s => !s.solicitanteId || Number(s.solicitanteId) !== Number(user?.id)
  );
  const solicitacoesEnviadas = solicitacoes.filter(
    s => s.solicitanteId && Number(s.solicitanteId) === Number(user?.id)
  );

  return (
    <>
      {user?.id && (
        <VetNotificationModal
          solicitations={solicitacoesRecebidas as SolicitacaoNotif[]}
          vetId={Number(user.id)}
          onResponder={handleResponderModal}
          onDismiss={() => {}}
        />
      )}
      <PageContainer maxWidth="7xl">
      <div className="space-y-5">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')}
              className="flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium">
              <ArrowLeft size={16} /> Voltar
            </button>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Meus Pacientes</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowBuscarModal(true)}
              className="flex items-center gap-2 bg-white border border-emerald-700 text-emerald-700 hover:bg-emerald-50
                         px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
            >
              <UserPlus size={15} />
              <span className="hidden sm:inline">Buscar Paciente</span>
              <span className="sm:hidden">Buscar</span>
            </button>
            <button
              onClick={() => navigate('/animais')}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white
                         px-4 py-2.5 rounded-2xl font-semibold text-sm transition-colors flex-shrink-0"
            >
              <span className="hidden sm:inline">Novo Paciente</span>
              <span className="sm:hidden">Novo</span>
            </button>
          </div>
        </div>

        {/* ── Busca ──────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          <select
            value={filtroCampo}
            onChange={e => { setFiltroCampo(e.target.value as FiltroCampo); setBusca(''); }}
            className="border border-gray-200 rounded-2xl px-3 py-2.5 text-sm text-gray-700
                       focus:outline-none focus:border-emerald-600 bg-white flex-shrink-0"
          >
            <option value="animal">Por animal</option>
            <option value="proprietario">Por proprietário</option>
          </select>
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder={filtroCampo === 'animal' ? 'Nome do animal...' : 'Nome do proprietário...'}
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                         text-gray-900 focus:outline-none focus:border-emerald-600
                         focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
          </div>
        </div>

        {/* ── Solicitações recebidas (proprietário convida vet) ───────── */}
        {!loading && solicitacoesRecebidas.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Solicitações pendentes ({solicitacoesRecebidas.length})
            </h2>
            {solicitacoesRecebidas.map(sol => (
              <SolicitacaoCard key={sol.id} sol={sol} onResponder={handleResponder} />
            ))}
          </div>
        )}

        {/* ── Solicitações enviadas (vet aguarda aprovação do proprietário) ─ */}
        {!loading && solicitacoesEnviadas.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Aguardando aprovação do proprietário ({solicitacoesEnviadas.length})
            </h2>
            {solicitacoesEnviadas.map(sol => (
              <div key={sol.id} className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4 flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                  {sol.animal.photoUrl
                    ? <img src={sol.animal.photoUrl} alt={sol.animal.nome} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xl">🐾</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{sol.animal.nome}</p>
                  <p className="text-xs text-gray-500 truncate">Proprietário: {sol.animal.user?.fullName ?? '—'}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-medium flex-shrink-0">
                  <Clock size={10} /> Aguardando aprovação
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Conteúdo ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : animaisFiltrados.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-gray-400 text-sm">
              {busca ? `Nenhum resultado para "${busca}"` : 'Nenhum paciente cadastrado'}
            </p>
          </div>
        ) : (
          <>
            {/* MOBILE — cards */}
            <div className="space-y-3 md:hidden">
              {animaisFiltrados.map(animal => (
                <AnimalCardMobile
                  key={animal.id}
                  animal={animal}
                  onDashboard={() => irParaAnimal(animal)}
                  onEditar={() => irParaEditar(animal)}
                  onDesvincular={() => setAnimalToUnlink(animal)}
                />
              ))}
            </div>

            {/* DESKTOP — tabela */}
            <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="grid grid-cols-[44px_1fr_160px_130px_90px_70px_130px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Categoria NRC</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Idade</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Sexo</span>
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Ações</span>
              </div>

              <div className="divide-y divide-gray-50">
                {animaisFiltrados.map(animal => (
                  <div
                    key={animal.id}
                    onClick={() => irParaAnimal(animal)}
                    className="grid grid-cols-[44px_1fr_160px_130px_90px_70px_130px] items-center gap-4
                               px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors group"
                  >
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                      {animal.photoUrl
                        ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-xl">🐴</div>
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                        {animal.nome}
                      </p>
                      {animal.user?.fullName && (
                        <p className="text-xs text-gray-400 truncate">{animal.user.fullName}</p>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      {animal.raca?.nome || animal.especie?.nome || '—'}
                    </p>
                    <p className="text-sm text-gray-600 truncate">
                      {animal.categoriaAnimal || '—'}
                    </p>
                    <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>
                    <p className="text-sm text-gray-600">{animal.sexo || '—'}</p>
                    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => irParaAnimal(animal)}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Ver detalhes">
                        <LayoutDashboard size={15} />
                      </button>
                      <button onClick={() => irParaEditar(animal)}
                        className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Editar">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => setAnimalToUnlink(animal)}
                        className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                        title="Desvincular">
                        <Unlink size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-gray-50 text-center">
                <p className="text-xs text-gray-400">
                  {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>

            {/* Rodapé mobile */}
            <p className="md:hidden text-xs text-gray-400 text-center">
              {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
            </p>
          </>
        )}
      </div>

      {/* Modal — Desvincular */}
      {animalToUnlink && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl text-center">
            <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Unlink size={24} className="text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Solicitar desvinculação?</h2>
            <p className="text-gray-500 text-sm mb-6">
              Uma solicitação será enviada ao proprietário de{' '}
              <strong className="text-gray-700">{animalToUnlink.nome}</strong>.
              O proprietário terá <strong className="text-gray-700">24 horas</strong> para
              aprovar ou recusar. Sem resposta, o desvinculo será confirmado automaticamente.
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

      </PageContainer>

      {/* Modal — Buscar Paciente */}
      {showBuscarModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Buscar Paciente</h2>
              <button onClick={() => { setShowBuscarModal(false); setBuscaAnimal(''); setResultadoBusca(null); }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={18} />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Digite o nome do animal para solicitar acesso. O proprietário receberá um convite por e-mail.
            </p>

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Nome do animal..."
                value={buscaAnimal}
                onChange={e => { setBuscaAnimal(e.target.value); setResultadoBusca(null); }}
                onKeyDown={e => e.key === 'Enter' && handleBuscarAnimal()}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm
                           text-gray-900 focus:outline-none focus:border-emerald-600
                           focus:ring-2 focus:ring-emerald-100 transition-colors"
                autoFocus
              />
              <button
                onClick={handleBuscarAnimal}
                disabled={buscando || !buscaAnimal.trim()}
                className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300
                           text-white rounded-2xl text-sm font-semibold transition-colors flex-shrink-0"
              >
                {buscando ? '...' : <Search size={15} />}
              </button>
            </div>

            {resultadoBusca === null && !buscando && buscaAnimal.trim() && (
              <p className="text-sm text-gray-400 text-center py-4">Nenhum animal encontrado</p>
            )}

            {resultadoBusca && (
              <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50 space-y-3">
                <div>
                  <p className="font-semibold text-gray-900">{resultadoBusca.nome}</p>
                  <p className="text-xs text-gray-500">
                    Proprietário: {resultadoBusca.proprietario?.fullName ?? '—'}
                  </p>
                  {resultadoBusca.proprietario?.email && (
                    <p className="text-xs text-gray-400">{resultadoBusca.proprietario.email}</p>
                  )}
                </div>

                {resultadoBusca.temVet && !resultadoBusca.vetDaMinhaEquipe && (
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    <Clock size={12} />
                    Este animal já possui um veterinário responsável de outra equipe.
                  </div>
                )}

                {resultadoBusca.vetDaMinhaEquipe && (
                  <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    <CheckCircle2 size={12} />
                    Animal atendido por colega de equipe.
                  </div>
                )}

                <button
                  onClick={handleSolicitarVinculoVet}
                  disabled={solicitando}
                  className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300
                             text-white rounded-2xl text-sm font-semibold transition-colors"
                >
                  {solicitando ? 'Enviando...' : 'Solicitar Vínculo'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default AnimaisVet;