// frontend/src/pages/Pagamentos.tsx
//
// FINANCEIRO > PAGAMENTOS (2026-09-10)
//
// 🔴 É O OUTRO LADO DO BALCÃO DA FATURA. `Faturamento.tsx` responde "quanto o cliente
// me deve"; esta tela responde "quanto eu devo ao fornecedor e ao prestador". Os dois
// nascem do MESMO evento — a execução — e por isso conferem entre si, mas são
// documentos diferentes, para pessoas diferentes, com totais diferentes.
//
// 🔴 UMA tela para os dois tipos, escolhidos por aba. FORNECEDOR e PRESTADOR têm o
// mesmo ciclo (abrir → fechar → pagar) e o mesmo formato de linha; duas telas
// divergiriam na primeira correção — e o que divergiria seria como a clínica apura o
// que paga.
//
// 🔴 **O CICLO E A BARRA DE AÇÕES SÃO OS DA FATURA** (2026-09-22, a pedido): os mesmos
// status (Todas · Aberta · Reaberta · Fechada · Atrasada · Paga · Cancelada) e as
// mesmas ações com rótulo (Fechar Pagamento · Marcar como Pago · E-mail · WhatsApp ·
// Imprimir · Exportar). Os tokens de cor vêm de `utils/tomAcao.ts`, fonte única das
// duas telas — duas cópias dariam ao mesmo ato uma cor de cada lado do balcão.
//
// ⚠️ **ATRASADA é DERIVADA, nunca gravada** (`lib/vencimentoCredor.js#statusExibicao`):
// conta FECHADA cujo vencimento já passou. O vencimento vem do CADASTRO do credor, e é
// por isso que ele é editável lá e somente leitura aqui. Por isso o filtro incide sobre
// `statusExibicao`, nunca sobre `status`.
//
// ⚠️ Cada linha traz o que o pedido exige: o ANIMAL, o valor, a DATA DO PEDIDO (a data
// da entrada no estoque / da execução) e QUEM SOLICITOU.
//
// ⚠️ Os lançamentos nascem SOZINHOS, na execução (prescrição, vacina, procedimento) e
// na entrada de estoque. O "Lançar" desta tela é para o que o automático não pegou — o
// item sem preço de compra cadastrado, por exemplo.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Wallet, Truck, HardHat, Loader2, Plus, Check, CheckCircle2, Lock, Ban, Trash2,
  AlertTriangle, X, Printer, MessageCircle, Mail, Download, ChevronDown, RefreshCw,
  Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import ModalJustificativa from '../components/ModalJustificativa';
import JanelaLista from '../components/JanelaLista';
import DateInput from '../components/DateInput';
import PeriodoSelector from '../components/relatorios/PeriodoSelector';
import { usePeriodo, periodoParams } from '../contexts/PeriodoContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import { formatDataHora, formatDate, hojeISO } from '../utils/dateUtils';
import { BTN_ACAO, TOM_ACAO } from '../utils/tomAcao';
// Imprimir / WhatsApp / e-mail da conta. O PDF sai pelo MESMO caminho do resto do
// sistema (`compartilharPdf` → Puppeteer no backend), então ele já chega anexado de
// verdade e com a barra de progresso.
import {
  gerarHtmlContasPagar, imprimirContasPagar, exportarContaPagarCSV, type ContaPagarPrint,
} from '../utils/ContaPagarPrint';
// 🔴 NA ABA DE PRESTADORES A FOLHA É O RECIBO (a pedido, 2026-09-22) — o mesmo
// documento de `/recibos-prestador`, com a frase de quitação, o valor por extenso e a
// assinatura de QUEM RECEBE. O demonstrativo (`ContaPagarPrint`) continua valendo para
// o FORNECEDOR: ali o papel é conferência de compra, não comprovante de quitação.
import {
  gerarHtmlRecibos, imprimirRecibos,
  type ReciboPrestador, type ReciboPeriodo, type ReciboEmitente,
} from '../utils/ReciboPrestadorPrint';
import { enviarPdfWhatsAppComAviso, enviarPdfEmailComAviso } from '../utils/compartilharPdf';
// Quantidade sem zeros à toa (20 → "20", 2,5 → "2,5") — a MESMA do estoque e da
// prescrição. Uma cópia local divergiria no primeiro ajuste de formato.
import { fmtQtdForma } from '../utils/formaCalculo';

type TipoConta = 'FORNECEDOR' | 'PRESTADOR';

/** O que a TELA mostra. ATRASADA não é gravada — ver o cabeçalho. */
type StatusConta = 'ABERTA' | 'REABERTA' | 'FECHADA' | 'ATRASADA' | 'PAGA' | 'CANCELADA';

interface ItemConta {
  id:              number;
  animalId:        number | null;
  animalNome:      string;
  descricao:       string;
  quantidade:      number;
  valor:           number;
  solicitanteNome: string;
  ocorridoEm:      string;
  origemTipo:      string | null;
}

