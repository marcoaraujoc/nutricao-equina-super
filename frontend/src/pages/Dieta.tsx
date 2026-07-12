// src/pages/Dieta.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { usePermissoes } from '../hooks/usePermissoes';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Pencil, Trash2, Check, X,
  Search, ToggleLeft, ToggleRight, AlertTriangle,
} from 'lucide-react';
import AnimalCard from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import SeletorAnimal from '../components/SeletorAnimal';
import PageContainer from '../components/PageContainer';
import ModalJustificativa from '../components/ModalJustificativa';
import DietaAcoesBar from '../components/DietaAcoesBar';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Animal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;
type AnimalExtended = Animal & {
  dataNascimento?: string | Date | null;
  idadeAnos?: number | null;
  raca?: { nome: string } | null;
  user?: { fullName: string; email: string; phone?: string | null } | null;
  logoUrl?: string | null;
};

interface PlanoDieta {
  id: number;
  animalId: number;
  nome: string;
  ativo: boolean;
  dataCriacao: string;
  _count?: { itens: number };
}

interface Alimento {
  id: number;
  nome: string;
  unidade?: string | null;
}

interface DietaItem {
  id: number;
  alimentoId: number;
  planoDietaId?: number | null;
  alimento?: { nome: string } | null;
  periodicidade: string;
  qtdGramasDia: number;
  unidade: string;
  horario?: string | null;
}

interface EditItemValues {
  alimentoId: string;
  qtdGramasDia: string;
  unidade: string;
  horario: string;
  periodicidade: string;
}

type FiltroAtivo = 'todos' | 'ativos' | 'inativos';

// ─── Constantes ───────────────────────────────────────────────────────────────

const OPCOES_HORARIO       = ['Manhã', 'Meio-dia', 'Tarde', 'Noite'];
const OPCOES_DIA_SEMANA    = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
const OPCOES_DIA_MES       = ['Dia 1', 'Dia 7', 'Dia 15', 'Dia 22', 'Último dia'];
const OPCOES_UNIDADE       = ['kg', 'g', 'L', 'mL', 'unidade', 'porção'];
const OPCOES_PERIODICIDADE = [
  '1x ao dia', '2x ao dia', '3x ao dia',
  '1x por semana', '2x por semana', '3x por semana',
  '1x por mês', '2x por mês',
];

const DEFAULT_HORARIOS    = ['Manhã', 'Tarde', 'Noite'];
const DEFAULT_DIAS_SEMANA = ['Segunda', 'Quarta', 'Sexta'];
const DEFAULT_DIAS_MES    = ['Dia 1', 'Dia 15', 'Último dia'];

const SLOT_EMOJI: Record<string, string> = {
  'Manhã': '🌅', 'Meio-dia': '☀️', 'Tarde': '🌤️', 'Noite': '🌙',
  'Segunda': '📅', 'Terça': '📅', 'Quarta': '📅', 'Quinta': '📅',
  'Sexta': '📅', 'Sábado': '📅', 'Domingo': '📅',
  'Dia 1': '📆', 'Dia 7': '📆', 'Dia 15': '📆', 'Dia 22': '📆', 'Último dia': '📆',
};

const SLOT_BG: Record<string, string> = {
  'Manhã': 'bg-amber-50', 'Meio-dia': 'bg-yellow-50',
  'Tarde': 'bg-orange-50', 'Noite': 'bg-slate-100',
};

const calcTotal = (items: DietaItem[]): string => {
  let kg = 0, ml = 0;
  const others: Record<string, number> = {};
  items.forEach(i => {
    if (i.unidade === 'kg')      kg  += i.qtdGramasDia;
    else if (i.unidade === 'g')  kg  += i.qtdGramasDia / 1000;
    else if (i.unidade === 'L')  ml  += i.qtdGramasDia * 1000;
    else if (i.unidade === 'mL') ml  += i.qtdGramasDia;
    else others[i.unidade] = (others[i.unidade] ?? 0) + i.qtdGramasDia;
  });
  const fmt = (v: number) => v % 1 === 0 ? String(v) : parseFloat(v.toFixed(2)).toString();
  const parts: string[] = [];
  if (kg > 0) parts.push(`${fmt(kg)} kg`);
  if (ml > 0) parts.push(ml >= 1000 && ml % 1000 === 0 ? `${ml / 1000} L` : `${ml} mL`);
  Object.entries(others).forEach(([u, v]) => parts.push(`${fmt(v)} ${u}`));
  return parts.join(' + ') || '—';
};

// ─── Helper de tipo de periodicidade ─────────────────────────────────────────

const getTipo = (p: string): 'diario' | 'semanal' | 'mensal' =>
  p.includes('semana') ? 'semanal' : p.includes('mês') ? 'mensal' : 'diario';

// ─── Helpers de snapshot ──────────────────────────────────────────────────────

type ItemSnapshot = Pick<DietaItem, 'id' | 'qtdGramasDia' | 'periodicidade' | 'unidade' | 'horario'>;

const snapshotKey = (planId: string) => `dieta_snapshot_plano_${planId}`;

const salvarSnapshot = (planId: string, itens: DietaItem[]) => {
  const snap: ItemSnapshot[] = itens.map(({ id, qtdGramasDia, periodicidade, unidade, horario }) => ({
    id, qtdGramasDia, periodicidade, unidade, horario,
  }));
  sessionStorage.setItem(snapshotKey(planId), JSON.stringify(snap));
};

// ─── Helpers de data e frequência ────────────────────────────────────────────

const GRUPOS_FREQ: Record<string, string> = {
  '1x ao dia': 'diario', '2x ao dia': 'diario', '3x ao dia': 'diario',
  '1x por semana': 'semanal', '2x por semana': 'semanal', '3x por semana': 'semanal',
  '1x por mês': 'mensal', '2x por mês': 'mensal',
};
const getGrupo = (p: string) => GRUPOS_FREQ[p] ?? p;

