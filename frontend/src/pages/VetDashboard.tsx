// src/pages/VetDashboard.tsx
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import {
  Clock,
  Unlink, Search, Pencil, LayoutDashboard,
  CalendarCheck, PawPrint, Users, AlertTriangle,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import { diaISO } from '../utils/dateUtils';
import BotaoVoltar   from '../components/BotaoVoltar';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import InlineError from '../components/InlineError';
import FotoAnimal from '../components/FotoAnimal';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';


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
    // `diaISO` e não `toISOString().slice(0,10)`: este último dá o dia em UTC e,
    // à noite, desloca TODAS as 30 chaves em um dia — o gráfico deixava de casar
    // com o agrupamento por dia que vem do backend. Ver utils/dateUtils.ts.
    const key = diaISO(d)!;
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

// ⚠️ SEÇÃO DE SOLICITAÇÕES REMOVIDA na fase 3 do multi-tenancy
// (docs/MULTI-TENANCY-PLANO.md §6): acabaram os vínculos e aprovações entre
// veterinário, proprietário e empresa. O paciente aparece por pertencer à EMPRESA
// do contexto ativo — não há convite a aceitar nem desvínculo a pedir.


// ─── AnimalCard (mobile) ──────────────────────────────────────────────────────

// ─── Ações do paciente — UMA declaração p/ a lista E p/ o card ────────────────
// `AcaoRegistro` decide a forma por CSS: ícone no desktop, botão com rótulo no
// mobile. ⚠️ Os três eram CINZA (`text-gray-400`), que a §6 reserva ao
// indisponível — agora nascem pintados.
function AcoesAnimalVetDashboard({ onDashboard, onEditar, onDesvincular }: {
  onDashboard:    () => void;
  onEditar:       () => void;
  onDesvincular?: () => void;
}) {
  return (
    <AcoesRegistro>
      <AcaoRegistro tom="ver" icone={LayoutDashboard} rotulo="Dashboard"
        titulo="Ver dashboard" onClick={onDashboard} />
      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar" onClick={onEditar} />
      <AcaoRegistro tom="aprovar" icone={Unlink} rotulo="Desvincular"
        visivel={!!onDesvincular} onClick={() => onDesvincular?.()} />
    </AcoesRegistro>
  );
}

function AnimalCardMobile({ animal, onDashboard, onEditar, onDesvincular }: {
  animal:         AnimalResumido;
  onDashboard:    () => void;
  onEditar:       () => void;
  onDesvincular?: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center gap-3">
      {/* Foto */}
      <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
        <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id} />
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

      </div>

      {/* Ações no RODAPÉ do card — na lateral elas espremiam o nome do paciente
          assim que ganharam rótulo no mobile. */}
      <div className="mt-3 pt-3 border-t border-gray-50">
        <AcoesAnimalVetDashboard
          onDashboard={onDashboard} onEditar={onEditar} onDesvincular={onDesvincular}
        />
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
  const [stats,          setStats]          = useState<DashboardStats | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [busca,          setBusca]          = useState('');
  const [filtroCampo,    setFiltroCampo]    = useState<FiltroCampo>('animal');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro de AÇÃO (confirmar/excluir/desvincular): vai para o modal que disparou

  const carregar = async () => {
    setLoading(true);
    try {
      const [animaisRes, statsRes] = await Promise.all([
        api.get('/animais'),
        api.get('/dashboard/stats'),
      ]);

      setMeusAnimais(animaisRes.data?.dados ?? []);
      if (statsRes.data?.dados) setStats(statsRes.data.dados);
    } catch {
      setErroInline('Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, [user?.id]);

  const irParaAnimal = (animal: AnimalResumido) => {
    setSelectedAnimal(nullToUndefined(animal));
    navigate(`/animal/${animal.id}`);
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

  return (
    <>
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
                        <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id} />
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
                      <div onClick={e => e.stopPropagation()}>
                        <AcoesAnimalVetDashboard
                          onDashboard={() => irParaAnimal(animal)}
                          onEditar={() => navigate(`/animais/${animal.id}`)}
                        />
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
        ) : (
          <div className="text-center py-16">
            <p className="text-4xl mb-4">🩺</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Nenhum animal sob sua responsabilidade
            </h2>
            <p className="text-gray-500 text-sm mb-6">
              {isConvidado && !isGestor
                ? 'Aguarde a atribuição de pacientes pelo responsável da equipe.'
                : 'Cadastre um paciente para começar.'}
            </p>
            {(isGestor || !isConvidado) && (
              <button onClick={() => navigate('/animais')}
                className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800
                           text-white px-6 py-3 rounded-2xl font-semibold transition-colors">
                Cadastrar Paciente
              </button>
            )}
          </div>
        )}

      </div>

      </PageContainer>
    </>
  );
}