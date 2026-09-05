// frontend/src/pages/Faturamento.tsx
// Módulo Financeiro — Faturamento por proprietário, consolidando todos os animais

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import { usePermissoes } from '../hooks/usePermissoes';
import {
  DollarSign, Search, Loader2, Trash2,
  Pencil, Check, X, RefreshCw, Receipt,
  CheckCircle2, Download, Printer, ChevronDown, MessageCircle, Mail,
  Link2, Ban, Eye,
} from 'lucide-react';
import { imprimirFatura, exportarFaturaCSV, gerarHtmlFatura } from '../utils/FaturaExport';
import { carregarComoDataUri } from '../utils/printUrl';
import { abrirWhatsApp, abrirEmail } from '../utils/compartilhar';
import { ordenarComInsumos } from '../utils/faturaInsumos';
import InlineError from '../components/InlineError';
import JanelaLista from '../components/JanelaLista';
import FotoAnimal from '../components/FotoAnimal';
import ConfirmModal from '../components/ConfirmModal';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type FaturaStatus = 'ABERTA' | 'PAGA' | 'CANCELADA' | 'FECHADA' | 'ATRASADA';
type ItemTipo     = 'ASSISTENCIA' | 'TRANSPORTE' | 'MEDICAMENTO' | 'PROCEDIMENTO';
/** Desconto do item: percentual sobre o bruto ou abatimento em reais */
type DescontoTipo = 'PERCENTUAL' | 'VALOR';

interface AnimalResumo {
  id: number; nome: string; photoUrl?: string;
  especie?: { nome: string }; raca?: { nome: string };
}

/** Atendimento que ORIGINOU a cobrança — resolvido pelo backend a partir da FK de
 *  origem do item (prescrição/exame/vacina/encaminhamento → evolução). `null` em
 *  item sem origem clínica: assistência mensal, lançamento manual, item "Outros"
 *  do orçamento — nesses não há para onde ir e o número não vira link. */
interface OrigemAtendimento {
  evolucaoId: number;
  animalId: number;
  agendamentoId: number | null;
  atendimentoNumero: string | null;
}

interface FaturaItem {
  id: number; faturaId: number; animalId?: number; tipo: string;
  descricao: string; valor: number; quantidade: number;
  descontoTipo?: DescontoTipo | null; descontoValor?: number;
  criadoEm?: string;
  veterinario?: { id: number; fullName: string };
  animal?: AnimalResumo;
  origem?: OrigemAtendimento | null;
  /** Item de prescrição que originou a linha — dose, seringa e agulha da MESMA
   *  aplicação compartilham este id. É por ele que os insumos são agrupados. */
  prescricaoItemId?: number | null;
  /** Preenchido só no INSUMO de aplicação (seringa/agulha da via injetável): repete
   *  o `prescricaoItemId` do medicamento que o consumiu. `null` na dose e em
   *  qualquer outra linha. Resolvido pelo backend — ver `comOrigemDoItem`. */
  insumoDe?: number | null;
  /** Nome do medicamento pai — só no insumo, para o tooltip da linha recuada. */
  medicamentoPai?: string | null;
}

interface Fatura {
  id: number; proprietarioId: number; mesReferencia?: string;
  total: number; status: FaturaStatus; criadoEm: string;
  itens: FaturaItem[];
  proprietario?: { id: number; fullName: string; email: string; phone?: string; valorAssistencia?: number; mensalista?: boolean };
}

interface FaturaResumo {
  id: number; total: number; status: FaturaStatus; mesReferencia?: string;
}

// Link público de fatura (WhatsApp/e-mail) — GET /clinica/faturas/:id/links.
type LinkStatus = 'PENDENTE' | 'ENVIADO' | 'FALHOU' | 'FALHOU_DEFINITIVO';
interface FaturaLink {
  id: number; canal: 'WHATSAPP' | 'EMAIL' | null; destino: string | null;
  status: LinkStatus; tentativas: number; ultimoErro?: string | null;
  enviadoEm?: string | null; proximaTentativaEm?: string | null;
  revogadoEm?: string | null; ultimoAcessoEm?: string | null; qtdAcessos: number;
  expiraEm: string; criadoEm: string;
}

interface ProprietarioItem {
  id: number; fullName: string; email: string; phone?: string;
  valorAssistencia?: number; mensalista?: boolean;
  // Proprietário INATIVADO ainda aparece aqui quando tem PACIENTE ativo na empresa —
  // e é por isso que o selo "Inativo" existe. ⚠️ Desde 2026-09-02 cliente SEM NENHUM
  // paciente não entra na lista, nem com fatura pendente (a tela é por paciente) —
  // ver o filtro em FaturaController.listarProprietarios.
  ativo?: boolean;
  animais: AnimalResumo[];
  faturaAtiva?:    FaturaResumo | null;
  faturaFechada?:  FaturaResumo | null;
  faturaAtrasada?: FaturaResumo | null;
  faturaPaga?:     FaturaResumo | null;
}

interface CatalogoItem {
  id: number; tipo: string; descricao: string; valor: number;
}

// ─── Catálogo de itens comuns ─────────────────────────────────────────────────

