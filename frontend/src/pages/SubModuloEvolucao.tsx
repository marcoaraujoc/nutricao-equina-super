// frontend/src/pages/SubModuloEvolucao.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Pencil, Trash2, Printer, Mic, MicOff,
  Check, X, ChevronLeft, ChevronRight, AlertTriangle,
  Share2, FileText, CheckCircle2, Loader2,
  User, Filter, Eye, Ban, Paperclip,
  Image, Film, Volume2, Lock, MessageCircle, Mail, UserCheck, CircleDot,
} from 'lucide-react';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import { buscarRelatorioAtendimento, type RelatorioAtendimentoDados } from '../utils/RelatorioAtendimento';
import RelatorioAtendimentoModal from '../components/RelatorioAtendimentoModal';
import { usePermissoes } from '../hooks/usePermissoes';
import { formatDate as formatarData, formatDateTime as formatarDataHora, TOLERANCIA_INICIO_MS } from '../utils/dateUtils';
import DateInput from '../components/DateInput';

import {
  isMobile     as detectarMobile,
  estaOnline,
  carregarModelo,
  transcreverOffline,
} from '../services/whisperService';
import InlineError from '../components/InlineError';
import JustificativaCancelamento from '../components/JustificativaCancelamento';


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

// ─── Types ────────────────────────────────────────────────────────────────────

type EvolucaoStatus = 'EM_ANDAMENTO' | 'FINALIZADA' | 'CANCELADA';
type TipoMidia      = 'IMAGEM' | 'VIDEO' | 'AUDIO';

interface Vet { id: number; fullName: string }

interface EvolucaoMidia {
  id:       number;
  tipo:     TipoMidia;
  url:      string;
  nome:     string;
  tamanho?: number | null;
  criadoEm: string;
}

interface AgendamentoItem {
  id:       number;
  titulo:   string;
  tipo:     string;
  dataHora: string;
  numero:   number | null;
}

interface EvolucaoAtiva {
  id:               number;
  numero:           number | null;
  tipoAtendimento:  string | null;
  atendimentoNumero: string | null;
  // Quem CONDUZ a evolução. O shell precisa disto para decidir se pode oferecer
  // "Finalizar Atendimento": com atendimento em paralelo, a evolução ativa pode ser
  // de outro profissional, e finalizar o atendimento alheio não é opção de ninguém
  // que não seja o gestor (premissa de autoria — CLAUDE.md 28-c).
  veterinarioId:    number | null;
  // Distingue duas evoluções abertas do MESMO paciente e do MESMO profissional
  // (consultas diferentes no mesmo dia) — ver CLAUDE.md, sessão 2026-08-18 parte 3.
  agendamentoId?:   number | null;
  // Rótulo do banner do shell ("Atendimento AG-0013 de 25/08/2026 17:11 - Consulta
  // clínica geral - Em andamento"). `titulo` só existe depois que a IA o gera na
  // finalização, então enquanto o atendimento corre o rótulo é a especialidade.
  dataInicio?:      string | null;
  titulo?:          string | null;
  especialidade?:   string | null;
}

/**
 * Evolução em andamento de OUTRO profissional, encontrada quando o usuário tenta
 * abrir uma nova — vem da listagem OU do 409 EVOLUCAO_EM_ANDAMENTO do backend (que
 * é a fonte autoritativa: a lista da tela pode estar filtrada/paginada).
 * A evolução aberta pelo PRÓPRIO usuário nunca chega aqui: ela bloqueia a criação
 * (finalizar/cancelar antes) e não é assumível.
 */
interface EvolucaoAbertaInfo {
  id:                number;
  atendimentoNumero: string | null;
  dataInicio:        string;
  especialidade:     string;
  titulo:            string | null;
  veterinarioId:     number | null;
  veterinarioNome:   string | null;
}

interface EvolucaoItem {
  id:               number;
  animalId:         number;
  veterinarioId:    number;
  /** null quando o autor foi removido do sistema */
  veterinario:      Vet | null;
  modificadoPorId?: number | null;
  modificadoPor?:   Vet | null;
  especialidade:    string;
  status:           EvolucaoStatus;
  texto:            string;
  titulo?:          string | null;
  numero?:          number | null;
  tipoAtendimento?: string | null;
  atendimentoNumero?: string | null;
  // Agendamento de origem — é o que prova que duas evoluções MINHAS abertas para o
  // mesmo animal são consultas DISTINTAS (ex.: Clínica × Dermatologia no mesmo dia),
  // não uma duplicata. null = evolução avulsa (EV-XXXX, sem agendamento vinculado).
  agendamentoId?:   number | null;
  dataInicio:       string;
  dataFim?:         string | null;
  dataModificacao?: string | null;
  ativo:            boolean;
  aprovado:         boolean;
  midias:           EvolucaoMidia[];
  // Justificativa do cancelamento/exclusão — só preenchida quando status é CANCELADA.
  justificativaExclusao?: string | null;
}

function montarTextoEvolucao(ev: EvolucaoItem): string {
  const titulo = ev.titulo?.trim() || 'Evolução clínica';
  return [
    '*Evolução Clínica*',
    ev.atendimentoNumero ? `Atendimento: ${ev.atendimentoNumero}` : '',
    `Título: ${titulo}`,
    `Especialidade: ${ev.especialidade}`,
    `Data: ${formatarDataHora(ev.dataInicio)}`,
    ev.veterinario ? `Responsável: ${ev.veterinario.fullName}` : '',
    ev.texto ? `\n${ev.texto}` : '',
  ].filter(Boolean).join('\n');
}

interface FormEvolucao {
  especialidade: string;
  texto:         string;
  status:        EvolucaoStatus;
}

interface AcaoLLM {
  tipo:          string;
  descricao:     string;
  valorEstimado: number;
  quantidade:    number;
}

interface AcaoSelecionavel extends AcaoLLM { selecionada: boolean }

export interface AnimalInfo {
  nome:       string;
  photoUrl?:  unknown;
  raca?:      { nome: string } | null;
  user?:      { fullName: string; email: string } | null;
  idadeAnos?: number | null;
  logoUrl?:   string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: EvolucaoStatus; label: string }[] = [
  { value: 'EM_ANDAMENTO', label: 'Em Andamento' },
  { value: 'FINALIZADA',   label: 'Finalizada'   },
  { value: 'CANCELADA',    label: 'Cancelada'    },
];

const STATUS_CONFIG: Record<EvolucaoStatus, { label: string; cls: string }> = {
  EM_ANDAMENTO: { label: 'Em Andamento', cls: 'bg-blue-100 text-blue-700'       },
  FINALIZADA:   { label: 'Finalizada',   cls: 'bg-emerald-100 text-emerald-700' },
  CANCELADA:    { label: 'Cancelada',    cls: 'bg-red-100 text-red-700'         },
};

const FORM_INICIAL: FormEvolucao = { especialidade: 'Clínico', texto: '', status: 'EM_ANDAMENTO' };
const LIMIT_OPTIONS = [10, 20, 50];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getTipoMidia = (mimeType: string): TipoMidia => {
  if (mimeType.startsWith('image/')) return 'IMAGEM';
  if (mimeType.startsWith('video/')) return 'VIDEO';
  return 'AUDIO';
};

// ─── MidiaViewer ─────────────────────────────────────────────────────────────

