// frontend/src/pages/SubModuloPrescricao.tsx

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Pencil, Trash2, CheckCircle2, X, Loader2,
  ChevronLeft, ChevronRight, Pill, Activity,
  Clock, Calendar, Search, FileText, Eye, Printer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { imprimirPrescricao as imprimirPrescricaoPrint, type PrintAnimalPrescricao } from '../utils/PrescricaoPrint';
import DateInputBR from '../components/DateInputBR';

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
}

interface EstoqueItem {
  medicamentoId: number;
  qtdEstoque: number;
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

const STATUS_GRUPO: Record<StatusGrupo, { label: string; cls: string }> = {
  SALVO:                { label: 'Salvo',               cls: 'bg-amber-100 text-amber-700'    },
  FINALIZADO:           { label: 'Finalizado',          cls: 'bg-emerald-100 text-emerald-700' },
  EXECUTADO:            { label: 'Executado',           cls: 'bg-blue-100 text-blue-700'      },
  CANCELADO:            { label: 'Cancelado',           cls: 'bg-red-100 text-red-700'        },
  CANCELADO_PARCIALMENTE: { label: 'Cancel. Parcial',  cls: 'bg-orange-100 text-orange-700'  },
};

const FORM_VAZIO = (): FormItem => ({
  tipo: 'MEDICAMENTO', medicamento: '', medicamentoCatId: null,
  dosagem: '', unidade: '', via: '', frequencia: '',
  horaInicio: '', duracaoDias: '', dataInicio: new Date().toISOString().split('T')[0],
  observacao: '', medicamentoCliente: false,
});

const labelPosologia = (v: string) => POSOLOGIAS.find(p => p.value === v)?.label ?? v;

const formatarData = (d: string | null) => {
  if (!d) return '—';
  const [year, month, day] = d.split('T')[0].split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
};

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
    : 'Ao executar esta prescrição, o estoque disponível ficará zerado';
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
  onClose:              () => void;
  onSaved:              () => void;
}

