// frontend/src/pages/Orcamento.tsx
// Orçamento (etapa OPCIONAL): monta um quote por proprietário/animais com
// procedimentos/combos, medicamentos e vacinas. Histórico com status e decisão
// (aceitar tudo / selecionar aceitos). Itens ACEITO são importados na Prescrição/Vacina.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import { usePermissoes } from '../hooks/usePermissoes';
import {
  Receipt, Search, Loader2, Trash2, X, Check, Ban, CheckCircle2,
  ListChecks, Pill, Syringe, PackagePlus, Eye, ChevronLeft, ChevronRight, ChevronDown,
  Pencil, Printer, MessageCircle,
} from 'lucide-react';
import { imprimirOrcamento, gerarPdfOrcamento, nomeArquivoOrcamento } from '../utils/OrcamentoPrint';
import InlineError from '../components/InlineError';
import ErroAcao, { type ErroAcaoDados } from '../components/ErroAcao';

// ─── Tipos ────────────────────────────────────────────────────────────────────
// OUTROS: item avulso (nome + qtd de vezes + valor) que não passa pelas telas
// clínicas — depois de aprovado é lançado direto na fatura (tela Faturamento).
type TipoItem   = 'PROCEDIMENTO' | 'COMBO' | 'MEDICAMENTO' | 'VACINA' | 'OUTROS';
type StatusOrc  = 'RASCUNHO' | 'APROVADO' | 'APROVADO_PARCIALMENTE' | 'REJEITADO' | 'CANCELADO';
type StatusItem = 'PENDENTE' | 'ACEITO' | 'REJEITADO';
/** Desconto do item: percentual sobre o bruto ou abatimento em reais */
type DescontoTipo = 'PERCENTUAL' | 'VALOR';

interface Proprietario { id: number; fullName: string; email: string | null; phone: string | null }
interface Animal { id: number; nome: string; especieId: number | null; especie?: { nome: string } | null; raca?: { nome: string } | null }
interface Proc  { id: number; nome: string; especialidade: string | null; categoria: string; valorVenda: number | null; valorEmpresa: number | null; empresaId: number | null }
interface Combo { id: number; nome: string; valor: number | null; especialidade: string | null }
interface Med   { id: number; nome: string; unidade: string; precoUnitarioBase: number | null; emEstoque: boolean }
interface Vac   { id: number; nome: string; emEstoque: boolean; valorPorDose: number | null }
interface EspecieOpcao { id: number; nome: string }

