// frontend/src/pages/SubModuloPrescricao.tsx

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Pencil, Trash2, CheckCircle2, X, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, Pill, Activity,
  Clock, Calendar, Search, FileText, Eye, Printer, Lock, MessageCircle, Mail,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import DateInput from '../components/DateInput';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { imprimirPrescricao as imprimirPrescricaoPrint, type PrintAnimalPrescricao } from '../utils/PrescricaoPrint';
import ModalJustificativa from '../components/ModalJustificativa';
import ConfirmModal from '../components/ConfirmModal';


// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertaEstoque {
  tipo:          'INSUFICIENTE' | 'ZERADO';
  medicamento:   string;
  unidade:       string;
  qtdNecessaria: number;
  qtdDisponivel: number;
  qtdEstoque:    number;
  qtdReservada:  number;
  reservas: { animalNome: string; prescricaoNumero: string; quantidade: number }[];
}

type TipoItem    = 'MEDICAMENTO' | 'PROCEDIMENTO';
type StatusGrupo = 'SALVO' | 'FINALIZADO' | 'EXECUTADO' | 'CANCELADO' | 'CANCELADO_PARCIALMENTE';

interface MedicamentoCat {
  id: number; nome: string; formaFarmaceutica: string;
  unidade: string; vias: { via: string }[];
  emEstoque:  boolean;
  qtdEstoque: number | null;
}


interface ItemGrupo {
  id: number;
  tipo: TipoItem;
  medicamento: string;
  medicamentoCatId: number | null;
  dosagem: string | null;
  unidade: string | null;
  via: string;
  frequencia: string;
  horaInicio:        string | null;
  horariosGerados:   string[] | null;
  duracaoDias:       number;
  dataInicio:        string;
  observacao:        string | null;
  veterinario:       { id: number; fullName: string };
  medicamentoCliente: boolean;
  executadoEm:       string | null;
  medicamentoCat?:   { controlado: boolean } | null;
}

interface PrescricaoGrupo {
  id: number;
  numero: number;
  numeroFormatado: string;
  animalId: number;
  veterinarioId: number;
  veterinario: { id: number; fullName: string };
  status: StatusGrupo;
  createdAt: string;
  itens: ItemGrupo[];
}

interface FormItem {
  tipo:               TipoItem;
  medicamento:        string;
  medicamentoCatId:   number | null;
  dosagem:            string;
  unidade:            string;
  via:                string;
  frequencia:         string;
  horaInicio:         string;
  duracaoDias:        number | '';
  dataInicio:         string;
  observacao:         string;
  medicamentoCliente: boolean;
}

