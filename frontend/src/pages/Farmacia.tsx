// src/pages/Farmacia.tsx
// Gestão de estoque por clínica — referencia o catálogo global de Medicamentos

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { usePermissoes } from '../hooks/usePermissoes';
import toast from 'react-hot-toast';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import {
  AlertTriangle, Lock, Plus, Pencil, Trash2,
  Search, RefreshCw, X, BarChart2, Package,
  ChevronDown, Eye, ArrowUpDown,
} from 'lucide-react';
import { formatDateShort, formatDate } from '../utils/dateUtils';
import DateInput from '../components/DateInput';
import ModalNovoFornecedor, { type NovoFornecedorResult } from '../components/ModalNovoFornecedor';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';

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

interface FornecedorItem { id: number; nome: string; tipoServico: string }

interface EstoqueItem {
  id: number;
  medicamentoId: number;
  empresaId: number | null;
  valor: number;
  valorRepassado: number;
  lote: string | null;
  validade: string | null;
  qtdEstoque: number;
  qtdEmbalagens: number | null;
  pesoPorEmbalagem: number | null;
  estoqueMinimo: number;
  estoqueAlarmante: number;
  ativo: boolean;
  fornecedorId: number | null;
  notaFiscal: string | null;
  emUso?: boolean;
  medicamento: Medicamento;
  fornecedor: FornecedorItem | null;
}

interface Meta { total: number; totalControlados: number; totalAbaixoMinimo: number; totalAbaixoAlarmante: number }

interface MovimentoEstoque { id: number; tipo: string; quantidade: number; motivo: string | null; createdAt: string }

type FiltroTab = 'todos' | 'critico' | 'alarmante' | 'controlados' | 'inativos';


// Tipos de fornecedor relevantes para farmácia (excluem prestadores de serviço clínico)
const TIPOS_FORNECEDOR_FARMACIA = new Set(['Farmácia', 'Laboratório', 'Loja']);
// Fornecedor pode ter vários tipos (CSV) — basta um relevante para aparecer na farmácia.
const fornecedorDeFarmacia = (tipoServico: string | null | undefined) =>
  (tipoServico ?? '').split(',').some(t => TIPOS_FORNECEDOR_FARMACIA.has(t.trim()));
// Valor sentinela do seletor: abrir o cadastro de novo fornecedor.
const NOVO_FORNECEDOR = -1;

const FORM_VAZIO = {
  medicamentoId: 0,
  valor: 0, valorRepassado: 0, lote: '', validade: '',
  qtdEstoque: 0, estoqueMinimo: 0, estoqueAlarmante: 0,
  ativo: true,
  fornecedorId: 0,
  notaFiscal: '',
};

// ─── ChartMovimentos ──────────────────────────────────────────────────────────