const getPeriodicidadeByCount = (grupo: string, count: number): string => {
  if (grupo === 'diario')  { if (count===1) return '1x ao dia'; if (count===2) return '2x ao dia'; if (count===3) return '3x ao dia'; }
  if (grupo === 'semanal') { if (count===1) return '1x por semana'; if (count===2) return '2x por semana'; if (count===3) return '3x por semana'; }
  if (grupo === 'mensal')  { if (count===1) return '1x por mês'; if (count===2) return '2x por mês'; }
  return `${count}x`;
};

// ─── Validação de item ────────────────────────────────────────────────────────

const validarItem = (
  alimentoIdNum: number,
  novaPeriodicidade: string,
  novoHorario: string,
  itens: DietaItem[],
  alimentos: Alimento[],
  excludeId?: number,
): string | null => {
  const novoGrupo    = getGrupo(novaPeriodicidade);
  const nomeAlimento = alimentos.find(a => a.id === alimentoIdNum)?.nome ?? 'Este alimento';
  for (const item of itens) {
    if (item.id === excludeId) continue;
    if (item.alimentoId !== alimentoIdNum) continue;
    if (item.horario === novoHorario) return `"${nomeAlimento}" já está cadastrado neste período/dia.`;
    if (getGrupo(item.periodicidade) !== novoGrupo)
      return `"${nomeAlimento}" já existe com frequência "${item.periodicidade}". Um alimento só pode pertencer a um grupo de frequência por plano.`;
  }
  return null;
};

// ─── Subcomponente: Slot de horário ───────────────────────────────────────────

