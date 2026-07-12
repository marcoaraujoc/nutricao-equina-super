// frontend/src/pages/Faturamento.tsx
// Módulo Financeiro — Faturamento por proprietário, consolidando todos os animais

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import { usePermissoes } from '../hooks/usePermissoes';
import {
  DollarSign, Search, Loader2, Trash2,
  Pencil, Check, X, RefreshCw, Receipt,
  CheckCircle2, AlertCircle, Ban, Share2, Download, Printer, ChevronDown,
} from 'lucide-react';
import { imprimirFatura, exportarFaturaCSV, compartilharFatura } from '../utils/FaturaExport';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type FaturaStatus = 'ABERTA' | 'PAGA' | 'CANCELADA' | 'FECHADA';
type ItemTipo     = 'ASSISTENCIA' | 'MEDICAMENTO' | 'PROCEDIMENTO';

interface AnimalResumo {
  id: number; nome: string; photoUrl?: string;
  especie?: { nome: string }; raca?: { nome: string };
}

interface FaturaItem {
  id: number; faturaId: number; animalId?: number; tipo: string;
  descricao: string; valor: number; quantidade: number;
  criadoEm?: string;
  veterinario?: { id: number; fullName: string };
  animal?: AnimalResumo;
}

interface Fatura {
  id: number; proprietarioId: number; mesReferencia?: string;
  total: number; status: FaturaStatus; criadoEm: string;
  itens: FaturaItem[];
  proprietario?: { id: number; fullName: string; email: string; phone?: string; valorAssistencia?: number; mensalista?: boolean };
}

interface FaturaResumo {
  id: number; total: number; status: FaturaStatus; mesReferencia?: string;
}

interface ProprietarioItem {
  id: number; fullName: string; email: string; phone?: string;
  valorAssistencia?: number; mensalista?: boolean;
  animais: AnimalResumo[];
  faturaAtiva?:   FaturaResumo | null;
  faturaFechada?: FaturaResumo | null;
  faturaPaga?:    FaturaResumo | null;
}

// ─── Catálogo de itens comuns ─────────────────────────────────────────────────