function ChartMovimentos({ movimentos }: { movimentos: MovimentoEstoque[] }) {
  const porDia: Record<string, { entrada: number; saida: number; ajuste: number }> = {};
  movimentos.forEach((m) => {
    const d = formatDateShort(m.createdAt);
    if (!porDia[d]) porDia[d] = { entrada: 0, saida: 0, ajuste: 0 };
    if (m.tipo === 'ENTRADA')    porDia[d].entrada += m.quantidade;
    else if (m.tipo === 'SAIDA') porDia[d].saida   += m.quantidade;
    // AJUSTE pode ser negativo (correção para baixo) — a barra mostra a magnitude
    else                         porDia[d].ajuste  += Math.abs(m.quantidade);
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

function extrairVolume(med: Medicamento): number | null {
  for (const texto of [med.apresentacao, med.nome]) {
    if (!texto) continue;
    const reUnidade = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${med.unidade}`, 'i');
    const m1 = texto.match(reUnidade);
    if (m1) return parseFloat(m1[1].replace(',', '.'));
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
  const podeAjustar = isGestor || podeExecutar('farmacia.estoque.ajustar');
  const podeDeletar = isGestor || podeExecutar('farmacia.estoque.deletar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [itens,        setItens]        = useState<EstoqueItem[]>([]);
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro do SALVAR do painel de formulário — no topo da página fica fora da vista
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [fornecedores, setFornecedores] = useState<FornecedorItem[]>([]);
  const [showNovoForn, setShowNovoForn] = useState(false);
  const [meta,         setMeta]         = useState<Meta>({ total:0, totalControlados:0, totalAbaixoMinimo:0, totalAbaixoAlarmante:0 });
  const [loading,      setLoading]      = useState(false);
  const [busca,        setBusca]        = useState('');
  const [filtroTab,    setFiltroTab]    = useState<FiltroTab>('todos');

  const [form,         setForm]         = useState({ ...FORM_VAZIO });
  const [editandoId,   setEditandoId]   = useState<number | null>(null);
  // Item em edição já teve movimentação? (bloqueia edição de embalagens/peso)
  const [editandoEmUso, setEditandoEmUso] = useState(false);
  const [salvando,     setSalvando]     = useState(false);
  const [modalFormAberto, setModalFormAberto] = useState(false);

  const [modalHistorico, setModalHistorico] = useState<EstoqueItem | null>(null);
  const [movimentos,     setMovimentos]     = useState<MovimentoEstoque[]>([]);
  const [loadingMov,     setLoadingMov]     = useState(false);

  const [itemView,       setItemView]       = useState<EstoqueItem | null>(null);
  const [confirmExcluir, setConfirmExcluir] = useState<EstoqueItem | null>(null);

  // Modal Ajuste de Estoque (correção manual de quantidade — cria MovimentoEstoque AJUSTE)
  const [modalAjusteAberto,     setModalAjusteAberto]     = useState(false);
  const [ajusteItemId,          setAjusteItemId]          = useState<number | null>(null);
  const [buscaAjuste,           setBuscaAjuste]           = useState('');
  const [dropdownAjusteAberto,  setDropdownAjusteAberto]  = useState(false);
  // Quantidade FINAL em estoque (pré-preenchida com a atual) — o delta é calculado
  const [ajusteQtd,      setAjusteQtd]      = useState<number | ''>('');
  const [ajusteFrascos,  setAjusteFrascos]  = useState<number | ''>('');
  const [ajusteMotivo,   setAjusteMotivo]   = useState('');
  const [ajustando,      setAjustando]      = useState(false);
  const [valorStr,             setValorStr]             = useState('');
  const [valorRepassadoStr,    setValorRepassadoStr]    = useState('');
  const [repassadoEditado,     setRepassadoEditado]     = useState(false);
  const [frascos,        setFrascos]        = useState<number | ''>('');
  const [pesoPorEmbalagem, setPesoPorEmbalagem] = useState<number | ''>('');
  const [buscaMed,       setBuscaMed]       = useState('');
  const [dropdownMedAberto, setDropdownMedAberto] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);


  // ── Busca medicamento selecionado ─────────────────────────────────────────

  const medSelecionado    = medicamentos.find((m) => m.id === form.medicamentoId) ?? null;
  const estoqueExistente  = !editandoId && form.medicamentoId
    ? itens.find((i) => i.medicamentoId === form.medicamentoId && i.ativo) ?? null
    : null;

  const hoje = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Validade vencida (anterior a hoje) no campo editável — feedback imediato na entrada.
  // Item já movimentado tem a validade travada, então não sinaliza como erro.
  const validadeVencida = !!form.validade && form.validade < hoje && !(editandoId && editandoEmUso);

  const formatarValor = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat(navigator.language || 'pt-BR', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(v);

  const handleValorChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cents  = parseInt(digits || '0', 10);
    const value  = cents / 100;
    const formatted = value === 0 ? '' : formatarValor(value);
    setForm((f) => ({
      ...f,
      valor: value,
      ...(!repassadoEditado && { valorRepassado: value }),
    }));
    setValorStr(formatted);
    if (!repassadoEditado) setValorRepassadoStr(formatted);
  };

  const handleValorRepassadoChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cents  = parseInt(digits || '0', 10);
    const value  = cents / 100;
    setRepassadoEditado(true);
    setForm((f) => ({ ...f, valorRepassado: value }));
    setValorRepassadoStr(value === 0 ? '' : formatarValor(value));
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

      const [estoqueRes, medRes, fornRes] = await Promise.all([
        api.get('/farmacia/estoque', { params }),
        api.get('/medicamentos', { params: { ativo: 'true', excluirVacinas: 'true', especieDaEmpresa: 'true', limit: '5000' } }),
        api.get('/cadastro/fornecedores', { params: { ativo: 'true' } }),
      ]);

      setItens(estoqueRes.data.dados ?? []);
      setMeta(estoqueRes.data.meta ?? { total:0, totalControlados:0, totalAbaixoMinimo:0, totalAbaixoAlarmante:0 });
      setMedicamentos(medRes.data.dados ?? []);
      setFornecedores(
        (fornRes.data?.dados ?? []).filter((f: FornecedorItem) => fornecedorDeFarmacia(f.tipoServico))
      );
    } catch { setErroInline('Erro ao carregar estoque.'); }
    finally { setLoading(false); }
  }, [busca, filtroTab]);

  useEffect(() => { if (!loadingPerm) carregarEstoque(); }, [carregarEstoque, loadingPerm]);

  // Recarrega só a lista de fornecedores da farmácia (após cadastrar um novo pelo seletor).
  const recarregarFornecedores = useCallback(async (): Promise<FornecedorItem[]> => {
    try {
      const res = await api.get('/cadastro/fornecedores', { params: { ativo: 'true' } });
      const lista = ((res.data?.dados ?? []) as FornecedorItem[]).filter(f => fornecedorDeFarmacia(f.tipoServico));
      setFornecedores(lista);
      return lista;
    } catch { return []; }
  }, []);

  const handleFornecedorCriado = async (novo: NovoFornecedorResult) => {
    setShowNovoForn(false);
    const lista = await recarregarFornecedores();
    // Se o novo fornecedor não passar no filtro de tipos da farmácia, adiciona mesmo assim
    // para ficar selecionável neste contexto.
    if (!lista.some(f => f.id === novo.id)) {
      setFornecedores(prev => [{ id: novo.id, nome: novo.nome, tipoServico: '' }, ...prev]);
    }
    setForm(f => ({ ...f, fornecedorId: novo.id }));
  };

  useEffect(() => {
    // Só reseta a calculadora na CRIAÇÃO (troca de medicamento no combobox).
    // Na edição, preencherEdicao já populou frascos/peso com o que foi cadastrado
    // — este efeito dispara logo em seguida e não pode apagar os valores.
    if (editandoId) return;
    setFrascos('');
    const med = medicamentos.find(m => m.id === form.medicamentoId) ?? null;
    setPesoPorEmbalagem(med ? (extrairVolume(med) ?? '') : '');
  }, [form.medicamentoId, medicamentos, editandoId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownMedAberto(false);
        setBuscaMed('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const medsFiltrados = buscaMed.trim().length === 0
    ? medicamentos
    : medicamentos.filter((m) =>
        m.nome.toLowerCase().includes(buscaMed.toLowerCase()) ||
        m.formaFarmaceutica.toLowerCase().includes(buscaMed.toLowerCase())
      );

  // ── Filtro local ──────────────────────────────────────────────────────────

  const itensFiltrados = (() => {
    if (filtroTab === 'critico')   return itens.filter((i) => i.qtdEstoque <= i.estoqueMinimo);
    if (filtroTab === 'alarmante') return itens.filter((i) => i.qtdEstoque <= i.estoqueAlarmante && i.qtdEstoque > i.estoqueMinimo);
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

  // Remove zeros à direita de floats: 3.60 → 3.6, 3.00 → 3, 0.50 → 0.5
  const fmtQtd = (n: number) =>
    parseFloat(n.toFixed(3)).toString().replace('.', ',');

  // Para kg → g; para L/l → ml; demais unidades sem conversão
  const subUnidade = (u: string) => {
    const un = u.toLowerCase();
    if (un === 'kg') return 'g';
    if (un === 'l')  return 'ml';
    return u;
  };
  const fatorSubUnidade = (u: string) => {
    const un = u.toLowerCase();
    return (un === 'kg' || un === 'l') ? 1000 : 1;
  };

  const formatValidade = (v: string | null) => {
    if (!v) return '—';
    const [year, month, day] = v.split('T')[0].split('-').map(Number);
    const d    = new Date(year, month - 1, day);
    const agora = new Date(); agora.setHours(0, 0, 0, 0);
    const diff  = (d.getTime() - agora.getTime()) / (1000 * 60 * 60 * 24);
    const label = formatDate(v);
    if (diff < 0)   return <span className="text-red-600 font-semibold">{label} ⚠</span>;
    if (diff < 30)  return <span className="text-amber-600 font-semibold">{label}</span>;
    return <span>{label}</span>;
  };

  // ── Form handlers ─────────────────────────────────────────────────────────

  const preencherEdicao = (item: EstoqueItem) => {
    // Mínimo/alarmante são armazenados na unidade maior do catálogo (L, kg...);
    // o formulário exibe/edita na subunidade (mL, g...) — converte na ida e na volta
    const medDoItem = medicamentos.find(m => m.id === item.medicamentoId) ?? null;
    const fator     = fatorSubUnidade(medDoItem?.unidade ?? '');
    setForm({
      medicamentoId:    item.medicamentoId,
      valor:            item.valor,
      lote:             item.lote ?? '',
      validade:         item.validade ? item.validade.split('T')[0] : '',
      qtdEstoque:       item.qtdEstoque,
      estoqueMinimo:    item.estoqueMinimo * fator,
      estoqueAlarmante: item.estoqueAlarmante * fator,
      ativo:            item.ativo,
      valorRepassado:   item.valorRepassado ?? 0,
      fornecedorId:     item.fornecedorId ?? 0,
      notaFiscal:       item.notaFiscal ?? '',
    });
    setValorStr(formatarValor(item.valor));
    setValorRepassadoStr(formatarValor(item.valorRepassado ?? 0));
    setRepassadoEditado(item.valorRepassado !== item.valor);
    setEditandoId(item.id);
    // Medicamento ainda não movimentado → embalagens/peso podem ser corrigidos na edição
    setEditandoEmUso(!!item.emUso);
    // Pré-preenche a calculadora com o que foi informado na entrada
    setFrascos(item.qtdEmbalagens ?? '');
    setPesoPorEmbalagem(item.pesoPorEmbalagem ?? '');
    setModalFormAberto(true);
  };

  const limparForm = () => {
    setForm({ ...FORM_VAZIO });
    setValorStr('');
    setValorRepassadoStr('');
    setRepassadoEditado(false);
    setEditandoId(null);
    setEditandoEmUso(false);
    setModalFormAberto(false);
    setFrascos('');
    setPesoPorEmbalagem('');
    setBuscaMed('');
    setDropdownMedAberto(false);
  };

  const salvar = async () => {
    setErroAcao(null);
    if (editandoId && !podeEditar) { semPermissao('editar estoque'); return; }
    if (!editandoId && !podeCriar) { semPermissao('criar entrada de estoque'); return; }
    if (!form.medicamentoId) return setErroAcao({ mensagem: 'Selecione um medicamento do catálogo.', campos: ['medicamentoId'] });
    if (!form.lote.trim())   return setErroAcao({ mensagem: 'Lote é obrigatório.', campos: ['lote'] });
    if (!form.validade)      return setErroAcao({ mensagem: 'Validade é obrigatória.', campos: ['validade'] });
    // Não permite validade vencida (anterior a hoje) sempre que o campo for editável —
    // na criação e na edição de item ainda não movimentado (item em uso tem a validade travada).
    if (validadeVencida) {
      return setErroAcao({ mensagem: 'Validade vencida: informe uma data igual ou posterior a hoje.', campos: ['validade'] });
    }

    if (form.estoqueMinimo < 0 || form.estoqueAlarmante < 0) return setErroAcao({ mensagem: 'Quantidades não podem ser negativas.', campos: ['estoqueMinimo','estoqueAlarmante'] });
    if (!editandoId && form.qtdEstoque < 0) return setErroAcao({ mensagem: 'Estoque não pode ser negativo.', campos: ['qtdEstoque'] });
    if (!form.valor || form.valor <= 0) return setErroInline('Valor é obrigatório.');

    // Na criação, valor e valorRepassado são por embalagem — multiplicar pelo nº de embalagens
    // para que o banco armazene o valor TOTAL da entrada (base do cálculo de custo por unidade).
    const nPacotes = !editandoId && frascos !== '' && Number(frascos) > 0 ? Number(frascos) : 1;

    setSalvando(true);
    try {
      const payload = {
        medicamentoId:    form.medicamentoId,
        valor:            form.valor * nPacotes,
        valorRepassado:   form.valorRepassado * nPacotes,
        lote:             form.lote || null,
        validade:         form.validade || null,
        // Formulário trabalha na subunidade — converte para a unidade maior ao salvar
        estoqueMinimo:    form.estoqueMinimo / fatorSubUnidade(medSelecionado?.unidade ?? ''),
        estoqueAlarmante: form.estoqueAlarmante / fatorSubUnidade(medSelecionado?.unidade ?? ''),
        ativo:            form.ativo,
        fornecedorId:     form.fornecedorId || null,
        notaFiscal:       form.notaFiscal.trim() || null,
        // Criação: sempre envia. Edição: só quando o item ainda não foi movimentado
        // e o usuário reinformou as embalagens (recalcula o total)
        ...((!editandoId || (!editandoEmUso && frascos !== '')) && { qtdEstoque: form.qtdEstoque }),
        // Persiste a calculadora de embalagens (pré-preenchimento na edição)
        ...((!editandoId || !editandoEmUso) && {
          qtdEmbalagens:    frascos          !== '' ? Number(frascos)          : null,
          pesoPorEmbalagem: pesoPorEmbalagem !== '' ? Number(pesoPorEmbalagem) : null,
        }),
      };

      if (editandoId) {
        await api.put(`/farmacia/estoque/${editandoId}`, payload);
        toast.success('Estoque atualizado.');
      } else {
        const res = await api.post('/farmacia/estoque', { ...payload, qtdEstoque: form.qtdEstoque });
        toast.success(res.data?.consolidado
          ? (res.data?.mensagem ?? 'Quantidade somada ao estoque existente.')
          : 'Entrada de estoque registrada.');
      }
      limparForm();
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao salvar.');
    } finally { setSalvando(false); }
  };

  const confirmarExcluir = async (motivo: string) => {
    if (!confirmExcluir) return;
    if (!podeDeletar) { semPermissao('inativar item do estoque'); return; }
    try {
      await api.delete(`/farmacia/estoque/${confirmExcluir.id}`, { data: { motivo } });
      toast.success('Item inativado.');
      setConfirmExcluir(null);
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao inativar.');
    }
  };



  // Item selecionado no modal de ajuste (resolvido a partir da lista carregada)
  const itemAjuste = ajusteItemId != null ? (itens.find((i) => i.id === ajusteItemId) ?? null) : null;

  // ml (ou unidade base) por frasco/embalagem — 0 quando o item não tem embalagem.
  const arred2 = (n: number) => Math.round(n * 100) / 100;
  const mlPorFrasco = itemAjuste?.pesoPorEmbalagem && itemAjuste.pesoPorEmbalagem > 0 ? itemAjuste.pesoPorEmbalagem : 0;
  const frascosDe = (ml: number): number | '' => (mlPorFrasco > 0 ? arred2(ml / mlPorFrasco) : '');

  const abrirAjuste = (item?: EstoqueItem) => {
    if (!podeAjustar) { semPermissao('ajustar estoque'); return; }
    setAjusteItemId(item?.id ?? null);
    setAjusteQtd(item ? item.qtdEstoque : '');
    const mpf = item?.pesoPorEmbalagem && item.pesoPorEmbalagem > 0 ? item.pesoPorEmbalagem : 0;
    setAjusteFrascos(item && mpf > 0 ? arred2(item.qtdEstoque / mpf) : '');
    setAjusteMotivo('');
    setBuscaAjuste('');
    setDropdownAjusteAberto(false);
    setModalAjusteAberto(true);
  };

  const fecharAjuste = () => {
    setModalAjusteAberto(false);
    setAjusteItemId(null);
  };

  const confirmarAjuste = async () => {
    if (!podeAjustar) { semPermissao('ajustar estoque'); return; }
    if (!itemAjuste)             return setErroInline('Selecione um medicamento do estoque.');
    if (ajusteQtd === '')        return setErroInline('Informe a quantidade em estoque.');
    const qtd = Number(ajusteQtd);
    if (qtd < 0)                 return setErroInline('Quantidade não pode ser negativa.');
    if (!ajusteMotivo.trim())    return setErroInline('Informe o motivo do ajuste.');
    const delta = qtd - itemAjuste.qtdEstoque;
    if (delta === 0)             return setErroInline('A quantidade informada é igual ao estoque atual.');

    setAjustando(true);
    try {
      await api.patch(`/farmacia/estoque/${itemAjuste.id}/ajuste`, {
        tipo: 'AJUSTE',
        quantidade: delta,
        motivo: ajusteMotivo.trim(),
      });
      toast.success('Estoque ajustado.');
      fecharAjuste();
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao ajustar estoque.');
    } finally { setAjustando(false); }
  };

  const abrirHistorico = async (item: EstoqueItem) => {
    setModalHistorico(item);
    setLoadingMov(true);
    try {
      const res = await api.get(`/farmacia/estoque/movimentos/${item.id}`);
      setMovimentos(res.data.dados ?? []);
    } catch { setErroInline('Erro ao carregar histórico.'); }
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
      <InlineError message={erroInline} className="mb-4" />

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
            { label:'Itens Ativos',    value:meta.total,               color:'text-gray-900',   bg:'bg-white' },
            { label:'Estoque Crítico', value:meta.totalAbaixoMinimo,   color:'text-red-600',    bg:meta.totalAbaixoMinimo>0?'bg-red-50':'bg-white',   icon:<AlertTriangle size={12} className="text-red-500" /> },
            { label:'Alerta Amarelo',  value:meta.totalAbaixoAlarmante, color:'text-amber-600',  bg:meta.totalAbaixoAlarmante>0?'bg-amber-50':'bg-white', icon:<AlertTriangle size={12} className="text-amber-500" /> },
            { label:'Controlados',     value:meta.totalControlados,    color:'text-purple-700', bg:'bg-white', icon:<Lock size={12} className="text-purple-500" /> },
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
              {podeAjustar && (
                <button onClick={() => abrirAjuste()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-xs font-semibold rounded-xl transition-colors">
                  <ArrowUpDown size={13} />
                  Ajuste de Estoque
                </button>
              )}
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
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Medicamento</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Estoque</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {itensFiltrados.map((item) => {
                      const nivel = nivelEstoque(item);
                      const qtdCls = nivel === 'critico' ? 'bg-red-100 text-red-700'
                        : nivel === 'alarmante' ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700';
                      return (
                        <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <button onClick={() => abrirHistorico(item)}
                              className="font-semibold text-emerald-700 hover:text-emerald-900 hover:underline text-sm flex items-center gap-1">
                              <BarChart2 size={12} className="text-emerald-500 flex-shrink-0" />
                              {item.medicamento.nome}
                              {item.medicamento.controlado && <Lock size={10} className="text-purple-600 flex-shrink-0" />}
                            </button>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {item.medicamento.formaFarmaceutica} · {item.medicamento.apresentacao}
                              {item.lote && ` · Lote ${item.lote}`}
                              {item.fornecedor && ` · ${item.fornecedor.nome}`}
                              {item.validade && <span className="ml-1">· {formatValidade(item.validade)}</span>}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${qtdCls}`}>
                              {nivel !== 'ok' && <AlertTriangle size={10} className={nivel === 'critico' ? 'text-red-500' : 'text-amber-500'} />}
                              {fmtQtd(item.qtdEstoque)} {item.medicamento.unidade}
                            </span>
                            <p className="text-[10px] text-gray-400 mt-0.5">mín {fmtQtd(item.estoqueMinimo)}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${item.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {item.ativo ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              {item.emUso ? (
                                <button onClick={() => setItemView(item)} title="Visualizar (já utilizado — não pode ser alterado)"
                                  className="p-1.5 rounded-lg border border-emerald-200 text-emerald-500 hover:bg-emerald-50">
                                  <Eye size={13} />
                                </button>
                              ) : podeEditar ? (
                                <button onClick={() => preencherEdicao(item)} title="Editar"
                                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50">
                                  <Pencil size={13} />
                                </button>
                              ) : null}
                              <button onClick={() => setConfirmExcluir(item)} title="Inativar"
                                className="p-1.5 rounded-lg border border-red-200 text-red-400 hover:bg-red-50">
                                <Trash2 size={13} />
                              </button>
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
                {itensFiltrados.map((item) => {
                  const nivel = nivelEstoque(item);
                  const qtdCls = nivel === 'critico' ? 'bg-red-100 text-red-700'
                    : nivel === 'alarmante' ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-50 text-emerald-700';
                  return (
                    <div key={item.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <button onClick={() => abrirHistorico(item)}
                          className="font-semibold text-emerald-700 hover:underline text-sm flex items-center gap-1 min-w-0">
                          <BarChart2 size={12} className="text-emerald-500 flex-shrink-0" />
                          <span className="truncate">{item.medicamento.nome}</span>
                          {item.medicamento.controlado && <Lock size={10} className="text-purple-600 flex-shrink-0" />}
                        </button>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${qtdCls}`}>
                          {nivel !== 'ok' && <AlertTriangle size={10} className={nivel === 'critico' ? 'text-red-500' : 'text-amber-500'} />}
                          {fmtQtd(item.qtdEstoque)} {item.medicamento.unidade}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        {item.medicamento.formaFarmaceutica} · {item.medicamento.apresentacao}
                        {item.lote && ` · Lote ${item.lote}`}
                        {' · '}{item.ativo ? 'Ativo' : 'Inativo'}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.emUso ? (
                          <button onClick={() => setItemView(item)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                            <Eye size={11} /> Ver
                          </button>
                        ) : podeEditar ? (
                          <button onClick={() => preencherEdicao(item)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                            <Pencil size={11} /> Editar
                          </button>
                        ) : null}
                        <button onClick={() => setConfirmExcluir(item)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                          <Trash2 size={11} /> Inativar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modal: formulário de estoque ──────────────────────────────────── */}
      {modalFormAberto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={limparForm} />
          <div className="fixed inset-x-4 top-[4vh] z-50 bg-white rounded-2xl shadow-2xl max-w-lg mx-auto flex flex-col max-h-[92vh] overflow-hidden">
            <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <p className="font-bold text-sm text-white">{editandoId ? 'Editar Estoque' : 'Entrada de Estoque'}</p>
              <button onClick={limparForm} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">

              {/* Seletor de Medicamento */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Medicamento <span className="text-red-500">*</span>
                </label>
                <div className="relative" ref={comboboxRef}>
                  {!dropdownMedAberto ? (
                    /* Botão — aparece quando NÃO está buscando */
                    <button
                      type="button"
                      disabled={!!editandoId}
                      onClick={() => { if (!editandoId) { setDropdownMedAberto(true); setBuscaMed(''); } }}
                      className="w-full flex items-center justify-between border border-gray-300 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:cursor-not-allowed bg-white">
                      <span className={medSelecionado ? 'text-gray-900 truncate' : 'text-gray-400'}>
                        {medSelecionado ? medSelecionado.nome : 'Selecione o medicamento...'}
                      </span>
                      {medSelecionado && !editandoId ? (
                        <X size={14} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                          onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, medicamentoId: 0 })); }} />
                      ) : (
                        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                      )}
                    </button>
                  ) : (
                    /* Campo de busca — substitui o botão ao clicar (nunca os dois juntos) */
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Buscar medicamento..."
                        value={buscaMed}
                        onChange={(e) => setBuscaMed(e.target.value)}
                        onBlur={() => setTimeout(() => { setDropdownMedAberto(false); setBuscaMed(''); }, 150)}
                        className="w-full pl-8 pr-3 border border-gray-300 rounded-xl py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <ul className="max-h-44 overflow-y-auto">
                          {medsFiltrados.length === 0 ? (
                            <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhum medicamento encontrado.</li>
                          ) : (
                            medsFiltrados.map((m) => (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  onMouseDown={() => {
                                    setForm((f) => ({ ...f, medicamentoId: m.id }));
                                    setDropdownMedAberto(false);
                                    setBuscaMed('');
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors ${
                                    form.medicamentoId === m.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-800'
                                  }`}>
                                  <span className="block truncate">{m.nome}</span>
                                  {m.formaFarmaceutica && (
                                    <span className="text-[11px] text-gray-400">{m.formaFarmaceutica}</span>
                                  )}
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Campos auto-preenchidos do catálogo */}
              {medSelecionado && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-indigo-700 text-[11px] uppercase tracking-wider mb-1">Do Catálogo</p>
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
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-gray-700">
                  <p>Estoque atual: <span className="font-bold">{fmtQtd(estoqueExistente.qtdEstoque)} {estoqueExistente.medicamento.unidade}</span></p>
                  <p className="mt-1 text-gray-500">Se lote, validade e valor forem iguais à entrada existente, as quantidades serão somadas. Caso contrário, uma nova entrada será criada.</p>
                </div>
              )}

              {/* Fornecedor + Nota Fiscal */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Fornecedor</label>
                  <select
                    value={form.fornecedorId}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val === NOVO_FORNECEDOR) { setShowNovoForn(true); return; }
                      setForm((f) => ({ ...f, fornecedorId: val }));
                    }}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-gray-900">
                    <option value={0}>Selecione o fornecedor...</option>
                    {fornecedores.map((f) => (
                      <option key={f.id} value={f.id}>{f.nome}</option>
                    ))}
                    <option value={NOVO_FORNECEDOR}>+ Cadastrar novo fornecedor...</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Nota Fiscal</label>
                  <input
                    type="text"
                    value={form.notaFiscal}
                    onChange={(e) => setForm((f) => ({ ...f, notaFiscal: e.target.value }))}
                    placeholder="Nº da NF"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Valor Comprado + Valor Repassado + Lote + Validade */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {editandoId ? 'Valor Total Comprado (R$)' : 'Val por Embalagem (R$)'} <span className="text-red-500">*</span>
                  </label>
                  <input type="text" inputMode="decimal" value={valorStr}
                    onChange={(e) => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  {!editandoId && frascos !== '' && Number(frascos) > 1 && form.valor > 0 && (
                    <p className="text-[10px] text-emerald-700 mt-0.5 font-semibold">
                      Total: R$ {formatarValor(form.valor * Number(frascos))}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    {editandoId ? 'Valor Total Repassado (R$)' : 'Val Repassado por Embalagem (R$)'}
                  </label>
                  <input type="text" inputMode="decimal" value={valorRepassadoStr}
                    onChange={(e) => handleValorRepassadoChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  {!editandoId && frascos !== '' && Number(frascos) > 1 && form.valorRepassado > 0 && (
                    <p className="text-[10px] text-emerald-700 mt-0.5 font-semibold">
                      Total: R$ {formatarValor(form.valorRepassado * Number(frascos))}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Lote <span className="text-red-500">*</span></label>
                  <input type="text" value={form.lote}
                    disabled={!!editandoId && editandoEmUso}
                    title={editandoId && editandoEmUso ? 'Item já movimentado — lote não pode ser alterado' : undefined}
                    onChange={(e) => setForm((f) => ({ ...f, lote: e.target.value }))}
                    placeholder="Ex: LOT2024"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Validade <span className="text-red-500">*</span></label>
                  <DateInput
                    value={form.validade}
                    min={editandoId && editandoEmUso ? undefined : hoje}
                    disabled={!!editandoId && editandoEmUso}
                    onChange={(v) => setForm((f) => ({ ...f, validade: v }))}
                    className={`w-full border rounded-xl px-3 py-2 text-sm text-gray-900 focus-within:ring-2 ${
                      editandoId && editandoEmUso ? 'bg-gray-100 text-gray-400' : ''
                    } ${
                      validadeVencida ? 'border-red-400 focus-within:ring-red-400' : 'border-gray-300 focus-within:ring-emerald-500'
                    }`}
                  />
                  {validadeVencida && (
                    <p className="text-[11px] text-red-500 mt-1">Validade vencida — informe uma data igual ou posterior a hoje.</p>
                  )}
                </div>
              </div>

              {/* Calculadora de Embalagens */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Nº de Embalagens <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" min={0}
                    disabled={!!editandoId && editandoEmUso}
                    value={frascos === '' ? '' : frascos}
                    onChange={e => {
                      const n = e.target.value === '' ? '' : Number(e.target.value);
                      setFrascos(n);
                      const p = pesoPorEmbalagem !== '' ? Number(pesoPorEmbalagem) : 0;
                      const total = n !== '' && Number(n) > 0
                        ? (p > 0 ? Number(n) * p : Number(n))
                        : 0;
                      setForm(f => ({ ...f, qtdEstoque: total }));
                    }}
                    placeholder="Qtd de embalagens"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  {editandoId && editandoEmUso && <p className="text-[10px] text-gray-400 mt-1">Use "Ajuste de Estoque" para alterar.</p>}
                  {editandoId && !editandoEmUso && <p className="text-[10px] text-emerald-600 mt-1">Medicamento ainda não utilizado — edição liberada.</p>}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Peso/Vol por Embalagem{medSelecionado && <span className="text-gray-400 font-normal ml-1">({medSelecionado.unidade})</span>}
                  </label>
                  <input
                    type="number" min={0}
                    disabled={!!editandoId && editandoEmUso}
                    value={pesoPorEmbalagem === '' ? '' : pesoPorEmbalagem}
                    onChange={e => {
                      const p = e.target.value === '' ? '' : Number(e.target.value);
                      setPesoPorEmbalagem(p);
                      const n = frascos !== '' ? Number(frascos) : 0;
                      const total = n > 0 && p !== '' && Number(p) > 0
                        ? n * Number(p)
                        : n;
                      setForm(f => ({ ...f, qtdEstoque: total }));
                    }}
                    placeholder="Ex: 3,6"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
              </div>

              {/* Total computado */}
              {Number(frascos) > 0 && (
                <p className="text-xs text-gray-500 -mt-1">
                  Total em estoque:{' '}
                  <b className="text-emerald-700">
                    {fmtQtd(
                      pesoPorEmbalagem !== '' && Number(pesoPorEmbalagem) > 0
                        ? Number(frascos) * Number(pesoPorEmbalagem)
                        : Number(frascos)
                    )} {medSelecionado?.unidade ?? ''}
                  </b>
                </p>
              )}

              {/* Mínimo + Alarmante — editáveis também na edição */}
              {(
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                      Mínimo <span className="text-gray-400 font-normal">({subUnidade(medSelecionado?.unidade ?? 'un')})</span>
                    </label>
                    <input type="number" min={0} value={form.estoqueMinimo === 0 ? '' : form.estoqueMinimo}
                      onChange={(e) => setForm((f) => ({ ...f, estoqueMinimo: e.target.value === '' ? 0 : Number(e.target.value) }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                      Alarmante <span className="text-gray-400 font-normal">({subUnidade(medSelecionado?.unidade ?? 'un')})</span>
                    </label>
                    <input type="number" min={0} value={form.estoqueAlarmante === 0 ? '' : form.estoqueAlarmante}
                      onChange={(e) => setForm((f) => ({ ...f, estoqueAlarmante: e.target.value === '' ? 0 : Number(e.target.value) }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
              )}

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

              <ErroAcao erro={erroAcao} className="mb-2" />
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


      {/* ── Modal: visualização de item em uso (read-only) ──────────────── */}
      {itemView && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[88vh] overflow-hidden">
            <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Eye size={15} className="text-white/80" />
                <p className="font-bold text-sm text-white">Visualizar Item de Estoque</p>
              </div>
              <button onClick={() => setItemView(null)} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-800">
                <span className="font-semibold">Item em uso</span> — alterações não são permitidas enquanto houver saídas registradas.
                Para corrigir a quantidade, use o Ajuste de Estoque.
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Medicamento</p>
                  <p className="font-semibold text-gray-800">{itemView.medicamento.nome}</p>
                  <p className="text-xs text-gray-500">{itemView.medicamento.formaFarmaceutica} · {itemView.medicamento.apresentacao}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Qtd em Estoque</p>
                  <p className="font-bold text-emerald-700">{fmtQtd(itemView.qtdEstoque)} {itemView.medicamento.unidade}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Status</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${itemView.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {itemView.ativo ? 'ATIVO' : 'INATIVO'}
                  </span>
                </div>
                {itemView.lote && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Lote</p>
                    <p className="text-gray-700">{itemView.lote}</p>
                  </div>
                )}
                {itemView.validade && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Validade</p>
                    <div>{formatValidade(itemView.validade)}</div>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Valor Comprado</p>
                  <p className="text-gray-700">R$ {itemView.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Valor Repassado</p>
                  <p className="text-gray-700">R$ {itemView.valorRepassado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                </div>
                {itemView.notaFiscal && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Nota Fiscal</p>
                    <p className="text-gray-700">{itemView.notaFiscal}</p>
                  </div>
                )}
                {itemView.fornecedor && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Fornecedor</p>
                    <p className="text-gray-700">{itemView.fornecedor.nome}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Est. Mínimo</p>
                  <p className="text-gray-700">{fmtQtd(itemView.estoqueMinimo)} {itemView.medicamento.unidade}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Est. Alarmante</p>
                  <p className="text-gray-700">{fmtQtd(itemView.estoqueAlarmante)} {itemView.medicamento.unidade}</p>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2 flex-shrink-0">
              {podeAjustar && itemView.ativo && (
                <button onClick={() => { const item = itemView; setItemView(null); abrirAjuste(item); }}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                  <ArrowUpDown size={14} /> Ajuste de Estoque
                </button>
              )}
              <button onClick={() => setItemView(null)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
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
              <>
                <ChartMovimentos movimentos={movimentos} />
                {(() => {
                  const entradas = movimentos.filter(m => m.tipo === 'ENTRADA' && m.motivo?.startsWith('NF:'));
                  if (entradas.length === 0) return null;
                  return (
                    <div className="mt-4 border border-emerald-100 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Entradas por Nota Fiscal</p>
                      <ul className="space-y-1.5">
                        {entradas.map(e => (
                          <li key={e.id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-700">{e.motivo}</span>
                            <span className="font-semibold text-emerald-700 ml-4 whitespace-nowrap">
                              +{fmtQtd(e.quantidade)} {modalHistorico?.medicamento.unidade}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}
              </>
            )}
            <button onClick={() => setModalHistorico(null)}
              className="w-full mt-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50">
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Ajuste de Estoque ─────────────────────────────────────── */}
      {modalAjusteAberto && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={fecharAjuste} />
          <div className="fixed inset-x-4 top-[4vh] z-50 bg-white rounded-2xl shadow-2xl max-w-lg mx-auto flex flex-col max-h-[92vh] overflow-hidden">
            <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <ArrowUpDown size={15} className="text-white/80" />
                <p className="font-bold text-sm text-white">Ajuste de Estoque</p>
              </div>
              <button onClick={fecharAjuste} className="text-white/60 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-3 flex-1 overflow-y-auto">

              {/* Seletor de Medicamento — mesmo padrão da Entrada de Estoque */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Medicamento <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  {!dropdownAjusteAberto ? (
                    <button
                      type="button"
                      onClick={() => { setDropdownAjusteAberto(true); setBuscaAjuste(''); }}
                      className="w-full flex items-center justify-between border border-gray-300 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                      <span className={itemAjuste ? 'text-gray-900 truncate' : 'text-gray-400'}>
                        {itemAjuste
                          ? `${itemAjuste.medicamento.nome}${itemAjuste.lote ? ` · Lote ${itemAjuste.lote}` : ''}`
                          : 'Selecione o medicamento...'}
                      </span>
                      {itemAjuste ? (
                        <X size={14} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); setAjusteItemId(null); setAjusteQtd(''); setAjusteFrascos(''); }} />
                      ) : (
                        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
                      )}
                    </button>
                  ) : (
                    <div className="relative">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Buscar medicamento no estoque..."
                        value={buscaAjuste}
                        onChange={(e) => setBuscaAjuste(e.target.value)}
                        onBlur={() => setTimeout(() => { setDropdownAjusteAberto(false); setBuscaAjuste(''); }, 150)}
                        className="w-full pl-8 pr-3 border border-gray-300 rounded-xl py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
                        <ul className="max-h-44 overflow-y-auto">
                          {(() => {
                            const disponiveis = itens.filter((i) => i.ativo);
                            const filtrados = buscaAjuste.trim() === '' ? disponiveis : disponiveis.filter((i) =>
                              i.medicamento.nome.toLowerCase().includes(buscaAjuste.toLowerCase()) ||
                              i.medicamento.formaFarmaceutica.toLowerCase().includes(buscaAjuste.toLowerCase()) ||
                              (i.lote ?? '').toLowerCase().includes(buscaAjuste.toLowerCase())
                            );
                            return filtrados.length === 0 ? (
                              <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhum item de estoque encontrado.</li>
                            ) : (
                              filtrados.map((i) => (
                                <li key={i.id}>
                                  <button
                                    type="button"
                                    onMouseDown={() => {
                                      setAjusteItemId(i.id);
                                      setAjusteQtd(i.qtdEstoque);
                                      const mpf = i.pesoPorEmbalagem && i.pesoPorEmbalagem > 0 ? i.pesoPorEmbalagem : 0;
                                      setAjusteFrascos(mpf > 0 ? Math.round((i.qtdEstoque / mpf) * 100) / 100 : '');
                                      setDropdownAjusteAberto(false);
                                      setBuscaAjuste('');
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 transition-colors ${
                                      ajusteItemId === i.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-800'
                                    }`}>
                                    <span className="block truncate">{i.medicamento.nome}</span>
                                    <span className="text-[11px] text-gray-400">
                                      {fmtQtd(i.qtdEstoque)} {i.medicamento.unidade}
                                      {i.lote && ` · Lote ${i.lote}`}
                                      {i.medicamento.formaFarmaceutica && ` · ${i.medicamento.formaFarmaceutica}`}
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

              {/* Dados do item selecionado — mesmo padrão do bloco "Do Catálogo" */}
              {itemAjuste && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-2.5 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-indigo-700 text-[11px] uppercase tracking-wider mb-1">Item Selecionado</p>
                  <div className="grid grid-cols-2 gap-1">
                    <p><span className="text-gray-400">Estoque atual:</span>{' '}
                      <b className="text-emerald-700">{fmtQtd(itemAjuste.qtdEstoque)} {itemAjuste.medicamento.unidade}</b></p>
                    {mlPorFrasco > 0 && (
                      <p><span className="text-gray-400">Frascos:</span>{' '}
                        <b className="text-emerald-700">{fmtQtd(frascosDe(itemAjuste.qtdEstoque) || 0)}</b>
                        <span className="text-gray-400"> ({fmtQtd(mlPorFrasco)} {itemAjuste.medicamento.unidade}/frasco)</span></p>
                    )}
                    <p><span className="text-gray-400">Lote:</span> {itemAjuste.lote ?? '—'}</p>
                    <p><span className="text-gray-400">Forma:</span> {itemAjuste.medicamento.formaFarmaceutica}</p>
                    <p><span className="text-gray-400">Validade:</span> {itemAjuste.validade ? formatDate(itemAjuste.validade) : '—'}</p>
                  </div>
                </div>
              )}

              {/* Quantidade final em estoque — pré-preenchida com a atual.
                  Frascos e ml ficam sincronizados (ml = frascos × ml/frasco). */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Quantidade em Estoque <span className="text-red-500">*</span>
                </label>
                <div className={mlPorFrasco > 0 ? 'grid grid-cols-2 gap-2' : ''}>
                  {mlPorFrasco > 0 && (
                    <div>
                      <span className="block text-[10px] text-gray-400 mb-0.5">Frascos</span>
                      <input type="number" min={0} step="any" value={ajusteFrascos === '' ? '' : ajusteFrascos}
                        onChange={(e) => {
                          if (e.target.value === '') { setAjusteFrascos(''); setAjusteQtd(''); return; }
                          const f = Number(e.target.value);
                          setAjusteFrascos(f);
                          setAjusteQtd(arred2(f * mlPorFrasco));
                        }}
                        placeholder="0"
                        className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  )}
                  <div>
                    {mlPorFrasco > 0 && (
                      <span className="block text-[10px] text-gray-400 mb-0.5">
                        {itemAjuste?.medicamento.unidade ?? 'Total'}
                      </span>
                    )}
                    <input type="number" min={0} step="0.01" value={ajusteQtd === '' ? '' : ajusteQtd}
                      onChange={(e) => {
                        if (e.target.value === '') { setAjusteQtd(''); setAjusteFrascos(''); return; }
                        // Máximo de 2 casas decimais (00.00)
                        const v = arred2(Number(e.target.value));
                        setAjusteQtd(v);
                        setAjusteFrascos(frascosDe(v));
                      }}
                      placeholder={mlPorFrasco > 0 ? `Total (${itemAjuste?.medicamento.unidade ?? ''})` : '0'}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
                {itemAjuste && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Informe a quantidade real em estoque{mlPorFrasco > 0 ? ' (frascos ou ' + itemAjuste.medicamento.unidade + ')' : ''} — a diferença será registrada como ajuste.
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
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>

              {/* Preview da diferença */}
              {itemAjuste && ajusteQtd !== '' && (() => {
                const novaQtd = Number(ajusteQtd);
                if (novaQtd < 0) return <p className="text-xs text-red-600 font-semibold">Quantidade não pode ser negativa.</p>;
                const delta = novaQtd - itemAjuste.qtdEstoque;
                if (delta === 0) return (
                  <p className="text-xs text-gray-500">Quantidade igual ao estoque atual — nenhum ajuste será registrado.</p>
                );
                return (
                  <p className="text-xs text-gray-600">
                    Diferença a registrar:{' '}
                    <b className={delta > 0 ? 'text-emerald-700' : 'text-red-600'}>
                      {delta > 0 ? '+' : '−'}{fmtQtd(Math.abs(delta))} {itemAjuste.medicamento.unidade}
                    </b>
                    {' '}({fmtQtd(itemAjuste.qtdEstoque)} → {fmtQtd(novaQtd)})
                    {mlPorFrasco > 0 && (
                      <span className="text-gray-400">
                        {' '}· {fmtQtd(frascosDe(itemAjuste.qtdEstoque) || 0)} → {fmtQtd(frascosDe(novaQtd) || 0)} frascos
                      </span>
                    )}
                  </p>
                );
              })()}

              <div className="flex justify-end gap-2">
                <button onClick={fecharAjuste}
                  className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={confirmarAjuste} disabled={ajustando || !itemAjuste}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold disabled:opacity-60">
                  {ajustando ? 'Ajustando...' : 'Confirmar Ajuste'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Modal: confirmar exclusão (justificativa obrigatória) ────────── */}
      <ModalJustificativa
        aberto={!!confirmExcluir}
        titulo="Inativar item do estoque?"
        descricao={confirmExcluir ? `${confirmExcluir.medicamento.nome}${confirmExcluir.lote ? ` · Lote ${confirmExcluir.lote}` : ''}` : undefined}
        acaoLabel="Inativar"
        onConfirmar={confirmarExcluir}
        onFechar={() => setConfirmExcluir(null)}
      />

      {/* ── Modal: cadastrar novo fornecedor pelo seletor da entrada de estoque ── */}
      {showNovoForn && (
        <ModalNovoFornecedor
          onSalvo={handleFornecedorCriado}
          onClose={() => setShowNovoForn(false)}
        />
      )}
    </PageContainer>
  );
}
