// src/pages/Atendimento.tsx
// Módulo Clínico — Sub-aba Evolução Clínica

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Plus, Pencil, Trash2, Printer, Mic, MicOff, Square,
  Check, X, ChevronLeft, ChevronRight, AlertTriangle,
  Stethoscope, Pill, Syringe, FlaskConical, Share2,
  FileText, ReceiptText, CheckCircle2, Loader2, WifiOff,
  Calendar, User, Filter, Search, Eye, Ban,
} from 'lucide-react';
import AnimalCard  from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import {
  isMobile     as detectarMobile,
  estaOnline,
  carregarModelo,
  transcreverOffline,
} from '../services/whisperService';
import PageContainer from '../components/PageContainer';

// ─── Speech Recognition types ────────────────────────────────────────────────

interface ISpeechRecognition extends EventTarget {
  continuous:     boolean;
  interimResults: boolean;
  lang:           string;
  onresult: ((event: ISpeechRecognitionEvent) => void) | null;
  onend:    (() => void) | null;
  onerror:  ((event: ISpeechRecognitionErrorEvent) => void) | null;
  start: () => void;
  stop:  () => void;
  abort: () => void;
}
interface ISpeechRecognitionEvent extends Event {
  resultIndex: number;
  results:     SpeechRecognitionResultList;
}
interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
}
declare global {
  interface Window {
    SpeechRecognition:       new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
  }
}

// ─── Domain types ─────────────────────────────────────────────────────────────

type SelectedAnimal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;

