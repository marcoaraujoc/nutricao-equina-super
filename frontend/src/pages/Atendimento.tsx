// src/pages/Atendimento.tsx
// Shell clínico — delega cada sub-aba ao seu módulo dedicado

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Check, X, Loader2,
  FileText, Pill, Syringe, FlaskConical, Share2,
  Stethoscope, ReceiptText, Search, CalendarDays,
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

type TipoFatura = 'PROCEDIMENTO' | 'MEDICAMENTO' | 'EXAME' | 'ENCAMINHAMENTO' | 'VACINA';
type SubModulo  = 'agenda' | 'evolucao' | 'prescricao' | 'vacina' | 'exames' | 'encaminhamento';

interface FaturaItem {
  id:          number;
  faturaId:    number;
  tipo:        TipoFatura;
  descricao:   string;
  valor:       number;
  quantidade:  number;
  veterinario: { fullName: string };
  criadoEm:   string;
}

interface Fatura {
  id:       number;
  animalId: number;
  total:    number;
  status:   string;
  itens:    FaturaItem[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUB_MODULOS: { key: SubModulo; label: string; icon: React.ReactNode }[] = [
  { key: 'agenda',         label: 'Minha Agenda',   icon: <CalendarDays size={13} /> },
  { key: 'evolucao',       label: 'Evolução',       icon: <FileText     size={13} /> },
  { key: 'prescricao',     label: 'Prescrição',     icon: <Pill         size={13} /> },
  { key: 'vacina',         label: 'Vacina',         icon: <Syringe      size={13} /> },
  { key: 'exames',         label: 'Exames',         icon: <FlaskConical size={13} /> },
  { key: 'encaminhamento', label: 'Encaminhamento', icon: <Share2       size={13} /> },
];

const TIPO_COLORS: Record<TipoFatura, string> = {
  PROCEDIMENTO:   'bg-emerald-100 text-emerald-700',
  MEDICAMENTO:    'bg-blue-100 text-blue-700',
  EXAME:          'bg-purple-100 text-purple-700',
  ENCAMINHAMENTO: 'bg-orange-100 text-orange-700',
  VACINA:         'bg-teal-100 text-teal-700',
};

const TIPO_ICONS: Record<TipoFatura, React.ReactNode> = {
  PROCEDIMENTO:   <Stethoscope  size={11} />,
  MEDICAMENTO:    <Pill         size={11} />,
  EXAME:          <FlaskConical size={11} />,
  ENCAMINHAMENTO: <Share2       size={11} />,
  VACINA:         <Syringe      size={11} />,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const getIniciais = (nome: string): string => {
  const p = nome.trim().split(' ').filter(Boolean);
  return p.length === 1
    ? p[0].substring(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
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
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-xl whitespace-nowrap transition-colors flex-shrink-0 ${
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

// ─── FaturaPanel ─────────────────────────────────────────────────────────────

function FaturaPanel({ fatura, onRemover, onAtualizarValor, loading }: {
  fatura:           Fatura | null;
  onRemover:        (id: number) => void;
  onAtualizarValor: (id: number, valor: number) => Promise<void>;
  loading:          boolean;
}) {
  const itens = fatura?.itens ?? [];

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValor, setEditValor] = useState('');
  const [savingVal, setSavingVal] = useState(false);

  const iniciarEdicao = (item: FaturaItem) => {
    setEditingId(item.id);
    setEditValor(item.valor > 0 ? String(item.valor) : '');
  };

  const salvarValor = async (itemId: number) => {
    const v = parseFloat(editValor.replace(',', '.'));
    if (isNaN(v) || v < 0) { toast.error('Valor inválido'); return; }
    setSavingVal(true);
    try {
      await onAtualizarValor(itemId, v);
      setEditingId(null);
    } catch { toast.error('Erro ao atualizar valor'); }
    finally { setSavingVal(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <ReceiptText size={15} className="text-emerald-600" />
        <span className="font-semibold text-sm text-gray-900">Fatura</span>
        {fatura && (
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
            fatura.status === 'ABERTA' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
          }`}>{fatura.status}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={20} className="animate-spin text-emerald-600" />
          </div>
        ) : itens.length === 0 ? (
          <p className="text-center text-gray-300 text-xs py-10">Nenhum item na fatura</p>
        ) : (
          <div className="space-y-px px-3">
            {itens.map(item => (
              <div key={item.id} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 mt-0.5 ${TIPO_COLORS[item.tipo]}`}>
                  {TIPO_ICONS[item.tipo]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-800 leading-snug line-clamp-2">{item.descricao}</p>

                  {editingId === item.id ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-gray-400">R$</span>
                      <input
                        autoFocus type="number" min="0" step="0.01"
                        value={editValor}
                        onChange={e => setEditValor(e.target.value)}
                        placeholder="0,00"
                        className="w-24 border border-emerald-300 rounded-lg px-2 py-0.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-500" />
                      <button onClick={() => salvarValor(item.id)} disabled={savingVal}
                        className="p-0.5 text-emerald-600 hover:text-emerald-800">
                        {savingVal ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-0.5 text-gray-400 hover:text-gray-600">
                        <X size={11} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs font-bold ${item.valor > 0 ? 'text-emerald-700' : 'text-gray-300'}`}>
                        {item.valor > 0 ? formatCurrency(item.valor * item.quantidade) : '—'}
                      </span>
                      {item.quantidade > 1 && item.valor > 0 && (
                        <span className="text-xs text-gray-400">×{item.quantidade}</span>
                      )}
                      <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1 rounded">
                        {getIniciais(item.veterinario.fullName)}
                      </span>
                    </div>
                  )}
                </div>

                {editingId !== item.id && (
                  <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                    <button onClick={() => iniciarEdicao(item)} title="Editar valor"
                      className="p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => onRemover(item.id)} title="Remover item"
                      className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Total</span>
          <span className="text-base font-bold text-gray-900">{formatCurrency(fatura?.total ?? 0)}</span>
        </div>
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

  const [animal,        setAnimal]        = useState<AnimalExtended | null>(null);
  const [todosAnimais,  setTodosAnimais]  = useState<AnimalExtended[]>([]);
  const [fatura,        setFatura]        = useState<Fatura | null>(null);
  const [loadingFatura, setLoadingFatura] = useState(true);
  const [activeTab,     setActiveTab]     = useState<SubModulo>(() => tabFromPath(location.pathname));
  const [showFaturaM,   setShowFaturaM]   = useState(false);

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

  const carregarFatura = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setLoadingFatura(true);
    try {
      const res = await api.get(`/clinica/faturas/animal/${effectiveAnimalId}`);
      setFatura(res.data.dados);
    } catch { /* silencioso */ }
    finally { setLoadingFatura(false); }
  }, [effectiveAnimalId]);

  useEffect(() => {
    carregarAnimal();
    carregarFatura();
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

  const handleRemoverItemFatura = async (itemId: number) => {
    try {
      await api.delete(`/clinica/faturas/itens/${itemId}`);
      carregarFatura();
    } catch { toast.error('Erro ao remover item'); }
  };

  const handleAtualizarValorFatura = async (itemId: number, valor: number) => {
    await api.put(`/clinica/faturas/itens/${itemId}`, { valor });
    carregarFatura();
  };

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
            faturaId={fatura?.id ?? null}
            onFaturaAtualizada={carregarFatura}
          />
        );
      case 'prescricao':
        return (
          <SubModuloPrescricao
            animalId={animalIdNum}
            animal={animal ? { ...animal, photoUrl: animal.photoUrl ?? null } : null}
            onFaturaAtualizada={carregarFatura}
          />
        );
      case 'vacina':         return <SubModuloVacina animalId={animalIdNum} animal={animal} />;
      case 'exames':         return <SubModuloExames animalId={animalIdNum} animal={animal} />;
      case 'encaminhamento': return <SubModuloEncaminhamento animalId={animalIdNum} />;
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

      {/* ── Desktop ── */}
      <div className="hidden md:block mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
              navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
            }} />
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-b-2xl rounded-tr-2xl border border-gray-100 shadow-sm min-h-96 overflow-hidden">
              {renderSubModulo()}
            </div>
          </div>
          {activeTab !== 'evolucao' && activeTab !== 'agenda' && (
            <div className="w-72 flex-shrink-0 sticky top-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col"
                style={{ maxHeight: 'calc(100vh - 240px)', height: 'calc(100vh - 240px)' }}>
                <FaturaPanel
                  fatura={fatura}
                  onRemover={handleRemoverItemFatura}
                  onAtualizarValor={handleAtualizarValorFatura}
                  loading={loadingFatura}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
                navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
              }} />
        <div className="bg-white rounded-b-2xl border border-gray-100 shadow-sm overflow-hidden">
          {renderSubModulo()}
        </div>
        {activeTab !== 'evolucao' && activeTab !== 'agenda' && (
          <>
            <button onClick={() => setShowFaturaM(true)}
              className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-lg font-semibold text-sm z-40">
              <ReceiptText size={16} />
              {formatCurrency(fatura?.total ?? 0)}
            </button>
            {showFaturaM && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowFaturaM(false)}>
                <div className="bg-white rounded-t-2xl w-full max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                    <span className="font-bold text-gray-900 text-sm">Fatura</span>
                    <button onClick={() => setShowFaturaM(false)} className="p-1 text-gray-400"><X size={18} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <FaturaPanel
                      fatura={fatura}
                      onRemover={handleRemoverItemFatura}
                      onAtualizarValor={handleAtualizarValorFatura}
                      loading={loadingFatura}
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