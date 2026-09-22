// src/pages/Farmacia.tsx
// Gestão de estoque por clínica — referencia o catálogo global de Medicamentos

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { usePermissoes } from '../hooks/usePermissoes';
import toast from 'react-hot-toast';
// 🔴 LEITURA DO DOCUMENTO DE COMPRA (a pedido, 2026-09-18) — nota fiscal, cupom,
// orçamento de balcão ou recibo viram ENTRADAS DE ESTOQUE já preenchidas. Uma nota
// traz VÁRIOS produtos: eles entram numa FILA e o formulário abre um por vez.
import LeitorDocumentoCompra, { type ItemNota, type NotaLida }
  from '../components/farmacia/LeitorDocumentoCompra';
// Recorte de quem entrega PRODUTO — o mesmo do Estoque de Vacinas (fonte única).
import { fornecedorDeProduto, NOVO_FORNECEDOR } from '../utils/fornecedorProduto';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../components/PageContainer';
import { useOrdenacao, ThOrdenavel, ordenarLista, valorData } from '../components/OrdenacaoLista';
import BotaoVoltar from '../components/BotaoVoltar';
import {
  AlertTriangle, Lock, Plus, Pencil,
  Search, RefreshCw, X, BarChart2, Package,
  ChevronDown, Eye, ArrowUpDown,
  ToggleLeft, ToggleRight, FileText,
} from 'lucide-react';
import { formatDateShort, formatDate } from '../utils/dateUtils';
import { unidadeOperativaProduto } from '../utils/formaCalculo';
import DateInput from '../components/DateInput';
import ModalNovoFornecedor, { type NovoFornecedorResult } from '../components/ModalNovoFornecedor';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import ModalJustificativa from '../components/ModalJustificativa';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import CadastroCatalogoModal, { type ItemCatalogoCriado } from '../components/CadastroCatalogoModal';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Via { id: number; via: string }

interface Medicamento {
  id: number;
  nome: string;
  formaFarmaceutica: string;
  /** Unidade da EMBALAGEM ("Frasco", "Un."). NÃO é em que o conteúdo é medido. */
  unidade: string;
  apresentacao: string;
  controlado: boolean;
  ativo: boolean;
  vias: Via[];
  /** O produto declara conteúdo medido (Forma de Cálculo + Qtd) — ver /cadastro/produtos. */
  multidose?: boolean;
  /** QUANTO a embalagem contém, na `formaCalculo` (frasco de 20 mL → 20). */
  dosesPorEmbalagem?: number | null;
  /** EM QUÊ o conteúdo é medido: mL, L, g, kg, mcg, mg, doses. */
  formaCalculo?: string | null;
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
  createdAt:  string;
  // Trilha de ativação/inativação (quem fez, quando) — ver lib/cadastroAtivacao.js
  ativoEm?:        string | null;
  ativoPorNome?:   string | null;
  inativoEm?:      string | null;
  inativoPorNome?: string | null;
  inativoMotivo?:  string | null;
}

interface Meta { total: number; totalControlados: number; totalAbaixoMinimo: number; totalAbaixoAlarmante: number }

interface MovimentoEstoque { id: number; tipo: string; quantidade: number; motivo: string | null; createdAt: string }

type FiltroTab = 'todos' | 'ativos' | 'inativos' | 'critico' | 'alarmante' | 'controlados';

/** Colunas ordenáveis da lista de estoque (as três últimas variam com a aba). */
type ColunaFarmacia = 'medicamento' | 'qtdProduto' | 'estoque' | 'status' | 'criadoEm' | 'ativadoEm'
                    | 'ativadoPor' | 'inativadoEm' | 'inativadoPor' | 'justificativa';



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

/**
 * 🔴 O CONTEÚDO DA EMBALAGEM VEM DO PRODUTO (2026-09-16), não mais digitado aqui.
 *
 * Antes a clínica informava "Qtd por Embalagem" a cada entrada de estoque, e o número
 * não existia em lugar nenhum fora daquela linha: a prescrição não o conhecia, então
 * uma dose de 5 mL de um frasco de 20 mL debitava 5 UNIDADES (cinco frascos). Agora
 * quem declara é `/cadastro/produtos`, e o estoque só MULTIPLICA.
 *
 * ⚠️ `null` quando o produto não é multidose — e aí a embalagem é a própria unidade,
 * que é o comportamento de sempre. `null` NÃO é 1: é "não declara conteúdo".
 */