const CATALOGO: Array<{ label: string; tipo: ItemTipo; descricao: string; valor: number }> = [
  { label: 'GTA',                     tipo: 'ASSISTENCIA', descricao: 'GTA',                     valor: 0 },
  { label: 'Assistência Veterinária', tipo: 'ASSISTENCIA', descricao: 'Assistência Veterinária',  valor: 0 },
  { label: 'Atd. Emergencial',        tipo: 'ASSISTENCIA', descricao: 'Atd. Emergencial',         valor: 0 },
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
  if (status === 'FECHADA')   return <span className="flex items-center gap-1 text-xs font-bold text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full"><X size={11}/> FECHADA</span>;
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
  const fmtNum = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const parseCents = (raw: string) => parseInt(raw.replace(/\D/g, '') || '0', 10) / 100;

  const [editing,       setEditing]       = useState(false);
  const [desc,          setDesc]          = useState(item.descricao);
  const [tipo,          setTipo]          = useState(item.tipo);
  const [qty,           setQty]           = useState(String(item.quantidade));
  const [valorUnit,     setValorUnit]     = useState(item.valor);
  const [valorUnitStr,  setValorUnitStr]  = useState(fmtNum(item.valor));
  const [valorFinal,    setValorFinal]    = useState(item.valor * item.quantidade);
  const [valorFinalStr, setValorFinalStr] = useState(fmtNum(item.valor * item.quantidade));
  const [saving,        setSaving]        = useState(false);

  const handleUnitChange = (raw: string) => {
    const unit = parseCents(raw);
    setValorUnit(unit);
    setValorUnitStr(unit === 0 ? '' : fmtNum(unit));
    const q = Math.max(1, parseInt(qty) || 1);
    const final = unit * q;
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
  };

  const handleFinalChange = (raw: string) => {
    const final = parseCents(raw);
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
    const q = Math.max(1, parseInt(qty) || 1);
    const unit = final / q;
    setValorUnit(unit);
    setValorUnitStr(unit === 0 ? '' : fmtNum(unit));
  };

  const handleQtyChange = (raw: string) => {
    setQty(raw);
    const q = Math.max(1, parseInt(raw) || 1);
    const final = valorUnit * q;
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(item.id, { descricao: desc, valor: valorUnit, quantidade: Number(qty), tipo });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setDesc(item.descricao); setTipo(item.tipo);
    setQty(String(item.quantidade));
    setValorUnit(item.valor);     setValorUnitStr(fmtNum(item.valor));
    setValorFinal(item.valor * item.quantidade);
    setValorFinalStr(fmtNum(item.valor * item.quantidade));
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
          <input type="number" min="1" value={qty} onChange={e => handleQtyChange(e.target.value)}
            className="w-16 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />

          <label className="text-xs text-gray-500">Val. unit.</label>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400 bg-white">
            <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-1.5">R$</span>
            <input type="text" inputMode="decimal" value={valorUnitStr}
              onChange={e => handleUnitChange(e.target.value)}
              placeholder="0,00"
              className="w-24 px-2 py-1.5 text-sm focus:outline-none" />
          </div>

          <label className="text-xs text-gray-500">Valor final.</label>
          <div className="flex items-center border border-indigo-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 bg-indigo-50">
            <span className="px-1.5 text-xs text-indigo-400 bg-indigo-100 border-r border-indigo-200 py-1.5">R$</span>
            <input type="text" inputMode="decimal" value={valorFinalStr}
              onChange={e => handleFinalChange(e.target.value)}
              placeholder="0,00"
              className="w-28 px-2 py-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 focus:outline-none" />
          </div>

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
          {item.criadoEm && (
            <span className="mr-2 font-medium text-gray-500">
              {new Date(item.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </span>
          )}
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
  prop, onStatusChange, faturaId,
}: {
  prop: ProprietarioItem;
  onStatusChange: () => void;
  faturaId?: number;
}) {
  const { podeExecutar, isGestor } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('financeiro.faturas.editar');
  const podeLancar  = isGestor || podeExecutar('financeiro.faturas.lancar');
  const podeFechar  = isGestor || podeExecutar('financeiro.faturas.fechar');
  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [fatura,         setFatura]         = useState<Fatura | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [salvando,       setSalvando]       = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [logoUrl,        setLogoUrl]        = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Logo da empresa/equipe do proprietário para PDF/impressão/compartilhamento —
  // busca best-effort, nunca bloqueia a tela (fallback: marca S2Vet no template).
  useEffect(() => {
    api.get(`/clinica/faturas/proprietario/${prop.id}/logo-empresa`)
      .then(res => setLogoUrl(res.data?.dados?.logoUrl ?? null))
      .catch(() => setLogoUrl(null));
  }, [prop.id]);

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
    imprimirFatura(fatura, prop.animais, logoUrl);
    setShowExportMenu(false);
  };

  const handleCSV = () => {
    if (!fatura) return;
    exportarFaturaCSV(fatura, prop.animais);
    setShowExportMenu(false);
    toast.success('CSV gerado');
  };

  const [compartilhando, setCompartilhando] = useState(false);

  const handleShare = async () => {
    if (!fatura) return;
    setCompartilhando(true);
    try {
      await compartilharFatura(fatura, prop.animais, logoUrl);
    } catch {
      toast.error('Erro ao gerar PDF');
    } finally {
      setCompartilhando(false);
    }
  };

  // Formulário de novo item
  const [novoCatIdx,        setNovoCatIdx]        = useState<string>('');
  const [novoNome,          setNovoNome]          = useState('');
  const [novoTipo,          setNovoTipo]          = useState<ItemTipo>('ASSISTENCIA');
  const [novoQty,           setNovoQty]           = useState('1');
  const [novoValor,         setNovoValor]         = useState('0');
  const [novoValorDisplay,  setNovoValorDisplay]  = useState('0,00');
  const [lancando,          setLancando]          = useState(false);

  const [itemParaExcluir, setItemParaExcluir] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const url = faturaId
        ? `/clinica/faturas/proprietario/${prop.id}?faturaId=${faturaId}`
        : `/clinica/faturas/proprietario/${prop.id}`;
      const r = await api.get(url);
      setFatura(r.data.dados);
    } catch {
      toast.error('Erro ao carregar fatura');
    } finally {
      setLoading(false);
    }
  }, [prop.id, faturaId]);

  useEffect(() => { carregar(); }, [carregar]);

  // Remoção exige justificativa (registrada na Auditoria) — abre o modal padrão
  const handleDeleteItem = (itemId: number) => {
    if (!podeEditar) { semPermissao('remover item da fatura'); return; }
    setItemParaExcluir(itemId);
  };

  const confirmarExcluirItem = async (motivo: string) => {
    if (itemParaExcluir == null) return;
    try {
      const r = await api.delete(`/clinica/faturas/itens/${itemParaExcluir}`, { data: { motivo } });
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: prev.itens.filter(i => i.id !== itemParaExcluir),
      } : prev);
      setItemParaExcluir(null);
      toast.success('Item removido.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao remover item');
    }
  };

  const handleSaveItem = async (itemId: number, patch: Partial<FaturaItem>) => {
    if (!podeEditar) { semPermissao('editar item da fatura'); return; }
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
    if (idx === '') { setNovoNome(''); return; }
    const cat = CATALOGO[Number(idx)];
    setNovoNome(cat.descricao);
    setNovoTipo(cat.tipo);
    setNovoValor(String(cat.valor));
    setNovoValorDisplay(formatarValorFatura(cat.valor));
  };

  const formatarValorFatura = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const handleValorChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cents  = parseInt(digits || '0', 10);
    const value  = cents / 100;
    setNovoValor(String(value));
    setNovoValorDisplay(value === 0 ? '' : formatarValorFatura(value));
  };

  const handleLancar = async () => {
    if (!podeLancar) { semPermissao('lançar cobrança na fatura'); return; }
    if (!fatura) return;
    if (!novoNome.trim()) { toast.error('Informe a descrição do item'); return; }
    setLancando(true);
    try {
      const r = await api.post(`/clinica/faturas/${fatura.id}/itens`, {
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
      setNovoNome(''); setNovoCatIdx(''); setNovoQty('1'); setNovoValor('0'); setNovoValorDisplay('0,00');
      toast.success('Item lançado');
    } catch { toast.error('Erro ao lançar item'); }
    finally { setLancando(false); }
  };

  const handleStatus = async (status: FaturaStatus) => {
    if (status !== 'FECHADA' && !podeEditar) { semPermissao('alterar status da fatura'); return; }
    if (!fatura) return;
    setSalvando(true);
    try {
      const r = await api.patch(`/clinica/faturas/${fatura.id}/status`, { status });
      setFatura(r.data.dados);
      const MSG: Partial<Record<FaturaStatus, string>> = {
        PAGA:   'Fatura marcada como paga',
        ABERTA: 'Fatura reaberta',
      };
      toast.success(MSG[status] ?? 'Status atualizado');
      onStatusChange();
    } catch { toast.error('Erro ao atualizar status'); }
    finally { setSalvando(false); }
  };

  const handleFechar = async () => {
    if (!podeFechar) { semPermissao('fechar fatura'); return; }
    if (!fatura) return;
    setSalvando(true);
    try {
      const r = await api.patch(`/clinica/faturas/${fatura.id}/fechar`);
      setFatura(r.data.dados);
      toast.success('Fatura fechada — itens bloqueados para edição');
      onStatusChange();
    } catch { toast.error('Erro ao fechar fatura'); }
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
      {/* Header verde */}
      <div className="bg-emerald-600 rounded-2xl px-5 py-4 mb-4 flex-shrink-0">
        {/* Linha 1: label à esquerda, ações à direita */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <p className="text-[10px] font-bold text-emerald-100 uppercase tracking-widest">
            Extrato Ativo do Cliente
          </p>
          <div className="flex items-center gap-2">
            <StatusBadge status={fatura.status}/>
            {canEdit && (
              <>
                <button
                  onClick={handleFechar}
                  disabled={salvando}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors border border-white/20">
                  {salvando ? <Loader2 size={11} className="animate-spin"/> : <X size={11}/>}
                  Fechar Fatura
                </button>
                <button
                  onClick={() => handleStatus('PAGA')}
                  disabled={salvando}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors border border-white/30">
                  {salvando ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle2 size={11}/>}
                  Marcar como Pago
                </button>
              </>
            )}
            {fatura?.status === 'FECHADA' && (
              <>
                <button
                  onClick={() => handleStatus('ABERTA')}
                  disabled={salvando}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors border border-white/20">
                  {salvando ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>}
                  Reabrir
                </button>
                <button
                  onClick={() => handleStatus('PAGA')}
                  disabled={salvando}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 disabled:opacity-60 text-white text-xs font-bold rounded-xl transition-colors border border-white/30">
                  {salvando ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle2 size={11}/>}
                  Marcar como Pago
                </button>
              </>
            )}
            <button onClick={carregar} className="p-1.5 text-emerald-100 hover:text-white rounded-lg transition-colors">
              <RefreshCw size={13}/>
            </button>
          </div>
        </div>

        {/* Linha 2: nome */}
        <div className="flex items-center gap-2 mb-1">
          <Receipt size={15} className="text-emerald-200"/>
          <h2 className="text-lg font-bold text-white">{prop.fullName}</h2>
        </div>

        {/* Linha 3: fone/email à esquerda, faturamento à direita */}
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-emerald-100">
          <div className="flex items-center gap-3">
            {prop.phone && <span>Fone: <span className="text-white font-medium">{prop.phone}</span></span>}
            <span>· Email: <span className="text-white font-medium">{prop.email}</span></span>
          </div>
          <span>
            Faturamento total do mês:{' '}
            <span className="font-bold text-white">{formatMes(fatura.mesReferencia) || 'Mês atual'}</span>
            {' · '}
            <span className="font-mono">{invoiceRef}</span>
          </span>
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
            disabled={compartilhando}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#25D366] hover:bg-[#20BA5A] disabled:opacity-60 text-white rounded-lg text-xs font-semibold transition-colors">
            {compartilhando ? (
              <Loader2 size={13} className="animate-spin"/>
            ) : (
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            )}
            WhatsApp
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

      {/* Modal — remover item (justificativa obrigatória → Auditoria) */}
      <ModalJustificativa
        aberto={itemParaExcluir != null}
        titulo="Remover item da fatura?"
        descricao={(() => {
          const it = fatura?.itens.find(i => i.id === itemParaExcluir);
          return it ? `${it.descricao} — a remoção fica registrada como correção da fatura.` : undefined;
        })()}
        acaoLabel="Remover"
        onConfirmar={confirmarExcluirItem}
        onFechar={() => setItemParaExcluir(null)}
      />

      {/* Corpo da fatura */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-4 pr-1 pb-4">

        {/* Assistência e serviços gerais (sem animal) — sempre primeiro */}
        {(itensPorAnimal['sem'] ?? []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-sm font-bold text-gray-700">Assistência &amp; Serviços Gerais</p>
            </div>
            <div className="divide-y divide-gray-50">
              {(itensPorAnimal['sem'] ?? []).map((item: FaturaItem) => (
                <ItemRow key={item.id} item={item} canEdit={canEdit}
                  onDelete={handleDeleteItem} onSave={handleSaveItem}/>
              ))}
            </div>
          </div>
        )}

        {/* Seções por animal */}
        {prop.animais.map(animal => {
          const todosItens: FaturaItem[] = itensPorAnimal[animal.id] ?? [];
          const itensAssistencia = todosItens.filter(i => i.tipo === 'ASSISTENCIA');
          const itensOutros      = todosItens.filter(i => i.tipo !== 'ASSISTENCIA');
          const subtotal = todosItens.reduce((s: number, i: FaturaItem) => s + i.valor * i.quantidade, 0);

          return (
            <div key={animal.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* ── Informação do cavalo ── */}
              <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 bg-indigo-50/40">
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-2">
                  Informação do Cavalo
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {animal.photoUrl ? (
                      <img src={animal.photoUrl} alt={animal.nome}
                        className="w-10 h-10 rounded-xl object-cover flex-shrink-0"/>
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0 text-indigo-600 font-bold text-sm">
                        {animal.nome?.[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-bold text-gray-900">{animal.nome}</p>
                      <p className="text-[10px] text-gray-400">
                        {animal.especie?.nome}
                        {animal.raca?.nome ? ` · ${animal.raca.nome}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Subtotal</p>
                    <p className="text-sm font-bold text-gray-800">{formatBRL(subtotal)}</p>
                  </div>
                </div>
              </div>

              {/* ── Assistência & Serviços Gerais ── */}
              {itensAssistencia.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-blue-50/50 border-b border-gray-100">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                      Assistência &amp; Serviços Gerais
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {itensAssistencia.map(item => (
                      <ItemRow key={item.id} item={item} canEdit={canEdit}
                        onDelete={handleDeleteItem} onSave={handleSaveItem}/>
                    ))}
                  </div>
                </>
              )}

              {/* ── Itens da fatura ── */}
              {itensOutros.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50/70 border-y border-gray-100">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Itens da Fatura
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {itensOutros.map(item => (
                      <ItemRow key={item.id} item={item} canEdit={canEdit}
                        onDelete={handleDeleteItem} onSave={handleSaveItem}/>
                    ))}
                  </div>
                </>
              )}

              {todosItens.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-5">
                  Nenhum lançamento para este animal.
                </p>
              )}
            </div>
          );
        })}

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
              Lançar Novo Item / Cobrança na Fatura
            </p>
            <div className="mb-3">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Itens Frequentes</label>
              <select value={novoCatIdx} onChange={e => handleCatalogoChange(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                <option value="">— Selecione um item —</option>
                {CATALOGO.map((c, i) => (
                  <option key={i} value={i}>{c.label}</option>
                ))}
              </select>
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
                  <input
                    type="text"
                    inputMode="decimal"
                    value={novoValorDisplay}
                    onChange={e => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className="flex-1 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-r-xl"/>
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
                {lancando ? <Loader2 size={14} className="animate-spin"/> : null}
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
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selecionado
          ? 'bg-indigo-50 border-indigo-300 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
      }`}>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {prop.fullName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{prop.fullName}</p>
          <p className="text-[10px] text-gray-400 truncate">
            {prop.animais.map(a => a.nome).join(', ') || 'Sem animais'}
          </p>
        </div>
        {/* Bolinhas indicadoras de faturas existentes */}
        <div className="flex gap-1 flex-shrink-0">
          {prop.faturaAtiva   && <span className="w-2 h-2 rounded-full bg-amber-400" title="Fatura aberta"/>}
          {prop.faturaFechada && <span className="w-2 h-2 rounded-full bg-indigo-400" title="Fatura fechada"/>}
          {prop.faturaPaga    && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Fatura paga"/>}
        </div>
      </div>
    </button>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Faturamento() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();

  type FiltroTipo = 'ABERTA' | 'FECHADA' | 'PAGA';

  const [proprietarios, setProprietarios] = useState<ProprietarioItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [selecionado,   setSelecionado]   = useState<ProprietarioItem | null>(null);
  const [contadores,    setContadores]    = useState({ abertas: 0, fechadas: 0, pagas: 0 });
  const [filtroStatus,  setFiltroStatus]  = useState<FiltroTipo>('ABERTA');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/clinica/faturas/proprietarios');
      const lista: ProprietarioItem[] = r.data.dados ?? [];
      setProprietarios(lista);
      setContadores({
        abertas:  lista.filter(p => !!p.faturaAtiva).length,
        fechadas: lista.filter(p => !!p.faturaFechada).length,
        pagas:    lista.filter(p => !!p.faturaPaga).length,
      });
    } catch {
      toast.error('Erro ao carregar proprietários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  const filtrados = proprietarios.filter(p => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      p.fullName.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      p.animais.some(a => a.nome.toLowerCase().includes(q))
    );
  });

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('financeiro.faturas.ler')) return null;

  return (
    <PageContainer maxWidth="7xl">
      <div className="flex flex-col space-y-4">
        <BotaoVoltar className="mb-6" />

        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <DollarSign size={20} className="text-amber-700"/>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Faturamento</h1>
              <p className="text-sm text-gray-500">Faturas e contas conveniadas por proprietário</p>
            </div>
          </div>
          {contadores.abertas > 0 && (
            <span className="text-xs font-bold bg-amber-500 text-white px-2.5 py-0.5 rounded-full flex-shrink-0">
              {contadores.abertas} {contadores.abertas === 1 ? 'fatura aberta' : 'faturas abertas'}
            </span>
          )}
        </div>

        {/* Layout split */}
        <div className="flex gap-5 min-h-[520px] overflow-hidden">

          {/* ── Painel esquerdo — lista de proprietários ── */}
          <div className="w-60 flex-shrink-0 flex flex-col min-h-0">
            {/* Busca */}
            <div className="relative mb-3 flex-shrink-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar proprietário..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-400 bg-white"
              />
            </div>

            {/* Lista */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={18} className="animate-spin text-indigo-400"/>
                </div>
              ) : filtrados.length === 0 ? (
                <div className="text-center py-8">
                  <DollarSign size={28} className="mx-auto text-gray-200 mb-2"/>
                  <p className="text-xs text-gray-400">
                    {busca ? 'Nenhum resultado.' : 'Nenhum proprietário encontrado.'}
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

            {/* Atualizar */}
            <div className="flex-shrink-0 mt-3">
              <button
                onClick={carregar}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                <RefreshCw size={11}/> Atualizar
              </button>
            </div>
          </div>

          {/* ── Painel direito ── */}
          {selecionado ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden min-w-0">
              {/* Filtros de tipo de fatura no topo */}
              <div className="flex gap-2 mb-3 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Fatura:</p>
                {[
                  { key: 'ABERTA'  as FiltroTipo, label: 'Aberta',         cor: 'bg-amber-500',   existe: !!selecionado.faturaAtiva   },
                  { key: 'FECHADA' as FiltroTipo, label: 'Fechada',        cor: 'bg-indigo-600',  existe: !!selecionado.faturaFechada },
                  { key: 'PAGA'    as FiltroTipo, label: 'Paga',           cor: 'bg-emerald-600', existe: !!selecionado.faturaPaga    },
                ].map(({ key, label, cor, existe }) => (
                  <button
                    key={key}
                    onClick={() => setFiltroStatus(key)}
                    disabled={!existe}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      filtroStatus === key ? `${cor} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              <PainelFatura
                key={`${selecionado.id}-${filtroStatus}`}
                prop={selecionado}
                onStatusChange={carregar}
                faturaId={
                  filtroStatus === 'PAGA'    ? selecionado.faturaPaga?.id    :
                  filtroStatus === 'FECHADA' ? selecionado.faturaFechada?.id :
                  undefined
                }
              />
            </div>
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