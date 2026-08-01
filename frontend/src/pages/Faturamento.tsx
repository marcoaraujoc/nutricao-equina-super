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
  CheckCircle2, Download, Printer, ChevronDown, MessageCircle, Mail,
} from 'lucide-react';
import { imprimirFatura, exportarFaturaCSV, compartilharFatura } from '../utils/FaturaExport';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import InlineError from '../components/InlineError';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type FaturaStatus = 'ABERTA' | 'PAGA' | 'CANCELADA' | 'FECHADA' | 'ATRASADA';
type ItemTipo     = 'ASSISTENCIA' | 'MEDICAMENTO' | 'PROCEDIMENTO';
/** Desconto do item: percentual sobre o bruto ou abatimento em reais */
type DescontoTipo = 'PERCENTUAL' | 'VALOR';

interface AnimalResumo {
  id: number; nome: string; photoUrl?: string;
  especie?: { nome: string }; raca?: { nome: string };
}

interface FaturaItem {
  id: number; faturaId: number; animalId?: number; tipo: string;
  descricao: string; valor: number; quantidade: number;
  descontoTipo?: DescontoTipo | null; descontoValor?: number;
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
  faturaAtiva?:    FaturaResumo | null;
  faturaFechada?:  FaturaResumo | null;
  faturaAtrasada?: FaturaResumo | null;
  faturaPaga?:     FaturaResumo | null;
}

interface CatalogoItem {
  id: number; tipo: string; descricao: string; valor: number;
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
  OUTROS:       'bg-amber-100 text-amber-700',
};

// ─── Desconto do item (espelha lib/faturaUtils.js no backend) ─────────────────

/** Abatimento em R$ do item — PERCENTUAL incide sobre o bruto; VALOR é direto. */
function descontoDoItem(i: { valor: number; quantidade: number; descontoTipo?: DescontoTipo | null; descontoValor?: number }) {
  const bruto = i.valor * i.quantidade;
  const d     = Number(i.descontoValor ?? 0);
  if (!d || d <= 0) return 0;
  const abatimento = i.descontoTipo === 'PERCENTUAL' ? bruto * (Math.min(d, 100) / 100) : d;
  return Math.min(Math.max(abatimento, 0), Math.max(bruto, 0));
}

/** Valor do item que entra no total da fatura: bruto − desconto. */
function totalItem(i: { valor: number; quantidade: number; descontoTipo?: DescontoTipo | null; descontoValor?: number }) {
  return i.valor * i.quantidade - descontoDoItem(i);
}