function GrupoModal({ animalId, animal, grupo, canEdit, canFinalizarCancelar, onClose, onSaved }: GrupoModalProps) {
  const isCreate   = !grupo;
  const isReadOnly = grupo?.status === 'FINALIZADO' || grupo?.status === 'EXECUTADO' || grupo?.status === 'CANCELADO';
  // Abre diretamente na "segunda tela" (form visível) quando editando uma prescrição SALVA
  const openWithForm = !isCreate && !isReadOnly && canEdit;

  const [form,             setForm]             = useState<FormItem>(FORM_VAZIO());
  const [localItens,       setLocalItens]       = useState<FormItem[]>([]);
  const [editingLocalIdx,  setEditingLocalIdx]  = useState<number | null>(null);
  const [serverItens,      setServerItens]      = useState<ItemGrupo[]>(grupo?.itens ?? []);
  const [editingServerId,  setEditingServerId]  = useState<number | null>(null);
  const [medicamentos,     setMedicamentos]     = useState<MedicamentoCat[]>([]);
  const [estoqueMap,       setEstoqueMap]       = useState<Map<number, number>>(new Map());
  const [saving,           setSaving]           = useState(false);
  const [finalizing,       setFinalizing]       = useState(false);
  const [alertaEstoque,    setAlertaEstoque]    = useState<AlertaEstoque[] | null>(null);
  const [showAddForm,      setShowAddForm]      = useState(openWithForm);
  const [showMedDropdown,  setShowMedDropdown]  = useState(false);
  const [procedimentos,    setProcedimentos]    = useState<{ id: number; nome: string }[]>([]);
  const [showProcDropdown, setShowProcDropdown] = useState(false);
  const [draggedIdx,       setDraggedIdx]       = useState<number | null>(null);
  const [dragOverIdx,      setDragOverIdx]      = useState<number | null>(null);
  // Rascunhos independentes: preserva os valores de cada aba ao trocar de tipo
  const formBackupsRef = useRef<Partial<Record<TipoItem, FormItem>>>({});

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

  // Load catalogs on mount
  useEffect(() => {
    api.get('/medicamentos?limit=500&ativo=true').then(r => {
      setMedicamentos(r.data.dados ?? []);
    }).catch(() => {});
    api.get('/procedimentos?limit=500&ativo=true').then(r => {
      const lista: { id: number; nome: string }[] = r.data.dados ?? [];
      setProcedimentos(lista.map(p => ({ id: p.id, nome: p.nome })));
    }).catch(() => {});
    api.get('/farmacia/estoque?limit=1000&ativo=true').then(r => {
      const itens: EstoqueItem[] = r.data.dados ?? [];
      const map = new Map<number, number>();
      itens.forEach(e => map.set(e.medicamentoId, e.qtdEstoque));
      setEstoqueMap(map);
    }).catch(() => {});
  }, []);

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
    if (!form.duracaoDias || Number(form.duracaoDias) < 1) {
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

  const handleAdicionarMais = async () => {
    if (!validarForm()) return;

    if (isCreate) {
      if (editingLocalIdx !== null) {
        setLocalItens(prev => prev.map((it, i) => i === editingLocalIdx ? form : it));
        setEditingLocalIdx(null);
      } else {
        setLocalItens(prev => [...prev, form]);
      }
      clearCurrentType();
      return;
    }

    setSaving(true);
    try {
      if (editingServerId !== null) {
        const res = await api.put(`/clinica/prescricoes/grupos/${grupo!.id}/itens/${editingServerId}`, form);
        setServerItens(prev => prev.map(it => it.id === editingServerId ? res.data.dados : it));
        setEditingServerId(null);
        toast.success('Item atualizado');
      } else {
        const res = await api.post(`/clinica/prescricoes/grupos/${grupo!.id}/itens`, form);
        setServerItens(prev => [...prev, res.data.dados]);
        toast.success('Item adicionado');
        setShowAddForm(false);
      }
      clearCurrentType();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar item');
    } finally {
      setSaving(false);
    }
  };

  const handleEditarLocal = (idx: number) => {
    setForm(localItens[idx]);
    setEditingLocalIdx(idx);
  };

  const handleEditarServer = (item: ItemGrupo) => {
    setShowAddForm(false);
    setForm({
      tipo:               item.tipo,
      medicamento:        item.medicamento,
      medicamentoCatId:   item.medicamentoCatId,
      dosagem:            item.dosagem ?? '',
      unidade:            item.unidade ?? '',
      via:                item.via,
      frequencia:         item.frequencia,
      horaInicio:         item.horaInicio ?? '',
      duracaoDias:        item.duracaoDias,
      dataInicio:         item.dataInicio?.split('T')[0] ?? '',
      observacao:         item.observacao ?? '',
      medicamentoCliente: item.medicamentoCliente,
    });
    setEditingServerId(item.id);
  };

  const handleRemoverLocal = (idx: number) => {
    setLocalItens(prev => prev.filter((_, i) => i !== idx));
    if (editingLocalIdx === idx) { resetForm(); setEditingLocalIdx(null); }
  };

  const handleRemoverServer = async (itemId: number) => {
    try {
      await api.delete(`/clinica/prescricoes/grupos/${grupo!.id}/itens/${itemId}`);
      setServerItens(prev => prev.filter(it => it.id !== itemId));
      if (editingServerId === itemId) { resetForm(); setEditingServerId(null); }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao remover item');
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
      await api.post('/clinica/prescricoes/grupos', { animalId, itens });
      toast.success('Prescrição salva');
      onSaved(); onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar prescrição');
    } finally { setSaving(false); }
  };

  // ── Finalizar ───────────────────────────────────────────────────────────────

  const executarFinalizacao = async (forcar = false) => {
    setFinalizing(true);
    try {
      let grupoId = grupo?.id;
      if (isCreate) {
        const itens = formEstaVazio() ? localItens : [...localItens, form];
        if (itens.length === 0) { toast.error('Adicione ao menos um item'); return; }
        if (!formEstaVazio() && !validarForm()) return;
        const res = await api.post('/clinica/prescricoes/grupos', { animalId, itens });
        grupoId = res.data.dados.id;
      }
      await api.post(`/clinica/prescricoes/grupos/${grupoId}/finalizar`, { forcarFinalizacao: forcar });
      setAlertaEstoque(null);
      toast.success('Prescrição finalizada');
      onSaved(); onClose();
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { erro?: string; alertas?: AlertaEstoque[]; error?: string } } })?.response;
      if (resp?.data?.erro === 'ESTOQUE_INSUFICIENTE') {
        setAlertaEstoque(resp.data.alertas ?? []);
      } else {
        toast.error(resp?.data?.error ?? 'Erro ao finalizar prescrição');
      }
    } finally { setFinalizing(false); }
  };

  const handleFinalizar = () => executarFinalizacao(false);

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

  const isMed           = form.tipo === 'MEDICAMENTO';
  const medCatalogo     = form.medicamentoCatId
    ? medicamentos.find(m => m.id === form.medicamentoCatId) ?? null
    : null;
  const viasDisponiveis = medCatalogo?.vias.map(v => v.via) ?? VIAS;
  const unidadeCatalogo = medCatalogo?.unidade ?? null;
  const itensExibidos = isCreate ? localItens : serverItens;
  const editandoItem  = editingLocalIdx !== null || editingServerId !== null;
  // Em modo edição: formulário aparece ao editar item existente ou ao clicar "Inserir item"
  const showItemForm  = canEdit && !isReadOnly && (isCreate || editandoItem || showAddForm);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-3xl max-h-[95vh] flex flex-col border border-gray-100">

        {/* Header */}
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

        <div className="flex-1 overflow-y-auto">

          {/* Formulário de item — create mode, ao editar item existente, ou ao inserir novo em edit mode */}
          {showItemForm && (
            <div className="px-5 pt-4 pb-3 border-b border-gray-100 space-y-3">
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

              {/* Tabs tipo — travado ao editar item existente; troca preserva valores de cada aba */}
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

              {/* Medicamento / Procedimento — campo único */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  {isMed ? 'MEDICAMENTO' : 'PROCEDIMENTO'} *
                </label>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={form.medicamento}
                    onChange={e => {
                      set('medicamento', e.target.value);
                      set('medicamentoCatId', null);
                      if (isMed) setShowMedDropdown(true);
                      else       setShowProcDropdown(true);
                    }}
                    onFocus={() => {
                      if (isMed) setShowMedDropdown(true);
                      else       setShowProcDropdown(true);
                    }}
                    onBlur={() => setTimeout(() => {
                      setShowMedDropdown(false);
                      setShowProcDropdown(false);
                    }, 150)}
                    placeholder={isMed ? 'Buscar medicamento...' : 'Buscar procedimento...'}
                    className="w-full pl-8 pr-3 border border-gray-200 rounded-xl py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500"
                  />
                  {/* Dropdown medicamentos */}
                  {isMed && showMedDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                      {medicamentos
                        .filter(m => m.nome.toLowerCase().includes(form.medicamento.toLowerCase()))
                        .slice(0, 40)
                        .map(m => {
                          const qtd = estoqueMap.get(m.id) ?? 0;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onMouseDown={() => {
                                setForm(prev => ({
                                  ...prev,
                                  medicamento:      m.nome,
                                  medicamentoCatId: m.id,
                                  unidade:          m.unidade,
                                  via:              m.vias[0]?.via ?? prev.via,
                                }));
                                setShowMedDropdown(false);
                              }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-gray-50 last:border-0">
                              <span className="font-medium">{m.nome}</span>
                              {m.formaFarmaceutica && (
                                <span className="ml-2 text-[11px] text-gray-400">{m.formaFarmaceutica}</span>
                              )}
                              {qtd > 0 && (
                                <span className="ml-2 text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                  Em estoque
                                </span>
                              )}
                            </button>
                          );
                        })}
                      {medicamentos.filter(m => m.nome.toLowerCase().includes(form.medicamento.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhum medicamento encontrado</p>
                      )}
                    </div>
                  )}
                  {/* Dropdown procedimentos */}
                  {!isMed && showProcDropdown && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                      {procedimentos
                        .filter(p => p.nome.toLowerCase().includes(form.medicamento.toLowerCase()))
                        .slice(0, 40)
                        .map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={() => {
                              set('medicamento', p.nome);
                              setShowProcDropdown(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors first:rounded-t-xl last:rounded-b-xl border-b border-gray-50 last:border-0">
                            <span className="font-medium">{p.nome}</span>
                          </button>
                        ))}
                      {procedimentos.filter(p => p.nome.toLowerCase().includes(form.medicamento.toLowerCase())).length === 0 && (
                        <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhum procedimento encontrado</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Medicamento Cliente */}
              {isMed && (
                <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={form.medicamentoCliente}
                    onChange={e => set('medicamentoCliente', e.target.checked)}
                    className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 font-medium">Medicamento do Cliente</span>
                  {form.medicamentoCliente && (
                    <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                      Sem baixa no estoque
                    </span>
                  )}
                </label>
              )}

              {/* Dosagem + Via */}
              {isMed && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">DOSAGEM *</label>
                    <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500">
                      <input type="number" min="0" step="0.001" value={form.dosagem}
                        onChange={e => set('dosagem', e.target.value)}
                        placeholder="Ex: 1.5"
                        className="flex-1 min-w-0 px-3 py-2 text-sm focus:outline-none bg-transparent" />
                      <div className="w-px h-4 bg-gray-200 flex-shrink-0" />
                      {unidadeCatalogo ? (
                        <span className="px-2 py-2 text-sm text-gray-700 font-medium flex-shrink-0">
                          {unidadeCatalogo}
                        </span>
                      ) : (
                        <select value={form.unidade} onChange={e => set('unidade', e.target.value)}
                          className="px-2 py-2 text-sm text-gray-700 focus:outline-none bg-transparent cursor-pointer">
                          <option value="">—</option>
                          {UNIDADES.map(u => <option key={u}>{u}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">VIA DE ADMINISTRAÇÃO</label>
                    <select value={form.via} onChange={e => set('via', e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
                      <option value="">— Selecionar —</option>
                      {viasDisponiveis.map(v => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Frequência + Hora + Duração + Início */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">FREQUÊNCIA *</label>
                  <select value={form.frequencia} onChange={e => set('frequencia', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500">
                    <option value="">— Selecionar —</option>
                    {POSOLOGIAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1"><Clock size={9} /> HORA INÍCIO</label>
                  <input type="time" value={form.horaInicio} onChange={e => set('horaInicio', e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">DURAÇÃO (DIAS) *</label>
                  <input type="number" min="1"
                    value={form.duracaoDias}
                    onChange={e => set('duracaoDias', e.target.value === '' ? '' : Number(e.target.value))}
                    placeholder="Ex: 7"
                    className="w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1"><Calendar size={9} /> INÍCIO</label>
                  <DateInputBR
                    value={form.dataInicio}
                    onChange={v => set('dataInicio', v)}
                    className="border border-gray-200 rounded-xl px-2 py-2 focus-within:border-emerald-500"
                  />
                </div>
              </div>

              {/* Observação */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">OBSERVAÇÃO</label>
                <textarea value={form.observacao} onChange={e => set('observacao', e.target.value)}
                  rows={2} maxLength={500} placeholder="Instrução de uso, diluição, etc..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none" />
              </div>

              <button
                onClick={handleAdicionarMais}
                disabled={saving || formEstaVazio()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 text-sm font-medium rounded-xl transition-colors">
                {saving && <Loader2 size={13} className="animate-spin" />}
                {editandoItem ? 'Atualizar item' : 'Inserir'}
              </button>
            </div>
          )}

          {/* Lista de itens */}
          <div className="px-5 py-3">
            {itensExibidos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-300">
                <FileText size={28} className="mb-2" />
                <p className="text-sm text-gray-400">Nenhum item adicionado</p>
              </div>
            ) : (
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
                    : serverItens.map((item, idx) => (
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
                          isEditing={editingServerId === item.id}
                          canEdit={canEdit && !isReadOnly}
                          onEdit={() => handleEditarServer(item)}
                          onRemove={() => handleRemoverServer(item.id)}
                          isDragging={draggedIdx === idx}
                          isDragOver={dragOverIdx === idx}
                          onDragStart={() => setDraggedIdx(idx)}
                          onDragOver={e => { e.preventDefault(); setDragOverIdx(idx); }}
                          onDrop={() => handleReorder(draggedIdx ?? idx, idx)}
                          onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null); }}
                        />
                      ))
                  }
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-2 ml-auto">
            {/* Imprimir — só FINALIZADO */}
            {grupo?.status === 'FINALIZADO' && podeImprimir && (
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

            {/* Fechar / Cancelar */}
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              {isReadOnly ? 'Fechar' : 'Cancelar'}
            </button>

            {/* Salvar — create mode ou edit mode SALVO */}
            {canEdit && !isReadOnly && (
              <button onClick={isCreate ? handleSalvar : onClose} disabled={saving || finalizing}
                className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 flex items-center gap-1.5">
                {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                Salvar
              </button>
            )}

            {/* Finalizar */}
            {canEdit && canFinalizarCancelar && !isReadOnly && (
              <button onClick={handleFinalizar} disabled={saving || finalizing || (isCreate && localItens.length === 0 && formEstaVazio())}
                className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                {finalizing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Finalizar
              </button>
            )}
          </div>
        </div>
      </div>
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
  horaInicio, duracaoDias, dataInicio, observacao, medicamentoCliente,
  isEditing, canEdit, onEdit, onRemove,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  label: string; tipo: TipoItem;
  dosagem: string | null; unidade: string | null; via: string; frequencia: string;
  horaInicio?: string | null; duracaoDias?: number | ''; dataInicio?: string; observacao?: string | null;
  medicamentoCliente?: boolean;
  isEditing: boolean; canEdit: boolean;
  onEdit: () => void; onRemove: () => void;
  isDragging?: boolean; isDragOver?: boolean;
  onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void; onDragEnd?: () => void;
}) {
  const isMed  = tipo === 'MEDICAMENTO';
  const dtFim  = dataInicio && duracaoDias ? calcDataFim(dataInicio, duracaoDias) : '';
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
        {isMed && dosagem && (
          <InfoChip label="Dose:" value={`${dosagem}${unidade ? ' '+unidade : ''}`} />
        )}
        {isMed && via    && <InfoChip label="Via:" value={via} />}
        <InfoChip label="Freq:" value={labelPosologia(frequencia)} />
        {horaInicio      && <InfoChip label="Hora:" value={horaInicio} />}
        {duracaoDias     && <InfoChip label="Dur:" value={`${duracaoDias}d`} />}
        {dtIni           && <InfoChip label="Início:" value={dtIni} />}
        {dtFim           && <InfoChip label="Fim:" value={dtFim} />}
        {observacao      && <InfoChip label="Obs:" value={observacao} />}
      </div>

      {canEdit && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit}
            className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors">
            <Pencil size={12} />
          </button>
          <button onClick={onRemove}
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            <Trash2 size={12} />
          </button>
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
          <label className="block text-xs font-medium text-gray-700 mb-1">Motivo do cancelamento</label>
          <textarea
            value={motivo}
            onChange={e => setMotivo(e.target.value)}
            rows={3}
            placeholder="Informe o motivo..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
          />
        </div>
        <div className="flex gap-3">
          <button onClick={onCancelar} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            Voltar
          </button>
          <button onClick={() => onConfirmar(motivo)} className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold">
            Confirmar cancelamento
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SubModuloPrescricao ──────────────────────────────────────────────────────

export default function SubModuloPrescricao({ animalId, animal, onFaturaAtualizada }: Props) {
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  const podeCriar    = isGestor || podeExecutar('atendimento.prescricoes.criar');
  const podeEditar   = isGestor || podeExecutar('atendimento.prescricoes.editar');
  const podeFinalizar = isGestor || podeExecutar('atendimento.prescricoes.finalizar');
  const podeImprimir  = isGestor || podeExecutar('atendimento.prescricoes.imprimir');

  const canEdit = podeCriar;
  const canFinalizarCancelar = podeFinalizar;

  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [grupos,           setGrupos]           = useState<PrescricaoGrupo[]>([]);
  const [loading,          setLoading]          = useState(false);
  const [total,            setTotal]            = useState(0);
  const [salvos,           setSalvos]           = useState(0);
  const [page,             setPage]             = useState(1);
  const [limit]                                 = useState(20);
  const [showModal,        setShowModal]        = useState(false);
  const [editingGrupo,     setEditingGrupo]     = useState<PrescricaoGrupo | null>(null);
  const [deletingId,       setDeletingId]       = useState<number | null>(null);
  const [alertaDireto,     setAlertaDireto]     = useState<{ grupoId: number; alertas: AlertaEstoque[] } | null>(null);
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

  const abrirNovo = () => { setEditingGrupo(null); setShowModal(true); };
  const abrirEdicao = (g: PrescricaoGrupo) => { setEditingGrupo(g); setShowModal(true); };

  const handleFinalizarDireto = async (grupoId: number) => {
    if (!podeFinalizar) { semPermissao('finalizar prescrição'); return; }
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupoId}/finalizar`);
      toast.success('Prescrição finalizada');
      carregar();
      onFaturaAtualizada();
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
      toast.success('Prescrição finalizada');
      carregar();
      onFaturaAtualizada();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao finalizar prescrição');
    } finally {
      setLoadingForceDireto(false);
    }
  };
  const fecharModal = () => { setShowModal(false); setEditingGrupo(null); };
  const onSaved = () => { carregar(); onFaturaAtualizada(); };

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
        toast.error('Esta prescrição já foi executada integralmente e não pode ser cancelada.');
      } else {
        toast.error(data?.error ?? 'Erro ao cancelar prescrição');
      }
    } finally { setDeletingId(null); }
  };

  const actionBar = (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
      {canEdit && (
        <button onClick={abrirNovo}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors flex-shrink-0">
          Nova Prescrição
        </button>
      )}
      {salvos > 0 && (
        <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-xl flex-shrink-0">
          {salvos} prescrição{salvos > 1 ? 'ões' : ''} salva{salvos > 1 ? 's' : ''} aguardando finalização
        </span>
      )}
    </div>
  );

  if (loading) {
    return (
      <>
        {actionBar}
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-emerald-600" />
        </div>
      </>
    );
  }

  if (grupos.length === 0) {
    return (
      <>
        {actionBar}
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={38} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhuma prescrição encontrada</p>
          {canEdit && <p className="text-xs text-gray-300 mt-1">Use "Nova Prescrição" para criar</p>}
        </div>
        {showModal && (
          <GrupoModal animalId={animalId} animal={animal} grupo={editingGrupo} canEdit={canEdit} canFinalizarCancelar={canFinalizarCancelar} onClose={fecharModal} onSaved={onSaved} />
        )}
      </>
    );
  }

  return (
    <>
      {actionBar}

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Nº Prescrição</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Itens</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Veterinário</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <span className="flex items-center justify-center gap-1"><Calendar size={11} /> Data</span>
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {grupos.map(g => {
              const isViewOnly = g.status !== 'SALVO';
              const editavel   = g.status === 'SALVO' && canEdit;
              const cancelavel = ['SALVO', 'FINALIZADO'].includes(g.status) && canFinalizarCancelar;
              return (
                <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => abrirEdicao(g)}
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
                    <span className="text-xs text-gray-600 font-medium">{g.itens.length}</span>
                    <span className="text-[10px] text-gray-400 ml-1">
                      {g.itens.filter(i => i.tipo === 'MEDICAMENTO').length}M{' '}
                      {g.itens.filter(i => i.tipo === 'PROCEDIMENTO').length}P
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <p className="text-xs font-medium text-gray-800 whitespace-nowrap">{g.veterinario.fullName}</p>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">{formatarData(g.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => abrirEdicao(g)} title={isViewOnly ? 'Visualizar' : 'Editar'}
                        className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                        {isViewOnly ? <Eye size={13} /> : <Pencil size={13} />}
                      </button>
                      {editavel && canFinalizarCancelar && (
                        <button onClick={() => handleFinalizarDireto(g.id)} title="Finalizar prescrição"
                          className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">
                          <CheckCircle2 size={13} />
                        </button>
                      )}
                      {g.status === 'FINALIZADO' && podeImprimir && (
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
        {grupos.map(g => (
          <div key={g.id} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <button onClick={() => abrirEdicao(g)}
                className="font-mono font-bold text-emerald-700 hover:underline text-sm">
                #{g.numeroFormatado}
              </button>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_GRUPO[g.status].cls}`}>
                {STATUS_GRUPO[g.status].label}
              </span>
            </div>
            <p className="text-xs text-gray-500">{g.veterinario.fullName} • {g.itens.length} item{g.itens.length !== 1 ? 'ns' : ''}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{formatarData(g.createdAt)}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => abrirEdicao(g)}
                className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                {g.status === 'SALVO' ? <><Pencil size={11} /> Editar</> : <><Eye size={11} /> Ver</>}
              </button>
              {g.status === 'FINALIZADO' && podeImprimir && (
                <button onClick={() => imprimirPrescricao(g, animal)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-500 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                  <Printer size={11} /> Imprimir
                </button>
              )}
              {['SALVO', 'FINALIZADO'].includes(g.status) && canFinalizarCancelar && (
                <button onClick={() => setDeletingId(g.id)}
                  className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                  <Trash2 size={11} /> Cancelar
                </button>
              )}
            </div>
          </div>
        ))}
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

      {/* Modais */}
      {showModal && (
        <GrupoModal animalId={animalId} animal={animal} grupo={editingGrupo} canEdit={canEdit} onClose={fecharModal} onSaved={onSaved} />
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
    </>
  );
}