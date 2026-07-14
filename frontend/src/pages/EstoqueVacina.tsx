// src/pages/EstoqueVacina.tsx
// Gestão de estoque de vacinas (lotes) por clínica — Módulo Vacina

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { usePermissoes } from '../hooks/usePermissoes';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import {
  AlertTriangle, Plus, Pencil, Trash2,
  Search, RefreshCw, X, Syringe, Calendar,
  ChevronDown, FlaskConical, Eye, ArrowUpDown,
} from 'lucide-react';
import { formatDate } from '../utils/dateUtils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MedCatItem {
  id: number;
  nome: string;
  fabricante: string | null;
  formaFarmaceutica: string;
  apresentacao: string;
  vias: { id: number; via: string }[];
}

interface LoteVacina {
  id:              number;
  vacinaId:        number | null;
  medicamentoCatId: number | null;
  empresaId:       number | null;
  lote:            string;
  validade:        string;
  qtdTotal:        number;
  qtdDisponivel:          number;
  qtdFrascos:             number;
  dosesPorFrasco:         number;
  validadeHoras:          number | null;
  validadeDias:           number;
  valorUnitario:          number | null;
  valorUnitarioRepassado: number | null;
  dataRecebimento:        string | null;
  ativo:           boolean;
  createdAt:       string;
  vacina:          { id: number; nome: string; fabricante: string | null; via: string } | null;
  medicamentoCat:  MedCatItem | null;
}

interface Meta {
  totalLotes:    number;
  totalVencidos: number;
  totalVencendo: number;
  totalDoses:    number;
}

type FiltroTab = 'todas' | 'ativas' | 'inativas' | 'vencidas' | 'vencendo';

const DOSES_POR_FRASCO_OPTS = [1, 2, 5, 10, 20, 50, 100];

const FORM_VAZIO = {
  medicamentoCatId:       0,
  lote:                   '',
  validade:               '',
  qtdFrascos:             1,
  dosesPorFrasco:         1,
  validadeHoras:          '' as number | '',
  validadeDias:           0,
  valorUnitario:          '' as number | '',
  valorUnitarioRepassado: '' as number | '',
  dataRecebimento:        '',
  ativo:                  true,
};

// ─── Componente principal ──────────────────────────────────────────────────────

