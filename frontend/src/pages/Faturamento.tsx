// frontend/src/pages/Faturamento.tsx
// Módulo Financeiro — Faturamento por proprietário, consolidando todos os animais

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import {
  DollarSign, Search, ChevronRight, Loader2, Plus, Trash2,
  Pencil, Check, X, RefreshCw, PawPrint, Receipt,
  CheckCircle2, AlertCircle, Ban, Share2, Download, Printer, ChevronDown,
} from 'lucide-react';
import { imprimirFatura, exportarFaturaCSV, compartilharFatura } from '../utils/FaturaExport';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type FaturaStatus = 'ABERTA' | 'PAGA' | 'CANCELADA';
type ItemTipo     = 'ASSISTENCIA' | 'MEDICAMENTO' | 'PROCEDIMENTO';

interface AnimalResumo {
  id: number; nome: string; photoUrl?: string;
  especie?: { nome: string }; raca?: { nome: string };
}

interface FaturaItem {
  id: number; faturaId: number; animalId?: number; tipo: string;
  descricao: string; valor: number; quantidade: number;
  veterinario?: { id: number; fullName: string };
  animal?: AnimalResumo;
}

interface Fatura {
  id: number; proprietarioId: number; mesReferencia?: string;
  total: number; status: FaturaStatus; criadoEm: string;
  itens: FaturaItem[];
  proprietario?: { id: number; fullName: string; email: string; phone?: string };
}

interface ProprietarioItem {
  id: number; fullName: string; email: string; phone?: string;
  animais: AnimalResumo[];
  faturaAtiva?: { id: number; total: number; status: FaturaStatus; mesReferencia?: string };
}

// ─── Catálogo de itens comuns ─────────────────────────────────────────────────