type AnimalExtended = SelectedAnimal & {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
  raca?:           { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
};

type EvolucaoStatus = 'EM_ANDAMENTO' | 'FINALIZADA' | 'CANCELADA';
type TipoFatura     = 'PROCEDIMENTO' | 'MEDICAMENTO' | 'EXAME' | 'ENCAMINHAMENTO' | 'VACINA';
type SubModulo      = 'evolucao' | 'prescricao' | 'vacina' | 'exames' | 'encaminhamento';

interface Vet { id: number; fullName: string }

interface EvolucaoItem {
  id:               number;
  animalId:         number;
  veterinarioId:    number;
  veterinario:      Vet;
  modificadoPorId?: number | null;
  modificadoPor?:   Vet | null;
  especialidade:    string;
  status:           EvolucaoStatus;
  texto:            string;
  resumo?:          string | null; // gerado pela LLM após finalizar
  dataInicio:       string;
  dataFim?:         string | null;
  dataModificacao?: string | null;
  ativo:            boolean;
  aprovado:         boolean;
}

interface FaturaItem {
  id:          number;
  faturaId:    number;
  tipo:        TipoFatura;
  descricao:   string;
  valor:       number;
  quantidade:  number;
  veterinario: { fullName: string };
  criadoEm:    string;
}

interface Fatura {
  id:       number;
  animalId: number;
  total:    number;
  status:   string;
  itens:    FaturaItem[];
}

interface AcaoLLM {
  tipo:          TipoFatura;
  descricao:     string;
  valorEstimado: number;
  quantidade:    number;
}

interface AcaoSelecionavel extends AcaoLLM { selecionada: boolean }

interface FormEvolucao {
  especialidade: string;
  texto:         string;
  status:        EvolucaoStatus;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ESPECIALIDADES = [
  'Acupuntura', 'Cardiologia', 'Cirurgia', 'Clínico',
  'Dermatologia', 'Diagnóstico por Imagem', 'Fisioterapia',
  'Neurologia', 'Nutrição', 'Oftalmologia', 'Patologia', 'Quiropraxia',
] as const;

const STATUS_OPTIONS: { value: EvolucaoStatus; label: string }[] = [
  { value: 'EM_ANDAMENTO', label: 'Em Andamento' },
  { value: 'FINALIZADA',   label: 'Finalizada'   },
  { value: 'CANCELADA',    label: 'Cancelada'    },
];

const SUB_MODULOS: { key: SubModulo; label: string; icon: React.ReactNode }[] = [
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

const STATUS_CONFIG: Record<EvolucaoStatus, { label: string; cls: string }> = {
  EM_ANDAMENTO: { label: 'Em Andamento', cls: 'bg-blue-100 text-blue-700'       },
  FINALIZADA:   { label: 'Finalizada',   cls: 'bg-emerald-100 text-emerald-700' },
  CANCELADA:    { label: 'Cancelada',    cls: 'bg-red-100 text-red-700'         },
};

const FORM_INICIAL: FormEvolucao = { especialidade: 'Clínico', texto: '', status: 'EM_ANDAMENTO' };
const LIMIT_OPTIONS = [10, 20, 50];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatarData = (data: string | null | undefined): string => {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatarDataHora = (data: string | null | undefined): string => {
  if (!data) return '—';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const getIniciais = (nome: string): string => {
  const p = nome.trim().split(' ').filter(Boolean);
  return p.length === 1
    ? p[0].substring(0, 2).toUpperCase()
    : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const printEvolucao = (ev: EvolucaoItem, animal: AnimalExtended | null) => {
  const pw = window.open('', '_blank', 'width=800,height=600');
  if (!pw) { toast.error('Popup bloqueado. Permita popups para imprimir.'); return; }
  pw.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Evolução Clínica — S2Vet</title>
<style>
  body{font-family:Arial,sans-serif;padding:32px;color:#111}
  h1{font-size:18px;font-weight:700;margin-bottom:4px}
  .sub{font-size:12px;color:#666;margin-bottom:24px}
  .card{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .lbl{font-size:11px;color:#9ca3af;display:block}
  .val{font-size:13px;font-weight:600}
  .texto{white-space:pre-wrap;font-size:13px;line-height:1.7;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-top:16px}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#dbeafe;color:#1d4ed8}
  @media print{body{padding:16px}}
</style></head><body>
<h1>S2Vet — Evolução Clínica</h1>
<div class="sub">Gerado em ${new Date().toLocaleString('pt-BR')}</div>
${animal ? `<div class="card"><div class="grid">
  <div><span class="lbl">Animal</span><span class="val">${animal.nome}</span></div>
  <div><span class="lbl">Raça</span><span class="val">${animal.raca?.nome ?? '—'}</span></div>
  <div><span class="lbl">Proprietário</span><span class="val">${animal.user?.fullName ?? '—'}</span></div>
</div></div>` : ''}
<div class="card"><div class="grid">
  <div><span class="lbl">Especialidade</span><span class="val">${ev.especialidade}</span></div>
  <div><span class="lbl">Status</span><span class="badge">${STATUS_CONFIG[ev.status].label}</span></div>
  <div><span class="lbl">Data de Início</span><span class="val">${formatarDataHora(ev.dataInicio)}</span></div>
  ${ev.dataFim ? `<div><span class="lbl">Data de Fim</span><span class="val">${formatarDataHora(ev.dataFim)}</span></div>` : ''}
  <div><span class="lbl">Responsável</span><span class="val">${ev.veterinario.fullName}</span></div>
  ${ev.modificadoPor ? `<div><span class="lbl">Modificado por</span><span class="val">${ev.modificadoPor.fullName}</span></div>` : ''}
  ${ev.dataModificacao ? `<div><span class="lbl">Modificação</span><span class="val">${formatarDataHora(ev.dataModificacao)}</span></div>` : ''}
</div>
<div class="texto">${ev.texto}</div></div>
<script>window.print();window.onafterprint=()=>window.close();<\/script>
</body></html>`);
  pw.document.close();
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

  // Edição inline de valor
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [editValor, setEditValor]   = useState('');
  const [savingVal, setSavingVal]   = useState(false);

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
                        autoFocus
                        type="number"
                        min="0"
                        step="0.01"
                        value={editValor}
                        onChange={e => setEditValor(e.target.value)}
                        placeholder="0,00"
                        className="w-24 border border-emerald-300 rounded-lg px-2 py-0.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        onClick={() => salvarValor(item.id)}
                        disabled={savingVal}
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

                {/* Ações — sempre visíveis */}
                {editingId !== item.id && (
                  <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                    <button
                      onClick={() => iniciarEdicao(item)}
                      title="Editar valor"
                      className="p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => onRemover(item.id)}
                      title="Remover item"
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

// ─── ViewEvolucaoModal ────────────────────────────────────────────────────────
// Box que abre ao clicar na linha da evolução.
// - FINALIZADA:   read-only, botão Imprimir
// - EM_ANDAMENTO: read-only, botão Editar (→ abre modal de edição)
// - CANCELADA:    read-only

function ViewEvolucaoModal({ ev, animal, onClose, onEditar }: {
  ev:       EvolucaoItem;
  animal:   AnimalExtended | null;
  onClose:  () => void;
  onEditar?: () => void;
}) {
  const finalizada = ev.status === 'FINALIZADA';
  const emAndamento = ev.status === 'EM_ANDAMENTO';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[88vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[ev.status].cls}`}>
                {STATUS_CONFIG[ev.status].label}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {ev.especialidade}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
              <span className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-600">{ev.veterinario.fullName}</span>
              </span>
              <span className="text-[11px] text-gray-400">
                Início: <span className="text-gray-600">{formatarData(ev.dataInicio)}</span>
              </span>
              {ev.dataFim && (
                <span className="text-[11px] text-gray-400">
                  Fim: <span className="text-gray-600">{formatarData(ev.dataFim)}</span>
                </span>
              )}
            </div>
            {ev.modificadoPor && ev.modificadoPor.id !== ev.veterinarioId && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                editado por {ev.modificadoPor.fullName}
                {ev.dataModificacao && ` em ${formatarData(ev.dataModificacao)}`}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Texto */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{ev.texto}</p>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          <button onClick={() => printEvolucao(ev, animal)}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            <Printer size={14} /> Imprimir
          </button>
          {emAndamento && onEditar && (
            <button onClick={() => { onClose(); onEditar(); }}
              className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
              <Pencil size={14} /> Editar evolução
            </button>
          )}
          {finalizada && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs text-gray-400 italic">Evolução finalizada — somente leitura</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmacaoEncaminhamentoModal ───────────────────────────────────────────
// Exibe apenas ações de ENCAMINHAMENTO detectadas pela LLM.
// Medicamentos e procedimentos são tratados nas telas específicas.

function ConfirmacaoEncaminhamentoModal({ acoes, onConfirmar, onCancelar, saving }: {
  acoes:       AcaoSelecionavel[];
  onConfirmar: (sel: AcaoSelecionavel[]) => void;
  onCancelar:  () => void;
  saving:      boolean;
}) {
  const [items, setItems] = useState<AcaoSelecionavel[]>(acoes);
  const toggle = (i: number) =>
    setItems(prev => prev.map((a, idx) => idx === i ? { ...a, selecionada: !a.selecionada } : a));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-orange-500" />
            <h3 className="font-bold text-gray-900">Encaminhamento detectado pela IA</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Selecione os encaminhamentos que deseja registrar
          </p>
        </div>
        <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
          {items.map((a, i) => (
            <div key={i} onClick={() => toggle(i)}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                a.selecionada ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'
              }`}>
              <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border transition-colors ${
                a.selecionada ? 'bg-orange-500 border-orange-500' : 'border-gray-300 bg-white'
              }`}>
                {a.selecionada && <Check size={10} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                    ENCAMINHAMENTO
                  </span>
                </div>
                <p className="text-xs text-gray-700 leading-snug">{a.descricao}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Valor a definir pelo especialista
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 p-4 border-t border-gray-100">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Ignorar
          </button>
          <button onClick={() => onConfirmar(items.filter(a => a.selecionada))}
            disabled={saving || items.every(a => !a.selecionada)}
            className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Registrando...' : 'Criar encaminhamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ExclusaoModal ────────────────────────────────────────────────────────────

function ExclusaoModal({ ev, onConfirmar, onCancelar, saving }: {
  ev:          EvolucaoItem;
  onConfirmar: (j: string) => void;
  onCancelar:  () => void;
  saving:      boolean;
}) {
  const [justificativa, setJustificativa] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Remover evolução</h3>
            <p className="text-xs text-gray-500">{ev.especialidade} — {formatarData(ev.dataInicio)}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A evolução ficará oculta mas permanece auditável no banco de dados.
        </p>
        <textarea autoFocus value={justificativa}
          onChange={e => setJustificativa(e.target.value)}
          placeholder="Justificativa (obrigatório) *"
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none mb-4" />
        <div className="flex gap-3">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!justificativa.trim()) { toast.error('Informe a justificativa'); return; }
              onConfirmar(justificativa.trim());
            }}
            disabled={saving}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Removendo...' : 'Confirmar Exclusão'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NovaEvolucaoModal ────────────────────────────────────────────────────────

function NovaEvolucaoModal({ form, editingId, saving, interpretando, onFormChange, onSalvar, onFinalizar, onClose }: {
  form:          FormEvolucao;
  editingId:     number | null;
  saving:        boolean;
  interpretando: boolean;
  onFormChange:  (f: keyof FormEvolucao, v: string) => void;
  onSalvar:      () => void;
  onFinalizar:   () => void;
  onClose:       () => void;
}) {
  const [gravacaoAtiva,   setGravacaoAtiva]   = useState(false);
  const [transcrevendo,   setTranscrevendo]   = useState(false);
  const [modoOffline,     setModoOffline]     = useState(false);
  const [progressModelo,  setProgressModelo]  = useState(0);
  const [showRecordAgain, setShowRecordAgain] = useState(false);
  const [mobile,          setMobile]          = useState(false);

  const recognitionRef   = useRef<ISpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const shouldRestartRef = useRef(false);
  const textoRef         = useRef(form.texto);

  useEffect(() => { textoRef.current = form.texto; }, [form.texto]);

  useEffect(() => {
    setMobile(detectarMobile());
    if (!estaOnline()) {
      carregarModelo(setProgressModelo).catch(() => {});
    }
  }, []);

  const iniciarMediaRecorder = async () => {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        await transcreverBlob(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setGravacaoAtiva(true);
    } catch { toast.error('Não foi possível acessar o microfone'); }
  };

  const pararMediaRecorder = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setGravacaoAtiva(false);
    setTranscrevendo(true);
  };

  const transcreverBlob = async (blob: Blob) => {
    try {
      if (estaOnline()) {
        const fd = new FormData();
        fd.append('audio', blob, 'recording.webm');
        const res = await api.post('/clinica/evolucoes/transcrever', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const texto = res.data.dados.texto as string;
        onFormChange('texto', (textoRef.current + ' ' + texto).trim());
      } else {
        const texto = await transcreverOffline(blob);
        onFormChange('texto', (textoRef.current + ' ' + texto).trim());
      }
      setShowRecordAgain(true);
    } catch { toast.error(estaOnline() ? 'Erro ao transcrever' : 'Erro no Whisper offline'); }
    finally { setTranscrevendo(false); }
  };

  const iniciarSpeechAPI = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) { setModoOffline(true); iniciarMediaRecorder(); return; }

    const rec          = new SpeechRec();
    rec.lang           = 'pt-BR';
    rec.continuous     = true;
    rec.interimResults = false;

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      const transcript = Array.from(e.results)
        .slice(e.resultIndex).map(r => r[0].transcript).join('');
      onFormChange('texto', textoRef.current + (textoRef.current.trim() ? ' ' : '') + transcript);
    };

    rec.onend = () => {
      if (shouldRestartRef.current) { try { rec.start(); } catch {} }
      else { setGravacaoAtiva(false); setShowRecordAgain(true); }
    };

    rec.onerror = (e: ISpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'network') {
        shouldRestartRef.current = false;
        recognitionRef.current   = null;
        setModoOffline(true);
        toast('Sem internet — alternando para Whisper offline', { icon: '🔌', duration: 3000 });
        iniciarMediaRecorder();
        return;
      }
      if (e.error === 'not-allowed') {
        shouldRestartRef.current = false;
        setGravacaoAtiva(false);
        toast.error('Permissão de microfone negada');
        return;
      }
      if (shouldRestartRef.current) { try { rec.start(); } catch { setGravacaoAtiva(false); } }
      else { setGravacaoAtiva(false); }
    };

    rec.start();
    recognitionRef.current = rec;
  };

  const iniciarGravacao = () => {
    setShowRecordAgain(false);
    if (mobile || !estaOnline()) { setModoOffline(!estaOnline()); iniciarMediaRecorder(); }
    else { shouldRestartRef.current = true; setGravacaoAtiva(true); iniciarSpeechAPI(); }
  };

  const pararGravacao = () => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
      setGravacaoAtiva(false);
      setShowRecordAgain(true);
    } else { pararMediaRecorder(); }
  };

  const desativado = saving || interpretando;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col border border-gray-100">

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-gray-900">{editingId ? 'Editar Evolução' : 'Nova Evolução'}</h3>
            {modoOffline && (
              <div className="flex items-center gap-1 mt-0.5">
                <WifiOff size={11} className="text-amber-500" />
                <span className="text-[11px] text-amber-600 font-medium">
                  Offline — Whisper local{progressModelo > 0 && progressModelo < 100 ? ` (${progressModelo}%)` : ''}
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Especialidade *</label>
              <select value={form.especialidade} onChange={e => onFormChange('especialidade', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                {ESPECIALIDADES.map(esp => <option key={esp}>{esp}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={e => onFormChange('status', e.target.value as EvolucaoStatus)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">Evolução clínica *</label>
              <div className="flex items-center gap-2">
                {form.texto && !gravacaoAtiva && !transcrevendo && (
                  <button onClick={() => onFormChange('texto', '')}
                    className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
                )}
                {!showRecordAgain && !transcrevendo && (
                  mobile ? (
                    <button
                      onTouchStart={e => { e.preventDefault(); if (!gravacaoAtiva) iniciarGravacao(); }}
                      onTouchEnd={e => { e.preventDefault(); if (gravacaoAtiva) pararGravacao(); }}
                      onContextMenu={e => e.preventDefault()}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium select-none transition-all ${
                        gravacaoAtiva
                          ? 'bg-red-100 text-red-700 ring-2 ring-red-300 animate-pulse'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}>
                      {gravacaoAtiva
                        ? <><Square size={11} /> Solte para encerrar</>
                        : <><Mic size={11} /> Segurar para gravar</>}
                    </button>
                  ) : (
                    <button onClick={gravacaoAtiva ? pararGravacao : iniciarGravacao}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        gravacaoAtiva
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}>
                      {gravacaoAtiva
                        ? <><MicOff size={11} /> Encerrar gravação</>
                        : <><Mic size={11} /> Iniciar fala</>}
                    </button>
                  )
                )}
                {transcrevendo && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <Loader2 size={12} className="animate-spin" /> Transcrevendo…
                  </div>
                )}
              </div>
            </div>

            <textarea value={form.texto} onChange={e => onFormChange('texto', e.target.value)}
              placeholder={
                gravacaoAtiva && !mobile  ? '🎤 Ouvindo… fale normalmente'
                : gravacaoAtiva && mobile ? '🔴 Gravando… solte o botão para encerrar'
                : transcrevendo           ? '⏳ Transcrevendo…'
                : 'Descreva a evolução clínica do paciente…'
              }
              rows={9}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none resize-none transition-colors ${
                gravacaoAtiva ? 'border-red-300 bg-red-50/30' : 'border-gray-200 focus:border-emerald-500'
              }`} />

            {gravacaoAtiva && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-xs text-red-700 font-medium flex-1">
                  {mobile ? 'Gravando… solte o botão quando terminar.' : 'Gravando… clique novamente para encerrar.'}
                </span>
                {!mobile && (
                  <button onClick={pararGravacao}
                    className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex-shrink-0">
                    <MicOff size={11} /> Encerrar
                  </button>
                )}
              </div>
            )}

            {showRecordAgain && !gravacaoAtiva && !transcrevendo && (
              <div className="mt-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs font-semibold text-emerald-800 mb-2">✅ Áudio transcrito. Deseja gravar mais?</p>
                <div className="flex gap-2">
                  <button onClick={() => { setShowRecordAgain(false); iniciarGravacao(); }}
                    className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold">
                    <Mic size={12} /> Sim, gravar mais
                  </button>
                  <button onClick={() => setShowRecordAgain(false)}
                    className="flex-1 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-medium">
                    Não, usar este texto
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} disabled={desativado}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={onSalvar} disabled={desativado}
            className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 disabled:text-gray-400 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && !interpretando && <Loader2 size={13} className="animate-spin" />}
            {saving && !interpretando ? 'Salvando…' : 'Salvar'}
          </button>
          <button onClick={onFinalizar} disabled={desativado || !form.texto.trim()}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {interpretando && <Loader2 size={13} className="animate-spin" />}
            {interpretando ? 'Analisando…' : saving ? 'Finalizando…' : 'Finalizar ✓'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SubModuloEmConstrucao ────────────────────────────────────────────────────

function SubModuloEmConstrucao({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-200">
      <Stethoscope size={40} className="mb-3" />
      <p className="text-sm font-medium text-gray-300">{label}</p>
      <p className="text-xs text-gray-300 mt-1">Em desenvolvimento</p>
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

// ─── Main component ───────────────────────────────────────────────────────────

const Atendimento = () => {
  const { user }                              = useAuth();
  const { selectedAnimal, setSelectedAnimal } = useSelectedAnimal();
  const navigate                              = useNavigate();
  const { animalId: animalIdParam }           = useParams<{ animalId?: string }>();

  const effectiveAnimalId = animalIdParam || selectedAnimal?.id?.toString();

  // ── Dados ─────────────────────────────────────────────────────────────────
  const [animal,        setAnimal]        = useState<AnimalExtended | null>(null);
  const [todosAnimais,  setTodosAnimais]  = useState<AnimalExtended[]>([]);
  const [evolucoes,     setEvolucoes]     = useState<EvolucaoItem[]>([]);
  const [responsaveis,  setResponsaveis]  = useState<{ id: number; fullName: string }[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(1);
  const [limit,         setLimit]         = useState(10);
  const [fatura,        setFatura]        = useState<Fatura | null>(null);
  const [loadingFatura, setLoadingFatura] = useState(true);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const [filterStatus,      setFilterStatus]      = useState('');
  const [busca,             setBusca]             = useState('');
  const [filtroDataInicio,  setFiltroDataInicio]  = useState('');
  const [filtroDataFim,     setFiltroDataFim]     = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');

  // ── UI ────────────────────────────────────────────────────────────────────
  const [activeTab,      setActiveTab]      = useState<SubModulo>('evolucao');
  const [showModal,      setShowModal]      = useState(false);
  const [viewingEv,      setViewingEv]      = useState<EvolucaoItem | null>(null);
  const [editingEv,      setEditingEv]      = useState<EvolucaoItem | null>(null);
  const [deletingEv,     setDeletingEv]     = useState<EvolucaoItem | null>(null);
  const [form,           setForm]           = useState<FormEvolucao>(FORM_INICIAL);
  const [savingEv,       setSavingEv]       = useState(false);
  const [savingExclusao, setSavingExclusao] = useState(false);
  const [interpretando,  setInterpretando]  = useState(false);
  const [acoesLLM,       setAcoesLLM]       = useState<AcaoSelecionavel[]>([]);
  const [showLLM,        setShowLLM]        = useState(false);
  const [savingFatura,   setSavingFatura]   = useState(false);
  const [showFaturaM,    setShowFaturaM]    = useState(false);

  const totalPaginas = Math.ceil(total / limit);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      const a   = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
    } catch (err) { console.error('Erro ao carregar animal:', err); }
  }, [effectiveAnimalId]);

  const carregarEvolucoes = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterStatus)      params.set('status',        filterStatus);
      if (filtroDataInicio)  params.set('dataInicio',    filtroDataInicio);
      if (filtroDataFim)     params.set('dataFim',       filtroDataFim);
      if (filtroResponsavel) params.set('responsavelId', filtroResponsavel);
      if (busca.trim())      params.set('busca',         busca.trim());
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?${params}`);
      setEvolucoes(res.data.dados ?? []);
      setTotal(res.data.total ?? 0);
    } catch { toast.error('Erro ao carregar evoluções'); }
    finally { setLoading(false); }
  }, [effectiveAnimalId, page, limit, filterStatus, filtroDataInicio, filtroDataFim, filtroResponsavel, busca]);

  const carregarFatura = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setLoadingFatura(true);
    try {
      const res = await api.get(`/clinica/faturas/animal/${effectiveAnimalId}`);
      setFatura(res.data.dados);
    } catch { /* silencioso */ }
    finally { setLoadingFatura(false); }
  }, [effectiveAnimalId]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    carregarAnimal();
    carregarFatura();
    api.get('/animais').then(res => setTodosAnimais(res.data?.dados ?? [])).catch(() => {});
    if (effectiveAnimalId) {
      api.get(`/clinica/evolucoes/responsaveis/${effectiveAnimalId}`)
        .then(res => setResponsaveis(res.data?.dados ?? []))
        .catch(() => {});
    }
  }, [effectiveAnimalId]);

  useEffect(() => {
    if (activeTab === 'evolucao') carregarEvolucoes();
  }, [activeTab, page, limit, filterStatus, filtroDataInicio, filtroDataFim, filtroResponsavel]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelecionarAnimal = (a: AnimalExtended) => {
    setSelectedAnimal(a);
    navigate(`/clinica/evolucao/${a.id}`);
  };

  const handleFormChange = (field: keyof FormEvolucao, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const abrirNova   = () => { setForm(FORM_INICIAL); setEditingEv(null); setShowModal(true); };
  const fecharModal = () => { setShowModal(false); setEditingEv(null); setForm(FORM_INICIAL); };

  const abrirEdicao = (ev: EvolucaoItem) => {
    setForm({ especialidade: ev.especialidade, texto: ev.texto, status: ev.status });
    setEditingEv(ev);
    setShowModal(true);
  };

  // Salvar — mantém status, SEM LLM
  const handleSalvar = async () => {
    if (!form.especialidade || !form.texto.trim()) {
      toast.error('Especialidade e texto são obrigatórios');
      return;
    }
    setSavingEv(true);
    try {
      if (editingEv) {
        await api.put(`/clinica/evolucoes/${editingEv.id}`, {
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        form.status,
        });
        toast.success('Evolução salva');
      } else {
        await api.post('/clinica/evolucoes', {
          animalId:      Number(effectiveAnimalId),
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        'EM_ANDAMENTO',
        });
        toast.success('Evolução registrada');
      }
      fecharModal();
      carregarEvolucoes();
    } catch { toast.error('Erro ao salvar evolução'); }
    finally { setSavingEv(false); }
  };

  // Finalizar — FINALIZADA + LLM (apenas ENCAMINHAMENTO)
  const handleFinalizar = async () => {
    if (!form.especialidade || !form.texto.trim()) {
      toast.error('Especialidade e texto são obrigatórios');
      return;
    }
    setSavingEv(true);
    const textoParaLLM = form.texto;
    let evolucaoId = editingEv?.id;

    try {
      if (editingEv) {
        await api.put(`/clinica/evolucoes/${editingEv.id}`, {
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        'FINALIZADA',
        });
      } else {
        const createRes = await api.post('/clinica/evolucoes', {
          animalId:      Number(effectiveAnimalId),
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        'FINALIZADA',
        });
        evolucaoId = createRes.data.dados?.id as number | undefined;
      }

      toast.success('Evolução finalizada!');
      fecharModal();
      setSavingEv(false);
      carregarEvolucoes();

      // ── LLM: detecta apenas ENCAMINHAMENTO + gera resumo ────────────────
      setInterpretando(true);
      try {
        const llmRes = await api.post('/clinica/evolucoes/interpretar', { texto: textoParaLLM });
        const { acoes, resumo } = llmRes.data.dados as { acoes: AcaoLLM[]; resumo?: string };

        // Salva o resumo gerado pela LLM na evolução
        // Requer: PATCH /clinica/evolucoes/:id/resumo no backend
        if (resumo && evolucaoId) {
          api.patch(`/clinica/evolucoes/${evolucaoId}/resumo`, { resumo })
            .then(() => carregarEvolucoes())
            .catch(() => {});
        }

        // Filtra apenas ENCAMINHAMENTO — medicamentos tratados na prescrição
        const encaminhamentos = acoes.filter(a => a.tipo === 'ENCAMINHAMENTO');
        if (encaminhamentos.length > 0) {
          setAcoesLLM(encaminhamentos.map(a => ({ ...a, selecionada: true })));
          setShowLLM(true);
        }
      } catch (err) {
        console.error('LLM (não-crítico):', err);
      } finally { setInterpretando(false); }
      return;

    } catch { toast.error('Erro ao finalizar evolução'); }
    finally { setSavingEv(false); }
  };

  const handleExcluir = async (justificativa: string) => {
    if (!deletingEv) return;
    setSavingExclusao(true);
    try {
      await api.delete(`/clinica/evolucoes/${deletingEv.id}`, { data: { justificativa } });
      setDeletingEv(null);
      toast.success('Evolução removida');
      carregarEvolucoes();
    } catch { toast.error('Erro ao remover evolução'); }
    finally { setSavingExclusao(false); }
  };

  // Cancelar evolução FINALIZADA
  // Requer: PATCH /clinica/evolucoes/:id/cancelar no backend
  const handleCancelarEvolucao = async (ev: EvolucaoItem) => {
    try {
      await api.patch(`/clinica/evolucoes/${ev.id}/cancelar`);
      toast.success('Evolução cancelada');
      carregarEvolucoes();
    } catch { toast.error('Erro ao cancelar evolução'); }
  };

  const handleAprovar = async (id: number) => {
    try {
      await api.patch(`/clinica/evolucoes/${id}/aprovar`);
      toast.success('Evolução aprovada');
      carregarEvolucoes();
    } catch { toast.error('Erro ao aprovar'); }
  };

  // Confirmar encaminhamento detectado pela LLM
  const handleConfirmarEncaminhamento = async (selecionadas: AcaoSelecionavel[]) => {
    if (!fatura) return;
    setSavingFatura(true);
    try {
      // Adiciona encaminhamento na fatura com valor 0 (a ser preenchido depois)
      await Promise.all(
        selecionadas.map(a =>
          api.post(`/clinica/faturas/${fatura.id}/itens`, {
            tipo:       'ENCAMINHAMENTO',
            descricao:  a.descricao,
            valor:      0, // valor definido pelo especialista posteriormente
            quantidade: a.quantidade,
          })
        )
      );
      toast.success('Encaminhamento registrado na fatura');
      setShowLLM(false);
      setAcoesLLM([]);
      carregarFatura();
    } catch { toast.error('Erro ao registrar encaminhamento'); }
    finally { setSavingFatura(false); }
  };

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

  // ── renderContent ─────────────────────────────────────────────────────────

  const renderContent = () => {
    if (activeTab !== 'evolucao') {
      return <SubModuloEmConstrucao label={SUB_MODULOS.find(m => m.key === activeTab)?.label ?? ''} />;
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      );
    }

    if (evolucoes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={40} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma evolução encontrada</p>
          <button onClick={abrirNova}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            <Plus size={14} /> Nova Evolução
          </button>
        </div>
      );
    }

    const userId = user?.id ?? 0;
    const role   = user?.role ?? 'USER';

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Data Início</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Data Fim</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Resumo</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Responsável</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {evolucoes.map(ev => {
              const finalizada  = ev.status === 'FINALIZADA';
              const emAndamento = ev.status === 'EM_ANDAMENTO';
              const podeExcluir = emAndamento && (role === 'ADMIN' || (role === 'VETERINARIO' && ev.veterinarioId === userId));
              const podeAprovar = !ev.aprovado && (role === 'ADMIN' || role === 'VETERINARIO');

              // Resumo: usa o campo gerado pela LLM ou trunca o texto como fallback
              const resumoDisplay = ev.resumo
                ? ev.resumo.substring(0, 50)
                : ev.texto.length > 50 ? ev.texto.substring(0, 47) + '…' : ev.texto;

              return (
                <tr key={ev.id}
                  onClick={() => setViewingEv(ev)}
                  className={`hover:bg-gray-50 transition-colors cursor-pointer ${!ev.aprovado ? 'bg-amber-50/40' : ''}`}>

                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    <div>{formatarData(ev.dataInicio)}</div>
                    {!ev.aprovado && (
                      <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium mt-0.5">
                        <AlertTriangle size={9} /> Pendente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {ev.dataFim ? formatarData(ev.dataFim) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-800 max-w-xs">
                    <p className="text-xs text-gray-700 truncate">{resumoDisplay}</p>
                    <span className="inline-block mt-0.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                      {ev.especialidade}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="text-xs font-medium text-gray-800">{ev.veterinario.fullName}</p>
                    {ev.modificadoPor && ev.modificadoPor.id !== ev.veterinarioId && (
                      <p className="text-[10px] text-gray-400 mt-0.5">editado por {ev.modificadoPor.fullName}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      STATUS_CONFIG[ev.status]?.cls ?? 'bg-gray-100 text-gray-600'
                    }`}>
                      {STATUS_CONFIG[ev.status]?.label ?? ev.status}
                    </span>
                  </td>

                  {/* Ações — interceptar click para não abrir o ViewModal */}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">

                      {podeAprovar && (
                        <button onClick={() => handleAprovar(ev.id)} title="Aprovar"
                          className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                          <CheckCircle2 size={14} />
                        </button>
                      )}

                      {/* Ver (abre ViewModal) */}
                      <button onClick={() => setViewingEv(ev)} title="Visualizar"
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                        <Eye size={14} />
                      </button>

                      {/* Editar — EM_ANDAMENTO: abre modal de edição / FINALIZADA: abre view (read-only) */}
                      {emAndamento ? (
                        <button onClick={() => abrirEdicao(ev)} title="Editar"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={14} />
                        </button>
                      ) : (
                        <button onClick={() => setViewingEv(ev)} title="Visualizar"
                          className="p-1.5 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={14} />
                        </button>
                      )}

                      {/* Cancelar — EM_ANDAMENTO: excluir / FINALIZADA: cancelar evolution */}
                      {emAndamento && podeExcluir && (
                        <button onClick={() => setDeletingEv(ev)} title="Excluir"
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                      {finalizada && (role === 'ADMIN' || (role === 'VETERINARIO' && ev.veterinarioId === userId)) && (
                        <button onClick={() => handleCancelarEvolucao(ev)} title="Cancelar evolução"
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Ban size={14} />
                        </button>
                      )}

                      {/* Imprimir — sempre visível */}
                      <button onClick={() => printEvolucao(ev, animal)} title="Imprimir"
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                        <Printer size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
            <span className="text-xs text-gray-400">{total} evolução{total !== 1 ? 'ões' : ''}</span>
            <div className="flex items-center gap-3">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-gray-500">{page} / {totalPaginas}</span>
              <button disabled={page >= totalPaginas} onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Guard ─────────────────────────────────────────────────────────────────

  if (!effectiveAnimalId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Selecione um animal para acessar o módulo clínico.</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const filtrosAtivos = !!(filtroDataInicio || filtroDataFim || filtroResponsavel || filterStatus || busca);

  return (
      <PageContainer>

        <BotaoVoltar className="mb-4" />

        <SeletorAnimalInteligente
          animais={todosAnimais}
          animalAtual={animal}
          onSelecionar={handleSelecionarAnimal}
        />

        {animal && <AnimalCard animal={animal} />}

        {/* ── Barra de ação + filtros na mesma linha ── */}
        <div className="flex flex-wrap items-center gap-2 mb-3 mt-4">

          {/* Nova Evolução */}
          <button onClick={abrirNova}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
            <Plus size={15} /> Nova Evolução
          </button>

          {/* Registros por página */}
          <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500 flex-shrink-0">
            {LIMIT_OPTIONS.map(l => <option key={l} value={l}>{l} por página</option>)}
          </select>

          {/* Busca por texto */}
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar nas evoluções..."
              value={busca}
              onChange={e => { setBusca(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm
                         text-gray-900 focus:outline-none focus:border-emerald-500
                         focus:ring-2 focus:ring-emerald-100 bg-white transition-colors"
            />
          </div>

          {/* Data Inicial → Data Final com labels */}
          <div className="flex items-center border border-gray-200 rounded-xl bg-white overflow-hidden flex-shrink-0">
            <Calendar size={14} className="ml-3 text-gray-400 flex-shrink-0" />
            <div className="flex flex-col px-2 py-1 min-w-0">
              <span className="text-[10px] text-gray-400 leading-none mb-0.5">Data Inicial</span>
              <input type="date" value={filtroDataInicio}
                onChange={e => { setFiltroDataInicio(e.target.value); setPage(1); }}
                className="text-xs text-gray-900 bg-transparent focus:outline-none w-28" />
            </div>
            <span className="text-gray-300 text-xs px-1 flex-shrink-0">→</span>
            <div className="flex flex-col px-2 py-1 border-l border-gray-100 min-w-0">
              <span className="text-[10px] text-gray-400 leading-none mb-0.5">Data Final</span>
              <input type="date" value={filtroDataFim}
                onChange={e => { setFiltroDataFim(e.target.value); setPage(1); }}
                className="text-xs text-gray-900 bg-transparent focus:outline-none w-28" />
            </div>
          </div>

          {/* Responsável */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-xl bg-white px-3 py-2 flex-shrink-0">
            <User size={14} className="text-gray-400 flex-shrink-0" />
            <select value={filtroResponsavel}
              onChange={e => { setFiltroResponsavel(e.target.value); setPage(1); }}
              className="text-sm text-gray-700 bg-transparent focus:outline-none max-w-[140px]">
              <option value="">Responsável</option>
              {responsaveis.map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
            </select>
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5 border border-gray-200 rounded-xl bg-white px-3 py-2 flex-shrink-0">
            <Filter size={14} className="text-gray-400 flex-shrink-0" />
            <select value={filterStatus}
              onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
              className="text-sm text-gray-700 bg-transparent focus:outline-none">
              <option value="">Status</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {filtrosAtivos && (
            <button
              onClick={() => { setFiltroDataInicio(''); setFiltroDataFim(''); setFiltroResponsavel(''); setFilterStatus(''); setBusca(''); setPage(1); }}
              className="px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl bg-white transition-colors flex-shrink-0">
              Limpar ×
            </button>
          )}
        </div>

        {/* ── Desktop ── */}
        <div className="hidden md:flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <SubMenuClinico activeTab={activeTab} onChange={t => { setActiveTab(t); setPage(1); }} />
            <div className="bg-white rounded-b-2xl rounded-tr-2xl border border-gray-100 shadow-sm min-h-96 overflow-hidden">
              {renderContent()}
            </div>
          </div>
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
        </div>

        {/* ── Mobile ── */}
        <div className="md:hidden">
          <SubMenuClinico activeTab={activeTab} onChange={t => { setActiveTab(t); setPage(1); }} />
          <div className="bg-white rounded-b-2xl border border-gray-100 shadow-sm overflow-hidden">
            {renderContent()}
          </div>
          <button onClick={() => setShowFaturaM(true)}
            className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-lg font-semibold text-sm z-40">
            <ReceiptText size={16} />
            {interpretando
              ? <Loader2 size={13} className="animate-spin" />
              : formatCurrency(fatura?.total ?? 0)}
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
        </div>

      {/* ── Modais ── */}

      {/* View box — clique na linha */}
      {viewingEv && (
        <ViewEvolucaoModal
          ev={viewingEv}
          animal={animal}
          onClose={() => setViewingEv(null)}
          onEditar={viewingEv.status === 'EM_ANDAMENTO' ? () => abrirEdicao(viewingEv) : undefined}
        />
      )}

      {showModal && (
        <NovaEvolucaoModal
          form={form} editingId={editingEv?.id ?? null}
          saving={savingEv} interpretando={interpretando}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onFinalizar={handleFinalizar}
          onClose={fecharModal}
        />
      )}

      {deletingEv && (
        <ExclusaoModal ev={deletingEv} onConfirmar={handleExcluir}
          onCancelar={() => setDeletingEv(null)} saving={savingExclusao} />
      )}

      {showLLM && (
        <ConfirmacaoEncaminhamentoModal
          acoes={acoesLLM}
          onConfirmar={handleConfirmarEncaminhamento}
          onCancelar={() => { setShowLLM(false); setAcoesLLM([]); }}
          saving={savingFatura}
        />
      )}
    </PageContainer>
  );
};

export default Atendimento;