function conteudoDaEmbalagem(med: Medicamento | null): number | null {
  if (!med || med.multidose !== true) return null;
  const n = Number(med.dosesPorEmbalagem);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A unidade em que este item é CONTADO no estoque, escrito na receita e COBRADO.
 *
 * Forma de Cálculo quando o produto declara conteúdo; **'Un.'** quando não declara
 * (2026-09-17, a pedido) — a embalagem é a própria unidade. As três respostas precisam
 * ser a MESMA: duas unidades diferentes para o mesmo item é o que fazia 5 mL virarem
 * 5 frascos na baixa e na fatura.
 *
 * ⚠️ Não cai mais em `med.unidade` (a da EMBALAGEM): com ela o estoque contava
 * embalagens sob o rótulo 'g'/'mL', e a receita escrita nessa unidade debitava o
 * conteúdo contra um saldo de embalagens.
 * Regra ÚNICA em `utils/formaCalculo.ts` — a Prescrição lê a mesma.
 */
function unidadeOperativaMed(med: Medicamento | null): string {
  return unidadeOperativaProduto(med) ?? '';
}

// 🔴 TODO SALDO DESTA TELA É ROTULADO POR `unidadeOperativaMed`, nunca por
// `medicamento.unidade` (2026-09-17, a pedido: "Qtd em Estoque aparece 5 g e precisa ser
// a Forma de Cálculo — nesse caso Un.").
//
// `medicamento.unidade` é a unidade da EMBALAGEM ("Frasco", "g") e não diz em que o
// saldo está contado: a entrada de um produto sem multidose grava EMBALAGENS, então
// "5 g" para 5 bisnagas é o mesmo descasamento que a receita e a fatura já tinham — a
// tela dizia grama, o sistema debitava embalagem. Vale para o saldo, os dois alertas
// (mínimo/alarmante), o histórico de movimentos e o Ajuste de Estoque: uma unidade
// diferente em qualquer um deles é uma segunda versão da verdade na MESMA tela.
//
// ⚠️ CONSEQUÊNCIA CONHECIDA no histórico: movimento gravado ANTES da normalização das
// entradas legadas (migration 20261013000000) está na unidade antiga e aparece sob o
// rótulo novo. `tb_movimentos_estoque` não é reescrito de propósito — ele registra o que
// aconteceu —, e rotulá-lo com a unidade da embalagem estaria igualmente errado e ainda
// contradiria o saldo logo acima.

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Farmacia() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();
  const podeCriar   = isGestor || podeExecutar('farmacia.estoque.criar');
  const podeEditar  = isGestor || podeExecutar('farmacia.estoque.editar');
  const podeAjustar = isGestor || podeExecutar('farmacia.estoque.ajustar');
  // Mesma permissão que antes gateava a exclusão passou a gatear o toggle
  // ativar/inativar (mesma regra de /cadastro/fornecedores — ver EstoqueController.toggle).
  const podeAtivar  = isGestor || podeExecutar('farmacia.estoque.deletar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [itens,        setItens]        = useState<EstoqueItem[]>([]);
  const [medicamentos, setMedicamentos] = useState<Medicamento[]>([]);
  // Cadastro rápido do medicamento que não existe no catálogo — mesmo modal da
  // Prescrição e da tela de Vacina. Guarda o NOME digitado na busca do seletor.
  const [cadastroMedNome, setCadastroMedNome] = useState<string | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro do SALVAR do painel de formulário — no topo da página fica fora da vista
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const [fornecedores, setFornecedores] = useState<FornecedorItem[]>([]);
  const [showNovoForn, setShowNovoForn] = useState(false);
  const [meta,         setMeta]         = useState<Meta>({ total:0, totalControlados:0, totalAbaixoMinimo:0, totalAbaixoAlarmante:0 });
  const [loading,      setLoading]      = useState(false);
  // `?filtro=` e `?busca=` na URL pré-selecionam a aba e o termo — é por aí que os
  // Relatórios de Farmácia trazem "abaixo do mínimo" ou um produto específico já
  // recortado. Aba desconhecida cai no padrão "ativos".
  const [searchParams] = useSearchParams();
  const filtroDaUrl = (searchParams.get('filtro') ?? '').toLowerCase() as FiltroTab;
  const [busca,        setBusca]        = useState(searchParams.get('busca') ?? '');
  const [filtroTab,    setFiltroTab]    = useState<FiltroTab>(
    (['todos','ativos','inativos','critico','alarmante','controlados'] as string[]).includes(filtroDaUrl) ? filtroDaUrl : 'ativos',
  );

  const { ordenacao, alternar } = useOrdenacao<ColunaFarmacia>();

  const [form,         setForm]         = useState({ ...FORM_VAZIO });
  const [editandoId,   setEditandoId]   = useState<number | null>(null);
  // Item em edição já teve movimentação? (bloqueia edição de embalagens/peso)
  const [editandoEmUso, setEditandoEmUso] = useState(false);
  const [salvando,     setSalvando]     = useState(false);
  const [modalFormAberto, setModalFormAberto] = useState(false);

  // ── Fila do documento de compra ────────────────────────────────────────────
  // ⚠️ A FILA É O PONTO DA FUNÇÃO: a nota do fornecedor veterinário quase nunca tem
  // um item só. Cada produto marcado vira uma entrada PRÓPRIA (lote, validade e valor
  // são de cada um), então o formulário abre preenchido, salva, e já abre o seguinte —
  // em vez de obrigar a reabrir "Entrada de Estoque" e redigitar o cabeçalho da nota
  // a cada produto.
  const [leitorAberto,  setLeitorAberto]  = useState(false);
  const [filaNota,      setFilaNota]      = useState<ItemNota[]>([]);
  const [notaLida,      setNotaLida]      = useState<NotaLida | null>(null);

  const [modalHistorico, setModalHistorico] = useState<EstoqueItem | null>(null);
  const [movimentos,     setMovimentos]     = useState<MovimentoEstoque[]>([]);
  const [loadingMov,     setLoadingMov]     = useState(false);

  const [itemView,       setItemView]       = useState<EstoqueItem | null>(null);

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
  // 🔴 UNIDADE DO ITEM, escolhida AQUI (2026-09-12). Ela vem do catálogo GLOBAL e quase
  // sempre é de peso/volume ('g', 'ml'), mas a clínica conta e cobra em EMBALAGENS —
  // era essa diferença que fazia estoque e fatura saírem "em gramas". Trocá-la num item
  // global cria a CÓPIA da empresa no backend (lib/unidadeMedicamento.js); o global,
  // que é de todas as clínicas, nunca é alterado.
  const [unidadeSel,     setUnidadeSel]     = useState('');
  // ⚠️ A lista de unidades do catálogo SAIU daqui em 2026-09-16: o seletor de Unidade
  // virou leitura e o valor vem do PRODUTO (`unidadeOperativaMed`). Manter o estado
  // sem consumidor só deixaria uma busca por página sem ninguém para ler o resultado —
  // e o `tsc -b` reprova variável não lida.
  const comboboxRef = useRef<HTMLDivElement>(null);


  // ── Busca medicamento selecionado ─────────────────────────────────────────

  const medSelecionado    = medicamentos.find((m) => m.id === form.medicamentoId) ?? null;
  // Quanto a embalagem contém, na unidade operativa — vem do CADASTRO DO PRODUTO.
  // Na EDIÇÃO cai no que ficou gravado na linha: a lista da tela é recortada por
  // espécie e pode não conter o medicamento daquele estoque.
  // 🔴 SÓ o que o PRODUTO declara (2026-09-17). O fallback no `pesoPorEmbalagem` desta
  // linha voltava a multiplicar a Qtd Total pelo conteúdo de uma entrada LEGADA (as
  // gravadas antes de o conteúdo mudar de casa) mesmo com o produto já sem multidose —
  // e aí a Qtd Total dizia "30 Un." para 2 frascos de 15 mL.
  const conteudoEmbalagem = conteudoDaEmbalagem(medSelecionado);
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
      if (filtroTab === 'inativos')    params.ativo = 'false';
      else if (filtroTab !== 'todos')  params.ativo = 'true';
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
        (fornRes.data?.dados ?? []).filter((f: FornecedorItem) => fornecedorDeProduto(f.tipoServico))
      );
    } catch { setErroInline('Erro ao carregar estoque.'); }
    finally { setLoading(false); }
  }, [busca, filtroTab]);

  useEffect(() => { if (!loadingPerm) carregarEstoque(); }, [carregarEstoque, loadingPerm]);

  // Recarrega só a lista de fornecedores da farmácia (após cadastrar um novo pelo seletor).
  const recarregarFornecedores = useCallback(async (): Promise<FornecedorItem[]> => {
    try {
      const res = await api.get('/cadastro/fornecedores', { params: { ativo: 'true' } });
      const lista = ((res.data?.dados ?? []) as FornecedorItem[]).filter(f => fornecedorDeProduto(f.tipoServico));
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
    // 🔴 O CONTEÚDO SAI DO CADASTRO DO PRODUTO, e SÓ dele (2026-09-17). A heurística de
    // texto que lia "Frasco 20 mL" do nome saiu: ela afirmava um número que divide o
    // preço da dose na fatura sem ninguém ter declarado nada, e contradizia a regra do
    // não-multidose — sem conteúdo, a embalagem é a própria unidade ('Un.') e a Qtd
    // Total é a Qtd Produto.
    const conteudo = conteudoDaEmbalagem(med);
    setPesoPorEmbalagem(conteudo ?? '');
    // A unidade deixou de ser escolhida aqui: é a do produto, e ela precisa ser a
    // MESMA em que a receita é escrita e a fatura é calculada.
    setUnidadeSel(unidadeOperativaMed(med));
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

  // Só sem correspondência EXATA de nome — senão o seletor convidaria a criar a
  // duplicata de um medicamento que já está na lista (mesmo critério da Prescrição
  // e da tela de Vacina).
  const termoBuscaMed = buscaMed.trim();
  const mostraCriarMed = termoBuscaMed !== '' &&
    !medicamentos.some((m) => m.nome.toLowerCase() === termoBuscaMed.toLowerCase());

  // O item volta pronto do backend: entra na lista local (sem refazer a carga) e já
  // fica escolhido na entrada de estoque que estava sendo preenchida.
  const medicamentoCadastrado = (item: ItemCatalogoCriado) => {
    const novo = item as unknown as Medicamento;
    setMedicamentos((prev) => [novo, ...prev.filter((m) => m.id !== novo.id)]);
    setForm((f) => ({ ...f, medicamentoId: novo.id }));
    // A unidade OPERATIVA (Forma de Cálculo quando o produto a declara), nunca a da
    // embalagem crua — ver `unidadeOperativaMed`.
    setUnidadeSel(unidadeOperativaMed(novo));
    setCadastroMedNome(null);
    setDropdownMedAberto(false);
    setBuscaMed('');
  };

  // ── Filtro local ──────────────────────────────────────────────────────────

  const itensDaAba = (() => {
    if (filtroTab === 'critico')   return itens.filter((i) => i.qtdEstoque <= i.estoqueMinimo);
    if (filtroTab === 'alarmante') return itens.filter((i) => i.qtdEstoque <= i.estoqueAlarmante && i.qtdEstoque > i.estoqueMinimo);
    return itens;
  })();
  // Ordenação por coluna — vale para a lista INTEIRA da aba (aqui não há paginação).
  // As colunas de data mudam com a aba (ativado × inativado); a chave é a mesma e o
  // valor acompanha o que a linha exibe naquela aba.
  const itensFiltrados = ordenarLista(itensDaAba, ordenacao, (item, campo) => {
    switch (campo) {
      case 'medicamento':   return item.medicamento?.nome ?? null;
      // Entrada avulsa (sem Qtd Produto informada) ordena como ZERO, nunca como null:
      // o comparador manda o vazio para o fim nos DOIS sentidos, e a linha sem
      // embalagem declarada ficaria separada do resto sem motivo.
      case 'qtdProduto':    return item.qtdEmbalagens ?? 0;
      case 'estoque':       return item.qtdEstoque ?? 0;
      case 'status':        return item.ativo ? 'ATIVO' : 'INATIVO';
      case 'criadoEm':      return valorData(item.createdAt);
      case 'ativadoEm':     return valorData(item.ativoEm ?? item.createdAt);
      case 'ativadoPor':    return item.ativoPorNome ?? null;
      case 'inativadoEm':   return valorData(item.inativoEm);
      case 'inativadoPor':  return item.inativoPorNome ?? null;
      case 'justificativa': return item.inativoMotivo ?? null;
      default:              return null;
    }
  });

  // ── Helpers UI ────────────────────────────────────────────────────────────

  const nivelEstoque = (i: EstoqueItem) => {
    if (i.qtdEstoque <= i.estoqueMinimo)    return 'critico';
    if (i.estoqueAlarmante > 0 && i.qtdEstoque <= i.estoqueAlarmante) return 'alarmante';
    return 'ok';
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
    // ⚠️ A unidade sai do PRÓPRIO item (`item.medicamento`), não de `medicamentos`: a
    // lista da tela é recortada por espécie e pode não conter o medicamento da linha —
    // aí o seletor abriria em branco e o salvar mandaria unidade vazia.
    // 🔴 A unidade OPERATIVA da linha, não a da embalagem: o saldo gravado está na
    // Forma de Cálculo quando o produto a declara, e abrir a edição dizendo "Frasco"
    // sobre 60 mL faria a conversão do mínimo/alarmante sair pelo fator errado.
    const unidadeDoItem = unidadeOperativaMed(item.medicamento ?? null);
    const fator         = fatorSubUnidade(unidadeDoItem);
    setUnidadeSel(unidadeDoItem);
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
    setUnidadeSel('');
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

  /**
   * Abre o formulário de entrada já preenchido com um item lido do documento.
   *
   * ⚠️ O ITEM DA NOTA TRAZ NOME, NÃO ID DE CATÁLOGO. O casamento é por nome, sem
   * acento nem caixa, contra o catálogo que a tela já carregou. NÃO ACHOU não é erro:
   * o campo de busca abre com o nome lido para a pessoa escolher o item certo (ou
   * cadastrá-lo) — inventar um `medicamentoId` aqui daria entrada de estoque no
   * produto errado, que é bem pior do que um campo a preencher.
   */
  const aplicarItemDaNota = (item: ItemNota, nota: NotaLida | null) => {
    const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const achado = medicamentos.find(m => norm(m.nome) === norm(item.nome))
                ?? medicamentos.find(m => norm(m.nome).includes(norm(item.nome)));

    // O fornecedor só é pré-selecionado quando JÁ está cadastrado nesta clínica —
    // `fornecedorExistente` é o backend quem resolve (por CNPJ/CPF/nome).
    const fornId = nota?.fornecedorExistente?.id ?? 0;

    setForm({
      ...FORM_VAZIO,
      medicamentoId: achado?.id ?? 0,
      // ⚠️ `valorUnitario` é o valor de UMA embalagem — a mesma unidade em que o campo
      // "Valor Unitário" da tela grava desde 2026-09-17 (parte 2). O `valorTotal` da
      // nota é da LINHA inteira e entraria multiplicado; por isso ele só serve de
      // reserva quando a nota não trouxe o unitário e a quantidade é 1.
      valor:          item.valorUnitario ?? (item.quantidade === 1 ? (item.valorTotal ?? 0) : 0),
      valorRepassado: item.valorUnitario ?? (item.quantidade === 1 ? (item.valorTotal ?? 0) : 0),
      lote:           item.lote ?? '',
      validade:       item.validade ?? '',
      qtdEstoque:     item.quantidade ?? 0,
      fornecedorId:   fornId,
      notaFiscal:     nota?.numero ?? '',
    });
    setValorStr(item.valorUnitario != null ? String(item.valorUnitario).replace('.', ',') : '');
    setValorRepassadoStr(item.valorUnitario != null ? String(item.valorUnitario).replace('.', ',') : '');
    setFrascos(item.quantidade ?? '');
    setUnidadeSel(achado ? '' : '');
    setEditandoId(null);
    setEditandoEmUso(false);
    // Sem item no catálogo, o campo de busca abre com o nome lido — é o que transforma
    // "não achei" em "confirme qual é" em vez de um formulário mudo.
    setBuscaMed(achado ? '' : item.nome);
    setDropdownMedAberto(!achado);
    setModalFormAberto(true);
  };

  /** Recebe o que o leitor devolveu: aplica o 1º item e enfileira o resto. */
  const usarDocumentoLido = (nota: NotaLida, itens: ItemNota[]) => {
    setLeitorAberto(false);
    setNotaLida(nota);
    const [primeiro, ...resto] = itens;
    setFilaNota(resto);
    aplicarItemDaNota(primeiro, nota);
    if (resto.length > 0) {
      toast.success(`${itens.length} produtos lidos — um formulário por vez. Faltam ${resto.length} depois deste.`);
    }
    if (!nota.fornecedorExistente && nota.fornecedor?.nome) {
      toast(`Fornecedor "${nota.fornecedor.nome}" não está cadastrado — a compra não entrará na conta a pagar dele.`,
        { icon: '⚠️' });
    }
  };

  const salvar = async () => {
    setErroAcao(null);
    if (editandoId && !podeEditar) { semPermissao('editar estoque'); return; }
    if (!editandoId && !podeCriar) { semPermissao('criar entrada de estoque'); return; }
    if (!form.medicamentoId) return setErroAcao({ mensagem: 'Selecione um medicamento do catálogo.', campos: ['medicamentoId'] });
    // Campo com asterisco precisa ter efeito, senão o formulário recusa sem dizer onde.
    // Item já movimentado tem a unidade travada e chega aqui com o valor de origem.
    if (!unidadeSel)         return setErroAcao({ mensagem: 'Informe a unidade do item.', campos: ['unidade'] });
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

    setSalvando(true);
    try {
      const payload = {
        medicamentoId:    form.medicamentoId,
        // 🔴 VALOR POR EMBALAGEM, GRAVADO COMO FOI DIGITADO (2026-09-17, a pedido).
        // A tela multiplicava os dois pela Qtd Produto para o banco guardar o TOTAL da
        // compra, e o backend dividia pelo saldo — as duas contas se cancelavam e o
        // preço da dose saía certo, mas os campos ficavam com o total sob o rótulo
        // "Valor Unitário". Quem lia o campo cru cobrava a compra inteira numa linha:
        // uma seringa saía pelo preço da CAIXA. Agora quem divide o preço é o conteúdo
        // da embalagem, que o cadastro do produto declara.
        valor:            form.valor,
        valorRepassado:   form.valorRepassado,
        lote:             form.lote || null,
        validade:         form.validade || null,
        // Formulário trabalha na subunidade — converte para a unidade maior ao salvar
        estoqueMinimo:    form.estoqueMinimo / fatorSubUnidade(unidadeSel),
        estoqueAlarmante: form.estoqueAlarmante / fatorSubUnidade(unidadeSel),
        // ⚠️ A UNIDADE NÃO É ENVIADA: o campo da tela é LEITURA e mostra a unidade
        // OPERATIVA do produto ('mL' com forma declarada, 'Un.' sem ela). Mandá-la
        // acionaria o copy-on-write do catálogo e trocaria a unidade da EMBALAGEM
        // ("Frasco"/"g") por ela. Quem troca a unidade do produto é /cadastro/produtos.
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
      // 🔴 PRÓXIMO PRODUTO DA NOTA, quando há fila. `limparForm` fecha o modal, então
      // a fila é consumida DEPOIS dele — e só no caminho de sucesso: falhou o salvar,
      // o item continua na tela para ser corrigido, nunca é pulado em silêncio.
      limparForm();
      if (filaNota.length > 0) {
        const [proximo, ...resto] = filaNota;
        setFilaNota(resto);
        aplicarItemDaNota(proximo, notaLida);
      } else if (notaLida) {
        setNotaLida(null);
        toast.success('Todos os produtos do documento foram lançados.');
      }
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao salvar.');
    } finally { setSalvando(false); }
  };

  // Ativar/Inativar — mesma regra de /cadastro/fornecedores: um clique alterna
  // o estado; inativar exige justificativa (ModalJustificativa), ativar segue direto.
  const [inativandoItem, setInativandoItem] = useState<EstoqueItem | null>(null);
  const [togglingAtivo,  setTogglingAtivo]  = useState(false);

  const handleToggle = (item: EstoqueItem) => {
    setErroInline(null);
    if (!podeAtivar) { semPermissao('alternar status do item'); return; }
    if (item.ativo) { setInativandoItem(item); return; }
    confirmarToggle(item);
  };

  // ─── Ações do item de estoque — UMA declaração para a tabela E para o card ──
  // `AcaoRegistro` decide a forma por CSS (ícone no desktop, botão com rótulo no
  // mobile). ⚠️ Item JÁ UTILIZADO (`emUso`, tem movimento de SAÍDA) não se edita:
  // no lugar do lápis entra o olho, e o `title` diz por quê.
  const acoesDoItem = (item: EstoqueItem) => (
    <AcoesRegistro>
      <AcaoRegistro tom="ver" icone={Eye} rotulo="Ver"
        titulo="Visualizar (já utilizado — não pode ser alterado)"
        visivel={item.emUso} onClick={() => setItemView(item)} />
      <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar"
        visivel={!item.emUso && podeEditar} onClick={() => preencherEdicao(item)} />
      <AcaoRegistro tom="ativar" icone={item.ativo ? ToggleRight : ToggleLeft}
        rotulo={item.ativo ? 'Inativar' : 'Ativar'}
        visivel={podeAtivar} onClick={() => handleToggle(item)} />
    </AcoesRegistro>
  );

  const confirmarToggle = async (item: EstoqueItem, motivo?: string) => {
    setTogglingAtivo(true);
    try {
      await api.patch(`/farmacia/estoque/${item.id}/toggle`, motivo ? { motivo } : undefined);
      toast.success(item.ativo ? 'Item inativado.' : 'Item ativado.');
      setInativandoItem(null);
      carregarEstoque();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao alternar status.');
    } finally {
      setTogglingAtivo(false);
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
              <h1 className="text-2xl font-bold text-gray-900">Estoque de Farmácia</h1>
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
              {/* 🔴 Gate de CRIAR, o mesmo da entrada manual: o resultado vira entrada
                  de estoque e gasta a quota de IA da clínica. Quem só consulta não vê
                  o botão — ação sem permissão não nasce como botão que falha depois
                  do clique (armadilha 28-d). */}
              {podeCriar && (
                <button onClick={() => setLeitorAberto(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-600 text-emerald-700 hover:bg-emerald-50 text-xs font-semibold rounded-xl transition-colors"
                  title="Nota fiscal, cupom, orçamento de balcão ou recibo — inclusive sem valor fiscal">
                  <FileText size={13} />
                  Carregar Nota Fiscal
                </button>
              )}
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
              ['todos','Todos'],
              ['ativos','Ativos'],
              ['inativos','Inativos'],
              ['critico','🔴 Crítico'],
              ['alarmante','🟡 Alarmante'],
              ['controlados','🔒 Controlados'],
            ] as [FiltroTab, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFiltroTab(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  filtroTab === key
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {label}
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
                      <ThOrdenavel campo="medicamento" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Medicamento</ThOrdenavel>
                      {/* 🔴 QTD PRODUTO é O QUE FOI COMPRADO, não o saldo (2026-09-19, a
                          pedido). É o MESMO campo que o formulário de entrada chama "Qtd
                          Produto" (`qtdEmbalagens`): quantas embalagens entraram nesta
                          linha de estoque — e é ele que vira a quantidade da conta a pagar
                          do fornecedor. Não desce com o consumo: quem responde "quanto
                          ainda tenho" é a coluna Estoque ao lado, na unidade OPERATIVA.
                          ⚠️ Num produto MULTIDOSE as duas dizem coisas diferentes de
                          propósito (3 frascos comprados × 55 mL restantes); no não-multidose
                          o saldo também é contado em embalagens e elas começam iguais. */}
                      <ThOrdenavel campo="qtdProduto" ordenacao={ordenacao} onOrdenar={alternar} alinhar="centro" className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Qtd Produto</ThOrdenavel>
                      <ThOrdenavel campo="estoque" ordenacao={ordenacao} onOrdenar={alternar} alinhar="centro" className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Estoque</ThOrdenavel>
                      <ThOrdenavel campo="status" ordenacao={ordenacao} onOrdenar={alternar} alinhar="centro" className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</ThOrdenavel>
                      {filtroTab !== 'inativos' ? (
                        <>
                          <ThOrdenavel campo="criadoEm" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Criado em</ThOrdenavel>
                          <ThOrdenavel campo="ativadoEm" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado em</ThOrdenavel>
                          <ThOrdenavel campo="ativadoPor" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Ativado por</ThOrdenavel>
                        </>
                      ) : (
                        <>
                          <ThOrdenavel campo="inativadoEm" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado em</ThOrdenavel>
                          <ThOrdenavel campo="inativadoPor" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Inativado por</ThOrdenavel>
                          <ThOrdenavel campo="justificativa" ordenacao={ordenacao} onOrdenar={alternar} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</ThOrdenavel>
                        </>
                      )}
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
                          <td className="px-4 py-3 text-center whitespace-nowrap text-gray-700">
                            {item.qtdEmbalagens != null ? fmtQtd(item.qtdEmbalagens) : '—'}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${qtdCls}`}>
                              {nivel !== 'ok' && <AlertTriangle size={10} className={nivel === 'critico' ? 'text-red-500' : 'text-amber-500'} />}
                              {fmtQtd(item.qtdEstoque)} {unidadeOperativaMed(item.medicamento)}
                            </span>
                            <p className="text-[10px] text-gray-400 mt-0.5">mín {fmtQtd(item.estoqueMinimo)}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${item.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                              {item.ativo ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </td>
                          {filtroTab !== 'inativos' ? (
                            <>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(item.createdAt)}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(item.ativoEm ?? item.createdAt)}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{item.ativoPorNome ?? '—'}</td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(item.inativoEm)}</td>
                              <td className="px-4 py-3 whitespace-nowrap text-gray-600">{item.inativoPorNome ?? '—'}</td>
                              <td className="px-4 py-3"><JustificativaCancelamento texto={item.inativoMotivo} /></td>
                            </>
                          )}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {acoesDoItem(item)}
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
                          {fmtQtd(item.qtdEstoque)} {unidadeOperativaMed(item.medicamento)}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400">
                        {item.medicamento.formaFarmaceutica} · {item.medicamento.apresentacao}
                        {item.lote && ` · Lote ${item.lote}`}
                        {/* Qtd Produto — o mesmo dado da coluna do desktop (§6: o card
                            mobile mostra o que a tabela mostra). Some quando a entrada
                            não a declarou, em vez de exibir um traço no meio da linha. */}
                        {item.qtdEmbalagens != null && ` · Qtd Produto ${fmtQtd(item.qtdEmbalagens)}`}
                        {' · '}{item.ativo ? 'Ativo' : 'Inativo'}
                      </p>
                      {!item.ativo && item.inativoEm && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Inativado em {formatDate(item.inativoEm)}{item.inativoPorNome ? ` por ${item.inativoPorNome}` : ''}
                          {item.inativoMotivo ? <> — <JustificativaCancelamento texto={item.inativoMotivo} className="inline" /></> : ''}
                        </p>
                      )}
                      {item.ativo && item.ativoPorNome && (
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Ativado em {formatDate(item.ativoEm)} por {item.ativoPorNome}
                        </p>
                      )}
                      <div className="mt-2">{acoesDoItem(item)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Cadastro do medicamento que não existe no catálogo — mesmo modal da
          Prescrição e da tela de Vacina. Fica FORA do bloco do formulário de estoque
          porque tem z-index próprio (acima dele) e vida própria: fechar o cadastro
          não pode fechar a entrada de estoque que estava sendo preenchida. */}
      <CadastroCatalogoModal
        aberto={cadastroMedNome !== null}
        tipo="medicamento"
        nomeInicial={cadastroMedNome ?? ''}
        onCriado={medicamentoCadastrado}
        onFechar={() => setCadastroMedNome(null)}
      />

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
                          {medsFiltrados.length === 0 && !mostraCriarMed ? (
                            <li className="px-3 py-3 text-xs text-gray-400 text-center">Nenhum medicamento encontrado.</li>
                          ) : (
                            medsFiltrados.map((m) => (
                              <li key={m.id}>
                                <button
                                  type="button"
                                  onMouseDown={() => {
                                    setForm((f) => ({ ...f, medicamentoId: m.id }));
                                    // A unidade vem do PRODUTO e não se corrige aqui:
                                    // é a mesma em que a receita é escrita e a fatura
                                    // é calculada (ver `unidadeOperativaMed`).
                                    setUnidadeSel(unidadeOperativaMed(m));
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
                          {/* Medicamento que ainda não existe no catálogo: abre a MESMA
                              tela de cadastro da Prescrição. `onMouseDown` dispara antes
                              do blur que fecha o dropdown. */}
                          {mostraCriarMed && (
                            <li>
                              <button
                                type="button"
                                onMouseDown={() => setCadastroMedNome(termoBuscaMed)}
                                className="w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center gap-1.5 font-medium border-t border-gray-50">
                                <Plus size={13} className="flex-shrink-0" />
                                Cadastrar "{termoBuscaMed}" como novo medicamento
                              </button>
                            </li>
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
                    {/* A UNIDADE saiu daqui: deixou de ser leitura do catálogo e virou
                        campo do formulário, ao lado da calculadora de embalagens. Manter
                        as duas daria dois valores para o mesmo dado na mesma tela. */}
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
                  <p>Estoque atual: <span className="font-bold">{fmtQtd(estoqueExistente.qtdEstoque)} {unidadeOperativaMed(estoqueExistente.medicamento)}</span></p>
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
                  {/* 🔴 O RÓTULO É O MESMO NA CRIAÇÃO E NA EDIÇÃO porque o campo passou a
                      ser o mesmo dado nas duas: o valor de UMA embalagem. Enquanto a tela
                      multiplicava antes de gravar, reabrir a entrada trazia o total da
                      compra para um campo que dizia "Unitário" — e salvar de novo o
                      multiplicava outra vez. */}
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Valor Unitário (R$) <span className="text-red-500">*</span>
                  </label>
                  <input type="text" inputMode="decimal" value={valorStr}
                    onChange={(e) => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  {/* Conferência da nota — o total NÃO é gravado em lugar nenhum. */}
                  {frascos !== '' && Number(frascos) > 1 && form.valor > 0 && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Total da compra: R$ {formatarValor(form.valor * Number(frascos))}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Valor Unitário Cobrado (R$)
                  </label>
                  <input type="text" inputMode="decimal" value={valorRepassadoStr}
                    onChange={(e) => handleValorRepassadoChange(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  {/* É deste valor que sai a linha da fatura: ele é dividido pelo conteúdo
                      que o produto declara (frasco de 20 mL por R$ 100 -> R$ 5,00/mL). */}
                  {frascos !== '' && Number(frascos) > 1 && form.valorRepassado > 0 && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Total da compra: R$ {formatarValor(form.valorRepassado * Number(frascos))}
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

              {/* 🔴 QTD PRODUTO × CONTEÚDO DA EMBALAGEM = QTD TOTAL (2026-09-16).
                  Os rótulos mudaram a pedido ("Nº de Embalagens" → Qtd Produto,
                  "Qtd por Embalagem" → Qtd Total), mas o que mudou de verdade é a
                  ORIGEM do número: o conteúdo deixou de ser digitado a cada entrada e
                  passa a vir do cadastro do produto. Era esse número que a prescrição
                  não conhecia — e por não conhecê-lo, uma dose de 5 mL de um frasco de
                  20 mL debitava 5 UNIDADES (cinco frascos) e cobrava cinco frascos. */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Qtd Produto <span className="text-red-500">*</span>
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

                {/* 🔴 QTD TOTAL é DERIVADA, não digitada: Qtd Produto × o conteúdo que o
                    produto declara. Deixá-la editável daria DOIS números para a mesma
                    coisa (o do produto e o desta linha), e eles divergiriam na primeira
                    correção — com o preço da dose saindo de um e a baixa do outro. */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Qtd Total{unidadeSel && <span className="text-gray-400 font-normal ml-1">({unidadeSel})</span>}
                  </label>
                  <input
                    type="text" readOnly disabled value={form.qtdEstoque > 0 ? fmtQtd(form.qtdEstoque) : ''}
                    title={conteudoEmbalagem != null
                      ? `Qtd Produto × ${fmtQtd(conteudoEmbalagem)} ${unidadeSel} por Unidade (cadastro do produto)`
                      : 'O produto não declara conteúdo: a embalagem é a própria unidade'}
                    placeholder="—"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-100 text-gray-600"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {conteudoEmbalagem != null
                      ? `${fmtQtd(conteudoEmbalagem)} ${unidadeSel} por Unidade`
                      : 'Cadastre o produto como multidose para medir por dentro'}
                  </p>
                </div>

                {/* 🔴 UNIDADE virou LEITURA (a pedido, 2026-09-16): ela é a do PRODUTO.
                    Enquanto era escolhida aqui, dava para gravar o estoque em 'Un.' de
                    um produto medido em 'mL' — e aí 5 mL da receita eram lidos como 5
                    unidades na baixa e na fatura, sem nada acusar. Para trocá-la, o
                    caminho é o cadastro do produto (lá a troca passa pelo
                    copy-on-write e pelos guards de estoque já movimentado). */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Unidade <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text" readOnly disabled value={unidadeSel}
                    title="Definida no cadastro do produto (Unidade ou Forma de Cálculo)"
                    placeholder="Escolha o medicamento"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-100 text-gray-600"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Vem do cadastro do produto</p>
                </div>
              </div>

              {/* Total computado — é o valor que VAI SER GRAVADO, na unidade escolhida.
                  ⚠️ Aparece também na EDIÇÃO sem embalagens reinformadas: trocar 'g' por
                  'Un.' não mexe no número, então 5.000 g passariam a ser lidos como
                  "5.000 Un.". Mostrar o total aqui é o que dá para perceber isso ANTES
                  de salvar — quem corrige é o nº de embalagens ao lado. */}
              {unidadeSel && (Number(frascos) > 0 || (editandoId && form.qtdEstoque > 0)) && (
                <p className="text-xs text-gray-500 -mt-1">
                  Total em estoque:{' '}
                  <b className="text-emerald-700">{fmtQtd(form.qtdEstoque)} {unidadeSel}</b>
                </p>
              )}

              {/* Mínimo + Alarmante — editáveis também na edição */}
              {(
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                      Mínimo <span className="text-gray-400 font-normal">({subUnidade(unidadeSel || 'un')})</span>
                    </label>
                    <input type="number" min={0} value={form.estoqueMinimo === 0 ? '' : form.estoqueMinimo}
                      onChange={(e) => setForm((f) => ({ ...f, estoqueMinimo: e.target.value === '' ? 0 : Number(e.target.value) }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                      Alarmante <span className="text-gray-400 font-normal">({subUnidade(unidadeSel || 'un')})</span>
                    </label>
                    <input type="number" min={0} value={form.estoqueAlarmante === 0 ? '' : form.estoqueAlarmante}
                      onChange={(e) => setForm((f) => ({ ...f, estoqueAlarmante: e.target.value === '' ? 0 : Number(e.target.value) }))}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
              )}

              <ErroAcao erro={erroAcao} className="mb-2" />
              {/* Rodapé no padrão da aplicação: Cancelar + ação principal, tamanho
                  padrão (px-4/px-6 py-2.5), alinhados à direita. */}
              <div className="flex items-center justify-end gap-3">
                <button onClick={limparForm}
                  className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors">
                  Cancelar
                </button>
                <button onClick={salvar} disabled={salvando}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
                  {salvando ? 'Salvando...' : 'Salvar'}
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
                  <p className="font-bold text-emerald-700">{fmtQtd(itemView.qtdEstoque)} {unidadeOperativaMed(itemView.medicamento)}</p>
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
                  <p className="text-gray-700">{fmtQtd(itemView.estoqueMinimo)} {unidadeOperativaMed(itemView.medicamento)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Est. Alarmante</p>
                  <p className="text-gray-700">{fmtQtd(itemView.estoqueAlarmante)} {unidadeOperativaMed(itemView.medicamento)}</p>
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
                              +{fmtQtd(e.quantidade)} {modalHistorico ? unidadeOperativaMed(modalHistorico.medicamento) : ''}
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

      {/* ── Modal: leitura do documento de compra ────────────────────────── */}
      <LeitorDocumentoCompra
        tipoItem="medicamento"
        aberto={leitorAberto}
        onFechar={() => setLeitorAberto(false)}
        onUsar={usarDocumentoLido}
      />

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
                                      {fmtQtd(i.qtdEstoque)} {unidadeOperativaMed(i.medicamento)}
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
                      <b className="text-emerald-700">{fmtQtd(itemAjuste.qtdEstoque)} {unidadeOperativaMed(itemAjuste.medicamento)}</b></p>
                    {mlPorFrasco > 0 && (
                      <p><span className="text-gray-400">Frascos:</span>{' '}
                        <b className="text-emerald-700">{fmtQtd(frascosDe(itemAjuste.qtdEstoque) || 0)}</b>
                        <span className="text-gray-400"> ({fmtQtd(mlPorFrasco)} {unidadeOperativaMed(itemAjuste.medicamento)}/frasco)</span></p>
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
                        {itemAjuste ? unidadeOperativaMed(itemAjuste.medicamento) : 'Total'}
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
                      placeholder={mlPorFrasco > 0 ? `Total (${itemAjuste ? unidadeOperativaMed(itemAjuste.medicamento) : ''})` : '0'}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                </div>
                {itemAjuste && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Informe a quantidade real em estoque{mlPorFrasco > 0 ? ' (frascos ou ' + unidadeOperativaMed(itemAjuste.medicamento) + ')' : ''} — a diferença será registrada como ajuste.
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
                      {delta > 0 ? '+' : '−'}{fmtQtd(Math.abs(delta))} {unidadeOperativaMed(itemAjuste.medicamento)}
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

      {/* ── Modal: cadastrar novo fornecedor pelo seletor da entrada de estoque ── */}
      {showNovoForn && (
        <ModalNovoFornecedor
          onSalvo={handleFornecedorCriado}
          onClose={() => setShowNovoForn(false)}
        />
      )}

      <ModalJustificativa
        aberto={!!inativandoItem}
        titulo="Inativar item do estoque?"
        descricao={inativandoItem ? `${inativandoItem.medicamento.nome}${inativandoItem.lote ? ` — Lote ${inativandoItem.lote}` : ''} deixa de aparecer como ativo.` : undefined}
        acaoLabel="Inativar"
        processando={togglingAtivo}
        onConfirmar={(motivo) => { if (inativandoItem) confirmarToggle(inativandoItem, motivo); }}
        onFechar={() => setInativandoItem(null)}
      />
    </PageContainer>
  );
}