// Item local (em construção) e item persistido têm o mesmo formato visível
interface ItemLocal {
  key:           string;
  tipo:          TipoItem;
  refId:         number | null;
  descricao:     string;
  especialidade: string | null;
  quantidade:    number;
  unidade:       string | null;
  /** Espécies do item criado à mão — as que a empresa atende (catálogo próprio) */
  especieIds?:   number[];
  /** MEDICAMENTO/PROCEDIMENTO — posologia orçada: quantidade = dias × aplicações/dia */
  dias:          number | null;
  frequencia:    string | null;
  valorUnitario: number;
  descontoTipo:  DescontoTipo | null;
  descontoValor: number;
  animalId:      number | null; // null = nível proprietário
  manual:        boolean;
}
interface ItemSalvo {
  id: number; tipo: TipoItem; refId: number | null; descricao: string; especialidade: string | null;
  quantidade: number; unidade: string | null; dias: number | null; frequencia: string | null;
  valorUnitario: number; descontoTipo: DescontoTipo | null; descontoValor: number; valorTotal: number;
  statusItem: StatusItem; importadoEm: string | null; animalId: number | null; animal?: { id: number; nome: string } | null;
}
interface OrcamentoResumo {
  id: number; numero: number; numeroFormatado: string; status: StatusOrc; observacao: string | null;
  createdAt: string; valorTotal: number; valorAceito: number;
  // O backend (ORC_INCLUDE) já retorna email/phone do proprietário — usados no WhatsApp.
  proprietario: { id: number; fullName: string; email?: string | null; phone?: string | null };
  criadoPor: { id: number; fullName: string } | null;
  itens: ItemSalvo[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** (11) 98765-4321 — o telefone é persistido só com dígitos */
const fmtTelefone = (v?: string | null): string => {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v ?? '';
};
/** "(11) 98765-4321 · cliente@email.com" — omite o que não houver */
const contatoProprietario = (p: { phone?: string | null; email?: string | null }): string =>
  [fmtTelefone(p.phone), p.email].filter(Boolean).join(' · ');

const brl = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatData = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const uid = () => Math.random().toString(36).slice(2);

// WhatsApp exige número internacional (Brasil: 55 + DDD + número) — mesmo helper do Faturamento.
function foneIntl(phone?: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : `55${d}`;
}

function montarTextoOrcamento(o: OrcamentoResumo): string {
  const itens = o.itens.map(i => `• ${i.descricao} — ${i.quantidade} × ${brl(i.valorUnitario)} = ${brl(i.valorTotal)}`);
  return [
    `*Orçamento #${o.numeroFormatado}*`,
    `Cliente: ${o.proprietario.fullName}`,
    `Data: ${formatData(o.createdAt)}`,
    '',
    ...itens,
    '',
    `*Total: ${brl(o.valorTotal)}*`,
    o.valorAceito > 0 ? `Aprovado: ${brl(o.valorAceito)}` : '',
  ].filter(Boolean).join('\n');
}

const STATUS_ORC: Record<StatusOrc, { label: string; cls: string }> = {
  RASCUNHO:              { label: 'Aguardando decisão',   cls: 'bg-amber-100 text-amber-700'    },
  APROVADO:             { label: 'Aprovado',              cls: 'bg-emerald-100 text-emerald-700' },
  APROVADO_PARCIALMENTE: { label: 'Aprovado Parcialmente', cls: 'bg-amber-100 text-amber-700'    },
  REJEITADO:            { label: 'Rejeitado',             cls: 'bg-red-100 text-red-700'         },
  CANCELADO:            { label: 'Cancelado',             cls: 'bg-gray-200 text-gray-500'       },
};

// A decisão do cliente é registrada UMA vez: aprovado, aprovado parcialmente ou
// rejeitado já são o veredito. Só o RASCUNHO ainda aguarda decisão — e o CANCELADO
// não recebe nenhuma. Reabrir o modal depois disso reescreveria itens que já podem
// ter sido importados numa evolução ou lançados na fatura.
const decisaoPendente = (status: StatusOrc): boolean => status === 'RASCUNHO';

const MOTIVO_DECISAO_BLOQUEADA: Record<StatusOrc, string> = {
  RASCUNHO:              'Registrar decisão (aceitar/rejeitar)',
  APROVADO:              'Decisão já registrada: orçamento aprovado',
  APROVADO_PARCIALMENTE: 'Decisão já registrada: Aprovado Parcialmente',
  REJEITADO:             'Decisão já registrada: orçamento rejeitado',
  CANCELADO:             'Orçamento cancelado',
};

// Base SEM largura — para campos que vivem em linha compacta: com `w-full` (100% do
// container) o campo se recusa a encolher e a linha estoura o card "Adicionar itens".
const inputClsBase = 'border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-500';
const inputCls     = `w-full ${inputClsBase}`;

// ─── Agrupamento tipo → animal (mesma ordem usada na impressão) ───────────────
const ORDEM_TIPO: TipoItem[] = ['PROCEDIMENTO', 'COMBO', 'MEDICAMENTO', 'VACINA', 'OUTROS'];

const TIPO_TITULO: Record<TipoItem, string> = {
  PROCEDIMENTO: 'Procedimentos',
  COMBO:        'Combos',
  MEDICAMENTO:  'Medicamentos',
  VACINA:       'Vacinas',
  OUTROS:       'Outros',
};

// ─── Posologia do medicamento (mesmos valores da Prescrição) ──────────────────
const POSOLOGIAS: { value: string; label: string }[] = [
  { value: '1xDia',        label: 'Uma vez ao dia'     },
  { value: '12em12h',      label: '12 em 12H'          },
  { value: '8em8h',        label: '8 em 8H'            },
  { value: '6em6h',        label: '6 em 6H'            },
  { value: '4em4h',        label: '4 em 4H'            },
  { value: '1em1h',        label: '1 em 1H'            },
  { value: 'continuo',     label: 'Contínuo'           },
  { value: 'agora',        label: 'Agora (dose única)' },
  { value: 'seNecessario', label: 'Se necessário'      },
  { value: 'SOS',          label: 'SOS'                },
  { value: '1x2dias',      label: '1x a cada 2 dias'   },
  { value: '1x3dias',      label: '1x a cada 3 dias'   },
  { value: '1xSemana',     label: '1x por semana'      },
  { value: '1x21dias',     label: '1x a cada 21 dias'  },
  { value: '1x30dias',     label: '1x a cada 30 dias'  },
  { value: '1x90dias',     label: '1x a cada 90 dias'  },
];

// Intervalo em horas de cada posologia (espelha INTERVALOS_H do PrescricaoController)
const INTERVALOS_H: Record<string, number> = {
  '1xDia': 24, '12em12h': 12, '8em8h': 8, '6em6h': 6, '4em4h': 4, '1em1h': 1,
  '1x2dias': 48, '1x3dias': 72, '1xSemana': 168, '1x21dias': 504, '1x30dias': 720, '1x90dias': 2160,
};

// Nº de letras a partir do qual a busca consulta o servidor. Abaixo disso nada é
// listado — as telas não despejam o catálogo inteiro, o usuário digita e vai filtrando.
const MIN_BUSCA = 2;
// Teto de itens RENDERIZADOS na lista de seleção. O catálogo de medicamentos da base
// passa de 2.800 registros: com a carga automática (sem exigir busca), pintar tudo de
// uma vez trava a rolagem do dropdown. Mostra-se o começo e a busca refina o resto.
const LIMITE_LISTA = 50;

const posologiaLabel = (v: string | null) =>
  (v && POSOLOGIAS.find(p => p.value === v)?.label) || v || '';

// Quantidade cobrada de um medicamento = nº de aplicações no período orçado.
// Posologias sem intervalo fixo (contínuo/SOS/se necessário) contam 1 por dia;
// "agora" é dose única. O usuário ainda pode ajustar a quantidade na lista.
function aplicacoesNoPeriodo(dias: number, frequencia: string): number {
  const d = Math.max(1, Math.trunc(dias) || 1);
  if (frequencia === 'agora') return 1;
  const h = INTERVALOS_H[frequencia];
  if (!h) return d;
  return Math.max(1, Math.round((d * 24) / h));
}

// Detalhe exibido abaixo da descrição do item na lista do orçamento
function detalheItem(i: { tipo: TipoItem; quantidade: number; dias: number | null; frequencia: string | null }): string {
  // Medicamento e procedimento/combo têm posologia orçada (duração + frequência)
  if (i.tipo === 'MEDICAMENTO' || i.tipo === 'PROCEDIMENTO' || i.tipo === 'COMBO') {
    return [
      i.dias ? `${i.dias} dia${i.dias > 1 ? 's' : ''}` : null,
      i.frequencia ? posologiaLabel(i.frequencia) : null,
    ].filter(Boolean).join(' · ');
  }
  if (i.tipo === 'VACINA')  return i.quantidade > 0 ? `${i.quantidade} dose${i.quantidade > 1 ? 's' : ''}` : '';
  if (i.tipo === 'OUTROS')  return i.quantidade > 0 ? `${i.quantidade}x` : '';
  return '';
}

// ─── Desconto do item (mesma regra do backend — lib/faturaUtils.js) ───────────
interface ComDesconto { quantidade: number; valorUnitario: number; descontoTipo: DescontoTipo | null; descontoValor: number }

function descontoDoItem(i: ComDesconto): number {
  const bruto = i.quantidade * i.valorUnitario;
  const d     = Number(i.descontoValor ?? 0);
  if (!d || d <= 0) return 0;
  const abatimento = i.descontoTipo === 'PERCENTUAL' ? bruto * (Math.min(d, 100) / 100) : d;
  return Math.min(Math.max(abatimento, 0), Math.max(bruto, 0));
}

/** Total do item: bruto (qtd × unitário) menos o desconto. */
const totalItem = (i: ComDesconto): number => i.quantidade * i.valorUnitario - descontoDoItem(i);

// Espécies do item novo: a empresa atendendo UMA, ela é assumida e o seletor nem
// aparece; atendendo várias, o usuário marca para quais o item está sendo criado.
function SeletorEspecies({ especies, valor, onChange }: {
  especies: EspecieOpcao[];
  valor:    number[];
  onChange: (ids: number[]) => void;
}) {
  if (especies.length <= 1) return null;
  const alternar = (id: number) =>
    onChange(valor.includes(id) ? valor.filter(x => x !== id) : [...valor, id]);
  return (
    <div className="w-full">
      <label className="block text-[10px] text-gray-400 mb-1">
        Espécie(s) do novo item <span className="text-red-500">*</span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {especies.map(e => {
          const on = valor.includes(e.id);
          return (
            <button key={e.id} type="button" onClick={() => alternar(e.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                on ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-300'
              }`}>
              {e.nome}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Campo inteiro que PODE ficar vazio enquanto se digita (apagar todos os dígitos não
// volta sozinho para "1"). O valor só é normalizado ao sair do campo / ao usar.
function InputInteiro({ value, onChange, className, title, min = 1 }: {
  value:      number;
  onChange:   (v: number) => void;
  className?: string;
  title?:     string;
  min?:       number;
}) {
  const [texto, setTexto] = useState(String(value));
  // Reflete mudanças vindas de fora (ex: reset do formulário) sem atrapalhar a digitação
  useEffect(() => { setTexto(String(value)); }, [value]);

  return (
    <input
      type="text" inputMode="numeric" value={texto} title={title} className={className}
      onChange={e => {
        const limpo = e.target.value.replace(/\D/g, '');
        setTexto(limpo);                       // vazio é permitido enquanto digita
        if (limpo !== '') onChange(Number(limpo));
      }}
      onBlur={() => {
        const n = Math.max(min, Number(texto) || min);
        setTexto(String(n));
        onChange(n);
      }}
    />
  );
}

interface GrupoAnimal<T> { nome: string; itens: T[]; subtotal: number }
interface SecaoTipo<T>   { tipo: TipoItem; grupos: GrupoAnimal<T>[]; subtotal: number }

// Total do orçamento por animal, somando TODOS os tipos (o subtotal dentro de cada
// seção é só daquele tipo). Ordem alfabética, com o proprietário por último.
// `rotulo` permite tirar o nome direto do item quando ele já vem carregado, evitando
// o lookup por id; o padrão resolve pelo animalId via `nomeAnimal`.
function totaisPorAnimal<T extends { animalId: number | null }>(
  itens: T[],
  nomeAnimal: (id: number | null) => string,
  valor: (i: T) => number,
  rotulo: (i: T) => string = i => nomeAnimal(i.animalId),
): { nome: string; total: number }[] {
  const porAnimal = new Map<string, number>();
  for (const i of itens) {
    const chave = rotulo(i);
    porAnimal.set(chave, (porAnimal.get(chave) ?? 0) + valor(i));
  }
  const SEM = nomeAnimal(null);
  return [...porAnimal.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => (a.nome === SEM ? 1 : b.nome === SEM ? -1 : a.nome.localeCompare(b.nome, 'pt-BR')));
}

// Agrupa por tipo (ordem de ORDEM_TIPO) e, dentro, por animal (alfabético, com o
// grupo do proprietário por último). `valor` extrai o total de cada item.
function agruparPorTipoEAnimal<T extends { tipo: TipoItem; animalId: number | null }>(
  itens: T[],
  nomeAnimal: (id: number | null) => string,
  valor: (i: T) => number,
): SecaoTipo<T>[] {
  const porTipo = new Map<TipoItem, Map<string, T[]>>();
  for (const i of itens) {
    if (!porTipo.has(i.tipo)) porTipo.set(i.tipo, new Map());
    const porAnimal = porTipo.get(i.tipo)!;
    const chave = nomeAnimal(i.animalId);
    if (!porAnimal.has(chave)) porAnimal.set(chave, []);
    porAnimal.get(chave)!.push(i);
  }
  const ordem = (t: TipoItem) => { const n = ORDEM_TIPO.indexOf(t); return n === -1 ? 99 : n; };
  const soma  = (l: T[]) => l.reduce((s, i) => s + valor(i), 0);
  const SEM   = nomeAnimal(null);

  return [...porTipo.keys()]
    .sort((a, b) => ordem(a) - ordem(b))
    .map(tipo => {
      const porAnimal = porTipo.get(tipo)!;
      const grupos = [...porAnimal.keys()]
        .sort((a, b) => (a === SEM ? 1 : b === SEM ? -1 : a.localeCompare(b, 'pt-BR')))
        .map(nome => ({ nome, itens: porAnimal.get(nome)!, subtotal: soma(porAnimal.get(nome)!) }));
      return { tipo, grupos, subtotal: grupos.reduce((s, g) => s + g.subtotal, 0) };
    });
}

// Valor manual formatado como pt-BR (2 casas, milhar "." / decimal ",") — mesma
// configuração dos valores puxados do banco (exibidos via brl). Máscara de centavos:
// os dígitos digitados são lidos como centavos, então "1234550" → 12.345,50.
function InputMoeda({ value, onChange, className, placeholder, title }: {
  value:        number;
  onChange:     (v: number) => void;
  className?:   string;
  placeholder?: string;
  title?:       string;
}) {
  const fmt = (v: number) =>
    v === 0 ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const [display, setDisplay] = useState(fmt(value));
  useEffect(() => { setDisplay(fmt(value)); }, [value]);
  const handle = (raw: string) => {
    const cents = parseInt(raw.replace(/\D/g, '') || '0', 10) / 100;
    setDisplay(fmt(cents));
    onChange(cents);
  };
  return (
    <input type="text" inputMode="decimal" value={display} title={title}
      onChange={e => handle(e.target.value)}
      placeholder={placeholder ?? '0,00'} className={className} />
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────
export default function Orcamento() {
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();
  const podeCriar   = isGestor || podeExecutar('orcamento.orcamentos.criar');
  const podeAprovar = isGestor || podeExecutar('orcamento.orcamentos.aprovar');
  const podeExcluir = isGestor || podeExecutar('orcamento.orcamentos.deletar');

  // Começa no Histórico — o builder (seletor de proprietário) só aparece ao clicar "Novo Orçamento"
  const [aba, setAba] = useState<'novo' | 'historico'>('historico');
  // Trocado a cada clique em "Novo Orçamento" — remonta o builder do zero (limpa
  // proprietário, animais e itens), inclusive quando já se está na aba Novo.
  const [novoKey, setNovoKey] = useState(0);
  // Orçamento em edição (só RASCUNHO). null = criação.
  const [editando, setEditando] = useState<OrcamentoResumo | null>(null);

  const abrirAba = (key: 'novo' | 'historico') => {
    if (key === 'novo') { setEditando(null); setNovoKey(k => k + 1); }
    setAba(key);
  };

  const abrirEdicao = (o: OrcamentoResumo) => {
    setEditando(o); setNovoKey(k => k + 1); setAba('novo');
  };

  if (!loadingPerms && !isGestor && !podeExecutar('orcamento.orcamentos.ler')) {
    return (
      <PageContainer>
        <div className="text-center py-16">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Acesso não autorizado</h2>
          <p className="text-sm text-gray-500">Você não tem permissão para visualizar orçamentos.</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <BotaoVoltar className="mb-4" />
      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Receipt size={20} className="text-emerald-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orçamento</h1>
          <p className="text-sm text-gray-500 mt-0.5">Etapa opcional — monte, aprove e importe nas telas clínicas.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 justify-end">
        {([
          { key: 'novo',      label: 'Novo Orçamento', icon: null },
          { key: 'historico', label: 'Histórico',      icon: <ListChecks size={14} /> },
        ] as { key: 'novo' | 'historico'; label: string; icon: React.ReactNode }[]).map(t => (
          <button key={t.key} onClick={() => abrirAba(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              aba === t.key ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-emerald-300'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {loadingPerms ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-emerald-600" /></div>
      ) : aba === 'novo' ? (
        <BuilderOrcamento key={novoKey} podeCriar={podeCriar} orcamento={editando}
          onSalvo={() => { setEditando(null); setAba('historico'); }}
          onCancelar={() => { setEditando(null); setAba('historico'); }} />
      ) : (
        <HistoricoOrcamentos podeAprovar={podeAprovar} podeExcluir={podeExcluir}
          podeEditar={podeCriar} onEditar={abrirEdicao} />
      )}
    </PageContainer>
  );
}

// ─── Dropdown multi-seleção de animais (com checkbox dentro) ────────────────────
function AnimaisDropdown({ animais, sel, onChange }: {
  animais: Animal[]; sel: number[]; onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const vazio = animais.length === 0;
  const todos = !vazio && sel.length === animais.length;
  const toggle = (id: number) => onChange(sel.includes(id) ? sel.filter(i => i !== id) : [...sel, id]);
  const label = vazio ? 'Sem animais'
    : sel.length === 0 ? 'Nenhum animal'
    : todos ? 'Todos os animais'
    : `${sel.length} de ${animais.length} animais`;

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={vazio} onClick={() => setOpen(o => !o)}
        className={`${inputCls} flex items-center justify-between text-left ${vazio ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : ''}`}>
        <span className={sel.length ? 'text-gray-900' : 'text-gray-400'}>{label}</span>
        <ChevronDown size={14} className="text-gray-400 flex-shrink-0 ml-2" />
      </button>
      {open && !vazio && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          <button type="button" onClick={() => onChange(todos ? [] : animais.map(a => a.id))}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left border-b border-gray-100 hover:bg-gray-50">
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${todos ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
              {todos && <Check size={11} className="text-white" />}
            </span>
            <span className="text-sm font-medium text-gray-700">Todos</span>
          </button>
          {animais.map(a => {
            const checked = sel.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggle(a.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${checked ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                  {checked && <Check size={11} className="text-white" />}
                </span>
                <span className="text-sm text-gray-800 truncate">{a.nome}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Builder ──────────────────────────────────────────────────────────────────
function BuilderOrcamento({ podeCriar, orcamento, onSalvo, onCancelar }: {
  podeCriar: boolean; orcamento?: OrcamentoResumo | null; onSalvo: () => void; onCancelar: () => void;
}) {
  const editando = orcamento ?? null;
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([]);
  const [propSel,   setPropSel]   = useState<number | ''>(editando?.proprietario.id ?? '');
  const [animais,   setAnimais]   = useState<Animal[]>([]);
  const [animaisSel, setAnimaisSel] = useState<number[]>([]);
  const [itens,     setItens]     = useState<ItemLocal[]>(() =>
    (editando?.itens ?? []).map(i => ({
      key: uid(), tipo: i.tipo, refId: i.refId, descricao: i.descricao,
      especialidade: i.especialidade, quantidade: i.quantidade, unidade: i.unidade,
      dias: i.dias ?? null, frequencia: i.frequencia ?? null,
      valorUnitario: i.valorUnitario,
      descontoTipo: i.descontoTipo ?? null, descontoValor: i.descontoValor ?? 0,
      animalId: i.animalId,
      // Já persistido: o catálogo manual foi criado no salvamento anterior — não recriar.
      manual: false,
    }))
  );
  const [salvando,  setSalvando]  = useState(false);
  // Último proprietário para o qual os itens foram montados. Só zera os itens quando o
  // proprietário REALMENTE muda — não na montagem (modo edição traz itens prontos).
  // Comparar valores (em vez de um flag "1ª execução") mantém o efeito idempotente,
  // que é o que o StrictMode exige ao invocá-lo duas vezes no mount em desenvolvimento.
  const propDosItens = useRef<number | ''>(editando?.proprietario.id ?? '');

  const [tipoAba, setTipoAba] = useState<'PROCEDIMENTO' | 'MEDICAMENTO' | 'VACINA' | 'OUTROS'>('PROCEDIMENTO');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);
  // Erro do SALVAR — o botão fica no rodapé de um builder longo; no topo da
  // página a mensagem sai da área visível e o clique parece não ter efeito.
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  // Orçamento no nível do proprietário: nenhum animal é vinculado aos itens.
  // Na edição, um orçamento cujos itens não têm animal já abre nesse modo.
  const [semAnimais, setSemAnimais] = useState<boolean>(
    () => !!editando && (editando.itens ?? []).every(i => i.animalId === null),
  );
  // Lido dentro do efeito de carga sem entrar nas deps — senão marcar/desmarcar
  // o checkbox refaria a busca dos animais.
  const semAnimaisRef = useRef(semAnimais);
  useEffect(() => { semAnimaisRef.current = semAnimais; }, [semAnimais]);

  // Espécies que a EMPRESA atende — definem a espécie do item criado à mão
  const [especiesEmpresa, setEspeciesEmpresa] = useState<EspecieOpcao[]>([]);
  useEffect(() => {
    Promise.all([
      api.get('/equipes/especies-atendidas').catch(() => null),
      api.get('/especialidades/especies').catch(() => null),
    ]).then(([rEmp, rTodas]) => {
      const ids: number[] = rEmp?.data?.dados?.especiesAtendidas ?? [];
      const todas: EspecieOpcao[] = rTodas?.data?.dados ?? rTodas?.data ?? [];
      if (!Array.isArray(todas)) return;
      // Sem configuração de espécies na empresa, o item manual fica sem espécie —
      // aí não há o que perguntar (e o catálogo global segue disponível).
      setEspeciesEmpresa(ids.length > 0 ? todas.filter(e => ids.includes(e.id)) : []);
    });
  }, []);

  useEffect(() => {
    api.get('/orcamentos/proprietarios').then(r => {
      if (!r.data) return;
      // Proprietário distinto — dedup por e-mail normalizado (contas duplicadas por
      // maiúsc/minúsc geram ids diferentes com o mesmo nome/pessoa).
      const vistos = new Set<string>();
      const lista: Proprietario[] = (r.data.dados ?? []).filter((p: Proprietario) => {
        const k = (p.email || p.fullName || String(p.id)).trim().toLowerCase();
        return vistos.has(k) ? false : (vistos.add(k), true);
      });
      setProprietarios(lista);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!propSel) { setAnimais([]); setAnimaisSel([]); return; }
    api.get(`/orcamentos/proprietario/${propSel}/animais`).then(r => {
      if (!r.data) return;
      const lista: Animal[] = r.data.dados ?? [];
      setAnimais(lista);
      setAnimaisSel(semAnimaisRef.current ? [] : lista.map(a => a.id));
    }).catch(() => {});
    // Trocar de proprietário invalida os itens já montados.
    if (propDosItens.current !== propSel) {
      propDosItens.current = propSel;
      setItens([]);
    }
  }, [propSel]);

  // Contexto de espécie para procedimento/medicamento/vacina: 1º animal selecionado.
  // No modo "sem animais" cai no 1º animal do proprietário — serve só para filtrar o
  // catálogo por espécie e carregar estoque; o item continua sendo gravado sem animal.
  const animalContextoId  = animaisSel[0] ?? animais[0]?.id ?? null;
  const animalContextoObj = animais.find(a => a.id === animalContextoId) ?? null;

  // Uma LINHA POR ANIMAL selecionado (em vez de uma linha com quantidade × N): é o que
  // permite agrupar por animal no orçamento e na impressão, e deixa ajustar quantidade
  // ou valor de um animal sem afetar os outros. O total é o mesmo de antes.
  // Sem animal selecionado, o item fica no nível do proprietário (animalId null).
  //
  // Tipos cujo PREÇO É DA TABELA DA CLÍNICA, não do animal: o mesmo item custa o
  // mesmo para todo mundo no orçamento. Mexeu no valor de um, muda em todos.
  // OUTROS entra junto: lançado para vários animais, é a mesma taxa para cada um.
  // (COMBO fica de fora: o valor é do pacote montado, não de um item de tabela —
  // dois combos de mesmo nome podem legitimamente ter preços diferentes.)
  const TIPOS_PRECO_UNICO: TipoItem[] = ['PROCEDIMENTO', 'MEDICAMENTO', 'VACINA', 'OUTROS'];

  // Duas linhas são o MESMO item quando apontam para o mesmo cadastro (refId); para
  // item manual (refId null) o nome é o que identifica.
  const mesmoItemDeTabela = (a: { tipo: TipoItem; refId: number | null; descricao: string },
                             b: { tipo: TipoItem; refId: number | null; descricao: string }) =>
    a.tipo === b.tipo
    && TIPOS_PRECO_UNICO.includes(a.tipo)
    && (a.refId !== null ? b.refId === a.refId : b.descricao === a.descricao);

  // Se o item já está no orçamento, a nova linha nasce com o valor que está lá (que
  // pode ter sido ajustado) em vez do valor do catálogo — mantendo o preço idêntico
  // entre todos os animais já na inclusão.
  const addItem = (it: Omit<ItemLocal, 'key' | 'animalId'>) => {
    // TODOS os tipos são rateados pelos animais selecionados — uma linha por animal,
    // OUTROS inclusive. Antes ele ignorava a seleção e caía sempre no nível do
    // proprietário, o que impedia cobrar uma taxa/transporte por paciente.
    // Sem nenhum animal selecionado, a linha nasce no nível do proprietário.
    const alvos: (number | null)[] = animaisSel.length > 0 ? animaisSel : [null];
    setItens(prev => {
      let valorUnitario = it.valorUnitario;
      if (TIPOS_PRECO_UNICO.includes(it.tipo)) {
        const existente = prev.find(x => mesmoItemDeTabela(it, x));
        if (existente) valorUnitario = existente.valorUnitario;
      }
      return [...prev, ...alvos.map(animalId => ({ ...it, valorUnitario, key: uid(), animalId }))];
    });
  };

  // Alterar o valor de um item de tabela replica em TODAS as linhas do mesmo item —
  // inclusive nas de outros animais. Antes valia só para PROCEDIMENTO; medicamento e
  // vacina obrigavam a repetir o ajuste animal por animal, e bastava esquecer um para
  // o orçamento sair com dois preços para a mesma coisa.
  const alterarValorUnitario = (alvo: ItemLocal, valor: number) => {
    const replicar = TIPOS_PRECO_UNICO.includes(alvo.tipo);
    setItens(prev => prev.map(x =>
      (replicar ? mesmoItemDeTabela(alvo, x) : x.key === alvo.key)
        ? { ...x, valorUnitario: valor }
        : x,
    ));
  };

  const total = itens.reduce((s, i) => s + totalItem(i), 0);

  // Resolve o nome do animal a partir de DUAS fontes: a lista carregada do proprietário
  // e os nomes já embutidos nos itens do orçamento em edição (backend manda animal.nome).
  // Sem o segundo, um animal fora da lista (inativo/outro escopo) apareceria como "#id".
  const nomesAnimais = useMemo(() => {
    const m = new Map<number, string>();
    for (const i of (editando?.itens ?? [])) {
      if (i.animalId != null && i.animal?.nome) m.set(i.animalId, i.animal.nome);
    }
    for (const a of animais) m.set(a.id, a.nome);
    return m;
  }, [editando, animais]);

  const nomeAnimal = (id: number | null) => id == null ? 'Proprietário' : (nomesAnimais.get(id) ?? `#${id}`);

  const salvar = async () => {
    setErroAcao(null);
    if (!podeCriar) { setErroAcao({ mensagem: 'Sem permissão para criar orçamento.' }); return; }
    if (!propSel) { setErroAcao({ mensagem: 'Selecione o proprietário', campos: ['proprietario'] }); return; }
    if (itens.length === 0) { setErroAcao({ mensagem: 'Adicione ao menos um item', campos: ['itens'] }); return; }
    setSalvando(true);
    try {
      const payloadItens = itens.map(i => ({
        tipo: i.tipo, refId: i.refId, descricao: i.descricao, especialidade: i.especialidade,
        quantidade: i.quantidade, unidade: i.unidade, dias: i.dias, frequencia: i.frequencia,
        valorUnitario: i.valorUnitario, descontoTipo: i.descontoTipo, descontoValor: i.descontoValor,
        animalId: i.animalId, manual: i.manual, especieIds: i.especieIds ?? [],
      }));
      if (editando) {
        // PUT substitui os itens; observacao é reenviada para não ser apagada.
        await api.put(`/orcamentos/${editando.id}`, { observacao: editando.observacao, itens: payloadItens });
        toast.success('Orçamento atualizado');
      } else {
        await api.post('/orcamentos', { proprietarioId: Number(propSel), itens: payloadItens });
        toast.success('Orçamento salvo');
      }
      onSalvo();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroAcao({ mensagem: e.response?.data?.error ?? 'Erro ao salvar orçamento' });
    } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-4">
      <InlineError message={erroInline} />

      {/* Proprietário + animais (lado a lado) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Proprietário *</label>
            <select value={propSel} onChange={e => setPropSel(e.target.value ? Number(e.target.value) : '')}
              disabled={!!editando} title={editando ? 'O proprietário não muda ao editar um orçamento' : undefined}
              className={`${inputCls} ${editando ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}>
              <option value="">— Selecionar —</option>
              {proprietarios.map(p => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Animais</label>
            {propSel === '' ? (
              <div className={`${inputCls} bg-gray-50 text-gray-400`}>Selecione o proprietário</div>
            ) : semAnimais ? (
              <div className={`${inputCls} bg-gray-50 text-gray-400`}>Orçamento no nível do proprietário</div>
            ) : (
              <AnimaisDropdown animais={animais} sel={animaisSel} onChange={setAnimaisSel} />
            )}
            {propSel !== '' && (
              <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={semAnimais}
                  onChange={e => {
                    const marcado = e.target.checked;
                    setSemAnimais(marcado);
                    // Marcar limpa a seleção; desmarcar volta a todos os animais
                    setAnimaisSel(marcado ? [] : animais.map(a => a.id));
                  }}
                  className="w-4 h-4 rounded border-gray-300 accent-emerald-600 flex-shrink-0"
                />
                <span className="text-xs text-gray-600">
                  Não selecionar animais — orçar apenas para o proprietário
                </span>
              </label>
            )}
          </div>
        </div>
      </div>

      {propSel !== '' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Coluna 1 — Adicionar itens */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Adicionar itens</p>
            </div>

            <div className="flex flex-wrap gap-1">
              {([
                { key: 'PROCEDIMENTO', label: 'Procedimentos', icon: <ListChecks size={13} /> },
                { key: 'MEDICAMENTO',  label: 'Medicamentos',  icon: <Pill size={13} /> },
                { key: 'VACINA',       label: 'Vacinas',       icon: <Syringe size={13} /> },
                { key: 'OUTROS',       label: 'Outros',        icon: <PackagePlus size={13} /> },
              ] as { key: typeof tipoAba; label: string; icon: React.ReactNode }[]).map(t => (
                <button key={t.key} onClick={() => setTipoAba(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    tipoAba === t.key ? 'bg-emerald-700 text-white' : 'bg-white border border-gray-200 text-gray-600'
                  }`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            {tipoAba === 'PROCEDIMENTO' && (
              <TabProcedimentos especie={animalContextoObj?.especie?.nome ?? null}
                especiesEmpresa={especiesEmpresa} onAdd={addItem} />
            )}
            {tipoAba === 'MEDICAMENTO' && (
              <TabMedicamentos animalId={animalContextoId}
                especiesEmpresa={especiesEmpresa} onAdd={addItem} />
            )}
            {tipoAba === 'VACINA' && (
              <TabVacinas animalId={animalContextoId}
                especiesEmpresa={especiesEmpresa} onAdd={addItem} />
            )}
            {tipoAba === 'OUTROS' && (
              <TabOutros onAdd={addItem} />
            )}
          </div>

          {/* Coluna 2 — Itens do orçamento */}
          <div className="space-y-4 lg:sticky lg:top-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Itens do orçamento</p>
              <span className="text-xs text-gray-400">{itens.length} item{itens.length !== 1 ? 's' : ''}</span>
            </div>
            {itens.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">Nenhum item adicionado ainda.</div>
            ) : (
              <div>
                {agruparPorTipoEAnimal(itens, nomeAnimal, totalItem).map(sec => (
                  <div key={sec.tipo}>
                    {/* Seção do tipo */}
                    <div className="px-4 py-2 flex items-center justify-between bg-emerald-50 border-y border-emerald-100">
                      <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                        {TIPO_TITULO[sec.tipo]}
                      </span>
                      <span className="text-xs font-bold text-emerald-700">{brl(sec.subtotal)}</span>
                    </div>

                    {sec.grupos.map(g => (
                      <div key={g.nome}>
                        {/* Subseção do animal */}
                        <div className="px-4 py-1.5 flex items-center justify-between bg-gray-50">
                          <span className="text-[11px] font-semibold text-gray-600">{g.nome}</span>
                          <span className="text-[11px] font-semibold text-gray-500">{brl(g.subtotal)}</span>
                        </div>

                        {g.itens.map(it => (
                          <div key={it.key} className="px-4 py-2.5 flex items-center gap-3 border-b border-gray-50">
                            <div className="flex-1 min-w-0 pl-2">
                              <p className="text-sm text-gray-800 truncate">
                                {it.descricao}
                                {it.manual && <span className="ml-1.5 text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full align-middle">MANUAL</span>}
                              </p>
                              {(it.especialidade || detalheItem(it)) && (
                                <p className="text-[11px] text-gray-400">
                                  {[it.especialidade, detalheItem(it)].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>
                            <InputInteiro value={it.quantidade}
                              onChange={v => setItens(prev => prev.map(x => x.key === it.key ? { ...x, quantidade: v } : x))}
                              className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:border-emerald-500" title="Quantidade" />
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400">R$</span>
                              <InputMoeda value={it.valorUnitario}
                                onChange={v => alterarValorUnitario(it, v)}
                                className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right focus:outline-none focus:border-emerald-500"
                                title={TIPOS_PRECO_UNICO.includes(it.tipo)
                                  ? 'Valor unitário — replicado nas demais linhas deste mesmo item'
                                  : 'Valor unitário'} />
                            </div>
                            {/* Desconto do item — percentual (0-100) ou valor em R$ */}
                            <div className="flex items-center gap-1">
                              <select value={it.descontoTipo ?? ''} title="Desconto"
                                onChange={e => {
                                  const tipo = (e.target.value || null) as DescontoTipo | null;
                                  setItens(prev => prev.map(x => x.key === it.key
                                    ? { ...x, descontoTipo: tipo, descontoValor: 0 } : x));
                                }}
                                className="border border-gray-200 rounded-lg px-1 py-1 text-[11px] text-gray-600 focus:outline-none focus:border-emerald-500">
                                <option value="">s/ desc.</option>
                                <option value="PERCENTUAL">%</option>
                                <option value="VALOR">R$</option>
                              </select>
                              {it.descontoTipo === 'PERCENTUAL' && (
                                <InputInteiro value={it.descontoValor} min={0} title="Desconto em %"
                                  onChange={v => setItens(prev => prev.map(x => x.key === it.key
                                    ? { ...x, descontoValor: Math.min(100, v) } : x))}
                                  className="w-12 border border-gray-200 rounded-lg px-1 py-1 text-xs text-right focus:outline-none focus:border-emerald-500" />
                              )}
                              {it.descontoTipo === 'VALOR' && (
                                <InputMoeda value={it.descontoValor} title="Desconto em R$"
                                  onChange={v => setItens(prev => prev.map(x => x.key === it.key
                                    ? { ...x, descontoValor: v } : x))}
                                  className="w-16 border border-gray-200 rounded-lg px-1 py-1 text-xs text-right focus:outline-none focus:border-emerald-500" />
                              )}
                            </div>
                            <span className="w-24 text-right text-sm font-semibold text-emerald-700">
                              {descontoDoItem(it) > 0 && (
                                <span className="block text-[10px] font-normal text-gray-400 line-through">
                                  {brl(it.quantidade * it.valorUnitario)}
                                </span>
                              )}
                              {brl(totalItem(it))}
                            </span>
                            <button onClick={() => setItens(prev => prev.filter(x => x.key !== it.key))} className="p-1 text-gray-300 hover:text-red-500">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}

                {/* Total por animal — consolida todos os tipos */}
                {(() => {
                  const porAnimal = totaisPorAnimal(itens, nomeAnimal, totalItem);
                  // Com um único grupo o resumo repetiria o total geral — não agrega nada
                  if (porAnimal.length < 2) return null;
                  return (
                    <div className="px-4 py-3 border-t border-gray-200 bg-white">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                        Total por animal
                      </p>
                      <div className="space-y-1">
                        {porAnimal.map(a => (
                          <div key={a.nome} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 truncate">{a.nome}</span>
                            <span className="font-semibold text-gray-800 flex-shrink-0 ml-3">{brl(a.total)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="px-4 py-3 flex items-center justify-between bg-gray-100 border-t border-gray-200">
                  <span className="text-sm font-semibold text-gray-700">Total</span>
                  <span className="text-base font-bold text-emerald-700">{brl(total)}</span>
                </div>
              </div>
            )}
          </div>

          <ErroAcao erro={erroAcao} className="mb-3" />
            <div className="flex justify-end gap-2">
            <button onClick={onCancelar} disabled={salvando}
              className="px-5 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-2xl hover:bg-gray-50 disabled:opacity-50 transition-colors">
              Cancelar
            </button>
            <button onClick={salvar} disabled={salvando || itens.length === 0}
              className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white text-sm font-semibold rounded-2xl shadow-sm transition-colors">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
              {editando ? `Atualizar orçamento #${editando.numeroFormatado}` : 'Salvar orçamento'}
            </button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab Procedimentos (procedimentos + combos por especialidade + manual) ─────
function TabProcedimentos({ especie, especiesEmpresa, onAdd }: {
  especie: string | null;
  especiesEmpresa: EspecieOpcao[];
  onAdd: (it: Omit<ItemLocal, 'key' | 'animalId'>) => void;
}) {
  const [busca, setBusca]     = useState('');
  const [espList, setEspList] = useState<string[]>([]);
  const [espSel, setEspSel]   = useState('');
  const [procs, setProcs]     = useState<Proc[]>([]);
  const [combos, setCombos]   = useState<Combo[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual]   = useState(false);
  const [mNome, setMNome]     = useState('');
  const [mEsp, setMEsp]       = useState('');
  const [mValor, setMValor]   = useState(0);
  // Posologia orçada do procedimento (duração + frequência) — igual à do medicamento;
  // a quantidade cobrada é o nº de sessões no período e volta na importação da prescrição.
  const [dias, setDias]             = useState(1);
  const [frequencia, setFrequencia] = useState('1xDia');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const qtdOrcada = aplicacoesNoPeriodo(dias, frequencia);

  // Espécies do item manual: com uma só na empresa ela é assumida; com várias, escolhidas
  const [mEspecies, setMEspecies] = useState<number[]>([]);
  const especiesDoNovoItem = especiesEmpresa.length === 1 ? [especiesEmpresa[0].id] : mEspecies;
  const faltaEspecie = especiesEmpresa.length > 1 && mEspecies.length === 0;

  useEffect(() => {
    api.get('/procedimentos/especialidades-minhas').then(r => { if (r.data) setEspList(r.data.dados ?? []); }).catch(() => {});
    api.get('/procedimentos/cadastro/combos').then(r => { if (r.data) setCombos(r.data.dados ?? []); }).catch(() => {});
  }, []);

  // A lista abre ao ESCOLHER A ESPECIALIDADE — mesma lógica do Atendimento, que carrega
  // o catálogo e deixa o usuário filtrar depois. Antes nada aparecia até digitar
  // MIN_BUSCA letras, o que obrigava a adivinhar o nome do procedimento.
  // Sem especialidade ("— Todas —") a lista só abre com busca, para não despejar o
  // catálogo inteiro de uma vez.
  const termo = busca.trim();
  const podeListar = !!espSel || termo.length >= MIN_BUSCA;
  useEffect(() => {
    if (!podeListar) { setProcs([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/procedimentos/cadastro/lista', {
        params: {
          ...(termo.length >= MIN_BUSCA ? { busca: termo } : {}),
          ...(espSel ? { especialidade: espSel } : {}),
          ...(especie ? { especie } : {}),
        },
      })
        .then(r => { if (r.data) setProcs(r.data.dados ?? []); })
        .catch(() => {}).finally(() => setLoading(false));
    }, termo.length >= MIN_BUSCA ? 300 : 0);   // troca de especialidade responde na hora
    return () => clearTimeout(t);
  }, [termo, espSel, especie, podeListar]);

  // Combos são poucos (cadastro da empresa) e já vêm carregados — filtram client-side
  // pela mesma especialidade/termo. Sem especialidade escolhida, só entram os que têm a própria.
  const combosDaEsp = !podeListar ? [] : combos.filter(c =>
    (espSel ? (!c.especialidade || c.especialidade === espSel) : !!c.especialidade)
    && (termo.length < MIN_BUSCA || c.nome.toLowerCase().includes(termo.toLowerCase())));
  const valorProc = (p: Proc) => p.valorEmpresa ?? p.valorVenda ?? 0;

  return (
    <div className="space-y-3">
      <InlineError message={erroInline} />

      {/* Especialidade + Qtd. de dias + Frequência — mesma linha, cada um com título */}
      {!manual && (
        <div className="flex items-end gap-1.5 w-full">
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Especialidade</label>
            <select value={espSel} onChange={e => setEspSel(e.target.value)}
              className={`${inputClsBase} w-full px-2`}>
              <option value="">— Todas —</option>
              {espList.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="w-16 flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Qtd. dias</label>
            <InputInteiro value={dias} onChange={setDias} title="Qtd. de dias (posologia orçada)"
              className={`${inputClsBase} w-full px-2 text-center`} />
          </div>
          <div className="flex-1 min-w-0">
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Frequência</label>
            <select value={frequencia} onChange={e => setFrequencia(e.target.value)}
              className={`${inputClsBase} w-full px-2`}>
              {POSOLOGIAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <span className="text-[11px] font-bold text-emerald-700 flex-shrink-0 pb-2.5"
            title="Sessões cobradas no período">
            {qtdOrcada}x
          </span>
        </div>
      )}

      {manual && (
        <div className="p-3 bg-gray-50 rounded-xl space-y-2">
          <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Novo procedimento</p>
          {/* Nome + Especialidade + Qtd. dias + Valor — uma linha só; os dois campos
              de texto encolhem (min-w-0) para caber junto dos de largura fixa. */}
          <div className="flex items-end gap-1.5 w-full">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-gray-400 mb-1">Procedimento (novo)</label>
              <input value={mNome} onChange={e => setMNome(e.target.value)} placeholder="Nome"
                className={`${inputClsBase} w-full px-2`} />
            </div>
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] text-gray-400 mb-1">
                Especialidade <span className="text-red-500">*</span>
              </label>
              <select value={mEsp} onChange={e => setMEsp(e.target.value)}
                className={`${inputClsBase} w-full px-2`}>
                <option value="">— Selecionar —</option>
                {espList.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="w-14 flex-shrink-0">
              <label className="block text-[10px] text-gray-400 mb-1">Dias</label>
              <InputInteiro value={dias} onChange={setDias} title="Qtd. de dias (posologia orçada)"
                className={`${inputClsBase} w-full px-2 text-center`} />
            </div>
            <div className="w-24 flex-shrink-0">
              <label className="block text-[10px] text-gray-400 mb-1">Valor</label>
              <InputMoeda value={mValor} onChange={setMValor} className={`${inputClsBase} w-full px-2 text-right`} />
            </div>
          </div>
          <SeletorEspecies especies={especiesEmpresa} valor={mEspecies} onChange={setMEspecies} />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setManual(false); setErroInline(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
              Cancelar
            </button>
            <button onClick={() => {
              if (!mNome.trim()) { setErroInline('Informe o nome'); return; }
              // Especialidade é obrigatória no orçamento — é ela que volta preenchida
              // na importação para a prescrição (não aparece no documento do cliente).
              if (!mEsp)         { setErroInline('Selecione a especialidade'); return; }
              if (faltaEspecie)  { setErroInline('Selecione a(s) espécie(s) do novo item'); return; }
              setErroInline(null);
              onAdd({ tipo: 'PROCEDIMENTO', refId: null, descricao: mNome.trim(), especialidade: mEsp, quantidade: qtdOrcada, unidade: null, dias, frequencia, valorUnitario: mValor || 0, descontoTipo: null, descontoValor: 0, manual: true, especieIds: especiesDoNovoItem });
              setMNome(''); setMEsp(''); setMValor(0); setManual(false); setBusca(''); setDias(1); setFrequencia('1xDia'); setMEspecies([]);
            }}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">Adicionar</button>
          </div>
        </div>
      )}

      {!manual && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar procedimento ou combo..." className={`${inputCls} pl-8`} />
        </div>
      )}

      {!manual && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {!podeListar ? null : loading ? (
            <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-emerald-600" /></div>
          ) : (<>
          {/* Combo/procedimento sem especialidade própria herda a do filtro (espSel):
              nenhum item entra no orçamento sem especialidade. */}
          {combosDaEsp.map(c => (
            <button key={`c${c.id}`} onClick={() => {
                onAdd({ tipo: 'COMBO', refId: c.id, descricao: c.nome, especialidade: c.especialidade || espSel, quantidade: qtdOrcada, unidade: null, dias, frequencia, valorUnitario: c.valor ?? 0, descontoTipo: null, descontoValor: 0, manual: false });
                setBusca(''); setDias(1); setFrequencia('1xDia'); // inserido → fecha a lista e zera a posologia
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-purple-100 bg-purple-50/40 hover:bg-purple-50 text-left">
              <span className="text-sm text-gray-800 truncate">{c.nome} <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">COMBO</span></span>
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">{brl(c.valor)}</span>
            </button>
          ))}
          {procs.slice(0, LIMITE_LISTA).map(p => (
            <button key={p.id} onClick={() => {
                // Todo item do orçamento precisa de especialidade (é ela que volta na
                // importação para a prescrição). Buscando em "Todas", um procedimento
                // sem especialidade própria só entra depois de escolher uma acima.
                const esp = p.especialidade || espSel;
                if (!esp) { setErroInline('Escolha a especialidade para incluir este procedimento.'); return; }
                setErroInline(null);
                onAdd({ tipo: 'PROCEDIMENTO', refId: p.id, descricao: p.nome, especialidade: esp, quantidade: qtdOrcada, unidade: null, dias, frequencia, valorUnitario: valorProc(p), descontoTipo: null, descontoValor: 0, manual: false });
                setBusca(''); setDias(1); setFrequencia('1xDia'); // inserido → fecha a lista e zera a posologia
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 text-left">
              <span className="text-sm text-gray-800 truncate">{p.nome}{p.empresaId ? <span className="ml-1.5 text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">EMPRESA</span> : ''}</span>
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">{brl(valorProc(p))}</span>
            </button>
          ))}
          {combosDaEsp.length === 0 && procs.length === 0 && (
            <p className="text-xs text-gray-400 py-4 text-center">
              {termo.length >= MIN_BUSCA
                ? <>Nenhum procedimento/combo para “{termo}”{espSel ? ` em ${espSel}` : ''}.</>
                : <>Nenhum procedimento/combo em {espSel}.</>}
            </p>
          )}
          {procs.length > LIMITE_LISTA && (
            <p className="text-[11px] text-gray-400 py-2 text-center">
              Mostrando {LIMITE_LISTA} de {procs.length} — use a busca para refinar.
            </p>
          )}
          </>)}
          {/* Última opção do seletor — mesmo padrão do "Incluir novo" dos cadastros */}
          <button onClick={() => { setManual(true); if (espSel && !mEsp) setMEsp(espSel); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-left text-sm font-medium">
            <PackagePlus size={14} className="flex-shrink-0" /> Inserir Procedimento Manualmente
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab Medicamentos ──────────────────────────────────────────────────────────
function TabMedicamentos({ animalId, especiesEmpresa, onAdd }: {
  animalId: number | null;
  especiesEmpresa: EspecieOpcao[];
  onAdd: (it: Omit<ItemLocal, 'key' | 'animalId'>) => void;
}) {
  const [busca, setBusca] = useState('');
  const [meds, setMeds]   = useState<Med[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual]   = useState(false);
  const [mNome, setMNome]     = useState('');
  const [mUnid, setMUnid]     = useState('');
  const [mValor, setMValor]   = useState(0);
  // Posologia orçada — aplicada a todo medicamento adicionado (catálogo ou manual).
  // A quantidade cobrada é o nº de aplicações no período (dias × frequência).
  const [dias, setDias]             = useState(1);
  const [frequencia, setFrequencia] = useState('1xDia');
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const qtdOrcada = aplicacoesNoPeriodo(dias, frequencia);

  // Espécies do item manual: com uma só na empresa ela é assumida; com várias, escolhidas
  const [mEspecies, setMEspecies] = useState<number[]>([]);
  const especiesDoNovoItem = especiesEmpresa.length === 1 ? [especiesEmpresa[0].id] : mEspecies;
  const faltaEspecie = especiesEmpresa.length > 1 && mEspecies.length === 0;

  // Lista carregada AUTOMATICAMENTE ao abrir a aba — mesma lógica do Atendimento
  // (SubModuloPrescricao carrega o catálogo no mount e filtra depois). Antes nada
  // aparecia até digitar MIN_BUSCA letras. A busca continua refinando (server-side,
  // com debounce), mas deixou de ser pré-requisito para ver alguma coisa.
  const termo = busca.trim();
  useEffect(() => {
    if (!animalId) { setMeds([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/medicamentos/para-atendimento', {
        params: { animalId, tipo: 'medicamento', ...(termo.length >= MIN_BUSCA ? { busca: termo } : {}) },
      })
        .then(r => { if (r.data) setMeds(r.data.dados ?? []); })
        .catch(() => {}).finally(() => setLoading(false));
    }, termo.length >= MIN_BUSCA ? 300 : 0);   // carga inicial não espera debounce
    return () => clearTimeout(t);
  }, [termo, animalId]);

  if (!animalId) return <p className="text-xs text-amber-600 py-2">Selecione ao menos um animal para orçar medicamentos.</p>;

  return (
    <div className="space-y-3">
      <InlineError message={erroInline} />

      {/* Qtd. de dias + Frequência — mesma linha, cada um com título.
          Vem ANTES da busca: define-se a posologia e só então se escolhe o
          medicamento na lista logo abaixo. */}
      <div className="flex items-end gap-1.5 w-full">
        <div className="w-16 flex-shrink-0">
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Qtd. dias</label>
          <InputInteiro value={dias} onChange={setDias} title="Qtd. de dias (posologia orçada)"
            className={`${inputClsBase} w-full px-2 text-center`} />
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-[10px] font-medium text-gray-500 mb-1">Frequência</label>
          <select value={frequencia} onChange={e => setFrequencia(e.target.value)}
            className={`${inputClsBase} w-full px-2`}>
            {POSOLOGIAS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        <span className="text-[11px] font-bold text-emerald-700 flex-shrink-0 pb-2.5"
          title="Aplicações cobradas no período">
          {qtdOrcada}x
        </span>
      </div>

      {/* Busca — abaixo da posologia, encostada na lista que ela filtra */}
      {!manual && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar medicamento..." className={`${inputCls} pl-8`} />
        </div>
      )}

      {manual && (
        <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-xl">
          <p className="w-full text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Novo medicamento</p>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] text-gray-400 mb-1">Medicamento (novo)</label>
            <input value={mNome} onChange={e => setMNome(e.target.value)} placeholder="Nome" className={inputCls} />
          </div>
          <div className="w-20"><label className="block text-[10px] text-gray-400 mb-1">Unid.</label>
            <input value={mUnid} onChange={e => setMUnid(e.target.value)} placeholder="un" className={inputCls} /></div>
          <div className="w-24"><label className="block text-[10px] text-gray-400 mb-1">Valor</label>
            <InputMoeda value={mValor} onChange={setMValor} className={inputCls} /></div>
          <SeletorEspecies especies={especiesEmpresa} valor={mEspecies} onChange={setMEspecies} />
          <div className="w-full flex justify-end gap-2 pt-1">
            <button onClick={() => { setManual(false); setErroInline(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
              Cancelar
            </button>
            <button onClick={() => {
              if (!mNome.trim()) { setErroInline('Informe o nome'); return; }
              if (faltaEspecie)  { setErroInline('Selecione a(s) espécie(s) do novo item'); return; }
              setErroInline(null);
              onAdd({ tipo: 'MEDICAMENTO', refId: null, descricao: mNome.trim(), especialidade: null, quantidade: qtdOrcada, unidade: mUnid || 'un', dias, frequencia, valorUnitario: mValor || 0, descontoTipo: null, descontoValor: 0, manual: true, especieIds: especiesDoNovoItem });
              setMNome(''); setMUnid(''); setMValor(0); setManual(false); setBusca(''); setDias(1); setFrequencia('1xDia'); setMEspecies([]);
            }}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">Adicionar</button>
          </div>
        </div>
      )}

      {!manual && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-emerald-600" /></div>
          ) : meds.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">Nenhum medicamento encontrado.</p>
          ) : meds.slice(0, LIMITE_LISTA).map(m => (
            <button key={m.id} onClick={() => {
                onAdd({ tipo: 'MEDICAMENTO', refId: m.id, descricao: m.nome, especialidade: null, quantidade: qtdOrcada, unidade: m.unidade, dias, frequencia, valorUnitario: m.precoUnitarioBase ?? 0, descontoTipo: null, descontoValor: 0, manual: false });
                setBusca(''); setDias(1); setFrequencia('1xDia'); // inserido → fecha a lista e zera a posologia
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 text-left">
              <span className="text-sm text-gray-800 truncate">{m.nome} <span className="text-[10px] text-gray-400">/ {m.unidade}</span></span>
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">{m.precoUnitarioBase != null ? `${brl(m.precoUnitarioBase)}/${m.unidade}` : 'sem preço'}</span>
            </button>
          ))}
          {!loading && meds.length > LIMITE_LISTA && (
            <p className="text-[11px] text-gray-400 py-2 text-center">
              Mostrando {LIMITE_LISTA} de {meds.length} — use a busca para refinar.
            </p>
          )}
          {/* Última opção do seletor — mesmo padrão do "Incluir novo" dos cadastros */}
          <button onClick={() => setManual(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-left text-sm font-medium">
            <PackagePlus size={14} className="flex-shrink-0" /> Inserir Medicamento Manualmente
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab Vacinas (mesmo padrão de Medicamentos: mostra TODAS, não só as em estoque) ─
function TabVacinas({ animalId, especiesEmpresa, onAdd }: {
  animalId: number | null;
  especiesEmpresa: EspecieOpcao[];
  onAdd: (it: Omit<ItemLocal, 'key' | 'animalId'>) => void;
}) {
  const [busca, setBusca]     = useState('');
  const [vacs, setVacs]       = useState<Vac[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual]   = useState(false);
  const [mNome, setMNome]     = useState('');
  const [mValor, setMValor]   = useState(0);
  // Nº de doses orçadas — vale para as vacinas adicionadas a seguir (quantidade do item)
  const [doses, setDoses]     = useState(1);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  // Espécies do item manual: com uma só na empresa ela é assumida; com várias, escolhidas
  const [mEspecies, setMEspecies] = useState<number[]>([]);
  const especiesDoNovoItem = especiesEmpresa.length === 1 ? [especiesEmpresa[0].id] : mEspecies;
  const faltaEspecie = especiesEmpresa.length > 1 && mEspecies.length === 0;

  // Lista carregada AUTOMATICAMENTE ao abrir a aba (mesma regra dos medicamentos e
  // do Atendimento). A busca refina, mas não é mais pré-requisito para ver a lista.
  const termo = busca.trim();
  useEffect(() => {
    if (!animalId) { setVacs([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/medicamentos/para-atendimento', {
        params: { animalId, tipo: 'vacina', ...(termo.length >= MIN_BUSCA ? { busca: termo } : {}) },
      })
        .then(r => { if (r.data) setVacs(r.data.dados ?? []); }) // com ou sem estoque
        .catch(() => {}).finally(() => setLoading(false));
    }, termo.length >= MIN_BUSCA ? 300 : 0);   // carga inicial não espera debounce
    return () => clearTimeout(t);
  }, [termo, animalId]);

  if (!animalId) return <p className="text-xs text-amber-600 py-2">Selecione ao menos um animal para orçar vacinas.</p>;

  return (
    <div className="space-y-3">
      <InlineError message={erroInline} />

      {/* Busca + qtd. de doses — mesma linha, cada um com título */}
      {!manual && (
        <div className="flex items-end gap-1.5 w-full">
          <div className="flex-1 min-w-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar vacina..." className={`${inputCls} pl-8`} />
            </div>
          </div>
          <div className="w-16 flex-shrink-0">
            <label className="block text-[10px] font-medium text-gray-500 mb-1">Doses</label>
            <InputInteiro value={doses} onChange={setDoses} title="Qtd. de doses"
              className={`${inputClsBase} w-full px-2 text-center`} />
          </div>
        </div>
      )}

      {manual && (
        <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-xl">
          <p className="w-full text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Nova vacina</p>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] text-gray-400 mb-1">Vacina (nova)</label>
            <input value={mNome} onChange={e => setMNome(e.target.value)} placeholder="Nome" className={inputCls} />
          </div>
          <div className="w-20">
            <label className="block text-[10px] text-gray-400 mb-1">Doses</label>
            <InputInteiro value={doses} onChange={setDoses} title="Qtd. de doses"
              className={`${inputCls} text-center`} />
          </div>
          <div className="w-24"><label className="block text-[10px] text-gray-400 mb-1">Valor/dose</label>
            <InputMoeda value={mValor} onChange={setMValor} className={inputCls} /></div>
          <SeletorEspecies especies={especiesEmpresa} valor={mEspecies} onChange={setMEspecies} />
          <div className="w-full flex justify-end gap-2 pt-1">
            <button onClick={() => { setManual(false); setErroInline(null); }}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:bg-gray-100">
              Cancelar
            </button>
            <button onClick={() => {
              if (!mNome.trim()) { setErroInline('Informe o nome'); return; }
              if (faltaEspecie)  { setErroInline('Selecione a(s) espécie(s) do novo item'); return; }
              setErroInline(null);
              onAdd({ tipo: 'VACINA', refId: null, descricao: mNome.trim(), especialidade: null, quantidade: doses, unidade: 'dose', dias: null, frequencia: null, valorUnitario: mValor || 0, descontoTipo: null, descontoValor: 0, manual: true, especieIds: especiesDoNovoItem });
              setMNome(''); setMValor(0); setManual(false); setBusca(''); setMEspecies([]);
            }}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">Adicionar</button>
          </div>
        </div>
      )}

      {!manual && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-emerald-600" /></div>
          ) : vacs.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">Nenhuma vacina encontrada.</p>
          ) : vacs.slice(0, LIMITE_LISTA).map(v => (
            <button key={v.id} onClick={() => {
                onAdd({ tipo: 'VACINA', refId: v.id, descricao: v.nome, especialidade: null, quantidade: doses, unidade: 'dose', dias: null, frequencia: null, valorUnitario: v.valorPorDose ?? 0, descontoTipo: null, descontoValor: 0, manual: false });
                setBusca(''); // inserido → fecha a lista
              }}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-gray-100 hover:bg-gray-50 text-left">
              <span className="text-sm text-gray-800 truncate">
                {v.nome}{!v.emEstoque && <span className="ml-1.5 text-[10px] text-amber-500">sem estoque</span>}
              </span>
              <span className="text-xs font-semibold text-emerald-700 flex-shrink-0">{v.valorPorDose != null ? `${brl(v.valorPorDose)}/dose` : 'sem preço'}</span>
            </button>
          ))}
          {!loading && vacs.length > LIMITE_LISTA && (
            <p className="text-[11px] text-gray-400 py-2 text-center">
              Mostrando {LIMITE_LISTA} de {vacs.length} — use a busca para refinar.
            </p>
          )}
          {/* Última opção do seletor — mesmo padrão do "Incluir novo" dos cadastros */}
          <button onClick={() => setManual(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-left text-sm font-medium">
            <PackagePlus size={14} className="flex-shrink-0" /> Inserir Vacina Manualmente
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Tab Outros ────────────────────────────────────────────────────────────────
// Cobrança avulsa do cliente (ex: transporte, taxa, diária). Não passa pelas telas
// clínicas: depois de aprovado é lançado direto na fatura, em Financeiro > Faturamento,
// e só depois que os demais itens do orçamento já foram importados numa evolução.
function TabOutros({ onAdd }: { onAdd: (it: Omit<ItemLocal, 'key' | 'animalId'>) => void }) {
  const [nome, setNome]   = useState('');
  const [vezes, setVezes] = useState(1);
  const [valor, setValor] = useState(0);
  const [erroInline, setErroInline] = useState<string | null>(null);

  const adicionar = () => {
    if (!nome.trim()) { setErroInline('Informe o nome'); return; }
    setErroInline(null);
    onAdd({
      tipo: 'OUTROS', refId: null, descricao: nome.trim(), especialidade: null,
      quantidade: Math.max(1, vezes), unidade: null, dias: null, frequencia: null,
      valorUnitario: valor || 0, descontoTipo: null, descontoValor: 0, manual: false,
    });
    setNome(''); setVezes(1); setValor(0);
  };

  return (
    <div className="space-y-3">
      <InlineError message={erroInline} />

      <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-xl">
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] text-gray-400 mb-1">Nome <span className="text-red-500">*</span></label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Transporte" className={inputCls} />
        </div>
        <div className="w-24">
          <label className="block text-[10px] text-gray-400 mb-1">Qtd. de vezes</label>
          <InputInteiro value={vezes} onChange={setVezes} className={inputCls} />
        </div>
        <div className="w-28">
          <label className="block text-[10px] text-gray-400 mb-1">Valor</label>
          <InputMoeda value={valor} onChange={setValor} className={inputCls} />
        </div>
        <button onClick={adicionar}
          className="px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-semibold">
          Adicionar
        </button>
      </div>

      <p className="text-[11px] text-gray-400">
        Itens “Outros” não são rateados por animal e vão direto para a fatura do cliente,
        em Financeiro &gt; Faturamento, depois de aprovados.
      </p>
    </div>
  );
}

// ─── Histórico + Decisão ────────────────────────────────────────────────────────
function HistoricoOrcamentos({ podeAprovar, podeExcluir, podeEditar, onEditar }: {
  podeAprovar: boolean; podeExcluir: boolean; podeEditar: boolean;
  onEditar: (o: OrcamentoResumo) => void;
}) {
  const [orcamentos, setOrcamentos] = useState<OrcamentoResumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  // `somenteLeitura`: aberto pelo ícone de visualizar → só exibe. A decisão
  // (aceitar/rejeitar itens) tem ação própria e abre com somenteLeitura=false.
  const [detalhe, setDetalhe] = useState<{ orc: OrcamentoResumo; somenteLeitura: boolean } | null>(null);
  const [cancelando, setCancelando] = useState<OrcamentoResumo | null>(null);
  const [page, setPage] = useState(1);

  const visualizar = (o: OrcamentoResumo) => setDetalhe({ orc: o, somenteLeitura: true });
  const decidir    = (o: OrcamentoResumo) => setDetalhe({ orc: o, somenteLeitura: false });

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/orcamentos', { params: filtroStatus ? { status: filtroStatus } : {} });
      if (r.data) setOrcamentos(r.data.dados ?? []);
    } catch { setOrcamentos([]); }
    finally { setLoading(false); }
  }, [filtroStatus]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { setPage(1); }, [filtroStatus]);

  const cancelar = async (motivo: string) => {
    if (!cancelando) return;
    try {
      // O endpoint DELETE não exclui: apenas muda o status para CANCELADO
      await api.delete(`/orcamentos/${cancelando.id}`, { data: { motivo } });
      toast.success('Orçamento cancelado');
      setCancelando(null); carregar();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao cancelar');
    }
  };

  // Só RASCUNHO é editável (o backend recusa os demais em PUT /orcamentos/:id)
  const editar = (o: OrcamentoResumo) => {
    if (o.status !== 'RASCUNHO') { setErroInline('Só é possível editar orçamentos que ainda aguardam decisão.'); return; }
    onEditar(o);
  };

  // Envio AUTOMÁTICO: o backend gera o PDF (resumido, sem rateio por animal) pela
  // instância de WhatsApp da clínica. Se o WhatsApp não estiver provisionado/conectado,
  // cai no compartilhamento pelo próprio aparelho (Web Share API) ou no download + wa.me,
  // que é o melhor possível sem o provider — o link wa.me não transporta arquivo.
  const [enviandoId, setEnviandoId] = useState<number | null>(null);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const compartilharManualmente = async (o: OrcamentoResumo) => {
    const fone  = foneIntl(o.proprietario.phone);
    const texto = montarTextoOrcamento(o);
    const blob    = await gerarPdfOrcamento(o);
    const arquivo = new File([blob], nomeArquivoOrcamento(o), { type: 'application/pdf' });

    if (navigator.canShare?.({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], text: texto, title: `Orçamento #${o.numeroFormatado}` });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivoOrcamento(o);
    a.click();
    URL.revokeObjectURL(url);
    window.open(
      fone ? `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`
           : `https://wa.me/?text=${encodeURIComponent(texto)}`,
      '_blank',
    );
    toast('PDF baixado — anexe-o na conversa do WhatsApp.', { icon: '📎' });
  };

  const enviarWhatsApp = async (o: OrcamentoResumo) => {
    setEnviandoId(o.id);
    try {
      const r = await api.post(`/orcamentos/${o.id}/enviar-whatsapp`);
      toast.success(r.data?.dados?.simulado
        ? 'Envio simulado (WhatsApp em modo de teste).'
        : `Orçamento enviado para ${o.proprietario.fullName}.`);
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string; code?: string } } };
      if (e.isPermissionError) return;
      // WhatsApp da clínica indisponível → oferece o caminho manual
      try {
        await compartilharManualmente(o);
        toast(e.response?.data?.error ?? 'WhatsApp da clínica indisponível.', { icon: '⚠️' });
      } catch (err2) {
        if ((err2 as Error)?.name !== 'AbortError') {
          setErroInline(e.response?.data?.error ?? 'Não foi possível enviar o orçamento.');
        }
      }
    } finally {
      setEnviandoId(null);
    }
  };

  const LIMIT = 10;
  const totalPags = Math.max(1, Math.ceil(orcamentos.length / LIMIT));
  const pageAtual = Math.min(page, totalPags);
  const pageItems = orcamentos.slice((pageAtual - 1) * LIMIT, pageAtual * LIMIT);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <InlineError message={erroInline} className="m-3" />

      {/* Cabeçalho + filtro (mesmo modelo do Histórico de Evolução Clínica) */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Histórico de Orçamentos</p>
        <div className="flex items-center gap-2">
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:border-emerald-500">
            <option value="">Todos os status</option>
            <option value="RASCUNHO">Aguardando decisão</option>
            <option value="APROVADO">Aprovado</option>
            <option value="APROVADO_PARCIALMENTE">Aprovado Parcialmente</option>
            <option value="REJEITADO">Rejeitado</option>
            <option value="CANCELADO">Cancelado</option>
          </select>
          <span className="text-xs text-gray-400">{orcamentos.length} registro{orcamentos.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-emerald-600" /></div>
      ) : orcamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <Receipt size={40} className="mb-3" />
          <p className="text-sm text-gray-400">Nenhum orçamento encontrado</p>
        </div>
      ) : (
        <>
          {/* Mobile — cards */}
          <div className="md:hidden divide-y divide-gray-50">
            {pageItems.map(o => (
              <div key={o.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <button onClick={() => visualizar(o)} className="font-mono font-bold text-emerald-700 hover:underline text-sm">#{o.numeroFormatado}</button>
                  <span className={`inline-flex flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_ORC[o.status].cls}`}>{STATUS_ORC[o.status].label}</span>
                </div>
                <p className="text-sm font-semibold text-gray-800 truncate">{o.proprietario.fullName}</p>
                {contatoProprietario(o.proprietario) && (
                  <p className="text-[11px] text-gray-500 truncate">{contatoProprietario(o.proprietario)}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-0.5">{formatData(o.createdAt)} · {o.itens.length} itens</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Total: <b className="text-gray-800">{brl(o.valorTotal)}</b>
                  {o.valorAceito > 0 && <span className="text-emerald-600"> · Aceito: {brl(o.valorAceito)}</span>}
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button onClick={() => visualizar(o)} className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                    <Eye size={11} /> Visualizar
                  </button>
                  {podeAprovar && o.status !== 'CANCELADO' && (
                    <button onClick={() => decidir(o)}
                      disabled={!decisaoPendente(o.status)}
                      title={MOTIVO_DECISAO_BLOQUEADA[o.status]}
                      className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                      <ListChecks size={11} /> Decidir
                    </button>
                  )}
                  {podeEditar && o.status === 'RASCUNHO' && (
                    <button onClick={() => editar(o)} className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-emerald-600 rounded-lg text-xs hover:bg-emerald-50 transition-colors">
                      <Pencil size={11} /> Editar
                    </button>
                  )}
                  <button onClick={() => imprimirOrcamento(o)} className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 transition-colors">
                    <Printer size={11} /> Imprimir
                  </button>
                  <button onClick={() => enviarWhatsApp(o)} disabled={enviandoId === o.id}
                    className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-green-600 rounded-lg text-xs hover:bg-green-50 transition-colors disabled:opacity-40">
                    {enviandoId === o.id ? <Loader2 size={11} className="animate-spin" /> : <MessageCircle size={11} />} WhatsApp
                  </button>
                  {podeExcluir && o.status !== 'CANCELADO' && (
                    <button onClick={() => setCancelando(o)} className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors">
                      <Ban size={11} /> Cancelar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop — tabela */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Nº</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Proprietário</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Data</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Itens</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Aprovado</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pageItems.map(o => (
                  <tr key={o.id} onClick={() => visualizar(o)} className="hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 whitespace-nowrap"><span className="font-mono font-bold text-emerald-700">#{o.numeroFormatado}</span></td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-800">{o.proprietario.fullName}</p>
                      {contatoProprietario(o.proprietario) && (
                        <p className="text-[11px] text-gray-500">{contatoProprietario(o.proprietario)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatData(o.createdAt)}</td>
                    <td className="px-4 py-3 text-center text-xs text-gray-600">{o.itens.length}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-800 whitespace-nowrap">{brl(o.valorTotal)}</td>
                    <td className="px-4 py-3 text-right text-xs font-semibold text-emerald-700 whitespace-nowrap">{o.valorAceito > 0 ? brl(o.valorAceito) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_ORC[o.status].cls}`}>{STATUS_ORC[o.status].label}</span>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-start gap-1">
                        <button onClick={() => visualizar(o)} title="Visualizar" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                          <Eye size={14} />
                        </button>
                        {podeAprovar && o.status !== 'CANCELADO' && (
                          <button onClick={() => decidir(o)}
                            disabled={!decisaoPendente(o.status)}
                            title={MOTIVO_DECISAO_BLOQUEADA[o.status]}
                            className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                            <ListChecks size={14} />
                          </button>
                        )}
                        {podeEditar && (
                          <button onClick={() => editar(o)}
                            title={o.status === 'RASCUNHO' ? 'Editar' : 'Só é possível editar orçamentos que ainda aguardam decisão'}
                            disabled={o.status !== 'RASCUNHO'}
                            className="p-1.5 text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                            <Pencil size={14} />
                          </button>
                        )}
                        <button onClick={() => imprimirOrcamento(o)} title="Imprimir" className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                          <Printer size={14} />
                        </button>
                        <button onClick={() => enviarWhatsApp(o)} disabled={enviandoId === o.id}
                          title="Enviar PDF por WhatsApp" className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-40">
                          {enviandoId === o.id ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                        </button>
                        {podeExcluir && o.status !== 'CANCELADO' && (
                          <button onClick={() => setCancelando(o)} title="Cancelar orçamento" className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPags > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50">
              <span className="text-xs text-gray-400">{orcamentos.length} orçamento{orcamentos.length !== 1 ? 's' : ''}</span>
              <div className="flex items-center gap-3">
                <button disabled={pageAtual === 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-gray-500">{pageAtual} / {totalPags}</span>
                <button disabled={pageAtual >= totalPags} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 hover:bg-gray-50">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* `decisaoPendente` também no modal: com a decisão registrada ele abre em modo
          LEITURA mesmo que algum caminho novo chame `decidir` — os itens já podem ter
          sido importados numa evolução ou lançados na fatura. */}
      {detalhe && (
        <DetalheOrcamentoModal orc={detalhe.orc}
          podeAprovar={podeAprovar && !detalhe.somenteLeitura && decisaoPendente(detalhe.orc.status)}
          onClose={() => setDetalhe(null)} onSalvo={() => { setDetalhe(null); carregar(); }} />
      )}

      <ModalJustificativa
        aberto={cancelando !== null}
        titulo="Cancelar orçamento"
        descricao={cancelando ? `Orçamento #${cancelando.numeroFormatado} — ${cancelando.proprietario.fullName}` : undefined}
        acaoLabel="Cancelar orçamento"
        onConfirmar={cancelar}
        onFechar={() => setCancelando(null)}
      />
    </div>
  );
}

function DetalheOrcamentoModal({ orc, podeAprovar, onClose, onSalvo }: {
  orc: OrcamentoResumo; podeAprovar: boolean; onClose: () => void; onSalvo: () => void;
}) {
  // Seleção de itens aceitos (inicia com os já ACEITO)
  const [aceitos, setAceitos] = useState<Set<number>>(() => new Set(orc.itens.filter(i => i.statusItem === 'ACEITO').map(i => i.id)));
  const [salvando, setSalvando] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const toggle = (id: number) => setAceitos(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Marcar/desmarcar todos — atalho para as duas decisões extremas (aceitar tudo,
  // rejeitar tudo) sem precisar clicar item a item.
  const todosMarcados   = orc.itens.length > 0 && orc.itens.every(i => aceitos.has(i.id));
  const algunsMarcados  = aceitos.size > 0 && !todosMarcados;
  const alternarTodos   = () => setAceitos(todosMarcados ? new Set() : new Set(orc.itens.map(i => i.id)));

  const total  = orc.itens.reduce((s, i) => s + i.valorTotal, 0);
  const aceito = orc.itens.filter(i => aceitos.has(i.id)).reduce((s, i) => s + i.valorTotal, 0);

  /**
   * A SELEÇÃO é o alvo da ação: "Aceitar" aceita os itens marcados; "Rejeitar"
   * rejeita os marcados (ou seja, aceita os NÃO marcados). Com "Marcar todos" as
   * duas decisões extremas ficam a um clique. O backend rejeita automaticamente
   * tudo que não for enviado como ACEITO — por isso os dois modos mandam só a
   * lista de aceitos.
   */
  const salvar = async (modo: 'ACEITAR' | 'REJEITAR') => {
    setErroInline(null);
    if (aceitos.size === 0) {
      setErroInline(modo === 'ACEITAR'
        ? 'Selecione ao menos um item para aceitar.'
        : 'Selecione ao menos um item para rejeitar.');
      return;
    }
    const idsAceitos = orc.itens
      .filter(i => modo === 'ACEITAR' ? aceitos.has(i.id) : !aceitos.has(i.id))
      .map(i => i.id);

    setSalvando(true);
    try {
      const body = { decisoes: idsAceitos.map(itemId => ({ itemId, statusItem: 'ACEITO' })) };
      await api.post(`/orcamentos/${orc.id}/decidir`, body);
      toast.success('Decisão registrada');
      onSalvo();
    } catch (err) {
      const e = err as { isPermissionError?: boolean; response?: { data?: { error?: string } } };
      if (!e.isPermissionError) setErroInline(e.response?.data?.error ?? 'Erro ao registrar decisão');
    } finally { setSalvando(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col border border-gray-100">
        <InlineError message={erroInline} className="mx-5 mt-3 flex-shrink-0" />

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">Orçamento #{orc.numeroFormatado}</span>
            <h3 className="font-bold text-gray-900">{orc.proprietario.fullName}</h3>
            {contatoProprietario(orc.proprietario) && (
              <p className="text-xs text-gray-500">{contatoProprietario(orc.proprietario)}</p>
            )}
            <span className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_ORC[orc.status].cls}`}>{STATUS_ORC[orc.status].label}</span>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {/* Seletor "marcar todos" — topo da lista, antes dos itens */}
        {podeAprovar && orc.itens.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-emerald-100 bg-emerald-600/10 flex-shrink-0">
            <button type="button" onClick={alternarTodos}
              className="flex items-center gap-2 text-sm font-semibold text-emerald-900 hover:text-emerald-950">
              {/* Mesmo esmeralda dos checkboxes dos itens abaixo — o controle do topo
                  e os das linhas precisam ler como a mesma coisa. */}
              <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${
                todosMarcados || algunsMarcados ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300 bg-white'
              }`}>
                {todosMarcados && <Check size={13} className="text-white" />}
                {algunsMarcados && <span className="w-2.5 h-0.5 bg-white rounded-full" />}
              </span>
              Marcar todos
            </button>
            <span className="ml-auto text-xs font-medium text-emerald-900/70">
              {aceitos.size} de {orc.itens.length} selecionado{aceitos.size === 1 ? '' : 's'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {orc.itens.map(i => {
            const aceito = aceitos.has(i.id);
            // Item recusado na decisão do cliente — destacado em VERMELHO para não se
            // confundir com o que apenas não foi marcado (a decisão já foi tomada).
            const rejeitado = i.statusItem === 'REJEITADO';
            return (
              <button key={i.id} disabled={!podeAprovar} onClick={() => toggle(i.id)}
                className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
                  rejeitado ? 'bg-red-50/60' : aceito ? 'bg-emerald-50/60' : 'hover:bg-gray-50'
                } ${!podeAprovar ? 'cursor-default' : ''}`}>
                {/* Checkbox só no modo de decisão — na visualização não aparece */}
                {podeAprovar && (
                  <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${aceito ? 'bg-emerald-600 border-emerald-600' : 'border-gray-300'}`}>
                    {aceito && <Check size={13} className="text-white" />}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className={`text-sm truncate ${rejeitado ? 'text-red-700 line-through' : 'text-gray-800'}`}>{i.descricao}</p>
                    {rejeitado && (
                      <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Rejeitado
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    {i.tipo === 'COMBO' ? 'Combo' : i.tipo.charAt(0) + i.tipo.slice(1).toLowerCase()}
                    {' · '}{i.animal?.nome ?? 'Proprietário'} · {i.quantidade} × {brl(i.valorUnitario)}
                    {i.importadoEm ? ' · importado' : ''}
                  </p>
                </div>
                <span className={`text-sm font-semibold flex-shrink-0 ${rejeitado ? 'text-red-400 line-through' : 'text-gray-700'}`}>
                  {brl(i.valorTotal)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Total por animal — consolida todos os tipos */}
        {(() => {
          // O próprio item já traz o animal — não precisa de lookup por id
          const porAnimal = totaisPorAnimal(
            orc.itens,
            () => 'Proprietário',
            i => i.valorTotal,
            i => i.animal?.nome ?? 'Proprietário',
          );
          if (porAnimal.length < 2) return null;
          return (
            <div className="px-5 py-3 border-t border-gray-100">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Total por animal</p>
              <div className="space-y-1">
                {porAnimal.map(a => (
                  <div key={a.nome} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 truncate">{a.nome}</span>
                    <span className="font-semibold text-gray-800 flex-shrink-0 ml-3">{brl(a.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between text-sm">
          <span className="text-gray-600">Total: <b className="text-gray-900">{brl(total)}</b></span>
          <span className="text-emerald-700 font-semibold">Aceito: {brl(aceito)}</span>
        </div>

        {/* Decisão: os três juntos à direita, na ordem Aceitar · Rejeitar · Fechar */}
        {podeAprovar ? (
          <div className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-gray-100">
            <button onClick={() => salvar('ACEITAR')} disabled={salvando}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 text-white rounded-xl text-sm font-semibold">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Aceitar
            </button>
            <button onClick={() => salvar('REJEITAR')} disabled={salvando}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-red-300 text-red-700 hover:bg-red-50 rounded-xl text-sm font-semibold disabled:opacity-50">
              <Ban size={14} /> Rejeitar
            </button>
            <button onClick={onClose} disabled={salvando}
              className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 disabled:opacity-50">
              Fechar
            </button>
          </div>
        ) : (
          // Modo visualização — sem controles de decisão
          <div className="flex justify-end px-5 py-4 border-t border-gray-100">
            <button onClick={onClose} className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50">Fechar</button>
          </div>
        )}
      </div>
    </div>
  );
}
