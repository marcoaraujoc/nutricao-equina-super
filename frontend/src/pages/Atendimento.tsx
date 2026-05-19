// src/pages/Atendimento.tsx
// Renomeado de EvolucaoClinica.tsx
// Rota: /clinica e /clinica/evolucao/:animalId

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Plus, Pencil, Trash2, Printer, Mic, MicOff,
  Check, X, ChevronLeft, ChevronRight, AlertTriangle,
  Stethoscope, Pill, Syringe, FlaskConical, Share2,
  FileText, ReceiptText, CheckCircle2, Search,
} from 'lucide-react';
import AnimalCard  from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';

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
  id:              number;
  animalId:        number;
  veterinarioId:   number;
  veterinario:     Vet;
  modificadoPorId?: number | null;
  modificadoPor?:   Vet | null;
  especialidade:   string;
  status:          EvolucaoStatus;
  texto:           string;
  dataInicio:      string;
  dataFim?:        string | null;
  dataModificacao?: string | null;
  ativo:           boolean;
  aprovado:        boolean;
}

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
  id:      number;
  animalId: number;
  total:   number;
  status:  string;
  itens:   FaturaItem[];
}

interface AcaoLLM {
  tipo:           TipoFatura;
  descricao:      string;
  valorEstimado:  number;
  quantidade:     number;
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
  { key: 'evolucao',       label: 'Evolução',       icon: <FileText    size={13} /> },
  { key: 'prescricao',     label: 'Prescrição',     icon: <Pill        size={13} /> },
  { key: 'vacina',         label: 'Vacina',         icon: <Syringe     size={13} /> },
  { key: 'exames',         label: 'Exames',         icon: <FlaskConical size={13} /> },
  { key: 'encaminhamento', label: 'Encaminhamento', icon: <Share2      size={13} /> },
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

const formatarDataHora = (data: string | null | undefined): string => {
  if (!data) return '-';
  const d = new Date(data);
  if (isNaN(d.getTime())) return '-';
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
  <div><span class="lbl">Raça</span><span class="val">${animal.raca?.nome ?? '-'}</span></div>
  <div><span class="lbl">Proprietário</span><span class="val">${animal.user?.fullName ?? '-'}</span></div>
</div></div>` : ''}
<div class="card"><div class="grid">
  <div><span class="lbl">Especialidade</span><span class="val">${ev.especialidade}</span></div>
  <div><span class="lbl">Status</span><span class="badge">${STATUS_CONFIG[ev.status].label}</span></div>
  <div><span class="lbl">Data de Início</span><span class="val">${formatarDataHora(ev.dataInicio)}</span></div>
  ${ev.dataFim ? `<div><span class="lbl">Data de Fim</span><span class="val">${formatarDataHora(ev.dataFim)}</span></div>` : ''}
  <div><span class="lbl">Responsável</span><span class="val">${ev.veterinario.fullName}</span></div>
  ${ev.modificadoPor ? `<div><span class="lbl">Modificado por</span><span class="val">${ev.modificadoPor.fullName}</span></div>` : ''}
  ${ev.dataModificacao ? `<div><span class="lbl">Data de Modificação</span><span class="val">${formatarDataHora(ev.dataModificacao)}</span></div>` : ''}
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
      {SUB_MODULOS.map((m) => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-xl whitespace-nowrap transition-colors flex-shrink-0 ${
            activeTab === m.key
              ? 'bg-white text-emerald-700 border border-gray-100 border-b-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
          }`}
        >
          {m.icon}
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ─── FaturaPanel ─────────────────────────────────────────────────────────────

function FaturaPanel({ fatura, onRemover, loading }: {
  fatura:   Fatura | null;
  onRemover: (id: number) => void;
  loading:  boolean;
}) {
  const itens = fatura?.itens ?? [];

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
            <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          </div>
        ) : itens.length === 0 ? (
          <p className="text-center text-gray-300 text-xs py-10">Nenhum item na fatura</p>
        ) : (
          <div className="space-y-px px-3">
            {itens.map((item) => (
              <div key={item.id} className="flex items-start gap-2 py-2 border-b border-gray-50 last:border-0 group">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 mt-0.5 ${TIPO_COLORS[item.tipo]}`}>
                  {TIPO_ICONS[item.tipo]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-800 leading-snug line-clamp-2">{item.descricao}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-bold text-emerald-700">{formatCurrency(item.valor * item.quantidade)}</span>
                    {item.quantidade > 1 && <span className="text-xs text-gray-400">×{item.quantidade}</span>}
                    <span className="text-[10px] text-gray-400 font-mono bg-gray-100 px-1 rounded">
                      {getIniciais(item.veterinario.fullName)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onRemover(item.id)}
                  className="text-gray-200 hover:text-red-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                >
                  <Trash2 size={12} />
                </button>
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

// ─── EvolucaoCard ─────────────────────────────────────────────────────────────

function EvolucaoCard({ ev, userId, role, onEdit, onDelete, onPrint, onAprovar }: {
  ev:        EvolucaoItem;
  userId:    number;
  role:      string;
  onEdit:    (e: EvolucaoItem) => void;
  onDelete:  (e: EvolucaoItem) => void;
  onPrint:   (e: EvolucaoItem) => void;
  onAprovar: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const podeEditar  = role === 'ADMIN' || (role === 'VETERINARIO' && ev.veterinarioId === userId);
  const podeAprovar = (role === 'ADMIN' || role === 'VETERINARIO') && !ev.aprovado;
  const longo       = ev.texto.length > 220;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden mb-3 ${!ev.aprovado ? 'border-amber-200' : 'border-gray-100'}`}>
      {!ev.aprovado && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
          <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-700 font-medium">Pendente de aprovação</span>
          {podeAprovar && (
            <button onClick={() => onAprovar(ev.id)}
              className="ml-auto flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800">
              <CheckCircle2 size={13} /> Aprovar
            </button>
          )}
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[ev.status].cls}`}>
              {STATUS_CONFIG[ev.status].label}
            </span>
            <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-full">
              {ev.especialidade}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {podeEditar && (
              <>
                <button onClick={() => onEdit(ev)} className="p-1.5 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                  <Pencil size={13} />
                </button>
                <button onClick={() => onDelete(ev)} className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={13} />
                </button>
              </>
            )}
            <button onClick={() => onPrint(ev)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
              <Printer size={13} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mb-3">
          <div>
            <span className="block text-[11px] text-gray-400">Responsável</span>
            <span className="text-xs font-medium text-gray-800">{ev.veterinario.fullName}</span>
          </div>
          <div>
            <span className="block text-[11px] text-gray-400">Data de Início</span>
            <span className="text-xs font-medium text-gray-800">{formatarDataHora(ev.dataInicio)}</span>
          </div>
          {ev.dataFim && (
            <div>
              <span className="block text-[11px] text-gray-400">Data de Fim</span>
              <span className="text-xs font-medium text-gray-800">{formatarDataHora(ev.dataFim)}</span>
            </div>
          )}
          {ev.dataModificacao && (
            <div>
              <span className="block text-[11px] text-gray-400">Últ. Modificação</span>
              <span className="text-xs font-medium text-gray-800">{formatarDataHora(ev.dataModificacao)}</span>
            </div>
          )}
          {ev.modificadoPor && (
            <div>
              <span className="block text-[11px] text-gray-400">Modificado por</span>
              <span className="text-xs font-medium text-gray-800">{ev.modificadoPor.fullName}</span>
            </div>
          )}
        </div>

        <div
          className={`text-sm text-gray-700 leading-relaxed whitespace-pre-wrap cursor-pointer ${!expanded && longo ? 'line-clamp-3' : ''}`}
          onClick={() => longo && setExpanded((v) => !v)}
        >
          {ev.texto}
        </div>
        {longo && (
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-emerald-600 mt-1 hover:underline">
            {expanded ? 'Ver menos' : 'Ver mais'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ConfirmacaoLLMModal ──────────────────────────────────────────────────────

function ConfirmacaoLLMModal({ acoes, onConfirmar, onCancelar, saving }: {
  acoes:       AcaoSelecionavel[];
  onConfirmar: (sel: AcaoSelecionavel[]) => void;
  onCancelar:  () => void;
  saving:      boolean;
}) {
  const [items, setItems] = useState<AcaoSelecionavel[]>(acoes);
  const toggle = (i: number) =>
    setItems((prev) => prev.map((a, idx) => idx === i ? { ...a, selecionada: !a.selecionada } : a));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Itens detectados pela IA</h3>
          <p className="text-xs text-gray-500 mt-0.5">Selecione os itens que deseja adicionar à fatura</p>
        </div>
        <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
          {items.map((a, i) => (
            <div key={i} onClick={() => toggle(i)}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                a.selecionada ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'
              }`}>
              <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border transition-colors ${
                a.selecionada ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300 bg-white'
              }`}>
                {a.selecionada && <Check size={10} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TIPO_COLORS[a.tipo]}`}>{a.tipo}</span>
                  <span className="text-xs font-bold text-emerald-700">{formatCurrency(a.valorEstimado * a.quantidade)}</span>
                </div>
                <p className="text-xs text-gray-700 leading-snug">{a.descricao}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-3 p-4 border-t border-gray-100">
          <button onClick={onCancelar} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(items.filter((a) => a.selecionada))}
            disabled={saving || items.every((a) => !a.selecionada)}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? 'Adicionando...' : 'Adicionar à fatura'}
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
            <p className="text-xs text-gray-500">{ev.especialidade} — {formatarDataHora(ev.dataInicio)}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A evolução ficará oculta mas permanece auditável no banco de dados.
        </p>
        <textarea
          autoFocus value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Justificativa (obrigatório) *"
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none mb-4"
        />
        <div className="flex gap-3">
          <button onClick={onCancelar} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => {
              if (!justificativa.trim()) { toast.error('Informe a justificativa'); return; }
              onConfirmar(justificativa.trim());
            }}
            disabled={saving}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? 'Removendo...' : 'Confirmar Exclusão'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NovaEvolucaoModal ────────────────────────────────────────────────────────

