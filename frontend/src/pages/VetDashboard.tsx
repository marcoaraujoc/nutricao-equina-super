// src/pages/VetDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  CheckCircle2, XCircle, Clock,
  Unlink, Search, Pencil, LayoutDashboard,
  CalendarCheck, PawPrint, Users, AlertTriangle,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar   from '../components/BotaoVoltar';
import { VetNotificationModal, type SolicitacaoNotif } from '../components/VetNotificationModal';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';


ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  atendimentosHoje:   number;
  pacientesAtivos:    number;
  clientesAtivos:     number;
  estoqueCritico:     number;
  atendimentosPorDia: { dia: string; total: number }[];
  topMedicamentos:    { nome: string; total: number }[];
  topProcedimentos:   { nome: string; total: number }[];
  alertas?: {
    vacinasVencidas:        number;
    produtosVencendo:       number;
    contasReceberVencidas:  number;
  };
  semAtendimento?: {
    total:   number;
    animais: {
      id: number; nome: string; localizacao: string; proprietario: string;
      ultimoAtendimento: string | null; diasSemAtendimento: number | null;
    }[];
  };
}

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
  baia?:            string | null;
  local?:           string | null;
  especie?:         { nome: string } | null;
  raca?:            { nome: string } | null;
  user?:            { fullName: string; email: string; phone?: string | null } | null;
}

interface Solicitacao {
  id:               number;
  tipo:             string; // 'VINCULO' | 'DESVINCULO' | 'TROCA_VET'
  status:           string;
  createdAt:        string;
  solicitanteId?:   number | null;
  mensagem?:        string | null;
  animal:           AnimalResumido;
  novoVeterinario?: { fullName: string } | null;
}

type FiltroCampo = 'animal' | 'proprietario';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Chart helpers ────────────────────────────────────────────────────────────

function fillDays(data: { dia: string; total: number }[]): { dia: string; total: number }[] {
  const map = new Map(data.map(d => [d.dia, d.total]));
  const hoje = new Date();
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() - (29 - i));
    const key = d.toISOString().slice(0, 10);
    return { dia: key, total: map.get(key) ?? 0 };
  });
}

const fmtDia = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

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

// ─── SolicitacaoCard ──────────────────────────────────────────────────────────