interface Conta {
  id:            number;
  tipo:          TipoConta;
  credorId:      number;
  credorNome:    string;
  mesReferencia: string | null;
  total:         number;
  /** O status GRAVADO. Nunca vale ATRASADA. */
  status:        Exclude<StatusConta, 'ATRASADA'>;
  /** O status EXIBIDO — o gravado, ou ATRASADA quando o vencimento já passou. */
  statusExibicao: StatusConta;
  /** Vencimento resolvido do cadastro do credor. `null` = ele não declarou nenhum. */
  vencimentoEm:  string | null;
  pagoEm:        string | null;
  itens:         ItemConta[];
}

interface Credor {
  id: number; nome: string; tipoServico: string | null;
  telefone?: string | null; email?: string | null;
  cpf?: string | null; cnpj?: string | null;
}

const brl = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Cores por SIGNIFICADO, na MESMA paleta da lista de faturas (`STATUS_LISTA` em
 * `Faturamento.tsx`): o mesmo estado não pode ter uma cor de um lado do balcão e outra
 * do outro. Aberta é o que ainda corre, reaberta é o que voltou a correr depois de um
 * fechamento, fechada foi conferida, atrasada venceu, paga terminou bem e cancelada
 * deixou de valer.
 */
const STATUS: Record<StatusConta, { label: string; cls: string; pilula: string }> = {
  ABERTA:    { label: 'Aberta',    cls: 'text-amber-700 bg-amber-50 border-amber-200',       pilula: 'bg-amber-500'   },
  REABERTA:  { label: 'Reaberta',  cls: 'text-orange-700 bg-orange-50 border-orange-200',    pilula: 'bg-orange-600'  },
  FECHADA:   { label: 'Fechada',   cls: 'text-indigo-700 bg-indigo-50 border-indigo-200',    pilula: 'bg-indigo-600'  },
  ATRASADA:  { label: 'Atrasada',  cls: 'text-red-700 bg-red-50 border-red-200',             pilula: 'bg-red-600'     },
  PAGA:      { label: 'Paga',      cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', pilula: 'bg-emerald-600' },
  CANCELADA: { label: 'Cancelada', cls: 'text-gray-600 bg-gray-100 border-gray-200',         pilula: 'bg-gray-500'    },
};

type FiltroStatus = 'TODAS' | StatusConta;

const FILTROS: FiltroStatus[] = ['TODAS', 'ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA', 'PAGA', 'CANCELADA'];

/** Rótulo da origem — é o que distingue o lançamento automático do manual. */
const ORIGEM_LABEL: Record<string, string> = {
  PRESCRICAO_ITEM:        'Prescrição',
  VACINA:                 'Vacina',
  EXECUCAO_PRESTADOR:     'Procedimento',
  EXAME_PRESTADOR:        'Exame',
  ESTOQUE_ENTRADA:        'Compra (estoque)',
  ESTOQUE_VACINA_ENTRADA: 'Compra (vacina)',
  MANUAL:                 'Lançado à mão',
};

/** DATA PURA (dia do calendário) — vencimento e pagamento são dias acordados, não
 *  instantes, e `formatDate` não converte fuso (§6). */
const dataDia = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '—');