const CATALOGO: Array<{ label: string; tipo: ItemTipo; descricao: string; valor: number }> = [
  { label: 'Consulta Clínica Geral',          tipo: 'ASSISTENCIA',  descricao: 'Consulta Clínica Veterinária Geral',        valor: 150 },
  { label: 'Consulta de Retorno',             tipo: 'ASSISTENCIA',  descricao: 'Consulta de Retorno',                       valor: 80  },
  { label: 'Diária UTI Intensiva',            tipo: 'ASSISTENCIA',  descricao: 'Diária de UTM Intensiva Vet',               valor: 350 },
  { label: 'Hemograma Completo + Bioquímico', tipo: 'ASSISTENCIA',  descricao: 'Hemograma Completo + Bioquímico Sanguíneo', valor: 145 },
  { label: 'Castração Preventiva',            tipo: 'PROCEDIMENTO', descricao: 'Castração Preventiva',                      valor: 450 },
  { label: 'Dipirona Sódica Injetável',       tipo: 'MEDICAMENTO',  descricao: 'Dipirona Sódica Injetável 500 mg/mL',       valor: 25  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function formatMes(ref?: string) {
  if (!ref) return '';
  const [ano, mes] = ref.split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const TIPO_COR: Record<string, string> = {
  ASSISTENCIA:  'bg-blue-100 text-blue-700',
  MEDICAMENTO:  'bg-purple-100 text-purple-700',
  PROCEDIMENTO: 'bg-emerald-100 text-emerald-700',
};

function StatusBadge({ status }: { status: FaturaStatus }) {
  if (status === 'PAGA')      return <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full"><CheckCircle2 size={11}/> PAGO</span>;
  if (status === 'CANCELADA') return <span className="flex items-center gap-1 text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full"><Ban size={11}/> CANCELADA</span>;
  return <span className="flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full"><AlertCircle size={11}/> ABERTO</span>;
}

// ─── Linha de item editável ───────────────────────────────────────────────────

function ItemRow({
  item, canEdit, onDelete, onSave,
}: {
  item: FaturaItem;
  canEdit: boolean;
  onDelete: (id: number) => void;
  onSave: (id: number, patch: Partial<FaturaItem>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [desc,    setDesc]    = useState(item.descricao);
  const [valor,   setValor]   = useState(String(item.valor));
  const [qty,     setQty]     = useState(String(item.quantidade));
  const [tipo,    setTipo]    = useState(item.tipo);
  const [saving,  setSaving]  = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(item.id, { descricao: desc, valor: Number(valor), quantidade: Number(qty), tipo });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setDesc(item.descricao); setValor(String(item.valor));
    setQty(String(item.quantidade)); setTipo(item.tipo);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3 bg-indigo-50/60 rounded-xl border border-indigo-200">
        <div className="flex gap-2 flex-wrap">
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-400 bg-white">
            <option value="ASSISTENCIA">ASSISTENCIA</option>
            <option value="MEDICAMENTO">MEDICAMENTO</option>
            <option value="PROCEDIMENTO">PROCEDIMENTO</option>
          </select>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            className="flex-1 min-w-40 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
            placeholder="Descrição" />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-xs text-gray-500">Qtd.</label>
          <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
            className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-center focus:outline-none focus:border-indigo-400" />
          <label className="text-xs text-gray-500">Val. unit.</label>
          <input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)}
            className="w-28 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-right focus:outline-none focus:border-indigo-400" />
          <span className="text-xs text-gray-400">
            = {formatBRL(Number(valor) * Number(qty))}
          </span>
          <button onClick={handleSave} disabled={saving}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
          </button>
          <button onClick={handleCancel} className="p-1.5 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded-lg">
            <X size={13}/>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-50/60 rounded-xl transition-colors">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${TIPO_COR[item.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
        {item.tipo}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 truncate">{item.descricao}</p>
        <p className="text-[10px] text-gray-400">
          Quant.: {item.quantidade} · Unitário: {formatBRL(item.valor)}
        </p>
      </div>
      <span className="text-sm font-semibold text-gray-700 flex-shrink-0 w-24 text-right">
        {formatBRL(item.valor * item.quantidade)}
      </span>
      {canEdit && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button onClick={() => setEditing(true)}
            className="p-1 text-gray-400 hover:text-indigo-600 rounded-md transition-colors">
            <Pencil size={12}/>
          </button>
          <button onClick={() => onDelete(item.id)}
            className="p-1 text-gray-400 hover:text-red-500 rounded-md transition-colors">
            <Trash2 size={12}/>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Painel direito — detalhe da fatura ──────────────────────────────────────

function PainelFatura({
  prop, onStatusChange,
}: {
  prop: ProprietarioItem;
  onStatusChange: () => void;
}) {
  const [fatura,         setFatura]         = useState<Fatura | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [salvando,       setSalvando]       = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const handlePDF = () => {
    if (!fatura) return;
    imprimirFatura(fatura, prop.animais);
    setShowExportMenu(false);
  };

  const handleCSV = () => {
    if (!fatura) return;
    exportarFaturaCSV(fatura, prop.animais);
    setShowExportMenu(false);
    toast.success('CSV gerado');
  };

  const handleShare = async () => {
    if (!fatura) return;
    try {
      const result = await compartilharFatura(fatura);
      toast.success(result === 'copied' ? 'Resumo copiado!' : 'Compartilhado');
    } catch { toast.error('Erro ao compartilhar'); }
  };

  // Formulário de novo item
  const [novoAnimalId,  setNovoAnimalId]  = useState<string>(prop.animais[0]?.id?.toString() ?? '');
  const [novoCatIdx,    setNovoCatIdx]    = useState<string>('');
  const [novoNome,      setNovoNome]      = useState('');
  const [novoTipo,      setNovoTipo]      = useState<ItemTipo>('ASSISTENCIA');
  const [novoQty,       setNovoQty]       = useState('1');
  const [novoValor,     setNovoValor]     = useState('0');
  const [lancando,      setLancando]      = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/clinica/faturas/proprietario/${prop.id}`);
      setFatura(r.data.dados);
    } catch {
      toast.error('Erro ao carregar fatura');
    } finally {
      setLoading(false);
    }
  }, [prop.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const handleDeleteItem = async (itemId: number) => {
    try {
      const r = await api.delete(`/clinica/faturas/itens/${itemId}`);
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: prev.itens.filter(i => i.id !== itemId),
      } : prev);
    } catch { toast.error('Erro ao remover item'); }
  };

  const handleSaveItem = async (itemId: number, patch: Partial<FaturaItem>) => {
    try {
      const r = await api.put(`/clinica/faturas/itens/${itemId}`, patch);
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: prev.itens.map(i => i.id === itemId ? r.data.dados : i),
      } : prev);
    } catch { toast.error('Erro ao salvar item'); }
  };

  const handleCatalogoChange = (idx: string) => {
    setNovoCatIdx(idx);
    if (idx === '') return;
    const cat = CATALOGO[Number(idx)];
    setNovoNome(cat.descricao);
    setNovoTipo(cat.tipo);
    setNovoValor(String(cat.valor));
  };

  const handleLancar = async () => {
    if (!fatura) return;
    if (!novoNome.trim()) { toast.error('Informe a descrição do item'); return; }
    setLancando(true);
    try {
      const r = await api.post(`/clinica/faturas/${fatura.id}/itens`, {
        animalId:   novoAnimalId ? Number(novoAnimalId) : undefined,
        tipo:       novoTipo,
        descricao:  novoNome.trim(),
        valor:      Number(novoValor),
        quantidade: Number(novoQty),
      });
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: [...prev.itens, r.data.dados],
      } : prev);
      setNovoNome(''); setNovoCatIdx(''); setNovoQty('1'); setNovoValor('0');
      toast.success('Item lançado');
    } catch { toast.error('Erro ao lançar item'); }
    finally { setLancando(false); }
  };

  const handleStatus = async (status: FaturaStatus) => {
    if (!fatura) return;
    setSalvando(true);
    try {
      const r = await api.patch(`/clinica/faturas/${fatura.id}/status`, { status });
      setFatura(r.data.dados);
      toast.success(status === 'PAGA' ? 'Fatura marcada como paga' : 'Status atualizado');
      onStatusChange();
    } catch { toast.error('Erro ao atualizar status'); }
    finally { setSalvando(false); }
  };

  // Agrupa itens por animal
  type GrupoItens = Partial<Record<number | 'sem', FaturaItem[]>>;
  const itensPorAnimal: GrupoItens = fatura?.itens.reduce<GrupoItens>((acc, item) => {
    const key = item.animalId ?? 'sem';
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(item);
    return acc;
  }, {}) ?? {};

  const canEdit = fatura?.status === 'ABERTA';

  const invoiceRef = fatura ? `INV-${String(fatura.id).padStart(3, '0')}` : '—';

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-indigo-400"/>
      </div>
    );
  }

  if (!fatura) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden min-w-0">
      {/* Header verde suavizado */}
      <div className="bg-emerald-600 rounded-2xl p-5 mb-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Info do proprietário */}
          <div>
            <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-widest mb-1">Extrato Ativo do Cliente</p>
            <div className="flex items-center gap-2 mb-1">
              <Receipt size={15} className="text-emerald-200"/>
              <h2 className="text-lg font-bold text-white">{prop.fullName}</h2>
            </div>
            <p className="text-xs text-emerald-100">
              Faturamento total do mês:{' '}
              <span className="font-bold text-white">{formatMes(fatura.mesReferencia) || 'Mês atual'}</span>
              {' · '}
              <span className="font-mono">{invoiceRef}</span>
            </p>
          </div>

          {/* Ações do header */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={fatura.status}/>

            {canEdit && (
              <button
                onClick={() => handleStatus('PAGA')}
                disabled={salvando}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors border border-white/30">
                {salvando ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle2 size={11}/>}
                Marcar como Pago
              </button>
            )}

            <button onClick={carregar} className="p-1.5 text-emerald-100 hover:text-white rounded-lg transition-colors">
              <RefreshCw size={13}/>
            </button>
          </div>
        </div>

        {/* Info de contato */}
        <div className="mt-3 pt-3 border-t border-emerald-500 flex gap-6 flex-wrap text-xs text-emerald-100">
          {prop.phone && <span>Fone: <span className="text-white font-medium">{prop.phone}</span></span>}
          <span>Email: <span className="text-white font-medium">{prop.email}</span></span>
        </div>
      </div>

      {/* Barra de ações — Exportar e Compartilhar à direita */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            Lançamentos Detalhados Separados por Animal
          </p>
          <p className="text-[11px] text-gray-400">
            Cada animal possui seu prontuário financeiro isolado, integrado em um demonstrativo consolidado de cobrança único.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold transition-colors">
            <Share2 size={13}/> Compartilhar
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition-colors">
              <Download size={13}/> Exportar <ChevronDown size={11}/>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
                <button
                  onClick={handlePDF}
                  className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Printer size={13}/> PDF / Imprimir
                </button>
                <button
                  onClick={handleCSV}
                  className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={13}/> CSV (.csv)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Corpo da fatura */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 pr-1 pb-4">

        {/* Seções por animal */}
        {prop.animais.map(animal => {
          const itens: FaturaItem[] = itensPorAnimal[animal.id] ?? [];
          const subtotal = itens.reduce((s: number, i: FaturaItem) => s + i.valor * i.quantidade, 0);
          return (
            <div key={animal.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Header do animal */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <div className="flex items-center gap-2.5">
                  {animal.photoUrl ? (
                    <img src={animal.photoUrl} alt={animal.nome}
                      className="w-8 h-8 rounded-lg object-cover flex-shrink-0"/>
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <PawPrint size={14} className="text-indigo-500"/>
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-bold text-gray-900">Prontuário de {animal.nome}</p>
                    <p className="text-[10px] text-gray-400">
                      {animal.especie?.nome}{animal.raca?.nome ? ` (${animal.raca.nome})` : ''}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-gray-400 uppercase">Subtotal</p>
                  <p className="text-sm font-bold text-gray-800">{formatBRL(subtotal)}</p>
                </div>
              </div>

              {/* Itens */}
              {itens.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Nenhum lançamento para este animal.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {itens.map(item => (
                    <ItemRow key={item.id} item={item} canEdit={canEdit}
                      onDelete={handleDeleteItem} onSave={handleSaveItem}/>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Itens sem animal associado */}
        {(itensPorAnimal['sem'] ?? []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-sm font-bold text-gray-700">Outros lançamentos</p>
            </div>
            <div className="divide-y divide-gray-50">
              {(itensPorAnimal['sem'] ?? []).map((item: FaturaItem) => (
                <ItemRow key={item.id} item={item} canEdit={canEdit}
                  onDelete={handleDeleteItem} onSave={handleSaveItem}/>
              ))}
            </div>
          </div>
        )}

        {/* Resumo */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Resumo Geral do Proprietário</p>
              <p className="text-sm text-gray-500">Valor Total da Fatura Única:</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{formatBRL(fatura.total)}</p>
          </div>
        </div>

        {/* Formulário novo item */}
        {canEdit && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
              Lançar Novo Item / Cobrança no Prontuário
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              {/* Pet */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Selecionar Pet <span className="text-red-400">*</span>
                </label>
                <select value={novoAnimalId} onChange={e => setNovoAnimalId(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                  {prop.animais.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nome} ({a.especie?.nome ?? '—'})
                    </option>
                  ))}
                  <option value="">Sem animal específico</option>
                </select>
              </div>
              {/* Catálogo */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Mapear Item do Catálogo</label>
                <select value={novoCatIdx} onChange={e => handleCatalogoChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                  <option value="">— Escolha um item para preencher —</option>
                  {CATALOGO.map((c, i) => (
                    <option key={i} value={i}>{c.label}</option>
                  ))}
                </select>
              </div>
              {/* Tipo + Nome */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Item Name <span className="text-red-400">*</span>
                </label>
                <div className="flex gap-1.5">
                  <select value={novoTipo} onChange={e => setNovoTipo(e.target.value as ItemTipo)}
                    className="border border-gray-300 rounded-xl px-2 py-2 text-xs font-semibold focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="ASSISTENCIA">ASSIST.</option>
                    <option value="MEDICAMENTO">MEDIC.</option>
                    <option value="PROCEDIMENTO">PROC.</option>
                  </select>
                  <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                    placeholder="Ex: Diária de Internação"
                    className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              {/* Quantidade */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Quantidade</label>
                <input type="number" min="1" value={novoQty} onChange={e => setNovoQty(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:border-indigo-400"/>
              </div>
              {/* Valor */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Valor Unitário <span className="text-red-400">*</span>
                </label>
                <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:border-indigo-400">
                  <span className="px-2.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-2">R$</span>
                  <input type="number" min="0" step="0.01" value={novoValor}
                    onChange={e => setNovoValor(e.target.value)}
                    className="flex-1 px-2.5 py-2 text-sm text-right focus:outline-none"/>
                </div>
              </div>
              {/* Subtotal preview */}
              <div className="text-center">
                <p className="text-[10px] text-gray-400 mb-1">Total do item</p>
                <p className="text-sm font-bold text-gray-700">
                  {formatBRL(Number(novoValor) * Number(novoQty))}
                </p>
              </div>
              {/* Botão */}
              <button
                onClick={handleLancar}
                disabled={lancando || !novoNome.trim()}
                className="flex items-center justify-center gap-2 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors">
                {lancando ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
                Lançar Cobrança
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Painel esquerdo — lista de proprietários ─────────────────────────────────

function CardProprietario({
  prop, selecionado, onClick,
}: {
  prop: ProprietarioItem; selecionado: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3.5 rounded-2xl border transition-all ${
        selecionado
          ? 'bg-indigo-50 border-indigo-200 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
      }`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
            {prop.fullName[0]?.toUpperCase()}
          </div>
          <p className="text-sm font-semibold text-gray-900 truncate">{prop.fullName}</p>
        </div>
        {prop.faturaAtiva && <StatusBadge status={prop.faturaAtiva.status}/>}
      </div>
      <div className="flex flex-wrap gap-1 mb-2 pl-9">
        {prop.animais.slice(0, 3).map(a => (
          <span key={a.id}
            className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-medium">
            {a.nome} ({a.especie?.nome ?? '—'})
          </span>
        ))}
        {prop.animais.length > 3 && (
          <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full">
            +{prop.animais.length - 3}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between pl-9">
        <p className="text-[10px] text-gray-400 truncate">{prop.email}</p>
        {prop.faturaAtiva && (
          <p className="text-xs font-bold text-gray-700 flex-shrink-0">
            {formatBRL(prop.faturaAtiva.total)}
          </p>
        )}
      </div>
      {selecionado && <ChevronRight size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-400"/>}
    </button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Faturamento() {
  const [proprietarios, setProprietarios] = useState<ProprietarioItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [selecionado,   setSelecionado]   = useState<ProprietarioItem | null>(null);
  const [totalAbertas,  setTotalAbertas]  = useState(0);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/clinica/faturas/proprietarios');
      const lista: ProprietarioItem[] = r.data.dados ?? [];
      setProprietarios(lista);
      setTotalAbertas(lista.filter(p => p.faturaAtiva?.status === 'ABERTA').length);
    } catch {
      toast.error('Erro ao carregar proprietários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = proprietarios.filter(p =>
    !busca || p.fullName.toLowerCase().includes(busca.toLowerCase()) ||
    p.email.toLowerCase().includes(busca.toLowerCase()) ||
    p.animais.some(a => a.nome.toLowerCase().includes(busca.toLowerCase()))
  );

  return (
    <PageContainer maxWidth="7xl" noPadding>
      <div className="flex flex-col h-full px-6 py-6 md:px-10 md:py-8">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 mb-4 flex-shrink-0">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <DollarSign size={20} className="text-amber-700"/>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 uppercase tracking-wide">
                Módulo Financeiro (Faturamento)
              </h1>
              {totalAbertas > 0 && (
                <span className="text-xs font-bold bg-amber-500 text-white px-2.5 py-0.5 rounded-full">
                  {totalAbertas} {totalAbertas === 1 ? 'aberta' : 'abertas'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab */}
        <div className="flex gap-1 mb-4 flex-shrink-0">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border-b-2 border-indigo-600 text-indigo-700 text-sm font-semibold rounded-t-xl shadow-sm">
            <Receipt size={14}/> Faturamento & Contas Conveniadas
          </button>
        </div>

        {/* Layout split */}
        <div className="flex gap-5 flex-1 min-h-0 overflow-hidden">
          {/* Painel esquerdo */}
          <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
            {/* Filtro */}
            <div className="mb-3 flex-shrink-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Filtrar Proprietários</p>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Pesquisar por proprietário, CPF ou pet..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-400 bg-white"/>
              </div>
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-indigo-400"/>
                </div>
              ) : filtrados.length === 0 ? (
                <div className="text-center py-8">
                  <PawPrint size={28} className="mx-auto text-gray-200 mb-2"/>
                  <p className="text-xs text-gray-400">
                    {busca ? 'Nenhum resultado encontrado.' : 'Nenhum proprietário com animais vinculados.'}
                  </p>
                </div>
              ) : (
                filtrados.map(p => (
                  <CardProprietario
                    key={p.id} prop={p}
                    selecionado={selecionado?.id === p.id}
                    onClick={() => setSelecionado(p)}
                  />
                ))
              )}
            </div>

            {/* Footer lista */}
            <div className="flex-shrink-0 mt-3">
              <button
                onClick={carregar}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                <RefreshCw size={11}/> Atualizar Lista
              </button>
            </div>
          </div>

          {/* Painel direito */}
          {selecionado ? (
            <PainelFatura
              key={selecionado.id}
              prop={selecionado}
              onStatusChange={carregar}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                <DollarSign size={28} className="text-amber-400"/>
              </div>
              <p className="font-semibold text-gray-700 mb-1">Selecione um proprietário</p>
              <p className="text-sm text-gray-400 max-w-xs">
                Escolha um cliente na lista à esquerda para visualizar e gerenciar sua fatura consolidada.
              </p>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}