function NovaEvolucaoModal({ form, editingId, saving, interpretando, onFormChange, onSave, onClose }: {
  form:          FormEvolucao;
  editingId:     number | null;
  saving:        boolean;
  interpretando: boolean;
  onFormChange:  (f: keyof FormEvolucao, v: string) => void;
  onSave:        () => void;
  onClose:       () => void;
}) {
  const [isListening,     setIsListening]     = useState(false);
  const [showRecordAgain, setShowRecordAgain]  = useState(false);
  const recognitionRef   = useRef<ISpeechRecognition | null>(null);
  const shouldRestartRef = useRef(false);

  const iniciarReconhecimento = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) { toast.error('Seu navegador não suporta reconhecimento de voz'); return; }

    const rec        = new SpeechRec();
    rec.lang         = 'pt-BR';
    rec.continuous   = true;
    rec.interimResults = false;

    rec.onresult = (e: ISpeechRecognitionEvent) => {
      const transcript = Array.from(e.results)
        .slice(e.resultIndex)
        .map((r) => r[0].transcript)
        .join('');
      onFormChange('texto', form.texto + (form.texto.trim() ? ' ' : '') + transcript);
    };

    rec.onend = () => {
      if (shouldRestartRef.current) {
        try { rec.start(); } catch { /* ignora */ }
      } else {
        setIsListening(false);
      }
    };

    rec.onerror = (e: ISpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech') return;
      if (e.error === 'network') {
        shouldRestartRef.current = false;
        recognitionRef.current   = null;
        setIsListening(false);
        setShowRecordAgain(false);
        toast.error('Erro de rede no reconhecimento de voz. Verifique sua conexão.', { duration: 6000 });
        return;
      }
      if (e.error === 'not-allowed') {
        shouldRestartRef.current = false;
        setIsListening(false);
        toast.error('Permissão de microfone negada.');
        return;
      }
      console.error('Speech error:', e.error);
      if (shouldRestartRef.current) {
        try { rec.start(); } catch { setIsListening(false); }
      } else {
        setIsListening(false);
      }
    };

    rec.start();
    recognitionRef.current = rec;
  };

  const startListening = () => {
    shouldRestartRef.current = true;
    setShowRecordAgain(false);
    setIsListening(true);
    iniciarReconhecimento();
  };

  const stopListening = () => {
    shouldRestartRef.current = false;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setShowRecordAgain(true);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">{editingId ? 'Editar Evolução' : 'Nova Evolução'}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Especialidade *</label>
              <select value={form.especialidade} onChange={(e) => onFormChange('especialidade', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                {ESPECIALIDADES.map((esp) => <option key={esp}>{esp}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={form.status} onChange={(e) => onFormChange('status', e.target.value as EvolucaoStatus)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500">
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">Evolução clínica *</label>
              <div className="flex items-center gap-2">
                {form.texto && !isListening && (
                  <button onClick={() => onFormChange('texto', '')} className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
                )}
                {!showRecordAgain && (
                  <button
                    onClick={isListening ? stopListening : startListening}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                      isListening ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                    }`}
                  >
                    {isListening ? <><MicOff size={11} /> Encerrar gravação</> : <><Mic size={11} /> Iniciar fala</>}
                  </button>
                )}
              </div>
            </div>

            <textarea
              value={form.texto}
              onChange={(e) => onFormChange('texto', e.target.value)}
              placeholder={isListening ? '🎤 Ouvindo... fale agora' : 'Descreva a evolução clínica do paciente...'}
              rows={9}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none resize-none transition-colors ${
                isListening ? 'border-red-300 bg-red-50/50' : 'border-gray-200 focus:border-emerald-500'
              }`}
            />

            {isListening && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-xs text-red-700 font-medium flex-1">Gravando... fale normalmente. A gravação continua mesmo em pausas.</span>
                <button onClick={stopListening}
                  className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors flex-shrink-0">
                  <MicOff size={11} /> Encerrar
                </button>
              </div>
            )}

            {showRecordAgain && !isListening && (
              <div className="mt-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <p className="text-xs font-semibold text-emerald-800 mb-2">
                  ✅ Áudio adicionado. Deseja gravar outro áudio para esta evolução?
                </p>
                <div className="flex gap-2">
                  <button onClick={startListening}
                    className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold transition-colors">
                    <Mic size={12} /> Sim, gravar mais
                  </button>
                  <button onClick={() => setShowRecordAgain(false)}
                    className="flex-1 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-xs font-medium transition-colors">
                    Não, usar este texto
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 pb-5 pt-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onSave} disabled={saving || interpretando}
            className="flex-1 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {(saving || interpretando) && (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {interpretando ? 'Analisando com IA...' : saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Salvar Evolução'}
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
// Dropdown de animais com detecção de nomes duplicados.
// Quando o animal atual tem nome duplicado, exibe um segundo campo
// de busca por proprietário para desambiguação.

function SeletorAnimalInteligente({ animais, animalAtual, onSelecionar }: {
  animais:      AnimalExtended[];
  animalAtual:  AnimalExtended | null;
  onSelecionar: (a: AnimalExtended) => void;
}) {
  const [filtroDono,    setFiltroDono]    = useState('');
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownAberto(false);
        setFiltroDono('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (animais.length <= 1) return null;

  // Contagem de nomes duplicados
  const nomesCount = animais.reduce<Record<string, number>>((acc, a) => {
    acc[a.nome] = (acc[a.nome] ?? 0) + 1;
    return acc;
  }, {});

  const animalTemDuplicata = animalAtual
    ? (nomesCount[animalAtual.nome] ?? 0) > 1
    : false;

  // Animais duplicados (mesmo nome do atual)
  const duplicatas = animalAtual
    ? animais.filter(a => a.nome === animalAtual.nome)
    : [];

  // Filtrados pelo dono (para o segundo campo)
  const duplicatasFiltradas = filtroDono.trim()
    ? duplicatas.filter(a =>
        (a.user?.fullName ?? '').toLowerCase().includes(filtroDono.toLowerCase())
      )
    : duplicatas;

  return (
    <div className="space-y-2 mb-4">
      {/* Seletor principal */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
        <select
          value={animalAtual?.id ?? ''}
          onChange={e => {
            const selecionado = animais.find(a => a.id === Number(e.target.value));
            if (selecionado) { onSelecionar(selecionado); setFiltroDono(''); }
          }}
          className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm"
        >
          {animais.map(a => (
            <option key={a.id} value={a.id}>
              {a.nome}{(nomesCount[a.nome] ?? 0) > 1 ? ` — ${a.user?.fullName ?? '?'}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Campo secundário de busca por dono — só aparece quando há nomes duplicados */}
      {animalTemDuplicata && (
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs font-medium text-amber-700 mb-1">
            ⚠️ Existem {duplicatas.length} animais com o nome "{animalAtual?.nome}" — filtre pelo proprietário:
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={filtroDono}
              onChange={e => { setFiltroDono(e.target.value); setDropdownAberto(true); }}
              onFocus={() => setDropdownAberto(true)}
              placeholder="Nome do proprietário..."
              className="w-full pl-9 pr-4 py-2.5 border border-amber-300 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-amber-50"
            />
          </div>

          {dropdownAberto && duplicatasFiltradas.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-56 overflow-y-auto">
              {duplicatasFiltradas.map(a => (
                <button
                  key={a.id}
                  onClick={() => { onSelecionar(a); setFiltroDono(''); setDropdownAberto(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    a.id === animalAtual?.id ? 'bg-emerald-50' : ''
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {a.photoUrl
                      ? <img src={a.photoUrl as string} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">🐾</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{a.nome}</p>
                    <p className="text-xs text-gray-400 truncate">
                      Proprietário: {a.user?.fullName ?? '—'}
                    </p>
                  </div>
                  {a.id === animalAtual?.id && (
                    <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />
                  )}
                </button>
              ))}
              {duplicatasFiltradas.length === 0 && filtroDono && (
                <p className="px-4 py-3 text-xs text-gray-400">Nenhum proprietário encontrado para "{filtroDono}"</p>
              )}
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

  const [animal,         setAnimal]         = useState<AnimalExtended | null>(null);
  const [todosAnimais,   setTodosAnimais]   = useState<AnimalExtended[]>([]);
  const [evolucoes,      setEvolucoes]      = useState<EvolucaoItem[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [limit,          setLimit]          = useState(10);
  const [search,         setSearch]         = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [fatura,         setFatura]         = useState<Fatura | null>(null);
  const [loadingFatura,  setLoadingFatura]  = useState(true);
  const [activeTab,      setActiveTab]      = useState<SubModulo>('evolucao');
  const [showModal,      setShowModal]      = useState(false);
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

  // ── Loaders ──────────────────────────────────────────────────────────────

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
      if (search)       params.set('search', search);
      if (filterStatus) params.set('status', filterStatus);
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?${params}`);
      setEvolucoes(res.data.dados ?? []);
      setTotal(res.data.total ?? 0);
    } catch (err) {
      console.error('Erro ao carregar evoluções:', err);
      toast.error('Erro ao carregar evoluções');
    } finally { setLoading(false); }
  }, [effectiveAnimalId, page, limit, search, filterStatus]);

  const carregarFatura = useCallback(async () => {
    if (!effectiveAnimalId) return;
    setLoadingFatura(true);
    try {
      const res = await api.get(`/clinica/faturas/animal/${effectiveAnimalId}`);
      setFatura(res.data.dados);
    } catch (err) { console.error('Erro ao carregar fatura:', err); }
    finally { setLoadingFatura(false); }
  }, [effectiveAnimalId]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    carregarAnimal();
    carregarFatura();
    api.get('/animais')
      .then(res => setTodosAnimais(res.data?.dados ?? []))
      .catch(() => {});
  }, [effectiveAnimalId]);

  useEffect(() => {
    if (activeTab === 'evolucao') carregarEvolucoes();
  }, [activeTab, page, limit, search, filterStatus]);

  // ── Seletor de animal ─────────────────────────────────────────────────────

  const handleSelecionarAnimal = (a: AnimalExtended) => {
    setSelectedAnimal(a);
    navigate(`/clinica/evolucao/${a.id}`);
  };

  // ── Form ──────────────────────────────────────────────────────────────────

  const handleFormChange = (field: keyof FormEvolucao, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const abrirNova   = () => { setForm(FORM_INICIAL); setEditingEv(null); setShowModal(true); };
  const fecharModal = () => { setShowModal(false); setEditingEv(null); setForm(FORM_INICIAL); };

  const abrirEdicao = (ev: EvolucaoItem) => {
    setForm({ especialidade: ev.especialidade, texto: ev.texto, status: ev.status });
    setEditingEv(ev);
    setShowModal(true);
  };

  // ── Salvar ────────────────────────────────────────────────────────────────

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
        toast.success('Evolução atualizada');
        fecharModal();
        carregarEvolucoes();
      } else {
        await api.post('/clinica/evolucoes', {
          animalId:      Number(effectiveAnimalId),
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        form.status,
        });
        toast.success('Evolução registrada!');
        const textoParaLLM = form.texto;
        fecharModal();
        setSavingEv(false);
        carregarEvolucoes();

        setInterpretando(true);
        try {
          const llmRes = await api.post('/clinica/evolucoes/interpretar', { texto: textoParaLLM });
          const { acoes } = llmRes.data.dados as { acoes: AcaoLLM[] };
          if (acoes.length > 0) {
            setAcoesLLM(acoes.map((a) => ({ ...a, selecionada: true })));
            setShowLLM(true);
          }
        } catch (err) {
          console.error('LLM (não-crítico):', err);
        } finally { setInterpretando(false); }
        return;
      }
    } catch (err) {
      console.error('Erro ao salvar evolução:', err);
      toast.error('Erro ao salvar evolução');
    } finally { setSavingEv(false); }
  };

  // ── Exclusão ──────────────────────────────────────────────────────────────

  const handleExcluir = async (justificativa: string) => {
    if (!deletingEv) return;
    setSavingExclusao(true);
    try {
      await api.delete(`/clinica/evolucoes/${deletingEv.id}`, { data: { justificativa } });
      setDeletingEv(null);
      toast.success('Evolução removida');
      carregarEvolucoes();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao remover evolução');
    } finally { setSavingExclusao(false); }
  };

  // ── Aprovação ─────────────────────────────────────────────────────────────

  const handleAprovar = async (id: number) => {
    try {
      await api.patch(`/clinica/evolucoes/${id}/aprovar`);
      toast.success('Evolução aprovada');
      carregarEvolucoes();
    } catch (err) { console.error(err); toast.error('Erro ao aprovar'); }
  };

  // ── Fatura ────────────────────────────────────────────────────────────────

  const handleConfirmarLLM = async (selecionadas: AcaoSelecionavel[]) => {
    if (!fatura) return;
    setSavingFatura(true);
    try {
      await Promise.all(
        selecionadas.map((a) =>
          api.post(`/clinica/faturas/${fatura.id}/itens`, {
            tipo:       a.tipo,
            descricao:  a.descricao,
            valor:      a.valorEstimado,
            quantidade: a.quantidade,
          })
        )
      );
      const n = selecionadas.length;
      toast.success(`${n} item${n !== 1 ? 'ns' : ''} adicionado${n !== 1 ? 's' : ''} à fatura`);
      setShowLLM(false);
      setAcoesLLM([]);
      carregarFatura();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao adicionar itens');
    } finally { setSavingFatura(false); }
  };

  const handleRemoverItemFatura = async (itemId: number) => {
    try {
      await api.delete(`/clinica/faturas/itens/${itemId}`);
      carregarFatura();
    } catch (err) { console.error(err); toast.error('Erro ao remover item'); }
  };

  // ── Conteúdo da aba ───────────────────────────────────────────────────────

  const renderContent = () => {
    if (activeTab !== 'evolucao') {
      return <SubModuloEmConstrucao label={SUB_MODULOS.find((m) => m.key === activeTab)?.label ?? ''} />;
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full" />
        </div>
      );
    }

    if (evolucoes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={40} className="mb-3" />
          <p className="text-sm">Nenhuma evolução registrada</p>
          <button onClick={abrirNova}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
            <Plus size={14} /> Nova Evolução
          </button>
        </div>
      );
    }

    return (
      <div className="p-4">
        {evolucoes.map((ev) => (
          <EvolucaoCard
            key={ev.id} ev={ev}
            userId={user?.id ?? 0}
            role={user?.role ?? 'USER'}
            onEdit={abrirEdicao}
            onDelete={setDeletingEv}
            onPrint={(e) => printEvolucao(e, animal)}
            onAprovar={handleAprovar}
          />
        ))}

        {totalPaginas > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-gray-500">{page} / {totalPaginas}</span>
            <button disabled={page >= totalPaginas} onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
              <ChevronRight size={14} />
            </button>
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

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <div className="max-w-7xl mx-auto px-4">

        {/* Voltar */}
        <BotaoVoltar className="mb-4 mt-6" />

        {/* Seletor inteligente de animal */}
        <SeletorAnimalInteligente
          animais={todosAnimais}
          animalAtual={animal}
          onSelecionar={handleSelecionarAnimal}
        />

        {/* Card do animal */}
        {animal && <AnimalCard animal={animal} />}

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 mb-3 mt-4">
          <button onClick={abrirNova}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
            <Plus size={15} /> Nova {SUB_MODULOS.find((m) => m.key === activeTab)?.label}
          </button>

          <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500">
            {LIMIT_OPTIONS.map((l) => <option key={l} value={l}>{l} por página</option>)}
          </select>

          <div className="flex-1 min-w-48">
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={`Buscar ${SUB_MODULOS.find((m) => m.key === activeTab)?.label ?? ''}...`}
              className="w-full border border-gray-200 rounded-2xl pl-4 pr-4 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500 shadow-sm" />
          </div>

          {activeTab === 'evolucao' && (
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500">
              <option value="">Todos os status</option>
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </div>

        {/* ── Desktop ── */}
        <div className="hidden md:flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <SubMenuClinico activeTab={activeTab} onChange={(t) => { setActiveTab(t); setPage(1); }} />
            <div className="bg-white rounded-b-2xl rounded-tr-2xl border border-gray-100 shadow-sm min-h-96 overflow-hidden">
              {renderContent()}
            </div>
          </div>

          <div className="w-72 flex-shrink-0 sticky top-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col"
              style={{ maxHeight: 'calc(100vh - 240px)', height: 'calc(100vh - 240px)' }}>
              <FaturaPanel fatura={fatura} onRemover={handleRemoverItemFatura} loading={loadingFatura} />
            </div>
          </div>
        </div>

        {/* ── Mobile ── */}
        <div className="md:hidden">
          <SubMenuClinico activeTab={activeTab} onChange={(t) => { setActiveTab(t); setPage(1); }} />
          <div className="bg-white rounded-b-2xl border border-gray-100 shadow-sm overflow-hidden">
            {renderContent()}
          </div>

          <button onClick={() => setShowFaturaM(true)}
            className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-lg font-semibold text-sm z-40">
            <ReceiptText size={16} />
            {interpretando
              ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : formatCurrency(fatura?.total ?? 0)
            }
          </button>

          {showFaturaM && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowFaturaM(false)}>
              <div className="bg-white rounded-t-2xl w-full max-h-[75vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                  <span className="font-bold text-gray-900 text-sm">Fatura</span>
                  <button onClick={() => setShowFaturaM(false)} className="p-1 text-gray-400"><X size={18} /></button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <FaturaPanel fatura={fatura} onRemover={handleRemoverItemFatura} loading={loadingFatura} />
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Modais ── */}
      {showModal && (
        <NovaEvolucaoModal
          form={form} editingId={editingEv?.id ?? null}
          saving={savingEv} interpretando={interpretando}
          onFormChange={handleFormChange} onSave={handleSalvar} onClose={fecharModal}
        />
      )}

      {deletingEv && (
        <ExclusaoModal
          ev={deletingEv} onConfirmar={handleExcluir}
          onCancelar={() => setDeletingEv(null)} saving={savingExclusao}
        />
      )}

      {showLLM && (
        <ConfirmacaoLLMModal
          acoes={acoesLLM} onConfirmar={handleConfirmarLLM}
          onCancelar={() => { setShowLLM(false); setAcoesLLM([]); }}
          saving={savingFatura}
        />
      )}
    </div>
  );
};

export default Atendimento;