function HorarioSlot({
  horario, items, alimentos, editingItemId, editItemValues,
  onEditStart, onCancelEdit, onSaveEdit, onDelete, setEditItemValues,
}: {
  horario:           string;
  items:             DietaItem[];
  alimentos:         Alimento[];
  editingItemId:     number | null;
  editItemValues:    EditItemValues;
  onEditStart:       (item: DietaItem) => void;
  onCancelEdit:      () => void;
  onSaveEdit:        (id: number) => void;
  onDelete:          (item: DietaItem) => void;
  setEditItemValues: React.Dispatch<React.SetStateAction<EditItemValues>>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mb-4">
      <div className={`flex items-center justify-between gap-2 px-4 py-2 sticky top-0 z-10 ${SLOT_BG[horario] ?? 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{SLOT_EMOJI[horario] ?? '🍽️'}</span>
          <span className="text-sm font-semibold text-gray-800">{horario}</span>
          <span className="text-xs text-gray-400">• {items.length} {items.length === 1 ? 'item' : 'itens'}</span>
        </div>
        <span className="text-xs text-gray-500 font-medium">Total: {calcTotal(items)}</span>
      </div>
      {items.map(item => (
        <div key={item.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0">
          {editingItemId === item.id ? (
            <>
              <select value={editItemValues.alimentoId} onChange={e => setEditItemValues(v => ({ ...v, alimentoId: e.target.value }))}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 focus:outline-none focus:border-emerald-500 min-w-0">
                <option value="">— Selecionar —</option>
                {alimentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
              <select value={editItemValues.periodicidade} onChange={e => setEditItemValues(v => ({ ...v, periodicidade: e.target.value }))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 focus:outline-none focus:border-emerald-500">
                {OPCOES_PERIODICIDADE.map(p => <option key={p}>{p}</option>)}
              </select>
              <input type="number" step="0.01" min="0" value={editItemValues.qtdGramasDia}
                onChange={e => setEditItemValues(v => ({ ...v, qtdGramasDia: e.target.value }))}
                className="w-20 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 focus:outline-none focus:border-emerald-500" />
              <select value={editItemValues.unidade} onChange={e => setEditItemValues(v => ({ ...v, unidade: e.target.value }))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-900 focus:outline-none focus:border-emerald-500">
                {OPCOES_UNIDADE.map(u => <option key={u}>{u}</option>)}
              </select>
              <button onClick={() => onSaveEdit(item.id)} className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"><Check size={14} /></button>
              <button onClick={onCancelEdit} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={14} /></button>
            </>
          ) : (
            <>
              <span className="flex-1 text-sm text-emerald-700 font-medium min-w-0 truncate">{item.alimento?.nome}</span>
              <span className="text-xs text-gray-900 font-medium flex-shrink-0 w-16 text-right">{item.qtdGramasDia} {item.unidade}</span>
              <button onClick={() => onEditStart(item)} className="text-emerald-400 hover:text-emerald-600 flex-shrink-0 p-0.5"><Pencil size={14} /></button>
              <button onClick={() => onDelete(item)} className="text-red-300 hover:text-red-500 flex-shrink-0 p-0.5"><Trash2 size={14} /></button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Subcomponente: Divisor de seção ─────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 mt-3 mb-1">
      <div className="flex-1 h-px bg-gray-100" />
      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

// ─── Subcomponente: Modal de múltiplos slots ──────────────────────────────────

function ModalMultiSlot({
  alimento, periodicidade, slotCount, unidadesDisponiveis,
  opcoesSeletor, defaultSeletores, labelSeletor,
  onConfirm, onClose,
}: {
  alimento:            Alimento;
  periodicidade:       string;
  slotCount:           number;
  unidadesDisponiveis: string[];
  opcoesSeletor:       string[];
  defaultSeletores:    string[];
  labelSeletor:        string;
  onConfirm:           (slots: { horario: string; qty: string; unidade: string }[], observacao: string) => Promise<void>;
  onClose:             () => void;
}) {
  const [slots, setSlots] = useState(() =>
    Array.from({ length: slotCount }, (_, i) => ({
      horario: defaultSeletores[i] ?? opcoesSeletor[0] ?? 'Manhã',
      qty:     '',
      unidade: unidadesDisponiveis[0] ?? 'kg',
    }))
  );
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);

  const updateSlot = (i: number, field: 'horario' | 'qty' | 'unidade', value: string) =>
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));

  const handleConfirm = async () => {
    if (slots.some(s => !s.qty || Number(s.qty) <= 0)) {
      toast.error('Informe a quantidade em todos os slots');
      return;
    }
    setSaving(true);
    try { await onConfirm(slots, observacao); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="mb-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Adicionando alimento</p>
          <h3 className="text-base font-bold text-gray-900">{alimento.nome}</h3>
          <span className="inline-block mt-1 text-xs font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
            {periodicidade}
          </span>
        </div>

        <div className="space-y-3">
          {slots.map((slot, i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">
                {SLOT_EMOJI[slot.horario] ?? '📅'} {labelSeletor} {i + 1}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <select value={slot.horario} onChange={e => updateSlot(i, 'horario', e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl px-2 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
                  {opcoesSeletor.map(h => <option key={h}>{h}</option>)}
                </select>
                <input type="number" value={slot.qty} onChange={e => updateSlot(i, 'qty', e.target.value)}
                  placeholder="Quantidade" min="0" step="0.01"
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500" />
                <select value={slot.unidade} onChange={e => updateSlot(i, 'unidade', e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl px-2 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
                  {unidadesDisponiveis.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Observação</label>
          <input
            value={observacao}
            onChange={e => setObservacao(e.target.value)}
            placeholder="Ex: fornecer picado, antes do exercício..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">Cancelar</button>
          <button onClick={handleConfirm} disabled={saving}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Salvando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponente: Barra de adição rápida ────────────────────────────────────

function BottomAddBar({
  alimentos, onAdd, mobile = false,
}: {
  alimentos: Alimento[];
  onAdd:     (alimentoId: number, horario: string, periodicidade: string, qty: number, unidade: string, observacao: string, noRefresh?: boolean) => Promise<void>;
  mobile?:   boolean;
}) {
  const [alimentoId,    setAlimentoId]    = useState('');
  const [periodicidade, setPeriodicidade] = useState('1x ao dia');
  const [qty,           setQty]           = useState('');
  const [horario,       setHorario]       = useState('Manhã');
  const [unidade,       setUnidade]       = useState('kg');
  const [observacao,    setObservacao]    = useState('');
  const [saving,        setSaving]        = useState(false);
  const [showModal,     setShowModal]     = useState(false);

  const slotCount = /^3x/.test(periodicidade) ? 3 : /^2x/.test(periodicidade) ? 2 : 1;

  const tipo             = getTipo(periodicidade);
  const precisaModal     = tipo !== 'diario' || slotCount > 1;
  const opcoesSeletor    = tipo === 'semanal' ? OPCOES_DIA_SEMANA : tipo === 'mensal' ? OPCOES_DIA_MES : OPCOES_HORARIO;
  const defaultSeletores = tipo === 'semanal' ? DEFAULT_DIAS_SEMANA : tipo === 'mensal' ? DEFAULT_DIAS_MES : DEFAULT_HORARIOS;
  const labelSeletor     = tipo === 'semanal' ? 'Dia da semana' : tipo === 'mensal' ? 'Dia do mês' : 'Horário';

  const alimentoSelecionado = alimentos.find(a => a.id === Number(alimentoId));
  const unidadesDisponiveis = alimentoSelecionado?.unidade
    ? OPCOES_UNIDADE.filter(u => u === alimentoSelecionado.unidade || u === 'g' || u === 'kg')
    : OPCOES_UNIDADE;

  useEffect(() => {
    if (alimentoSelecionado?.unidade) setUnidade(alimentoSelecionado.unidade);
  }, [alimentoId]);

  useEffect(() => {
    if (precisaModal && alimentoId) setShowModal(true);
  }, [periodicidade]);

  const resetForm = () => {
    setAlimentoId(''); setPeriodicidade('1x ao dia'); setQty(''); setHorario('Manhã'); setUnidade('kg'); setObservacao('');
  };

  const handleAdd = async () => {
    if (!alimentoId) { toast.error('Selecione um alimento'); return; }
    if (precisaModal) { setShowModal(true); return; }
    if (!qty || Number(qty) <= 0) { toast.error('Informe a quantidade'); return; }
    setSaving(true);
    try {
      await onAdd(Number(alimentoId), horario, periodicidade, Number(qty), unidade, observacao);
      resetForm();
    } finally { setSaving(false); }
  };

  const handleModalConfirm = async (slots: { horario: string; qty: string; unidade: string }[], obs: string) => {
    for (let i = 0; i < slots.length; i++) {
      const isLast = i === slots.length - 1;
      await onAdd(Number(alimentoId), slots[i].horario, periodicidade, Number(slots[i].qty), slots[i].unidade, obs, !isLast);
    }
    resetForm();
    setShowModal(false);
  };

  const modalNode = showModal && alimentoSelecionado ? (
    <ModalMultiSlot
      alimento={alimentoSelecionado}
      periodicidade={periodicidade}
      slotCount={slotCount}
      unidadesDisponiveis={unidadesDisponiveis}
      opcoesSeletor={opcoesSeletor}
      defaultSeletores={defaultSeletores}
      labelSeletor={labelSeletor}
      onConfirm={handleModalConfirm}
      onClose={() => setShowModal(false)}
    />
  ) : null;

  if (mobile) {
    return (
      <>
        <div className="border-b border-gray-100 bg-white p-3 space-y-2 flex-shrink-0">
          <select value={alimentoId} onChange={e => setAlimentoId(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500">
            <option value="">Selecionar alimento...</option>
            {alimentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
          <select value={periodicidade} onChange={e => setPeriodicidade(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-2 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
            {OPCOES_PERIODICIDADE.map(p => <option key={p}>{p}</option>)}
          </select>
          {!precisaModal && (
            <>
              <select value={horario} onChange={e => setHorario(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-xl px-2 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
                {OPCOES_HORARIO.map(h => <option key={h}>{h}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" value={qty} onChange={e => setQty(e.target.value)}
                  placeholder="Quantidade" min="0" step="0.01"
                  className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500" />
                <select value={unidade} onChange={e => setUnidade(e.target.value)}
                  className="text-sm border border-gray-200 rounded-xl px-2 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
                  {unidadesDisponiveis.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <input value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder="Observação (opcional)"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500" />
            </>
          )}
          <button onClick={handleAdd} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors">
            {saving ? 'Adicionando...' : 'Adicionar'}
          </button>
        </div>
        {modalNode}
      </>
    );
  }

  return (
    <>
      <div className="border-b border-gray-100 bg-white p-2 flex gap-2 items-center flex-shrink-0">
        <select value={alimentoId} onChange={e => setAlimentoId(e.target.value)}
          className="flex-1 min-w-36 text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
          <option value="">Selecionar alimento...</option>
          {alimentos.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
        <select value={periodicidade} onChange={e => setPeriodicidade(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500">
          {OPCOES_PERIODICIDADE.map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={horario} onChange={e => setHorario(e.target.value)}
          disabled={precisaModal}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500 disabled:opacity-40">
          {OPCOES_HORARIO.map(h => <option key={h}>{h}</option>)}
        </select>
        <input type="number" value={qty} onChange={e => setQty(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Qtd" min="0" step="0.01" disabled={precisaModal}
          className="w-20 text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500 text-center disabled:opacity-40" />
        <select value={unidade} onChange={e => setUnidade(e.target.value)}
          disabled={precisaModal}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500 disabled:opacity-40">
          {unidadesDisponiveis.map(u => <option key={u}>{u}</option>)}
        </select>
        {!precisaModal && (
          <input value={observacao} onChange={e => setObservacao(e.target.value)}
            placeholder="Observação"
            className="w-32 text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-900 focus:outline-none focus:border-emerald-500" />
        )}
        <button onClick={handleAdd} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
          {saving ? 'Salvando...' : 'Adicionar'}
        </button>
      </div>
      {modalNode}
    </>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const Dieta = () => {
  const { user } = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const { podeExecutar, loading: loadingPerms } = usePermissoes();

  const podeCriar      = podeExecutar('nutricao.dietas.criar');
  const podeEditar     = podeExecutar('nutricao.dietas.editar');
  const podeImprimir   = podeExecutar('nutricao.dietas.imprimir');
  const podeCompartilhar = podeExecutar('nutricao.dietas.compartilhar');
  const podeExportar   = podeExecutar('nutricao.dietas.exportar');

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const location  = useLocation();
  const { animalId } = useParams<{ animalId?: string }>();

  const effectiveAnimalId = animalId || selectedAnimal?.id?.toString();

  const [animal,                setAnimal]                = useState<AnimalExtended | null>(null);
  const [animaisDoProprietario, setAnimaisDoProprietario] = useState<AnimalExtended[]>([]);
  const [loading,               setLoading]               = useState(true);
  const [loadingItens,          setLoadingItens]          = useState(false);
  const [planos,                setPlanos]                = useState<PlanoDieta[]>([]);
  const [planoSelecionado,      setPlanoSelecionado]      = useState<PlanoDieta | null>(null);
  const [itens,                 setItens]                 = useState<DietaItem[]>([]);
  const [alimentos,             setAlimentos]             = useState<Alimento[]>([]);
  const [search,                setSearch]                = useState('');
  const [filtroAtivo,           setFiltroAtivo]           = useState<FiltroAtivo>('todos');
  const [novoPlanoNome,         setNovoPlanoNome]         = useState('');
  const [editandoPlanoId,       setEditandoPlanoId]       = useState<number | null>(null);
  const [editandoNome,          setEditandoNome]          = useState('');
  const [itemParaExcluir,       setItemParaExcluir]       = useState<DietaItem | null>(null);
  const [editingItemId,         setEditingItemId]         = useState<number | null>(null);
  const [editItemValues,        setEditItemValues]        = useState<EditItemValues>({
    alimentoId: '', qtdGramasDia: '', unidade: '', horario: '', periodicidade: '',
  });
  const [conflitosFrequencia,   setConflitosFrequencia]  = useState<string[]>([]);
  const [pendingCriarPlano,     setPendingCriarPlano]    = useState<{ nome: string; planoAtivoNome: string } | null>(null);
  const [showMobileItems,       setShowMobileItems]       = useState(false);
  const [showModalNovoPlano,    setShowModalNovoPlano]    = useState(false);

  const itensRef = useRef<HTMLDivElement>(null);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      if (!res.data) return;
      const a = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a); setSelectedAnimal(a);
      api.get(`/animais/${effectiveAnimalId}/logo-empresa`)
        .then(res2 => {
          const logoUrl = res2.data?.dados?.logoUrl ?? null;
          setAnimal(prev => prev ? { ...prev, logoUrl } : prev);
        })
        .catch(() => {});
    } catch { /* silencioso */ }
  }, [effectiveAnimalId]);

  const carregarAnimais = useCallback(async () => {
    try {
      const res = await api.get('/animais');
      if (!res.data) return;
      setAnimaisDoProprietario((res.data?.dados ?? res.data ?? []) as AnimalExtended[]);
    } catch { /* silencioso */ }
  }, []);

  const carregarAlimentos = useCallback(async () => {
    try {
      const res = await api.get('/alimentos');
      if (!res.data) return;
      setAlimentos((res.data?.dados ?? res.data ?? []) as Alimento[]);
    } catch { /* silencioso */ }
  }, []);

  const carregarPlanos = useCallback(async () => {
    if (!effectiveAnimalId) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (filtroAtivo !== 'todos') params.set('ativo', filtroAtivo === 'ativos' ? 'true' : 'false');
      const endpoint = search.trim() || filtroAtivo !== 'todos'
        ? `/dietas/planos/animal/${effectiveAnimalId}/buscar?${params}`
        : `/dietas/planos/animal/${effectiveAnimalId}`;
      const res = await api.get(endpoint);
      if (!res.data) { setPlanos([]); return; }
      setPlanos(res.data?.dados ?? []);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [effectiveAnimalId, search, filtroAtivo]);

  const carregarItens = useCallback(async (planId: number) => {
    setLoadingItens(true); setEditingItemId(null); setConflitosFrequencia([]);
    try {
      const [planoRes, itensRes] = await Promise.all([
        api.get(`/dietas/planos/${planId}`),
        api.get(`/dietas/plano/${planId}/itens`),
      ]);
      if (!planoRes.data || !itensRes.data) { setPlanoSelecionado(null); setItens([]); return; }
      const plano     = planoRes.data?.dados as PlanoDieta;
      const itensList = itensRes.data?.dados as DietaItem[];
      setPlanoSelecionado(plano); setItens(itensList);

      const freqPorAlimento  = new Map<number, Set<string>>();
      const nomesPorAlimento = new Map<number, string>();
      itensList.forEach(item => {
        if (!freqPorAlimento.has(item.alimentoId)) freqPorAlimento.set(item.alimentoId, new Set());
        freqPorAlimento.get(item.alimentoId)!.add(item.periodicidade);
        nomesPorAlimento.set(item.alimentoId, item.alimento?.nome ?? String(item.alimentoId));
      });
      const conflitos: string[] = [];
      freqPorAlimento.forEach((freqs, alimentoId) => {
        const grupos = new Set([...freqs].map(f => GRUPOS_FREQ[f] ?? f));
        if (grupos.size > 1)
          conflitos.push(`${nomesPorAlimento.get(alimentoId)} (${[...freqs].join(' + ')})`);
      });
      setConflitosFrequencia(conflitos);

      const key = snapshotKey(String(planId));
      if (!sessionStorage.getItem(key)) salvarSnapshot(String(planId), itensList);
    } catch { /* silencioso */ }
    finally { setLoadingItens(false); }
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Ao trocar de animal, limpa o plano e itens do anterior para forçar reload
  useEffect(() => {
    setPlanoSelecionado(null);
    setItens([]);
  }, [effectiveAnimalId]);

  // Aguarda permissões carregarem antes de fazer qualquer chamada de API.
  // Evita chamadas 403 quando o usuário não tem acesso.
  useEffect(() => {
    if (loadingPerms) return;
    carregarAnimal(); carregarAnimais(); carregarAlimentos();
  }, [effectiveAnimalId, loadingPerms]);

  useEffect(() => {
    if (loadingPerms) return;
    carregarPlanos();
  }, [effectiveAnimalId, search, filtroAtivo, loadingPerms]);

  useEffect(() => {
    if (planos.length === 0) return;
    if (location.state?.planoAberto) {
      const plano = planos.find(p => p.id === location.state.planoAberto);
      if (plano) { carregarItens(plano.id); setShowMobileItems(true); window.history.replaceState({}, ''); return; }
    }
    if (!planoSelecionado) {
      const ativo = planos.find(p => p.ativo) ?? planos[0];
      if (ativo) carregarItens(ativo.id);
    }
  }, [planos]);

  // ── Handlers: planos ──────────────────────────────────────────────────────

  const handleSelecionarPlano = (plano: PlanoDieta) => {
    if (planoSelecionado?.id === plano.id) {
      setPlanoSelecionado(null); setItens([]); setEditingItemId(null); setShowMobileItems(false); return;
    }
    carregarItens(plano.id); setShowMobileItems(true);
  };

  const handleCriarPlano = async () => {
    if (!podeCriar) { semPermissao('criar dieta'); return; }
    const nomeFinal = (pendingCriarPlano?.nome ?? novoPlanoNome).trim();
    if (!nomeFinal) { toast.error('Informe um nome para o plano'); return; }
    if (!pendingCriarPlano) {
      const planoAtivo = planos.find(p => p.ativo);
      if (planoAtivo) { setPendingCriarPlano({ nome: nomeFinal, planoAtivoNome: planoAtivo.nome }); return; }
    }
    try {
      const planoAtivo = planos.find(p => p.ativo);
      const res        = await api.post('/dietas/planos', { animalId: Number(effectiveAnimalId), nome: nomeFinal });
      if (!res.data) { toast.error('Sem permissão para criar dieta'); return; }
      const novoPlano  = res.data.dados as PlanoDieta;
      if (planoAtivo) await api.patch(`/dietas/planos/${planoAtivo.id}/toggle`);
      setNovoPlanoNome(''); setPendingCriarPlano(null);
      setShowModalNovoPlano(false);
      await carregarPlanos();
      carregarItens(novoPlano.id); setShowMobileItems(true);
      toast.success('Plano criado! Adicione alimentos pela barra na parte inferior direita.');
    } catch { /* silencioso — 403 já tratado pelo interceptor */ }
  };

  const handleSalvarNomePlano = async (id: number) => {
    if (!podeEditar) { semPermissao('alterar dieta'); return; }
    if (!editandoNome.trim()) { toast.error('O nome não pode ser vazio'); return; }
    try {
      await api.put(`/dietas/planos/${id}`, { nome: editandoNome.trim() });
      setEditandoPlanoId(null);
      if (planoSelecionado?.id === id)
        setPlanoSelecionado(prev => prev ? { ...prev, nome: editandoNome.trim() } : prev);
      carregarPlanos();
    } catch { /* silencioso */ }
  };

  const handleTogglePlano = async () => {
    if (!podeEditar) { semPermissao('alterar status da dieta'); return; }
    if (!planoSelecionado) return;
    try {
      const res        = await api.patch(`/dietas/planos/${planoSelecionado.id}/toggle`);
      if (!res.data) return;
      const atualizado = res.data.dados as PlanoDieta;
      setPlanoSelecionado(atualizado);
      setPlanos(prev => prev.map(p => {
        if (p.id === atualizado.id) return { ...p, ativo: atualizado.ativo };
        if (atualizado.ativo) return { ...p, ativo: false };
        return p;
      }));
    } catch { /* silencioso */ }
  };

  // ── Handlers: itens ───────────────────────────────────────────────────────

  const handleAddItem = async (
    alimentoId: number, horario: string, periodicidade: string, qty: number, unidade: string, observacao: string,
    noRefresh = false,
  ) => {
    if (!podeCriar) { semPermissao('adicionar item à dieta'); return; }
    if (!planoSelecionado) { toast.error('Selecione um plano primeiro'); return; }
    const erro = validarItem(alimentoId, periodicidade, horario, itens, alimentos);
    if (erro) { toast.error(erro); return; }
    try {
      await api.post('/dietas', {
        animalId:      Number(effectiveAnimalId),
        planoDietaId:  planoSelecionado.id,
        alimentoId, periodicidade, qtdGramasDia: qty, unidade, horario,
        observacao: observacao || null,
      });
      toast.success('Alimento adicionado!');
      sessionStorage.removeItem(snapshotKey(String(planoSelecionado.id)));
      if (!noRefresh) { carregarItens(planoSelecionado.id); carregarPlanos(); }
    } catch { /* silencioso — 403 já tratado pelo interceptor */ throw new Error('add_failed'); }
  };

  const handleStartEdit = (item: DietaItem) => {
    setEditingItemId(item.id);
    setEditItemValues({
      alimentoId:    String(item.alimentoId),
      qtdGramasDia:  String(item.qtdGramasDia),
      unidade:       item.unidade,
      horario:       item.horario ?? '',
      periodicidade: item.periodicidade,
    });
  };

  const handleSaveEdit = async (id: number) => {
    if (!podeEditar) { semPermissao('alterar item da dieta'); return; }
    const alimentoIdNum = Number(editItemValues.alimentoId);
    const erro = validarItem(alimentoIdNum, editItemValues.periodicidade, editItemValues.horario, itens, alimentos, id);
    if (erro) { toast.error(erro); return; }
    try {
      await api.put(`/dietas/${id}`, {
        alimentoId:    alimentoIdNum,
        qtdGramasDia:  Number(editItemValues.qtdGramasDia),
        unidade:       editItemValues.unidade,
        horario:       editItemValues.horario || null,
        periodicidade: editItemValues.periodicidade,
      });
      setEditingItemId(null); toast.success('Alimento atualizado');
      if (planoSelecionado) carregarItens(planoSelecionado.id);
    } catch { /* silencioso */ }
  };

  const handleExcluirItem = async (motivo: string) => {
    if (!podeEditar) { semPermissao('excluir item da dieta'); return; }
    if (!itemParaExcluir || !planoSelecionado) return;
    try {
      await api.delete(`/dietas/${itemParaExcluir.id}`, { data: { motivo } });
      const grupo  = getGrupo(itemParaExcluir.periodicidade);
      const irmaos = itens.filter(i =>
        i.id !== itemParaExcluir.id &&
        i.alimentoId === itemParaExcluir.alimentoId &&
        getGrupo(i.periodicidade) === grupo
      );
      if (irmaos.length > 0) {
        const novaPeriodicidade = getPeriodicidadeByCount(grupo, irmaos.length);
        await Promise.all(irmaos.map(irmao => api.put(`/dietas/${irmao.id}`, {
          alimentoId: irmao.alimentoId, qtdGramasDia: irmao.qtdGramasDia,
          unidade: irmao.unidade, horario: irmao.horario, periodicidade: novaPeriodicidade,
        })));
      }
      setItemParaExcluir(null);
      sessionStorage.removeItem(snapshotKey(String(planoSelecionado.id)));
      toast.success('Alimento removido da dieta');
      carregarItens(planoSelecionado.id); carregarPlanos();
    } catch { /* silencioso */ }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const itensDiarios  = itens.filter(i => getTipo(i.periodicidade) === 'diario');
  const itensSemanais = itens.filter(i => getTipo(i.periodicidade) === 'semanal');
  const itensMensais  = itens.filter(i => getTipo(i.periodicidade) === 'mensal');

  const itensPorSlotSubset = (h: string, subset: DietaItem[]) => subset.filter(i => i.horario === h);

  const slotsDiarios  = [...new Set(itensDiarios.map(i  => i.horario ?? 'Sem horário'))].sort((a, b) => {
    const ai = OPCOES_HORARIO.indexOf(a); const bi = OPCOES_HORARIO.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  const slotsSemanais = [...new Set(itensSemanais.map(i => i.horario ?? 'Sem dia'))].sort((a, b) => {
    const ai = OPCOES_DIA_SEMANA.indexOf(a); const bi = OPCOES_DIA_SEMANA.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
  const slotsMensais  = [...new Set(itensMensais.map(i  => i.horario ?? 'Sem dia'))].sort((a, b) => {
    const ai = OPCOES_DIA_MES.indexOf(a); const bi = OPCOES_DIA_MES.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const commonSlotProps = {
    alimentos, editingItemId, editItemValues, setEditItemValues,
    onEditStart:  handleStartEdit,
    onCancelEdit: () => setEditingItemId(null),
    onSaveEdit:   handleSaveEdit,
    onDelete:     (item: DietaItem) => setItemParaExcluir(item),
  };

  const renderItensPanel = (isLoading: boolean) => {
    if (isLoading) return <p className="text-center py-8 text-gray-400 text-sm">Carregando...</p>;
    if (itens.length === 0) return <p className="text-center py-8 text-gray-300 text-sm">Nenhum alimento. Use a barra abaixo para adicionar.</p>;

    return (
      <>
        {slotsDiarios.map(h => (
          <HorarioSlot key={`d-${h}`} horario={h} items={itensPorSlotSubset(h, itensDiarios)} {...commonSlotProps} />
        ))}
        {itensSemanais.length > 0 && (
          <>
            <SectionDivider label="📅 Semanal" />
            {slotsSemanais.map(h => (
              <HorarioSlot key={`s-${h}`} horario={h} items={itensPorSlotSubset(h, itensSemanais)} {...commonSlotProps} />
            ))}
          </>
        )}
        {itensMensais.length > 0 && (
          <>
            <SectionDivider label="📆 Mensal" />
            {slotsMensais.map(h => (
              <HorarioSlot key={`m-${h}`} horario={h} items={itensPorSlotSubset(h, itensMensais)} {...commonSlotProps} />
            ))}
          </>
        )}
      </>
    );
  };

  // ── Guard de permissão ────────────────────────────────────────────────────

  if (!loadingPerms && !podeExecutar('nutricao.dietas.ler')) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
            <AlertTriangle size={28} className="text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-gray-800 mb-1">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para acessar as dietas.</p>
          <p className="text-xs text-gray-400 mt-1">Entre em contato com o responsável da equipe.</p>
        </div>
      </PageContainer>
    );
  }

  if (!animal && loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!effectiveAnimalId) {
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
      <PageContainer>

        <BotaoVoltar className="mb-4" />

        <SeletorAnimal
          animais={animaisDoProprietario}
          animalIdAtual={effectiveAnimalId}
          rotaBase="/dieta"
          className="mb-4"
        />

        {animal && <AnimalCard animal={animal} />}

        {/* ══ DESKTOP ═══════════════════════════════════════════════════════ */}
        <div className="hidden md:flex flex-col bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden" style={{ height: 'calc(100vh - 260px)', minHeight: 560 }}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-gray-900 truncate">{planoSelecionado?.nome ?? ''}</h2>
                  {planoSelecionado && (
                    <button onClick={handleTogglePlano}
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 transition-colors ${
                        planoSelecionado.ativo
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      • {planoSelecionado.ativo ? 'ATIVO' : 'INATIVO'}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  Gerencie rações e suplementos. Somente planos ativos representam a ingestão diária atual.
                </p>
              </div>
              {planoSelecionado && animal && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <DietaAcoesBar
                    animal={animal} plano={planoSelecionado} itens={itens} user={user}
                    podeImprimir={podeImprimir} podeCompartilhar={podeCompartilhar} podeExportar={podeExportar}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Corpo */}
          <div className="flex flex-1 min-h-0">

            {/* Coluna esquerda: planos */}
            <div className="w-56 flex-shrink-0 border-r border-gray-100 flex flex-col">
              <div className="p-3 space-y-2 border-b border-gray-100">

                {/* Botão + Novo Plano ACIMA do search */}
                {podeCriar && (
                  <button
                    onClick={() => { setShowModalNovoPlano(true); setNovoPlanoNome(''); setPendingCriarPlano(null); }}
                    className="w-full flex items-center justify-center gap-1 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors">
                    Novo Plano
                  </button>
                )}

                <div className="relative">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar plano..."
                    className="w-full pl-8 pr-2 py-2 text-xs text-gray-900 border border-gray-200 rounded-xl focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="flex gap-1">
                  {(['todos','ativos','inativos'] as FiltroAtivo[]).map(f => (
                    <button key={f} onClick={() => setFiltroAtivo(f)}
                      className={`flex-1 py-1 text-xs rounded-full font-medium capitalize transition-colors ${
                        filtroAtivo === f ? 'bg-emerald-700 text-white' : 'border border-gray-200 text-gray-500 hover:border-emerald-300'
                      }`}>{f}</button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {loading ? (
                  <p className="text-xs text-gray-400 text-center py-4">Carregando...</p>
                ) : planos.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Nenhum plano encontrado</p>
                ) : planos.map(plano => (
                  <div key={plano.id} className={`rounded-xl border transition-all ${planoSelecionado?.id === plano.id ? 'border-emerald-400 bg-emerald-50' : 'border-transparent hover:bg-gray-50'}`}>
                    {editandoPlanoId === plano.id ? (
                      <div className="flex gap-1 items-center p-2">
                        <input autoFocus value={editandoNome} onChange={e => setEditandoNome(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSalvarNomePlano(plano.id); if (e.key === 'Escape') setEditandoPlanoId(null); }}
                          className="flex-1 text-xs text-gray-900 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500" />
                        <button onClick={() => handleSalvarNomePlano(plano.id)} className="text-emerald-600"><Check size={12} /></button>
                        <button onClick={() => setEditandoPlanoId(null)} className="text-gray-400"><X size={12} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-2 py-2">
                        <button className="flex-1 text-left min-w-0" onClick={() => handleSelecionarPlano(plano)}>
                          <div className="flex items-center gap-1 justify-between">
                            <span className={`text-sm font-semibold truncate ${planoSelecionado?.id === plano.id ? 'text-emerald-800' : 'text-gray-900'}`}>{plano.nome}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${plano.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{plano.ativo ? 'ativo' : 'inativo'}</span>
                          </div>
                          <span className="text-xs text-gray-500">{plano._count?.itens ?? 0} alimento{plano._count?.itens !== 1 ? 's' : ''}</span>
                        </button>
                        <button onClick={() => { setEditandoPlanoId(plano.id); setEditandoNome(plano.nome); }} className="p-1 text-gray-300 hover:text-gray-600 flex-shrink-0">
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Coluna direita: itens */}
            <div className="flex-1 min-w-0 flex flex-col">
              {!planoSelecionado ? (
                <div className="flex-1 flex items-center justify-center text-gray-300 flex-col gap-2">
                  <Plus size={28} />
                  <span className="text-sm">Selecione ou crie um plano</span>
                </div>
              ) : (
                <>
                  {podeCriar && <BottomAddBar alimentos={alimentos} onAdd={handleAddItem} />}
                  {conflitosFrequencia.length > 0 && (
                    <div className="mx-4 mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 flex-shrink-0">
                      <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-red-700">
                        <p className="font-semibold mb-1">Conflito de frequências</p>
                        {conflitosFrequencia.map(c => <p key={c}>· {c}</p>)}
                      </div>
                    </div>
                  )}
                  <div ref={itensRef} className="flex-1 overflow-y-auto py-2">
                    {renderItensPanel(loadingItens)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ══ MOBILE ════════════════════════════════════════════════════════ */}
        <div className="md:hidden">
          {!showMobileItems ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar plano..."
                    className="w-full pl-8 pr-3 py-2.5 text-sm text-gray-900 border border-gray-200 rounded-2xl focus:outline-none focus:border-emerald-500 bg-white shadow-sm" />
                </div>
                <button onClick={() => { setShowModalNovoPlano(true); setNovoPlanoNome(''); setPendingCriarPlano(null); }}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 text-white text-sm font-semibold rounded-2xl shadow-sm">
                  Novo
                </button>
              </div>

              <div className="flex gap-2">
                {(['todos','ativos','inativos'] as FiltroAtivo[]).map(f => (
                  <button key={f} onClick={() => setFiltroAtivo(f)}
                    className={`px-3 py-1.5 text-xs rounded-full font-medium capitalize transition-colors ${
                      filtroAtivo === f ? 'bg-emerald-700 text-white' : 'border border-gray-200 text-gray-600 bg-white'
                    }`}>{f}</button>
                ))}
              </div>

              <div className="space-y-2">
                {loading ? (
                  <p className="text-center py-8 text-gray-400 text-sm">Carregando...</p>
                ) : planos.map(plano => (
                  <button key={plano.id} onClick={() => handleSelecionarPlano(plano)}
                    className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{plano.nome}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${plano.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{plano.ativo ? 'ativo' : 'inativo'}</span>
                      </div>
                      <span className="text-xs text-gray-500">{plano._count?.itens ?? 0} alimento{plano._count?.itens !== 1 ? 's' : ''}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col" style={{ minHeight: '75vh' }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <button onClick={() => setShowMobileItems(false)} className="flex items-center gap-1 text-emerald-700 font-medium text-sm">
                  <ArrowLeft size={16} />
                </button>
                <span className="font-semibold text-gray-900 text-sm">{planoSelecionado?.nome}</span>
                <div className="flex items-center gap-2">
                  <button onClick={handleTogglePlano}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium ${planoSelecionado?.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {planoSelecionado?.ativo ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                    {planoSelecionado?.ativo ? 'Ativo' : 'Inativo'}
                  </button>
                  {planoSelecionado && animal && (
                    <DietaAcoesBar
                      animal={animal} plano={planoSelecionado} itens={itens} user={user} compacto
                      podeImprimir={podeImprimir} podeCompartilhar={podeCompartilhar} podeExportar={podeExportar}
                    />
                  )}
                </div>
              </div>

              {planoSelecionado && podeCriar && (
                <BottomAddBar alimentos={alimentos} onAdd={handleAddItem} mobile />
              )}

              {conflitosFrequencia.length > 0 && (
                <div className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2">
                  <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700 font-medium">Conflito de frequências detectado</p>
                </div>
              )}

              <div className="flex-1 overflow-y-auto py-2">
                {renderItensPanel(loadingItens)}
              </div>
            </div>
          )}
        </div>

      {/* Modal novo plano */}
      {showModalNovoPlano && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-1">Novo Plano de Dieta</h3>
            <p className="text-sm text-gray-500 mb-4">Informe o nome do plano para continuar.</p>
            <input
              autoFocus
              value={novoPlanoNome}
              onChange={e => { setNovoPlanoNome(e.target.value); setPendingCriarPlano(null); }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCriarPlano();
                if (e.key === 'Escape') { setShowModalNovoPlano(false); setNovoPlanoNome(''); }
              }}
              placeholder="Ex: Plano Verão 2025..."
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 mb-4"
            />
            {pendingCriarPlano && (
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 mb-4">
                <p className="font-semibold mb-1">⚠️ Atenção</p>
                <p>O plano <strong>"{pendingCriarPlano.planoAtivoNome}"</strong> será inativado. Continuar?</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowModalNovoPlano(false); setNovoPlanoNome(''); setPendingCriarPlano(null); }}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleCriarPlano}
                className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition-colors">
                {pendingCriarPlano ? 'Confirmar' : 'Criar Plano'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de exclusão (justificativa obrigatória) */}
      <ModalJustificativa
        aberto={!!itemParaExcluir}
        titulo="Excluir alimento?"
        descricao={itemParaExcluir?.alimento?.nome}
        acaoLabel="Excluir"
        onConfirmar={handleExcluirItem}
        onFechar={() => setItemParaExcluir(null)}
      />
    </PageContainer>
  );
};

export default Dieta;