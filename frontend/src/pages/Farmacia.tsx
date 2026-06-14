// src/pages/Farmacia.tsx
// Gestão de estoque por clínica — referencia o catálogo global de Medicamentos

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { usePermissoes } from '../hooks/usePermissoes';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import {
  AlertTriangle, Lock, Plus, Pencil, Trash2,
  Search, RefreshCw, X, BarChart2, Package, Calendar,
  ChevronDown,
} from 'lucide-react';
import { formatDateShort, formatDate } from '../utils/dateUtils';
import DateInputBR from '../components/DateInputBR';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Via { id: number; via: string }

interface Medicamento {
  id: number;
  nome: string;
  formaFarmaceutica: string;
  unidade: string;
  apresentacao: string;
  controlado: boolean;
  ativo: boolean;
  vias: Via[];
}

interface EstoqueItem {
  id: number;
  medicamentoId: number;
  empresaId: number | null;
  valor: number;
  lote: string | null;
  validade: string | null;
  qtdEstoque: number;
  estoqueMinimo: number;
  estoqueAlarmante: number;
  ativo: boolean;
  medicamento: Medicamento;
}

interface Meta { total: number; totalControlados: number; totalAbaixoMinimo: number; totalAbaixoAlarmante: number }

interface MovimentoEstoque { id: number; tipo: string; quantidade: number; motivo: string | null; createdAt: string }

type FiltroTab = 'todos' | 'critico' | 'alarmante' | 'controlados' | 'inativos';

const FORM_VAZIO = {
  medicamentoId: 0,
  valor: 0, lote: '', validade: '',
  qtdEstoque: 0, estoqueMinimo: 0, estoqueAlarmante: 0,
  ativo: true,
};

// ─── ChartMovimentos ──────────────────────────────────────────────────────────