function MidiaViewer({ midia, onRemover }: { midia: EvolucaoMidia; onRemover?: () => void }) {
  // Formato não suportado pelo navegador (ex: .ogg/Opus de nota de voz do
  // WhatsApp no Safari/iOS) → mostra aviso + download em vez de player morto.
  const [audioIncompativel, setAudioIncompativel] = useState(false);

  const icone = midia.tipo === 'IMAGEM' ? <Image size={14} className="text-blue-500" />
    : midia.tipo === 'VIDEO' ? <Film size={14} className="text-purple-500" />
    : <Volume2 size={14} className="text-emerald-500" />;

  return (
    <div className="flex flex-col gap-1.5">
      {midia.tipo === 'IMAGEM' && (
        <a href={midia.url} target="_blank" rel="noreferrer">
          <img src={midia.url} alt={midia.nome}
            className="w-full max-h-48 object-cover rounded-xl border border-gray-100 hover:opacity-90 transition-opacity cursor-pointer" />
        </a>
      )}
      {midia.tipo === 'VIDEO' && (
        <video src={midia.url} controls
          className="w-full rounded-xl border border-gray-100" style={{ maxHeight: 200 }} />
      )}
      {midia.tipo === 'AUDIO' && (
        audioIncompativel ? (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
            <span className="text-xs text-amber-800 flex-1">
              Este navegador não reproduz o formato do áudio.
            </span>
            <a href={midia.url} download={midia.nome}
              className="text-xs font-semibold text-amber-800 underline flex-shrink-0">
              Baixar
            </a>
          </div>
        ) : (
          <audio src={midia.url} controls className="w-full"
            onError={() => setAudioIncompativel(true)} />
        )
      )}
      <div className="flex items-center gap-1.5">
        {icone}
        <span className="text-[11px] text-gray-500 truncate flex-1">{midia.nome}</span>
        {onRemover && (
          <button onClick={onRemover}
            className="p-0.5 text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ViewEvolucaoModal ────────────────────────────────────────────────────────

function ViewEvolucaoModal({ ev, onClose, onImprimir, podeImprimir }: {
  ev:         EvolucaoItem;
  animal:     AnimalInfo | null;
  onClose:    () => void;
  onImprimir: () => void;
  podeImprimir: boolean;
}) {
  const midias = ev.midias ?? [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[88vh] flex flex-col border border-gray-100">

        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            {ev.titulo && (
              <p className="text-sm font-semibold text-gray-900 mb-1.5">{ev.titulo}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {ev.atendimentoNumero && (
                <span className="font-mono font-bold text-emerald-700 text-xs">
                  {ev.atendimentoNumero}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CONFIG[ev.status].cls}`}>
                {STATUS_CONFIG[ev.status].label}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {ev.especialidade}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
              <span className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-600">{ev.veterinario?.fullName ?? '—'}</span>
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{ev.texto}</p>

          {midias.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Anexos ({midias.length})
              </p>
              <div className="grid grid-cols-1 gap-3">
                {midias.map(m => (
                  <MidiaViewer key={m.id} midia={m} />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          {podeImprimir && (
            <button onClick={onImprimir}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-blue-200 rounded-xl text-sm text-blue-600 font-medium hover:bg-blue-50 transition-colors">
              <Printer size={14} /> Imprimir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmacaoEncaminhamentoModal ───────────────────────────────────────────

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
          <p className="text-xs text-gray-500 mt-1">Selecione os encaminhamentos que deseja registrar</p>
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
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">ENCAMINHAMENTO</span>
                </div>
                <p className="text-xs text-gray-700 leading-snug">{a.descricao}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Valor a definir pelo especialista</p>
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

// ─── CancelamentoModal ────────────────────────────────────────────────────────
// Evolução EM_ANDAMENTO ou FINALIZADA nunca é excluída (hard delete) pela UI — só
// CANCELADA, com justificativa obrigatória (auditável). Único uso restante deste
// modal; antes existia um par "excluir/cancelar" e o de excluir ficou órfão.

function CancelamentoModal({ ev, onConfirmar, onCancelar, saving }: {
  ev:          EvolucaoItem;
  onConfirmar: (j: string) => void;
  onCancelar:  () => void;
  saving:      boolean;
}) {
  const [justificativa, setJustificativa] = useState('');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <Ban size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Cancelar evolução</h3>
            <p className="text-xs text-gray-500">{ev.especialidade} — {formatarData(ev.dataInicio)}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          A evolução ficará como CANCELADA e não poderá mais ser editada. A justificativa ficará registrada no sistema.
        </p>
        <textarea autoFocus value={justificativa}
          onChange={e => setJustificativa(e.target.value)}
          placeholder="Justificativa (obrigatório) *"
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 resize-none mb-4" />

        <InlineError message={erroInline} className="mb-4" />

        <div className="flex gap-3">
          <button onClick={onCancelar}
            className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          <button
            onClick={() => {
              if (!justificativa.trim()) { setErroInline('Informe a justificativa'); return; }
              onConfirmar(justificativa.trim());
            }}
            disabled={saving}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Processando...' : 'Confirmar Cancelamento'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EvolucaoAbertaModal ──────────────────────────────────────────────────────
// Existe evolução em andamento de OUTRO profissional para o paciente. Em vez de
// bloquear, o usuário decide: ASSUMIR a evolução (o responsável anterior é avisado
// por e-mail e WhatsApp) ou ABRIR UMA NOVA em paralelo (o outro também é avisado).
// A evolução aberta pelo PRÓPRIO usuário não passa por aqui — ela bloqueia a
// criação de outra e não pode ser assumida (o caminho é editar/finalizar/cancelar).

function EvolucaoAbertaModal({ info, animalNome, onAssumir, onCriarNova, onCancelar, saving }: {
  info:        EvolucaoAbertaInfo;
  animalNome?: string;
  onAssumir:   () => void;
  onCriarNova: () => void;
  onCancelar:  () => void;
  saving:      boolean;
}) {
  const responsavel = info.veterinarioNome ?? 'outro profissional';
  const numero       = info.atendimentoNumero;
  // "por" (gênero-neutro), nunca "pela"/"pelo": `responsavel` pode ser qualquer profissional.
  const titulo    = `Evolução${numero ? ` ${numero}` : ''}${animalNome ? ` do paciente ${animalNome}` : ''} está em andamento`;
  // `formatarDataHora` separa data e hora por vírgula (padrão do app); aqui, dentro da
  // frase, "às" lê melhor — troca só nesta string, sem mexer no util compartilhado.
  const subtitulo = `${numero ? `A evolução ${numero}` : 'A evolução'} foi iniciada em ${formatarDataHora(info.dataInicio).replace(', ', ' às ')} por ${responsavel}`;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="flex items-center gap-3 p-6 pb-4 rounded-t-2xl">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-amber-600" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900">{titulo}</h3>
          </div>
        </div>

        <div className="px-6">
          <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-4">
            <p className="text-sm text-gray-700 flex items-start gap-1.5">
              <User size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
              <span>{subtitulo}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 p-6 pt-4">
          <button
            onClick={onAssumir}
            disabled={saving}
            className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
            Assumir a evolução
          </button>
          <button
            onClick={onCriarNova}
            disabled={saving}
            className="w-full py-2.5 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 rounded-xl text-sm font-semibold transition-colors">
            Criar uma nova evolução
          </button>
          <button
            onClick={onCancelar}
            disabled={saving}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 font-medium">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NovaEvolucaoModal ────────────────────────────────────────────────────────

function NovaEvolucaoModal({
  form, editingId, midias, saving, interpretando,
  agendamentos, agendamentoId, onAgendamentoChange,
  onFormChange, onSalvar, onFinalizar, onClose,
  onArquivosChange, onRemoverMidia, somenteLeitura = false,
  podeSalvar, podeFinalizar,
}: {
  form:              FormEvolucao;
  editingId:         number | null;
  midias:            EvolucaoMidia[];
  saving:            boolean;
  interpretando:     boolean;
  agendamentos:      AgendamentoItem[];
  agendamentoId:     number | null;
  onAgendamentoChange: (id: number | null) => void;
  onFormChange:      (f: keyof FormEvolucao, v: string) => void;
  onSalvar:          () => void;
  onFinalizar:       () => void;
  onClose:           () => void;
  onArquivosChange:  (files: File[]) => void;
  onRemoverMidia:    (id: number) => void;
  somenteLeitura?:   boolean;
  // Cada botão segue o SEU slug: Salvar = criar/alterar, Finalizar = finalizar.
  // Ter "alterar" não dá direito a finalizar, e vice-versa.
  podeSalvar:        boolean;
  podeFinalizar:     boolean;
}) {
  const [gravacaoAtiva,        setGravacaoAtiva]        = useState(false);
  const [transcrevendo,        setTranscrevendo]        = useState(false);
  const [, setModoOffline]                               = useState(false);
  const [, setProgressModelo]                            = useState(0);
  const [showRecordAgain,      setShowRecordAgain]      = useState(false);
  const [mobile,               setMobile]               = useState(false);
  const [arquivosSelecionados, setArquivosSelecionados] = useState<File[]>([]);
  // Áudios anexados aguardando resposta de "deseja transcrever?" (um por vez)
  const [audiosPendentes,      setAudiosPendentes]      = useState<File[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  // Ditado, anexo e "Limpar" só existem para quem pode gravar a evolução —
  // com apenas VER na matriz, o formulário é vitrine.
  const podeEscrever = !somenteLeitura && podeSalvar;

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

  const adicionarArquivos = (files: FileList | null) => {
    if (!files) return;
    const novos = Array.from(files);
    setArquivosSelecionados(prev => {
      const atualizados = [...prev, ...novos];
      onArquivosChange(atualizados);
      return atualizados;
    });
    // Áudio anexado → pergunta se o usuário quer transcrever para o campo
    // "Evolução clínica". O arquivo permanece anexado em qualquer resposta.
    const audios = novos.filter(f => getTipoMidia(f.type) === 'AUDIO');
    if (audios.length > 0) setAudiosPendentes(prev => [...prev, ...audios]);
  };

  const removerNovoArquivo = (idx: number) => {
    setArquivosSelecionados(prev => {
      const removido   = prev[idx];
      const atualizados = prev.filter((_, i) => i !== idx);
      onArquivosChange(atualizados);
      if (removido) setAudiosPendentes(p => p.filter(f => f !== removido));
      return atualizados;
    });
  };

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
    } catch { setErroInline('Não foi possível acessar o microfone'); }
  };

  const pararMediaRecorder = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setGravacaoAtiva(false);
    setTranscrevendo(true);
  };

  const transcreverBlob = async (blob: Blob, nomeArquivo = 'recording.webm', mostrarContinuar = true) => {
    try {
      if (estaOnline()) {
        const fd = new FormData();
        fd.append('audio', blob, nomeArquivo);
        const res = await api.post('/clinica/evolucoes/transcrever', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const texto = res.data.dados.texto as string;
        onFormChange('texto', (textoRef.current + ' ' + texto).trim());
      } else {
        const texto = await transcreverOffline(blob);
        onFormChange('texto', (textoRef.current + ' ' + texto).trim());
      }
      if (mostrarContinuar) setShowRecordAgain(true);
    } catch { setErroInline(estaOnline() ? 'Erro ao transcrever' : 'Erro no Whisper offline'); }
    finally { setTranscrevendo(false); }
  };

  // Transcreve um áudio ANEXADO (após confirmação do usuário) — o texto vai
  // para o campo "Evolução clínica" e o arquivo continua anexado normalmente.
  const transcreverAudioAnexado = async () => {
    const arquivo = audiosPendentes[0];
    if (!arquivo) return;
    setAudiosPendentes(prev => prev.slice(1));
    setTranscrevendo(true);
    await transcreverBlob(arquivo, arquivo.name, false);
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
        setErroInline('Permissão de microfone negada');
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

  const desativado    = saving || interpretando;
  const todasMidias   = [...midias];

  return (
    // Mexeu no formulário, o erro anterior perdeu a validade: some. React normaliza
    // `change` para BORBULHAR, então um handler no container cobre todo
    // input/select/textarea de dentro — inclusive os que vierem depois.
    <div className="border-b border-gray-100"
      onChange={() => setErroInline(null)}
      onInput={() => setErroInline(null)}>
      {somenteLeitura && (
        <div className="flex items-center gap-1.5 px-5 pt-4 -mb-2">
          <Eye size={12} className="text-gray-400" />
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Visualização — somente leitura
          </p>
        </div>
      )}
      <fieldset disabled={somenteLeitura} className="p-5 space-y-4 border-0 m-0 min-w-0">

          <InlineError message={erroInline} />

          {!editingId && agendamentos.length > 0 && (
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Agendamento vinculado</label>
              <select
                value={agendamentoId ?? ''}
                onChange={e => onAgendamentoChange(e.target.value ? Number(e.target.value) : null)}
                className="w-full border border-emerald-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-emerald-500 bg-emerald-50">
                <option value="">Sem agendamento (EV-XXXX)</option>
                {agendamentos.map(a => {
                  const d = new Date(a.dataHora);
                  // ADIANTAR é permitido: o agendamento futuro pode ser atendido agora.
                  // O rótulo só AVISA que o horário marcado ainda não chegou.
                  const futuro = d.getTime() - Date.now() > TOLERANCIA_INICIO_MS;
                  const label = a.numero
                    ? `AG-${String(a.numero).padStart(4, '0')} — ${a.titulo} (${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`
                    : `${a.titulo} (${d.toLocaleDateString('pt-BR')})`;
                  return (
                    <option key={a.id} value={a.id}>
                      {label}{futuro ? ' — adiantando' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          {/* ⚠️ NÃO reintroduzir um seletor de "Status" aqui (removido em 2026-08-04).
              O status da evolução é consequência da AÇÃO, não um campo digitável:
              Salvar mantém EM_ANDAMENTO, Finalizar leva a FINALIZADA e Cancelar leva a
              CANCELADA — cada um com o seu gate de permissão e, no cancelamento, com a
              justificativa obrigatória que a auditoria exige. Escolher o status na mão
              contornava tudo isso: bastava marcar "Cancelada" e Salvar para cancelar um
              atendimento sem motivo nenhum registrado. */}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Evolução clínica *</label>
              <div className="flex items-center gap-2">
                {podeEscrever && form.texto && !gravacaoAtiva && !transcrevendo && (
                  <button onClick={() => onFormChange('texto', '')}
                    className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
                )}
                {/* Ditado escreve na evolução — sem permissão de gravar, não existe */}
                {podeEscrever && !showRecordAgain && !transcrevendo && (
                  mobile ? (
                    <button
                      onClick={() => (gravacaoAtiva ? pararGravacao() : iniciarGravacao())}
                      onContextMenu={e => e.preventDefault()}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium select-none transition-all ${
                        gravacaoAtiva ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}>
                      {gravacaoAtiva
                        ? <><MicOff size={11} /> Encerrar Evolução</>
                        : <><Mic size={11} /> Iniciar Evolução</>}
                    </button>
                  ) : (
                    !gravacaoAtiva && (
                      <button onClick={iniciarGravacao}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                        <Mic size={11} /> Iniciar fala
                      </button>
                    )
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
                : gravacaoAtiva && mobile ? '🔴 Gravando… toque em "Encerrar Evolução" para finalizar'
                : transcrevendo           ? '⏳ Transcrevendo…'
                : 'Descreva a evolução clínica do paciente…'
              }
              rows={8}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none resize-none transition-colors ${
                gravacaoAtiva ? 'border-red-300 bg-red-50/30' : 'border-gray-200 focus:border-emerald-500'
              }`} />

            {gravacaoAtiva && (
              <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse flex-shrink-0" />
                <span className="text-xs text-red-700 font-medium flex-1">
                  {mobile ? 'Gravando… toque em "Encerrar Evolução" para finalizar.' : 'Gravando… clique novamente para encerrar.'}
                </span>
                {!mobile && (
                  <button onClick={pararGravacao}
                    className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex-shrink-0">
                    <MicOff size={11} /> Encerrar Gravação
                  </button>
                )}
              </div>
            )}

            {podeEscrever && showRecordAgain && !gravacaoAtiva && !transcrevendo && (
              <div className="flex items-center justify-end mt-2">
                <button onClick={() => { setShowRecordAgain(false); iniciarGravacao(); }}
                  className="flex items-center justify-center gap-1 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold">
                  <Mic size={12} /> Continuar Gravando
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Anexos</label>
              <label className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                desativado
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
                <Paperclip size={11} />
                Adicionar
                <input type="file" className="hidden" multiple
                  accept="image/*,video/*,audio/*"
                  disabled={desativado}
                  onChange={e => adicionarArquivos(e.target.files)} />
              </label>
            </div>

            {todasMidias.length > 0 && (
              <div className="space-y-2 mb-2">
                {todasMidias.map(m => (
                  <MidiaViewer key={m.id} midia={m} onRemover={() => onRemoverMidia(m.id)} />
                ))}
              </div>
            )}

            {arquivosSelecionados.length > 0 && (
              <div className="space-y-1.5">
                {arquivosSelecionados.map((f, i) => {
                  const tipo  = getTipoMidia(f.type);
                  const icone = tipo === 'IMAGEM'
                    ? <Image  size={13} className="text-blue-500 flex-shrink-0" />
                    : tipo === 'VIDEO'
                    ? <Film   size={13} className="text-purple-500 flex-shrink-0" />
                    : <Volume2 size={13} className="text-emerald-500 flex-shrink-0" />;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl">
                      {icone}
                      <span className="text-xs text-gray-700 truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{formatBytes(f.size)}</span>
                      <button onClick={() => removerNovoArquivo(i)}
                        className="p-0.5 text-red-500 hover:text-red-600 transition-colors flex-shrink-0">
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {todasMidias.length === 0 && arquivosSelecionados.length === 0 && (
              <label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-300 transition-colors">
                <Paperclip size={18} className="text-gray-300" />
                <span className="text-xs text-gray-400">Imagem, vídeo ou áudio</span>
                <input type="file" className="hidden" multiple
                  accept="image/*,video/*,audio/*"
                  disabled={desativado}
                  onChange={e => adicionarArquivos(e.target.files)} />
              </label>
            )}

            {audiosPendentes.length > 0 && !transcrevendo && (
              <div className="mt-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                  <Volume2 size={13} className="flex-shrink-0" />
                  Transcrever o áudio "{audiosPendentes[0].name}" para o campo Evolução clínica?
                </p>
                <div className="flex gap-2">
                  <button onClick={transcreverAudioAnexado}
                    className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors">
                    Sim, transcrever
                  </button>
                  <button onClick={() => setAudiosPendentes(prev => prev.slice(1))}
                    className="flex-1 py-2 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-semibold transition-colors">
                    Não, apenas anexar
                  </button>
                </div>
              </div>
            )}
          </div>

        </fieldset>

      <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-4 border-t border-gray-100">
        {somenteLeitura ? (
          <button onClick={onClose}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
            Fechar
          </button>
        ) : (
          <>
            <button onClick={onClose} disabled={desativado}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
              Cancelar
            </button>
            {podeSalvar && (
              <button onClick={onSalvar} disabled={desativado || gravacaoAtiva || transcrevendo || !form.texto.trim()}
                className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 flex items-center gap-1.5">
                {saving && !interpretando && <Loader2 size={13} className="animate-spin" />}
                Salvar
              </button>
            )}
            {podeFinalizar && (
              <button onClick={onFinalizar} disabled={desativado || gravacaoAtiva || transcrevendo || !form.texto.trim()}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                {interpretando && <Loader2 size={13} className="animate-spin" />}
                {interpretando ? 'Analisando…' : saving ? 'Finalizando…' : 'Finalizar'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Nº do atendimento na lista do histórico (AG-0013 / EV-0007).
 *
 * Para evolução EM ANDAMENTO ele é o BOTÃO que carrega aquele atendimento na tela:
 * o banner do shell passa a descrevê-lo e prescrição, exame, encaminhamento e vacina
 * lançados nas abas passam a se vincular a ele. É a única forma de escolher entre
 * dois atendimentos abertos do mesmo paciente (consultas distintas no mesmo dia).
 *
 * ⚠️ UM componente para mobile e desktop de propósito: duas cópias do mesmo rótulo
 * divergem na primeira correção (a lição do `SubModuloMinhaAgenda`, armadilha 28-g).
 * ⚠️ Fora do estado EM ANDAMENTO continua sendo TEXTO — atendimento fechado não é
 * "o de agora", e um botão que não faz nada é pior que nenhum botão (armadilha 28-d).
 */
function NumeroAtendimento({ numero, emAndamento, ativo, onSelecionar, className = '' }: {
  numero:       string | null | undefined;
  emAndamento:  boolean;
  ativo:        boolean;
  onSelecionar?: () => void;
  className?:   string;
}) {
  const rotulo = numero ?? '—';
  if (!emAndamento || !onSelecionar) {
    return <span className={`font-mono font-bold text-emerald-700 ${className}`}>{rotulo}</span>;
  }
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onSelecionar(); }}
      aria-pressed={ativo}
      title={ativo ? 'Atendimento carregado na tela' : 'Carregar este atendimento na tela'}
      className={`inline-flex items-center gap-1 font-mono font-bold rounded-lg px-1.5 py-0.5 -mx-1.5 transition-colors ${
        ativo ? 'text-emerald-800 bg-emerald-100 ring-1 ring-emerald-300'
              : 'text-emerald-700 hover:bg-emerald-50 hover:underline'} ${className}`}
    >
      {ativo && <CircleDot size={11} className="text-emerald-600 animate-pulse flex-shrink-0" />}
      {rotulo}
    </button>
  );
}

// ─── SubModuloEvolucao ────────────────────────────────────────────────────────

interface Props {
  animalId:           number;
  animal:             AnimalInfo | null;
  faturaId:           number | null;
  onFaturaAtualizada: () => void;
  /** TODAS as evoluções EM ANDAMENTO do paciente, a cada recarga da lista. É a FONTE
   *  DA VERDADE do banner do shell — quem escolhe entre elas é o usuário (clique) ou
   *  `escolherEvolucaoAtiva`, nunca este submódulo. */
  onEvolucoesAbertasChange?: (abertas: EvolucaoAtiva[]) => void;
  /** Evolução recém-ABERTA aqui. Separada da lista de propósito: o shell a seleciona
   *  na hora, sem esperar a recarga — quem acabou de abrir o atendimento é quem o
   *  conduz, e é a ele que a prescrição lançada em seguida se vincula. */
  onEvolucaoCriada?:  (ev: EvolucaoAtiva) => void;
  /** Atendimento CARREGADO no shell (o do banner). Marca a linha correspondente no
   *  histórico — sem isso, com dois em andamento não há como saber qual está ativo. */
  evolucaoAtivaId?:   number | null;
  /** Clique no Nº de uma evolução EM ANDAMENTO: carrega aquele atendimento no shell.
   *  É o que faz prescrição, exame, encaminhamento e vacina passarem a se vincular a
   *  ele. Ausente = a coluna Nº fica só como texto (nada a trocar). */
  onSelecionarEvolucao?: (id: number) => void;
  onSalvo?:           () => void;
  openItemId?:        number;
  onViewConsumed?:    () => void;
  editItemId?:        number | null;
  onEditConsumed?:    () => void;
  agendamentoId?:     number;
  /** Visualizar/Editar no Histórico de Evolução Clínica: pede ao shell para
   *  carregar prescrição/exame/vacina do atendimento nas abas correspondentes. */
  onAbrirAtendimento?: (evolucaoId: number, modo: 'visualizar' | 'editar') => void;
}

export default function SubModuloEvolucao({ animalId, animal, faturaId, onFaturaAtualizada, onEvolucoesAbertasChange, onEvolucaoCriada, evolucaoAtivaId, onSelecionarEvolucao, onSalvo, openItemId, onViewConsumed, editItemId, onEditConsumed, agendamentoId: agendamentoIdProp, onAbrirAtendimento }: Props) {
  const { user } = useAuth();
  const { podeExecutar, isGestor, permissoes, loading: loadingPerms } = usePermissoes();

  const podeCriar     = isGestor || podeExecutar('atendimento.evolucoes.criar');
  const podeEditar    = isGestor || podeExecutar('atendimento.evolucoes.editar');
  const podeFinalizar = isGestor || podeExecutar('atendimento.evolucoes.finalizar');
  const podeImprimir  = isGestor || podeExecutar('atendimento.evolucoes.imprimir');
  const podeDeletar   = isGestor || podeExecutar('atendimento.evolucoes.deletar');

  /**
   * AUTORIA (CLAUDE.md 28-c) — FONTE ÚNICA da regra nesta tela.
   * A ação concedida vale sobre a evolução que a pessoa criou ou ASSUMIU; a de outro
   * profissional é do gestor, ou de ninguém até que alguém a assuma. Vale para
   * alterar, finalizar, excluir e cancelar — NÃO para "assumir", que é justamente
   * sobre a evolução alheia e usa o nível cru.
   */
  const ehMinhaEvolucao = (ev: { veterinarioId: number | null }) =>
    isGestor || ev.veterinarioId === (user?.id ?? 0);

  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  // ── State ──────────────────────────────────────────────────────────────────
  const [evolucoes,      setEvolucoes]      = useState<EvolucaoItem[]>([]);
  const [responsaveis,   setResponsaveis]   = useState<{ id: number; fullName: string }[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [total,          setTotal]          = useState(0);
  const [page,           setPage]           = useState(1);
  const [limit,          setLimit]          = useState(10);

  const [filterStatus,      setFilterStatus]      = useState('');
  const [filtroDataInicio,  setFiltroDataInicio]  = useState('');
  const [filtroDataFim,     setFiltroDataFim]     = useState('');
  const [filtroResponsavel, setFiltroResponsavel] = useState('');

  const [agendamentosDisponiveis,   setAgendamentosDisponiveis]   = useState<AgendamentoItem[]>([]);
  const [agendamentoSelecionadoId, setAgendamentoSelecionadoId] = useState<number | null>(null);

  const [showModal,      setShowModal]      = useState(true);
  const [viewingEv,      setViewingEv]      = useState<EvolucaoItem | null>(null);
  const [editingEv,      setEditingEv]      = useState<EvolucaoItem | null>(null);
  // Visualizar no Histórico de Evolução Clínica: popula os campos do formulário
  // da página em SOMENTE LEITURA (sem abrir popup).
  const [formLeitura,    setFormLeitura]    = useState(false);
  const [cancelandoEv,   setCancelandoEv]   = useState<EvolucaoItem | null>(null);
  const [form,           setForm]           = useState<FormEvolucao>(FORM_INICIAL);
  const [savingEv,       setSavingEv]       = useState(false);
  const [savingCancelamento, setSavingCancelamento] = useState(false);
  const [interpretando]                     = useState(false);
  const [acoesLLM,       setAcoesLLM]       = useState<AcaoSelecionavel[]>([]);
  const [showLLM,        setShowLLM]        = useState(false);
  const [savingFatura,   setSavingFatura]   = useState(false);
  const [arquivosModal,  setArquivosModal]  = useState<File[]>([]);
  const [imprimindoId,   setImprimindoId]   = useState<number | null>(null);
  const [relatorioModal, setRelatorioModal] = useState<{ ev: EvolucaoItem; dados: RelatorioAtendimentoDados } | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  // Evolução em andamento não bloqueia mais: abre a decisão (assumir × nova).
  // `criandoConcorrente` = o profissional já decidiu abrir uma NOVA em paralelo,
  // então o formulário renderiza e o POST vai com `confirmarConcorrente`.
  const [evolucaoAbertaInfo,  setEvolucaoAbertaInfo]  = useState<EvolucaoAbertaInfo | null>(null);
  const [criandoConcorrente,  setCriandoConcorrente]  = useState(false);
  const [assumindoEv,         setAssumindoEv]         = useState(false);

  const agendamentoPreSelecionado = useRef(false);
  // Só propõe a decisão (assumir × nova) uma vez por chegada da agenda.
  const decisaoAgendaProposta     = useRef(false);
  // Agendamento que o "Iniciar" da agenda já marcou EM_ANDAMENTO antes de saber
  // que havia conflito (evolução aberta de outro profissional). Guardado só
  // quando a decisão nasce DESSE caminho — nunca de um clique manual em "Nova
  // Evolução" nem de um 409 ao salvar — para Cancelar/Assumir/Criar-nova saberem
  // se há um agendamento "órfão" para reverter ou anexar. Ver os 3 handlers abaixo.
  const agendamentoConflitoOrigemRef = useRef<number | null>(null);

  // Rola a página até o formulário quando ele é populado via Visualizar/Alterar
  // (a tabela do histórico fica abaixo — sem isso o usuário não vê os campos).
  const formTopRef = useRef<HTMLDivElement>(null);
  const rolarParaFormulario = () =>
    setTimeout(() => formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);

  const totalPaginas       = Math.ceil(total / limit);
  const temEvolucaoAberta  = !loading && evolucoes.some(e => e.status === 'EM_ANDAMENTO');
  const filtrosAtivos      = !!(filtroDataInicio || filtroDataFim || filtroResponsavel || filterStatus);
  // Evolução aberta PELO PRÓPRIO usuário × por OUTRO profissional — os dois casos
  // seguem caminhos opostos: a própria BLOQUEIA abrir outra (finalize/cancele antes)
  // e não é assumível; a do outro abre a decisão (assumir × nova em paralelo).
  const minhaEvolucaoAberta   = !loading
    ? evolucoes.find(e => e.status === 'EM_ANDAMENTO' && e.veterinarioId === (user?.id ?? 0))
    : undefined;
  const evolucaoAbertaDeOutro = !loading
    ? evolucoes.find(e => e.status === 'EM_ANDAMENTO' && e.veterinarioId !== (user?.id ?? 0))
    : undefined;
  // Formulário e botão "Nova Evolução" são mutuamente exclusivos: um só existe
  // quando o outro não está na tela (senão a tela ficava sem os dois — o form
  // escondido pela evolução aberta e o botão escondido pelo showModal).
  const formularioVisivel  = showModal && (!temEvolucaoAberta || !!editingEv || criandoConcorrente);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const carregarEvolucoes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filterStatus)      params.set('status',        filterStatus);
      if (filtroDataInicio)  params.set('dataInicio',    filtroDataInicio);
      if (filtroDataFim)     params.set('dataFim',       filtroDataFim);
      if (filtroResponsavel) params.set('responsavelId', filtroResponsavel);
      const res = await api.get(`/clinica/evolucoes/animal/${animalId}?${params}`);
      // GET 403 → o interceptor resolve com data null (armadilha #23 do CLAUDE.md).
      // Sem este guard, `res.data.dados` estourava TypeError e caía no catch,
      // exibindo "Erro ao carregar evoluções" para um caso de permissão/contexto.
      // ⚠️ Esta lista é FILTRADA e PAGINADA pelos controles da tela — só serve como
      // retrato das evoluções abertas quando nenhum filtro pode estar escondendo uma
      // delas. Reportar um recorte ao shell APAGARIA do banner o atendimento em
      // paralelo que o usuário está conduzindo (e desvincularia a prescrição
      // seguinte). Filtrou algo? O shell segue com a lista da consulta própria dele.
      const retratoConfiavel =
        page === 1 &&
        (!filterStatus || filterStatus === 'EM_ANDAMENTO') &&
        !filtroDataInicio && !filtroDataFim && !filtroResponsavel;

      if (!res.data) {
        setEvolucoes([]); setTotal(0);
        if (retratoConfiavel) onEvolucoesAbertasChange?.([]);
        return;
      }
      const dados: EvolucaoItem[] = res.data.dados ?? [];
      setEvolucoes(dados);
      setTotal(res.data.total ?? 0);
      // Reporta TODAS as evoluções em andamento — nunca "a escolhida". O mesmo
      // paciente pode ter várias abertas (consultas distintas no mesmo dia, ex.:
      // Clínica e Dermatologia); escolher entre elas é do USUÁRIO (banner do shell),
      // e `escolherEvolucaoAtiva` só decide quando ele não escolheu.
      // ⚠️ Este submódulo NÃO decide mais qual é a ativa: um segundo lugar decidindo
      // fazia as telas discordarem sobre qual atendimento estava em curso.
      if (retratoConfiavel) {
        const abertas = dados.filter(e => e.status === 'EM_ANDAMENTO');
        onEvolucoesAbertasChange?.(abertas.map(e => ({
          id:               e.id,
          numero:           e.numero ?? null,
          tipoAtendimento:  e.tipoAtendimento ?? null,
          atendimentoNumero: e.atendimentoNumero ?? null,
          veterinarioId:    e.veterinarioId ?? null,
          agendamentoId:    e.agendamentoId ?? null,
          dataInicio:       e.dataInicio ?? null,
          titulo:           e.titulo ?? null,
          especialidade:    e.especialidade ?? null,
        })));
      }
    } catch { setErroInline('Erro ao carregar evoluções'); }
    finally { setLoading(false); }
  }, [animalId, page, limit, filterStatus, filtroDataInicio, filtroDataFim, filtroResponsavel, onEvolucoesAbertasChange]);

  useEffect(() => { if (!loadingPerms) carregarEvolucoes(); }, [carregarEvolucoes, loadingPerms]);

  // Trocar de paciente reabre a decisão: a proposta é por animal, não por sessão.
  useEffect(() => {
    decisaoAgendaProposta.current = false;
    agendamentoConflitoOrigemRef.current = null;
  }, [animalId]);

  useEffect(() => {
    if (loadingPerms) return;
    api.get(`/clinica/evolucoes/responsaveis/${animalId}`)
      .then(res => setResponsaveis(res.data?.dados ?? []))
      .catch(() => {});
  }, [animalId, loadingPerms]);

  useEffect(() => {
    if (!openItemId) return;
    api.get(`/clinica/evolucoes/${openItemId}`)
      .then(res => { if (res.data?.dados) setViewingEv(res.data.dados as EvolucaoItem); })
      .catch(() => {})
      .finally(() => onViewConsumed?.());
  }, [openItemId]);

  /**
   * Busca os agendamentos AGENDADO do animal (opções do seletor "Agendamento
   * vinculado") e, se `manterId` for informado e não estiver nessa lista, tenta
   * achá-lo mesmo assim: o "Iniciar" da agenda já marca o agendamento como
   * EM_ANDAMENTO ANTES de navegar para cá (CLAUDE.md, "Iniciar atendimento"), então
   * o filtro AGENDADO sozinho não o encontra mesmo sendo o agendamento certo. Sem
   * isso a evolução nasce sem `agendamentoId` e o agendamento fica travado em
   * EM_ANDAMENTO, sem nenhuma evolução apontando para ele.
   */
  const carregarAgendamentosParaFormulario = async (manterId?: number | null) => {
    let lista: AgendamentoItem[] = [];
    try {
      const res = await api.get(`/clinica/agendamentos/animal/${animalId}?status=AGENDADO`);
      lista = res.data?.dados ?? [];
    } catch { /* segue com a lista vazia — não impede o formulário de abrir */ }
    if (manterId && !lista.some(a => a.id === manterId)) {
      try {
        const res = await api.get(`/clinica/agendamentos/animal/${animalId}?status=EM_ANDAMENTO`);
        const encontrado = (res.data?.dados ?? []).find((a: AgendamentoItem) => a.id === manterId);
        if (encontrado) lista = [...lista, encontrado];
      } catch { /* mantém só o que já tinha */ }
    }
    return lista;
  };

  // Quando vindo da tela de Agendamentos via "Iniciar" (ou restaurando do localStorage):
  // pré-seleciona o agendamento no formulário de nova evolução assim que os dados carregarem.
  useEffect(() => {
    if (loading || !agendamentoIdProp || agendamentoPreSelecionado.current) return;
    // Chegou da agenda para iniciar o atendimento e o paciente já tem evolução
    // aberta. Três casos:
    //  - de OUTRO profissional → apresenta a decisão (assumir × abrir nova) em vez
    //    de ignorar o clique, propondo UMA vez para que cancelar o modal não a reabra;
    //  - MINHA, mas vinculada a este MESMO agendamento → é a que este "Iniciar" já
    //    deixou EM_ANDAMENTO; nada a preparar, ela já está na lista;
    //  - MINHA, vinculada a um agendamento DIFERENTE (ou nenhum) → consulta DISTINTA
    //    (ex.: já em atendimento na Clínica e "Iniciar" agora a de Dermatologia, mesmo
    //    animal, mesmo dia). O clique em "Iniciar" já É a decisão — não há nada para
    //    perguntar, então segue direto para preparar o formulário desta nova consulta,
    //    como se não houvesse bloqueio nenhum (espelha EvolucaoController.criar).
    if (temEvolucaoAberta && !criandoConcorrente) {
      if (evolucaoAbertaDeOutro && !minhaEvolucaoAberta && !decisaoAgendaProposta.current) {
        decisaoAgendaProposta.current = true;
        // Guarda QUAL agendamento o "Iniciar" já deixou EM_ANDAMENTO — é o que
        // permite Cancelar reverter, e Assumir/Criar-nova anexá-lo depois.
        agendamentoConflitoOrigemRef.current = agendamentoIdProp;
        setEvolucaoAbertaInfo(infoDaLista(evolucaoAbertaDeOutro));
        return;
      }
      if (minhaEvolucaoAberta && minhaEvolucaoAberta.agendamentoId !== agendamentoIdProp) {
        setCriandoConcorrente(true);
        // segue abaixo para preparar o formulário — não retorna aqui.
      } else {
        return;
      }
    }
    agendamentoPreSelecionado.current = true;
    carregarAgendamentosParaFormulario(agendamentoIdProp).then(lista => {
      setAgendamentosDisponiveis(lista);
      // Se o agendamento já foi concluído (não está mais em nenhuma das duas
      // listas), limpa o localStorage para não pré-selecionar novamente.
      if (lista.some(a => a.id === agendamentoIdProp)) {
        setAgendamentoSelecionadoId(agendamentoIdProp);
      } else {
        localStorage.removeItem(`s2vet_ag_${animalId}`);
      }
    });
  }, [loading, agendamentoIdProp, animalId, temEvolucaoAberta, criandoConcorrente, evolucoes]);

  // ── Rascunho automático (mobile-safe) ────────────────────────────────────────
  // Preserva o texto não salvo de uma NOVA evolução em localStorage a cada
  // alteração (inclui ditado por voz). Sobrevive ao refresh da página no celular;
  // só se perde no logout. Escopo: modo de criação (não edição/visualização).
  const rascunhoKey = `s2vet_ev_draft_${animalId}`;
  const rascunhoRestauradoAnimal = useRef<number | null>(null);

  // Restaura o rascunho ao montar / trocar de animal (antes de liberar o autosave).
  useEffect(() => {
    if (loadingPerms) return;
    if (rascunhoRestauradoAnimal.current === animalId) return;
    // Fluxo de editar/visualizar via prop tem prioridade — não restaura, mas
    // libera o autosave para as próximas evoluções novas deste animal.
    if (!editItemId && !openItemId) {
      const raw = localStorage.getItem(rascunhoKey);
      if (raw) {
        try {
          const d = JSON.parse(raw) as { especialidade?: string; texto?: string; agendamentoId?: number | null };
          if (d.texto && d.texto.trim()) {
            setForm({ especialidade: d.especialidade || 'Clínico', texto: d.texto, status: 'EM_ANDAMENTO' });
            if (d.agendamentoId) setAgendamentoSelecionadoId(d.agendamentoId);
            setShowModal(true);
          }
        } catch { /* rascunho corrompido — ignora */ }
      }
    }
    rascunhoRestauradoAnimal.current = animalId;
  }, [loadingPerms, animalId, editItemId, openItemId, rascunhoKey]);

  // Persiste o rascunho a cada alteração — só após a restauração ter rodado.
  useEffect(() => {
    if (rascunhoRestauradoAnimal.current !== animalId) return;
    if (editingEv || formLeitura) return; // só rascunho de nova evolução
    if (form.texto.trim()) {
      localStorage.setItem(rascunhoKey, JSON.stringify({
        especialidade: form.especialidade,
        texto:         form.texto,
        agendamentoId: agendamentoSelecionadoId,
      }));
    } else {
      localStorage.removeItem(rascunhoKey);
    }
  }, [form, editingEv, formLeitura, agendamentoSelecionadoId, animalId, rascunhoKey]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleFormChange = (field: keyof FormEvolucao, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // `manterAgendamentoId` é usado pelo "Criar uma nova" da decisão: o agendamento
  // que o "Iniciar" já deixou EM_ANDAMENTO precisa continuar selecionado, senão a
  // evolução nova nasce solta e ele fica travado sem nada apontando para ele.
  const prepararFormularioNovo = async (manterAgendamentoId?: number | null) => {
    setArquivosModal([]);
    setForm(FORM_INICIAL);
    setEditingEv(null);
    setFormLeitura(false);
    setAgendamentoSelecionadoId(null);
    const lista = await carregarAgendamentosParaFormulario(manterAgendamentoId);
    setAgendamentosDisponiveis(lista);
    if (manterAgendamentoId && lista.some(a => a.id === manterAgendamentoId)) {
      setAgendamentoSelecionadoId(manterAgendamentoId);
    }
    setShowModal(true);
  };

  // Evolução aberta da LISTA no formato da decisão — o backend devolve o mesmo
  // formato no 409 (fonte autoritativa quando a lista está filtrada/paginada).
  const infoDaLista = (ev: EvolucaoItem): EvolucaoAbertaInfo => ({
    id:                ev.id,
    atendimentoNumero: ev.atendimentoNumero ?? null,
    dataInicio:        ev.dataInicio,
    especialidade:     ev.especialidade,
    titulo:            ev.titulo ?? null,
    veterinarioId:     ev.veterinarioId,
    veterinarioNome:   ev.veterinario?.fullName ?? null,
  });

  const abrirNova = async () => {
    if (!podeCriar) { semPermissao('criar evolução'); return; }
    setErroInline(null);
    // A PRÓPRIA evolução aberta bloqueia, como sempre bloqueou: ninguém atende a si
    // mesmo em paralelo no mesmo paciente.
    if (minhaEvolucaoAberta) {
      setErroInline('Finalize ou cancele a evolução em andamento antes de criar uma nova.');
      return;
    }
    // Aberta por OUTRO profissional: decisão (assumir × abrir uma nova em paralelo).
    if (evolucaoAbertaDeOutro && !criandoConcorrente) {
      setEvolucaoAbertaInfo(infoDaLista(evolucaoAbertaDeOutro));
      return;
    }
    await prepararFormularioNovo();
  };

  // Abre a evolução informada no formulário de edição (usada após assumir e no
  // "continuar" da própria evolução aberta).
  // Assumir a evolução em andamento de outro profissional — ele é comunicado por
  // e-mail e WhatsApp pelo backend (mesma comunicação do assumir da agenda).
  const handleAssumirEvolucao = async (id: number) => {
    if (!podeEditar) { semPermissao('assumir evolução'); return; }
    setErroInline(null);
    setAssumindoEv(true);
    // O agendamento que o "Iniciar" já deixou EM_ANDAMENTO (se foi assim que a
    // decisão surgiu) não tem relação nenhuma com a evolução assumida — ela
    // MANTÉM o número que já tinha. O backend só o ANEXA (sem sobrescrever um
    // agendamento que a evolução assumida já possuía) e marca EM_ANDAMENTO nele.
    const agendamentoId = agendamentoConflitoOrigemRef.current;
    try {
      await api.patch(`/clinica/evolucoes/${id}/assumir`, agendamentoId ? { agendamentoId } : {});
      agendamentoConflitoOrigemRef.current = null;
      localStorage.removeItem(`s2vet_ag_${animalId}`);
      toast.success('Evolução assumida — o profissional anterior foi comunicado');
      setEvolucaoAbertaInfo(null);
      setCriandoConcorrente(false);
      // Assumir NÃO abre o formulário de edição (2026-08-04): assumir é passar a
      // responder pelo atendimento, não necessariamente editá-lo agora. A lista
      // recarrega e a evolução já aparece como sua, com as ações liberadas — quem
      // quiser escrever clica em Alterar. Abrir o editor por conta própria tirava o
      // usuário da lista a cada "Assumir".
      await carregarEvolucoes();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao assumir a evolução');
    } finally { setAssumindoEv(false); }
  };

  const handleCriarNovaConcorrente = async () => {
    // Idem: leva o agendamento recém-iniciado para o formulário, para a evolução
    // NOVA nascer com ele anexado (número próprio dela, `numero` gerado normalmente).
    const agendamentoId = agendamentoConflitoOrigemRef.current;
    agendamentoConflitoOrigemRef.current = null;
    setEvolucaoAbertaInfo(null);
    setCriandoConcorrente(true);
    await prepararFormularioNovo(agendamentoId);
  };

  // Cancelar a decisão (nem assumir, nem criar em paralelo) — quando ela nasceu do
  // "Iniciar" da agenda, o agendamento já tinha sido marcado EM_ANDAMENTO ANTES de
  // saber que havia conflito. Sem reverter aqui, ele fica preso nesse status para
  // sempre, sem nenhuma evolução criada/assumida por trás. Volta para AGENDADO — se
  // o horário já tiver passado, o cron `marcarAgendamentosAtrasados` o marca como
  // ATRASADA de novo na próxima varredura (é o único lugar que grava esse status).
  const handleCancelarDecisaoEvolucao = async () => {
    const agendamentoId = agendamentoConflitoOrigemRef.current;
    agendamentoConflitoOrigemRef.current = null;
    setEvolucaoAbertaInfo(null);
    if (!agendamentoId) return;
    try {
      await api.patch(`/clinica/agendamentos/${agendamentoId}/status`, { status: 'AGENDADO' });
    } catch { /* reversão best-effort — não impede o usuário de sair da decisão */ }
    localStorage.removeItem(`s2vet_ag_${animalId}`);
  };

  const fecharModal = () => {
    const wasEditing = !!editingEv;
    setShowModal(!wasEditing); // Keep form open for new; close when done editing
    setEditingEv(null);
    setForm(FORM_INICIAL);
    setArquivosModal([]);
    setAgendamentoSelecionadoId(null);
    setFormLeitura(false);
    // A decisão "abrir em paralelo" vale para UMA evolução: fechado o formulário,
    // a próxima tentativa volta a perguntar.
    setCriandoConcorrente(false);
  };

  const abrirEdicao = (ev: EvolucaoItem) => {
    setForm({ especialidade: ev.especialidade, texto: ev.texto, status: ev.status });
    setEditingEv(ev);
    setArquivosModal([]);
    // Sem permissão de alterar (ex: entrada pelo `editItemId` do Histórico do
    // Paciente), o formulário abre em SOMENTE LEITURA — nunca editável.
    // A AUTORIA entra aqui também: a evolução conduzida por outro profissional só é
    // editável pelo gestor. Sem isso, o `editItemId` do Histórico seria a porta dos
    // fundos para o formulário de edição do prontuário alheio.
    const meuRegistro = isGestor || ev.veterinarioId === (user?.id ?? 0);
    setFormLeitura(!podeEditar || !meuRegistro);
    setShowModal(true);
    rolarParaFormulario();
  };

  // Visualizar: mesmos campos populados, mas bloqueados para edição.
  const abrirVisualizacao = (ev: EvolucaoItem) => {
    setForm({ especialidade: ev.especialidade, texto: ev.texto, status: ev.status });
    setEditingEv(ev);
    setArquivosModal([]);
    setFormLeitura(true);
    setShowModal(true);
    rolarParaFormulario();
  };

  // Vindo do botão "Editar" do Histórico do Paciente (AG-XXXX/EV-XXXX): abre
  // direto no formulário de edição, sem passar pela visualização.
  const editIdAplicado = useRef<number | null>(null);
  useEffect(() => {
    if (!editItemId) { editIdAplicado.current = null; return; }
    if (editIdAplicado.current === editItemId) return;
    editIdAplicado.current = editItemId;
    api.get(`/clinica/evolucoes/${editItemId}`)
      .then(res => {
        if (res.data?.dados) abrirEdicao(res.data.dados as EvolucaoItem);
        onEditConsumed?.();
      })
      .catch(() => {});
  }, [editItemId]);

  const uploadMidias = async (evolucaoId: number, arquivos: File[]) => {
    for (const arquivo of arquivos) {
      try {
        const fd = new FormData();
        fd.append('midia', arquivo);
        fd.append('tipo', getTipoMidia(arquivo.type));
        await api.post(`/clinica/evolucoes/${evolucaoId}/midias`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch { setErroInline(`Erro ao enviar ${arquivo.name}`); }
    }
  };

  // 409 EVOLUCAO_EM_ANDAMENTO: outra evolução foi aberta enquanto este texto era
  // digitado (ou a lista da tela estava filtrada). Abre a decisão com os dados que
  // o backend devolveu — o texto do formulário é preservado.
  const tratarConflitoEvolucaoAberta = (err: unknown): boolean => {
    const resp = (err as { response?: { status?: number; data?: { code?: string; evolucaoAberta?: EvolucaoAbertaInfo } } })?.response;
    if (resp?.status !== 409 || resp.data?.code !== 'EVOLUCAO_EM_ANDAMENTO' || !resp.data.evolucaoAberta) return false;
    setEvolucaoAbertaInfo(resp.data.evolucaoAberta);
    return true;
  };

  const handleSalvar = async () => {
    if (editingEv ? !podeEditar : !podeCriar) {
      semPermissao(editingEv ? 'editar evolução' : 'criar evolução'); return;
    }
    if (!form.texto.trim()) {
      setErroInline('O texto da evolução é obrigatório');
      return;
    }
    setSavingEv(true);
    try {
      let evolucaoId: number;
      if (editingEv) {
        await api.put(`/clinica/evolucoes/${editingEv.id}`, {
          especialidade: form.especialidade,
          texto:         form.texto,
          // Salvar NÃO muda o status — preserva o que a evolução já tem. Antes ia
          // `form.status`, alimentado pelo seletor removido; enviar o status daqui
          // faria o "Salvar" virar um atalho para finalizar/cancelar sem passar pelos
          // botões (e, no cancelamento, sem a justificativa obrigatória).
          status:        editingEv.status,
        });
        evolucaoId = editingEv.id;
        toast.success('Evolução salva');
      } else {
        const res = await api.post('/clinica/evolucoes', {
          animalId,
          especialidade:  form.especialidade,
          texto:          form.texto,
          status:         'EM_ANDAMENTO',
          agendamentoId:  agendamentoSelecionadoId,
          confirmarConcorrente: criandoConcorrente,
        });
        evolucaoId = res.data.dados?.id as number;
        const criada = res.data.dados;
        onEvolucaoCriada?.({
          id:               criada.id,
          numero:           criada.numero ?? null,
          tipoAtendimento:  criada.tipoAtendimento ?? null,
          atendimentoNumero: criada.atendimentoNumero ?? null,
          // Acabou de criar: é dela mesma. Cai no `user?.id` quando o POST não
          // devolve o campo, senão o shell esconderia o Finalizar de quem prescreveu.
          veterinarioId:    criada.veterinarioId ?? user?.id ?? null,
          agendamentoId:    criada.agendamentoId ?? agendamentoSelecionadoId ?? null,
          dataInicio:       criada.dataInicio ?? new Date().toISOString(),
          titulo:           criada.titulo ?? null,
          especialidade:    criada.especialidade ?? form.especialidade,
        });
        localStorage.removeItem(`s2vet_ag_${animalId}`);
        localStorage.removeItem(rascunhoKey);
        toast.success('Evolução registrada');
      }
      // O backend já gera e grava o título via IA na mesma escrita (quando ainda
      // não existe um) — não precisa de uma segunda chamada/PATCH aqui.
      if (arquivosModal.length > 0) await uploadMidias(evolucaoId, arquivosModal);
      fecharModal();
      carregarEvolucoes();
      onSalvo?.();
    } catch (err: unknown) {
      if (tratarConflitoEvolucaoAberta(err)) return;
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao salvar evolução');
    } finally { setSavingEv(false); }
  };

  const handleFinalizar = async () => {
    if (!podeFinalizar) { semPermissao('finalizar evolução'); return; }
    // Editando a evolução de outro (o formulário abre em leitura, mas o guard fecha
    // qualquer outro caminho até aqui): assumir primeiro.
    if (editingEv && !ehMinhaEvolucao(editingEv)) {
      setErroInline('Este atendimento é conduzido por outro profissional. Assuma a evolução antes de finalizá-la.');
      return;
    }
    if (!form.texto.trim()) {
      setErroInline('O texto da evolução é obrigatório');
      return;
    }
    setSavingEv(true);
    let evolucaoId: number | undefined = editingEv?.id;

    try {
      // FINALIZAR NÃO ESPERA MAIS A IA. O backend gravava o título e devolvia `acoesIA`
      // na mesma escrita, e com isso o botão "Finalizar" ficava girando o tempo INTEIRO
      // da chamada ao Gemini — de <1s a mais de um minuto — com o atendimento já
      // gravado no banco. Agora a escrita volta na hora e a IA roda depois, por
      // `POST /:id/titulo-ia` (bloco após o fechamento do modal): uma só chamada, que
      // grava o título e devolve as sugestões de encaminhamento.
      if (editingEv) {
        await api.put(`/clinica/evolucoes/${editingEv.id}`, {
          especialidade: form.especialidade,
          texto:         form.texto,
          status:        'FINALIZADA',
        });
        evolucaoId = editingEv.id;
      } else {
        const createRes = await api.post('/clinica/evolucoes', {
          animalId,
          especialidade:  form.especialidade,
          texto:          form.texto,
          status:         'FINALIZADA',
          agendamentoId:  agendamentoSelecionadoId,
          confirmarConcorrente: criandoConcorrente,
        });
        evolucaoId = createRes.data.dados?.id as number | undefined;
        localStorage.removeItem(`s2vet_ag_${animalId}`);
        localStorage.removeItem(rascunhoKey);
        // Nasceu já FINALIZADA: não há atendimento aberto a reportar. Quem atualiza o
        // banner é o `carregarEvolucoes()` logo abaixo.
      }

      if (arquivosModal.length > 0 && evolucaoId) await uploadMidias(evolucaoId, arquivosModal);

      toast.success('Evolução finalizada!');
      fecharModal();
      carregarEvolucoes();
      onSalvo?.(); // atualiza o Histórico do Paciente no shell

      // Título + sugestões de encaminhamento, DEPOIS de a tela já estar livre: o modal
      // fechou, o toast saiu e a lista recarregou — a IA não segura mais nada.
      // ⚠️ Sem `await` de propósito, e FORA do try/catch do salvamento: falha aqui
      // não pode virar "Erro ao finalizar evolução", porque a evolução FOI finalizada.
      // ⚠️ O segundo `carregarEvolucoes()` é o que faz o título recém-gerado aparecer
      // na lista — na primeira recarga ele ainda não existia.
      if (evolucaoId) {
        api.post(`/clinica/evolucoes/${evolucaoId}/titulo-ia`)
          .then(res => {
            const acoesIA: AcaoLLM[] = res.data?.dados?.acoes ?? [];
            if (res.data?.dados?.titulo) carregarEvolucoes();
            const encaminhamentos = acoesIA.filter(a => a.tipo === 'ENCAMINHAMENTO');
            if (encaminhamentos.length > 0) {
              setAcoesLLM(encaminhamentos.map(a => ({ ...a, selecionada: true })));
              setShowLLM(true);
            }
          })
          .catch(() => { /* silencioso — título e sugestão são conveniência */ });
      }
    } catch (err: unknown) {
      if (tratarConflitoEvolucaoAberta(err)) return;
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao finalizar evolução');
    } finally { setSavingEv(false); }
  };

  // Cobre os DOIS gatilhos do botão Cancelar (Ban): evolução EM_ANDAMENTO (autoria +
  // nível de deletar) e FINALIZADA (gestor). Evolução EM_ANDAMENTO nunca é excluída
  // (hard delete) pela UI — só cancelada, mesma regra do Agendamento (ver
  // `AgendamentoController`): o registro fica auditável, nunca some.
  const handleCancelarEvolucao = async (justificativa: string) => {
    if (!cancelandoEv) return;
    // Cancelar usa o mesmo slug de EXCLUIR (é o que a rota /cancelar exige).
    if (!podeDeletar) { semPermissao('cancelar evolução'); return; }
    setSavingCancelamento(true);
    try {
      await api.patch(`/clinica/evolucoes/${cancelandoEv.id}/cancelar`, { justificativa });
      setCancelandoEv(null);
      toast.success('Evolução cancelada');
      // O banner do shell se corrige pela recarga: a cancelada sai da lista de
      // abertas e, se era a selecionada, a escolha volta ao automático.
      carregarEvolucoes();
      onSalvo?.(); // atualiza o Histórico do Paciente no shell
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao cancelar evolução');
    } finally { setSavingCancelamento(false); }
  };

  const handleRemoverMidia = async (evolucaoId: number, midiaId: number) => {
    try {
      await api.delete(`/clinica/evolucoes/${evolucaoId}/midias/${midiaId}`);
      carregarEvolucoes();
      if (editingEv?.id === evolucaoId) {
        setEditingEv(prev => prev
          ? { ...prev, midias: prev.midias.filter(m => m.id !== midiaId) }
          : prev
        );
      }
    } catch { setErroInline('Erro ao remover mídia'); }
  };

  const handleAprovar = async (id: number) => {
    // Aprovar é gateado pelo slug de FINALIZAR (é o que a rota exige).
    if (!podeFinalizar) { semPermissao('aprovar evolução'); return; }
    try {
      await api.patch(`/clinica/evolucoes/${id}/aprovar`);
      toast.success('Evolução aprovada');
      carregarEvolucoes();
    } catch { setErroInline('Erro ao aprovar'); }
  };

  const handleConfirmarEncaminhamento = async (selecionadas: AcaoSelecionavel[]) => {
    if (!faturaId) return;
    setSavingFatura(true);
    try {
      await Promise.all(
        selecionadas.map(a =>
          api.post(`/clinica/faturas/${faturaId}/itens`, {
            tipo:       'ENCAMINHAMENTO',
            descricao:  a.descricao,
            valor:      0,
            quantidade: a.quantidade,
          })
        )
      );
      toast.success('Encaminhamento registrado na fatura');
      setShowLLM(false);
      setAcoesLLM([]);
      onFaturaAtualizada();
    } catch { setErroInline('Erro ao registrar encaminhamento'); }
    finally { setSavingFatura(false); }
  };

  // Abre a pré-visualização do relatório (com opções Imprimir / Editar relatório).
  // A extração por IA roda uma única vez e fica salva (resumoIaData) — abrir/
  // imprimir de novo reutiliza o relatório salvo, sem gastar tokens.
  const handleImprimir = async (ev: EvolucaoItem) => {
    if (!podeImprimir) { semPermissao('imprimir evolução'); return; }
    if (imprimindoId) return; // já há uma geração de relatório em andamento

    setImprimindoId(ev.id);
    try {
      const dados = await toast.promise(buscarRelatorioAtendimento(ev.id), {
        loading: 'Gerando relatório comparativo…',
        success: 'Relatório pronto.',
        error: 'Não foi possível gerar o relatório. Tente novamente.',
      });
      setRelatorioModal({ ev, dados });
    } catch {
      // silencioso — toast.promise já notificou o erro
    } finally {
      setImprimindoId(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const userId = user?.id ?? 0;

  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.evolucoes.ler')) {
    return (
      <div className="text-center py-16">
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
        <p className="text-sm text-gray-500">Você não tem permissão para visualizar evoluções.</p>
      </div>
    );
  }

  return (
    <>
      <InlineError message={erroInline} className="mx-4 mt-3" />

      {/* Barra de ação e filtros */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">

        {!formularioVisivel && podeCriar && (
          <div className="relative flex-shrink-0">
            {/* A PRÓPRIA evolução aberta trava o botão (finalize/cancele antes).
                Aberta por OUTRO profissional, o clique abre a decisão:
                assumir a evolução × abrir uma nova em paralelo. */}
            <button
              onClick={abrirNova}
              disabled={!!minhaEvolucaoAberta}
              title={minhaEvolucaoAberta
                ? 'Você tem uma evolução em andamento para este paciente. Finalize-a antes de criar uma nova.'
                : evolucaoAbertaDeOutro
                  ? `${evolucaoAbertaDeOutro.veterinario?.fullName ?? 'Outro profissional'} tem uma evolução em andamento — você poderá assumi-la ou abrir uma nova.`
                  : undefined}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
              {minhaEvolucaoAberta && <Lock size={14} />}
              Nova Evolução
            </button>
            {temEvolucaoAberta && (
              <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-amber-400 rounded-full border-2 border-white" title="Evolução em andamento" />
            )}
          </div>
        )}

        <select value={limit} onChange={e => { setLimit(Number(e.target.value)); setPage(1); }}
          className="hidden md:block border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500 flex-shrink-0">
          {LIMIT_OPTIONS.map(l => <option key={l} value={l}>{l} por página</option>)}
        </select>

        <div className="hidden md:flex items-center border border-gray-200 rounded-xl bg-white overflow-hidden flex-shrink-0">
          <div className="flex flex-col px-2 py-1 min-w-0">
            <span className="text-[10px] text-gray-400 leading-none mb-0.5">Data Inicial</span>
            <DateInput
              value={filtroDataInicio}
              onChange={v => { setFiltroDataInicio(v); setPage(1); }}
              className="w-32 text-xs text-gray-900"
            />
          </div>
          <span className="text-gray-300 text-xs px-1 flex-shrink-0">→</span>
          <div className="flex flex-col px-2 py-1 border-l border-gray-100 min-w-0">
            <span className="text-[10px] text-gray-400 leading-none mb-0.5">Data Final</span>
            <DateInput
              value={filtroDataFim}
              onChange={v => { setFiltroDataFim(v); setPage(1); }}
              className="w-32 text-xs text-gray-900"
            />
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1.5 border border-gray-200 rounded-xl bg-white px-3 py-2 flex-shrink-0">
          <User size={14} className="text-gray-400 flex-shrink-0" />
          <select value={filtroResponsavel}
            onChange={e => { setFiltroResponsavel(e.target.value); setPage(1); }}
            className="text-sm text-gray-700 bg-transparent focus:outline-none max-w-[140px]">
            <option value="">Responsável</option>
            {responsaveis.filter(Boolean).map(r => <option key={r.id} value={r.id}>{r.fullName}</option>)}
          </select>
        </div>

        <div className="hidden md:flex items-center gap-1.5 border border-gray-200 rounded-xl bg-white px-3 py-2 flex-shrink-0">
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
            onClick={() => { setFiltroDataInicio(''); setFiltroDataFim(''); setFiltroResponsavel(''); setFilterStatus(''); setPage(1); }}
            className="hidden md:block px-3 py-2 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-xl bg-white transition-colors flex-shrink-0">
            Limpar ×
          </button>
        )}
      </div>

      <div ref={formTopRef} />

      {criandoConcorrente && !editingEv && (
        <div className="mx-4 mt-3 flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-800 leading-snug">
            {evolucaoAbertaDeOutro
              ? `Existe uma evolução em andamento${evolucaoAbertaDeOutro.veterinario?.fullName ? ` com ${evolucaoAbertaDeOutro.veterinario.fullName}` : ''}.`
              : minhaEvolucaoAberta
                ? `Você já tem outro atendimento em andamento para este paciente (${minhaEvolucaoAberta.especialidade}${minhaEvolucaoAberta.atendimentoNumero ? ` — ${minhaEvolucaoAberta.atendimentoNumero}` : ''}). Este é um atendimento em paralelo, para uma consulta diferente.`
                : 'Existe uma evolução em andamento.'}
          </p>
        </div>
      )}

      {formularioVisivel && (
        <NovaEvolucaoModal
          form={form}
          editingId={editingEv?.id ?? null}
          midias={editingEv?.midias ?? []}
          saving={savingEv}
          interpretando={interpretando}
          agendamentos={agendamentosDisponiveis}
          agendamentoId={agendamentoSelecionadoId}
          onAgendamentoChange={setAgendamentoSelecionadoId}
          onFormChange={handleFormChange}
          onSalvar={handleSalvar}
          onFinalizar={handleFinalizar}
          onClose={fecharModal}
          onArquivosChange={setArquivosModal}
          onRemoverMidia={(midiaId) => editingEv && handleRemoverMidia(editingEv.id, midiaId)}
          somenteLeitura={formLeitura}
          podeSalvar={editingEv ? podeEditar : podeCriar}
          // Editando a de outro, o Finalizar do rodapé some (o formulário já abre em
          // leitura nesse caso; isto fecha o rodapé por conta própria). Evolução NOVA
          // nasce da própria pessoa — aí basta a permissão.
          podeFinalizar={podeFinalizar && (!editingEv || ehMinhaEvolucao(editingEv))}
        />
      )}

      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Evolução Clínica</p>
        <span className="text-xs text-gray-400">{total} registro{total !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-emerald-600" />
        </div>
      ) : evolucoes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={40} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma evolução encontrada</p>
        </div>
      ) : (
        <>
          {/* Mobile — cards no padrão do histórico de prescrição (cabe na tela, sem rolagem lateral) */}
          <div className="md:hidden divide-y divide-gray-50">
            {evolucoes.map(ev => {
              const emAndamento = ev.status === 'EM_ANDAMENTO';
              const eProprioAutor = ev.veterinarioId === userId;
              const nivelEditar    = isGestor ? 'FULL' : (permissoes['atendimento.evolucoes.editar']    ?? 'NENHUM');
              const nivelDeletar   = isGestor ? 'FULL' : (permissoes['atendimento.evolucoes.deletar']   ?? 'NENHUM');
              // AUTORIA (2026-08-04): a ação concedida vale sobre a evolução que a
              // pessoa criou ou assumiu. Só o gestor opera a de outro profissional —
              // espelho do `podeOperarRegistro` do backend, que é quem de fato barra.
              const meuRegistro       = ehMinhaEvolucao(ev);
              const temNivelEditar    = nivelEditar !== 'NENHUM' && nivelEditar !== 'NEGADO';
              const podeEditarEsta    = meuRegistro && temNivelEditar;
              // EM_ANDAMENTO nunca é excluída (hard delete) — só CANCELADA. O nível de
              // permissão é o mesmo de "excluir" (nivelDeletar), só a AÇÃO mudou.
              const podeCancelarPropria = meuRegistro && emAndamento && nivelDeletar   !== 'NENHUM' && nivelDeletar   !== 'NEGADO';
              // Aprovar segue o slug de FINALIZAR (é o que a rota /aprovar exige) —
              // não é mais um check de role, senão quem só tem VER via o botão.
              const podeAprovar    = !ev.aprovado && podeFinalizar;
              const podeAlterar    = (emAndamento && podeEditarEsta) || (isGestor && ev.status === 'FINALIZADA');
              // Assumir é um "puxar para si": basta ter a permissão de alterar em
              // qualquer nível — usa `temNivelEditar`, NUNCA `podeEditarEsta`, que já
              // exige autoria e por definição é falso na evolução do outro.
              const podeAssumirEsta = emAndamento && !eProprioAutor && temNivelEditar;
              // Cancelar finalizada usa o slug de EXCLUIR (rota PATCH /cancelar).
              const podeCancelarFinalizada = ev.status === 'FINALIZADA' && podeDeletar;
              const tituloDisplay = ev.titulo
                ? ev.titulo
                : ev.texto.length > 55 ? ev.texto.substring(0, 52) + '…' : ev.texto;
              const temMidia = (ev.midias ?? []).length > 0;

              return (
                <div key={ev.id} className={`px-4 py-3 ${!ev.aprovado ? 'bg-amber-50/40' : ''}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <button onClick={() => setViewingEv(ev)}
                      className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-emerald-700 hover:underline text-left">
                      <span className="truncate">{tituloDisplay}</span>
                      {temMidia && <Paperclip size={11} className="text-gray-400 flex-shrink-0" />}
                    </button>
                    <span className={`inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_CONFIG[ev.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_CONFIG[ev.status]?.label ?? ev.status}
                    </span>
                  </div>

                  <div className="mb-0.5">
                    <NumeroAtendimento
                      numero={ev.atendimentoNumero}
                      emAndamento={emAndamento}
                      ativo={ev.id === evolucaoAtivaId}
                      onSelecionar={onSelecionarEvolucao ? () => onSelecionarEvolucao(ev.id) : undefined}
                      className="text-[11px]"
                    />
                  </div>

                  <p className="text-xs text-gray-500">
                    {ev.veterinario?.fullName ?? '—'}
                    <span className="text-gray-300"> · </span>
                    <span className="text-[11px] text-gray-400">{ev.especialidade}</span>
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {formatarDataHora(ev.dataInicio)}{ev.dataFim ? ` — ${formatarDataHora(ev.dataFim)}` : ''}
                  </p>
                  {!ev.aprovado && (
                    <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium mt-1">
                      <AlertTriangle size={9} /> Pendente
                    </span>
                  )}
                  {ev.status === 'CANCELADA' && ev.justificativaExclusao && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Justificativa:{' '}
                      <JustificativaCancelamento texto={ev.justificativaExclusao} className="inline-block align-bottom max-w-[70vw]" />
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 mt-2">
                    {podeAprovar && (
                      <button onClick={() => handleAprovar(ev.id)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-amber-600 rounded-lg text-xs hover:bg-amber-50 transition-colors">
                        <CheckCircle2 size={11} /> Aprovar
                      </button>
                    )}
                    {podeAlterar && (
                      <button onClick={() => { abrirEdicao(ev); onAbrirAtendimento?.(ev.id, 'editar'); }}
                        className="flex items-center gap-1 px-2.5 py-1 border border-orange-200 text-orange-600 rounded-lg text-xs hover:bg-orange-50 transition-colors">
                        <Pencil size={11} /> Alterar
                      </button>
                    )}
                    <button onClick={() => { abrirVisualizacao(ev); onAbrirAtendimento?.(ev.id, 'visualizar'); }}
                      className="flex items-center gap-1 px-2.5 py-1 border border-emerald-200 text-emerald-700 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                      <Eye size={11} /> Ver
                    </button>
                    {podeAssumirEsta && (
                      <button onClick={() => handleAssumirEvolucao(ev.id)} disabled={assumindoEv}
                        title={`Assumir a evolução de ${ev.veterinario?.fullName ?? 'outro profissional'}`}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-teal-600 rounded-lg text-xs hover:bg-teal-50 disabled:opacity-60 transition-colors">
                        {assumindoEv ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />} Assumir
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => handleImprimir(ev)} disabled={imprimindoId === ev.id}
                        className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 text-blue-600 rounded-lg text-xs hover:bg-blue-50 transition-colors disabled:opacity-50">
                        {imprimindoId === ev.id ? <Loader2 size={11} className="animate-spin" /> : <Printer size={11} />} Imprimir
                      </button>
                    )}
                    {/* Compartilhar é saída de conteúdo do sistema: segue IMPRIMIR */}
                    {podeImprimir && (
                      <button onClick={() => abrirWhatsApp(montarTextoEvolucao(ev))}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors">
                        <MessageCircle size={11} /> WhatsApp
                      </button>
                    )}
                    {podeImprimir && (
                      <button onClick={() => abrirEmail(`Evolução - ${ev.titulo?.trim() || ev.especialidade}`, montarTextoEvolucao(ev))}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-blue-500 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                        <Mail size={11} /> E-mail
                      </button>
                    )}
                    {(podeCancelarPropria || podeCancelarFinalizada) && (
                      <button onClick={() => setCancelandoEv(ev)}
                        className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                        <Ban size={11} /> Cancelar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Nº</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">Data<br />Início</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">Data<br />Fim</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Título</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Responsável</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {evolucoes.map(ev => {
                const emAndamento = ev.status === 'EM_ANDAMENTO';
                const eProprioAutor = ev.veterinarioId === userId;

                // Nível de permissão para editar/excluir esta evolução
                const nivelEditar    = isGestor ? 'FULL' : (permissoes['atendimento.evolucoes.editar']    ?? 'NENHUM');
                const nivelDeletar   = isGestor ? 'FULL' : (permissoes['atendimento.evolucoes.deletar']   ?? 'NENHUM');

                // AUTORIA (2026-08-04): a ação vale sobre o que a pessoa criou ou
                // assumiu; só o gestor opera registro de outro. `temNivelEditar` é o
                // nível cru, usado só pelo "assumir" (que é justamente sobre o alheio).
                const meuRegistro       = ehMinhaEvolucao(ev);
                const temNivelEditar    = nivelEditar !== 'NENHUM' && nivelEditar !== 'NEGADO';
                const podeEditarEsta    = meuRegistro && temNivelEditar;
                // EM_ANDAMENTO nunca é excluída (hard delete) — só CANCELADA. O nível
                // de permissão é o mesmo de "excluir" (nivelDeletar), só a AÇÃO mudou.
                const podeCancelarPropria = meuRegistro && emAndamento && nivelDeletar   !== 'NENHUM' && nivelDeletar   !== 'NEGADO';
                const podeAprovar    = !ev.aprovado && podeFinalizar;
                const tituloDisplay = ev.titulo
                  ? ev.titulo
                  : ev.texto.length > 55 ? ev.texto.substring(0, 52) + '…' : ev.texto;
                const temMidia = (ev.midias ?? []).length > 0;

                return (
                  <tr key={ev.id}
                    onClick={() => setViewingEv(ev)}
                    className={`hover:bg-gray-50 transition-colors cursor-pointer ${!ev.aprovado ? 'bg-amber-50/40' : ''}`}>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <NumeroAtendimento
                        numero={ev.atendimentoNumero}
                        emAndamento={emAndamento}
                        ativo={ev.id === evolucaoAtivaId}
                        onSelecionar={onSelecionarEvolucao ? () => onSelecionarEvolucao(ev.id) : undefined}
                        className="text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      <div>{formatarDataHora(ev.dataInicio)}</div>
                      {!ev.aprovado && (
                        <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium mt-0.5">
                          <AlertTriangle size={9} /> Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {ev.dataFim ? formatarDataHora(ev.dataFim) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs">
                      <div className="flex items-start gap-1.5">
                        <p className="text-xs text-gray-700 line-clamp-2 flex-1">{tituloDisplay}</p>
                        {temMidia && (
                          <span title="Possui anexos">
                            <Paperclip size={10} className="text-gray-400 flex-shrink-0 mt-0.5" />
                          </span>
                        )}
                      </div>
                      <span className="inline-block mt-0.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                        {ev.especialidade}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="text-xs font-medium text-gray-800">{ev.veterinario?.fullName ?? '—'}</p>
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
                    <td className="px-4 py-3">
                      {ev.status === 'CANCELADA'
                        ? <JustificativaCancelamento texto={ev.justificativaExclusao} />
                        : <span className="text-gray-300">—</span>}
                    </td>

                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-start gap-1">

                        {podeAprovar && (
                          <button onClick={() => handleAprovar(ev.id)} title="Aprovar"
                            className="p-1.5 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                            <CheckCircle2 size={14} />
                          </button>
                        )}

                        {((emAndamento && podeEditarEsta) || (isGestor && ev.status === 'FINALIZADA')) && (
                          <button
                            onClick={() => { abrirEdicao(ev); onAbrirAtendimento?.(ev.id, 'editar'); }}
                            title="Alterar"
                            className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
                            <Pencil size={14} />
                          </button>
                        )}

                        <button
                          onClick={() => { abrirVisualizacao(ev); onAbrirAtendimento?.(ev.id, 'visualizar'); }}
                          title="Visualizar"
                          className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>

                        {/* Assumir a evolução em andamento de outro profissional —
                            ele é comunicado por e-mail e WhatsApp. */}
                        {emAndamento && !eProprioAutor && temNivelEditar && (
                          <button onClick={() => handleAssumirEvolucao(ev.id)} disabled={assumindoEv}
                            title={`Assumir a evolução de ${ev.veterinario?.fullName ?? 'outro profissional'}`}
                            className="p-1.5 text-teal-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors disabled:opacity-60">
                            {assumindoEv ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                          </button>
                        )}

                        {podeImprimir && (
                          <button onClick={() => handleImprimir(ev)} disabled={imprimindoId === ev.id} title="Imprimir"
                            className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50">
                            {imprimindoId === ev.id ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                          </button>
                        )}

                        {podeImprimir && (
                          <button onClick={() => abrirWhatsApp(montarTextoEvolucao(ev))} title="Enviar por WhatsApp"
                            className="p-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors">
                            <MessageCircle size={14} />
                          </button>
                        )}

                        {podeImprimir && (
                          <button onClick={() => abrirEmail(`Evolução - ${ev.titulo?.trim() || ev.especialidade}`, montarTextoEvolucao(ev))} title="Enviar por e-mail"
                            className="p-1.5 text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                            <Mail size={14} />
                          </button>
                        )}

                        {((emAndamento && podeCancelarPropria) || (ev.status === 'FINALIZADA' && podeDeletar)) && (
                          <button onClick={() => setCancelandoEv(ev)} title="Cancelar evolução"
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>

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
        </>
      )}

      {/* Modais */}
      {evolucaoAbertaInfo && (
        <EvolucaoAbertaModal
          info={evolucaoAbertaInfo}
          animalNome={animal?.nome}
          saving={assumindoEv}
          onAssumir={() => handleAssumirEvolucao(evolucaoAbertaInfo.id)}
          onCriarNova={handleCriarNovaConcorrente}
          onCancelar={handleCancelarDecisaoEvolucao}
        />
      )}

      {viewingEv && (
        <ViewEvolucaoModal
          ev={viewingEv}
          animal={animal}
          onClose={() => setViewingEv(null)}
          onImprimir={() => handleImprimir(viewingEv)}
          podeImprimir={podeImprimir}
        />
      )}

      {cancelandoEv && (
        <CancelamentoModal
          ev={cancelandoEv}
          onConfirmar={handleCancelarEvolucao}
          onCancelar={() => setCancelandoEv(null)}
          saving={savingCancelamento}
        />
      )}

      {relatorioModal && (() => {
        const relEv = relatorioModal.ev;
        // Segue o Controle de Acesso (alterar evolução), sem filtro de autoria/cargo
        const podeEditarRelatorio  = isGestor || podeEditar;
        const podeAlterarEvolucao  = (relEv.status === 'EM_ANDAMENTO' && podeEditarRelatorio)
          || (isGestor && relEv.status === 'FINALIZADA');
        return (
          <RelatorioAtendimentoModal
            dadosIniciais={relatorioModal.dados}
            podeEditar={podeEditarRelatorio}
            onClose={() => setRelatorioModal(null)}
            onEditarEvolucao={podeAlterarEvolucao
              ? () => { setRelatorioModal(null); abrirEdicao(relEv); }
              : undefined}
          />
        );
      })()}

      {showLLM && (
        <ConfirmacaoEncaminhamentoModal
          acoes={acoesLLM}
          onConfirmar={handleConfirmarEncaminhamento}
          onCancelar={() => { setShowLLM(false); setAcoesLLM([]); }}
          saving={savingFatura}
        />
      )}

    </>
  );
}