const CATALOGO: Array<{ label: string; tipo: ItemTipo; descricao: string; valor: number }> = [
  { label: 'Assistência Veterinária', tipo: 'ASSISTENCIA', descricao: 'Assistência Veterinária', valor: 0 },
  { label: 'Atd. Emergencial',        tipo: 'ASSISTENCIA', descricao: 'Atd. Emergencial',         valor: 0 },
  { label: 'GTA',                     tipo: 'TRANSPORTE',  descricao: 'GTA',                      valor: 0 },
  { label: 'Deslocamento',            tipo: 'TRANSPORTE',  descricao: 'Deslocamento',              valor: 0 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function formatMes(ref?: string) {
  if (!ref) return '';
  const [ano, mes] = ref.split('-');
  return `${MESES[Number(mes) - 1]}/${ano}`;
}

function formatBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const TIPOS_FIXOS = ['ASSISTENCIA', 'TRANSPORTE', 'MEDICAMENTO', 'PROCEDIMENTO'];

/** "TRANSPORTE" → "Transporte", "TAXA DE URGENCIA" → "Taxa De Urgencia" — só para
 *  rótulo; o valor gravado/comparado continua o texto em CAIXA ALTA original. */
function capitalizarTipo(t: string) {
  return t.toLowerCase().split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

const TIPO_COR: Record<string, string> = {
  ASSISTENCIA:  'bg-blue-100 text-blue-700',
  TRANSPORTE:   'bg-cyan-100 text-cyan-700',
  MEDICAMENTO:  'bg-purple-100 text-purple-700',
  PROCEDIMENTO: 'bg-emerald-100 text-emerald-700',
  OUTROS:       'bg-amber-100 text-amber-700',
};

// ─── Dropdown flutuante — abre para CIMA do campo ─────────────────────────────
// Um <select> nativo deixa o navegador/SO decidir a direção — não dá pra forçar
// isso em HTML puro. Este combo substitui os selects de Tipo/Item Fatura por um
// botão + lista própria, ancorada pela BORDA DE BAIXO (`bottom`, não `top`): com
// `position: fixed` isso faz o conteúdo crescer para cima sozinho, sem precisar
// medir a altura da lista antes de posicionar.
// ⚠️ A lista vai num PORTAL para `document.body`, não `position: absolute` dentro
// do card: o painel da fatura rola dentro de um container com `overflow-y-auto`
// (PainelFatura), e QUALQUER `absolute` que tentasse ultrapassar a borda dele
// era recortado ali — a lista parecia "abrir para dentro do card", cortada, por
// mais alto que o z-index fosse (overflow corta antes do z-index decidir nada).
// `position: fixed` com coordenadas de `getBoundingClientRect()` escapa desse
// recorte porque o portal é filho de `body`, fora da árvore que rola.
function DropdownAbaixo({ value, options, placeholder, actionLabel, onChange, onAction }: {
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  actionLabel: string;
  onChange: (v: string) => void;
  onAction: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const atualizarPosicao = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // `bottom` é a distância do RODAPÉ da viewport até o TOPO do campo — ancora
    // a lista ali e ela cresce para cima.
    setPos({ bottom: window.innerHeight - r.top + 4, left: r.left, width: r.width });
  };

  // Recalcula ao abrir e a cada scroll/resize (a lista é `fixed`, não acompanha
  // o campo sozinha) — `true` no listener de scroll captura o scroll do
  // CONTAINER da fatura, não só da janela (scroll ali não borbulha até `window`
  // sem a fase de captura).
  useEffect(() => {
    if (!aberto) return;
    atualizarPosicao();
    const onScrollOuResize = () => atualizarPosicao();
    window.addEventListener('scroll', onScrollOuResize, true);
    window.addEventListener('resize', onScrollOuResize);
    return () => {
      window.removeEventListener('scroll', onScrollOuResize, true);
      window.removeEventListener('resize', onScrollOuResize);
    };
  }, [aberto]);

  // Clique fora fecha — precisa checar os DOIS nós (botão + lista), já que a
  // lista está no portal e não é mais descendente do botão no DOM.
  useEffect(() => {
    const onClickFora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (btnRef.current?.contains(alvo) || listRef.current?.contains(alvo)) return;
      setAberto(false);
    };
    document.addEventListener('mousedown', onClickFora);
    return () => document.removeEventListener('mousedown', onClickFora);
  }, []);

  const atual = options.find(o => o.value === value);

  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between border border-gray-300 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:border-indigo-400 bg-white">
        <span className={`truncate ${atual ? 'text-gray-900' : 'text-gray-400'}`}>{atual ? atual.label : placeholder}</span>
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 ml-2 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>
      {aberto && pos && createPortal(
        <div ref={listRef}
          style={{ position: 'fixed', bottom: pos.bottom, left: pos.left, width: pos.width }}
          className="z-50 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          <ul className="max-h-56 overflow-y-auto">
            <li>
              <button type="button" onClick={() => { onChange(''); setAberto(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${!value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-400'}`}>
                {placeholder}
              </button>
            </li>
            {options.map(o => (
              <li key={o.value}>
                <button type="button" onClick={() => { onChange(o.value); setAberto(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${value === o.value ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-800'}`}>
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
          {/* Sempre no rodapé, fixo — lista vazia (ex.: tipo sem item cadastrado)
              só deixa ela como a única opção depois do placeholder, naturalmente,
              sem precisar de nenhum caso especial. */}
          <button type="button" onClick={() => { setAberto(false); onAction(); }}
            className="w-full text-left px-3 py-2 text-sm text-indigo-600 font-semibold hover:bg-indigo-50 border-t border-gray-100 transition-colors">
            {actionLabel}
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Desconto do item (espelha lib/faturaUtils.js no backend) ─────────────────

/** Abatimento em R$ do item — PERCENTUAL incide sobre o bruto; VALOR é direto. */
function descontoDoItem(i: { valor: number; quantidade: number; descontoTipo?: DescontoTipo | null; descontoValor?: number }) {
  const bruto = i.valor * i.quantidade;
  const d     = Number(i.descontoValor ?? 0);
  if (!d || d <= 0) return 0;
  const abatimento = i.descontoTipo === 'PERCENTUAL' ? bruto * (Math.min(d, 100) / 100) : d;
  return Math.min(Math.max(abatimento, 0), Math.max(bruto, 0));
}

/** Valor do item que entra no total da fatura: bruto − desconto. */
function totalItem(i: { valor: number; quantidade: number; descontoTipo?: DescontoTipo | null; descontoValor?: number }) {
  return i.valor * i.quantidade - descontoDoItem(i);
}

// WhatsApp exige número internacional (Brasil: 55 + DDD + número).
function foneIntl(phone?: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

function montarTextoFatura(fatura: Fatura, prop: ProprietarioItem): string {
  const nomeDestinatario = prop.fullName;
  return [
    `*Fatura — ${nomeDestinatario}*`,
    fatura.mesReferencia ? `Mês: ${formatMes(fatura.mesReferencia)}` : '',
    `Ref: INV-${String(fatura.id).padStart(3, '0')}`,
    `Total: ${formatBRL(fatura.total)}`,
  ].filter(Boolean).join('\n');
}

// Mês anterior no formato "YYYY-MM" (padrão do fechamento em lote)
function mesAnterior(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function montarTextoFaturaLote(nome: string, mesRef: string | undefined, faturaId: number, total: number): string {
  return [
    `*Fatura — ${nome}*`,
    mesRef ? `Mês: ${formatMes(mesRef)}` : '',
    `Ref: INV-${String(faturaId).padStart(3, '0')}`,
    `Total: ${formatBRL(total)}`,
  ].filter(Boolean).join('\n');
}

// ─── Nº do atendimento na linha da fatura ─────────────────────────────────────
// A descrição gravada no item já começa com o número do atendimento entre colchetes
// ("[AG-0012] Amoxicilina — 10mL × 12/12h"): é ele que o financeiro usa para saber de
// onde veio a cobrança. Aqui esse prefixo sai do texto e vira BOTÃO, para não aparecer
// duas vezes na mesma linha.
//
// ⚠️ Só remove quando o prefixo é EXATAMENTE o número que o backend resolveu pela FK de
// origem. Descrição editada à mão pelo financeiro, ou item de outra origem, fica
// intacta — é texto do usuário, não formato garantido.
function descricaoSemNumero(descricao: string, numero?: string | null): string {
  if (!numero) return descricao;
  const prefixo = `[${numero}]`;
  return descricao.startsWith(prefixo) ? descricao.slice(prefixo.length).trimStart() : descricao;
}

// ─── Linha de item editável ───────────────────────────────────────────────────

function ItemRow({
  item, canEdit, onDelete, onSave,
}: {
  item: FaturaItem;
  canEdit: boolean;
  onDelete: (id: number) => void;
  onSave: (id: number, patch: Partial<FaturaItem>) => void;
}) {
  const navigate = useNavigate();

  // Nº do atendimento — só vira link quando o backend resolveu a origem clínica E há
  // paciente para abrir a tela de Atendimento (ela é sempre POR PACIENTE).
  const origem = item.origem ?? null;
  // INSUMO (seringa/agulha) é linha FILHA: recua e NÃO repete o nº do atendimento —
  // ele já está na linha do medicamento logo acima, e repetir a cada filho tiraria
  // justamente a leitura de "estes três são a mesma aplicação".
  const ehInsumo = item.insumoDe != null;
  const numeroAtendimento = !ehInsumo && origem?.evolucaoId && origem?.animalId
    ? origem.atendimentoNumero
    : null;

  /**
   * Abre o atendimento de origem na tela de Atendimento, com a evolução já aberta.
   *
   * `?evolucao=` é lido pelo shell (`Atendimento.tsx`) e alimenta o `openItemId` —
   * `openItemId` é estado, então quem chega de outra tela não tem como setá-lo; o
   * item precisa viajar na URL (mesma razão do `?item=` da Vacina).
   * `agendamentoId` vai junto quando o atendimento nasceu de um AGENDAMENTO (número
   * AG-xxxx): é o parâmetro que o shell já usa para amarrar a tela ao agendamento,
   * então o mesmo clique cobre os dois destinos pedidos — a evolução e o agendamento
   * que a originou. Atendimento avulso (EV-xxxx) não tem agendamento e vai sem ele.
   */
  const abrirAtendimento = () => {
    if (!origem?.evolucaoId || !origem?.animalId) return;
    const params = new URLSearchParams({ evolucao: String(origem.evolucaoId) });
    if (origem.agendamentoId) params.set('agendamentoId', String(origem.agendamentoId));
    navigate(`/clinica/evolucao/${origem.animalId}?${params.toString()}`);
  };

  const fmtNum = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const parseCents = (raw: string) => parseInt(raw.replace(/\D/g, '') || '0', 10) / 100;

  const [editing,       setEditing]       = useState(false);
  const [desc,          setDesc]          = useState(item.descricao);
  const [tipo,          setTipo]          = useState(item.tipo);
  const [qty,           setQty]           = useState(String(item.quantidade));
  const [valorUnit,     setValorUnit]     = useState(item.valor);
  const [valorUnitStr,  setValorUnitStr]  = useState(fmtNum(item.valor));
  const [, setValorFinal]                 = useState(item.valor * item.quantidade);
  const [valorFinalStr, setValorFinalStr] = useState(fmtNum(item.valor * item.quantidade));
  // Desconto — tipo + valor. descTipo '' = sem desconto (limpa o campo ao salvar).
  // Percentual é exibido inteiro (10 = 10%); valor em R$ usa o formato monetário.
  const fmtDesc = (tipo: DescontoTipo | '' | null | undefined, v: number) =>
    !v ? '' : (tipo === 'PERCENTUAL' ? String(v) : fmtNum(v));
  const [descTipo,      setDescTipo]      = useState<DescontoTipo | ''>(item.descontoTipo ?? '');
  const [descValor,     setDescValor]     = useState(item.descontoValor ?? 0);
  const [descValorStr,  setDescValorStr]  = useState(fmtDesc(item.descontoTipo, item.descontoValor ?? 0));
  const [saving,        setSaving]        = useState(false);

  const descontoAtual = descontoDoItem(item);
  // Prévia do abatimento com o que está sendo editado (antes de salvar)
  const previaBruto    = valorUnit * Math.max(1, parseInt(qty) || 1);
  const previaDesconto = descontoDoItem({
    valor: valorUnit, quantidade: Math.max(1, parseInt(qty) || 1),
    descontoTipo: descTipo || null, descontoValor: descValor,
  });

  const handleDescValorChange = (raw: string) => {
    // Percentual é digitado direto (ex: 10 = 10%); em R$ vale a máscara de centavos
    const v = descTipo === 'PERCENTUAL'
      ? Math.min(100, Number(raw.replace(/\D/g, '') || '0'))
      : parseCents(raw);
    setDescValor(v);
    setDescValorStr(fmtDesc(descTipo, v));
  };

  const handleDescTipoChange = (t: DescontoTipo | '') => {
    setDescTipo(t);
    // Trocar de tipo zera o valor — 10% e R$ 10,00 não são a mesma coisa
    setDescValor(0);
    setDescValorStr('');
  };

  const handleUnitChange = (raw: string) => {
    const unit = parseCents(raw);
    setValorUnit(unit);
    setValorUnitStr(unit === 0 ? '' : fmtNum(unit));
    const q = Math.max(1, parseInt(qty) || 1);
    const final = unit * q;
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
  };

  const handleFinalChange = (raw: string) => {
    const final = parseCents(raw);
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
    const q = Math.max(1, parseInt(qty) || 1);
    const unit = final / q;
    setValorUnit(unit);
    setValorUnitStr(unit === 0 ? '' : fmtNum(unit));
  };

  const handleQtyChange = (raw: string) => {
    setQty(raw);
    const q = Math.max(1, parseInt(raw) || 1);
    const final = valorUnit * q;
    setValorFinal(final);
    setValorFinalStr(final === 0 ? '' : fmtNum(final));
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(item.id, {
      descricao: desc, valor: valorUnit, quantidade: Number(qty), tipo,
      descontoTipo:  descTipo || null,
      descontoValor: descTipo ? descValor : 0,
    });
    setSaving(false);
    setEditing(false);
  };

  const handleCancel = () => {
    setDesc(item.descricao); setTipo(item.tipo);
    setQty(String(item.quantidade));
    setValorUnit(item.valor);     setValorUnitStr(fmtNum(item.valor));
    setValorFinal(item.valor * item.quantidade);
    setValorFinalStr(fmtNum(item.valor * item.quantidade));
    setDescTipo(item.descontoTipo ?? '');
    setDescValor(item.descontoValor ?? 0);
    setDescValorStr(fmtDesc(item.descontoTipo, item.descontoValor ?? 0));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 px-4 py-3 bg-indigo-50/60 rounded-xl border border-indigo-200">
        <div className="flex gap-2 flex-wrap">
          <select value={tipo} onChange={e => setTipo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-400 bg-white">
            <option value="ASSISTENCIA">ASSISTENCIA</option>
            <option value="TRANSPORTE">TRANSPORTE</option>
            <option value="MEDICAMENTO">MEDICAMENTO</option>
            <option value="PROCEDIMENTO">PROCEDIMENTO</option>
            <option value="OUTROS">OUTROS</option>
            {/* Tipo custom (criado pelo "+ Novo tipo…") que não está entre os fixos
                acima — sem esta opção o <select> não acha o `value` atual, mostra a
                PRIMEIRA opção (ASSISTENCIA) selecionada e um Salvar sem querer troca
                o tipo de verdade para Assistência. */}
            {!['ASSISTENCIA', 'TRANSPORTE', 'MEDICAMENTO', 'PROCEDIMENTO', 'OUTROS'].includes(item.tipo) && (
              <option value={item.tipo}>{item.tipo}</option>
            )}
          </select>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            className="flex-1 min-w-40 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
            placeholder="Descrição" />
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-xs text-gray-500">Qtd.</label>
          <input type="number" min="1" value={qty} onChange={e => handleQtyChange(e.target.value)}
            className="w-16 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />

          <label className="text-xs text-gray-500">Val. unit.</label>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400 bg-white">
            <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-1.5">R$</span>
            <input type="text" inputMode="decimal" value={valorUnitStr}
              onChange={e => handleUnitChange(e.target.value)}
              placeholder="0,00"
              className="w-24 px-2 py-1.5 text-sm focus:outline-none" />
          </div>

          <label className="text-xs text-gray-500">Valor final.</label>
          <div className="flex items-center border border-indigo-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 bg-indigo-50">
            <span className="px-1.5 text-xs text-indigo-400 bg-indigo-100 border-r border-indigo-200 py-1.5">R$</span>
            <input type="text" inputMode="decimal" value={valorFinalStr}
              onChange={e => handleFinalChange(e.target.value)}
              placeholder="0,00"
              className="w-28 px-2 py-1.5 text-sm font-semibold text-indigo-700 bg-indigo-50 focus:outline-none" />
          </div>

          <button onClick={handleSave} disabled={saving}
            className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
          </button>
          <button onClick={handleCancel} className="p-1.5 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded-lg">
            <X size={13}/>
          </button>
        </div>

        {/* Desconto — percentual ou valor, sempre sobre o valor final do item */}
        <div className="flex gap-2 items-center flex-wrap pt-2 border-t border-indigo-100">
          <label className="text-xs text-gray-500">Desconto</label>
          <select value={descTipo} onChange={e => handleDescTipoChange(e.target.value as DescontoTipo | '')}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400 bg-white">
            <option value="">Sem desconto</option>
            <option value="PERCENTUAL">Percentual (%)</option>
            <option value="VALOR">Valor (R$)</option>
          </select>

          {descTipo && (
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-400 bg-white">
              <span className="px-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-1.5">
                {descTipo === 'PERCENTUAL' ? '%' : 'R$'}
              </span>
              <input type="text" inputMode="decimal" value={descValorStr}
                onChange={e => handleDescValorChange(e.target.value)}
                placeholder={descTipo === 'PERCENTUAL' ? '0' : '0,00'}
                className="w-24 px-2 py-1.5 text-sm focus:outline-none" />
            </div>
          )}

          <span className="text-xs text-gray-500">
            {previaDesconto > 0 && <>Abatimento: <b className="text-red-600">−{formatBRL(previaDesconto)}</b> · </>}
            Total: <b className="text-indigo-700">{formatBRL(previaBruto - previaDesconto)}</b>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-start gap-3 py-2.5 group hover:bg-gray-50/60 rounded-xl transition-colors ${
      ehInsumo ? 'pl-10 pr-4 border-l-2 border-gray-100 ml-4' : 'px-4'
    }`}>
      <div className="flex-1 min-w-0">
        {/* MOBILE: tipo + Nº do atendimento numa linha, DESCRIÇÃO na linha de baixo.
            Lado a lado, o que sobrava de largura para o nome do medicamento era um
            filete — e o texto quebrava uma letra por linha. No desktop volta tudo
            para a mesma linha. */}
        <div className="flex flex-col gap-y-0.5 md:flex-row md:items-start md:gap-2">
          <div className="flex items-center gap-2 flex-wrap md:flex-shrink-0 md:mt-0.5">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${TIPO_COR[item.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
              {item.tipo}
            </span>
            {numeroAtendimento && (
              <button
                type="button"
                onClick={abrirAtendimento}
                title={`Abrir o atendimento ${numeroAtendimento}`}
                aria-label={`Abrir o atendimento ${numeroAtendimento}`}
                className="font-mono text-xs font-bold text-emerald-700 hover:text-emerald-900 hover:underline whitespace-nowrap flex-shrink-0">
                {numeroAtendimento}
              </button>
            )}
          </div>
          <p className={`min-w-0 break-words md:flex-1 ${ehInsumo ? 'text-xs text-gray-600' : 'text-sm text-gray-800'}`}
            title={ehInsumo && item.medicamentoPai ? `Insumo da aplicação de ${item.medicamentoPai}` : undefined}>
            {descricaoSemNumero(item.descricao, item.origem?.atendimentoNumero ?? null)}
          </p>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {item.criadoEm && (
            <span className="mr-2 font-medium text-gray-500">
              {new Date(item.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
            </span>
          )}
          Quant.: {item.quantidade} · Unitário: {formatBRL(item.valor)}
          {descontoAtual > 0 && (
            <span className="ml-2 text-red-500 font-medium">
              Desconto: {item.descontoTipo === 'PERCENTUAL' ? `${item.descontoValor}%` : formatBRL(item.descontoValor ?? 0)}
              {' '}(−{formatBRL(descontoAtual)})
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-gray-700 whitespace-nowrap text-right">
          {descontoAtual > 0 && (
            <span className="block text-[10px] font-normal text-gray-400 line-through">
              {formatBRL(item.valor * item.quantidade)}
            </span>
          )}
          {formatBRL(totalItem(item))}
        </span>
        {canEdit && (
          <div className="flex gap-0.5">
            <button onClick={() => setEditing(true)} title="Editar item"
              className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
              <Pencil size={14}/>
            </button>
            <button onClick={() => onDelete(item.id)} title="Excluir item"
              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">
              <Trash2 size={14}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal — itens "Outros" do orçamento → fatura ────────────────────────────
// Só aparecem itens tipo OUTROS já APROVADOS e ainda não lançados. O backend só
// libera o lançamento depois que os demais itens do mesmo orçamento (medicamento/
// procedimento/vacina) tiverem sido importados numa evolução — aqui esses
// orçamentos aparecem bloqueados, com o nº de pendências.

interface OrcOutrosItem {
  id: number; descricao: string; quantidade: number;
  valorUnitario: number; valorTotal: number;
  animalId: number | null; animal?: { id: number; nome: string } | null;
}
interface OrcOutros {
  id: number; numeroFormatado: string;
  /** Itens clínicos do MESMO orçamento ainda não importados numa evolução.
   *  É AVISO, não bloqueio: o item "Outros" pode ser lançado assim mesmo. */
  pendentesClinicos: number; itens: OrcOutrosItem[];
}

function ModalImportarOrcamento({ proprietarioId, faturaId, onFechar, onLancado }: {
  proprietarioId: number;
  faturaId: number;
  onFechar: () => void;
  onLancado: () => void;
}) {
  const [orcamentos, setOrcamentos] = useState<OrcOutros[]>([]);
  const [loading, setLoading]       = useState(true);
  const [sel, setSel]               = useState<Set<number>>(new Set());
  const [lancando, setLancando]     = useState(false);
  const [erro, setErro]             = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.get('/orcamentos/outros-para-fatura', { params: { proprietarioId } })
      .then(r => { if (vivo) setOrcamentos(r.data?.dados ?? []); })
      .catch(() => { if (vivo) setOrcamentos([]); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [proprietarioId]);

  const toggle = (id: number) =>
    setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selecionados = orcamentos.flatMap(o => o.itens).filter(i => sel.has(i.id));
  const totalSel = selecionados.reduce((s, i) => s + i.valorTotal, 0);

  const lancar = async () => {
    if (selecionados.length === 0) { setErro('Selecione ao menos um item'); return; }
    setLancando(true);
    try {
      await api.post('/orcamentos/lancar-na-fatura', { faturaId, itemIds: [...sel] });
      toast.success(selecionados.length > 1 ? `${selecionados.length} itens lançados` : 'Item lançado na fatura');
      onLancado();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErro(e.response?.data?.error ?? 'Erro ao lançar os itens na fatura');
    } finally { setLancando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-xl max-h-[90vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-emerald-600" />
            <h3 className="font-bold text-gray-900">Importar “Outros” do orçamento</h3>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
          ) : orcamentos.length === 0 ? (
            <div className="text-center py-12 px-6 text-sm text-gray-400">
              Nenhum item “Outros” aprovado e pendente de lançamento para este cliente.
            </div>
          ) : orcamentos.map(o => (
            <div key={o.id} className="border-b border-gray-100">
              <div className="px-5 py-2 bg-gray-50 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-600">Orçamento #{o.numeroFormatado}</span>
                {/* AVISO, não bloqueio: importar item clínico numa evolução é opcional
                    (o orçamento inteiro é), então travar a cobrança do "Outros" nisso
                    deixava taxa/transporte impossível de faturar, sem saída na tela. */}
                {o.pendentesClinicos > 0 && (
                  <span className="text-[11px] text-amber-600">
                    {o.pendentesClinicos} item(ns) clínico(s) ainda não importado(s) em uma evolução
                  </span>
                )}
              </div>
              {o.itens.map(i => {
                const checked = sel.has(i.id);
                return (
                  <button key={i.id} onClick={() => toggle(i.id)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${checked ? 'bg-emerald-50/60' : 'hover:bg-gray-50'}`}>
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                      {checked && <Check size={13} className="text-white" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{i.descricao}</p>
                      <p className="text-[11px] text-gray-400">
                        {i.quantidade}x {formatBRL(i.valorUnitario)}
                        {i.animal?.nome ? ` · ${i.animal.nome}` : ''}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-700 flex-shrink-0">{formatBRL(i.valorTotal)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <InlineError message={erro} className="mx-5 mt-3" />

        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onFechar} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <div className="flex-1" />
          {totalSel > 0 && <span className="text-sm text-gray-500">Total: <b className="text-gray-800">{formatBRL(totalSel)}</b></span>}
          <button onClick={lancar} disabled={lancando || selecionados.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
            {lancando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Lançar na fatura {selecionados.length > 0 ? `(${selecionados.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal — criar um TIPO novo de cobrança (não existe no catálogo) ─────────
// Aberto pela opção "+ Novo tipo…" do select Tipo. Fica de fora do formulário
// principal — campos e estado próprios — porque coleta tudo que o lançamento
// precisa (tipo, nome, quantidade, valor, desconto) numa única tela e lança
// direto, sem depender do resto do formulário estar preenchido do jeito certo.
function ModalNovoTipoItem({ faturaId, animalId, tipoInicial, onFechar, onLancado, carregarCatalogo }: {
  faturaId: number;
  animalId: string;
  /** Pré-preenche o Tipo — vem do Tipo já selecionado no formulário quando o
   *  modal é aberto pelo "+ Novo item…" do Item Fatura (o tipo já é conhecido,
   *  só falta o nome). Vazio quando aberto pelo "+ Novo tipo…" do próprio
   *  select Tipo (tipo ainda não existe, digitado do zero). */
  tipoInicial?: string;
  onFechar:  () => void;
  onLancado: () => void;
  carregarCatalogo: () => void;
}) {
  const [tipo,         setTipo]         = useState(tipoInicial ?? '');
  const [nome,          setNome]         = useState('');
  const [qtd,           setQtd]          = useState('1');
  const [valor,         setValor]        = useState('0');
  const [valorDisplay,  setValorDisplay] = useState('0,00');
  const [descTipo,      setDescTipo]     = useState<DescontoTipo | ''>('');
  const [descValor,     setDescValor]    = useState(0);
  const [descDisplay,   setDescDisplay]  = useState('');
  const [salvando,      setSalvando]     = useState(false);
  const [erro,          setErro]         = useState<string | null>(null);

  const formatarValor = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const handleValorChange = (raw: string) => {
    const cents = parseInt(raw.replace(/\D/g, '') || '0', 10);
    const v = cents / 100;
    setValor(String(v));
    setValorDisplay(v === 0 ? '' : formatarValor(v));
  };

  // Percentual: máscara de centavos igual à do valor, só que em pontos percentuais
  // (00,00%), travada em 100%. Valor: mesma máscara de moeda (0.000,00).
  const handleDescValorChange = (raw: string) => {
    const cents = parseInt(raw.replace(/\D/g, '') || '0', 10);
    if (descTipo === 'PERCENTUAL') {
      const v = Math.min(100, cents / 100);
      setDescValor(v);
      setDescDisplay(v === 0 ? '' : `${formatarValor(v)}%`);
    } else {
      const v = cents / 100;
      setDescValor(v);
      setDescDisplay(v === 0 ? '' : formatarValor(v));
    }
  };

  const bruto    = Number(valor) * Number(qtd || 1);
  const desconto = descontoDoItem({
    valor: Number(valor), quantidade: Number(qtd || 1),
    descontoTipo: descTipo || null, descontoValor: descValor,
  });

  const salvar = async () => {
    if (!tipo.trim()) { setErro('Informe o tipo'); return; }
    if (!nome.trim()) { setErro('Informe o nome do item'); return; }
    setErro(null);
    setSalvando(true);
    const tipoFinal = tipo.trim().toUpperCase();
    const desc = nome.trim();
    // Quantidade 0 = só cadastra o item nos Itens Frequentes, sem lançar cobrança
    // nenhuma na fatura.
    const qtdZero = Number(qtd) === 0;
    try {
      if (!qtdZero) {
        await api.post(`/clinica/faturas/${faturaId}/itens`, {
          tipo:          tipoFinal,
          descricao:     desc,
          valor:         Number(valor),
          quantidade:    Number(qtd),
          animalId:      animalId ? Number(animalId) : undefined,
          descontoTipo:  descTipo || null,
          descontoValor: descTipo ? descValor : 0,
        });
      }
      // Tipo criado na hora — sempre entra nos Itens Frequentes para reuso futuro.
      // Com quantidade 0 é TUDO que acontece — é o "só cadastre".
      try {
        await api.post('/clinica/faturas/catalogo-itens', { tipo: tipoFinal, descricao: desc, valor: 0 });
        carregarCatalogo();
      } catch { /* silencioso — não impede o lançamento */ }
      toast.success(qtdZero ? 'Item cadastrado (sem lançar cobrança)' : 'Item lançado');
      onLancado();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErro(e.response?.data?.error ?? (qtdZero ? 'Erro ao cadastrar o item' : 'Erro ao lançar o item'));
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">{tipoInicial ? 'Novo Item de Cobrança' : 'Novo Tipo de Cobrança'}</h3>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">
              Tipo <span className="text-red-400">*</span>
            </label>
            <input value={tipo} onChange={e => setTipo(e.target.value.toUpperCase())}
              placeholder="Ex.: TRANSPORTE"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">
              Nome <span className="text-red-400">*</span>
            </label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Descreva o item ou cobrança"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">Quantidade</label>
              {/* 0 é válido de propósito: cadastra o item nos Itens Frequentes sem
                  lançar cobrança na fatura. */}
              <input type="number" min="0" value={qtd} onChange={e => setQtd(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:border-indigo-400"/>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                Valor Unitário
              </label>
              <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:border-indigo-400">
                <span className="px-2.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-2">R$</span>
                <input type="text" inputMode="decimal" value={valorDisplay} onChange={e => handleValorChange(e.target.value)}
                  placeholder="0,00" className="flex-1 px-2.5 py-2 text-sm focus:outline-none rounded-r-xl"/>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Desconto</label>
            <div className="flex gap-1.5">
              <select value={descTipo}
                onChange={e => { setDescTipo(e.target.value as DescontoTipo | ''); setDescValor(0); setDescDisplay(''); }}
                className="border border-gray-300 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-indigo-400 bg-white">
                <option value="">Não</option>
                <option value="PERCENTUAL">%</option>
                <option value="VALOR">R$</option>
              </select>
              {descTipo === 'PERCENTUAL' && (
                <input type="text" inputMode="decimal" value={descDisplay} onChange={e => handleDescValorChange(e.target.value)}
                  placeholder="00,00%"
                  className="flex-1 min-w-0 border border-gray-300 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
              )}
              {descTipo === 'VALOR' && (
                <div className="flex-1 min-w-0 flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:border-indigo-400">
                  <span className="px-2.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-2">R$</span>
                  <input type="text" inputMode="decimal" value={descDisplay} onChange={e => handleDescValorChange(e.target.value)}
                    placeholder="0,00" className="flex-1 px-2.5 py-2 text-sm focus:outline-none rounded-r-xl"/>
                </div>
              )}
            </div>
          </div>

          <div className="text-right">
            <p className="text-[10px] text-gray-400">Total do item</p>
            <p className="text-sm font-bold text-gray-700">{formatBRL(bruto - desconto)}</p>
            {desconto > 0 && <p className="text-[10px] text-red-500">−{formatBRL(desconto)}</p>}
          </div>

          <InlineError message={erro} />
        </div>

        <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onFechar} disabled={salvando}
            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-2">
            {salvando && <Loader2 size={13} className="animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel direito — detalhe da fatura ──────────────────────────────────────

type MesFatura = { id: number; mesReferencia?: string; status: string };

// ─── Cores das ações (CLAUDE.md §6) ──────────────────────────────────────────
// A barra de ações da fatura nascia TODA cinza — e cinza, na aplicação, é a cor do
// INDISPONÍVEL: uma linha inteira de botões habilitados parecia desabilitada. Aqui
// eles passam a usar a mesma paleta dos ícones do módulo de Atendimento, que é a
// que os ícones de editar (laranja) e excluir (vermelho) do ITEM já seguiam nesta
// mesma tela.
// ⚠️ Ao acrescentar ação nova, escolha o TOM pelo significado — nunca uma cor nova.
const BTN_ACAO = 'flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold transition-colors disabled:opacity-60';

const TOM_ACAO = {
  /** alterar / reabrir — muda o estado do que já está fechado */
  alterar:   'border-orange-200  text-orange-600  hover:bg-orange-50',
  /** ver / finalizar / executar */
  ver:       'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  finalizar: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  /** saída de conteúdo: imprimir, exportar e e-mail dividem o azul */
  imprimir:  'border-blue-200    text-blue-600    hover:bg-blue-50',
  email:     'border-blue-200    text-blue-600    hover:bg-blue-50',
  /** WhatsApp usa a cor da própria marca */
  whatsapp:  'border-green-200   text-green-600   hover:bg-green-50',
  /** exportar tem tom PRÓPRIO (marrom): baixa arquivo, não põe o documento em
   *  circulação como o imprimir/e-mail azuis ao lado */
  exportar:  'border-amber-300   text-amber-800   hover:bg-amber-50',
  /** links enviados — revela o que já foi mandado ao cliente */
  links:     'border-yellow-200  text-yellow-600  hover:bg-yellow-50',
} as const;

function PainelFatura({
  prop, onStatusChange, faturaId, mes = null, onMeta,
}: {
  prop: ProprietarioItem;
  onStatusChange: () => void;
  faturaId?: number;
  mes?: string | null;
  onMeta?: (m: { meses: MesFatura[]; mesAtual?: string }) => void;
}) {
  const { podeExecutar, isGestor } = usePermissoes();
  const podeEditar  = isGestor || podeExecutar('financeiro.faturas.editar');
  const podeLancar  = isGestor || podeExecutar('financeiro.faturas.lancar');
  const podeFechar  = isGestor || podeExecutar('financeiro.faturas.fechar');
  const semPermissao = (acao: string) =>
    setErroInline(`Sem permissão para ${acao}. Verifique com o responsável da equipe.`);

  const [fatura,         setFatura]         = useState<Fatura | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [salvando,       setSalvando]       = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [logoUrl,        setLogoUrl]        = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Logo da empresa/equipe do proprietário para PDF/impressão/compartilhamento —
  // busca best-effort, nunca bloqueia a tela (fallback: marca S2Vet no template).
  //
  // Convertida para `data:` URI aqui, e não deixada como caminho (`/api/midia/..`):
  // o MESMO html de `gerarHtmlFatura` vira PDF tanto na impressão AO VIVO do
  // navegador quanto no PDF gerado pelo SERVIDOR (WhatsApp/e-mail/link público,
  // via Puppeteer) — e o Puppeteer BLOQUEIA qualquer requisição que não seja
  // `data:` (proteção contra SSRF). Sem isto, a logo aparecia na impressão e
  // vinha QUEBRADA em todo PDF enviado/compartilhado. Ver utils/printUrl.ts.
  useEffect(() => {
    let cancelado = false;
    api.get(`/clinica/faturas/proprietario/${prop.id}/logo-empresa`)
      .then(async res => {
        const bruto = res.data?.dados?.logoUrl ?? null;
        const dataUri = await carregarComoDataUri(bruto);
        if (!cancelado) setLogoUrl(dataUri);
      })
      .catch(() => { if (!cancelado) setLogoUrl(null); });
    return () => { cancelado = true; };
  }, [prop.id]);

  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const handlePDF = () => {
    if (!fatura) return;
    imprimirFatura(fatura, prop.animais, logoUrl);
    setShowExportMenu(false);
  };

  const handleCSV = () => {
    if (!fatura) return;
    exportarFaturaCSV(fatura, prop.animais);
    setShowExportMenu(false);
    toast.success('CSV gerado');
  };

  const [compartilhando, setCompartilhando] = useState(false);
  const [enviandoEmail,  setEnviandoEmail]  = useState(false);

  // Opções comuns ao envio por WhatsApp/e-mail (PDF real, via
  // utils/compartilharPdf.ts) — mesmo HTML do botão Imprimir (gerarHtmlFatura).
  const opcoesCompartilhar = () => {
    if (!fatura) return null;
    const inv         = `INV-${String(fatura.id).padStart(3, '0')}`;
    const nomeDestino = prop.fullName;
    return {
      gerarHtml:   () => gerarHtmlFatura(fatura, prop.animais, logoUrl),
      nomeArquivo: `fatura-${inv}-${nomeDestino.replace(/\s+/g, '-')}.pdf`,
      documento:   'Fatura',
      texto:       montarTextoFatura(fatura, prop),
      titulo:      `Fatura — ${nomeDestino}`,
    };
  };

  // Envio por WhatsApp/e-mail passou a mandar um LINK (não o PDF anexado — ver
  // lib/faturaLinkPublico.js no backend): o servidor gera o PDF, salva no
  // storage e devolve a URL pública — um token de 64 caracteres é a única
  // proteção (capability URL pura, sem segundo fator). Nunca mais depende do
  // Puppeteer/upload terminarem dentro da janela de "user activation" do
  // navegador do vet.
  const handleShare = async () => {
    const opcoes = opcoesCompartilhar();
    if (!fatura || !opcoes) return;
    setCompartilhando(true);
    try {
      const r = await api.post(`/clinica/faturas/${fatura.id}/enviar-whatsapp`, {
        html: opcoes.gerarHtml(), nomeArquivo: opcoes.nomeArquivo, texto: opcoes.texto, telefone: prop.phone,
      });
      const dados = r.data?.dados;
      if (dados?.enviado) {
        toast.success(dados.simulado ? 'Envio simulado (WhatsApp em modo de teste).' : 'Link da fatura enviado por WhatsApp.');
      } else if (dados?.url) {
        // WhatsApp da clínica indisponível — abre o app com o link já pronto
        // (nada de PDF para baixar/anexar, é só texto).
        abrirWhatsApp(`${opcoes.texto}\n\n📄 Abra a fatura: ${dados.url}`, prop.phone ?? undefined);
        toast('WhatsApp da clínica indisponível — abrindo com o link pronto.', { icon: '🔗', duration: 5000 });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setErroInline(e.response?.data?.error ?? 'Erro ao enviar a fatura pelo WhatsApp.');
    } finally {
      setCompartilhando(false);
    }
  };

  const handleEmail = async () => {
    const opcoes = opcoesCompartilhar();
    if (!fatura || !opcoes) return;
    setEnviandoEmail(true);
    try {
      const r = await api.post(`/clinica/faturas/${fatura.id}/enviar-email`, {
        html: opcoes.gerarHtml(), nomeArquivo: opcoes.nomeArquivo, texto: opcoes.texto, titulo: opcoes.titulo, email: prop.email,
      });
      const dados = r.data?.dados;
      if (dados?.enviado) {
        toast.success('Link da fatura enviado por e-mail.');
      } else if (dados?.url) {
        abrirEmail(opcoes.titulo, `${opcoes.texto}\n\nAbra a fatura: ${dados.url}`, prop.email ?? undefined);
        toast('E-mail da clínica não configurado — abrindo com o link pronto.', { icon: '🔗', duration: 5000 });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setErroInline(e.response?.data?.error ?? 'Erro ao enviar a fatura por e-mail.');
    } finally {
      setEnviandoEmail(false);
    }
  };

  // Links públicos já enviados desta fatura (WhatsApp/e-mail) — painel
  // colapsável, carregado sob demanda (não polui a tela por padrão).
  const [mostrarLinks,  setMostrarLinks]  = useState(false);
  const [links,         setLinks]         = useState<FaturaLink[] | null>(null);
  const [carregandoLinks, setCarregandoLinks] = useState(false);
  const [linkParaRevogar, setLinkParaRevogar] = useState<FaturaLink | null>(null);
  const [revogando, setRevogando] = useState(false);

  const carregarLinks = useCallback(async () => {
    if (!fatura) return;
    setCarregandoLinks(true);
    try {
      const r = await api.get(`/clinica/faturas/${fatura.id}/links`);
      if (r.data) setLinks(r.data.dados ?? []);
    } catch {
      // silencioso — o painel é opcional, não trava o resto da tela
    } finally {
      setCarregandoLinks(false);
    }
  }, [fatura]);

  const toggleLinks = () => {
    const abrindo = !mostrarLinks;
    setMostrarLinks(abrindo);
    if (abrindo && links === null) carregarLinks();
  };

  const confirmarRevogar = async () => {
    if (!fatura || !linkParaRevogar) return;
    setRevogando(true);
    try {
      await api.patch(`/clinica/faturas/${fatura.id}/links/${linkParaRevogar.id}/revogar`);
      toast.success('Link revogado.');
      await carregarLinks();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error ?? 'Erro ao revogar o link.');
    } finally {
      setRevogando(false);
      setLinkParaRevogar(null);
    }
  };

  const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
    PENDENTE: 'Enviando…', ENVIADO: 'Enviado', FALHOU: 'Tentando de novo', FALHOU_DEFINITIVO: 'Falhou',
  };
  const LINK_STATUS_CLS: Record<LinkStatus, string> = {
    PENDENTE: 'bg-amber-50 text-amber-700 border-amber-200',
    ENVIADO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    FALHOU: 'bg-amber-50 text-amber-700 border-amber-200',
    FALHOU_DEFINITIVO: 'bg-red-50 text-red-700 border-red-200',
  };

  // Formulário de novo item
  const [novoCatIdx,        setNovoCatIdx]        = useState<string>('');
  // Um único animal → já vem selecionado por padrão (sem precisar escolher).
  const [novoAnimalId,      setNovoAnimalId]      = useState<string>(prop.animais.length === 1 ? String(prop.animais[0].id) : '');
  const [novoNome,          setNovoNome]          = useState('');
  // '' = placeholder "Escolha um tipo" — nasce assim e volta a ficar assim a
  // cada lançamento (reset do card ao criar um novo).
  const [novoTipo,          setNovoTipo]          = useState<ItemTipo | string>('');
  const [novoQty,           setNovoQty]           = useState('1');
  const [novoValor,         setNovoValor]         = useState('0');
  const [novoValorDisplay,  setNovoValorDisplay]  = useState('0,00');
  const [novoDescTipo,      setNovoDescTipo]      = useState<DescontoTipo | ''>('');
  const [novoDescValor,     setNovoDescValor]     = useState(0);
  const [novoDescDisplay,   setNovoDescDisplay]   = useState('');
  const [lancando,          setLancando]          = useState(false);
  // Modal "+ Novo tipo…" (Tipo) / "+ Novo item…" (Item Fatura) — mesma tela nos
  // dois casos (ModalNovoTipoItem); só muda se o Tipo chega vazio (tipo
  // desconhecido, digitado do zero) ou pré-preenchido (tipo já escolhido no
  // formulário, só falta o nome do item).
  const [novoTipoModalAberto,      setNovoTipoModalAberto]      = useState(false);
  const [novoTipoModalTipoInicial, setNovoTipoModalTipoInicial] = useState('');
  // Modal de importação dos itens "Outros" aprovados no orçamento
  const [showImportOrc,     setShowImportOrc]     = useState(false);

  // Catálogo de itens frequentes (persistidos por empresa)
  const [catalogo,      setCatalogo]      = useState<CatalogoItem[]>([]);

  const [itemParaExcluir, setItemParaExcluir] = useState<number | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const q = mes
        ? `?mes=${mes}`
        : faturaId ? `?faturaId=${faturaId}` : '';
      const r = await api.get(`/clinica/faturas/proprietario/${prop.id}${q}`);
      setFatura(r.data.dados);
      onMeta?.({ meses: Array.isArray(r.data.meses) ? r.data.meses : [], mesAtual: r.data.dados?.mesReferencia });
    } catch {
      setErroInline('Erro ao carregar fatura');
    } finally {
      setLoading(false);
    }
  }, [prop.id, faturaId, mes, onMeta]);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarCatalogo = useCallback(async () => {
    try {
      const r = await api.get('/clinica/faturas/catalogo-itens');
      if (r.data) setCatalogo(r.data.dados ?? []);
    } catch { /* silencioso */ }
  }, []);
  useEffect(() => { carregarCatalogo(); }, [carregarCatalogo]);

  // Remoção exige justificativa (registrada na Auditoria) — abre o modal padrão
  const handleDeleteItem = (itemId: number) => {
    if (!podeEditar) { semPermissao('remover item da fatura'); return; }
    setItemParaExcluir(itemId);
  };

  const confirmarExcluirItem = async (motivo: string) => {
    if (itemParaExcluir == null) return;
    try {
      const r = await api.delete(`/clinica/faturas/itens/${itemParaExcluir}`, { data: { motivo } });
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: prev.itens.filter(i => i.id !== itemParaExcluir),
      } : prev);
      setItemParaExcluir(null);
      toast.success('Item removido.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao remover item');
    }
  };

  const handleSaveItem = async (itemId: number, patch: Partial<FaturaItem>) => {
    if (!podeEditar) { semPermissao('editar item da fatura'); return; }
    try {
      const r = await api.put(`/clinica/faturas/itens/${itemId}`, patch);
      setFatura(prev => prev ? {
        ...prev,
        total: r.data.totalFatura,
        itens: prev.itens.map(i => i.id === itemId ? r.data.dados : i),
      } : prev);
    } catch { setErroInline('Erro ao salvar item'); }
  };

  // Itens fixos do código + itens frequentes salvos no backend
  const frequentes = [
    ...CATALOGO.map(c => ({ id: undefined as number | undefined, label: c.label, tipo: c.tipo, descricao: c.descricao, valor: c.valor })),
    ...catalogo.map(c => ({ id: c.id, label: c.descricao, tipo: c.tipo as ItemTipo, descricao: c.descricao, valor: c.valor })),
  ];

  // Item Fatura atrelado ao Tipo, mas só ANTES de um item já estar escolhido:
  //   sem Tipo ainda (--)                    → mostra TODOS os itens
  //   Tipo escolhido, NENHUM item ainda      → filtra pelos itens daquele tipo
  //   Tipo escolhido, item JÁ selecionado    → mostra TODOS de novo
  // A 3ª linha existe porque escolher um item direto (ex.: "Gasolina") também
  // preenche o Tipo sozinho (handleCatalogoChange) — sem ela, reabrir o combo
  // pra trocar de item ficava PRESO ao tipo que acabou de ser preenchido
  // sozinho, sem um jeito fácil de escolher um item de outro tipo. `indice` é a
  // posição em `frequentes` — o que `handleCatalogoChange` espera receber.
  const itensComIndice = frequentes
    .map((c, indice) => ({ ...c, indice }))
    .filter(c => (novoTipo && !novoCatIdx) ? c.tipo === novoTipo : true);

  // Em ORDEM ALFABÉTICA pelo nome do item — a formatação com o valor (" — R$ 10,00")
  // entra DEPOIS de ordenar, senão dois itens quase iguais poderiam trocar de posição
  // por causa do preço embutido no texto.
  const itemFaturaOpcoes = itensComIndice
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
    .map(c => ({ value: String(c.indice), label: `${c.label}${c.valor ? ` — ${formatBRL(c.valor)}` : ''}` }));

  // Tipos criados na hora pelo "+ Novo tipo…"/"+ Novo item…" (ModalNovoTipoItem)
  // ficavam sem VOLTA: o select Tipo só tinha as 4 opções fixas, então o tipo
  // recém-criado nunca mais aparecia para ser reaberto — e o formulário, preso
  // em ASSISTENCIA por padrão, só oferecia os itens de Assistência daí em diante
  // (o sintoma "o tipo não salva, entra como Assistência"). Qualquer tipo
  // distinto vindo do catálogo entra como opção extra no select.
  const tiposExtras = Array.from(new Set(
    catalogo.map(c => c.tipo).filter(t => t && !TIPOS_FIXOS.includes(t))
  ));

  // Tipo também em ordem alfabética pelo rótulo (não pelo código interno).
  const tipoOpcoes = [
    { value: 'ASSISTENCIA',  label: 'Assistência' },
    { value: 'TRANSPORTE',   label: 'Transporte' },
    { value: 'MEDICAMENTO',  label: 'Medicamento' },
    { value: 'PROCEDIMENTO', label: 'Procedimento' },
    ...tiposExtras.map(t => ({ value: t, label: capitalizarTipo(t) })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  const handleCatalogoChange = (idx: string) => {
    setNovoCatIdx(idx);
    if (idx === '') { setNovoNome(''); return; }
    const cat = frequentes[Number(idx)];
    if (!cat) return;
    setNovoNome(cat.descricao);
    setNovoTipo(cat.tipo);
    setNovoValor(String(cat.valor));
    setNovoValorDisplay(formatarValorFatura(cat.valor));
  };

  const formatarValorFatura = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const handleValorChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const cents  = parseInt(digits || '0', 10);
    const value  = cents / 100;
    setNovoValor(String(value));
    setNovoValorDisplay(value === 0 ? '' : formatarValorFatura(value));
  };

  // Desconto do lançamento: percentual é digitado direto (10 = 10%); R$ usa centavos
  const handleNovoDescValor = (raw: string) => {
    const v = novoDescTipo === 'PERCENTUAL'
      ? Math.min(100, Number(raw.replace(/\D/g, '') || '0'))
      : parseInt(raw.replace(/\D/g, '') || '0', 10) / 100;
    setNovoDescValor(v);
    setNovoDescDisplay(v === 0 ? '' : (novoDescTipo === 'PERCENTUAL' ? String(v) : formatarValorFatura(v)));
  };

  const novoBruto    = Number(novoValor) * Number(novoQty || 1);
  const novoDesconto = descontoDoItem({
    valor: Number(novoValor), quantidade: Number(novoQty || 1),
    descontoTipo: novoDescTipo || null, descontoValor: novoDescValor,
  });

  const handleLancar = async () => {
    if (!podeLancar) { semPermissao('lançar cobrança na fatura'); return; }
    if (!fatura) return;
    if (!novoTipo) { setErroInline('Selecione o tipo'); return; }
    if (!novoNome.trim()) { setErroInline('Informe a descrição do item'); return; }
    const tipoFinal = novoTipo;
    const desc      = novoNome.trim();
    // Quantidade 0 = só cadastra o item nos Itens Frequentes, sem lançar cobrança
    // nenhuma na fatura (nenhum FaturaItem é criado).
    const qtdZero = Number(novoQty) === 0;
    setLancando(true);
    try {
      if (!qtdZero) {
        const r = await api.post(`/clinica/faturas/${fatura.id}/itens`, {
          tipo:          tipoFinal,
          descricao:     desc,
          valor:         Number(novoValor),
          quantidade:    Number(novoQty),
          animalId:      novoAnimalId ? Number(novoAnimalId) : undefined,
          descontoTipo:  novoDescTipo || null,
          descontoValor: novoDescTipo ? novoDescValor : 0,
        });
        setFatura(prev => prev ? {
          ...prev,
          total: r.data.totalFatura,
          itens: [...prev.itens, r.data.dados],
        } : prev);
      }

      // Item digitado manualmente (não veio dos frequentes) → adiciona automaticamente
      // aos Itens Frequentes para reuso. Com quantidade 0 é TUDO que acontece — é o
      // "só cadastre". Ignora se já existir descrição igual.
      const jaExiste = frequentes.some(f => f.descricao.trim().toLowerCase() === desc.toLowerCase());
      if (!novoCatIdx && desc && !jaExiste) {
        try {
          // Salva só o NOME do item frequente (sem valor — informado a cada lançamento).
          await api.post('/clinica/faturas/catalogo-itens', { tipo: tipoFinal, descricao: desc, valor: 0 });
          carregarCatalogo();
        } catch { /* silencioso — não impede o lançamento */ }
      }

      // Reset do card ao lançar um novo — Tipo volta ao placeholder "Escolha um tipo".
      setNovoTipo('');
      setNovoNome(''); setNovoCatIdx('');
      setNovoAnimalId(prop.animais.length === 1 ? String(prop.animais[0].id) : '');
      setNovoQty('1'); setNovoValor('0'); setNovoValorDisplay('0,00');
      setNovoDescTipo(''); setNovoDescValor(0); setNovoDescDisplay('');
      toast.success(qtdZero ? 'Item cadastrado (sem lançar cobrança)' : 'Item lançado');
    } catch { setErroInline(qtdZero ? 'Erro ao cadastrar item' : 'Erro ao lançar item'); }
    finally { setLancando(false); }
  };

  const handleStatus = async (status: FaturaStatus) => {
    if (status !== 'FECHADA' && !podeEditar) { semPermissao('alterar status da fatura'); return; }
    if (!fatura) return;
    setSalvando(true);
    try {
      const r = await api.patch(`/clinica/faturas/${fatura.id}/status`, { status });
      setFatura(r.data.dados);
      const MSG: Partial<Record<FaturaStatus, string>> = {
        PAGA:   'Fatura marcada como paga',
        ABERTA: 'Fatura reaberta',
      };
      toast.success(MSG[status] ?? 'Status atualizado');
      onStatusChange();
    } catch (err: unknown) {
      // ⚠️ O motivo REAL vem do servidor e precisa chegar à tela: "Erro ao
      // atualizar status" sozinho não distingue falta de permissão, fatura de
      // outra clínica e fatura paga em somente leitura — foi assim que o 403 do
      // nível da rota (corrigido em 2026-09-04) ficou meses sem diagnóstico.
      // O interceptor de `api.ts` preserva `response.data.error` justamente
      // para isto (CLAUDE.md §6).
      const e = err as { response?: { data?: { error?: string } } };
      setErroInline(e.response?.data?.error ?? 'Erro ao atualizar status');
    }
    finally { setSalvando(false); }
  };

  const handleFechar = async () => {
    if (!podeFechar) { semPermissao('fechar fatura'); return; }
    if (!fatura) return;
    setSalvando(true);
    try {
      const r = await api.patch(`/clinica/faturas/${fatura.id}/fechar`);
      setFatura(r.data.dados);
      toast.success('Fatura fechada — itens bloqueados para edição');
      onStatusChange();
    } catch { setErroInline('Erro ao fechar fatura'); }
    finally { setSalvando(false); }
  };

  // Agrupa itens por animal
  type GrupoItens = Partial<Record<number | 'sem', FaturaItem[]>>;
  const itensPorAnimal: GrupoItens = fatura?.itens.reduce<GrupoItens>((acc, item) => {
    const key = item.animalId ?? 'sem';
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(item);
    return acc;
  }, {}) ?? {};

  // A fatura é do PROPRIETÁRIO (não é escopada por empresa), mas a lista de animais
  // é a da clínica ativa. Itens de um animal fora dessa lista (outra clínica atende o
  // mesmo cliente) ganham uma seção própria — sem isto eles simplesmente sumiam da tela.
  const idsDoEscopo = new Set(prop.animais.map(a => a.id));
  const animaisForaDoEscopo = Object.entries(itensPorAnimal)
    .filter(([key]) => key !== 'sem' && !idsDoEscopo.has(Number(key)))
    .map(([key, itens]) => ({
      id:    Number(key),
      nome:  itens?.[0]?.animal?.nome ?? `Animal #${key}`,
      itens: itens ?? [],
    }));

  const canEdit = fatura?.status === 'ABERTA';

  const invoiceRef = fatura ? `INV-${String(fatura.id).padStart(3, '0')}` : '—';

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-indigo-400"/>
      </div>
    );
  }

  if (!fatura) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 lg:overflow-hidden min-w-0">
      <InlineError message={erroInline} className="mb-3 flex-shrink-0" />

      {/* Card do cliente — SOMENTE proprietário + fatura (ações ficam fora) */}
      <div className="bg-emerald-600 rounded-2xl px-5 py-4 mb-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Receipt size={15} className="text-emerald-200 flex-shrink-0"/>
          <h2 className="text-lg font-bold text-white break-words">{prop.fullName}</h2>
        </div>
        <div className="text-xs text-emerald-50 space-y-0.5">
          {prop.phone && <p>Telefone: <span className="text-white font-medium">{prop.phone}</span></p>}
          <p className="break-all">E-mail: <span className="text-white font-medium">{prop.email}</span></p>
        </div>
        <div className="mt-2.5 pt-2.5 border-t border-white/15 text-xs text-emerald-100 text-right">
          Fatura Mês:{' '}
          <span className="font-bold text-white">{formatMes(fatura.mesReferencia) || 'Mês atual'}</span>
          {' · '}
          <span className="font-mono">{invoiceRef}</span>
        </div>
      </div>

      {/* 🔴 Sem esta faixa, a fatura paga só aparece SEM os botões de editar e a
          pessoa conclui que perdeu permissão — o mesmo motivo da faixa do paciente
          inativo no shell de Atendimento. */}
      {fatura.status === 'PAGA' && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex-shrink-0">
          <p className="text-sm font-semibold text-emerald-900">
            Fatura paga — somente leitura.
          </p>
          <p className="text-xs text-emerald-800 mt-0.5">
            Os itens não podem ser incluídos, alterados nem removidos. Imprimir, exportar
            e enviar por e-mail/WhatsApp continuam disponíveis.
            {isGestor
              ? ' Para voltar a lançar, use Reabrir — a reabertura fica registrada na auditoria.'
              : ' Reabrir uma fatura paga é ação do gestor.'}
          </p>
        </div>
      )}

      {/* Ações da fatura — FORA do card */}
      <div className="flex flex-wrap items-center justify-end gap-2 mb-3 flex-shrink-0">
        {/* 🔴 FATURA PAGA É SOMENTE LEITURA. Reabrir continua existindo — sem saída,
            um clique errado em "Marcar como Pago" congelaria a cobrança para sempre —
            mas é ato de GESTOR, e o backend registra na auditoria quem destravou uma
            fatura quitada (mesma escolha da reativação do paciente). */}
        {(fatura.status === 'FECHADA' || fatura.status === 'ATRASADA'
          || (fatura.status === 'PAGA' && isGestor)) && (
          <button onClick={() => handleStatus('ABERTA')} disabled={salvando}
            className={`${BTN_ACAO} ${TOM_ACAO.alterar}`}>
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>} Reabrir
          </button>
        )}
        {canEdit && (
          <button onClick={handleFechar} disabled={salvando}
            className={`${BTN_ACAO} ${TOM_ACAO.finalizar}`}>
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <Check size={13}/>} Fechar Fatura
          </button>
        )}
        {(canEdit || fatura.status === 'FECHADA' || fatura.status === 'ATRASADA') && (
          <button onClick={() => handleStatus('PAGA')} disabled={salvando}
            className={`${BTN_ACAO} ${TOM_ACAO.finalizar}`}>
            {salvando ? <Loader2 size={11} className="animate-spin"/> : <CheckCircle2 size={11}/>} Marcar como Pago
          </button>
        )}
        <button onClick={handleEmail} disabled={enviandoEmail}
          className={`${BTN_ACAO} ${TOM_ACAO.email}`}>
          {enviandoEmail ? <Loader2 size={13} className="animate-spin"/> : <Mail size={13}/>} E-mail
        </button>
        <button onClick={handleShare} disabled={compartilhando}
          className={`${BTN_ACAO} ${TOM_ACAO.whatsapp}`}>
          {compartilhando ? <Loader2 size={13} className="animate-spin"/> : <MessageCircle size={13}/>} WhatsApp
        </button>
        <button onClick={toggleLinks}
          className={`${BTN_ACAO} ${TOM_ACAO.links}`}>
          <Link2 size={13}/> Links enviados
        </button>
        <button onClick={handlePDF}
          className={`${BTN_ACAO} ${TOM_ACAO.imprimir}`}>
          <Printer size={13}/> Imprimir
        </button>
        <div className="relative" ref={exportMenuRef}>
          <button onClick={() => setShowExportMenu(v => !v)}
            className={`${BTN_ACAO} ${TOM_ACAO.exportar}`}>
            <Download size={13}/> Exportar <ChevronDown size={11}/>
          </button>
          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 py-1 min-w-[150px]">
              <button onClick={handleCSV}
                className="w-full text-left px-4 py-2 text-xs text-amber-800 hover:bg-amber-50 flex items-center gap-2">
                <Download size={13}/> CSV (.csv)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Links públicos enviados (WhatsApp/e-mail) — colapsável, sob demanda */}
      {mostrarLinks && (
        <div className="mb-3 flex-shrink-0 bg-white border border-gray-200 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600">Links enviados</p>
            {carregandoLinks && <Loader2 size={13} className="animate-spin text-gray-400" />}
          </div>
          {links !== null && links.length === 0 && !carregandoLinks && (
            <p className="text-xs text-gray-400">Nenhum link enviado ainda.</p>
          )}
          {links !== null && links.length > 0 && (
            <div className="space-y-1.5">
              {links.map((l) => {
                const ativo = !l.revogadoEm && new Date(l.expiraEm).getTime() > Date.now();
                return (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-xs border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {l.canal === 'WHATSAPP' ? <MessageCircle size={12} className="text-emerald-600 flex-shrink-0"/> : <Mail size={12} className="text-blue-600 flex-shrink-0"/>}
                      <span className="truncate text-gray-700">{l.destino ?? '—'}</span>
                      <span className={`px-1.5 py-0.5 rounded-full border font-semibold flex-shrink-0 ${LINK_STATUS_CLS[l.status]}`}>
                        {LINK_STATUS_LABEL[l.status]}
                      </span>
                      {l.revogadoEm && (
                        <span className="px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-100 text-gray-500 font-semibold flex-shrink-0">Revogado</span>
                      )}
                      {l.qtdAcessos > 0 && (
                        <span className="flex items-center gap-0.5 text-gray-400 flex-shrink-0" title="Vezes que o cliente abriu">
                          <Eye size={11}/> {l.qtdAcessos}
                        </span>
                      )}
                    </div>
                    {ativo && (
                      <button
                        onClick={() => setLinkParaRevogar(l)}
                        className="flex items-center gap-1 text-red-600 hover:text-red-700 font-semibold flex-shrink-0"
                      >
                        <Ban size={12}/> Revogar
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={!!linkParaRevogar}
        titulo="Revogar link da fatura?"
        mensagem={`O link enviado para "${linkParaRevogar?.destino ?? ''}" para de funcionar imediatamente — quem já tiver aberto não consegue mais acessar a fatura por ele.`}
        labelConfirmar={revogando ? 'Revogando…' : 'Revogar'}
        variante="perigo"
        onConfirmar={confirmarRevogar}
        onCancelar={() => setLinkParaRevogar(null)}
      />

      {/* Modal — itens "Outros" aprovados no orçamento → fatura */}
      {showImportOrc && (
        <ModalImportarOrcamento
          proprietarioId={prop.id}
          faturaId={fatura.id}
          onFechar={() => setShowImportOrc(false)}
          onLancado={() => { setShowImportOrc(false); carregar(); }}
        />
      )}

      {/* Modal — "+ Novo tipo…" no select Tipo */}
      {novoTipoModalAberto && fatura && (
        <ModalNovoTipoItem
          faturaId={fatura.id}
          animalId={novoAnimalId}
          tipoInicial={novoTipoModalTipoInicial}
          onFechar={() => setNovoTipoModalAberto(false)}
          onLancado={() => { setNovoTipoModalAberto(false); carregar(); }}
          carregarCatalogo={carregarCatalogo}
        />
      )}

      {/* Modal — remover item (justificativa obrigatória → Auditoria) */}
      <ModalJustificativa
        aberto={itemParaExcluir != null}
        titulo="Remover item da fatura?"
        descricao={(() => {
          const it = fatura?.itens.find(i => i.id === itemParaExcluir);
          return it ? `${it.descricao} — a remoção fica registrada como correção da fatura.` : undefined;
        })()}
        acaoLabel="Remover"
        onConfirmar={confirmarExcluirItem}
        onFechar={() => setItemParaExcluir(null)}
      />

      {/* Corpo da fatura */}
      <div className="flex-1 lg:overflow-y-auto overflow-x-hidden space-y-4 pr-1 pb-4">

        {/* Assistência e serviços gerais (sem animal) — sempre primeiro */}
        {(itensPorAnimal['sem'] ?? []).length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <p className="text-sm font-bold text-gray-700">Assistência &amp; Serviços Gerais</p>
            </div>
            <JanelaLista className="divide-y divide-gray-50">
              {ordenarComInsumos(itensPorAnimal['sem'] ?? []).map((item: FaturaItem) => (
                <ItemRow key={item.id} item={item} canEdit={canEdit}
                  onDelete={handleDeleteItem} onSave={handleSaveItem}/>
              ))}
            </JanelaLista>
          </div>
        )}

        {/* Seções por animal */}
        {prop.animais.map(animal => {
          const todosItens: FaturaItem[] = itensPorAnimal[animal.id] ?? [];
          const itensAssistencia = todosItens.filter(i => i.tipo === 'ASSISTENCIA');
          const itensOutros      = todosItens.filter(i => i.tipo !== 'ASSISTENCIA');
          const subtotal = todosItens.reduce((s: number, i: FaturaItem) => s + totalItem(i), 0);

          return (
            <div key={animal.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* ── Informação do cavalo ── */}
              <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 bg-indigo-50/40">
                <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-2">
                  Informação do Cavalo
                </p>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <FotoAnimal url={animal.photoUrl} nome={animal.nome} animalId={animal.id}
                      className="w-10 h-10 rounded-xl flex-shrink-0" iconSize={18} />
                    <div>
                      <p className="text-sm font-bold text-gray-900">{animal.nome}</p>
                      <p className="text-[10px] text-gray-400">
                        {animal.especie?.nome}
                        {animal.raca?.nome ? ` · ${animal.raca.nome}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">Subtotal</p>
                    <p className="text-sm font-bold text-gray-800">{formatBRL(subtotal)}</p>
                  </div>
                </div>
              </div>

              {/* ── Assistência & Serviços Gerais ── */}
              {itensAssistencia.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-blue-50/50 border-b border-gray-100">
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                      Assistência &amp; Serviços Gerais
                    </p>
                  </div>
                  <JanelaLista className="divide-y divide-gray-50">
                    {ordenarComInsumos(itensAssistencia).map(item => (
                      <ItemRow key={item.id} item={item} canEdit={canEdit}
                        onDelete={handleDeleteItem} onSave={handleSaveItem}/>
                    ))}
                  </JanelaLista>
                </>
              )}

              {/* ── Itens da fatura ── */}
              {itensOutros.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-gray-50/70 border-y border-gray-100">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                      Itens da Fatura
                    </p>
                  </div>
                  <JanelaLista className="divide-y divide-gray-50">
                    {ordenarComInsumos(itensOutros).map(item => (
                      <ItemRow key={item.id} item={item} canEdit={canEdit}
                        onDelete={handleDeleteItem} onSave={handleSaveItem}/>
                    ))}
                  </JanelaLista>
                </>
              )}

              {todosItens.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-5">
                  Nenhum lançamento para este animal.
                </p>
              )}
            </div>
          );
        })}

        {/* Animais atendidos por OUTRA clínica do mesmo cliente — a fatura é única do
            proprietário, então os lançamentos aparecem aqui em vez de sumirem. */}
        {animaisForaDoEscopo.map(grupo => (
          <div key={`fora-${grupo.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 pt-3 pb-2.5 border-b border-gray-100 bg-gray-50">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                Informação do Cavalo
              </p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-900">{grupo.nome}</p>
                  <p className="text-[10px] text-gray-400">Lançamentos de outro atendimento deste cliente</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[9px] text-gray-400 uppercase tracking-wide">Subtotal</p>
                  <p className="text-sm font-bold text-gray-800">
                    {formatBRL(grupo.itens.reduce((s, i) => s + totalItem(i), 0))}
                  </p>
                </div>
              </div>
            </div>
            <JanelaLista className="divide-y divide-gray-50">
              {ordenarComInsumos(grupo.itens).map(item => (
                <ItemRow key={item.id} item={item} canEdit={canEdit}
                  onDelete={handleDeleteItem} onSave={handleSaveItem}/>
              ))}
            </JanelaLista>
          </div>
        ))}

        {/* Resumo */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5">Resumo Geral do Proprietário</p>
              <p className="text-sm text-gray-500">Valor Total da Fatura Única:</p>
            </div>
            <p className="text-2xl font-bold text-red-600">{formatBRL(fatura.total)}</p>
          </div>
        </div>

        {/* Formulário novo item */}
        {canEdit && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Lançar Novo Item / Cobrança na Fatura
              </p>
              {podeLancar && (
                <button onClick={() => setShowImportOrc(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 text-emerald-700 rounded-lg text-xs font-semibold hover:bg-emerald-50 transition-colors">
                  <Receipt size={13}/> Importar do orçamento
                </button>
              )}
            </div>
            {/* Tipo + Item Fatura (+ Animal, só com mais de 1 paciente na fatura) —
                lançamento DIRETO (não precisa salvar como frequente antes). Os
                dois são o DropdownAbaixo (não <select> nativo — abre sempre para
                baixo, um <select> deixa o navegador decidir a direção) com as
                opções em ordem alfabética. Escolher um item no atalho seleciona
                o Tipo dele (handleCatalogoChange); Item Fatura mostra TODOS os
                itens, sem filtrar pelo Tipo. "+ Novo tipo…"/"+ Novo item…" abrem
                o ModalNovoTipoItem. Com 1 único paciente o animal já está fixado
                (mostrado acima, no card do proprietário) — não repete aqui. */}
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${prop.animais.length > 1 ? 'lg:grid-cols-3' : ''} gap-3 mb-3`}>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Tipo</label>
                <DropdownAbaixo
                  value={novoTipo}
                  options={tipoOpcoes}
                  placeholder="--"
                  actionLabel="+ Novo tipo…"
                  onChange={val => { setNovoTipo(val); setNovoCatIdx(''); }}
                  onAction={() => {
                    if (!podeLancar) { semPermissao('lançar cobrança na fatura'); return; }
                    setNovoTipoModalTipoInicial(''); // tipo desconhecido — digitado do zero
                    setNovoTipoModalAberto(true);
                  }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Item Fatura <span className="text-red-400">*</span>
                </label>
                <DropdownAbaixo
                  value={novoCatIdx}
                  options={itemFaturaOpcoes}
                  placeholder="--"
                  actionLabel="+ Novo item…"
                  onChange={handleCatalogoChange}
                  onAction={() => {
                    if (!podeLancar) { semPermissao('lançar cobrança na fatura'); return; }
                    setNovoTipoModalTipoInicial(novoTipo); // tipo já escolhido — só falta o nome
                    setNovoTipoModalAberto(true);
                  }}
                />
              </div>
              {/* Só aparece com MAIS de um paciente nesta fatura — com um único, o
                  card do proprietário já deixa claro de quem é a fatura. */}
              {prop.animais.length > 1 && (
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">Animal</label>
                  <select value={novoAnimalId} onChange={e => setNovoAnimalId(e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="">— Geral (sem animal) —</option>
                    {prop.animais.map(a => (
                      <option key={a.id} value={a.id}>{a.nome}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
              {/* Quantidade — 0 é válido de propósito: cadastra o item nos Itens
                  Frequentes sem lançar cobrança na fatura. */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Quantidade</label>
                <input type="number" min="0" value={novoQty} onChange={e => setNovoQty(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:border-indigo-400"/>
              </div>
              {/* Valor — opcional (o único obrigatório junto de Quantidade é o próprio
                  item/tipo escolhido acima; valor 0 é uma cobrança válida) */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Valor Unitário
                </label>
                <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden focus-within:border-indigo-400">
                  <span className="px-2.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 py-2">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={novoValorDisplay}
                    onChange={e => handleValorChange(e.target.value)}
                    placeholder="0,00"
                    className="flex-1 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 rounded-r-xl"/>
                </div>
              </div>
              {/* Desconto — percentual ou valor sobre o total do item */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">Desconto</label>
                <div className="flex gap-1.5">
                  <select value={novoDescTipo}
                    onChange={e => { setNovoDescTipo(e.target.value as DescontoTipo | ''); setNovoDescValor(0); setNovoDescDisplay(''); }}
                    className="border border-gray-300 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-indigo-400 bg-white">
                    <option value="">Não</option>
                    <option value="PERCENTUAL">%</option>
                    <option value="VALOR">R$</option>
                  </select>
                  {novoDescTipo && (
                    <input type="text" inputMode="decimal" value={novoDescDisplay}
                      onChange={e => handleNovoDescValor(e.target.value)}
                      placeholder={novoDescTipo === 'PERCENTUAL' ? '0' : '0,00'}
                      className="flex-1 min-w-0 border border-gray-300 rounded-xl px-2.5 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
                  )}
                </div>
              </div>
              {/* Subtotal preview */}
              <div className="text-center">
                <p className="text-[10px] text-gray-400 mb-1">Total do item</p>
                <p className="text-sm font-bold text-gray-700">{formatBRL(novoBruto - novoDesconto)}</p>
                {novoDesconto > 0 && (
                  <p className="text-[10px] text-red-500">−{formatBRL(novoDesconto)}</p>
                )}
              </div>
              {/* Botão — quantidade 0 só cadastra o item, sem lançar cobrança */}
              <button
                onClick={handleLancar}
                disabled={lancando || !novoTipo || !novoNome.trim()}
                className="flex items-center justify-center gap-2 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors">
                {lancando ? <Loader2 size={14} className="animate-spin"/> : null}
                {Number(novoQty) === 0 ? 'Cadastrar Item' : 'Lançar Cobrança'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Painel esquerdo — lista de proprietários ─────────────────────────────────

// ─── Filtro por STATUS da lista de proprietários ─────────────────────────
//
// A busca por texto acha QUEM; este filtro acha QUEM DEVE — "quais clientes estão em
// atraso" era pergunta que a tela não respondia sem abrir cliente por cliente.
//
// ⚠️ UM componente para os DOIS lugares (dropdown do mobile e barra lateral do
// desktop): duas cópias divergem na primeira correção (CLAUDE.md, armadilha 28-g).
// ⚠️ O proprietário pode estar em MAIS DE UM status ao mesmo tempo (fatura aberta
// deste mês e atrasada do mês passado), então ele aparece nos dois filtros e as
// contagens NÃO somam o total — cada número responde "quantos clientes têm fatura
// NESTE estado", nunca "quantos clientes existem ao todo".

type FiltroLista = 'TODAS' | 'ABERTA' | 'FECHADA' | 'ATRASADA' | 'PAGA';

/** Mesma paleta da barra "Fatura:" do detalhe — o mesmo estado não pode ter uma cor
 *  na lista e outra no painel ao lado. */
const STATUS_LISTA: { key: FiltroLista; label: string; cor: string }[] = [
  { key: 'TODAS',    label: 'Todas',    cor: 'bg-gray-700'    },
  { key: 'ABERTA',   label: 'Aberta',   cor: 'bg-amber-500'   },
  { key: 'FECHADA',  label: 'Fechada',  cor: 'bg-indigo-600'  },
  { key: 'ATRASADA', label: 'Atrasada', cor: 'bg-red-600'     },
  { key: 'PAGA',     label: 'Paga',     cor: 'bg-emerald-600' },
];

/** Cor/rotulo da BOLINHA por status — tom mais claro que o da pilha (pilha é fundo
 *  sólido com texto branco; a bolinha é um ponto de 8px e precisa de contraste
 *  próprio). Mantém exatamente as cores que o card já usava. */
const BOLINHA_STATUS: Record<Exclude<FiltroLista, 'TODAS'>, { cor: string; titulo: string }> = {
  ABERTA:   { cor: 'bg-amber-400',   titulo: 'Fatura aberta'   },
  FECHADA:  { cor: 'bg-indigo-400',  titulo: 'Fatura fechada'  },
  ATRASADA: { cor: 'bg-red-500',     titulo: 'Fatura atrasada' },
  PAGA:     { cor: 'bg-emerald-500', titulo: 'Fatura paga'     },
};

function temStatusNaLista(p: ProprietarioItem, filtro: FiltroLista): boolean {
  switch (filtro) {
    case 'ABERTA':   return !!p.faturaAtiva;
    case 'FECHADA':  return !!p.faturaFechada;
    case 'ATRASADA': return !!p.faturaAtrasada;
    case 'PAGA':     return !!p.faturaPaga;
    default:         return true;
  }
}

function FiltroStatusLista({ valor, onChange, base, className = '' }: {
  valor:      FiltroLista;
  onChange:   (f: FiltroLista) => void;
  /** Lista já filtrada pela BUSCA por texto — a contagem tem de refletir o que a
   *  pessoa está vendo, senão um filtro marcaria "3" e devolveria lista vazia. */
  base:       ProprietarioItem[];
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto pb-0.5 ${className}`}>
      {STATUS_LISTA.map(({ key, label, cor }) => {
        const qtd = key === 'TODAS' ? base.length : base.filter(p => temStatusNaLista(p, key)).length;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
              valor === key ? `${cor} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {label} ({qtd})
          </button>
        );
      })}
    </div>
  );
}

function CardProprietario({
  prop, selecionado, onClick, filtro = 'TODAS',
}: {
  prop: ProprietarioItem; selecionado: boolean; onClick: () => void;
  /** Status escolhido na lista. Com um status ativo a bolinha mostra EXATAMENTE ele
   *  — sem isso o cliente filtrado por "Atrasada" continuaria exibindo também a
   *  bolinha âmbar da fatura aberta, e a cor contradiria o filtro em vigor. */
  filtro?: FiltroLista;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selecionado
          ? 'bg-indigo-50 border-indigo-300 shadow-sm'
          : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50'
      }`}>
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
          {prop.fullName[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{prop.fullName}</p>
            {/* Proprietário inativado na empresa que segue com paciente ativo — sem o
                selo, pareceria bug ele estar na lista de cobrança. Cliente sem NENHUM
                paciente já não chega aqui (filtro em listarProprietarios). */}
            {prop.ativo === false && (
              <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Inativo</span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 truncate">
            {/* O fallback ficou como rede: a lista já não traz cliente sem paciente,
                mas exibir vazio seria pior que dizer o motivo se algum dia voltar. */}
            {prop.animais.map(a => a.nome).join(', ') || 'Sem animais'}
          </p>
        </div>
        {/* Bolinhas indicadoras de faturas existentes. Sem filtro, TODAS as que o
            cliente tem (o mesmo cliente pode ter aberta + atrasada); com filtro, só
            a do status filtrado — a bolinha passa a ser a resposta do filtro. */}
        <div className="flex gap-1 flex-shrink-0">
          {filtro === 'TODAS' ? (
            <>
              {prop.faturaAtiva    && <span className="w-2 h-2 rounded-full bg-amber-400" title="Fatura aberta"/>}
              {prop.faturaFechada  && <span className="w-2 h-2 rounded-full bg-indigo-400" title="Fatura fechada"/>}
              {prop.faturaAtrasada && <span className="w-2 h-2 rounded-full bg-red-500" title="Fatura atrasada"/>}
              {prop.faturaPaga     && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Fatura paga"/>}
            </>
          ) : (
            <span className={`w-2 h-2 rounded-full ${BOLINHA_STATUS[filtro].cor}`} title={BOLINHA_STATUS[filtro].titulo}/>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Modal — Fechar mês em lote + envio ──────────────────────────────────────

interface FechadaLote {
  faturaId: number; total: number; mesReferencia?: string;
  proprietario: { id: number; fullName: string; phone?: string; email: string };
}

function ModalFechamentoLote({ proprietarios, onClose, onDone }: {
  proprietarios: ProprietarioItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mes,       setMes]       = useState(mesAnterior());
  const [fechando,  setFechando]  = useState(false);
  const [resultado, setResultado] = useState<FechadaLote[] | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const abertasDoMes = proprietarios.filter(p => p.faturaAtiva?.mesReferencia === mes);

  const fechar = async () => {
    const ids = abertasDoMes.map(p => p.faturaAtiva!.id);
    if (ids.length === 0) { setErroInline('Nenhuma fatura aberta neste mês'); return; }
    setFechando(true);
    try {
      const r = await api.post('/clinica/faturas/fechar-lote', { faturaIds: ids });
      setResultado((r.data?.dados?.fechadas ?? []) as FechadaLote[]);
      toast.success(`${r.data?.dados?.total ?? 0} fatura(s) fechada(s)`);
      onDone();
    } catch { setErroInline('Erro ao fechar faturas'); }
    finally { setFechando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-bold text-gray-900">Fechar mês em lote</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!resultado ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Mês de referência</label>
                <input type="month" value={mes} onChange={e => setMes(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"/>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-800">
                  {abertasDoMes.length} fatura(s) aberta(s) em {formatMes(mes) || mes}
                </p>
                {abertasDoMes.length > 0 && (
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {abertasDoMes.map(p => (
                      <li key={p.id} className="flex justify-between gap-2 text-xs text-amber-900">
                        <span className="truncate">{p.fullName}</span>
                        <span className="font-semibold flex-shrink-0">{formatBRL(p.faturaAtiva!.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button onClick={fechar} disabled={fechando || abertasDoMes.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors">
                {fechando ? <Loader2 size={15} className="animate-spin"/> : <Check size={15}/>}
                Fechar {abertasDoMes.length} fatura(s) do mês
              </button>
            </>
          ) : (
            <>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-emerald-800">
                  {resultado.length} fatura(s) fechada(s). Envie para os proprietários:
                </p>
              </div>
              <p className="text-[11px] text-gray-400">
                O WhatsApp abre uma conversa por vez — toque em cada proprietário para enviar a mensagem já pronta.
              </p>
              {resultado.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">Nenhuma fatura foi fechada.</p>
              ) : (
                <div className="space-y-2">
                  {resultado.map(f => {
                    const nomeDestino  = f.proprietario.fullName;
                    const foneDestino  = f.proprietario.phone;
                    const emailDestino = f.proprietario.email;
                    const texto = montarTextoFaturaLote(nomeDestino, f.mesReferencia, f.faturaId, f.total);
                    return (
                      <div key={f.faturaId} className="flex items-center gap-2 border border-gray-100 rounded-xl px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{nomeDestino}</p>
                          <p className="text-[11px] text-gray-400">{formatBRL(f.total)}</p>
                        </div>
                        {foneDestino && (
                          <button onClick={() => abrirWhatsApp(texto, foneIntl(foneDestino))}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#25D366] hover:bg-[#20BA5A] text-white rounded-lg text-xs font-semibold transition-colors">
                            <MessageCircle size={12}/> WhatsApp
                          </button>
                        )}
                        <button onClick={() => abrirEmail(`Fatura — ${nomeDestino}`, texto, emailDestino)}
                          className="flex items-center gap-1 px-2.5 py-1 border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-semibold transition-colors">
                          <Mail size={12}/> E-mail
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Faturamento() {
  const { podeExecutar, isGestor, loading: loadingPerm } = usePermissoes();

  /** Aba de fatura DENTRO do cliente — os mesmos status da lista, sem o "Todas".
   *  Derivado de propósito: status novo entra em UM lugar só (`FiltroLista`). */
  type FiltroTipo = Exclude<FiltroLista, 'TODAS'>;

  const [proprietarios, setProprietarios] = useState<ProprietarioItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [busca,         setBusca]         = useState('');
  const [selecionado,   setSelecionado]   = useState<ProprietarioItem | null>(null);
  const [contadores,    setContadores]    = useState({ abertas: 0, fechadas: 0, pagas: 0 });
  const [filtroStatus,  setFiltroStatus]  = useState<FiltroTipo>('ABERTA');
  // Filtro por status da LISTA de proprietários (distinto do `filtroStatus`, que é a
  // aba de fatura DENTRO do cliente selecionado). Começa em "Todas": abrir a tela já
  // escondendo cliente é o oposto do que ela existe para fazer.
  // `?status=` na URL pré-seleciona o filtro — é por aí que os números dos Relatórios
  // Financeiros (contas a receber, inadimplência) chegam já no recorte certo. Valor
  // fora da lista cai em "Todas", nunca num filtro que a tela não sabe exibir.
  const [searchParams] = useSearchParams();
  const statusDaUrl = (searchParams.get('status') ?? '').toUpperCase() as FiltroLista;
  // `?proprietarioId=` abre a tela JÁ NO CLIENTE — é assim que a linha "Faturas
  // editadas / corrigidas" do Relatório de Gestão chega aqui. Aplicado DEPOIS da
  // carga (o cliente só existe quando a lista chega) e UMA vez só (`jaAplicouUrlRef`),
  // senão toda recarga da lista arrastaria a seleção de volta e a pessoa não
  // conseguiria trocar de cliente.
  const proprietarioDaUrl = Number(searchParams.get('proprietarioId')) || null;
  const jaAplicouUrlRef = useRef(false);
  const [filtroLista,   setFiltroLista]   = useState<FiltroLista>(
    STATUS_LISTA.some(x => x.key === statusDaUrl) ? statusDaUrl : 'TODAS',
  );
  // Seletor de mês/ano (só para fatura FECHADA/PAGA) — controla o mês visualizado.
  const [mesView,       setMesView]       = useState<string | null>(null);
  const [faturaMeta,    setFaturaMeta]    = useState<{ meses: MesFatura[]; mesAtual?: string }>({ meses: [] });
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const [showLote,       setShowLote]       = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  const seletorRef = useRef<HTMLDivElement>(null);

  const podeFecharLote = isGestor || podeExecutar('financeiro.faturas.fechar');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/clinica/faturas/proprietarios');
      const lista: ProprietarioItem[] = r.data.dados ?? [];
      setProprietarios(lista);
      setContadores({
        abertas:  lista.filter(p => !!p.faturaAtiva).length,
        fechadas: lista.filter(p => !!p.faturaFechada).length,
        pagas:    lista.filter(p => !!p.faturaPaga).length,
      });
    } catch {
      setErroInline('Erro ao carregar proprietários');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!loadingPerm) carregar(); }, [carregar, loadingPerm]);

  useEffect(() => {
    if (jaAplicouUrlRef.current || !proprietarioDaUrl || proprietarios.length === 0) return;
    jaAplicouUrlRef.current = true;
    const alvo = proprietarios.find(p => p.id === proprietarioDaUrl);
    if (alvo) setSelecionado(alvo);
  }, [proprietarioDaUrl, proprietarios]);

  // Trocar de proprietário — ou o filtro de status da lista — realinha o detalhe: com
  // "Atrasada" filtrado, abrir o cliente na aba "Aberta" mostraria vazio justamente no
  // estado que a pessoa acabou de pedir. Sem filtro, mantém o padrão de sempre (Aberta).
  useEffect(() => {
    setFiltroStatus(filtroLista === 'TODAS' ? 'ABERTA' : filtroLista);
    setMesView(null);
  }, [selecionado?.id, filtroLista]);
  // Trocar o tipo de fatura reseta o mês visualizado.
  useEffect(() => { setMesView(null); }, [filtroStatus]);

  // Fecha o dropdown do seletor ao clicar fora
  useEffect(() => {
    if (!dropdownAberto) return;
    const handler = (e: MouseEvent) => {
      if (seletorRef.current && !seletorRef.current.contains(e.target as Node)) setDropdownAberto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownAberto]);

  // Busca por TEXTO primeiro; o filtro de STATUS incide sobre o resultado dela — as
  // pilhas contam sobre `porBusca`, então o número na pilha é sempre o tamanho da
  // lista que aquele clique vai produzir.
  const porBusca = proprietarios.filter(p => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (
      p.fullName.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      p.animais.some(a => a.nome.toLowerCase().includes(q))
    );
  });
  const filtrados = porBusca.filter(p => temStatusNaLista(p, filtroLista));

  if (loadingPerm) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
    </div>
  );

  if (!podeExecutar('financeiro.faturas.ler')) return null;

  return (
    <PageContainer maxWidth="7xl">
      <div className="flex flex-col space-y-4">
        <BotaoVoltar className="mb-6" />

        <InlineError message={erroInline} />

        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
              <DollarSign size={20} className="text-amber-700"/>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Faturamento</h1>
              <p className="text-sm text-gray-500">Faturas e contas conveniadas por proprietário</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0 ml-auto">
            {contadores.abertas > 0 && (
              <span className="text-sm font-semibold text-amber-600">
                {contadores.abertas} {contadores.abertas === 1 ? 'fatura aberta' : 'faturas abertas'}
              </span>
            )}
            {podeFecharLote && (
              <button
                onClick={() => setShowLote(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors">
                <Check size={13}/> Fechar todas Faturas
              </button>
            )}
          </div>
        </div>

        {/* Mobile/tablet: seletor de proprietário (no desktop usa a lista à esquerda) */}
        <div className="lg:hidden relative" ref={seletorRef}>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Proprietário</label>
          <button
            type="button"
            onClick={() => setDropdownAberto(v => !v)}
            className="w-full flex items-center justify-between gap-2 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm bg-white hover:border-indigo-300 focus:outline-none focus:border-indigo-400 transition-colors">
            {selecionado ? (
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                  {selecionado.fullName[0]?.toUpperCase()}
                </span>
                <span className="font-semibold text-gray-900 truncate">{selecionado.fullName}</span>
              </span>
            ) : (
              <span className="text-gray-400">Selecione um proprietário…</span>
            )}
            <ChevronDown size={16} className={`text-gray-400 flex-shrink-0 transition-transform ${dropdownAberto ? 'rotate-180' : ''}`}/>
          </button>

          {dropdownAberto && (
            <div className="absolute z-30 top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[70vh]">
              {/* Busca */}
              <div className="relative p-2 border-b border-gray-100 flex-shrink-0">
                <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input
                  autoFocus
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar proprietário..."
                  className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 bg-white"
                />
              </div>
              <div className="px-2 pt-2 pb-1 border-b border-gray-100 flex-shrink-0">
                <FiltroStatusLista valor={filtroLista} onChange={setFiltroLista} base={porBusca} />
              </div>
              {/* Lista */}
              <div className="overflow-y-auto p-1.5 space-y-1.5">
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={18} className="animate-spin text-indigo-400"/>
                  </div>
                ) : filtrados.length === 0 ? (
                  <div className="text-center py-8">
                    <DollarSign size={28} className="mx-auto text-gray-200 mb-2"/>
                    <p className="text-xs text-gray-400">
                      {busca                    ? 'Nenhum resultado.'
                        : filtroLista !== 'TODAS' ? `Nenhum proprietário com fatura ${STATUS_LISTA.find(x => x.key === filtroLista)?.label.toLowerCase()}.`
                        :                           'Nenhum proprietário encontrado.'}
                    </p>
                  </div>
                ) : (
                  filtrados.map(p => (
                    <CardProprietario
                      key={p.id} prop={p}
                      selecionado={selecionado?.id === p.id}
                      filtro={filtroLista}
                      onClick={() => { setSelecionado(p); setDropdownAberto(false); setBusca(''); }}
                    />
                  ))
                )}
              </div>
              {/* Atualizar */}
              <div className="p-2 border-t border-gray-100 flex-shrink-0">
                <button
                  onClick={carregar}
                  className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                  <RefreshCw size={11}/> Atualizar lista
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Split: lista de proprietários (só desktop) + detalhe (compartilhado com o mobile) */}
        <div className="lg:flex lg:gap-5 lg:items-start">

          {/* Lista de proprietários — só desktop (mobile/tablet usa o seletor acima) */}
          <div className="hidden lg:flex lg:w-60 lg:flex-shrink-0 flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-120px)]">
            <div className="relative mb-3 flex-shrink-0">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar proprietário..."
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-indigo-400 bg-white"/>
            </div>
            <FiltroStatusLista valor={filtroLista} onChange={setFiltroLista} base={porBusca} className="mb-3 flex-shrink-0" />
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {loading ? (
                <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-indigo-400"/></div>
              ) : filtrados.length === 0 ? (
                <div className="text-center py-8">
                  <DollarSign size={28} className="mx-auto text-gray-200 mb-2"/>
                  <p className="text-xs text-gray-400">
                    {busca                    ? 'Nenhum resultado.'
                      : filtroLista !== 'TODAS' ? `Nenhum proprietário com fatura ${STATUS_LISTA.find(x => x.key === filtroLista)?.label.toLowerCase()}.`
                      :                           'Nenhum proprietário encontrado.'}
                  </p>
                </div>
              ) : (
                filtrados.map(p => (
                  <CardProprietario key={p.id} prop={p} selecionado={selecionado?.id === p.id} filtro={filtroLista} onClick={() => setSelecionado(p)}/>
                ))
              )}
            </div>
            <div className="flex-shrink-0 mt-3">
              <button onClick={carregar}
                className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-gray-300 rounded-xl text-xs text-gray-500 hover:bg-gray-50 hover:border-gray-400 transition-colors">
                <RefreshCw size={11}/> Atualizar
              </button>
            </div>
          </div>

          {/* Detalhe da fatura — compartilhado (mobile: abaixo do seletor; desktop: à direita) */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selecionado ? (
              <>
                {/* Filtros de tipo de fatura + seletor de mês/ano (só p/ Fechada/Paga) */}
                <div className="flex items-center gap-2 mb-3 bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2.5 overflow-x-auto">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Fatura:</p>
                  {[
                    { key: 'ABERTA'   as FiltroTipo, label: 'Aberta',   cor: 'bg-amber-500',   existe: !!selecionado.faturaAtiva    },
                    { key: 'FECHADA'  as FiltroTipo, label: 'Fechada',  cor: 'bg-indigo-600',  existe: !!selecionado.faturaFechada  },
                    { key: 'ATRASADA' as FiltroTipo, label: 'Atrasada', cor: 'bg-red-600',     existe: !!selecionado.faturaAtrasada },
                    { key: 'PAGA'     as FiltroTipo, label: 'Paga',     cor: 'bg-emerald-600', existe: !!selecionado.faturaPaga     },
                  ].map(({ key, label, cor, existe }) => (
                    <button
                      key={key}
                      onClick={() => { setFiltroStatus(key); setMesView(null); }}
                      disabled={!existe}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                        filtroStatus === key ? `${cor} text-white` : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {label}
                    </button>
                  ))}
                  {(filtroStatus === 'FECHADA' || filtroStatus === 'ATRASADA' || filtroStatus === 'PAGA') &&
                    faturaMeta.meses.filter(m => m.status === filtroStatus).length > 0 && (
                    <select value={mesView ?? faturaMeta.mesAtual ?? ''}
                      onChange={e => setMesView(e.target.value)}
                      className="ml-auto border border-gray-300 rounded-lg px-2.5 py-1 text-[11px] bg-white focus:outline-none focus:border-indigo-400">
                      {faturaMeta.meses.filter(m => m.status === filtroStatus).map(m => (
                        <option key={m.id} value={m.mesReferencia ?? ''}>{formatMes(m.mesReferencia) || 'Mês atual'}</option>
                      ))}
                    </select>
                  )}
                </div>

                <PainelFatura
                  key={`${selecionado.id}-${filtroStatus}`}
                  prop={selecionado}
                  onStatusChange={carregar}
                  mes={mesView}
                  onMeta={setFaturaMeta}
                  faturaId={
                    filtroStatus === 'PAGA'     ? selecionado.faturaPaga?.id     :
                    filtroStatus === 'ATRASADA' ? selecionado.faturaAtrasada?.id :
                    filtroStatus === 'FECHADA'  ? selecionado.faturaFechada?.id  :
                    undefined
                  }
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mb-4">
                  <DollarSign size={28} className="text-amber-400"/>
                </div>
                <p className="font-semibold text-gray-700 mb-1">Selecione um proprietário</p>
                <p className="text-sm text-gray-400 max-w-xs">
                  Escolha um proprietário para visualizar a fatura consolidada.
                </p>
              </div>
            )}
          </div>
        </div>

        {showLote && (
          <ModalFechamentoLote
            proprietarios={proprietarios}
            onClose={() => setShowLote(false)}
            onDone={carregar}
          />
        )}
      </div>
    </PageContainer>
  );
}