function ChartMovimentos({ movimentos }: { movimentos: MovimentoEstoque[] }) {
  const porDia: Record<string, { entrada: number; saida: number; ajuste: number }> = {};
  movimentos.forEach((m) => {
    const d = formatDateShort(m.createdAt);
    if (!porDia[d]) porDia[d] = { entrada: 0, saida: 0, ajuste: 0 };
    if (m.tipo === 'ENTRADA')    porDia[d].entrada += m.quantidade;
    else if (m.tipo === 'SAIDA') porDia[d].saida   += m.quantidade;
    else                         porDia[d].ajuste  += m.quantidade;
  });
  const dias   = Object.entries(porDia);
  const maxVal = Math.max(...dias.flatMap(([, v]) => [v.entrada, v.saida, v.ajuste]), 1);
  const toH    = (v: number) => Math.max(Math.round((v / maxVal) * 112), 8);
  return (
    <>
      <div className="flex gap-4 mb-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />Entrada</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-500" />Saída</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-blue-500" />Ajuste</span>
      </div>
      <div className="overflow-x-auto">
        <div style={{ display:'flex', gap:'8px', height:'120px', alignItems:'flex-end', borderBottom:'2px solid #e5e7eb', minWidth:`${dias.length*48}px` }}>
          {dias.map(([date,vals]) => (
            <div key={date} style={{ flex:1, minWidth:'40px', display:'flex', alignItems:'flex-end', justifyContent:'center', gap:'3px' }}>
              {vals.entrada>0 && <div title={`Entrada:${vals.entrada}`} style={{width:'16px',height:`${toH(vals.entrada)}px`,backgroundColor:'#10b981',borderRadius:'4px 4px 0 0',flexShrink:0}} />}
              {vals.saida>0   && <div title={`Saída:${vals.saida}`}     style={{width:'16px',height:`${toH(vals.saida)}px`,  backgroundColor:'#ef4444',borderRadius:'4px 4px 0 0',flexShrink:0}} />}
              {vals.ajuste>0  && <div title={`Ajuste:${vals.ajuste}`}   style={{width:'16px',height:`${toH(vals.ajuste)}px`, backgroundColor:'#3b82f6',borderRadius:'4px 4px 0 0',flexShrink:0}} />}
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:'8px', marginTop:'4px', minWidth:`${dias.length*48}px` }}>
          {dias.map(([date]) => (
            <div key={date} style={{ flex:1, minWidth:'40px', textAlign:'center', fontSize:'10px', color:'#9ca3af' }}>{date}</div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Helper: extrai volume numérico de nome ou apresentação do medicamento ────
// Ex: "Catófos 500 ml" → 500  |  "Frasco 1L" → 1  |  "Pen 10.000 UI" → 10000

function extrairVolume(med: Medicamento): number | null {
  for (const texto of [med.apresentacao, med.nome]) {
    if (!texto) continue;
    // Tenta casar o número seguido da unidade do catálogo (case-insensitive)
    const reUnidade = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${med.unidade}`, 'i');
    const m1 = texto.match(reUnidade);
    if (m1) return parseFloat(m1[1].replace(',', '.'));
    // Fallback: qualquer número seguido de unidade farmacêutica comum
    const m2 = texto.match(/(\d+(?:[.,]\d+)?)\s*(?:mL|ml|ML|L(?!\w)|g(?!\w)|mg|mcg|UI|un)/);
    if (m2) return parseFloat(m2[1].replace(',', '.'));
  }
  return null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Farmacia() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();
  const podeCriar   = isGestor || podeExecutar('farmacia.estoque.criar');
  const podeEditar  = isGestor || podeExecutar('farmacia.estoque.editar');
  const podeDeletar = isGestor || podeExecutar('farmacia.estoque.deletar');
  const semPermissao = (acao: string) =>
    toast.error(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [itens,       setItens]       = useState<EstoqueItem[]>([]);
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);
  const [meta,        setMeta]        = useState<Meta>({ total:0, totalControlados:0, totalAbaixoMinimo:0, totalAbaixoAlarmante:0 });
  const [loading,     setLoading]     = useState(false);
  const [busca,       setBusca]       = useState('');
  const [filtroTab,   setFiltroTab]   = useState<FiltroTab>('todos');

  const [form,        setForm]        = useState({ ...FORM_VAZIO });
  const [editandoId,  setEditandoId]  = useState<number | null>(null);
  const [salvando,    setSalvando]    = useState(false);
  const [modalFormAberto, setModalFormAberto] = useState(false);

  const [modalHistorico,  setModalHistorico]  = useState<EstoqueItem | null>(null);
  const [movimentos,      setMovimentos]      = useState<MovimentoEstoque[]>([]);
  const [loadingMov,      setLoadingMov]      = useState(false);
  const [confirmExcluir,  setConfirmExcluir]  = useState<EstoqueItem | null>(null);
  const [valorStr,        setValorStr]        = useState('');
  const [frascos,         setFrascos]         = useState<number | ''>('');

  // ── Busca medicamento selecionado ─────────────────────────────────────────

  const medSelecionado = medicamentos.find((m) => m.id === form.medicamentoId) ?? null;
  const estoqueExistente = !editandoId && form.medicamentoId
    ? itens.find((i) => i.medicamentoId === form.medicamentoId && i.ativo) ?? null
    : null;

  // Volume por embalagem detectado automaticamente do nome/apresentação
  const volDetectado  = medSelecionado ? extrairVolume(medSelecionado) : null;
  // Rótulo do tipo de embalagem (primeira palavra da apresentação: "frasco", "ampola", etc.)
  const tipoEmbalagem = medSelecionado?.apresentacao?.match(/^([A-Za-zÀ-ÿ]+)/i)?.[1]?.toLowerCase() ?? 'unidade';
  const hoje = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const formatarValor = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat(navigator.language || 'pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);

  const handleValorChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cents = parseInt(digits || '0', 10);
    const value = cents / 100;
    setForm((f) => ({ ...f, valor: value }));
    setValorStr(value === 0 ? '' : formatarValor(value));
  };

  // ── Carregar ──────────────────────────────────────────────────────────────

  const carregarEstoque = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (busca) params.busca = busca;
      if (filtroTab === 'inativos') params.ativo = 'false';
      else                          params.ativo = 'true';
      if (filtroTab === 'controlados') params.controlado = 'true';

      const [estoqueRes, medRes] = await Promise.all([
        api.get('/farmacia/estoque', { params }),
        api.get('/medicamentos', { params: { ativo: 'true' } }),
      ]);

      setItens(estoqueRes.data.dados ?? []);
      setMeta(estoqueRes.data.meta ?? { total:0, totalControlados:0, totalAbaixoMinimo:0, totalAbaixoAlarmante:0 });
      setMedicamentos(medRes.data.dados ?? []);
    } catch { toast.error('Erro ao carregar estoque.'); }
    finally { setLoading(false); }
  }, [busca, filtroTab]);

  useEffect(() => { if (!loadingPerm) carregarEstoque(); }, [carregarEstoque, loadingPerm]);

  // Reseta frascos ao trocar de medicamento
  useEffect(() => { setFrascos(''); }, [form.medicamentoId]);

  // ── Filtro local ──────────────────────────────────────────────────────────

  const itensFiltrados = (() => {
    if (filtroTab === 'critico')     return itens.filter((i) => i.qtdEstoque <= i.estoqueMinimo);
    if (filtroTab === 'alarmante')   return itens.filter((i) => i.qtdEstoque <= i.estoqueAlarmante && i.qtdEstoque > i.estoqueMinimo);
    return itens;
  })();

  // ── Helpers UI ────────────────────────────────────────────────────────────

  const nivelEstoque = (i: EstoqueItem) => {
    if (i.qtdEstoque <= i.estoqueMinimo)    return 'critico';
    if (i.estoqueAlarmante > 0 && i.qtdEstoque <= i.estoqueAlarmante) return 'alarmante';
    return 'ok';
  };

  const barColor = (i: EstoqueItem) => {
    const n = nivelEstoque(i);
    if (n === 'critico')   return 'bg-red-500';
    if (n === 'alarmante') return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const barWidth = (i: EstoqueItem) => {
    const ref = Math.max(i.estoqueAlarmante, i.estoqueMinimo) * 2 || 10;
    return `${Math.min((i.qtdEstoque / ref) * 100, 100)}%`;
  };

  const formatValidade = (v: string | null) => {
    if (!v) return '—';
    const [year, month, day] = v.split('T')[0].split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const agora = new Date(); agora.setHours(0, 0, 0, 0);
    const diff = (d.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24);
    const label = formatDate(v);
    if (diff < 0)   return <span className="text-red-600 font-semibold">{label} ⚠</span>;
    if (diff < 30)  return <span className="text-amber-600 font-semibold">{label}</span>;
    return <span>{label}</span>;
  };

  // ── Form handlers ─────────────────────────────────────────────────────────

  const preencherEdicao = (item: EstoqueItem) => {
    setForm({
      medicamentoId:   item.medicamentoId,
      valor:           item.valor,
      lote:            item.lote ?? '',
      validade:        item.validade ? item.validade.split('T')[0] : '',
      qtdEstoque:      item.qtdEstoque,
      estoqueMinimo:   item.estoqueMinimo,
      estoqueAlarmante: item.estoqueAlarmante,
      ativo:           item.ativo,
    });
    setValorStr(formatarValor(item.valor));
    setEditandoId(item.id);
    setModalFormAberto(true);
  };

  const limparForm = () => {
    setForm({ ...FORM_VAZIO });
    setValorStr('');
    setEditandoId(null);
    setModalFormAberto(false);
    setFrascos('');
  };

  const salvar = async () => {
    if (editandoId && !podeEditar) { semPermissao('editar estoque'); return; }
    if (!editandoId && !podeCriar) { semPermissao('criar entrada de estoque'); return; }
    if (!form.medicamentoId) return toast.error('Selecione um medicamento do catálogo.');
    if (form.validade && form.validade < hoje) return toast.error('Validade não pode ser anterior à data de hoje.');

    // Lote e validade obrigatórios em todos os casos (novo, existente e edição)
    if (!form.lote || !form.lote.trim()) return toast.error('Lote é obrigatório.');
    if (!form.validade) return toast.error('Validade é obrigatória.');

    if (!editandoId && estoqueExistente) {
      if (form.qtdEstoque <= 0) return toast.error('Informe uma quantidade maior que zero.');
      setSalvando(true);
      try {
        await api.patch(`/farmacia/estoque/${estoqueExistente.id}/ajuste`, {
          tipo: 'ENTRADA',
          quantidade: form.qtdEstoque,
          motivo: form.lote ? `Lote: ${form.lote}` : 'Entrada manual',
        });
        toast.success('Quantidade adicionada ao estoque.');
        limparForm();
        carregarEstoque();
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        toast.error(msg ?? 'Erro ao adicionar estoque.');
      } finally { setSalvando(false); }
      return;
    }

    if (form.estoqueMinimo < 0 || form.estoqueAlarmante < 0) return toast.error('Quantidades não podem ser negativas.');
    if (!editandoId && form.qtdEstoque < 0) return toast.error('Estoque não pode ser negativo.');
    if (!form.valor || form.valor <= 0) return toast.error('Valor é obrigatório.');

    setSalvando(true);
    try {
      const payload = {
        medicamentoId:   form.medicamentoId,
        valor:           form.valor,
        lote:            form.lote || null,
        validade:        form.validade || null,
        estoqueMinimo:   form.estoqueMinimo,
        estoqueAlarmante: form.estoqueAlarmante,
        ativo:           form.ativo,
        ...(!editandoId && { qtdEstoque: form.qtdEstoque }),
      };

      if (editandoId) {
        await api.put(`/farmacia/estoque/${editandoId}`, payload);
        toast.success('Estoque atualizado.');
      } else {
        await api.post('/farmacia/estoque', { ...payload, qtdEstoque: form.qtdEstoque });
        toast.success('Entrada de estoque registrada.');
      }
      limparForm();
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg ?? 'Erro ao salvar.');
    } finally { setSalvando(false); }
  };

  const confirmarExcluir = async () => {
    if (!confirmExcluir) return;
    if (!podeDeletar) { semPermissao('inativar item do estoque'); return; }
    try {
      await api.delete(`/farmacia/estoque/${confirmExcluir.id}`);
      toast.success('Item inativado.');
      setConfirmExcluir(null);
      carregarEstoque();
    } catch { toast.error('Erro ao inativar.'); }
  };

  const abrirHistorico = async (item: EstoqueItem) => {
    setModalHistorico(item);
    setLoadingMov(true);
    try {
      const res = await api.get(`/farmacia/estoque/movimentos/${item.id}`);
      setMovimentos(res.data.dados ?? []);
    } catch { toast.error('Erro ao carregar histórico.'); }
    finally { setLoadingMov(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const tabsBadge: Record<FiltroTab, string | number> = {
    todos:       meta.total,
    critico:     meta.totalAbaixoMinimo,
    alarmante:   meta.totalAbaixoAlarmante,
    controlados: meta.totalControlados,
    inativos:    '',
  };

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('farmacia.estoque.ler')) return null;

  return (
    <PageContainer maxWidth="7xl">
      <div className="space-y-5">

        <BotaoVoltar className="mb-6" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Package size={20} className="text-emerald-700" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Estoque da Clínica</h1>
              <p className="text-sm text-gray-500">Entradas, saídas e níveis de reposição por estabelecimento.</p>
            </div>
          </div>
        </div>

        {/* Cards resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label:'Itens Ativos',  value:meta.total,               color:'text-gray-900', bg:'bg-white' },
            { label:'Estoque Crítico', value:meta.totalAbaixoMinimo,   color:'text-red-600',  bg:meta.totalAbaixoMinimo>0?'bg-red-50':'bg-white', icon:<AlertTriangle size={12} className="text-red-500" /> },
            { label:'Alerta Amarelo', value:meta.totalAbaixoAlarmante, color:'text-amber-600',bg:meta.totalAbaixoAlarmante>0?'bg-amber-50':'bg-white', icon:<AlertTriangle size={12} className="text-amber-500" /> },
            { label:'Controlados',   value:meta.totalControlados,     color:'text-purple-700',bg:'bg-white', icon:<Lock size={12} className="text-purple-500" /> },
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
              <Package size={16} className="text-emerald-600" />
              <h2 className="font-bold text-gray-800 text-sm">Itens em Estoque</h2>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { limparForm(); setModalFormAberto(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl transition-colors">
                Entrada de Estoque
              </button>
              <button onClick={carregarEstoque} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
            <input type="text" placeholder="Buscar por nome, forma, via..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {([
              ['todos','Ativos'],
              ['critico','🔴 Crítico'],
              ['alarmante','🟡 Alarmante'],
              ['controlados','🔒 Controlados'],
              ['inativos','Inativos'],
            ] as [FiltroTab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFiltroTab(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  filtroTab === key
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {label}{tabsBadge[key] !== '' ? ` ${tabsBadge[key]}` : ''}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-center py-12 text-gray-400 text-sm">Carregando...</p>
          ) : itensFiltrados.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Nenhum item encontrado.</p>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'max-content 1fr max-content', rowGap:'6px' }}>
              {itensFiltrados.map((item) => {
                const nivel = nivelEstoque(item);
                const borderCls = nivel === 'critico' ? 'border-l-[4px] border-l-red-500 border-red-100'
                  : nivel === 'alarmante' ? 'border-l-[4px] border-l-amber-400 border-amber-50'
                  : 'border-gray-200';

                return (
                  <div key={item.id} style={{ display:'contents' }}>
                    {/* Célula 1 — info */}
                    <div className={`flex items-center gap-2 bg-white px-4 py-2.5 border-y border-l rounded-l-xl ${borderCls}`}>
                      <span role="button" tabIndex={0}
                        onClick={() => abrirHistorico(item)}
                        onKeyDown={(e) => e.key==='Enter' && abrirHistorico(item)}
                        className="font-semibold text-emerald-700 text-sm whitespace-nowrap hover:underline flex items-center gap-1 cursor-pointer">
                        <BarChart2 size={12} className="text-emerald-500 flex-shrink-0" />
                        {item.medicamento.nome}
                      </span>
                      {item.medicamento.controlado && <Lock size={10} className="text-purple-600 flex-shrink-0" />}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${item.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {item.ativo ? 'ATIVO' : 'INATIVO'}
                      </span>
                      <span className="hidden sm:inline text-xs text-gray-400 flex-shrink-0 ml-1">
                        {item.medicamento.formaFarmaceutica} · {item.medicamento.apresentacao}
                        {item.lote && ` · Lote: ${item.lote}`}
                      </span>
                      {item.validade && (
                        <span className="hidden lg:inline text-xs ml-1 flex items-center gap-0.5 flex-shrink-0">
                          <Calendar size={10} className="text-gray-400" />
                          {formatValidade(item.validade)}
                        </span>
                      )}
                    </div>

                    {/* Célula 2 — barra */}
                    <div className={`flex flex-col justify-center gap-0.5 bg-white px-6 py-2.5 border-y ${borderCls.replace('border-l-[4px] border-l-red-500 ','').replace('border-l-[4px] border-l-amber-400 ','')}`}>
                      <div className="flex items-center justify-center gap-1">
                        <span className={`text-[10px] font-bold ${nivel==='critico' ? 'text-red-600' : nivel==='alarmante' ? 'text-amber-600' : 'text-gray-500'}`}>
                          {item.qtdEstoque}/{item.estoqueMinimo}
                        </span>
                        {nivel !== 'ok' && <AlertTriangle size={10} className={nivel==='critico' ? 'text-red-500' : 'text-amber-500'} />}
                      </div>
                      <div className="bg-gray-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${barColor(item)}`} style={{ width: barWidth(item) }} />
                      </div>
                    </div>

                    {/* Célula 3 — ações */}
                    <div className={`flex items-center gap-1 bg-white px-4 py-2.5 border-y border-r rounded-r-xl ${borderCls.replace('border-l-[4px] border-l-red-500 ','').replace('border-l-[4px] border-l-amber-400 ','')}`}>
                      <button onClick={() => preencherEdicao(item)} title="Editar"
                        className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setConfirmExcluir(item)} title="Inativar"
                        className="p-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: formulário de estoque ──────────────────────────────────── */}
      {modalFormAberto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={limparForm} />
          <div className="fixed inset-x-4 top-12 bottom-4 z-50 overflow-y-auto bg-white rounded-2xl shadow-2xl max-w-lg mx-auto flex flex-col">
            <div className="bg-emerald-700 px-5 py-4 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 text-white">
                <Plus size={18} />
                <p className="font-bold text-sm">{editandoId ? 'Editar Estoque' : 'Entrada de Estoque'}</p>
              </div>
              <button onClick={limparForm} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4 flex-1 overflow-y-auto">

              {/* Seletor de Medicamento */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Medicamento <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={form.medicamentoId || ''}
                    onChange={(e) => setForm((f) => ({ ...f, medicamentoId: Number(e.target.value) }))}
                    disabled={!!editandoId}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 appearance-none pr-8 disabled:bg-gray-100">
                    <option value="">Selecione o medicamento...</option>
                    {medicamentos.map((m) => (
                      <option key={m.id} value={m.id}>{m.nome}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Campos auto-preenchidos do catálogo */}
              {medSelecionado && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-indigo-700 text-[11px] uppercase tracking-wider mb-1.5">Do Catálogo</p>
                  <div className="grid grid-cols-2 gap-1">
                    <p><span className="text-gray-400">Forma:</span> {medSelecionado.formaFarmaceutica}</p>
                    <p><span className="text-gray-400">Unidade:</span> {medSelecionado.unidade}</p>
                    <p><span className="text-gray-400">Apresentação:</span> {medSelecionado.apresentacao}</p>
                    <p><span className="text-gray-400">Controlado:</span> {medSelecionado.controlado ? '✓ Sim' : 'Não'}</p>
                  </div>
                  {medSelecionado.vias.length > 0 && (
                    <p><span className="text-gray-400">Vias:</span> {medSelecionado.vias.map((v) => v.via).join(', ')}</p>
                  )}
                </div>
              )}

              {/* Banner: medicamento já existe no estoque */}
              {estoqueExistente && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-gray-700">
                  <p>Estoque atual: <span className="font-bold">{estoqueExistente.qtdEstoque} {estoqueExistente.medicamento.unidade}</span></p>
                  <p className="mt-1 text-gray-500">A quantidade informada será somada ao estoque existente.</p>
                </div>
              )}

              {/* Valor + Lote + Validade */}
              {!estoqueExistente && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Valor (R$) <span className="text-red-500">*</span></label>
                    <input type="text" inputMode="decimal" value={valorStr}
                      onChange={(e) => handleValorChange(e.target.value)}
                      placeholder="0,00"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Lote <span className="text-red-500">*</span></label>
                    <input type="text" value={form.lote}
                      onChange={(e) => setForm((f) => ({ ...f, lote: e.target.value }))}
                      placeholder="Ex: LOT2024"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Validade <span className="text-red-500">*</span></label>
                    <DateInputBR
                      value={form.validade}
                      onChange={v => setForm(f => ({ ...f, validade: v }))}
                      min={hoje}
                      className="border border-gray-300 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-500"
                    />
                  </div>
                </div>
              )}
              {estoqueExistente && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Lote <span className="text-red-500">*</span></label>
                    <input type="text" value={form.lote}
                      onChange={(e) => setForm((f) => ({ ...f, lote: e.target.value }))}
                      placeholder="Ex: LOT2024"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Validade <span className="text-red-500">*</span></label>
                    <DateInputBR
                      value={form.validade}
                      onChange={v => setForm(f => ({ ...f, validade: v }))}
                      min={hoje}
                      className="border border-gray-300 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {/* Quantidade + Mínimo + Alarmante */}
              <div className={`grid gap-3 ${estoqueExistente ? 'grid-cols-1' : 'grid-cols-3'}`}>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {volDetectado
                      ? <>Qtd <span className="text-gray-400 font-normal capitalize">({tipoEmbalagem}s)</span></>
                      : <>Qtd {medSelecionado && <span className="text-gray-400 font-normal">({medSelecionado.unidade})</span>}</>
                    }
                    {' '}<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" min={0}
                    disabled={!!editandoId}
                    value={volDetectado ? (frascos === '' ? '' : frascos) : (form.qtdEstoque === 0 ? '' : form.qtdEstoque)}
                    onChange={e => {
                      const n = e.target.value === '' ? '' : Number(e.target.value);
                      if (volDetectado) {
                        setFrascos(n);
                        setForm(f => ({ ...f, qtdEstoque: n !== '' && Number(n) > 0 ? Number(n) * volDetectado : 0 }));
                      } else {
                        setFrascos('');
                        setForm(f => ({ ...f, qtdEstoque: n === '' ? 0 : Number(n) }));
                      }
                    }}
                    placeholder={volDetectado ? `Nº de ${tipoEmbalagem}s` : '0'}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {volDetectado && (
                    <p className="text-[11px] text-gray-400 mt-1 leading-tight">
                      1 {tipoEmbalagem} = {volDetectado.toLocaleString('pt-BR')} {medSelecionado!.unidade}
                      {frascos !== '' && Number(frascos) > 0 && (
                        <><br /><b className="text-emerald-700">
                          = {(Number(frascos) * volDetectado).toLocaleString('pt-BR')} {medSelecionado!.unidade}
                        </b></>
                      )}
                    </p>
                  )}
                  {editandoId && <p className="text-[10px] text-gray-400 mt-1">Use "Ajuste de Estoque" para alterar.</p>}
                </div>

                {!estoqueExistente && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                        Mínimo <span className="text-gray-400 font-normal">({medSelecionado?.unidade ?? 'un'})</span>
                      </label>
                      <input type="number" min={0} value={form.estoqueMinimo}
                        onChange={(e) => setForm((f) => ({ ...f, estoqueMinimo: Number(e.target.value) }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                        Alarmante <span className="text-gray-400 font-normal">({medSelecionado?.unidade ?? 'un'})</span>
                      </label>
                      <input type="number" min={0} value={form.estoqueAlarmante}
                        onChange={(e) => setForm((f) => ({ ...f, estoqueAlarmante: Number(e.target.value) }))}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  </>
                )}
              </div>

              {/* Status */}
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                <p className="text-[10px] font-semibold text-gray-500 mb-2">Status Cadastral</p>
                <div className="flex gap-1">
                  {['Inativo','Ativo'].map((opt) => (
                    <button key={opt} onClick={() => setForm((f) => ({ ...f, ativo: opt === 'Ativo' }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        (opt === 'Ativo') === form.ativo
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-100'
                      }`}>{opt}</button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={salvar} disabled={salvando}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60">
                  {salvando ? 'Salvando...' : editandoId ? 'Salvar Alterações' : estoqueExistente ? 'Adicionar ao Estoque' : 'Registrar Entrada'}
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

      {/* ── FAB mobile ────────────────────────────────────────────────────── */}
      {!modalFormAberto && (
        <button
          className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 bg-emerald-600 hover:bg-emerald-700 rounded-full shadow-xl flex items-center justify-center text-white"
          onClick={() => { limparForm(); setModalFormAberto(true); }}>
          <Plus size={24} />
        </button>
      )}

      {/* ── Modal: histórico ────────────────────────────────────────────── */}
      {modalHistorico && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-emerald-600" />
                  <h3 className="font-bold text-gray-900">Histórico de Movimentações</h3>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{modalHistorico.medicamento.nome}</p>
              </div>
              <button onClick={() => setModalHistorico(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>
            {loadingMov ? (
              <p className="text-center py-10 text-gray-400 text-sm">Carregando...</p>
            ) : movimentos.length === 0 ? (
              <p className="text-center py-10 text-gray-400 text-sm">Nenhum movimento registrado.</p>
            ) : (
              <ChartMovimentos movimentos={movimentos} />
            )}
            <button onClick={() => setModalHistorico(null)}
              className="w-full mt-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: confirmar exclusão ────────────────────────────────────── */}
      {confirmExcluir && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-bold text-gray-900 mb-2">Inativar item?</h3>
            <p className="text-xs text-gray-500 mb-5">{confirmExcluir.medicamento.nome}</p>
            <div className="flex gap-2">
              <button onClick={confirmarExcluir}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-xl text-sm font-semibold">Inativar</button>
              <button onClick={() => setConfirmExcluir(null)}
                className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-xl text-sm hover:bg-gray-50">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}