// WhatsApp exige número internacional (Brasil: 55 + DDD + número).
function foneIntl(phone?: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

function montarTextoFatura(fatura: Fatura, prop: ProprietarioItem): string {
  return [
    `*Fatura — ${prop.fullName}*`,
    fatura.mesReferencia ? `Mês: ${formatMes(fatura.mesReferencia)}` : '',
    `Ref: INV-${String(fatura.id).padStart(3, '0')}`,
    `Total: ${formatBRL(fatura.total)}`,
  ].filter(Boolean).join('\n');
}

// Mês anterior no formato "YYYY-MM" (padrão do fechamento em lote)
function mesAnterior(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function montarTextoFaturaLote(nome: string, mesRef: string | undefined, faturaId: number, total: number): string {
  return [
    `*Fatura — ${nome}*`,
    mesRef ? `Mês: ${formatMes(mesRef)}` : '',
    `Ref: INV-${String(faturaId).padStart(3, '0')}`,
    `Total: ${formatBRL(total)}`,
  ].filter(Boolean).join('\n');
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
  // Desconto — tipo + valor. descTipo '' = sem desconto (limpa o campo ao salvar).
  // Percentual é exibido inteiro (10 = 10%); valor em R$ usa o formato monetário.
  const fmtDesc = (tipo: DescontoTipo | '' | null | undefined, v: number) =>
    !v ? '' : (tipo === 'PERCENTUAL' ? String(v) : fmtNum(v));
  const [descTipo,      setDescTipo]      = useState<DescontoTipo | ''>(item.descontoTipo ?? '');
  const [descValor,     setDescValor]     = useState(item.descontoValor ?? 0);
  const [descValorStr,  setDescValorStr]  = useState(fmtDesc(item.descontoTipo, item.descontoValor ?? 0));
  const [saving,        setSaving]        = useState(false);

  const descontoAtual = descontoDoItem(item);
  // Prévia do abatimento com o que está sendo editado (antes de salvar)
  const previaBruto    = valorUnit * Math.max(1, parseInt(qty) || 1);
  const previaDesconto = descontoDoItem({
    valor: valorUnit, quantidade: Math.max(1, parseInt(qty) || 1),
    descontoTipo: descTipo || null, descontoValor: descValor,
  });

  const handleDescValorChange = (raw: string) => {
    // Percentual é digitado direto (ex: 10 = 10%); em R$ vale a máscara de centavos
    const v = descTipo === 'PERCENTUAL'
      ? Math.min(100, Number(raw.replace(/\D/g, '') || '0'))
      : parseCents(raw);
    setDescValor(v);
    setDescValorStr(fmtDesc(descTipo, v));
  };

  const handleDescTipoChange = (t: DescontoTipo | '') => {
    setDescTipo(t);
    // Trocar de tipo zera o valor — 10% e R$ 10,00 não são a mesma coisa
    setDescValor(0);
    setDescValorStr('');
  };

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
    await onSave(item.id, {
      descricao: desc, valor: valorUnit, quantidade: Number(qty), tipo,
      descontoTipo:  descTipo || null,
      descontoValor: descTipo ? descValor : 0,
    });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setDesc(item.descricao); setTipo(item.tipo);
    setQty(String(item.quantidade));
    setValorUnit(item.valor);     setValorUnitStr(fmtNum(item.valor));
    setValorFinal(item.valor * item.quantidade);
    setValorFinalStr(fmtNum(item.valor * item.quantidade));
    setDescTipo(item.descontoTipo ?? '');
    setDescValor(item.descontoValor ?? 0);
    setDescValorStr(fmtDesc(item.descontoTipo, item.descontoValor ?? 0));
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
            <option value="OUTROS">OUTROS</option>
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

        {/* Desconto — percentual ou valor, sempre sobre o valor final do item */}
        <div className="flex gap-2 items-center flex-wrap pt-2 border-t border-indigo-100">
          <label className="text-xs text-gray-500">Desconto</label>
          <select value={descTipo} onChange={e => handleDescTipoChange(e.target.value as DescontoTipo | '')}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white">
            <option value="">Sem desconto</option>
            <option value="PERCENTUAL">Percentual (%)</option>
            <option value="VALOR">Valor (R$)</option>
          </select>

          {descTipo && (
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400 bg-white">
              <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-1.5">
                {descTipo === 'PERCENTUAL' ? '%' : 'R$'}
              </span>
              <input type="text" inputMode="decimal" value={descValorStr}
                onChange={e => handleDescValorChange(e.target.value)}
                placeholder={descTipo === 'PERCENTUAL' ? '0' : '0,00'}
                className="w-24 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
          )}

          <span className="text-xs text-gray-500">
            {previaDesconto > 0 && <>Abatimento: <b className="text-red-600">−{formatBRL(previaDesconto)}</b> · </>}
            Total: <b className="text-indigo-700">{formatBRL(previaBruto - previaDesconto)}</b>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 group hover:bg-gray-50/60 rounded-xl transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 mt-0.5 ${TIPO_COR[item.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
            {item.tipo}
          </span>
          <p className="text-sm text-gray-800 flex-1 min-w-0 break-words">{item.descricao}</p>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {item.criadoEm && (
            <span className="mr-2 font-medium text-gray-500">
              {new Date(item.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </span>
          )}
          Quant.: {item.quantidade} · Unitário: {formatBRL(item.valor)}
          {descontoAtual > 0 && (
            <span className="ml-2 text-red-500 font-medium">
              Desconto: {item.descontoTipo === 'PERCENTUAL' ? `${item.descontoValor}%` : formatBRL(item.descontoValor ?? 0)}
              {' '}(−{formatBRL(descontoAtual)})
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-700 whitespace-nowrap text-right">
          {descontoAtual > 0 && (
            <span className="block text-[10px] font-normal text-gray-400 line-through">
              {formatBRL(item.valor * item.quantidade)}
            </span>
          )}
          {formatBRL(totalItem(item))}
        </span>
        {canEdit && (
          <div className="flex gap-0.5">
            <button onClick={() => setEditing(true)} title="Editar item"
              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
              <Pencil size={14}/>
            </button>
            <button onClick={() => onDelete(item.id)} title="Excluir item"
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 size={14}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal — itens "Outros" do orçamento → fatura ────────────────────────────
// Só aparecem itens tipo OUTROS já APROVADOS e ainda não lançados. O backend só
// libera o lançamento depois que os demais itens do mesmo orçamento (medicamento/
// procedimento/vacina) tiverem sido importados numa evolução — aqui esses
// orçamentos aparecem bloqueados, com o nº de pendências.

interface OrcOutrosItem {
  id: number; descricao: string; quantidade: number;
  valorUnitario: number; valorTotal: number;
  animalId: number | null; animal?: { id: number; nome: string } | null;
}
interface OrcOutros {
  id: number; numeroFormatado: string;
  /** Itens clínicos do MESMO orçamento ainda não importados numa evolução.
   *  É AVISO, não bloqueio: o item "Outros" pode ser lançado assim mesmo. */
  pendentesClinicos: number; itens: OrcOutrosItem[];
}

function ModalImportarOrcamento({ proprietarioId, faturaId, onFechar, onLancado }: {
  proprietarioId: number;
  faturaId: number;
  onFechar: () => void;
  onLancado: () => void;
}) {
  const [orcamentos, setOrcamentos] = useState<OrcOutros[]>([]);
  const [loading, setLoading]       = useState(true);
  const [sel, setSel]               = useState<Set<number>>(new Set());
  const [lancando, setLancando]     = useState(false);
  const [erro, setErro]             = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.get('/orcamentos/outros-para-fatura', { params: { proprietarioId } })
      .then(r => { if (vivo) setOrcamentos(r.data?.dados ?? []); })
      .catch(() => { if (vivo) setOrcamentos([]); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [proprietarioId]);

  const toggle = (id: number) =>
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selecionados = orcamentos.flatMap(o => o.itens).filter(i => sel.has(i.id));
  const totalSel = selecionados.reduce((s, i) => s + i.valorTotal, 0);

  const lancar = async () => {
    if (selecionados.length === 0) { setErro('Selecione ao menos um item'); return; }
    setLancando(true);
    try {
      await api.post('/orcamentos/lancar-na-fatura', { faturaId, itemIds: [...sel] });
      toast.success(selecionados.length > 1 ? `${selecionados.length} itens lançados` : 'Item lançado na fatura');
      onLancado();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErro(e.response?.data?.error ?? 'Erro ao lançar os itens na fatura');
    } finally { setLancando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[90vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-emerald-600" />
            <h3 className="font-bold text-gray-900">Importar “Outros” do orçamento</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : orcamentos.length === 0 ? (
            <div className="text-center py-12 px-6 text-sm text-gray-400">
              Nenhum item “Outros” aprovado e pendente de lançamento para este cliente.
            </div>
          ) : orcamentos.map(o => (
            <div key={o.id} className="border-b border-gray-100">
              <div className="px-5 py-2 bg-gray-50 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-600">Orçamento #{o.numeroFormatado}</span>
                {/* AVISO, não bloqueio: importar item clínico numa evolução é opcional
                    (o orçamento inteiro é), então travar a cobrança do "Outros" nisso
                    deixava taxa/transporte impossível de faturar, sem saída na tela. */}
                {o.pendentesClinicos > 0 && (
                  <span className="text-[11px] text-amber-600">
                    {o.pendentesClinicos} item(ns) clínico(s) ainda não importado(s) em uma evolução
                  </span>
                )}
              </div>
              {o.itens.map(i => {
                const checked = sel.has(i.id);
                return (
                  <button key={i.id} onClick={() => toggle(i.id)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${checked ? 'bg-emerald-50/60' : 'hover:bg-gray-50'}`}>
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                      {checked && <Check size={13} className="text-white" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{i.descricao}</p>
                      <p className="text-[11px] text-gray-400">
                        {i.quantidade}x {formatBRL(i.valorUnitario)}
                        {i.animal?.nome ? ` · ${i.animal.nome}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{formatBRL(i.valorTotal)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <InlineError message={erro} className="mx-5 mt-3" />

        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onFechar} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <div className="flex-1" />
          {totalSel > 0 && <span className="text-sm text-gray-500">Total: <b className="text-gray-800">{formatBRL(totalSel)}</b></span>}
          <button onClick={lancar} disabled={lancando || selecionados.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
            {lancando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Lançar na fatura {selecionados.length > 0 ? `(${selecionados.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel direito — detalhe da fatura ──────────────────────────────────────

type MesFatura = { id: number; mesReferencia?: string; status: string };

function PainelFatura({
  prop, onStatusChange, faturaId, mes = null, onMeta,
}: {
  prop: ProprietarioItem;
  onStatusChange: () => void;
  faturaId?: number;
  mes?: string | null;
  onMeta?: (m: { meses: MesFatura[]; mesAtual?: string }) => void;
}) {
  const { podeExecutar, isGestor } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('financeiro.faturas.editar');
  const podeLancar  = isGestor || podeExecutar('financeiro.faturas.lancar');
  const podeFechar  = isGestor || podeExecutar('financeiro.faturas.fechar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

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
      setErroInline('Erro ao gerar PDF');
    } finally {
      setCompartilhando(false);
    }
  };

  // Formulário de novo item
  const [novoCatIdx,        setNovoCatIdx]        = useState<string>('');
  // Um único animal → já vem selecionado por padrão (sem precisar escolher).
  const [novoAnimalId,      setNovoAnimalId]      = useState<string>(prop.animais.length === 1 ? String(prop.animais[0].id) : '');
  const [novoNome,          setNovoNome]          = useState('');
  const [novoTipo,          setNovoTipo]          = useState<ItemTipo>('ASSISTENCIA');
  const [novoQty,           setNovoQty]           = useState('1');
  const [novoValor,         setNovoValor]         = useState('0');
  const [novoValorDisplay,  setNovoValorDisplay]  = useState('0,00');
  const [novoDescTipo,      setNovoDescTipo]      = useState<DescontoTipo | ''>('');
  const [novoDescValor,     setNovoDescValor]     = useState(0);
  const [novoDescDisplay,   setNovoDescDisplay]   = useState('');
  const [lancando,          setLancando]          = useState(false);
  // Modal de importação dos itens "Outros" aprovados no orçamento
  const [showImportOrc,     setShowImportOrc]     = useState(false);

  // Catálogo de itens frequentes (persistidos por empresa)
  const [catalogo,      setCatalogo]      = useState<CatalogoItem[]>([]);

  const [itemParaExcluir, setItemParaExcluir] = useState<number | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const q = mes
        ? `?mes=${mes}`
        : faturaId ? `?faturaId=${faturaId}` : '';
      const r = await api.get(`/clinica/faturas/proprietario/${prop.id}${q}`);
      setFatura(r.data.dados);
      onMeta?.({ meses: Array.isArray(r.data.meses) ? r.data.meses : [], mesAtual: r.data.dados?.mesReferencia });
    } catch {
      setErroInline('Erro ao carregar fatura');
    } finally {
      setLoading(false);
    }
  }, [prop.id, faturaId, mes, onMeta]);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarCatalogo = useCallback(async () => {
    try {
      const r = await api.get('/clinica/faturas/catalogo-itens');
      if (r.data) setCatalogo(r.data.dados ?? []);
    } catch { /* silencioso */ }
  }, []);
  useEffect(() => { carregarCatalogo(); }, [carregarCatalogo]);

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
      setErroInline(msg ?? 'Erro ao remover item');
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
    } catch { setErroInline('Erro ao salvar item'); }
  };

  // Itens fixos do código + itens frequentes salvos no backend
  const frequentes = [
    ...CATALOGO.map(c => ({ id: undefined as number | undefined, label: c.label, tipo: c.tipo, descricao: c.descricao, valor: c.valor })),
    ...catalogo.map(c => ({ id: c.id, label: c.descricao, tipo: c.tipo as ItemTipo, descricao: c.descricao, valor: c.valor })),
  ];

  const handleCatalogoChange = (idx: string) => {
    setNovoCatIdx(idx);
    if (idx === '') { setNovoNome(''); return; }
    const cat = frequentes[Number(idx)];
    if (!cat) return;
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

  // Desconto do lançamento: percentual é digitado direto (10 = 10%); R$ usa centavos
  const handleNovoDescValor = (raw: string) => {
    const v = novoDescTipo === 'PERCENTUAL'
      ? Math.min(100, Number(raw.replace(/\D/g, '') || '0'))
      : parseInt(raw.replace(/\D/g, '') || '0', 10) / 100;
    setNovoDescValor(v);
    setNovoDescDisplay(v === 0 ? '' : (novoDescTipo === 'PERCENTUAL' ? String(v) : formatarValorFatura(v)));
  };

  const novoBruto    = Number(novoValor) * Number(novoQty || 1);
  const novoDesconto = descontoDoItem({
    valor: Number(novoValor), quantidade: Number(novoQty || 1),
    descontoTipo: novoDescTipo || null, descontoValor: novoDescValor,
  });

  const handleLancar = async () => {
    if (!podeLancar) { semPermissao('lançar cobrança na fatura'); return; }
    if (!fatura) return;
    if (!novoNome.trim()) { setErroInline('Informe a descrição do item'); return; }
    setLancando(true);
    try {
      const r = await api.post(`/clinica/faturas/${fatura.id}/itens`, {
        tipo:          novoTipo,
        descricao:     novoNome.trim(),
        valor:         Number(novoValor),
        quantidade:    Number(novoQty),
        animalId:      novoAnimalId ? Number(novoAnimalId) : undefined,
        descontoTipo:  novoDescTipo || null,
        descontoValor: novoDescTipo ? novoDescValor : 0,
      });
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: [...prev.itens, r.data.dados],
      } : prev);

      // Item digitado manualmente (não veio dos frequentes) → adiciona automaticamente
      // aos Itens Frequentes para reuso. Ignora se já existir descrição igual.
      const desc = novoNome.trim();
      const jaExiste = frequentes.some(f => f.descricao.trim().toLowerCase() === desc.toLowerCase());
      if (!novoCatIdx && desc && !jaExiste) {
        try {
          // Salva só o NOME do item frequente (sem valor — informado a cada lançamento).
          await api.post('/clinica/faturas/catalogo-itens', { tipo: novoTipo, descricao: desc, valor: 0 });
          carregarCatalogo();
        } catch { /* silencioso — não impede o lançamento */ }
      }

      setNovoNome(''); setNovoCatIdx('');
      setNovoAnimalId(prop.animais.length === 1 ? String(prop.animais[0].id) : '');
      setNovoQty('1'); setNovoValor('0'); setNovoValorDisplay('0,00');
      setNovoDescTipo(''); setNovoDescValor(0); setNovoDescDisplay('');
      toast.success('Item lançado');
    } catch { setErroInline('Erro ao lançar item'); }
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
    } catch { setErroInline('Erro ao atualizar status'); }
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
    } catch { setErroInline('Erro ao fechar fatura'); }
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

  // A fatura é do PROPRIETÁRIO (não é escopada por empresa), mas a lista de animais
  // é a da clínica ativa. Itens de um animal fora dessa lista (outra clínica atende o
  // mesmo cliente) ganham uma seção própria — sem isto eles simplesmente sumiam da tela.
  const idsDoEscopo = new Set(prop.animais.map(a => a.id));
  const animaisForaDoEscopo = Object.entries(itensPorAnimal)
    .filter(([key]) => key !== 'sem' && !idsDoEscopo.has(Number(key)))
    .map(([key, itens]) => ({
      id:    Number(key),
      nome:  itens?.[0]?.animal?.nome ?? `Animal #${key}`,
      itens: itens ?? [],
    }));

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
    <div className="flex-1 flex flex-col min-h-0 lg:overflow-hidden min-w-0">
      <InlineError message={erroInline} className="mb-3 flex-shrink-0" />

      {/* Card do cliente — SOMENTE proprietário + fatura (ações ficam fora) */}
      <div className="bg-emerald-600 rounded-2xl px-5 py-4 mb-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Receipt size={15} className="text-emerald-200 flex-shrink-0"/>
          <h2 className="text-lg font-bold text-white break-words">{prop.fullName}</h2>
        </div>
        <div className="text-xs text-emerald-50 space-y-0.5">
          {prop.phone && <p>Telefone: <span className="text-white font-medium">{prop.phone}</span></p>}
          <p className="break-all">E-mail: <span className="text-white font-medium">{prop.email}</span></p>
        </div>
        <div className="mt-2.5 pt-2.5 border-t border-white/15 text-xs text-emerald-100 text-right">
          Fatura Mês:{' '}
          <span className="font-bold text-white">{formatMes(fatura.mesReferencia) || 'Mês atual'}</span>
          {' · '}
          <span className="font-mono">{invoiceRef}</span>
        </div>
      </div>

      {/* Ações da fatura — FORA do card */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3 flex-shrink-0">
        {(fatura.status === 'FECHADA' || fatura.status === 'ATRASADA') && (
          <button onClick={() => handleStatus('ABERTA')} disabled={salvando}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-60 transition-colors">
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>} Reabrir
          </button>
        )}
        {canEdit && (
          <button onClick={handleFechar} disabled={salvando}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-60 transition-colors">
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <Check size={13}/>} Fechar Fatura
          </button>
        )}
        {(canEdit || fatura.status === 'FECHADA' || fatura.status === 'ATRASADA') && (
          <button onClick={() => handleStatus('PAGA')} disabled={salvando}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-60 transition-colors">
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle2 size={11}/>} Marcar como Pago
          </button>
        )}
        <button onClick={() => abrirEmail(`Fatura — ${prop.fullName}`, montarTextoFatura(fatura, prop), prop.email)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors">
          <Mail size={13}/> E-mail
        </button>
        <button onClick={handleShare} disabled={compartilhando}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-60 transition-colors">
          {compartilhando ? <Loader2 size={13} className="animate-spin"/> : <MessageCircle size={13}/>} WhatsApp
        </button>
        <button onClick={handlePDF}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors">
          <Printer size={13}/> Imprimir
        </button>
        <div className="relative" ref={exportMenuRef}>
          <button onClick={() => setShowExportMenu(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-50 transition-colors">
            <Download size={13}/> Exportar <ChevronDown size={11}/>
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
              <button onClick={handleCSV}
                className="w-full text-left px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <Download size={13}/> CSV (.csv)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal — itens "Outros" aprovados no orçamento → fatura */}
      {showImportOrc && (
        <ModalImportarOrcamento
          proprietarioId={prop.id}
          faturaId={fatura.id}
          onFechar={() => setShowImportOrc(false)}
          onLancado={() => { setShowImportOrc(false); carregar(); }}
        />
      )}

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
      <div className="flex-1 lg:overflow-y-auto overflow-x-hidden space-y-4 pr-1 pb-4">

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
          const subtotal = todosItens.reduce((s: number, i: FaturaItem) => s + totalItem(i), 0);

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

        {/* Animais atendidos por OUTRA clínica do mesmo cliente — a fatura é única do
            proprietário, então os lançamentos aparecem aqui em vez de sumirem. */}
        {animaisForaDoEscopo.map(grupo => (
          <div key={`fora-${grupo.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 bg-gray-50">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                Informação do Cavalo
              </p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">{grupo.nome}</p>
                  <p className="text-[10px] text-gray-400">Lançamentos de outro atendimento deste cliente</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">Subtotal</p>
                  <p className="text-sm font-bold text-gray-800">
                    {formatBRL(grupo.itens.reduce((s, i) => s + totalItem(i), 0))}
                  </p>
                </div>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {grupo.itens.map(item => (
                <ItemRow key={item.id} item={item} canEdit={canEdit}
                  onDelete={handleDeleteItem} onSave={handleSaveItem}/>
              ))}
            </div>
          </div>
        ))}

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
            <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Lançar Novo Item / Cobrança na Fatura
              </p>
              {podeLancar && (
                <button onClick={() => setShowImportOrc(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Receipt size={13}/> Importar do orçamento
                </button>
              )}
            </div>
            <div className="mb-3">
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Itens Frequentes <span className="text-gray-400 font-normal">(atalho — opcional)</span>
              </label>
              <select value={novoCatIdx} onChange={e => handleCatalogoChange(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                <option value="">— Escolha um item —</option>
                {frequentes.map((c, i) => (
                  <option key={i} value={i}>{c.label}{c.valor ? ` — ${formatBRL(c.valor)}` : ''}</option>
                ))}
              </select>
            </div>
            {/* Tipo + Descrição — lançamento DIRETO (não precisa salvar como frequente antes) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Tipo</label>
                <select value={novoTipo} onChange={e => setNovoTipo(e.target.value as ItemTipo)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                  <option value="ASSISTENCIA">Assistência</option>
                  <option value="MEDICAMENTO">Medicamento</option>
                  <option value="PROCEDIMENTO">Procedimento</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Descrição <span className="text-red-400">*</span>
                </label>
                <input value={novoNome} onChange={e => { setNovoNome(e.target.value); setNovoCatIdx(''); }}
                  placeholder="Descreva o item ou cobrança"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
              </div>
            </div>

            {/* Animal — com 1 animal já vem selecionado; com vários, escolher (opcional) */}
            {prop.animais.length === 1 ? (
              <p className="text-[11px] text-gray-500 mb-3">
                Animal: <span className="font-semibold text-gray-700">{prop.animais[0].nome}</span>
              </p>
            ) : prop.animais.length > 1 ? (
              <div className="mb-3">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Animal</label>
                <select value={novoAnimalId} onChange={e => setNovoAnimalId(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                  <option value="">— Geral (sem animal) —</option>
                  {prop.animais.map(a => (
                    <option key={a.id} value={a.id}>{a.nome}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
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
              {/* Desconto — percentual ou valor sobre o total do item */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Desconto</label>
                <div className="flex gap-1.5">
                  <select value={novoDescTipo}
                    onChange={e => { setNovoDescTipo(e.target.value as DescontoTipo | ''); setNovoDescValor(0); setNovoDescDisplay(''); }}
                    className="border border-gray-300 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="">Não</option>
                    <option value="PERCENTUAL">%</option>
                    <option value="VALOR">R$</option>
                  </select>
                  {novoDescTipo && (
                    <input type="text" inputMode="decimal" value={novoDescDisplay}
                      onChange={e => handleNovoDescValor(e.target.value)}
                      placeholder={novoDescTipo === 'PERCENTUAL' ? '0' : '0,00'}
                      className="flex-1 min-w-0 border border-gray-300 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
                  )}
                </div>
              </div>
              {/* Subtotal preview */}
              <div className="text-center">
                <p className="text-[10px] text-gray-400 mb-1">Total do item</p>
                <p className="text-sm font-bold text-gray-700">{formatBRL(novoBruto - novoDesconto)}</p>
                {novoDesconto > 0 && (
                  <p className="text-[10px] text-red-500">−{formatBRL(novoDesconto)}</p>
                )}
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
          {prop.faturaAtiva    && <span className="w-2 h-2 rounded-full bg-amber-400" title="Fatura aberta"/>}
          {prop.faturaFechada  && <span className="w-2 h-2 rounded-full bg-indigo-400" title="Fatura fechada"/>}
          {prop.faturaAtrasada && <span className="w-2 h-2 rounded-full bg-red-500" title="Fatura atrasada"/>}
          {prop.faturaPaga     && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Fatura paga"/>}
        </div>
      </div>
    </button>
  );
}

// ─── Modal — Fechar mês em lote + envio ──────────────────────────────────────

interface FechadaLote {
  faturaId: number; total: number; mesReferencia?: string;
  proprietario: { id: number; fullName: string; phone?: string; email: string };
}

function ModalFechamentoLote({ proprietarios, onClose, onDone }: {
  proprietarios: ProprietarioItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mes,       setMes]       = useState(mesAnterior());
  const [fechando,  setFechando]  = useState(false);
  const [resultado, setResultado] = useState<FechadaLote[] | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const abertasDoMes = proprietarios.filter(p => p.faturaAtiva?.mesReferencia === mes);

  const fechar = async () => {
    const ids = abertasDoMes.map(p => p.faturaAtiva!.id);
    if (ids.length === 0) { setErroInline('Nenhuma fatura aberta neste mês'); return; }
    setFechando(true);
    try {
      const r = await api.post('/clinica/faturas/fechar-lote', { faturaIds: ids });
      setResultado((r.data?.dados?.fechadas ?? []) as FechadaLote[]);
      toast.success(`${r.data?.dados?.total ?? 0} fatura(s) fechada(s)`);
      onDone();
    } catch { setErroInline('Erro ao fechar faturas'); }
    finally { setFechando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">Fechar mês em lote</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!resultado ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Mês de referência</label>
                <input type="month" value={mes} onChange={e => setMes(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-800">
                  {abertasDoMes.length} fatura(s) aberta(s) em {formatMes(mes) || mes}
                </p>
                {abertasDoMes.length > 0 && (
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {abertasDoMes.map(p => (
                      <li key={p.id} className="flex justify-between gap-2 text-xs text-amber-900">
                        <span className="truncate">{p.fullName}</span>
                        <span className="font-semibold flex-shrink-0">{formatBRL(p.faturaAtiva!.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={fechar} disabled={fechando || abertasDoMes.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors">
                {fechando ? <Loader2 size={15} className="animate-spin"/> : <Check size={15}/>}
                Fechar {abertasDoMes.length} fatura(s) do mês
              </button>
            </>
          ) : (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-emerald-800">
                  {resultado.length} fatura(s) fechada(s). Envie para os proprietários:
                </p>
              </div>
              <p className="text-[11px] text-gray-400">
                O WhatsApp abre uma conversa por vez — toque em cada proprietário para enviar a mensagem já pronta.
              </p>
              {resultado.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma fatura foi fechada.</p>
              ) : (
                <div className="space-y-2">
                  {resultado.map(f => {
                    const texto = montarTextoFaturaLote(f.proprietario.fullName, f.mesReferencia, f.faturaId, f.total);
                    return (
                      <div key={f.faturaId} className="flex items-center gap-2 border border-gray-100 rounded-xl px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{f.proprietario.fullName}</p>
                          <p className="text-[11px] text-gray-400">{formatBRL(f.total)}</p>
                        </div>
                        {f.proprietario.phone && (
                          <button onClick={() => abrirWhatsApp(texto, foneIntl(f.proprietario.phone))}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#25D366] hover:bg-[#20BA5A] text-white rounded-lg text-xs font-semibold transition-colors">
                            <MessageCircle size={12}/> WhatsApp
                          </button>
                        )}
                        <button onClick={() => abrirEmail(`Fatura — ${f.proprietario.fullName}`, texto, f.proprietario.email)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-semibold transition-colors">
                          <Mail size={12}/> E-mail
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Faturamento() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();

  type FiltroTipo = 'ABERTA' | 'FECHADA' | 'ATRASADA' | 'PAGA';

  const [proprietarios, setProprietarios] = useState<ProprietarioItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [selecionado,   setSelecionado]   = useState<ProprietarioItem | null>(null);
  const [contadores,    setContadores]    = useState({ abertas: 0, fechadas: 0, pagas: 0 });
  const [filtroStatus,  setFiltroStatus]  = useState<FiltroTipo>('ABERTA');
  // Seletor de mês/ano (só para fatura FECHADA/PAGA) — controla o mês visualizado.
  const [mesView,       setMesView]       = useState<string | null>(null);
  const [faturaMeta,    setFaturaMeta]    = useState<{ meses: MesFatura[]; mesAtual?: string }>({ meses: [] });
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const [showLote,       setShowLote]       = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const seletorRef = useRef<HTMLDivElement>(null);

  const podeFecharLote = isGestor || podeExecutar('financeiro.faturas.fechar');

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
      setErroInline('Erro ao carregar proprietários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  // Trocar de proprietário volta TODOS os filtros ao padrão (status Aberta, sem mês).
  useEffect(() => { setFiltroStatus('ABERTA'); setMesView(null); }, [selecionado?.id]);
  // Trocar o tipo de fatura reseta o mês visualizado.
  useEffect(() => { setMesView(null); }, [filtroStatus]);

  // Fecha o dropdown do seletor ao clicar fora
  useEffect(() => {
    if (!dropdownAberto) return;
    const handler = (e: MouseEvent) => {
      if (seletorRef.current && !seletorRef.current.contains(e.target as Node)) setDropdownAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownAberto]);

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

        <InlineError message={erroInline} />

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
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0 ml-auto">
            {contadores.abertas > 0 && (
              <span className="text-sm font-semibold text-amber-600">
                {contadores.abertas} {contadores.abertas === 1 ? 'fatura aberta' : 'faturas abertas'}
              </span>
            )}
            {podeFecharLote && (
              <button
                onClick={() => setShowLote(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors">
                <Check size={13}/> Fechar todas Faturas
              </button>
            )}
          </div>
        </div>

        {/* Mobile/tablet: seletor de proprietário (no desktop usa a lista à esquerda) */}
        <div className="lg:hidden relative" ref={seletorRef}>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Proprietário</label>
          <button
            type="button"
            onClick={() => setDropdownAberto(v => !v)}
            className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm bg-white hover:border-indigo-300 focus:outline-none focus:border-indigo-400 transition-colors">
            {selecionado ? (
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                  {selecionado.fullName[0]?.toUpperCase()}
                </span>
                <span className="font-semibold text-gray-900 truncate">{selecionado.fullName}</span>
              </span>
            ) : (
              <span className="text-gray-400">Selecione um proprietário…</span>
            )}
            <ChevronDown size={16} className={`text-gray-400 flex-shrink-0 transition-transform ${dropdownAberto ? 'rotate-180' : ''}`}/>
          </button>

          {dropdownAberto && (
            <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[70vh]">
              {/* Busca */}
              <div className="relative p-2 border-b border-gray-100 flex-shrink-0">
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input
                  autoFocus
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar proprietário..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 bg-white"
                />
              </div>
              {/* Lista */}
              <div className="overflow-y-auto p-1.5 space-y-1.5">
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
                      onClick={() => { setSelecionado(p); setDropdownAberto(false); setBusca(''); }}
                    />
                  ))
                )}
              </div>
              {/* Atualizar */}
              <div className="p-2 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={carregar}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                  <RefreshCw size={11}/> Atualizar lista
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Split: lista de proprietários (só desktop) + detalhe (compartilhado com o mobile) */}
        <div className="lg:flex lg:gap-5 lg:items-start">

          {/* Lista de proprietários — só desktop (mobile/tablet usa o seletor acima) */}
          <div className="hidden lg:flex lg:w-60 lg:flex-shrink-0 flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-120px)]">
            <div className="relative mb-3 flex-shrink-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar proprietário..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-400 bg-white"/>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-indigo-400"/></div>
              ) : filtrados.length === 0 ? (
                <div className="text-center py-8">
                  <DollarSign size={28} className="mx-auto text-gray-200 mb-2"/>
                  <p className="text-xs text-gray-400">{busca ? 'Nenhum resultado.' : 'Nenhum proprietário encontrado.'}</p>
                </div>
              ) : (
                filtrados.map(p => (
                  <CardProprietario key={p.id} prop={p} selecionado={selecionado?.id === p.id} onClick={() => setSelecionado(p)}/>
                ))
              )}
            </div>
            <div className="flex-shrink-0 mt-3">
              <button onClick={carregar}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                <RefreshCw size={11}/> Atualizar
              </button>
            </div>
          </div>

          {/* Detalhe da fatura — compartilhado (mobile: abaixo do seletor; desktop: à direita) */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selecionado ? (
              <>
                {/* Filtros de tipo de fatura + seletor de mês/ano (só p/ Fechada/Paga) */}
                <div className="flex items-center gap-2 mb-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2.5 overflow-x-auto">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Fatura:</p>
                  {[
                    { key: 'ABERTA'   as FiltroTipo, label: 'Aberta',   cor: 'bg-amber-500',   existe: !!selecionado.faturaAtiva    },
                    { key: 'FECHADA'  as FiltroTipo, label: 'Fechada',  cor: 'bg-indigo-600',  existe: !!selecionado.faturaFechada  },
                    { key: 'ATRASADA' as FiltroTipo, label: 'Atrasada', cor: 'bg-red-600',     existe: !!selecionado.faturaAtrasada },
                    { key: 'PAGA'     as FiltroTipo, label: 'Paga',     cor: 'bg-emerald-600', existe: !!selecionado.faturaPaga     },
                  ].map(({ key, label, cor, existe }) => (
                    <button
                      key={key}
                      onClick={() => { setFiltroStatus(key); setMesView(null); }}
                      disabled={!existe}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        filtroStatus === key ? `${cor} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {label}
                    </button>
                  ))}
                  {(filtroStatus === 'FECHADA' || filtroStatus === 'ATRASADA' || filtroStatus === 'PAGA') &&
                    faturaMeta.meses.filter(m => m.status === filtroStatus).length > 0 && (
                    <select value={mesView ?? faturaMeta.mesAtual ?? ''}
                      onChange={e => setMesView(e.target.value)}
                      className="ml-auto border border-gray-300 rounded-lg px-2.5 py-1 text-[11px] bg-white focus:outline-none focus:border-indigo-400">
                      {faturaMeta.meses.filter(m => m.status === filtroStatus).map(m => (
                        <option key={m.id} value={m.mesReferencia ?? ''}>{formatMes(m.mesReferencia) || 'Mês atual'}</option>
                      ))}
                    </select>
                  )}
                </div>

                <PainelFatura
                  key={`${selecionado.id}-${filtroStatus}`}
                  prop={selecionado}
                  onStatusChange={carregar}
                  mes={mesView}
                  onMeta={setFaturaMeta}
                  faturaId={
                    filtroStatus === 'PAGA'     ? selecionado.faturaPaga?.id     :
                    filtroStatus === 'ATRASADA' ? selecionado.faturaAtrasada?.id :
                    filtroStatus === 'FECHADA'  ? selecionado.faturaFechada?.id  :
                    undefined
                  }
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                  <DollarSign size={28} className="text-amber-400"/>
                </div>
                <p className="font-semibold text-gray-700 mb-1">Selecione um proprietário</p>
                <p className="text-sm text-gray-400 max-w-xs">
                  Escolha um proprietário para visualizar a fatura consolidada.
                </p>
              </div>
            )}
          </div>
        </div>

        {showLote && (
          <ModalFechamentoLote
            proprietarios={proprietarios}
            onClose={() => setShowLote(false)}
            onDone={carregar}
          />
        )}
      </div>
    </PageContainer>
  );
}