export default function EstoqueVacina() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();
  const podeCriar   = isGestor || podeExecutar('vacina.estoque.criar');
  const podeEditar  = isGestor || podeExecutar('vacina.estoque.editar');
  const podeDeletar = isGestor || podeExecutar('vacina.estoque.deletar');
  const podeAjustar = isGestor || podeExecutar('vacina.estoque.ajustar');
  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [lotes,        setLotes]        = useState<LoteVacina[]>([]);
  const [fabricantes,  setFabricantes]  = useState<string[]>([]);
  const [vacinas,      setVacinas]      = useState<MedCatItem[]>([]);
  const [meta,         setMeta]         = useState<Meta>({ totalLotes: 0, totalVencidos: 0, totalVencendo: 0, totalDoses: 0 });
  const [loading,      setLoading]      = useState(false);
  const [busca,        setBusca]        = useState('');
  const [filtroTab,    setFiltroTab]    = useState<FiltroTab>('todas');

  const [form,              setForm]              = useState({ ...FORM_VAZIO });
  const [fabricanteSel,     setFabricanteSel]     = useState('');
  const [editandoId,        setEditandoId]        = useState<number | null>(null);
  const [salvando,          setSalvando]          = useState(false);
  const [modalFormAberto,   setModalFormAberto]   = useState(false);
  const [confirmExcluir,    setConfirmExcluir]    = useState<LoteVacina | null>(null);
  const [repassadoEditado,  setRepassadoEditado]  = useState(false);
  const [loteView,          setLoteView]          = useState<LoteVacina | null>(null);

  // Ajuste de estoque (correção manual das doses disponíveis)
  const [modalAjusteAberto,    setModalAjusteAberto]    = useState(false);
  const [ajusteLoteId,         setAjusteLoteId]         = useState<number | null>(null);
  const [buscaAjuste,          setBuscaAjuste]          = useState('');
  const [dropdownAjusteAberto, setDropdownAjusteAberto] = useState(false);
  const [ajusteQtd,            setAjusteQtd]            = useState<number | ''>('');
  const [ajusteMotivo,         setAjusteMotivo]         = useState('');
  const [ajustando,            setAjustando]            = useState(false);

  // Combobox vacina
  const [buscaVac,          setBuscaVac]          = useState('');
  const [dropdownVacAberto, setDropdownVacAberto] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  // Display states para campos de data (DD/MM/AAAA)
  const [displayValidade,     setDisplayValidade]     = useState('');
  const [displayRecebimento,  setDisplayRecebimento]  = useState('');

  const hoje = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // ── Helpers de data ───────────────────────────────────────────────────────
  // Converte YYYY-MM-DD → DD/MM/AAAA para exibição
  const toDisplay = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d && m && y ? `${d}/${m}/${y}` : '';
  };
  // Converte DD/MM/AAAA → YYYY-MM-DD para armazenamento
  const fromDisplay = (disp: string): string => {
    if (disp.length < 10) return '';
    const [d, m, y] = disp.split('/');
    if (!d || !m || !y || y.length < 4) return '';
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  };
  // Máscara: só dígitos + barras automáticas
  const maskDate = (raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0,2)}/${d.slice(2)}`;
    return `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`;
  };

  const vacSelecionada = vacinas.find(v => v.id === form.medicamentoCatId) ?? null;
  const totalDoses     = (Number(form.qtdFrascos) || 0) * (Number(form.dosesPorFrasco) || 1);

  const formatarValor = (v: number | '') =>
    v === '' || v === 0 ? '' : new Intl.NumberFormat(navigator.language || 'pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number(v));

  const parseCurrency = (raw: string): number => {
    const digits = raw.replace(/\D/g, '');
    return parseInt(digits || '0', 10) / 100;
  };

  const handleValorChange = (raw: string) => {
    const value = parseCurrency(raw);
    setForm(f => ({
      ...f,
      valorUnitario: value === 0 ? '' : value,
      ...(!repassadoEditado && { valorUnitarioRepassado: value === 0 ? '' : value }),
    }));
  };

  const handleValorRepassadoChange = (raw: string) => {
    const value = parseCurrency(raw);
    setRepassadoEditado(true);
    setForm(f => ({ ...f, valorUnitarioRepassado: value === 0 ? '' : value }));
  };

  // ── Click outside combobox ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node))
        setDropdownVacAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Carregar ──────────────────────────────────────────────────────────────

  const carregarLotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (busca) params.busca = busca;
      // Sem filtro de ativo — sempre busca todos e filtra client-side

      const [lotesRes, fabRes] = await Promise.all([
        api.get('/vacinas/estoque', { params }),
        api.get('/vacinas/estoque/fabricantes'),
      ]);

      if (!lotesRes.data) return;
      setLotes(lotesRes.data.dados ?? []);
      setMeta(lotesRes.data.meta ?? { totalLotes: 0, totalVencidos: 0, totalVencendo: 0, totalDoses: 0 });
      if (fabRes.data) setFabricantes(fabRes.data.dados ?? []);
    } catch { toast.error('Erro ao carregar estoque de vacinas.'); }
    finally { setLoading(false); }
  }, [busca, filtroTab]);

  const carregarVacinasPorFabricante = useCallback(async (fab: string) => {
    try {
      const params: Record<string, string> = {};
      if (fab) params.fabricante = fab;
      const res = await api.get('/vacinas/estoque/vacinas', { params });
      if (!res.data) return;
      setVacinas(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    if (!loadingPerm) carregarLotes();
  }, [carregarLotes, loadingPerm]);

  useEffect(() => {
    carregarVacinasPorFabricante(fabricanteSel);
  }, [fabricanteSel, carregarVacinasPorFabricante]);

  // ── Filtro local (client-side) ────────────────────────────────────────────

  const hojeDate = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  const em7Date  = (() => { const d = new Date(hojeDate); d.setDate(d.getDate() + 7); return d; })();

  const lotesFiltrados = (() => {
    if (filtroTab === 'ativas')   return lotes.filter(l => l.ativo && new Date(l.validade) >= hojeDate);
    if (filtroTab === 'inativas') return lotes.filter(l => !l.ativo);
    if (filtroTab === 'vencidas') return lotes.filter(l => l.ativo && new Date(l.validade) < hojeDate);
    if (filtroTab === 'vencendo') return lotes.filter(l => {
      if (!l.ativo) return false;
      const v = new Date(l.validade); v.setHours(0, 0, 0, 0);
      return v >= hojeDate && v <= em7Date;
    });
    return lotes; // todas
  })();

  const counts: Record<FiltroTab, number> = {
    todas:    lotes.length,
    ativas:   lotes.filter(l => l.ativo && new Date(l.validade) >= hojeDate).length,
    inativas: lotes.filter(l => !l.ativo).length,
    vencidas: lotes.filter(l => l.ativo && new Date(l.validade) < hojeDate).length,
    vencendo: lotes.filter(l => {
      if (!l.ativo) return false;
      const v = new Date(l.validade); v.setHours(0, 0, 0, 0);
      return v >= hojeDate && v <= em7Date;
    }).length,
  };

  const vacinasFiltradas = buscaVac.trim().length === 0
    ? vacinas
    : vacinas.filter(v =>
        v.nome.toLowerCase().includes(buscaVac.toLowerCase()) ||
        (v.fabricante ?? '').toLowerCase().includes(buscaVac.toLowerCase())
      );

  // ── Status de validade ────────────────────────────────────────────────────

  const statusValidade = (validade: string) => {
    const v     = new Date(validade); v.setHours(0, 0, 0, 0);
    const agora = new Date();          agora.setHours(0, 0, 0, 0);
    const em30  = new Date(agora);     em30.setDate(em30.getDate() + 30);
    const diff  = (v.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24);
    const label = formatDate(validade);
    if (diff < 0)   return <span className="text-red-600 font-semibold">{label} ⚠</span>;
    if (diff <= 30) return <span className="text-amber-600 font-semibold">{label}</span>;
    return <span>{label}</span>;
  };

  const nivelLote = (l: LoteVacina) => {
    const v    = new Date(l.validade); v.setHours(0, 0, 0, 0);
    const agora = new Date();           agora.setHours(0, 0, 0, 0);
    const em7  = new Date(agora);       em7.setDate(em7.getDate() + 7);
    if (v < agora)            return 'vencido';
    if (v <= em7)             return 'vencendo';
    if (l.qtdDisponivel === 0) return 'zerado';
    return 'ok';
  };

  // ── Form handlers ─────────────────────────────────────────────────────────

  const preencherEdicao = (l: LoteVacina) => {
    const fab = l.medicamentoCat?.fabricante ?? l.vacina?.fabricante ?? '';
    setFabricanteSel(fab);
    const isoValidade = l.validade ? l.validade.split('T')[0] : '';
    const isoReceb    = l.dataRecebimento ? l.dataRecebimento.split('T')[0] : '';
    setForm({
      medicamentoCatId:       l.medicamentoCatId ?? 0,
      lote:                   l.lote,
      validade:               isoValidade,
      qtdFrascos:             l.qtdFrascos,
      dosesPorFrasco:         l.dosesPorFrasco,
      validadeHoras:          l.validadeHoras ?? '',
      validadeDias:           l.validadeDias,
      valorUnitario:          l.valorUnitario ?? '',
      valorUnitarioRepassado: l.valorUnitarioRepassado ?? '',
      dataRecebimento:        isoReceb,
      ativo:                  l.ativo,
    });
    setDisplayValidade(toDisplay(isoValidade));
    setDisplayRecebimento(toDisplay(isoReceb));
    setRepassadoEditado(l.valorUnitarioRepassado !== l.valorUnitario);
    setEditandoId(l.id);
    setModalFormAberto(true);
  };

  const limparForm = () => {
    setForm({ ...FORM_VAZIO });
    setFabricanteSel('');
    setEditandoId(null);
    setModalFormAberto(false);
    setBuscaVac('');
    setDropdownVacAberto(false);
    setRepassadoEditado(false);
    setDisplayValidade('');
    setDisplayRecebimento('');
  };

  const salvar = async () => {
    if (editandoId && !podeEditar)  { semPermissao('editar lote'); return; }
    if (!editandoId && !podeCriar) { semPermissao('criar entrada de vacina'); return; }

    if (!form.medicamentoCatId) return toast.error('Selecione a vacina.');
    if (!editandoId && !form.validade) return toast.error('Informe a validade do lote.');
    if (form.validade && !editandoId && form.validade < hoje) return toast.error('Validade não pode ser anterior à data de hoje.');
    if (form.dataRecebimento && form.dataRecebimento > hoje) return toast.error('Data de recebimento não pode ser futura.');
    if (Number(form.qtdFrascos) <= 0 && !editandoId) return toast.error('Quantidade de frascos deve ser maior que zero.');

    setSalvando(true);
    try {
      const payload = {
        medicamentoCatId:       form.medicamentoCatId,
        lote:                   form.lote.trim() || null,
        validade:               form.validade || null,
        qtdFrascos:             Number(form.qtdFrascos),
        dosesPorFrasco:         Number(form.dosesPorFrasco) || 1,
        validadeHoras:          form.validadeHoras !== '' ? Number(form.validadeHoras) : null,
        validadeDias:           Number(form.validadeDias) || 0,
        valorUnitario:          form.valorUnitario !== '' ? Number(form.valorUnitario) : null,
        valorUnitarioRepassado: form.valorUnitarioRepassado !== '' ? Number(form.valorUnitarioRepassado) : null,
        dataRecebimento:        form.dataRecebimento || null,
        ativo:                  form.ativo,
      };

      if (editandoId) {
        await api.put(`/vacinas/estoque/${editandoId}`, payload);
        toast.success('Lote atualizado.');
      } else {
        const res = await api.post('/vacinas/estoque', payload);
        toast.success(res.data?.consolidado ? 'Frascos somados ao lote existente.' : 'Lote de vacina registrado.');
      }
      limparForm();
      carregarLotes();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar.');
    } finally { setSalvando(false); }
  };

  const confirmarExcluir = async (motivo: string) => {
    if (!confirmExcluir) return;
    if (!podeDeletar) { semPermissao('inativar lote de vacina'); return; }
    try {
      await api.delete(`/vacinas/estoque/${confirmExcluir.id}`, { data: { motivo } });
      toast.success('Lote inativado.');
      setConfirmExcluir(null);
      carregarLotes();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao inativar.');
    }
  };

  // ── Ajuste de estoque (doses disponíveis) ──────────────────────────────────
  const loteAjuste = ajusteLoteId != null ? (lotes.find(l => l.id === ajusteLoteId) ?? null) : null;
  const nomeLote = (l: LoteVacina) => l.medicamentoCat?.nome ?? l.vacina?.nome ?? '—';

  const abrirAjuste = (lote?: LoteVacina) => {
    if (!podeAjustar) { semPermissao('ajustar estoque'); return; }
    setAjusteLoteId(lote?.id ?? null);
    setAjusteQtd(lote ? lote.qtdDisponivel : '');
    setAjusteMotivo('');
    setBuscaAjuste('');
    setDropdownAjusteAberto(false);
    setModalAjusteAberto(true);
  };

  const fecharAjuste = () => {
    setModalAjusteAberto(false);
    setAjusteLoteId(null);
  };

  const confirmarAjuste = async () => {
    if (!podeAjustar) { semPermissao('ajustar estoque'); return; }
    if (!loteAjuste)          return toast.error('Selecione um lote de vacina.');
    if (ajusteQtd === '')     return toast.error('Informe a quantidade de doses.');
    const qtd = Number(ajusteQtd);
    if (qtd < 0)              return toast.error('Quantidade não pode ser negativa.');
    if (!ajusteMotivo.trim()) return toast.error('Informe o motivo do ajuste.');
    if (qtd === loteAjuste.qtdDisponivel) return toast.error('A quantidade informada é igual ao estoque atual.');

    setAjustando(true);
    try {
      await api.patch(`/vacinas/estoque/${loteAjuste.id}/ajuste`, {
        quantidade: qtd,
        motivo:     ajusteMotivo.trim(),
      });
      toast.success('Estoque ajustado.');
      fecharAjuste();
      carregarLotes();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao ajustar estoque.');
    } finally { setAjustando(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('vacina.estoque.ler') && !isGestor) return null;

  return (
    <PageContainer maxWidth="7xl">
      <div className="space-y-5">

        <BotaoVoltar className="mb-6" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
              <Syringe size={20} className="text-teal-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Estoque de Vacinas</h1>
              <p className="text-sm text-gray-500">Controle de lotes, doses disponíveis e validades.</p>
            </div>
          </div>
        </div>

        {/* Cards resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Lotes Ativos',    value: meta.totalLotes,    color: 'text-gray-900',  bg: 'bg-white' },
            { label: 'Vencidos',        value: meta.totalVencidos, color: 'text-red-600',   bg: meta.totalVencidos > 0 ? 'bg-red-50' : 'bg-white',   icon: <AlertTriangle size={12} className="text-red-500" /> },
            { label: 'Vencendo (7d)',   value: meta.totalVencendo, color: 'text-amber-600', bg: meta.totalVencendo > 0 ? 'bg-amber-50' : 'bg-white', icon: <Calendar size={12} className="text-amber-500" /> },
            { label: 'Doses Disponíveis', value: meta.totalDoses,  color: 'text-teal-700',  bg: 'bg-white', icon: <FlaskConical size={12} className="text-teal-500" /> },
          ].map(({ label, value, color, bg, icon }) => (
            <div key={label} className={`${bg} rounded-2xl border border-gray-200 px-4 py-3 shadow-sm`}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">{icon}{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Lista */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Syringe size={16} className="text-teal-600" />
              <h2 className="font-bold text-gray-800 text-sm">Lotes de Vacinas</h2>
            </div>
            <div className="flex items-center gap-2">
              {podeCriar && (
                <button
                  onClick={() => { limparForm(); setModalFormAberto(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-xl transition-colors">
                  Entrada de Vacina
                </button>
              )}
              {podeAjustar && (
                <button onClick={() => abrirAjuste()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-teal-600 text-teal-700 hover:bg-teal-50 text-xs font-semibold rounded-xl transition-colors">
                  <ArrowUpDown size={13} />
                  Ajuste de Estoque
                </button>
              )}
              <button onClick={carregarLotes} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
            <input type="text" placeholder="Buscar por vacina ou fabricante..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {([
              ['todas',    'Todas',          'teal'],
              ['ativas',   'Ativa',          'teal'],
              ['inativas', 'Inativa',        'gray'],
              ['vencidas', '🔴 Vencida',     'red'],
              ['vencendo', '🟡 Vencendo',    'amber'],
            ] as [FiltroTab, string, string][]).map(([key, label, color]) => {
              const activeClass = color === 'red'   ? 'bg-red-600 text-white border-red-600'
                                : color === 'amber' ? 'bg-amber-500 text-white border-amber-500'
                                : color === 'gray'  ? 'bg-gray-500 text-white border-gray-500'
                                : 'bg-teal-600 text-white border-teal-600';
              return (
                <button key={key} onClick={() => setFiltroTab(key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    filtroTab === key
                      ? activeClass
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}>
                  {label} <span className="opacity-70">{counts[key]}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <p className="text-center py-12 text-gray-400 text-sm">Carregando...</p>
          ) : lotesFiltrados.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Nenhum lote encontrado.</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vacina</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Doses</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lotesFiltrados.map((lote) => {
                      const nivel = nivelLote(lote);
                      const statusLabel = !lote.ativo ? 'INATIVO' : nivel === 'vencido' ? 'VENCIDO' : 'ATIVO';
                      const statusClass = !lote.ativo ? 'bg-gray-100 text-gray-500'
                        : nivel === 'vencido' ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700';
                      const jaUsado = lote.qtdDisponivel < lote.qtdTotal;
                      return (
                        <tr key={lote.id} className={`hover:bg-gray-50 transition-colors ${!lote.ativo ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-teal-700 text-sm flex items-center gap-1">
                              <Syringe size={12} className="text-teal-500 flex-shrink-0" />
                              {lote.medicamentoCat?.nome ?? lote.vacina?.nome ?? '—'}
                            </span>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {(lote.medicamentoCat?.fabricante ?? lote.vacina?.fabricante) && `${lote.medicamentoCat?.fabricante ?? lote.vacina?.fabricante} · `}
                              Lote {lote.lote} · {lote.qtdFrascos} fr. × {lote.dosesPorFrasco}
                              {lote.dataRecebimento && ` · Receb. ${formatDate(lote.dataRecebimento)}`}
                              <span className="ml-1">· {statusValidade(lote.validade)}</span>
                            </p>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className="text-xs">
                              <span className={`font-bold ${lote.qtdDisponivel === 0 ? 'text-gray-400' : 'text-teal-700'}`}>{lote.qtdDisponivel}</span>
                              <span className="text-gray-400">/{lote.qtdTotal}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClass}`}>{statusLabel}</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {jaUsado ? (
                                <button onClick={() => setLoteView(lote)} title="Visualizar lote (já utilizado — não pode ser alterado)"
                                  className="p-1.5 rounded-lg border border-teal-200 text-teal-500 hover:bg-teal-50">
                                  <Eye size={13} />
                                </button>
                              ) : podeEditar ? (
                                <button onClick={() => preencherEdicao(lote)} title="Editar"
                                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50">
                                  <Pencil size={13} />
                                </button>
                              ) : null}
                              {podeDeletar && (
                                <button onClick={() => setConfirmExcluir(lote)} title="Inativar"
                                  className="p-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50">
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
                {lotesFiltrados.map((lote) => {
                  const nivel = nivelLote(lote);
                  const statusLabel = !lote.ativo ? 'INATIVO' : nivel === 'vencido' ? 'VENCIDO' : 'ATIVO';
                  const statusClass = !lote.ativo ? 'bg-gray-100 text-gray-500'
                    : nivel === 'vencido' ? 'bg-red-100 text-red-600' : 'bg-teal-100 text-teal-700';
                  const jaUsado = lote.qtdDisponivel < lote.qtdTotal;
                  return (
                    <div key={lote.id} className={`px-4 py-3 ${!lote.ativo ? 'opacity-60' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-teal-700 text-sm flex items-center gap-1 min-w-0">
                          <Syringe size={12} className="text-teal-500 flex-shrink-0" />
                          <span className="truncate">{lote.medicamentoCat?.nome ?? lote.vacina?.nome ?? '—'}</span>
                        </span>
                        <span className="text-xs flex-shrink-0">
                          <span className={`font-bold ${lote.qtdDisponivel === 0 ? 'text-gray-400' : 'text-teal-700'}`}>{lote.qtdDisponivel}</span>
                          <span className="text-gray-400">/{lote.qtdTotal} doses</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        Lote {lote.lote} · {statusValidade(lote.validade)}
                        <span className={`ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-bold ${statusClass}`}>{statusLabel}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {jaUsado ? (
                          <button onClick={() => setLoteView(lote)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-teal-600 rounded-lg text-xs hover:bg-teal-50 transition-colors">
                            <Eye size={11} /> Ver
                          </button>
                        ) : podeEditar ? (
                          <button onClick={() => preencherEdicao(lote)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-teal-600 rounded-lg text-xs hover:bg-teal-50 transition-colors">
                            <Pencil size={11} /> Editar
                          </button>
                        ) : null}
                        {podeDeletar && (
                          <button onClick={() => setConfirmExcluir(lote)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                            <Trash2 size={11} /> Inativar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modal: formulário de entrada ───────────────────────────────────── */}
      {modalFormAberto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={limparForm} />
          <div className="fixed inset-x-4 top-[4vh] z-50 bg-white rounded-2xl shadow-2xl max-w-lg mx-auto flex flex-col max-h-[92vh] overflow-hidden">
            <div className="bg-teal-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <p className="font-bold text-sm text-white">{editandoId ? 'Editar Lote' : 'Entrada de Vacina'}</p>
              <button onClick={limparForm} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">

              {/* ── Fabricante ─────────────────────────────────────────────── */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Fabricante</label>
                <select
                  value={fabricanteSel}
                  onChange={e => {
                    setFabricanteSel(e.target.value);
                    setForm(f => ({ ...f, medicamentoCatId: 0 }));
                  }}
                  disabled={!!editandoId}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-gray-900 disabled:bg-gray-100 disabled:cursor-not-allowed">
                  <option value="">Todos os fabricantes...</option>
                  {fabricantes.map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              {/* ── Vacina (combobox) ──────────────────────────────────────── */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Vacina <span className="text-red-500">*</span>
                </label>
                <div className="relative" ref={comboboxRef}>
                  <button
                    type="button"
                    disabled={!!editandoId}
                    onClick={() => {
                      if (!editandoId) {
                        setDropdownVacAberto(prev => !prev);
                        setBuscaVac('');
                      }
                    }}
                    className="w-full flex items-center justify-between border border-gray-300 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100 disabled:cursor-not-allowed bg-white">
                    <span className={vacSelecionada ? 'text-gray-900' : 'text-gray-400'}>
                      {vacSelecionada ? vacSelecionada.nome : 'Selecione a vacina...'}
                    </span>
                    <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                  </button>

                  {dropdownVacAberto && (
                    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-gray-100">
                        <div className="relative">
                          <Search size={13} className="absolute left-2.5 top-2 text-gray-400" />
                          <input
                            autoFocus
                            type="text"
                            placeholder="Buscar vacina..."
                            value={buscaVac}
                            onChange={e => setBuscaVac(e.target.value)}
                            className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                          />
                        </div>
                      </div>
                      <ul className="max-h-44 overflow-y-auto">
                        {vacinasFiltradas.length === 0 ? (
                          <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhuma vacina encontrada.</li>
                        ) : vacinasFiltradas.map(v => (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setForm(f => ({ ...f, medicamentoCatId: v.id }));
                                setDropdownVacAberto(false);
                                setBuscaVac('');
                              }}
                              className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 transition-colors ${
                                form.medicamentoCatId === v.id ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-gray-800'
                              }`}>
                              <span className="block truncate">{v.nome}</span>
                              {v.fabricante && (
                                <span className="text-[11px] text-gray-400">{v.fabricante} · {v.formaFarmaceutica}</span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Lote + Data Recebimento ────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Lote Fabricante
                  </label>
                  <input
                    type="text"
                    value={form.lote}
                    onChange={e => setForm(f => ({ ...f, lote: e.target.value }))}
                    placeholder="Ex: A2024-001"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Data de Recebimento</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                    value={displayRecebimento}
                    onChange={e => {
                      const masked = maskDate(e.target.value);
                      setDisplayRecebimento(masked);
                      setForm(f => ({ ...f, dataRecebimento: fromDisplay(masked) }));
                    }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* ── Validade Lote + Validade Dose ──────────────────────────── */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Validade Lote
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD/MM/AAAA"
                    maxLength={10}
                    value={displayValidade}
                    onChange={e => {
                      const masked = maskDate(e.target.value);
                      setDisplayValidade(masked);
                      setForm(f => ({ ...f, validade: fromDisplay(masked) }));
                    }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Validade Dose (h)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.validadeHoras}
                    onChange={e => setForm(f => ({ ...f, validadeHoras: e.target.value === '' ? '' : Number(e.target.value) }))}
                    placeholder="—"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Validade Dose (dias)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.validadeDias || ''}
                    onChange={e => setForm(f => ({ ...f, validadeDias: e.target.value === '' ? 0 : Number(e.target.value) }))}
                    placeholder="0"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* ── Qtd frascos + Doses/frasco + Total de doses ────────────── */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Qtd de Frascos <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.qtdFrascos || ''}
                    onFocus={e => e.target.select()}
                    onChange={e => setForm(f => ({ ...f, qtdFrascos: e.target.value === '' ? 1 : Number(e.target.value) }))}
                    placeholder="1"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Doses por Frasco</label>
                  <select
                    value={form.dosesPorFrasco}
                    onChange={e => setForm(f => ({ ...f, dosesPorFrasco: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                    {DOSES_POR_FRASCO_OPTS.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Total de Doses</label>
                  <div className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 text-gray-500 font-semibold">
                    {totalDoses.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>

              {/* Valor unitário comprado + repassado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Valor Unit./Frasco (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valorUnitario !== '' ? formatarValor(form.valorUnitario) : ''}
                    onChange={e => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Valor Repassado/Frasco (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.valorUnitarioRepassado !== '' ? formatarValor(form.valorUnitarioRepassado) : ''}
                    onChange={e => handleValorRepassadoChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>

              {/* Status */}
              {editandoId && (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-[10px] font-semibold text-gray-500 mb-2">Status</p>
                  <div className="flex gap-1">
                    {['Inativo', 'Ativo'].map(opt => (
                      <button key={opt}
                        onClick={() => setForm(f => ({ ...f, ativo: opt === 'Ativo' }))}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          (opt === 'Ativo') === form.ativo
                            ? 'bg-teal-600 text-white'
                            : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                        }`}>{opt}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={salvar} disabled={salvando}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
                  {salvando ? 'Salvando...' : editandoId ? 'Salvar Alterações' : 'Registrar Entrada'}
                </button>
                <button onClick={limparForm}
                  className="px-4 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Modal: visualização de lote em uso (read-only) ─────────────────── */}
      {loteView && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[88vh] overflow-hidden">
            <div className="bg-teal-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-white/80" />
                <p className="font-bold text-sm text-white">Visualizar Lote</p>
              </div>
              <button onClick={() => setLoteView(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-xs text-teal-800">
                <span className="font-semibold">Lote em uso</span> — alterações não são permitidas enquanto houver doses aplicadas.
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Vacina</p>
                  <p className="font-semibold text-gray-800">{loteView.medicamentoCat?.nome ?? loteView.vacina?.nome ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Fabricante</p>
                  <p className="text-gray-700">{loteView.medicamentoCat?.fabricante ?? loteView.vacina?.fabricante ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Lote</p>
                  <p className="text-gray-700">{loteView.lote || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Validade</p>
                  <p className="text-gray-700">{loteView.validade ? formatDate(loteView.validade) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Qtd Frascos</p>
                  <p className="text-gray-700">{loteView.qtdFrascos}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Doses por Frasco</p>
                  <p className="text-gray-700">{loteView.dosesPorFrasco}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Total de Doses</p>
                  <p className="font-bold text-teal-700">{loteView.qtdTotal}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Doses Disponíveis</p>
                  <p className={`font-bold ${loteView.qtdDisponivel === 0 ? 'text-red-600' : 'text-teal-700'}`}>{loteView.qtdDisponivel}</p>
                </div>
                {loteView.valorUnitario != null && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Valor Unit./Frasco</p>
                    <p className="text-gray-700">R$ {loteView.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                )}
                {loteView.valorUnitarioRepassado != null && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Valor Repassado/Frasco</p>
                    <p className="text-gray-700">R$ {loteView.valorUnitarioRepassado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                )}
                {loteView.dataRecebimento && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Data Recebimento</p>
                    <p className="text-gray-700">{formatDate(loteView.dataRecebimento)}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Status</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${loteView.ativo ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                    {loteView.ativo ? 'ATIVO' : 'INATIVO'}
                  </span>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setLoteView(null)}
                className="w-full py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FAB mobile ────────────────────────────────────────────────────── */}
      {!modalFormAberto && podeCriar && (
        <button
          className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 bg-teal-600 hover:bg-teal-700 rounded-full shadow-xl flex items-center justify-center text-white"
          onClick={() => { limparForm(); setModalFormAberto(true); }}>
          <Plus size={24} />
        </button>
      )}

      {/* ── Modal: Ajuste de Estoque ─────────────────────────────────────── */}
      {modalAjusteAberto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={fecharAjuste} />
          <div className="fixed inset-x-4 top-[4vh] z-50 bg-white rounded-2xl shadow-2xl max-w-lg mx-auto flex flex-col max-h-[92vh] overflow-hidden">
            <div className="bg-teal-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <ArrowUpDown size={15} className="text-white/80" />
                <p className="font-bold text-sm text-white">Ajuste de Estoque</p>
              </div>
              <button onClick={fecharAjuste} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">

              {/* Seletor de lote */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Lote de vacina <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  {!dropdownAjusteAberto ? (
                    <button type="button"
                      onClick={() => { setDropdownAjusteAberto(true); setBuscaAjuste(''); }}
                      className="w-full flex items-center justify-between border border-gray-300 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white">
                      <span className={loteAjuste ? 'text-gray-900 truncate' : 'text-gray-400'}>
                        {loteAjuste ? `${nomeLote(loteAjuste)}${loteAjuste.lote ? ` · Lote ${loteAjuste.lote}` : ''}` : 'Selecione o lote...'}
                      </span>
                      {loteAjuste ? (
                        <X size={14} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setAjusteLoteId(null); setAjusteQtd(''); }} />
                      ) : (
                        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                      )}
                    </button>
                  ) : (
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input autoFocus type="text" placeholder="Buscar lote no estoque..."
                        value={buscaAjuste}
                        onChange={(e) => setBuscaAjuste(e.target.value)}
                        onBlur={() => setTimeout(() => { setDropdownAjusteAberto(false); setBuscaAjuste(''); }, 150)}
                        className="w-full pl-8 pr-3 border border-gray-300 rounded-xl py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <ul className="max-h-44 overflow-y-auto">
                          {(() => {
                            const disponiveis = lotes.filter((l) => l.ativo);
                            const filtrados = buscaAjuste.trim() === '' ? disponiveis : disponiveis.filter((l) =>
                              nomeLote(l).toLowerCase().includes(buscaAjuste.toLowerCase()) ||
                              (l.lote ?? '').toLowerCase().includes(buscaAjuste.toLowerCase())
                            );
                            return filtrados.length === 0 ? (
                              <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhum lote encontrado.</li>
                            ) : (
                              filtrados.map((l) => (
                                <li key={l.id}>
                                  <button type="button"
                                    onMouseDown={() => {
                                      setAjusteLoteId(l.id);
                                      setAjusteQtd(l.qtdDisponivel);
                                      setDropdownAjusteAberto(false);
                                      setBuscaAjuste('');
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 transition-colors ${
                                      ajusteLoteId === l.id ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-gray-800'
                                    }`}>
                                    <span className="block truncate">{nomeLote(l)}</span>
                                    <span className="text-[11px] text-gray-400">
                                      {l.qtdDisponivel}/{l.qtdTotal} doses
                                      {l.lote && ` · Lote ${l.lote}`}
                                    </span>
                                  </button>
                                </li>
                              ))
                            );
                          })()}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Dados do lote selecionado */}
              {loteAjuste && (
                <div className="bg-teal-50 border border-teal-100 rounded-xl p-2.5 text-xs text-gray-600">
                  <p className="font-semibold text-teal-700 text-[11px] uppercase tracking-wider mb-1">Lote Selecionado</p>
                  <div className="grid grid-cols-2 gap-1">
                    <p><span className="text-gray-400">Doses atuais:</span>{' '}
                      <b className="text-teal-700">{loteAjuste.qtdDisponivel}/{loteAjuste.qtdTotal}</b></p>
                    <p><span className="text-gray-400">Lote:</span> {loteAjuste.lote || '—'}</p>
                    <p><span className="text-gray-400">Validade:</span> {loteAjuste.validade ? formatDate(loteAjuste.validade) : '—'}</p>
                  </div>
                </div>
              )}

              {/* Quantidade final de doses — pré-preenchida com a atual */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Doses disponíveis <span className="text-red-500">*</span>
                </label>
                <input type="number" min={0} value={ajusteQtd === '' ? '' : ajusteQtd}
                  onChange={(e) => setAjusteQtd(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
                {loteAjuste && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Informe a contagem real de doses — a diferença será registrada como ajuste.
                  </p>
                )}
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Motivo <span className="text-red-500">*</span>
                </label>
                <input type="text" value={ajusteMotivo}
                  onChange={(e) => setAjusteMotivo(e.target.value)}
                  placeholder="Ex: correção de inventário, perda, quebra..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              </div>

              {/* Preview da diferença */}
              {loteAjuste && ajusteQtd !== '' && (() => {
                const nova = Number(ajusteQtd);
                if (nova < 0) return <p className="text-xs text-red-600 font-semibold">Quantidade não pode ser negativa.</p>;
                const delta = nova - loteAjuste.qtdDisponivel;
                if (delta === 0) return <p className="text-xs text-gray-500">Quantidade igual ao estoque atual — nenhum ajuste será registrado.</p>;
                return (
                  <p className="text-xs text-gray-600">
                    Diferença a registrar:{' '}
                    <b className={delta > 0 ? 'text-teal-700' : 'text-red-600'}>
                      {delta > 0 ? '+' : '−'}{Math.abs(delta)} doses
                    </b>
                    {' '}({loteAjuste.qtdDisponivel} → {nova})
                  </p>
                );
              })()}

              <div className="flex gap-2">
                <button onClick={confirmarAjuste} disabled={ajustando || !loteAjuste}
                  className="flex-1 bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
                  {ajustando ? 'Ajustando...' : 'Confirmar Ajuste'}
                </button>
                <button onClick={fecharAjuste}
                  className="px-4 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Modal: confirmar inativação ──────────────────────────────────── */}
      <ModalJustificativa
        aberto={!!confirmExcluir}
        titulo="Inativar lote?"
        descricao={confirmExcluir
          ? `${confirmExcluir.medicamentoCat?.nome ?? confirmExcluir.vacina?.nome ?? '—'} — Lote ${confirmExcluir.lote} · ${confirmExcluir.qtdDisponivel} doses disponíveis`
          : undefined}
        acaoLabel="Inativar"
        onConfirmar={confirmarExcluir}
        onFechar={() => setConfirmExcluir(null)}
      />
    </PageContainer>
  );
}