export default function Pagamentos() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const { loading: empresaLoading, marca } = useEmpresa();
  const { granularidade, data: dataRef } = usePeriodo();

  const podeVer    = podeExecutar('financeiro.pagamentos.ler');
  const podeLancar = podeExecutar('financeiro.pagamentos.lancar');
  const podePagar  = podeExecutar('financeiro.pagamentos.pagar');

  const [tipo,     setTipo]     = useState<TipoConta>('FORNECEDOR');
  const [contas,   setContas]   = useState<Conta[]>([]);
  const [credores, setCredores] = useState<Credor[]>([]);
  const [emitente, setEmitente] = useState<ReciboEmitente | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [disponivel, setDisponivel] = useState(true);
  const [filtro,   setFiltro]   = useState<FiltroStatus>('TODAS');

  const [erroInline, setErroInline] = useState<string | null>(null);
  const [erroAcao,   setErroAcao]   = useState<ErroAcaoDados | null>(null);
  const [cancelando, setCancelando] = useState<Conta | null>(null);
  const [removendo,  setRemovendo]  = useState<ItemConta | null>(null);
  const [mostrarLancar, setMostrarLancar] = useState(false);
  const [novo, setNovo] = useState({ credorId: '', descricao: '', valor: '', quantidade: '1', animalNome: '' });
  const [salvando, setSalvando] = useState(false);
  /** Conta cuja ação está em curso — trava SÓ a barra dela, não a tela inteira. */
  const [ocupada, setOcupada] = useState<number | null>(null);
  /** Conta cujo menu "Exportar" está aberto. */
  const [menuExport, setMenuExport] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // ── Edição do VALOR de um item (a pedido, 2026-09-18) ──────────────────────
  // É a outra metade do lançamento zerado: o procedimento sem preço cadastrado agora
  // APARECE na conta valendo 0, e é aqui que o financeiro diz quanto vale.
  const [editandoItem, setEditandoItem] = useState<number | null>(null);
  const [valorEdit,    setValorEdit]    = useState('');
  const [salvandoItem, setSalvandoItem] = useState(false);
  // ── "Marcar como Pago" pergunta a DATA DE PAGAMENTO (a pedido, 2026-09-22) ──
  // 🔴 A data é INFORMADA, não deduzida do relógio: o pagamento costuma ser registrado
  // no sistema depois de acontecer no banco, e carimbar "hoje" faria todo comprovante
  // dizer uma data que não foi a do pagamento.
  const [pagando,   setPagando]   = useState<Conta | null>(null);
  const [dataPagto, setDataPagto] = useState(hojeISO());

  const carregar = useCallback(async () => {
    try {
      const res = await api.get('/financeiro/contas-pagar', {
        params: { tipo, ...periodoParams(granularidade, dataRef) },
      });
      if (!res.data) return;                       // GET 403 resolve com data null
      setContas(res.data.dados ?? []);
      setDisponivel(res.data.recursos?.disponivel !== false);
    } catch { /* silencioso */ }
  }, [tipo, granularidade, dataRef]);

  const carregarCredores = useCallback(async () => {
    try {
      const res = await api.get('/financeiro/contas-pagar/credores', { params: { tipo } });
      if (res.data) setCredores(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, [tipo]);

  useEffect(() => {
    // ⚠️ Espera o contexto de empresa: chamada escopada antes disso cai no fallback
    // do backend e traz a conta de OUTRA clínica.
    if (loadingPerms || empresaLoading || !podeVer) return;
    setLoading(true);
    Promise.all([carregar(), carregarCredores()]).finally(() => setLoading(false));
  }, [loadingPerms, empresaLoading, podeVer, carregar, carregarCredores]);

  // O TIMBRE do recibo (identificação da clínica). Best-effort: sem ele a folha sai sem
  // emitente, nunca quebrada.
  useEffect(() => {
    if (loadingPerms || empresaLoading || !podeVer) return;
    api.get('/financeiro/contas-pagar/emitente')
      .then(r => { if (r.data) setEmitente(r.data.dados ?? null); })
      .catch(() => { /* silencioso */ });
  }, [loadingPerms, empresaLoading, podeVer]);

  // Fecha o menu de exportar ao clicar fora.
  useEffect(() => {
    if (menuExport == null) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuExport(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuExport]);

  /** Contagem por status — sempre sobre o que a tela CARREGOU no período, senão um
   *  chip marcaria "3" e devolveria lista vazia. */
  const contar = (f: FiltroStatus) =>
    f === 'TODAS' ? contas.length : contas.filter(c => c.statusExibicao === f).length;

  const visiveis = useMemo(
    () => (filtro === 'TODAS' ? contas : contas.filter(c => c.statusExibicao === filtro)),
    [contas, filtro],
  );

  const total = useMemo(
    // ⚠️ CANCELADA fica FORA do total: ela é registro do que deixou de valer, e
    // somá-la afirmaria uma dívida que a clínica já desfez.
    () => contas.filter(c => c.statusExibicao !== 'CANCELADA').reduce((s, c) => s + (c.total ?? 0), 0),
    [contas],
  );
  const totalAberto = useMemo(
    () => contas.filter(c => ['ABERTA', 'REABERTA', 'FECHADA', 'ATRASADA'].includes(c.statusExibicao))
                .reduce((s, c) => s + (c.total ?? 0), 0),
    [contas],
  );

  const mudarStatus = async (
    conta: Conta,
    status: Exclude<StatusConta, 'ATRASADA'>,
    extra: { motivo?: string; pagoEm?: string } = {},
  ) => {
    setErroAcao(null);
    setOcupada(conta.id);
    try {
      await api.patch(`/financeiro/contas-pagar/${conta.id}/status`, { status, ...extra });
      toast.success(status === 'PAGA' ? 'Pagamento registrado' : `Conta ${STATUS[status].label.toLowerCase()}`);
      setCancelando(null);
      setPagando(null);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroAcao({ mensagem: e.response?.data?.error ?? 'Erro ao alterar a conta.' });
    } finally { setOcupada(null); }
  };

  const lancar = async () => {
    setErroAcao(null);
    if (!novo.credorId)          { setErroAcao({ mensagem: 'Selecione o credor.' }); return; }
    if (!novo.descricao.trim())  { setErroAcao({ mensagem: 'Informe a descrição.' }); return; }
    const credor = credores.find(c => String(c.id) === novo.credorId);
    setSalvando(true);
    try {
      await api.post('/financeiro/contas-pagar/lancar', {
        tipo,
        credorId:   Number(novo.credorId),
        credorNome: credor?.nome ?? '',
        descricao:  novo.descricao.trim(),
        quantidade: Number(novo.quantidade) || 1,
        valor:      Number(String(novo.valor).replace(/\./g, '').replace(',', '.')),
        animalNome: novo.animalNome.trim(),
      });
      toast.success('Lançamento registrado');
      setNovo({ credorId: '', descricao: '', valor: '', quantidade: '1', animalNome: '' });
      setMostrarLancar(false);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroAcao({ mensagem: e.response?.data?.error ?? 'Erro ao lançar.' });
    } finally { setSalvando(false); }
  };

  const abrirEdicaoValor = (it: ItemConta) => {
    setEditandoItem(it.id);
    // Valor zerado abre o campo VAZIO, não com "0,00": ali o zero significa "ninguém
    // disse quanto vale", e deixá-lo escrito convida a salvar o zero sem pensar.
    setValorEdit(it.valor > 0 ? String(it.valor).replace('.', ',') : '');
  };

  const salvarValorItem = async (itemId: number) => {
    const valor = Number(String(valorEdit).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      setErroInline('Informe um valor válido.');
      return;
    }
    setSalvandoItem(true);
    try {
      await api.patch(`/financeiro/contas-pagar/itens/${itemId}`, { valor });
      toast.success('Valor atualizado');
      setEditandoItem(null);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao atualizar o valor.');
    } finally { setSalvandoItem(false); }
  };

  // ── As duas folhas ────────────────────────────────────────────────────────

  /** A conta como o DEMONSTRATIVO (fornecedor) a espera. */
  const paraImpressao = (c: Conta): ContaPagarPrint => ({
    credorNome:    c.credorNome,
    tipo:          c.tipo,
    mesReferencia: c.mesReferencia,
    vencimentoEm:  c.vencimentoEm,
    status:        STATUS[c.statusExibicao].label,
    total:         c.total,
    itens: c.itens.map(i => ({
      animalNome:      i.animalNome,
      descricao:       i.descricao,
      solicitanteNome: i.solicitanteNome,
      ocorridoEm:      i.ocorridoEm,
      quantidade:      i.quantidade ?? 1,
      valor:           i.valor,
    })),
  });

  /**
   * A conta como o RECIBO (prestador) o espera.
   *
   * ⚠️ `valorCliente`/`totalCliente` vão `null` de propósito: a conta a pagar registra
   * só o que se DEVE, e "R$ 0,00" ali afirmaria ao prestador que o cliente não pagou
   * nada pelo serviço dele. Com `null` a coluna inteira some da folha.
   * ⚠️ `valor` do item é UNITÁRIO na conta a pagar e TOTAL no recibo (a folha não
   * multiplica) — daí o `× quantidade` aqui.
   */
  const paraRecibo = (c: Conta): ReciboPrestador => {
    const credor = credores.find(x => x.id === c.credorId);
    return {
      prestadorId:    c.credorId,
      prestadorNome:  c.credorNome,
      documento:      credor?.cnpj || credor?.cpf || null,
      tipoServico:    credor?.tipoServico ?? null,
      telefone:       credor?.telefone ?? null,
      email:          credor?.email ?? null,
      // A forma de pagamento NÃO é reapurada aqui: o que o prestador recebe já está
      // congelado na conta, e recalculá-lo daria dois números para a mesma dívida.
      tipoPagamento:  null,
      formaPagamento: null,
      valorPagamento: null,
      itens: c.itens.map(i => ({
        id:           i.id,
        animal:       i.animalNome,
        procedimento: i.descricao,
        quantidade:   i.quantidade ?? 1,
        valorCliente: null,
        valor:        i.valor * (i.quantidade ?? 1),
        explicacao:   null,
        executadoEm:  i.ocorridoEm,
      })),
      totalCliente: null,
      totalAPagar:  c.total,
      pendentes:    c.itens.filter(i => !i.valor || i.valor <= 0).length,
    };
  };

  /** A janela que o recibo declara — a dos LANÇAMENTOS da conta, e não a do filtro de
   *  período: o recibo dá quitação pelo que está escrito nele. */
  const periodoDaConta = (c: Conta): ReciboPeriodo | null => {
    const datas = c.itens.map(i => new Date(i.ocorridoEm).getTime()).filter(n => !Number.isNaN(n));
    if (datas.length === 0) return null;
    return {
      granularidade: 'mes',
      inicio: new Date(Math.min(...datas)).toISOString(),
      fim:    new Date(Math.max(...datas)).toISOString(),
    };
  };

  const htmlDaConta = (c: Conta) =>
    c.tipo === 'PRESTADOR'
      ? gerarHtmlRecibos([paraRecibo(c)], periodoDaConta(c), emitente, marca.logoUrl)
      : gerarHtmlContasPagar([paraImpressao(c)], marca.logoUrl);

  const imprimir = (c: Conta) => {
    if (c.tipo === 'PRESTADOR') imprimirRecibos([paraRecibo(c)], periodoDaConta(c), emitente, marca.logoUrl);
    else                        imprimirContasPagar([paraImpressao(c)], marca.logoUrl);
  };

  /** Nome do arquivo e rótulo do documento — o recibo e o demonstrativo NÃO são a
   *  mesma coisa, e o anexo que chega ao credor precisa dizer qual dos dois é. */
  const rotuloDoc = (c: Conta) =>
    c.tipo === 'PRESTADOR'
      ? { documento: 'Recibo de pagamento', arquivo: 'recibo' }
      : { documento: 'Demonstrativo de valores a pagar', arquivo: 'valores-a-pagar' };

  const opcoesEnvio = (c: Conta) => {
    const { documento, arquivo } = rotuloDoc(c);
    const slug = c.credorNome.replace(/\s+/g, '-').toLowerCase();
    return {
      gerarHtml:   () => htmlDaConta(c),
      nomeArquivo: `${arquivo}-${slug}.pdf`,
      titulo:      `${documento} — ${c.credorNome}`,
      texto:       `${documento}${c.mesReferencia ? ` — ${c.mesReferencia}` : ''}.`,
      documento,
    };
  };

  const enviarWhatsApp = async (conta: Conta) => {
    const credor = credores.find(c => c.id === conta.credorId);
    // ⚠️ O destino é o telefone do CREDOR. `credores` só traz quem está ATIVO; sem
    // telefone o `compartilharPdf` cai no fallback manual (baixa o PDF e abre o app),
    // que é melhor do que não oferecer a ação.
    await enviarPdfWhatsAppComAviso(opcoesEnvio(conta), credor?.telefone ?? null);
  };

  const enviarEmail = async (conta: Conta) => {
    const credor = credores.find(c => c.id === conta.credorId);
    await enviarPdfEmailComAviso(opcoesEnvio(conta), credor?.email ?? null);
  };

  const removerItem = async (motivo: string) => {
    if (!removendo) return;
    try {
      await api.delete(`/financeiro/contas-pagar/itens/${removendo.id}`, { data: { motivo } });
      toast.success('Item removido');
      setRemovendo(null);
      await carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao remover o item.');
    }
  };

  if (!loadingPerms && !podeVer) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-800">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500 mt-1">Você não tem permissão para ver os pagamentos.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <BotaoVoltar />
      {erroInline && <InlineError message={erroInline} />}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet size={22} className="text-emerald-600" /> Pagamentos
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            O que a clínica deve a fornecedores e prestadores.
          </p>
        </div>
        {podeLancar && (
          /* "Novo Pagamento" e não "Lançar" (2026-09-23, a pedido): o verbo sozinho não
             dizia o que nasce do clique, e a tela inteira fala em pagamentos. */
          <button onClick={() => setMostrarLancar(v => !v)}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            <Plus size={15} /> Novo Pagamento
          </button>
        )}
      </div>

      <PeriodoSelector />

      {!disponivel && (
        <div className="my-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-snug">
            <strong>Pagamentos ainda não disponível nesta base.</strong> Falta aplicar a migration{' '}
            <code className="font-mono">20261006000000_produtos_contas_pagar</code>.
          </p>
        </div>
      )}

      {/* ── Abas Fornecedor × Prestador ────────────────────────────────────── */}
      <div className="flex items-center gap-2 my-4">
        {(['FORNECEDOR', 'PRESTADOR'] as TipoConta[]).map(t => {
          const ativo = tipo === t;
          const Icone = t === 'PRESTADOR' ? HardHat : Truck;
          return (
            <button key={t} onClick={() => setTipo(t)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                ativo ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <Icone size={15} /> {t === 'PRESTADOR' ? 'Prestadores' : 'Fornecedores'}
            </button>
          );
        })}
      </div>

      {/* ── Filtro por STATUS — os MESMOS da fatura (ver o cabeçalho) ──────── */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {FILTROS.map(f => {
          const qtd   = contar(f);
          const cor   = f === 'TODAS' ? 'bg-gray-700' : STATUS[f].pilula;
          const label = f === 'TODAS' ? 'Todas' : STATUS[f].label;
          return (
            <button key={f} type="button" onClick={() => setFiltro(f)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                filtro === f ? `${cor} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}>
              {label} ({qtd})
            </button>
          );
        })}
      </div>

      {/* Totais do período — o "quanto vou pagar" é a primeira pergunta da tela. */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total no período</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{brl(total)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">A pagar</p>
          <p className="text-xl font-bold text-amber-700 mt-1">{brl(totalAberto)}</p>
        </div>
      </div>

      {mostrarLancar && podeLancar && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                {tipo === 'PRESTADOR' ? 'Prestador' : 'Fornecedor'} *
              </label>
              <select value={novo.credorId} onChange={e => setNovo(n => ({ ...n, credorId: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-emerald-400">
                <option value="">Selecione…</option>
                {credores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Descrição *</label>
              <input value={novo.descricao} onChange={e => setNovo(n => ({ ...n, descricao: e.target.value }))}
                placeholder="O que está sendo pago"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Valor *</label>
              <input value={novo.valor} onChange={e => setNovo(n => ({ ...n, valor: e.target.value }))}
                inputMode="decimal" placeholder="0,00"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none focus:border-emerald-400" />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            <button onClick={() => setMostrarLancar(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Cancelar</button>
            <button onClick={lancar} disabled={salvando}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Lançar
            </button>
          </div>
          <ErroAcao erro={erroAcao} />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-14"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
      ) : visiveis.length === 0 ? (
        <div className="text-center py-14 text-gray-400 text-sm">
          {contas.length === 0
            ? `Nenhuma conta de ${tipo === 'PRESTADOR' ? 'prestador' : 'fornecedor'} no período.`
            : `Nenhuma conta ${STATUS[filtro as StatusConta].label.toLowerCase()} no período.`}
        </div>
      ) : (
        <div className="space-y-3">
          {visiveis.map(conta => {
            const st       = conta.statusExibicao;
            const editavel = st === 'ABERTA' || st === 'REABERTA';
            const emCurso  = ocupada === conta.id;
            return (
            <div key={conta.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {/* Cabeçalho: quem, referência, VENCIMENTO e total.
                  🔴 O vencimento fica AQUI, e não como coluna da tabela de itens: ele é
                  da CONTA (vem do cadastro do credor), e repeti-lo em cada linha diria o
                  mesmo número dezenas de vezes sem nunca variar. */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-50">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{conta.credorNome}</p>
                  <p className="text-[11px] text-gray-400">
                    {conta.mesReferencia ?? '—'} · {conta.itens.length} lançamento(s)
                  </p>
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-right">
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Data de Vencimento</p>
                    <p className={`text-sm font-semibold ${st === 'ATRASADA' ? 'text-red-600' : 'text-gray-800'}`}>
                      {dataDia(conta.vencimentoEm)}
                    </p>
                  </div>
                  {conta.pagoEm && (
                    <div className="text-right">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wide">Data de Pagamento</p>
                      <p className="text-sm font-semibold text-emerald-700">{dataDia(conta.pagoEm)}</p>
                    </div>
                  )}
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS[st].cls}`}>
                    {STATUS[st].label}
                  </span>
                  <span className="font-bold text-gray-900">{brl(conta.total)}</span>
                </div>
              </div>

              {/* 🔴 Sem esta faixa, a conta paga só aparece SEM os botões de editar e
                  a pessoa conclui que perdeu permissão — o mesmo motivo (e o mesmo
                  texto) da faixa da fatura paga em `Faturamento.tsx`. */}
              {st === 'PAGA' && (
                <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <p className="text-xs font-semibold text-emerald-900">Conta paga — somente leitura.</p>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    Os lançamentos não podem ser alterados nem removidos. Imprimir, exportar
                    e enviar por e-mail/WhatsApp continuam disponíveis.
                    {isGestor
                      ? ' Para voltar a lançar, use Reabrir — a reabertura fica registrada na auditoria.'
                      : ' Reabrir uma conta paga é ação do gestor.'}
                  </p>
                </div>
              )}

              {/* ── Barra de ações — a MESMA da fatura (rótulo visível, tom por
                  significado). Ação sem permissão NÃO é renderizada (28-d). */}
              <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 border-b border-gray-50 bg-gray-50/40">
                {/* 🔴 Reabrir existe para que um clique errado em "Marcar como Pago" não
                    congele a dívida para sempre — e é o que torna REABERTA alcançável.
                    ⚠️ **Da conta PAGA, só o GESTOR reabre** (2026-09-23) — a MESMA regra
                    da fatura paga, e o backend recusa os demais. Por isso o botão nem
                    aparece para quem não é: botão que só falha no clique é 28-d. */}
                {podePagar && (st === 'FECHADA' || st === 'ATRASADA' || (st === 'PAGA' && isGestor)) && (
                  <button onClick={() => mudarStatus(conta, 'REABERTA')} disabled={emCurso}
                    className={`${BTN_ACAO} ${TOM_ACAO.alterar}`}>
                    {emCurso ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Reabrir
                  </button>
                )}
                {podePagar && editavel && (
                  <button onClick={() => mudarStatus(conta, 'FECHADA')} disabled={emCurso}
                    className={`${BTN_ACAO} ${TOM_ACAO.finalizar}`}>
                    {emCurso ? <Loader2 size={11} className="animate-spin" /> : <Lock size={13} />} Fechar Pagamento
                  </button>
                )}
                {podePagar && st !== 'PAGA' && st !== 'CANCELADA' && (
                  <button
                    onClick={() => { setDataPagto(hojeISO()); setPagando(conta); }}
                    disabled={emCurso}
                    className={`${BTN_ACAO} ${TOM_ACAO.finalizar}`}>
                    {emCurso ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={13} />} Marcar como Pago
                  </button>
                )}
                {/* E-mail, WhatsApp, Imprimir e Exportar são SAÍDA DE CONTEÚDO — valem em
                    qualquer status, inclusive na conta paga ou cancelada: é justamente a
                    conta encerrada que alguém precisa reenviar para conferir. */}
                <button onClick={() => enviarEmail(conta)} className={`${BTN_ACAO} ${TOM_ACAO.email}`}>
                  <Mail size={13} /> E-mail
                </button>
                <button onClick={() => enviarWhatsApp(conta)} className={`${BTN_ACAO} ${TOM_ACAO.whatsapp}`}>
                  <MessageCircle size={13} /> WhatsApp
                </button>
                <button onClick={() => imprimir(conta)} className={`${BTN_ACAO} ${TOM_ACAO.imprimir}`}>
                  <Printer size={13} /> Imprimir
                </button>
                <div className="relative" ref={menuExport === conta.id ? menuRef : undefined}>
                  <button onClick={() => setMenuExport(v => (v === conta.id ? null : conta.id))}
                    className={`${BTN_ACAO} ${TOM_ACAO.exportar}`}>
                    <Download size={13} /> Exportar <ChevronDown size={11} />
                  </button>
                  {menuExport === conta.id && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
                      <button
                        onClick={() => { exportarContaPagarCSV(paraImpressao(conta)); setMenuExport(null); toast.success('CSV gerado'); }}
                        className="w-full text-left px-4 py-2 text-xs text-amber-800 hover:bg-amber-50 flex items-center gap-2">
                        <Download size={13} /> CSV (.csv)
                      </button>
                    </div>
                  )}
                </div>
                {podePagar && st !== 'CANCELADA' && st !== 'PAGA' && (
                  <button onClick={() => setCancelando(conta)} disabled={emCurso}
                    className={`${BTN_ACAO} ${TOM_ACAO.cancelar}`}>
                    <Ban size={13} /> Cancelar
                  </button>
                )}
              </div>

              <JanelaLista maxItens={3}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-50">
                      {/* 🔴 O ANIMAL SÓ APARECE NA ABA DE PRESTADORES (2026-09-19, a pedido:
                          "na tela de pagamentos fornecedores retire a coluna animal"). A conta
                          do FORNECEDOR é uma COMPRA — o que importa é o produto e QUANTAS
                          embalagens vieram; o paciente não tem papel nenhum ali. Na do
                          PRESTADOR o animal é o serviço em si ("o ferrageamento do Thor"), e
                          tirá-lo deixaria a linha sem dizer sobre quem ele trabalhou. */}
                      {tipo === 'PRESTADOR' && <th className="px-4 py-2 font-semibold">Animal</th>}
                      <th className="px-4 py-2 font-semibold">Item</th>
                      <th className="px-4 py-2 font-semibold">Solicitante</th>
                      {/* Quantidade — nas DUAS abas. O valor da linha é valor × quantidade;
                          sem a coluna, o total aparece ao lado de um unitário invisível e não há
                          como conferir a compra contra a nota. */}
                      <th className="px-4 py-2 font-semibold text-center whitespace-nowrap">Qtd.</th>
                      {/* 🔴 VALOR UNITÁRIO — só na aba de FORNECEDORES (2026-09-23, a
                          pedido). A conta dele é uma COMPRA, e é o unitário que se
                          confere contra a nota: a coluna "Valor" traz o total da linha
                          (unitário × quantidade), então sem esta a pessoa tinha de
                          dividir de cabeça para saber por quanto cada frasco entrou.
                          ⚠️ Fora da aba de PRESTADOR de propósito: ali a linha é um
                          serviço executado, quase sempre de quantidade 1, e o unitário
                          repetiria o total em toda linha. Mesmo critério da coluna
                          "Animal", que é só do prestador. */}
                      {tipo === 'FORNECEDOR' && (
                        <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Valor Unit.</th>
                      )}
                      {/* "Data do Pedido" (2026-09-22): é a data do FATO GERADOR — a entrada
                          no estoque, na compra, e a execução, no serviço —, nunca a do
                          lançamento. */}
                      <th className="px-4 py-2 font-semibold whitespace-nowrap">Data do Pedido</th>
                      <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">Valor</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {conta.itens.map(it => (
                      <tr key={it.id} className="border-b border-gray-50 last:border-0">
                        {tipo === 'PRESTADOR' && (
                          <td className="px-4 py-2 text-gray-700">{it.animalNome || '—'}</td>
                        )}
                        <td className="px-4 py-2">
                          <span className="text-gray-900">{it.descricao}</span>
                          {it.origemTipo && (
                            <span className="ml-2 text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                              {ORIGEM_LABEL[it.origemTipo] ?? it.origemTipo}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{it.solicitanteNome || '—'}</td>
                        <td className="px-4 py-2 text-center text-gray-700 whitespace-nowrap">{fmtQtdForma(it.quantidade ?? 1)}</td>
                        {tipo === 'FORNECEDOR' && (
                          <td className="px-4 py-2 text-right text-gray-600 whitespace-nowrap">
                            {/* "a definir" e não "R$ 0,00": o item sem preço é uma
                                PENDÊNCIA, e zero se leria como "é de graça". Mesma
                                decisão da coluna de valor ao lado. */}
                            {it.valor > 0 ? brl(it.valor) : <span className="text-amber-700 text-xs">a definir</span>}
                          </td>
                        )}
                        <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">
                          {/* INSTANTE — `formatDataHora`, nunca `formatDate` (§6): a
                              execução das 22h cairia no dia seguinte lida em UTC. */}
                          {formatDataHora(it.ocorridoEm)}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-800 whitespace-nowrap">
                          {editandoItem === it.id ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                autoFocus
                                value={valorEdit}
                                onChange={e => setValorEdit(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') salvarValorItem(it.id);
                                  if (e.key === 'Escape') setEditandoItem(null);
                                }}
                                placeholder="0,00"
                                className="w-24 border border-emerald-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500"
                              />
                              <AcaoRegistro tom="finalizar" icone={Check} rotulo="Salvar"
                                carregando={salvandoItem} onClick={() => salvarValorItem(it.id)} />
                              <AcaoRegistro tom="cancelar" icone={X} rotulo="Cancelar"
                                onClick={() => setEditandoItem(null)} />
                            </div>
                          ) : it.valor > 0 ? (
                            brl(it.valor * (it.quantidade ?? 1))
                          ) : (
                            /* 🔴 O ITEM SEM VALOR É UMA PENDÊNCIA, e precisa parecer uma.
                               "R$ 0,00" se leria como "é de graça" — e some no meio dos
                               outros números. Ele existe justamente porque ninguém
                               precificou o procedimento ainda. */
                            <span className="text-amber-700 text-xs font-semibold">a definir</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {/* Conta FECHADA/PAGA é somente leitura: mexer no item de um
                              pagamento já conferido mudaria um documento que o credor
                              recebeu. O backend recusa, então a ação nem é renderizada
                              (28-d). */}
                          <AcoesRegistro>
                            <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Editar valor"
                              visivel={podeLancar && editavel && editandoItem !== it.id}
                              onClick={() => abrirEdicaoValor(it)} />
                            {/* Só conta EM ABERTO (2026-09-23) — a MESMA regra do item de
                                fatura fechada, e a que o backend passou a impor. Conta
                                FECHADA/PAGA é documento que o credor já recebeu. */}
                            <AcaoRegistro tom="cancelar" icone={Trash2} rotulo="Remover"
                              visivel={podeLancar && editavel}
                              onClick={() => setRemovendo(it)} />
                          </AcoesRegistro>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </JanelaLista>
            </div>
            );
          })}
        </div>
      )}

      <ErroAcao erro={erroAcao} />

      {/* ── Marcar como Pago: a DATA DE PAGAMENTO ────────────────────────────
          ⚠️ `DateInput`, nunca `<input type="date">` cru (§6): o nativo exibe
          MM/DD/AAAA quando o locale do navegador é en-US. */}
      {pagando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 rounded-t-2xl">
              <h3 className="text-sm font-bold text-gray-900">Registrar pagamento</h3>
              <button onClick={() => setPagando(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                Conta de <strong>{pagando.credorNome}</strong> — {brl(pagando.total)}.
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Data de Pagamento</label>
                <DateInput
                  value={dataPagto}
                  onChange={setDataPagto}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus-within:border-emerald-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Informe o dia em que o pagamento aconteceu — pode ser anterior a hoje.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setPagando(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100">Cancelar</button>
              <button
                // ⚠️ Data vazia (o `DateInput` zera o valor inválido) NÃO envia: sem ela
                // o backend cairia no relógio e gravaria a data da digitação.
                disabled={!dataPagto || ocupada === pagando.id}
                onClick={() => mudarStatus(pagando, 'PAGA', { pagoEm: dataPagto })}
                className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold">
                {ocupada === pagando.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Confirmar pagamento
              </button>
            </div>
            {/* Erro da AÇÃO abaixo do botão que a disparou, nunca no topo (§6). */}
            <div className="px-5 pb-4"><ErroAcao erro={erroAcao} /></div>
          </div>
        </div>
      )}

      <ModalJustificativa
        aberto={!!cancelando}
        titulo="Cancelar conta a pagar"
        descricao={cancelando ? `Cancelar a conta de ${cancelando.credorNome} (${brl(cancelando.total)})?` : ''}
        acaoLabel="Cancelar conta"
        onConfirmar={async motivo => { if (cancelando) await mudarStatus(cancelando, 'CANCELADA', { motivo }); }}
        onFechar={() => setCancelando(null)}
      />

      <ModalJustificativa
        aberto={!!removendo}
        titulo="Remover lançamento"
        descricao={removendo ? `Remover "${removendo.descricao}" desta conta?` : ''}
        acaoLabel="Remover"
        onConfirmar={removerItem}
        onFechar={() => setRemovendo(null)}
      />
    </PageContainer>
  );
}