function SolicitacaoCard({ sol, onResponder }: {
  sol:         Solicitacao;
  onResponder: (id: number, status: 'ACEITO' | 'RECUSADO') => void;
}) {
  const isDesvinculo = sol.tipo === 'DESVINCULO';
  const isTroca      = sol.tipo === 'TROCA_VET';
  const borderClass  = isDesvinculo ? 'border-red-200' : isTroca ? 'border-orange-200' : 'border-amber-200';
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-4 ${borderClass}`}>
      {(isDesvinculo || isTroca) && (
        <div className={`flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-1.5 mb-3 ${
          isDesvinculo ? 'text-red-600 bg-red-50' : 'text-orange-600 bg-orange-50'
        }`}>
          <XCircle size={12} />
          {isDesvinculo ? 'Solicitação de remoção de acesso' : 'Solicitação de troca de veterinário'}
        </div>
      )}
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

// ─── AnimalCard (mobile) ──────────────────────────────────────────────────────

function AnimalCardMobile({ animal, onDashboard, onEditar, onDesvincular }: {
  animal:         AnimalResumido;
  onDashboard:    () => void;
  onEditar:       () => void;
  onDesvincular?: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
      {/* Foto */}
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        {animal.photoUrl
          ? <img src={animal.photoUrl} alt={animal.nome} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl">🐴</div>
        }
      </div>

      {/* Info */}
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
          {animal.baia && (
            <span className="text-xs bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5 font-medium">
              Baia {animal.baia}
            </span>
          )}
          {animal.local && (
            <span className="text-xs bg-gray-50 text-gray-500 rounded-full px-2 py-0.5 truncate max-w-[120px]">
              {animal.local}
            </span>
          )}
        </div>
      </div>

      {/* Ações */}
      <div className="flex flex-col gap-1 flex-shrink-0">
        <button onClick={onDashboard}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Ver dashboard">
          <LayoutDashboard size={16} />
        </button>
        <button onClick={onEditar}
          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
          title="Editar">
          <Pencil size={16} />
        </button>
        {onDesvincular && (
          <button onClick={onDesvincular}
            className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
            title="Desvincular">
            <Unlink size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function VetDashboard() {
  const { user }                              = useAuth();
  const isConvidado                           = user?.isConvidado === true;
  const isVet                                 = (user?.userType ?? '').toUpperCase() === 'VETERINARIO';
  const { setSelectedAnimal }                 = useSelectedAnimal();
  const navigate                              = useNavigate();
  const { podeExecutar, temEquipe, isGestor, loading: loadingPerm } = usePermissoes();

  const [meusAnimais,    setMeusAnimais]    = useState<AnimalResumido[]>([]);
  const [solicitacoes,   setSolicitacoes]   = useState<Solicitacao[]>([]);
  const [stats,          setStats]          = useState<DashboardStats | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  const [animalToUnlink, setAnimalToUnlink] = useState<AnimalResumido | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO (confirmar/excluir/desvincular): vai para o modal que disparou
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [unlinking,      setUnlinking]      = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const [animaisRes, solRes, statsRes] = await Promise.all([
        api.get('/animais'),
        isVet ? api.get('/veterinarios/solicitacoes?status=PENDENTE') : Promise.resolve({ data: [] }),
        api.get('/dashboard/stats'),
      ]);

      const todasSolicitacoes: Solicitacao[] = solRes.data?.dados ?? [];
      const vetId = user?.id ?? 0;

      const solicitacoesFiltradas = todasSolicitacoes.filter(
        s => s.solicitanteId == null || Number(s.solicitanteId) !== Number(vetId)
      );

      setMeusAnimais(animaisRes.data?.dados ?? []);
      setSolicitacoes(solicitacoesFiltradas);
      if (statsRes.data?.dados) setStats(statsRes.data.dados);
    } catch {
      setErroInline('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, [user?.id]);

  const handleResponder = async (id: number, status: 'ACEITO' | 'RECUSADO') => {
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
      carregar();
    } catch {
      setErroAcao({ mensagem: 'Erro ao responder solicitação' });
    }
  };

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
      setErroAcao({ mensagem: 'Erro ao desvincular' });
    } finally {
      setUnlinking(false);
    }
  };

  const diasData = useMemo(() => fillDays(stats?.atendimentosPorDia ?? []), [stats]);

  const animaisFiltrados = meusAnimais.filter(a => {
    const termo = busca.toLowerCase().trim();
    if (!termo) return true;
    return filtroCampo === 'animal'
      ? a.nome.toLowerCase().includes(termo)
      : (a.user?.fullName ?? '').toLowerCase().includes(termo);
  });

  if (loading || loadingPerm) return (
    <PageContainer>
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (temEquipe && !podeExecutar('dashboard.geral.ler')) return null;

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
      carregar();
    } catch {
      setErroAcao({ mensagem: 'Erro ao responder solicitação' });
    }
  };

  return (
    <>
      {user?.id && (isGestor || !isConvidado) && (
        <VetNotificationModal
          solicitations={solicitacoes as SolicitacaoNotif[]}
          vetId={Number(user.id)}
          onResponder={handleResponderModal}
          onDismiss={() => {}}
        />
      )}
      <PageContainer maxWidth="7xl">
        <InlineError message={erroInline} className="mb-4" />

      <BotaoVoltar className="mb-6" />
      <div className="space-y-5">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              Olá, {isVet ? `Dr(a). ` : ''}{user?.fullName?.split(' ')[0]} 👋
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {meusAnimais.length > 0
                ? `${meusAnimais.length} paciente${meusAnimais.length !== 1 ? 's' : ''} sob sua responsabilidade`
                : 'Nenhum paciente ainda'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {solicitacoes.length > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-2xl px-2.5 py-1.5">
                <Clock size={13} className="text-amber-600" />
                <span className="text-xs font-semibold text-amber-700">
                  {solicitacoes.length} pendente{solicitacoes.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Cards Superiores ────────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Atendimentos Hoje */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <CalendarCheck size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 leading-none">{stats.atendimentosHoje}</p>
                <p className="text-xs text-gray-500 mt-0.5">Atendimentos Hoje</p>
              </div>
            </div>

            {/* Pacientes Ativos */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <PawPrint size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 leading-none">{stats.pacientesAtivos}</p>
                <p className="text-xs text-gray-500 mt-0.5">Pacientes Ativos</p>
              </div>
            </div>

            {/* Clientes Ativos */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                <Users size={20} className="text-violet-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 leading-none">{stats.clientesAtivos}</p>
                <p className="text-xs text-gray-500 mt-0.5">Clientes Ativos</p>
              </div>
            </div>

            {/* Estoque Crítico */}
            <div className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3 ${
              stats.estoqueCritico > 0 ? 'border-red-200' : 'border-gray-100'
            }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                stats.estoqueCritico > 0 ? 'bg-red-50' : 'bg-gray-50'
              }`}>
                <AlertTriangle size={20} className={stats.estoqueCritico > 0 ? 'text-red-500' : 'text-gray-400'} />
              </div>
              <div>
                <p className={`text-2xl font-bold leading-none ${
                  stats.estoqueCritico > 0 ? 'text-red-600' : 'text-gray-900'
                }`}>{stats.estoqueCritico}</p>
                <p className="text-xs text-gray-500 mt-0.5">Estoque Crítico</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Alertas ──────────────────────────────────────────────────────── */}
        {stats?.alertas && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Vacinas vencidas',          valor: String(stats.alertas.vacinasVencidas),  ativo: stats.alertas.vacinasVencidas > 0 },
              { label: 'Produtos vencendo (30 dias)', valor: String(stats.alertas.produtosVencendo), ativo: stats.alertas.produtosVencendo > 0 },
              { label: 'Contas a receber vencidas', valor: stats.alertas.contasReceberVencidas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), ativo: stats.alertas.contasReceberVencidas > 0 },
            ].map(a => (
              <div key={a.label} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3 ${a.ativo ? 'border-red-200' : 'border-gray-100'}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${a.ativo ? 'bg-red-50' : 'bg-gray-50'}`}>
                  <AlertTriangle size={18} className={a.ativo ? 'text-red-500' : 'text-gray-300'} />
                </div>
                <div className="min-w-0">
                  <p className={`text-xl font-bold leading-none ${a.ativo ? 'text-red-600' : 'text-gray-900'}`}>{a.valor}</p>
                  <p className="text-xs text-gray-500 mt-0.5">🔴 {a.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Animais sem atendimento (+3 dias) ───────────────────────────────── */}
        {stats?.semAtendimento && stats.semAtendimento.total > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Clock size={16} className="text-amber-500" />
              <h2 className="text-sm font-semibold text-gray-700">Animais sem atendimento há +3 dias</h2>
              <span className="ml-auto text-xs font-bold bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">{stats.semAtendimento.total}</span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
              {stats.semAtendimento.animais.map(a => (
                <button key={a.id} onClick={() => navigate(`/animal/${a.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left transition-colors">
                  <PawPrint size={14} className="text-gray-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{a.nome}</p>
                    <p className="text-[11px] text-gray-400 truncate">{a.proprietario} · {a.localizacao}</p>
                  </div>
                  <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">
                    {a.diasSemAtendimento === null ? 'nunca atendido' : `${a.diasSemAtendimento}d`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Gráficos ─────────────────────────────────────────────────────── */}
        {stats && (
          <div className="space-y-3">
            {/* Atendimentos por dia — largura total */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Atendimentos por Dia (últimos 30 dias)</h2>
              <div className="h-44">
                <Line
                  data={{
                    labels: diasData.map(d => fmtDia(d.dia)),
                    datasets: [{
                      label: 'Atendimentos',
                      data: diasData.map(d => d.total),
                      borderColor: '#059669',
                      backgroundColor: 'rgba(5,150,105,0.08)',
                      borderWidth: 2,
                      pointRadius: 3,
                      pointBackgroundColor: '#059669',
                      fill: true,
                      tension: 0.4,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { mode: 'index' as const, intersect: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } },
                      y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { color: '#f3f4f6' } },
                    },
                  }}
                />
              </div>
            </div>

            {/* Top 10 Procedimentos + Top 10 Medicamentos lado a lado */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Top 10 Procedimentos */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Top 10 Procedimentos</h2>
                {stats.topProcedimentos.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Nenhum dado disponível</p>
                ) : (
                  <div className="h-52">
                    <Bar
                      data={{
                        labels: stats.topProcedimentos.map(p => p.nome),
                        datasets: [{
                          label: 'Qtd',
                          data: stats.topProcedimentos.map(p => p.total),
                          backgroundColor: 'rgba(139,92,246,0.75)',
                          borderRadius: 4,
                        }],
                      }}
                      options={{
                        indexAxis: 'y' as const,
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { mode: 'index' as const } },
                        scales: {
                          x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        },
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Top 10 Medicamentos */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Top 10 Medicamentos Prescritos</h2>
                {stats.topMedicamentos.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">Nenhum dado disponível</p>
                ) : (
                  <div className="h-52">
                    <Bar
                      data={{
                        labels: stats.topMedicamentos.map(m => m.nome),
                        datasets: [{
                          label: 'Qtd',
                          data: stats.topMedicamentos.map(m => m.total),
                          backgroundColor: 'rgba(5,150,105,0.75)',
                          borderRadius: 4,
                        }],
                      }}
                      options={{
                        indexAxis: 'y' as const,
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false }, tooltip: { mode: 'index' as const } },
                        scales: {
                          x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f3f4f6' } },
                          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        },
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Solicitações pendentes ───────────────────────────────────────── */}
        {solicitacoes.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              Solicitações pendentes
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {solicitacoes.map(s => (
                <SolicitacaoCard key={s.id} sol={s} onResponder={handleResponder} />
              ))}
            </div>
          </div>
        )}

        {/* ── Busca ────────────────────────────────────────────────────────── */}
        {meusAnimais.length > 0 && (
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
        )}

        {/* ── Lista de pacientes ───────────────────────────────────────────── */}
        {meusAnimais.length > 0 ? (
          animaisFiltrados.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">
              Nenhum resultado para "{busca}"
            </p>
          ) : (
            <>
              {/* MOBILE — cards */}
              <div className="space-y-3 md:hidden">
                {animaisFiltrados.map(animal => (
                  <AnimalCardMobile
                    key={animal.id}
                    animal={animal}
                    onDashboard={() => irParaAnimal(animal)}
                    onEditar={() => navigate(`/animais/${animal.id}`)}
                    onDesvincular={isVet ? () => setAnimalToUnlink(animal) : undefined}
                  />
                ))}
              </div>

              {/* DESKTOP — tabela */}
              <div className="hidden md:block bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Cabeçalho */}
                <div className="grid grid-cols-[44px_1fr_150px_80px_80px_70px_120px] items-center gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <span />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Nome / Proprietário</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Raça</span>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Baia</span>
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
                      className="grid grid-cols-[44px_1fr_150px_80px_80px_70px_120px] items-center gap-4
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
                      <p className="text-sm text-gray-600">
                        {animal.baia
                          ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">{animal.baia}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </p>
                      <p className="text-sm text-gray-600">{idadeDisplay(animal)}</p>
                      <p className="text-sm text-gray-600">{animal.sexo ?? '—'}</p>
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => irParaAnimal(animal)}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Ver dashboard">
                          <LayoutDashboard size={15} />
                        </button>
                        <button onClick={() => navigate(`/animais/${animal.id}`)}
                          className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Editar">
                          <Pencil size={15} />
                        </button>
                        {isVet && (
                          <button onClick={() => setAnimalToUnlink(animal)}
                            className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Desvincular">
                            <Unlink size={15} />
                          </button>
                        )}
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

              {/* Rodapé mobile */}
              <p className="md:hidden text-xs text-gray-400 text-center">
                {animaisFiltrados.length} paciente{animaisFiltrados.length !== 1 ? 's' : ''} encontrado{animaisFiltrados.length !== 1 ? 's' : ''}
              </p>
            </>
          )
        ) : solicitacoes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🩺</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Nenhum animal sob sua responsabilidade
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              {isConvidado && !isGestor
                ? 'Aguarde a atribuição de pacientes pelo responsável da equipe.'
                : 'Cadastre um paciente ou aguarde solicitações de vínculo.'}
            </p>
            {(isGestor || !isConvidado) && (
              <button onClick={() => navigate('/animais')}
                className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800
                           text-white px-6 py-3 rounded-2xl font-semibold transition-colors">
                Cadastrar Paciente
              </button>
            )}
          </div>
        ) : null}

      </div>

      {/* ── Modal — Desvincular ──────────────────────────────────────────────── */}
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
      </PageContainer>
    </>
  );
}