interface Props {
  animalId:           number;
  animal?:            PrintAnimalPrescricao | null;
  onFaturaAtualizada: () => void;
  evolucaoId?:        number;
  atendimentoNumero?: string;
  onSalvo?:           () => void;
  openItemId?:        number;
  onViewConsumed?:    () => void;
  editItemId?:        number | null;
  onEditConsumed?:    () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POSOLOGIAS = [
  { value: '1xDia',        label: 'Uma vez ao dia'    },
  { value: '12em12h',      label: '12 em 12H'         },
  { value: '8em8h',        label: '8 em 8H'           },
  { value: '6em6h',        label: '6 em 6H'           },
  { value: '4em4h',        label: '4 em 4H'           },
  { value: '1em1h',        label: '1 em 1H'           },
  { value: 'continuo',     label: 'Contínuo'           },
  { value: 'agora',        label: 'Agora (dose única)' },
  { value: 'seNecessario', label: 'Se necessário'      },
  { value: 'SOS',          label: 'SOS'                },
  { value: '1x2dias',      label: '1x a cada 2 dias'  },
  { value: '1x3dias',      label: '1x a cada 3 dias'  },
  { value: '1xSemana',     label: '1x por semana'      },
  { value: '1x21dias',     label: '1x a cada 21 dias' },
  { value: '1x30dias',     label: '1x a cada 30 dias' },
  { value: '1x90dias',     label: '1x a cada 90 dias' },
] as const;

const VIAS     = ['Oral', 'Endovenosa', 'Intramuscular', 'Subcutânea', 'Tópica', 'Retal', 'Nasal', 'Oftálmica'];
const UNIDADES = ['cápsula', 'comprimido', 'g', 'gota', 'L', 'mcg', 'mg', 'mL', 'UI'];

// Unidades do catálogo que têm subunidade preferencial para prescrição
// lookup case-insensitive; opcoes usa o valor original do banco para a unidade maior
const getConversaoUnidade = (u: string | null): { subunidade: string; opcoes: string[] } | null => {
  if (!u) return null;
  const lower = u.toLowerCase();
  if (lower === 'l')  return { subunidade: 'mL', opcoes: ['mL', u] };
  if (lower === 'kg') return { subunidade: 'g',  opcoes: ['g',  u] };
  return null;
};

const STATUS_GRUPO: Record<StatusGrupo, { label: string; cls: string }> = {
  SALVO:                { label: 'Salvo',               cls: 'bg-amber-100 text-amber-700'    },
  FINALIZADO:           { label: 'Finalizado',          cls: 'bg-emerald-100 text-emerald-700' },
  EXECUTADO:            { label: 'Executado',           cls: 'bg-blue-100 text-blue-700'      },
  CANCELADO:            { label: 'Cancelado',           cls: 'bg-red-100 text-red-700'        },
  CANCELADO_PARCIALMENTE: { label: 'Cancel. Parcial',  cls: 'bg-orange-100 text-orange-700'  },
};

// Categoria de uma prescrição a partir dos seus itens. Como a criação separa por
// categoria, normalmente cada grupo é homogêneo; 'Misto' cobre grupos legados/editados.
type CategoriaPresc = 'Controlado' | 'Normal' | 'Procedimento' | 'Misto';

const CATEGORIA_BADGE: Record<CategoriaPresc, string> = {
  Controlado:   'bg-red-100 text-red-700',
  Normal:       'bg-blue-100 text-blue-700',
  Procedimento: 'bg-emerald-100 text-emerald-700',
  Misto:        'bg-gray-100 text-gray-600',
};

function categoriaGrupo(g: PrescricaoGrupo): CategoriaPresc {
  const cats = new Set<CategoriaPresc>(
    g.itens.map(i =>
      i.tipo === 'PROCEDIMENTO' ? 'Procedimento'
        : i.medicamentoCat?.controlado ? 'Controlado'
        : 'Normal',
    ),
  );
  return cats.size === 1 ? [...cats][0] : 'Misto';
}

const FORM_VAZIO = (): FormItem => ({
  tipo: 'MEDICAMENTO', medicamento: '', medicamentoCatId: null,
  dosagem: '', unidade: '', via: '', frequencia: '',
  horaInicio: '', duracaoDias: '', dataInicio: hojeLocalStr(),
  observacao: '', medicamentoCliente: false,
});

const labelPosologia = (v: string) => POSOLOGIAS.find(p => p.value === v)?.label ?? v;

const formatarData = (d: string | null) => {
  if (!d) return '—';
  const [year, month, day] = d.split('T')[0].split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
};

function montarTextoPrescricao(g: PrescricaoGrupo): string {
  const linhasItens = g.itens.map(i => {
    const det = [
      i.dosagem ? `${i.dosagem}${i.unidade ?? ''}` : '',
      i.via,
      i.frequencia,
    ].filter(Boolean).join(' · ');
    return `• ${i.medicamento}${det ? ` — ${det}` : ''}`;
  });
  return [
    `*Prescrição #${g.numeroFormatado}*`,
    `Data: ${formatarData(g.createdAt)}`,
    `Veterinário: ${g.veterinario.fullName}`,
    `Status: ${STATUS_GRUPO[g.status]?.label ?? g.status}`,
    `\nItens (${g.itens.length}):`,
    ...linhasItens,
  ].join('\n');
}

// Data de hoje no fuso LOCAL do navegador, como 'YYYY-MM-DD'. Não usar
// `new Date().toISOString()`: isso dá a data em UTC, que já vira o dia
// seguinte a partir das 21h no horário de Brasília (UTC-3) — faria o sistema
// achar que um tratamento de N dias já tinha acabado um dia mais cedo.
function hojeLocalStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Dia atual do tratamento (1-indexado) e dias restantes — mesmo cálculo usado
// no backend (janelaDoItem, PrescricaoGrupoController.js) para decidir se um
// item já foi executado integralmente ou ainda tem dias pendentes.
function diaAtualDoItem(dataInicio: string, hojeStr = hojeLocalStr()): number {
  const inicioStr = dataInicio.split('T')[0];
  const inicio = new Date(inicioStr + 'T00:00:00Z');
  const hoje = new Date(hojeStr + 'T00:00:00Z');
  return Math.floor((hoje.getTime() - inicio.getTime()) / 86400000) + 1;
}

function itemTotalmenteExecutado(item: { executadoEm: string | null; dataInicio: string; duracaoDias: number }): boolean {
  if (!item.executadoEm) return false;
  return diaAtualDoItem(item.dataInicio) >= item.duracaoDias;
}

function itemDiasRestantes(item: { dataInicio: string; duracaoDias: number }): number {
  return Math.max(item.duracaoDias - diaAtualDoItem(item.dataInicio), 0);
}

function imprimirPrescricao(grupo: PrescricaoGrupo, animal?: PrintAnimalPrescricao | null) {
  imprimirPrescricaoPrint({
    numero:          grupo.numero,
    numeroFormatado: grupo.numeroFormatado,
    status:          grupo.status,
    finalizadoEm:    null,
    finalizadoPor:   null,
    executadoPor:    null,
    veterinario:     { fullName: grupo.veterinario.fullName },
    animal:          animal ?? { nome: '—', photoUrl: null, peso: null, baia: null, especie: null, raca: null },
    itens:           grupo.itens.map(i => ({
      id:              i.id,
      tipo:            i.tipo,
      medicamento:     i.medicamento,
      dosagem:         i.dosagem,
      unidade:         i.unidade,
      via:             i.via,
      frequencia:      i.frequencia,
      horaInicio:      i.horaInicio,
      horariosGerados: i.horariosGerados,
      duracaoDias:     i.duracaoDias,
      observacao:      i.observacao,
      dataInicio:      i.dataInicio,
    })),
  });
}

// ─── AlertaEstoqueModal ───────────────────────────────────────────────────────

function AlertaEstoqueModal({
  alertas, loading, onContinuar, onCancelar,
}: {
  alertas:    AlertaEstoque[];
  loading:    boolean;
  onContinuar: () => void;
  onCancelar:  () => void;
}) {
  const temInsuficiente = alertas.some(a => a.tipo === 'INSUFICIENTE');

  const titulo    = temInsuficiente ? 'Estoque Insuficiente' : 'Estoque Ficará Zerado';
  const subtitulo = temInsuficiente
    ? 'Não existe estoque disponível suficiente para esta prescrição'
    : 'Ao finalizar esta prescrição, o estoque disponível ficará zerado';
  const headerCls = temInsuficiente
    ? 'border-orange-100 bg-orange-50 rounded-t-2xl'
    : 'border-amber-100 bg-amber-50 rounded-t-2xl';
  const titleCls  = temInsuficiente ? 'text-orange-800' : 'text-amber-800';
  const subCls    = temInsuficiente ? 'text-orange-600' : 'text-amber-600';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className={`bg-white rounded-2xl shadow-xl w-full max-w-lg border ${temInsuficiente ? 'border-orange-200' : 'border-amber-200'}`}>
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${headerCls}`}>
          <span className="text-2xl">⚠️</span>
          <div>
            <p className={`font-bold text-sm ${titleCls}`}>{titulo}</p>
            <p className={`text-xs ${subCls}`}>{subtitulo}</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-80 overflow-y-auto">
          {alertas.map((a, i) => {
            const isInsuf = a.tipo === 'INSUFICIENTE';
            return (
              <div key={i} className={`border rounded-xl p-3 ${isInsuf ? 'border-orange-200 bg-orange-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                <p className="font-semibold text-gray-800 text-sm">{a.medicamento}</p>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs text-gray-600">
                  <span>Em estoque: <b>{a.qtdEstoque} {a.unidade}</b></span>
                  <span>Reservado: <b className="text-orange-600">{a.qtdReservada.toFixed(2)} {a.unidade}</b></span>
                  <span>Disponível: <b className={isInsuf ? 'text-red-600' : 'text-amber-600'}>
                    {a.qtdDisponivel.toFixed(2)} {a.unidade}
                  </b></span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Necessário nesta prescrição: <b>{a.qtdNecessaria.toFixed(2)} {a.unidade}</b>
                </p>
                {a.reservas.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase">Reservado por:</p>
                    {a.reservas.map((r, j) => (
                      <p key={j} className="text-xs text-gray-600">
                        · <b>{r.animalNome}</b> — Prescrição #{r.prescricaoNumero} ({r.quantidade.toFixed(2)} {a.unidade})
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onCancelar}
            className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={onContinuar} disabled={loading}
            className="px-5 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5">
            {loading && <Loader2 size={13} className="animate-spin" />}
            Continuar mesmo assim
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── GrupoModal ───────────────────────────────────────────────────────────────

interface GrupoModalProps {
  animalId:             number;
  animal?:              PrintAnimalPrescricao | null;
  grupo:                PrescricaoGrupo | null; // null = creating new
  canEdit:              boolean;
  canFinalizarCancelar: boolean;
  podeImprimir?:        boolean;
  evolucaoId?:          number;
  onClose:              () => void;
  onSaved:              () => void;
  isInline?:            boolean;
}

function GrupoModal({ animalId, animal, grupo, canEdit, canFinalizarCancelar, podeImprimir = false, evolucaoId, onClose, onSaved, isInline = false }: GrupoModalProps) {
  const isCreate   = !grupo;
  // Impede inserir item novo fora de SALVO (edição/exclusão de itens já existentes,
  // por item, é liberada separadamente via ItemRow.canEdit — ver Prescricao.executadoEm)
  const isReadOnly = grupo != null && grupo.status !== 'SALVO';
  // Abre diretamente na "segunda tela" (form visível) quando editando uma prescrição SALVA
  const openWithForm = !isCreate && !isReadOnly && canEdit;

  // ── Draft persistence (inline create mode only) ──────────────────────────
  const draftKey = isCreate && isInline
    ? `s2vet_prescricao_draft_${animalId}_${evolucaoId ?? 'sem'}`
    : null;

  const clearDraft = () => {
    if (!draftKey) return;
    try { localStorage.removeItem(draftKey); } catch {}
  };

  const [form, setForm] = useState<FormItem>(() => {
    if (!draftKey) return FORM_VAZIO();
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.form && typeof d.form === 'object') return { ...FORM_VAZIO(), ...d.form } as FormItem;
      }
    } catch {}
    return FORM_VAZIO();
  });

  const [localItens, setLocalItens] = useState<FormItem[]>(() => {
    if (!draftKey) return [];
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d?.localItens)) return d.localItens as FormItem[];
      }
    } catch {}
    return [];
  });
  const [editingLocalIdx,  setEditingLocalIdx]  = useState<number | null>(null);
  const [serverItens,      setServerItens]      = useState<ItemGrupo[]>(grupo?.itens ?? []);
  const [editingServerId,  setEditingServerId]  = useState<number | null>(null);
  const [removendoItemId,  setRemovendoItemId]  = useState<number | null>(null);
  const [medicamentos,     setMedicamentos]     = useState<MedicamentoCat[]>([]);
  const [allMeds,          setAllMeds]          = useState<MedicamentoCat[]>([]);
  const [saving,           setSaving]           = useState(false);
  const [finalizing,       setFinalizing]       = useState(false);
  const [alertaEstoque,    setAlertaEstoque]    = useState<AlertaEstoque[] | null>(null);
  // Itens de tipos diferentes viram prescrições separadas (Controlado/Normal/
  // Procedimento) — por isso é um array. Uma única categoria = 1 prescrição.
  const [savedGrupos,      setSavedGrupos]      = useState<{ id: number; numeroFormatado: string }[] | null>(null);
  // IDs ainda pendentes de finalização (retry após alerta de estoque) — evita
  // re-finalizar grupos já finalizados (que retornariam 400 "não está SALVO").
  const pendingFinalizeRef = useRef<number[] | null>(null);
  const [showAddForm,      setShowAddForm]      = useState(openWithForm);
  const [showMedDropdown,  setShowMedDropdown]  = useState(false);
  const [procedimentos,    setProcedimentos]    = useState<{ id: number; nome: string; especialidade: string | null; valor: number | null; combo?: boolean }[]>([]);
  const [combosProc,       setCombosProc]       = useState<{ id: number; nome: string; valor: number | null; especialidade: string | null }[]>([]);
  const [showProcDropdown, setShowProcDropdown] = useState(false);
  const [procEspecialidade, setProcEspecialidade] = useState('');
  const [loadingMeds,      setLoadingMeds]      = useState(false);
  const [medBusca,         setMedBusca]         = useState('');
  const medComboboxRef = useRef<HTMLDivElement>(null);
  const [draggedIdx,       setDraggedIdx]       = useState<number | null>(null);
  const [dragOverIdx,      setDragOverIdx]      = useState<number | null>(null);
  // Rascunhos independentes: preserva os valores de cada aba ao trocar de tipo
  const formBackupsRef    = useRef<Partial<Record<TipoItem, FormItem>>>({});
  const medDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef    = useRef<AbortController | null>(null);
  const [allMedsLoaded,       setAllMedsLoaded]       = useState(false);
  const [backgroundSearching, setBackgroundSearching] = useState(false);

  const set = <K extends keyof FormItem>(k: K, v: FormItem[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const switchTipo = (newTipo: TipoItem) => {
    if (newTipo === form.tipo) return;
    formBackupsRef.current[form.tipo] = { ...form };
    const backup = formBackupsRef.current[newTipo];
    setForm(backup ? { ...backup } : { ...FORM_VAZIO(), tipo: newTipo });
  };

  const resetForm = () => {
    formBackupsRef.current = {};
    setForm(FORM_VAZIO());
  };

  // Limpa apenas o tipo que acabou de ser inserido; preserva o backup do outro tipo
  const clearCurrentType = () => {
    const tipo = form.tipo;
    delete formBackupsRef.current[tipo];
    setForm({ ...FORM_VAZIO(), tipo });
  };

  const handleReorder = (from: number, to: number) => {
    if (from === to) return;
    const move = <T,>(arr: T[]): T[] => {
      const next = [...arr];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    };
    if (isCreate) setLocalItens(move);
    else          setServerItens(move);
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  // Carrega todos os medicamentos em background (silencioso — não bloqueia o dropdown).
  // Quando chega, sinaliza allMedsLoaded para que o filtro passe a ser client-side.
  const carregarMedicamentos = useCallback(async () => {
    setLoadingMeds(true);
    try {
      const r = await api.get('/medicamentos/para-atendimento', {
        params: { animalId, tipo: 'medicamento' },
      });
      const lista: MedicamentoCat[] = r.data?.dados ?? [];
      setAllMeds(lista);
      setAllMedsLoaded(true);
    } catch {}
    finally { setLoadingMeds(false); }
  }, [animalId]);

  // Carrega o catálogo completo no mount — procedimentos com o valor da empresa
  // (Cadastro > Procedimentos) e os combos da empresa ativa
  useEffect(() => {
    carregarMedicamentos();
    api.get('/procedimentos/cadastro/lista', {
      params: animal?.especie?.nome ? { especie: animal.especie.nome } : undefined,
    }).then(r => {
      const lista: { id: number; nome: string; especialidade: string | null; valorEmpresa: number | null; valorVenda: number | null }[] = r.data?.dados ?? [];
      setProcedimentos(lista.map(p => ({
        id: p.id, nome: p.nome, especialidade: p.especialidade ?? null,
        valor: p.valorEmpresa ?? p.valorVenda ?? null,
      })));
    }).catch(() => {});
    api.get('/procedimentos/cadastro/combos').then(r => {
      const lista: { id: number; nome: string; valor: number | null; especialidade: string | null }[] = r.data?.dados ?? [];
      setCombosProc(lista.map(c => ({ id: c.id, nome: c.nome, valor: c.valor ?? null, especialidade: c.especialidade ?? null })));
    }).catch(() => {});
  }, [carregarMedicamentos, animal?.especie?.nome]);

  // Cancela busca paralela ao desmontar
  useEffect(() => () => { searchAbortRef.current?.abort(); }, []);

  // Especialidades presentes no catálogo de procedimentos (filtro do form PROCEDIMENTO)
  const especialidadesProc = useMemo(() =>
    [...new Set(procedimentos.map(p => p.especialidade).filter((e): e is string => Boolean(e)))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [procedimentos]);
  const procsPorEspecialidade = useMemo(() => {
    const procs = procEspecialidade
      ? procedimentos.filter(p => p.especialidade === procEspecialidade)
      : procedimentos;
    // Combos filtrados pela especialidade selecionada (combo legado sem
    // especialidade continua sempre visível). Ficam no topo da lista.
    const combos = combosProc
      .filter(c => !procEspecialidade || !c.especialidade || c.especialidade === procEspecialidade)
      .map(c => ({ id: -c.id, nome: c.nome, especialidade: c.especialidade ?? null, valor: c.valor, combo: true }));
    return [...combos, ...procs];
  }, [procedimentos, combosProc, procEspecialidade]);

  // Filtro híbrido:
  //   - Lista completa carregada → filtra client-side (rápido, sem request)
  //   - Lista ainda carregando + usuário digitou → dispara request paralelo ao backend
  //     com AbortController (cancela o anterior a cada tecla)
  //   - Quando a lista completa chega, qualquer nova digitação volta ao client-side
  useEffect(() => {
    if (medDebounceRef.current) clearTimeout(medDebounceRef.current);
    medDebounceRef.current = setTimeout(async () => {
      const q = medBusca.trim().toLowerCase();
      if (allMedsLoaded) {
        setMedicamentos(q
          ? allMeds.filter(m => m.nome.toLowerCase().includes(q) || m.formaFarmaceutica?.toLowerCase().includes(q))
          : allMeds
        );
      } else if (q) {
        searchAbortRef.current?.abort();
        searchAbortRef.current = new AbortController();
        setBackgroundSearching(true);
        try {
          const r = await api.get('/medicamentos/para-atendimento', {
            params: { animalId, tipo: 'medicamento', busca: q },
            signal: searchAbortRef.current.signal,
          });
          setMedicamentos(r.data?.dados ?? []);
        } catch { /* abortado ou erro de rede — silencioso */ }
        finally { setBackgroundSearching(false); }
      }
    }, 200);
    return () => { if (medDebounceRef.current) clearTimeout(medDebounceRef.current); };
  }, [medBusca, allMeds, allMedsLoaded, animalId]);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    if (!showMedDropdown) return;
    const handler = (e: MouseEvent) => {
      if (!medComboboxRef.current?.contains(e.target as Node)) {
        setShowMedDropdown(false);
        setMedBusca('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMedDropdown]);

  // Restaura formBackupsRef do draft no mount (form/localItens já restaurados via lazy useState)
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d?.formBackups && typeof d.formBackups === 'object') {
        formBackupsRef.current = d.formBackups;
      }
    } catch {}
  // draftKey é estável durante o ciclo de vida do componente
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste o rascunho a cada mudança de form ou localItens
  useEffect(() => {
    if (!draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        localItens,
        form,
        formBackups: formBackupsRef.current,
      }));
    } catch {}
  }, [localItens, form, draftKey]);

  const validarForm = () => {
    const isMed = form.tipo === 'MEDICAMENTO';
    if (!form.medicamento.trim()) {
      toast.error(`${isMed ? 'Medicamento' : 'Procedimento'} é obrigatório`);
      return false;
    }
    if (isMed && !form.dosagem.toString().trim()) {
      toast.error('Dosagem é obrigatória'); return false;
    }
    if (isMed && !form.unidade.trim()) {
      toast.error('Unidade é obrigatória'); return false;
    }
    if (isMed && !form.via.trim()) {
      toast.error('Via de administração é obrigatória'); return false;
    }
    if (!form.frequencia.trim()) {
      toast.error('Frequência é obrigatória'); return false;
    }
    // Dose única ("Agora") não exige duração em dias
    if (form.frequencia !== 'agora' && (!form.duracaoDias || Number(form.duracaoDias) < 1)) {
      toast.error('Duração (dias) é obrigatória'); return false;
    }
    if (!form.dataInicio.trim()) {
      toast.error('Data de início é obrigatória'); return false;
    }
    // Duplicata — mesmo nome e mesmo tipo já existe na prescrição
    const nomeNorm = form.medicamento.trim().toLowerCase();
    const listaAtual = isCreate ? localItens : serverItens;
    const duplicado  = listaAtual.some((it, idx) => {
      if (isCreate && editingLocalIdx === idx) return false;
      if (!isCreate && editingServerId !== null && (it as ItemGrupo).id === editingServerId) return false;
      return it.medicamento.toLowerCase() === nomeNorm && it.tipo === form.tipo;
    });
    if (duplicado) {
      toast.error(`${isMed ? 'Medicamento' : 'Procedimento'} já adicionado nesta prescrição`);
      return false;
    }
    return true;
  };

  const formEstaVazio = () => !form.medicamento.trim();

  // ── Adicionar / atualizar item ──────────────────────────────────────────────

  const handleAdicionarMais = async (): Promise<boolean> => {
    if (!validarForm()) return false;

    if (isCreate) {
      if (editingLocalIdx !== null) {
        setLocalItens(prev => prev.map((it, i) => i === editingLocalIdx ? form : it));
        setEditingLocalIdx(null);
      } else {
        setLocalItens(prev => [...prev, form]);
      }
      clearCurrentType();
      return true;
    }

    setSaving(true);
    let ok = false;
    try {
      if (editingServerId !== null) {
        const res = await api.put(`/clinica/prescricoes/grupos/${grupo!.id}/itens/${editingServerId}`, form);
        const destino = res.data.grupoDestino as { numeroFormatado: string; novo: boolean } | null;
        if (destino) {
          // Categoria mudou → o item foi movido para outra prescrição
          setServerItens(prev => prev.filter(it => it.id !== editingServerId));
          toast.success(destino.novo
            ? `Item movido para a nova prescrição #${destino.numeroFormatado} (categoria diferente)`
            : `Item movido para a prescrição #${destino.numeroFormatado}`);
          onSaved();
        } else {
          setServerItens(prev => prev.map(it => it.id === editingServerId ? res.data.dados : it));
          toast.success('Item atualizado');
        }
        setEditingServerId(null);
      } else {
        const res = await api.post(`/clinica/prescricoes/grupos/${grupo!.id}/itens`, form);
        const destino = res.data.grupoDestino as { numeroFormatado: string; novo: boolean } | null;
        if (destino) {
          // Categoria diferente do grupo → foi para uma prescrição separada
          toast.success(destino.novo
            ? `Item de categoria diferente movido para a nova prescrição #${destino.numeroFormatado}`
            : `Item movido para a prescrição #${destino.numeroFormatado} (mesma categoria)`);
          onSaved();
        } else {
          setServerItens(prev => [...prev, res.data.dados]);
          toast.success('Item adicionado');
        }
        setShowAddForm(false);
      }
      clearCurrentType();
      ok = true;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar item');
    } finally {
      setSaving(false);
    }
    return ok;
  };

  const handleEditarLocal = (idx: number) => {
    setForm(localItens[idx]);
    setEditingLocalIdx(idx);
  };

  const handleEditarServer = (item: ItemGrupo) => {
    setShowAddForm(false);
    // Item já em execução (mas não totalmente): a edição vale para os dias que
    // faltam, não para o tratamento inteiro de novo — reabre a partir de hoje
    // com a duração restante, preservando a mesma data final original.
    const emAndamento = !!item.executadoEm && !itemTotalmenteExecutado(item);
    if (emAndamento) {
      const diaAtual = diaAtualDoItem(item.dataInicio);
      const restantes = itemDiasRestantes(item);
      toast(`Item em execução (dia ${String(diaAtual).padStart(2, '0')}/${String(item.duracaoDias).padStart(2, '0')}). A edição valerá para os ${restantes} dia${restantes !== 1 ? 's' : ''} restante${restantes !== 1 ? 's' : ''}.`, { icon: 'ℹ️', duration: 6000 });
    }
    setForm({
      tipo:               item.tipo,
      medicamento:        item.medicamento,
      medicamentoCatId:   item.medicamentoCatId,
      dosagem:            item.dosagem ?? '',
      unidade:            item.unidade ?? '',
      via:                item.via,
      frequencia:         item.frequencia,
      horaInicio:         item.horaInicio ?? '',
      duracaoDias:        emAndamento ? itemDiasRestantes(item) : item.duracaoDias,
      dataInicio:         emAndamento ? hojeLocalStr() : (item.dataInicio?.split('T')[0] ?? ''),
      observacao:         item.observacao ?? '',
      medicamentoCliente: item.medicamentoCliente,
    });
    setEditingServerId(item.id);
  };

  const handleRemoverLocal = (idx: number) => {
    setLocalItens(prev => prev.filter((_, i) => i !== idx));
    if (editingLocalIdx === idx) { resetForm(); setEditingLocalIdx(null); }
  };

  const handleRemoverServer = async (itemId: number, motivo: string) => {
    try {
      await api.delete(`/clinica/prescricoes/grupos/${grupo!.id}/itens/${itemId}`, { data: { motivo } });
      setServerItens(prev => prev.filter(it => it.id !== itemId));
      if (editingServerId === itemId) { resetForm(); setEditingServerId(null); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao remover item');
    } finally {
      setRemovendoItemId(null);
    }
  };

  // ── Salvar (create mode) ────────────────────────────────────────────────────

  const handleSalvar = async () => {
    const itens = formEstaVazio() ? localItens : [...localItens, form];
    if (itens.length === 0) {
      toast.error('Adicione ao menos um item na prescrição');
      return;
    }
    if (!formEstaVazio() && !validarForm()) return;
    setSaving(true);
    try {
      const res = await api.post('/clinica/prescricoes/grupos', { animalId, evolucaoId, itens });
      const grupos = res.data.dados as { id: number; numeroFormatado: string }[];
      toast.success(grupos.length > 1 ? `${grupos.length} prescrições salvas` : 'Prescrição salva');
      clearDraft();
      setLocalItens([]);
      resetForm();
      setSavedGrupos(grupos);
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar prescrição');
    } finally { setSaving(false); }
  };

  // ── Finalizar ───────────────────────────────────────────────────────────────

  const executarFinalizacao = async (forcar = false) => {
    setFinalizing(true);
    try {
      // Determina os IDs a finalizar. Numa nova tentativa (após alerta de estoque),
      // usa só os grupos que ainda faltam — os já finalizados não são retocados.
      let ids: number[];
      if (pendingFinalizeRef.current) {
        ids = pendingFinalizeRef.current;
      } else if (isCreate && !savedGrupos) {
        const itens = formEstaVazio() ? localItens : [...localItens, form];
        if (itens.length === 0) { toast.error('Adicione ao menos um item'); return; }
        if (!formEstaVazio() && !validarForm()) return;
        const res = await api.post('/clinica/prescricoes/grupos', { animalId, evolucaoId, itens });
        const grupos = res.data.dados as { id: number; numeroFormatado: string }[];
        // Registra os grupos criados — se a finalização falhar (ex: alerta de
        // estoque), a nova tentativa os reutiliza em vez de criar duplicados
        setSavedGrupos(grupos);
        ids = grupos.map(g => g.id);
      } else if (savedGrupos) {
        ids = savedGrupos.map(g => g.id);
      } else if (grupo) {
        ids = [grupo.id];
      } else {
        ids = [];
      }

      // Finaliza cada prescrição; agrega alertas de estoque das que faltarem
      const alertasAgg:     AlertaEstoque[] = [];
      const aindaPendentes: number[]        = [];
      for (const id of ids) {
        try {
          await api.post(`/clinica/prescricoes/grupos/${id}/finalizar`, { forcarFinalizacao: forcar });
        } catch (err: unknown) {
          const resp = (err as { response?: { data?: { erro?: string; alertas?: AlertaEstoque[]; error?: string } } })?.response;
          if (resp?.data?.erro === 'ESTOQUE_INSUFICIENTE') {
            alertasAgg.push(...(resp.data.alertas ?? []));
            aindaPendentes.push(id);
          } else {
            toast.error(resp?.data?.error ?? 'Erro ao finalizar prescrição');
            pendingFinalizeRef.current = aindaPendentes.length ? aindaPendentes : null;
            return;
          }
        }
      }

      if (alertasAgg.length > 0) {
        pendingFinalizeRef.current = aindaPendentes;
        setAlertaEstoque(alertasAgg);
        return;
      }

      pendingFinalizeRef.current = null;
      setAlertaEstoque(null);
      setSavedGrupos(null);
      toast.success(ids.length > 1 ? `${ids.length} prescrições finalizadas com sucesso` : 'Prescrição finalizada com sucesso');
      clearDraft();
      onSaved(); onClose();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { error?: string } } })?.response;
      toast.error(resp?.data?.error ?? 'Erro ao finalizar prescrição');
    } finally { setFinalizing(false); }
  };

  const handleFinalizar = () => executarFinalizacao(false);

  const handleSalvarEditMode = async () => {
    if (!formEstaVazio()) {
      const ok = await handleAdicionarMais();
      if (!ok) return;
    }
    onSaved();
    onClose();
  };

  // Salvar unificado — o botão Finalizar foi absorvido pelo Salvar:
  // com permissão de finalizar, salva e finaliza em uma única ação;
  // sem permissão, mantém o comportamento antigo (salva como SALVO).
  const handleSalvarUnificado = async () => {
    if (canFinalizarCancelar) {
      if (!isCreate && !formEstaVazio()) {
        const ok = await handleAdicionarMais();
        if (!ok) return;
      }
      await executarFinalizacao(false);
      return;
    }
    if (isCreate) await handleSalvar();
    else          await handleSalvarEditMode();
  };

  if (alertaEstoque) {
    return (
      <AlertaEstoqueModal
        alertas={alertaEstoque}
        loading={finalizing}
        onContinuar={() => executarFinalizacao(true)}
        onCancelar={() => setAlertaEstoque(null)}
      />
    );
  }

  // Conteúdo reutilizável do dropdown de medicamentos (usado em 2 layouts distintos)
  const renderMedList = () => {
    if (loadingMeds && !backgroundSearching && medicamentos.length === 0)
      return <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-emerald-500" /></div>;
    if (medicamentos.length === 0 && !backgroundSearching)
      return <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhum medicamento encontrado</p>;
    const onSelect = (m: MedicamentoCat) => {
      const conv = getConversaoUnidade(m.unidade);
      setForm(prev => ({ ...prev, medicamento: m.nome, medicamentoCatId: m.id, unidade: conv ? conv.subunidade : m.unidade, via: m.vias[0]?.via ?? prev.via }));
      setShowMedDropdown(false);
      setMedBusca('');
    };
    return (
      <>
        {backgroundSearching && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-100">
            <Loader2 size={10} className="animate-spin text-emerald-400" />
            <span className="text-[10px] text-gray-400">Buscando...</span>
          </div>
        )}
        {medicamentos.map(m => (
          <button key={m.id} type="button" onMouseDown={() => onSelect(m)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors border-b border-gray-50 last:border-0">
            <span className="font-medium">{m.nome}</span>
            {m.formaFarmaceutica && <span className="ml-2 text-[11px] text-gray-400">{m.formaFarmaceutica}</span>}
            {m.emEstoque && (m.qtdEstoque ?? 0) > 0
              ? <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">Em estoque: {m.qtdEstoque}</span>
              : m.emEstoque
                ? <span className="ml-2 text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Estoque zerado</span>
                : <span className="ml-2 text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Sem estoque</span>
            }
          </button>
        ))}
      </>
    );
  };

  const isMed           = form.tipo === 'MEDICAMENTO';
  // Dose única ("Agora"): não faz sentido pedir duração em dias
  const isDoseUnica     = form.frequencia === 'agora';
  const medCatalogo     = form.medicamentoCatId
    ? medicamentos.find(m => m.id === form.medicamentoCatId) ?? null
    : null;
  const viasDisponiveis = medCatalogo?.vias.map(v => v.via) ?? VIAS;
  const catalogoUnidade  = medCatalogo?.unidade ?? null;
  const conversaoUnidade = getConversaoUnidade(catalogoUnidade);
  // trava o campo apenas quando NÃO há subunidade (ex: mg, mL, UI)
  const unidadeCatalogo  = conversaoUnidade ? null : catalogoUnidade;
  const itensExibidos = isCreate ? localItens : serverItens;
  const editandoItem  = editingLocalIdx !== null || editingServerId !== null;
  // Em modo edição: formulário aparece ao editar item existente ou ao clicar "Inserir item"
  const showItemForm  = canEdit && !isReadOnly && !savedGrupos && (isCreate || editandoItem || showAddForm);

  return (
    <div className={isInline ? '' : 'fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4'}>
      <div className={isInline ? 'w-full' : 'bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-3xl max-h-[95vh] flex flex-col border border-gray-100'}>

        {/* Header — modal only */}
        {!isInline && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">
                {isCreate ? 'NOVA PRESCRIÇÃO' : `PRESCRIÇÃO #${grupo!.numeroFormatado}`}
              </span>
              <h3 className="font-bold text-gray-900">
                {isCreate ? 'Criar documento de prescrição' : 'Editar prescrição'}
              </h3>
              {grupo && (
                <span className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_GRUPO[grupo.status].cls}`}>
                  {STATUS_GRUPO[grupo.status].label}
                </span>
              )}
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X size={18} />
            </button>
          </div>
        )}

        <div className={isInline ? '' : 'flex-1 overflow-y-auto'}>
          <div className="px-5 py-3 space-y-3">

            {/* Formulário de item — dentro da área de itens */}
            {showItemForm && (
              <div className="space-y-3 pb-3 border-b border-gray-100">
                {/* Subheader — modal only */}
                {!isInline && (
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {editandoItem ? '↳ EDITANDO ITEM' : '↳ INSERIR ITEM'}
                    </p>
                    {!isCreate && showAddForm && !editandoItem && (
                      <button onClick={() => { setShowAddForm(false); resetForm(); }}
                        className="p-1 text-gray-400 hover:text-gray-600">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* Tabs tipo */}
                <div className="flex items-center gap-2">
                  {editandoItem ? (
                    <>
                      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl ${
                        form.tipo === 'MEDICAMENTO' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {form.tipo === 'MEDICAMENTO' ? <Pill size={11} /> : <Activity size={11} />}
                        {form.tipo === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'}
                      </span>
                      <span className="text-[10px] text-gray-400 italic">tipo travado na edição</span>
                    </>
                  ) : (
                    (['MEDICAMENTO', 'PROCEDIMENTO'] as TipoItem[]).map(t => (
                      <button key={t} onClick={() => switchTipo(t)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-colors ${
                          form.tipo === t ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}>
                        {t === 'MEDICAMENTO' ? <Pill size={11} /> : <Activity size={11} />}
                        {t === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'}
                      </button>
                    ))
                  )}
                </div>

                {/* Campos: layout 3 colunas (inline+med) ou empilhado (modal ou procedimento) */}
                {isInline && isMed ? (
                  <div className="grid grid-cols-1 sm:grid-cols-7 gap-3 items-end">

                    {/* MEDICAMENTO (span 3) */}
                    <div className="sm:col-span-3">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">MEDICAMENTO *</label>
                      <div ref={medComboboxRef} className="relative">
                        {!showMedDropdown ? (
                          /* Botão — aparece quando NÃO está buscando */
                          <button type="button"
                            onClick={() => { setShowMedDropdown(true); setMedBusca(''); }}
                            className="w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:border-emerald-500 bg-white">
                            <span className={form.medicamento ? 'text-gray-900 truncate' : 'text-gray-400'}>
                              {form.medicamento || 'Selecionar medicamento...'}
                            </span>
                            {form.medicamento ? (
                              <X size={13} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                                onClick={e => { e.stopPropagation(); set('medicamento', ''); set('medicamentoCatId', null); }} />
                            ) : (
                              <ChevronDown size={13} className="text-gray-400 flex-shrink-0 ml-2" />
                            )}
                          </button>
                        ) : (
                          /* Campo de busca — substitui o botão (nunca os dois juntos) */
                          <div className="relative">
                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <input autoFocus type="text" placeholder="Buscar medicamento..."
                              value={medBusca} onChange={e => setMedBusca(e.target.value)}
                              onBlur={() => setTimeout(() => { setShowMedDropdown(false); setMedBusca(''); }, 150)}
                              className="w-full pl-8 pr-3 border border-gray-200 rounded-xl py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                              <div className="max-h-40 overflow-y-auto">
                                {renderMedList()}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* DOSAGEM (span 2) */}
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">DOSAGEM *</label>
                      <div className="flex items-center h-[38px] border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500">
                        <input type="number" min="0" step="0.001" value={form.dosagem}
                          onChange={e => set('dosagem', e.target.value)}
                          className="flex-1 min-w-[40px] px-3 py-2 text-sm focus:outline-none bg-transparent" />
                        <div className="w-px h-4 bg-gray-200 flex-shrink-0" />
                        {unidadeCatalogo ? (
                          <span className="px-2 py-2 text-sm text-gray-700 font-medium flex-shrink-0">{unidadeCatalogo}</span>
                        ) : (
                          <select value={form.unidade} onChange={e => set('unidade', e.target.value)}
                            className="w-20 flex-shrink-0 px-1 py-2 text-sm text-gray-700 focus:outline-none bg-transparent cursor-pointer">
                            {conversaoUnidade
                              ? conversaoUnidade.opcoes.map(u => <option key={u}>{u}</option>)
                              : <><option value="">—</option>{UNIDADES.map(u => <option key={u}>{u}</option>)}</>
                            }
                          </select>
                        )}
                      </div>
                    </div>

                    {/* VIA ADMINISTRAÇÃO (span 2) */}
                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">VIA ADMINISTRAÇÃO *</label>
                      <select value={form.via} onChange={e => set('via', e.target.value)}
                        className={`w-full h-[38px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${!form.via ? 'text-gray-400' : 'text-gray-900'}`}>
                        <option value="">— Selecionar —</option>
                        {viasDisponiveis.map(v => <option key={v} className="text-gray-900">{v}</option>)}
                      </select>
                    </div>

                  </div>
                ) : (
                  <>
                  {/* Medicamento / Procedimento (procedimento: Especialidade à esquerda na mesma linha) */}
                  <div className={isMed ? '' : 'grid grid-cols-5 gap-3'}>
                  {!isMed && (
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                        ESPECIALIDADE
                      </label>
                      <select value={procEspecialidade}
                        onChange={e => setProcEspecialidade(e.target.value)}
                        className={`w-full border border-gray-200 rounded-xl px-2 py-2 text-sm bg-white focus:outline-none focus:border-emerald-500 ${!procEspecialidade ? 'text-gray-400' : 'text-gray-900'}`}>
                        <option value="">Todas</option>
                        {especialidadesProc.map(e => <option key={e} value={e} className="text-gray-900">{e}</option>)}
                      </select>
                    </div>
                  )}
                  <div className={isMed ? '' : 'col-span-3'}>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
                    {isMed ? 'MEDICAMENTO' : 'PROCEDIMENTO'} *
                  </label>
                  {isMed ? (
                    <div ref={medComboboxRef} className="relative">
                      {!showMedDropdown ? (
                        /* Botão — aparece quando NÃO está buscando */
                        <button type="button"
                          onClick={() => { setShowMedDropdown(true); setMedBusca(''); }}
                          className="w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:border-emerald-500 bg-white">
                          <span className={form.medicamento ? 'text-gray-900 truncate' : 'text-gray-400'}>
                            {form.medicamento || 'Selecionar medicamento...'}
                          </span>
                          {form.medicamento ? (
                            <X size={13} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                              onClick={e => { e.stopPropagation(); set('medicamento', ''); set('medicamentoCatId', null); }} />
                          ) : (
                            <ChevronDown size={13} className="text-gray-400 flex-shrink-0 ml-2" />
                          )}
                        </button>
                      ) : (
                        /* Campo de busca — substitui o botão (nunca os dois juntos) */
                        <div className="relative">
                          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <input autoFocus type="text" placeholder="Buscar medicamento..."
                            value={medBusca} onChange={e => setMedBusca(e.target.value)}
                            onBlur={() => setTimeout(() => { setShowMedDropdown(false); setMedBusca(''); }, 150)}
                            className="w-full pl-8 pr-3 border border-gray-200 rounded-xl py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500" />
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                            <div className="max-h-40 overflow-y-auto">
                              {renderMedList()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={form.medicamento}
                        onChange={e => { set('medicamento', e.target.value); set('medicamentoCatId', null); setShowProcDropdown(true); }}
                        onFocus={() => setShowProcDropdown(true)}
                        onBlur={() => setTimeout(() => setShowProcDropdown(false), 150)}
                        placeholder="Buscar procedimento..."
                        className="w-full pl-8 pr-3 border border-gray-200 rounded-xl py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                      />
                      {showProcDropdown && (
                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                          {procsPorEspecialidade
                            .filter(p => p.nome.toLowerCase().includes(form.medicamento.toLowerCase()))
                            .slice(0, 40)
                            .map(p => (
                              <button key={p.id} type="button"
                                onMouseDown={() => { set('medicamento', p.nome); setShowProcDropdown(false); }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-gray-50 last:border-0">
                                <span className="font-medium">{p.nome}</span>
                                {p.combo && (
                                  <span className="ml-1.5 text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full align-middle">COMBO</span>
                                )}
                                {p.valor != null && (
                                  <span className="ml-1.5 text-[10px] text-emerald-600 font-semibold">
                                    R$ {p.valor.toFixed(2).replace('.', ',')}
                                  </span>
                                )}
                                {!procEspecialidade && p.especialidade && (
                                  <span className="block text-[10px] text-gray-400">{p.especialidade}</span>
                                )}
                              </button>
                            ))}
                          {procsPorEspecialidade.filter(p => p.nome.toLowerCase().includes(form.medicamento.toLowerCase())).length === 0 && (
                            <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhum procedimento encontrado</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                </div>

                {/* Dosagem + Via */}
                {isMed && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">DOSAGEM *</label>
                      <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500">
                        <input type="number" min="0" step="0.001" value={form.dosagem}
                          onChange={e => set('dosagem', e.target.value)}
                          className="flex-1 min-w-0 px-3 py-2 text-sm focus:outline-none bg-transparent" />
                        <div className="w-px h-4 bg-gray-200 flex-shrink-0" />
                        {unidadeCatalogo ? (
                          <span className="px-2 py-2 text-sm text-gray-700 font-medium flex-shrink-0">
                            {unidadeCatalogo}
                          </span>
                        ) : (
                          <select value={form.unidade} onChange={e => set('unidade', e.target.value)}
                            className="px-2 py-2 text-sm text-gray-700 focus:outline-none bg-transparent cursor-pointer">
                            {conversaoUnidade
                              ? conversaoUnidade.opcoes.map(u => <option key={u}>{u}</option>)
                              : <><option value="">—</option>{UNIDADES.map(u => <option key={u}>{u}</option>)}</>
                            }
                          </select>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">VIA ADMINISTRAÇÃO *</label>
                      <select value={form.via} onChange={e => set('via', e.target.value)}
                        className={`w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${!form.via ? 'text-gray-400' : 'text-gray-900'}`}>
                        <option value="">— Selecionar —</option>
                        {viasDisponiveis.map(v => <option key={v} className="text-gray-900">{v}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                  </>
                )}

                {/* Frequência + Hora + Duração + Data Início */}
                <div className="grid grid-cols-2 sm:grid-cols-8 gap-3">
                  <div className="col-span-2 sm:col-span-3">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">FREQUÊNCIA *</label>
                    <select value={form.frequencia}
                      onChange={e => {
                        const v = e.target.value;
                        set('frequencia', v);
                        // Dose única: força duração = 1 (o back ignora dias em "agora")
                        if (v === 'agora') set('duracaoDias', 1);
                      }}
                      className={`w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500 ${!form.frequencia ? 'text-gray-400' : 'text-gray-900'}`}>
                      <option value="">— Selecionar —</option>
                      {POSOLOGIAS.map(p => <option key={p.value} value={p.value} className="text-gray-900">{p.label}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1"><Clock size={9} /> HORA INÍCIO</label>
                    <input type="time" value={form.horaInicio} onChange={e => set('horaInicio', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">DURAÇÃO (DIAS){!isDoseUnica && ' *'}</label>
                    <input type="number" min="1"
                      value={isDoseUnica ? '' : form.duracaoDias}
                      disabled={isDoseUnica}
                      onChange={e => set('duracaoDias', e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder={isDoseUnica ? 'Dose única' : 'Ex: 7'}
                      className={`w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500 ${isDoseUnica ? 'bg-gray-50 text-gray-400 cursor-not-allowed placeholder:text-gray-400' : ''}`} />
                  </div>
                  <div className="col-span-2 sm:col-span-2">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">DATA INÍCIO</label>
                    <DateInput
                      value={form.dataInicio}
                      onChange={v => set('dataInicio', v)}
                      className="w-full border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-900 focus-within:border-emerald-500"
                    />
                  </div>
                </div>

                {/* Observação */}
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">OBSERVAÇÃO</label>
                  <textarea value={form.observacao} onChange={e => set('observacao', e.target.value)}
                    rows={2} maxLength={500} placeholder="Instrução de uso, diluição, etc..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none" />
                </div>

                {/* Checkbox medicamento fornecido pelo cliente */}
                {isMed && (
                  <div>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.medicamentoCliente}
                        onChange={e => set('medicamentoCliente', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <span className="text-sm text-red-600 font-medium">Medicamento fornecido pelo Cliente</span>
                    </label>
                    {form.medicamentoCliente && (
                      <p className="text-xs text-amber-600 mt-1.5 ml-6">Sem baixa no estoque</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Confirmação após Salvar em modo criação */}
            {isCreate && savedGrupos && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 size={28} className="mb-2 text-emerald-500" />
                <p className="font-semibold text-sm text-gray-800">
                  {savedGrupos.length > 1
                    ? `${savedGrupos.length} prescrições salvas (${savedGrupos.map(g => `#${g.numeroFormatado}`).join(', ')})`
                    : `Prescrição #${savedGrupos[0].numeroFormatado} salva`}
                </p>
                <p className="text-xs text-gray-400 mt-1">Salve para ativar ou crie uma nova prescrição</p>
              </div>
            )}

            {/* Lista de itens — empty state só aparece quando o form está fechado */}
            {!showItemForm && !savedGrupos && itensExibidos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <FileText size={28} className="mb-2" />
                <p className="text-sm text-gray-400">Nenhum item adicionado</p>
              </div>
            ) : itensExibidos.length > 0 ? (
              <>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
                  ITENS DA PRESCRIÇÃO ({itensExibidos.length})
                </p>
                <div className="space-y-2">
                  {isCreate
                    ? (localItens as FormItem[]).map((item, idx) => (
                        <ItemRow
                          key={idx}
                          label={item.medicamento}
                          tipo={item.tipo}
                          dosagem={item.dosagem}
                          unidade={item.unidade}
                          via={item.via}
                          frequencia={item.frequencia}
                          horaInicio={item.horaInicio}
                          duracaoDias={item.duracaoDias}
                          dataInicio={item.dataInicio}
                          observacao={item.observacao}
                          medicamentoCliente={item.medicamentoCliente}
                          isEditing={editingLocalIdx === idx}
                          canEdit={canEdit}
                          onEdit={() => handleEditarLocal(idx)}
                          onRemove={() => handleRemoverLocal(idx)}
                          isDragging={draggedIdx === idx}
                          isDragOver={dragOverIdx === idx}
                          onDragStart={() => setDraggedIdx(idx)}
                          onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                          onDrop={() => handleReorder(draggedIdx ?? idx, idx)}
                          onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
                        />
                      ))
                    : serverItens.map((item, idx) => {
                        const completo = itemTotalmenteExecutado(item);
                        const emAndamentoItem = !!item.executadoEm && !completo;
                        return (
                        <ItemRow
                          key={item.id}
                          label={item.medicamento}
                          tipo={item.tipo}
                          dosagem={item.dosagem}
                          unidade={item.unidade}
                          via={item.via}
                          frequencia={item.frequencia}
                          horaInicio={item.horaInicio}
                          duracaoDias={item.duracaoDias}
                          dataInicio={item.dataInicio}
                          observacao={item.observacao}
                          medicamentoCliente={item.medicamentoCliente}
                          executado={completo}
                          emAndamento={emAndamentoItem ? { diaAtual: diaAtualDoItem(item.dataInicio), totalDias: item.duracaoDias } : null}
                          isEditing={editingServerId === item.id}
                          canEdit={canEdit && !completo}
                          canRemove={canEdit && !item.executadoEm}
                          onEdit={() => handleEditarServer(item)}
                          onRemove={() => setRemovendoItemId(item.id)}
                          isDragging={draggedIdx === idx}
                          isDragOver={dragOverIdx === idx}
                          onDragStart={() => setDraggedIdx(idx)}
                          onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                          onDrop={() => handleReorder(draggedIdx ?? idx, idx)}
                          onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
                        />
                        );
                      })
                  }
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-wrap ${!isInline ? 'flex-shrink-0' : 'mt-2'}`}>
          <div className="flex items-center gap-2 ml-auto flex-wrap">

            {/* Estado "recém-salvo": prescrição(ões) salva(s) aguardando finalização */}
            {isCreate && savedGrupos ? (
              <>
                <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1 flex-shrink-0">
                  <CheckCircle2 size={12} /> {savedGrupos.length > 1 ? `${savedGrupos.length} salvas` : `#${savedGrupos[0].numeroFormatado} salva`}
                </span>
                <button
                  onClick={() => { setSavedGrupos(null); pendingFinalizeRef.current = null; clearDraft(); onClose(); }}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  Nova Prescrição
                </button>
                {canFinalizarCancelar && (
                  <button
                    onClick={handleFinalizar}
                    disabled={finalizing}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                    {finalizing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Salvar
                  </button>
                )}
              </>
            ) : (
              <>
                {/* Imprimir — FINALIZADO ou EXECUTADO */}
                {(grupo?.status === 'FINALIZADO' || grupo?.status === 'EXECUTADO') && podeImprimir && (
                  <button onClick={() => imprimirPrescricao(grupo!, animal)}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm transition-colors">
                    <Printer size={14} /> Imprimir
                  </button>
                )}

                {/* Inserir item — só edit mode SALVO, quando o form está fechado */}
                {!isCreate && canEdit && !isReadOnly && !showItemForm && (
                  <button onClick={() => { setShowAddForm(true); setForm(FORM_VAZIO()); }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    Inserir
                  </button>
                )}

                {/* Inserir / Atualizar item — quando o form está aberto */}
                {showItemForm && canEdit && !isReadOnly && (
                  <button
                    onClick={handleAdicionarMais}
                    disabled={saving || formEstaVazio()}
                    className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    {editandoItem ? 'Atualizar item' : 'Inserir'}
                  </button>
                )}

                {/* Fechar / Cancelar — modal only */}
                {!isInline && (
                  <button onClick={onClose}
                    className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    {isReadOnly ? 'Fechar' : 'Cancelar'}
                  </button>
                )}

                {/* Salvar — absorveu o Finalizar: salva e finaliza quando o usuário
                    tem permissão de finalizar (desacoplado de canEdit, como o
                    Finalizar antigo — FORNECEDOR finaliza o próprio item) */}
                {(canEdit || canFinalizarCancelar) && !isReadOnly && (
                  <button onClick={handleSalvarUnificado}
                    disabled={saving || finalizing || (isCreate && localItens.length === 0 && formEstaVazio())}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                    {(saving || finalizing) ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Salvar
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ModalJustificativa
        aberto={removendoItemId !== null}
        titulo="Remover item da prescrição?"
        descricao={serverItens.find(it => it.id === removendoItemId)?.medicamento ?? undefined}
        acaoLabel="Remover"
        onConfirmar={(motivo) => { if (removendoItemId !== null) handleRemoverServer(removendoItemId, motivo); }}
        onFechar={() => setRemovendoItemId(null)}
      />
    </div>
  );
}

// ─── ItemRow ──────────────────────────────────────────────────────────────────

function calcDataFim(dataInicio: string, dias: number | ''): string {
  if (!dataInicio || !dias) return '';
  const d = new Date(dataInicio.split('T')[0] + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(dias) - 1);
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${dy}/${m}/${y}`;
}

function InfoChip({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="text-[10px] text-gray-500 whitespace-nowrap">
      <span className="text-gray-400 mr-0.5">{label}</span>{value}
    </span>
  );
}

function ItemRow({
  label, tipo, dosagem, unidade, via, frequencia,
  horaInicio, duracaoDias, dataInicio, observacao, medicamentoCliente, executado, emAndamento,
  isEditing, canEdit, canRemove, onEdit, onRemove,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  label: string; tipo: TipoItem;
  dosagem: string | null; unidade: string | null; via: string; frequencia: string;
  horaInicio?: string | null; duracaoDias?: number | ''; dataInicio?: string; observacao?: string | null;
  medicamentoCliente?: boolean; executado?: boolean;
  /** Item já teve dose(s) dada(s) mas ainda tem dias restantes — editável, não excluível */
  emAndamento?: { diaAtual: number; totalDias: number } | null;
  isEditing: boolean; canEdit: boolean; canRemove?: boolean;
  onEdit: () => void; onRemove: () => void;
  isDragging?: boolean; isDragOver?: boolean;
  onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void; onDragEnd?: () => void;
}) {
  const podeRemover = canRemove ?? canEdit;
  const isMed  = tipo === 'MEDICAMENTO';
  const isDoseUnicaRow = frequencia === 'agora';
  const dtFim  = !isDoseUnicaRow && dataInicio && duracaoDias ? calcDataFim(dataInicio, duracaoDias) : '';
  const dtIni  = dataInicio ? formatarData(dataInicio) : '';

  return (
    <div
      draggable={canEdit && !!onDragStart}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-colors ${canEdit && onDragStart ? 'cursor-grab active:cursor-grabbing' : ''} ${
        isDragOver   ? 'border-emerald-400 bg-emerald-50 scale-[1.01]' :
        isDragging   ? 'opacity-40 border-dashed border-emerald-300' :
        isEditing    ? 'border-emerald-300 bg-emerald-50' :
                       'border-gray-100 bg-gray-50'
      }`}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
        isMed ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
      }`}>
        {isMed ? <Pill size={9} /> : <Activity size={9} />}
        {isMed ? 'Med' : 'Proc'}
      </span>

      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        {medicamentoCliente && (
          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
            Cliente
          </span>
        )}
        {executado && (
          <span title="Já executado integralmente — não pode ser alterado"
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
            <Lock size={9} /> Executado
          </span>
        )}
        {!executado && emAndamento && (
          <span title="Já em execução — a alteração vale só para os dias restantes"
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
            <Clock size={9} /> Em execução ({String(emAndamento.diaAtual).padStart(2, '0')}/{String(emAndamento.totalDias).padStart(2, '0')})
          </span>
        )}
        {isMed && dosagem && (
          <InfoChip label="Dose:" value={`${dosagem}${unidade ? ' '+unidade : ''}`} />
        )}
        {isMed && via    && <InfoChip label="Via:" value={via} />}
        <InfoChip label="Freq:" value={labelPosologia(frequencia)} />
        {horaInicio      && <InfoChip label="Hora:" value={horaInicio} />}
        {!isDoseUnicaRow && duracaoDias && <InfoChip label="Dur:" value={`${duracaoDias}d`} />}
        {dtIni           && <InfoChip label="Início:" value={dtIni} />}
        {dtFim           && <InfoChip label="Fim:" value={dtFim} />}
        {observacao      && <InfoChip label="Obs:" value={observacao} />}
      </div>

      {(canEdit || podeRemover) && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {canEdit && (
            <button onClick={onEdit}
              className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
              <Pencil size={12} />
            </button>
          )}
          {podeRemover && (
            <button onClick={onRemove}
              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CancelarModal ────────────────────────────────────────────────────────────

function CancelarModal({
  onConfirmar, onCancelar,
}: {
  onConfirmar: (motivo: string) => void;
  onCancelar:  () => void;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <Trash2 size={18} className="text-red-600" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Cancelar prescrição</h3>
            <p className="text-xs text-gray-500">A prescrição ficará no histórico como cancelada.</p>
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Motivo do cancelamento <span className="text-red-500">*</span></label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={3}
            placeholder="Informe o motivo (obrigatório)..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <p className="text-[10px] text-gray-400 mt-1">A justificativa é obrigatória e fica registrada na auditoria.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onCancelar} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Voltar
          </button>
          <button onClick={() => onConfirmar(motivo)} disabled={motivo.trim().length < 3}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
            Confirmar cancelamento
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ViewPrescricaoModal ──────────────────────────────────────────────────────
// Janela de visualização somente leitura — usada pelo clique no Histórico do
// Paciente. Abre sempre, independente do status da prescrição (SALVO,
// FINALIZADO, EXECUTADO, CANCELADO_PARCIALMENTE); nenhum botão de editar/excluir.

function ViewPrescricaoModal({ grupo, onClose, onImprimir }: {
  grupo:      PrescricaoGrupo;
  onClose:    () => void;
  onImprimir: () => void;
}) {
  const st = STATUS_GRUPO[grupo.status as StatusGrupo] ?? { label: grupo.status, cls: 'bg-gray-100 text-gray-600' };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[88vh] flex flex-col border border-gray-100">

        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <p className="text-sm font-semibold text-gray-900 mb-1.5 font-mono">Prescrição #{grupo.numeroFormatado}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                {st.label}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
              <span className="text-[11px] text-gray-400">
                <span className="font-medium text-gray-600">{grupo.veterinario.fullName}</span>
              </span>
              <span className="text-[11px] text-gray-400">
                Criada em: <span className="text-gray-600">{formatarData(grupo.createdAt)}</span>
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {grupo.itens.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Nenhum item ativo nesta prescrição.</p>
          ) : grupo.itens.map(item => {
            const completo = itemTotalmenteExecutado(item);
            return (
            <ItemRow
              key={item.id}
              label={item.medicamento}
              tipo={item.tipo}
              dosagem={item.dosagem}
              unidade={item.unidade}
              via={item.via}
              frequencia={item.frequencia}
              horaInicio={item.horaInicio}
              duracaoDias={item.duracaoDias}
              dataInicio={item.dataInicio}
              observacao={item.observacao}
              medicamentoCliente={item.medicamentoCliente}
              executado={completo}
              emAndamento={!!item.executadoEm && !completo ? { diaAtual: diaAtualDoItem(item.dataInicio), totalDias: item.duracaoDias } : null}
              isEditing={false}
              canEdit={false}
              onEdit={() => {}}
              onRemove={() => {}}
            />
            );
          })}
        </div>

        <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
          <button onClick={onImprimir}
            className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            <Printer size={14} /> Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SubModuloPrescricao ──────────────────────────────────────────────────────

export default function SubModuloPrescricao({ animalId, animal, onFaturaAtualizada, evolucaoId, atendimentoNumero, onSalvo, openItemId, onViewConsumed, editItemId, onEditConsumed }: Props) {
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar    = isGestor || podeExecutar('atendimento.prescricoes.criar');
  const podeEditar   = isGestor || podeExecutar('atendimento.prescricoes.editar');
  const podeFinalizar = isGestor || podeExecutar('atendimento.prescricoes.finalizar');
  const podeImprimir  = isGestor || podeExecutar('atendimento.prescricoes.imprimir');

  const canEdit = podeCriar;
  const canFinalizarCancelar = podeFinalizar;
  // FORNECEDOR só edita/finaliza/cancela itens que ele próprio criou (mesmo que a MatrizPerfil conceda EQUIPE/FULL)
  const isFornecedor = user?.userType === 'FORNECEDOR';

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [grupos,             setGrupos]             = useState<PrescricaoGrupo[]>([]);
  const [loading,            setLoading]            = useState(false);
  const [total,              setTotal]              = useState(0);
  const [salvos,             setSalvos]             = useState(0);
  const [page,               setPage]               = useState(1);
  const [limit]                                     = useState(10);
  const [showEditModal,      setShowEditModal]      = useState(false);
  const [editingGrupo,       setEditingGrupo]       = useState<PrescricaoGrupo | null>(null);
  const [viewingGrupo,       setViewingGrupo]       = useState<PrescricaoGrupo | null>(null);
  const [inlineFormKey,      setInlineFormKey]      = useState(0);
  const [deletingId,         setDeletingId]         = useState<number | null>(null);
  const [alertaDireto,       setAlertaDireto]       = useState<{ grupoId: number; alertas: AlertaEstoque[] } | null>(null);
  const [loadingForceDireto, setLoadingForceDireto] = useState(false);

  const totalPaginas = Math.ceil(total / limit);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/clinica/prescricoes/grupos/animal/${animalId}?page=${page}&limit=${limit}`);
      setGrupos(res.data.dados ?? []);
      setTotal(res.data.total ?? 0);
      setSalvos(res.data.salvos ?? 0);
    } catch { toast.error('Erro ao carregar prescrições'); }
    finally { setLoading(false); }
  }, [animalId, page, limit]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirEdicao = (g: PrescricaoGrupo) => { setEditingGrupo(g); setShowEditModal(true); };

  // Visualização SOMENTE LEITURA — busca o detalhe e abre o VisualizacaoGrupo,
  // sem entrar em modo de edição (independente do status).
  const abrirVisualizacao = async (g: PrescricaoGrupo) => {
    try {
      const res = await api.get(`/clinica/prescricoes/grupos/${g.id}`);
      setViewingGrupo((res.data?.dados as PrescricaoGrupo) ?? g);
    } catch { setViewingGrupo(g); }
  };

  // "Não executada" = editável: SALVO ou FINALIZADO sem NENHUM item executado.
  const grupoNaoExecutado = (g: PrescricaoGrupo) =>
    !['EXECUTADO', 'CANCELADO', 'CANCELADO_PARCIALMENTE'].includes(g.status) &&
    !g.itens.some(i => i.executadoEm);

  // Alterar: SALVO abre direto; FINALIZADA (não executada) confirma a reabertura
  // (volta para rascunho e libera reservas) antes de editar.
  const [reabrindo,        setReabrindo]        = useState<PrescricaoGrupo | null>(null);
  const [reabrindoLoading, setReabrindoLoading] = useState(false);

  const handleAlterar = (g: PrescricaoGrupo) => {
    if (g.status === 'SALVO') { abrirEdicao(g); return; }
    setReabrindo(g);
  };

  const confirmarReabrir = async () => {
    if (!reabrindo) return;
    setReabrindoLoading(true);
    try {
      const res = await api.post(`/clinica/prescricoes/grupos/${reabrindo.id}/reabrir`);
      const g = (res.data?.dados as PrescricaoGrupo) ?? { ...reabrindo, status: 'SALVO' as StatusGrupo };
      setReabrindo(null);
      abrirEdicao(g);
      carregar();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e?.response?.data?.error ?? 'Erro ao reabrir prescrição');
    } finally {
      setReabrindoLoading(false);
    }
  };

  // Clique no Histórico do Paciente / Visualizar atendimento: popula o
  // formulário da página com a prescrição (somente leitura), independente do
  // status, e rola até ele para o usuário ver os campos preenchidos.
  const viewTopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openItemId) return;
    api.get(`/clinica/prescricoes/grupos/${openItemId}`)
      .then(res => {
        if (res.data?.dados) {
          setViewingGrupo(res.data.dados as PrescricaoGrupo);
          setTimeout(() => viewTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        }
      })
      .catch(() => {})
      .finally(() => onViewConsumed?.());
  }, [openItemId]);

  // Vindo do botão "Editar" do Histórico do Paciente (AG-XXXX/EV-XXXX): abre a
  // prescrição vinculada ao atendimento direto no formulário de edição.
  const editIdAplicadoRef = useRef<number | null>(null);
  useEffect(() => {
    if (!editItemId) { editIdAplicadoRef.current = null; return; }
    if (editIdAplicadoRef.current === editItemId) return;
    editIdAplicadoRef.current = editItemId;
    api.get(`/clinica/prescricoes/grupos/${editItemId}`)
      .then(res => {
        if (res.data?.dados) { setEditingGrupo(res.data.dados as PrescricaoGrupo); setShowEditModal(true); }
        onEditConsumed?.();
      })
      .catch(() => {});
  }, [editItemId]);

  const handleFinalizarDireto = async (grupoId: number) => {
    if (!podeFinalizar) { semPermissao('finalizar prescrição'); return; }
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupoId}/finalizar`);
      toast.success('Prescrição finalizada com sucesso');
      carregar();
      onFaturaAtualizada();
      onSalvo?.();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { erro?: string; alertas?: AlertaEstoque[]; error?: string } } })?.response;
      if (resp?.data?.erro === 'ESTOQUE_INSUFICIENTE') {
        setAlertaDireto({ grupoId, alertas: resp.data.alertas ?? [] });
      } else {
        toast.error(resp?.data?.error ?? 'Erro ao finalizar prescrição');
      }
    }
  };

  const handleForcarFinalizacaoDireto = async () => {
    if (!alertaDireto) return;
    setLoadingForceDireto(true);
    try {
      await api.post(`/clinica/prescricoes/grupos/${alertaDireto.grupoId}/finalizar`, { forcarFinalizacao: true });
      setAlertaDireto(null);
      toast.success('Prescrição finalizada com sucesso');
      carregar();
      onFaturaAtualizada();
      onSalvo?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao finalizar prescrição');
    } finally {
      setLoadingForceDireto(false);
    }
  };
  const fecharModal = () => { setShowEditModal(false); setEditingGrupo(null); };
  const onSaved = () => { carregar(); onFaturaAtualizada(); onSalvo?.(); };

  const handleExcluirCancelar = async (motivo: string) => {
    if (!podeFinalizar) { semPermissao('cancelar prescrição'); return; }
    if (deletingId === null) return;
    try {
      await api.post(`/clinica/prescricoes/grupos/${deletingId}/cancelar`, { motivo });
      toast.success('Prescrição cancelada');
      carregar();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
      if (data?.code === 'EXECUTADO') {
        toast.error('Esta prescrição já foi executada e não pode ser alterada ou cancelada.');
      } else {
        toast.error(data?.error ?? 'Erro ao cancelar prescrição');
      }
    } finally { setDeletingId(null); }
  };

  const actionBar = salvos > 0 && (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
      <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-xl flex-shrink-0">
        {salvos} prescrição{salvos > 1 ? 'ões' : ''} salva{salvos > 1 ? 's' : ''} aguardando finalização
      </span>
    </div>
  );

  // Só a CRIAÇÃO de uma nova prescrição exige evolução ativa — o histórico de
  // prescrições já existentes (e os modais de visualização/edição, abaixo)
  // ficam sempre visíveis, do mesmo jeito que Evolução e Exames já fazem.
  const semEvolucaoAtiva = !evolucaoId;

  return (
    <>
      <div ref={viewTopRef} />

      {/* Visualização inline (Histórico de Evolução Clínica): campos da
          prescrição populados no formulário da página, somente leitura */}
      {viewingGrupo && (
        <div className="border-b border-gray-100">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="flex items-center gap-1.5">
              <Eye size={12} className="text-gray-400" />
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Prescrição #{viewingGrupo.numeroFormatado} — somente leitura
              </p>
            </div>
            <button onClick={() => setViewingGrupo(null)}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Fechar visualização">
              <X size={16} />
            </button>
          </div>
          <GrupoModal
            key={`view-${viewingGrupo.id}`}
            animalId={animalId}
            animal={animal}
            grupo={viewingGrupo}
            canEdit={false}
            canFinalizarCancelar={false}
            podeImprimir={podeImprimir}
            onClose={() => setViewingGrupo(null)}
            onSaved={onSaved}
            isInline
          />
        </div>
      )}

      {/* Formulário inline de criação */}
      {!viewingGrupo && canEdit && (
        semEvolucaoAtiva ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4 border-b border-gray-100">
            <FileText size={28} className="mb-2 text-gray-200" />
            <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Inicie uma evolução na aba Evolução para registrar prescrições neste atendimento.
            </p>
          </div>
        ) : (
          <GrupoModal
            key={inlineFormKey}
            animalId={animalId}
            animal={animal}
            grupo={null}
            canEdit={canEdit}
            canFinalizarCancelar={canFinalizarCancelar}
            podeImprimir={podeImprimir}
            evolucaoId={evolucaoId}
            onClose={() => setInlineFormKey(k => k + 1)}
            onSaved={onSaved}
            isInline
          />
        )
      )}

      {/* Badge de salvos aguardando */}
      {actionBar}

      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Prescrições</p>
        <span className="text-xs text-gray-400">{total} registro{total !== 1 ? 's' : ''}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-emerald-600" />
        </div>
      ) : grupos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={38} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma prescrição encontrada</p>
        </div>
      ) : (
      <>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Nº Prescrição</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo / Itens</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Veterinário</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <span className="flex items-center justify-center gap-1"><Calendar size={11} /> Data</span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {grupos.map(g => {
              const eProprioAutor = g.veterinarioId === (user?.id ?? 0);
              const editavel   = grupoNaoExecutado(g) && canEdit && (!isFornecedor || eProprioAutor);
              const podeFinalizarDireto = g.status === 'SALVO';
              const cancelavel = ['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(g.status) && canFinalizarCancelar && (!isFornecedor || eProprioAutor);
              return (
                <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => abrirVisualizacao(g)}
                      className="font-mono font-bold text-emerald-700 hover:text-emerald-900 text-sm hover:underline">
                      #{g.numeroFormatado}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_GRUPO[g.status].cls}`}>
                      {STATUS_GRUPO[g.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORIA_BADGE[categoriaGrupo(g)]}`}>
                      {categoriaGrupo(g)}
                    </span>
                    <div className="mt-0.5">
                      <span className="text-xs text-gray-600 font-medium">{g.itens.length}</span>
                      <span className="text-[10px] text-gray-400 ml-1">
                        {g.itens.filter(i => i.tipo === 'MEDICAMENTO').length}M{' '}
                        {g.itens.filter(i => i.tipo === 'PROCEDIMENTO').length}P
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <p className="text-xs font-medium text-gray-800 whitespace-nowrap">{g.veterinario.fullName}</p>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">{formatarData(g.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => abrirVisualizacao(g)} title="Visualizar"
                        className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                        <Eye size={13} />
                      </button>
                      {editavel && (
                        <button onClick={() => handleAlterar(g)} title="Alterar"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <Pencil size={13} />
                        </button>
                      )}
                      {podeFinalizarDireto && canFinalizarCancelar && (
                        <button onClick={() => handleFinalizarDireto(g.id)} title="Finalizar prescrição"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <CheckCircle2 size={13} />
                        </button>
                      )}
                      {(g.status === 'FINALIZADO' || g.status === 'EXECUTADO') && podeImprimir && (
                        <button onClick={() => imprimirPrescricao(g, animal)} title="Imprimir prescrição"
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                          <Printer size={13} />
                        </button>
                      )}
                      {cancelavel && (
                        <button onClick={() => setDeletingId(g.id)} title="Cancelar prescrição"
                          className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={13} />
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

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-gray-50">
        {grupos.map(g => {
          const eProprioAutorMobile = g.veterinarioId === (user?.id ?? 0);
          const editavelMobile = grupoNaoExecutado(g) && canEdit && (!isFornecedor || eProprioAutorMobile);
          return (
          <div key={g.id} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <button onClick={() => abrirVisualizacao(g)}
                  className="font-mono font-bold text-emerald-700 hover:underline text-sm flex-shrink-0">
                  #{g.numeroFormatado}
                </button>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORIA_BADGE[categoriaGrupo(g)]}`}>
                  {categoriaGrupo(g)}
                </span>
              </div>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${STATUS_GRUPO[g.status].cls}`}>
                {STATUS_GRUPO[g.status].label}
              </span>
            </div>
            <p className="text-xs text-gray-500">{g.veterinario.fullName} • {g.itens.length} item{g.itens.length !== 1 ? 'ns' : ''}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{formatarData(g.createdAt)}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button onClick={() => abrirVisualizacao(g)}
                className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                <Eye size={11} /> Visualizar
              </button>
              {editavelMobile && (
                <button onClick={() => handleAlterar(g)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                  <Pencil size={11} /> Alterar
                </button>
              )}
              <button onClick={() => abrirWhatsApp(montarTextoPrescricao(g))}
                className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors">
                <MessageCircle size={11} /> WhatsApp
              </button>
              <button onClick={() => abrirEmail(`Prescrição ${g.numeroFormatado}`, montarTextoPrescricao(g))}
                className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-blue-500 rounded-lg text-xs hover:bg-blue-50 transition-colors">
                <Mail size={11} /> E-mail
              </button>
              {(g.status === 'FINALIZADO' || g.status === 'EXECUTADO') && podeImprimir && (
                <button onClick={() => imprimirPrescricao(g, animal)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-500 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                  <Printer size={11} /> Imprimir
                </button>
              )}
              {['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(g.status) && canFinalizarCancelar && (!isFornecedor || eProprioAutorMobile) && (
                <button onClick={() => setDeletingId(g.id)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                  <Trash2 size={11} /> Cancelar
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
          <span className="text-xs text-gray-400">{total} prescrição{total !== 1 ? 'ões' : ''}</span>
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

      {/* Modal de edição de prescrição existente — só GESTOR pode alterar itens */}
      {showEditModal && editingGrupo && (
        <GrupoModal
          // Força remount ao trocar de prescrição (ex: clicar em outro item do
          // histórico com o modal já aberto) — sem isso, o estado interno do
          // modal (itens carregados na abertura) ficava travado no primeiro
          // grupo aberto e não mostrava os itens da nova prescrição selecionada.
          key={editingGrupo.id}
          animalId={animalId}
          animal={animal}
          grupo={editingGrupo}
          canEdit={isGestor}
          canFinalizarCancelar={canFinalizarCancelar}
          podeImprimir={podeImprimir}
          onClose={fecharModal}
          onSaved={onSaved}
        />
      )}
      {deletingId !== null && (
        <CancelarModal onConfirmar={handleExcluirCancelar} onCancelar={() => setDeletingId(null)} />
      )}
      {alertaDireto && (
        <AlertaEstoqueModal
          alertas={alertaDireto.alertas}
          loading={loadingForceDireto}
          onContinuar={handleForcarFinalizacaoDireto}
          onCancelar={() => setAlertaDireto(null)}
        />
      )}
      <ConfirmModal
        open={reabrindo !== null}
        variante="aviso"
        titulo={`Reabrir prescrição #${reabrindo?.numeroFormatado ?? ''} para edição?`}
        mensagem="Esta prescrição está finalizada. Para editá-la ela voltará a rascunho e as reservas de estoque serão liberadas. Ao terminar, finalize-a novamente para reenviá-la à execução."
        labelConfirmar={reabrindoLoading ? 'Reabrindo…' : 'Reabrir e editar'}
        onConfirmar={confirmarReabrir}
        onCancelar={() => { if (!reabrindoLoading) setReabrindo(null); }}
      />
    </>
  );
}