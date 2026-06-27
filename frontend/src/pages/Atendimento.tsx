// src/pages/Atendimento.tsx
// Shell clínico — delega cada sub-aba ao seu módulo dedicado

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import {
  X, Loader2,
  FileText, Pill, Syringe, FlaskConical, Share2,
  History, Search, CalendarDays, CircleDot,
} from 'lucide-react';
import AnimalCard  from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import PageContainer from '../components/PageContainer';
import SubModuloEvolucao from './SubModuloEvolucao';
import SubModuloPrescricao from './SubModuloPrescricao';
import SubModuloVacina from './SubModuloVacina';
import SubModuloExames from './SubModuloExames';
import SubModuloEncaminhamento from './SubModuloEncaminhamento';
import SubModuloMinhaAgenda from './SubModuloMinhaAgenda';

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectedAnimal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;

type AnimalExtended = SelectedAnimal & {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
  baia?:           string | null;
  raca?:           { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
};

interface EvolucaoAtiva {
  id:               number;
  numero:           number | null;
  tipoAtendimento:  string | null;
  atendimentoNumero: string | null;
}

type SubModulo  = 'agenda' | 'evolucao' | 'prescricao' | 'vacina' | 'exames' | 'encaminhamento';

interface ResumoHistoricoItem {
  id:          string;
  origem:      string;
  data:        string;
  titulo:      string;
  badge:       string;
  responsavel: string | null;
  resumo:      string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUB_MODULOS: { key: SubModulo; label: string; icon: React.ReactNode }[] = [
  { key: 'agenda',         label: 'Agenda',          icon: <CalendarDays size={15} /> },
  { key: 'evolucao',       label: 'Evolução',       icon: <FileText     size={15} /> },
  { key: 'prescricao',     label: 'Prescrição',     icon: <Pill         size={15} /> },
  { key: 'vacina',         label: 'Vacina',         icon: <Syringe      size={15} /> },
  { key: 'exames',         label: 'Exames',         icon: <FlaskConical size={15} /> },
  { key: 'encaminhamento', label: 'Encaminhamento', icon: <Share2       size={15} /> },
];

const ORIGEM_COLOR: Record<string, string> = {
  EVOLUCAO:        'bg-emerald-100 text-emerald-700',
  VACINA:          'bg-teal-100 text-teal-700',
  EXAME:           'bg-purple-100 text-purple-700',
  EXAME_LAB:       'bg-blue-100 text-blue-700',
  EXAME_IMG:       'bg-sky-100 text-sky-700',
  EXAME_BIO:       'bg-violet-100 text-violet-700',
  EXAME_COMPRA:    'bg-amber-100 text-amber-700',
  PRESCRICAO:      'bg-blue-100 text-blue-700',
  ENCAMINHAMENTO:  'bg-orange-100 text-orange-700',
};

// ─── SubMenuClinico ───────────────────────────────────────────────────────────

function SubMenuClinico({ activeTab, onChange }: {
  activeTab: SubModulo;
  onChange:  (t: SubModulo) => void;
}) {
  return (
    <div className="flex overflow-x-auto gap-1 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
      {SUB_MODULOS.map(m => (
        <button key={m.key} onClick={() => onChange(m.key)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium rounded-t-xl whitespace-nowrap transition-colors flex-shrink-0 ${
            activeTab === m.key
              ? 'bg-white text-emerald-700 border border-gray-100 border-b-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
          }`}>
          {m.icon}{m.label}
        </button>
      ))}
    </div>
  );
}

// ─── HistoricoResumidoPanel ───────────────────────────────────────────────────

const ORIGEM_TO_TAB: Record<string, SubModulo> = {
  EVOLUCAO:       'evolucao',
  VACINA:         'vacina',
  EXAME:          'exames',
  EXAME_LAB:      'exames',
  EXAME_IMG:      'exames',
  EXAME_BIO:      'exames',
  EXAME_COMPRA:   'exames',
  PRESCRICAO:     'prescricao',
  ENCAMINHAMENTO: 'encaminhamento',
};

function HistoricoResumidoPanel({
  animalId,
  refreshKey,
  onItemClick,
}: {
  animalId:    number;
  refreshKey:  number;
  onItemClick: (tab: SubModulo, itemId: number) => void;
}) {
  const [itens,      setItens]      = useState<ResumoHistoricoItem[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!animalId) return;
    setCarregando(true);
    api.get(`/clinica/historico/animal/${animalId}`, { params: { limit: 30 } })
      .then(res => { if (res.data) setItens(res.data.dados ?? []); })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, [animalId, refreshKey]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <History size={15} className="text-emerald-600" />
        <span className="font-semibold text-sm text-gray-900">Histórico do Paciente</span>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {carregando ? (
          <div className="flex justify-center py-10">
            <Loader2 size={20} className="animate-spin text-emerald-600" />
          </div>
        ) : itens.length === 0 ? (
          <p className="text-center text-gray-300 text-xs py-10">Nenhum registro encontrado</p>
        ) : (
          <div className="px-3 space-y-0">
            {itens.map(item => {
              const tab = ORIGEM_TO_TAB[item.origem];
              const data = new Date(item.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
              return (
                <button
                  key={item.id}
                  onClick={() => { if (tab) onItemClick(tab, parseInt(item.id.split('-')[1])); }}
                  className="w-full flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-0 text-left hover:bg-emerald-50/50 rounded-lg px-1 transition-colors group"
                >
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${ORIGEM_COLOR[item.origem] ?? 'bg-gray-100 text-gray-600'}`}>
                    {data}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-emerald-700 transition-colors">{item.titulo}</p>
                    {item.resumo && (
                      <p className="text-[11px] text-gray-400 truncate mt-0.5">{item.resumo}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SeletorAnimalInteligente ─────────────────────────────────────────────────

function SeletorAnimalInteligente({ animais, animalAtual, onSelecionar }: {
  animais:      AnimalExtended[];
  animalAtual:  AnimalExtended | null;
  onSelecionar: (a: AnimalExtended) => void;
}) {
  const [filtroDono,     setFiltroDono]     = useState('');
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownAberto(false); setFiltroDono('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (animais.length <= 1) return null;

  const nomesCount = animais.reduce<Record<string, number>>((acc, a) => {
    acc[a.nome] = (acc[a.nome] ?? 0) + 1; return acc;
  }, {});

  const animalTemDuplicata  = animalAtual ? (nomesCount[animalAtual.nome] ?? 0) > 1 : false;
  const duplicatas          = animalAtual ? animais.filter(a => a.nome === animalAtual.nome) : [];
  const duplicatasFiltradas = filtroDono.trim()
    ? duplicatas.filter(a => (a.user?.fullName ?? '').toLowerCase().includes(filtroDono.toLowerCase()))
    : duplicatas;

  return (
    <div className="space-y-2 mb-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
        <select value={animalAtual?.id ?? ''}
          onChange={e => {
            const sel = animais.find(a => a.id === Number(e.target.value));
            if (sel) { onSelecionar(sel); setFiltroDono(''); }
          }}
          className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm">
          {animais.map(a => (
            <option key={a.id} value={a.id}>
              {a.nome}{(nomesCount[a.nome] ?? 0) > 1 ? ` — ${a.user?.fullName ?? '?'}` : ''}
            </option>
          ))}
        </select>
      </div>
      {animalTemDuplicata && (
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs font-medium text-amber-700 mb-1">
            ⚠️ {duplicatas.length} animais com o nome "{animalAtual?.nome}" — filtre pelo proprietário:
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={filtroDono}
              onChange={e => { setFiltroDono(e.target.value); setDropdownAberto(true); }}
              onFocus={() => setDropdownAberto(true)}
              placeholder="Nome do proprietário..."
              className="w-full pl-9 pr-4 py-2.5 border border-amber-300 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-amber-50" />
          </div>
          {dropdownAberto && duplicatasFiltradas.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-56 overflow-y-auto">
              {duplicatasFiltradas.map(a => (
                <button key={a.id}
                  onClick={() => { onSelecionar(a); setFiltroDono(''); setDropdownAberto(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    a.id === animalAtual?.id ? 'bg-emerald-50' : ''
                  }`}>
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {a.photoUrl
                      ? <img src={a.photoUrl as string} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">🐾</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{a.nome}</p>
                    <p className="text-xs text-gray-400 truncate">Proprietário: {a.user?.fullName ?? '—'}</p>
                  </div>
                  {a.id === animalAtual?.id && <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tabFromPath(pathname: string): SubModulo {
  if (pathname.includes('/agenda'))         return 'agenda';
  if (pathname.includes('/prescricao'))     return 'prescricao';
  if (pathname.includes('/vacina'))         return 'vacina';
  if (pathname.includes('/exames'))         return 'exames';
  if (pathname.includes('/encaminhamento')) return 'encaminhamento';
  return 'evolucao';
}

// ─── Atendimento ──────────────────────────────────────────────────────────────

const Atendimento = () => {
  const { setSelectedAnimal, selectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();
  const location                              = useLocation();
  const { animalId: animalIdParam }           = useParams<{ animalId?: string }>();

  const effectiveAnimalId = animalIdParam || selectedAnimal?.id?.toString();

  // Persiste o agendamentoId entre navegações e re-logins (localStorage por animal)
  const [agendamentoIdFromUrl] = useState<number | undefined>(() => {
    const fromUrl = new URLSearchParams(location.search).get('agendamentoId');
    if (fromUrl && animalIdParam) {
      localStorage.setItem(`s2vet_ag_${animalIdParam}`, fromUrl);
      return Number(fromUrl);
    }
    if (animalIdParam) {
      const stored = localStorage.getItem(`s2vet_ag_${animalIdParam}`);
      if (stored) return Number(stored);
    }
    return undefined;
  });

  const [animal,          setAnimal]          = useState<AnimalExtended | null>(null);
  const [todosAnimais,    setTodosAnimais]    = useState<AnimalExtended[]>([]);
  const [activeTab,       setActiveTab]       = useState<SubModulo>(() => tabFromPath(location.pathname));
  const [showHistoricoM,  setShowHistoricoM]  = useState(false);
  const [evolucaoAtiva,   setEvolucaoAtiva]   = useState<EvolucaoAtiva | null>(null);
  const [historicoKey,    setHistoricoKey]    = useState(0);
  const [openItemId,      setOpenItemId]      = useState<number | null>(null);

  const refreshHistorico = () => setHistoricoKey(k => k + 1);

  // Sincroniza aba quando o usuário navega pelo Sidebar
  useEffect(() => {
    setActiveTab(tabFromPath(location.pathname));
  }, [location.pathname]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      const a   = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
    } catch (err) { console.error('Erro ao carregar animal:', err); }
  }, [effectiveAnimalId]);

  const carregarEvolucaoAtiva = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?status=EM_ANDAMENTO&limit=1&page=1`);
      const dados = res.data?.dados ?? [];
      if (dados.length > 0) {
        const ev = dados[0];
        setEvolucaoAtiva({
          id:               ev.id,
          numero:           ev.numero ?? null,
          tipoAtendimento:  ev.tipoAtendimento ?? null,
          atendimentoNumero: ev.atendimentoNumero ?? null,
        });
      } else {
        setEvolucaoAtiva(null);
      }
    } catch { /* silencioso */ }
  }, [effectiveAnimalId]);

  useEffect(() => {
    setEvolucaoAtiva(null);
    carregarAnimal();
    carregarEvolucaoAtiva();
    api.get('/animais').then(res => setTodosAnimais(res.data?.dados ?? [])).catch(() => {});
  }, [effectiveAnimalId]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelecionarAnimal = (a: AnimalExtended) => {
    setSelectedAnimal(a);
    navigate(`/clinica/evolucao/${a.id}`);
  };

  const handleSelecionarAnimalFromAgenda = useCallback(async (animalId: number) => {
    try {
      const res = await api.get(`/animais/${animalId}`);
      if (!res.data) return;
      const a = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
      setTodosAnimais(prev => prev.some(x => x.id === a.id) ? prev : [...prev, a]);
    } catch { /* silencioso */ }
  }, []);

  // ── Guard ─────────────────────────────────────────────────────────────────
  // A aba "Minha Agenda" funciona sem animal selecionado

  if (!effectiveAnimalId && activeTab !== 'agenda') {
    return (
      <PageContainer>
        <BotaoVoltar className="mb-4" />
        <div className="text-center py-20">
          <p className="text-gray-500 text-sm">Você ainda não possui animais sob sua responsabilidade.</p>
          <p className="text-gray-400 text-xs mt-1">Solicite o vínculo com um animal para começar.</p>
        </div>
      </PageContainer>
    );
  }

  const animalIdNum = effectiveAnimalId ? Number(effectiveAnimalId) : 0;

  const renderSubModulo = () => {
    switch (activeTab) {
      case 'agenda':
        return (
          <SubModuloMinhaAgenda
            onSelecionarAnimal={handleSelecionarAnimalFromAgenda}
          />
        );
      case 'evolucao':
        return (
          <SubModuloEvolucao
            animalId={animalIdNum}
            animal={animal}
            faturaId={null}
            onFaturaAtualizada={() => {}}
            onEvolucaoChange={setEvolucaoAtiva}
            onSalvo={refreshHistorico}
            openItemId={openItemId}
            agendamentoId={agendamentoIdFromUrl}
          />
        );
      case 'prescricao':
        return (
          <SubModuloPrescricao
            animalId={animalIdNum}
            animal={animal ? { ...animal, photoUrl: animal.photoUrl ?? null } : null}
            onFaturaAtualizada={() => {}}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId}
          />
        );
      case 'vacina':
        return (
          <SubModuloVacina
            animalId={animalIdNum}
            animal={animal}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId}
          />
        );
      case 'exames':
        return (
          <SubModuloExames
            animalId={animalIdNum}
            animal={animal}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId}
          />
        );
      case 'encaminhamento':
        return (
          <SubModuloEncaminhamento
            animalId={animalIdNum}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
          />
        );
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>

      <BotaoVoltar className="mb-4" />

      <SeletorAnimalInteligente
        animais={todosAnimais}
        animalAtual={animal}
        onSelecionar={handleSelecionarAnimal}
      />

      {animal && <AnimalCard animal={animal} />}

      {evolucaoAtiva && (
        <div className="flex items-center gap-2 mt-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium">
          <CircleDot size={15} className="text-emerald-500 flex-shrink-0 animate-pulse" />
          Atendimento <span className="font-bold">{evolucaoAtiva.atendimentoNumero}</span> em andamento
        </div>
      )}

      {/* ── Desktop ── */}
      <div className="hidden md:block mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
              setOpenItemId(null);
              navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
            }} />
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-b-2xl rounded-tr-2xl border border-gray-100 shadow-sm min-h-96 overflow-hidden">
              {renderSubModulo()}
            </div>
          </div>
          {activeTab !== 'agenda' && animalIdNum > 0 && (
            <div className="w-72 flex-shrink-0 sticky top-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col"
                style={{ maxHeight: 'calc(100vh - 240px)', height: 'calc(100vh - 240px)' }}>
                <HistoricoResumidoPanel
                  animalId={animalIdNum}
                  refreshKey={historicoKey}
                  onItemClick={(tab, itemId) => {
                    setOpenItemId(itemId);
                    setActiveTab(tab);
                    navigate(effectiveAnimalId ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
                setOpenItemId(null);
                navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
              }} />
        <div className="bg-white rounded-b-2xl border border-gray-100 shadow-sm overflow-hidden">
          {renderSubModulo()}
        </div>
        {activeTab !== 'agenda' && animalIdNum > 0 && (
          <>
            <button onClick={() => setShowHistoricoM(true)}
              className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-lg font-semibold text-sm z-40">
              <History size={15} />
              Histórico
            </button>
            {showHistoricoM && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowHistoricoM(false)}>
                <div className="bg-white rounded-t-2xl w-full max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                    <span className="font-bold text-gray-900 text-sm">Histórico do Paciente</span>
                    <button onClick={() => setShowHistoricoM(false)} className="p-1 text-gray-400"><X size={18} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <HistoricoResumidoPanel
                      animalId={animalIdNum}
                      refreshKey={historicoKey}
                      onItemClick={(tab, itemId) => {
                        setOpenItemId(itemId);
                        setShowHistoricoM(false);
                        setActiveTab(tab);
                        navigate(effectiveAnimalId ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

    </PageContainer>
  );
};

export default Atendimento;