// frontend/src/pages/SubModuloPrescricao.tsx

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil, Ban, CheckCircle2, X, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, Pill, Activity,
  Clock, Search, FileText, Eye, Printer, Lock, MessageCircle, Mail, Receipt, Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import DateInput from '../components/DateInput';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import {
  imprimirPrescricao as imprimirPrescricaoPrint, prepararPrescricao, gerarHtmlPrescricao,
  type PrintAnimalPrescricao, type PrintGrupoPrescricao,
} from '../utils/PrescricaoPrint';
import { enviarPdfWhatsAppComAviso, enviarPdfEmailComAviso } from '../utils/compartilharPdf';
import ModalJustificativa from '../components/ModalJustificativa';
import ConfirmModal from '../components/ConfirmModal';
import ImportarOrcamentoModal, { type OrcamentoItemImport, marcarOrcamentoImportado } from '../components/ImportarOrcamentoModal';
import InlineError from '../components/InlineError';
import ErroAcao, { classeErro, type ErroAcaoDados } from '../components/ErroAcao';
import {
  buscarModeloReceitaControlada, rotaReceitaControlada, NOME_RECEITA_CONTROLADA,
} from '../modules/documentos/receitaControlada';
import JustificativaCancelamento from '../components/JustificativaCancelamento';
import AcaoRegistro, { AcoesRegistro } from '../components/AcaoRegistro';
import JanelaLista from '../components/JanelaLista';



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
  /** Aplicado pelo PROPRIETÁRIO em casa: fora do plantão, da fatura e do estoque. */
  aplicadaPeloProprietario?: boolean;
  executadoEm:       string | null;
  medicamentoCat?:   { controlado: boolean } | null;
}

interface PrescricaoGrupo {
  id: number;
  numero: number;
  numeroFormatado: string;
  animalId: number;
  veterinarioId: number;
  evolucaoId?: number | null;
  veterinario: { id: number; fullName: string };
  status: StatusGrupo;
  createdAt: string;
  finalizadoEm?: string | null;
  executadoEm?: string | null;
  itens: ItemGrupo[];
  // Justificativa do cancelamento — preenchida em CANCELADO e CANCELADO_PARCIALMENTE.
  motivoCancelamento?: string | null;
}

// "Data Fim" da prescrição: a EXECUÇÃO é o fim de verdade (dose aplicada); sem ela, a
// FINALIZAÇÃO (RASCUNHO virou documento ativo) é o melhor "fim" disponível. Rascunho
// (SALVO) não tem nenhum dos dois — a coluna mostra "—".
const dataFimGrupo = (g: PrescricaoGrupo) => g.executadoEm ?? g.finalizadoEm ?? null;

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
  /** "Será aplicada pelo Proprietário" — por ITEM, irmã de `medicamentoCliente`.
   *  A clínica não executa, não cobra e não movimenta estoque deste item. */
  aplicadaPeloProprietario: boolean;
  /** Item de orçamento de origem — marcado como importado APÓS salvar; vai no payload
   *  para o backend guardar a origem e o valor negociado. */
  orcamentoItemId?:   number | null;
  /** Valor unitário ACEITO no orçamento — é o que vai para a fatura (não o do catálogo) */
  valorOrcado?:       number | null;
  /** Especialidade do procedimento (vem do orçamento). Só front — removida do payload. */
  especialidade?:     string | null;
}

/**
 * Paciente da folha + o CONTATO do cliente, que é para quem o PDF da prescrição
 * é enviado (WhatsApp / e-mail). Vem do cadastro do proprietário na empresa do
 * contexto — ver §36.
 */
type AnimalPrescricao = PrintAnimalPrescricao & {
  user?: { fullName?: string; email?: string | null; phone?: string | null } | null;
};

interface Props {
  animalId:           number;
  animal?:            AnimalPrescricao | null;
  onFaturaAtualizada: () => void;
  evolucaoId?:        number;
  /** Evolução ativa existe, mas pertence a OUTRO profissional (não assumida por
   *  mim, e eu não sou gestor) — bloqueia a CRIAÇÃO de prescrição nela. Mesma
   *  premissa de autoria de editar/finalizar (CLAUDE.md 28-c), só que aplicada
   *  ANTES do documento existir: o backend já recusa com 403, isto só evita o
   *  formulário inteiro para depois falhar. */
  evolucaoDeOutro?:   boolean;
  /** Paciente INATIVO — prontuário em somente leitura (ver animalInativo.js). */
  pacienteInativo?:  boolean;
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

// "Contínuo" foi REMOVIDO das opções — não tinha fim previsto e escondia a
// execução real das doses (uma prescrição "contínua" nunca migrava para o
// Histórico sozinha). Mantido só para EXIBIR o rótulo certo em prescrição
// ANTIGA que ainda usa o valor — nunca mais oferecido no formulário.
const POSOLOGIA_LABEL_LEGADO: Record<string, string> = { continuo: 'Contínuo' };

// Frequências "1x a cada N dias" — o vet pensa em QUANTAS VEZES aplicar, não em
// quantos dias o tratamento dura; o campo de duração vira "Qtd. de Vezes" para
// essas frequências (ver `duracaoDias` no formulário). O agendamento real das
// datas é o rolling schedule do backend (lib/agendaDoses.js#calcularProximaDose):
// cada dose prevista = a última EXECUTADA + este intervalo — aqui só convertemos
// "quantas vezes" ↔ "quantos dias" para preencher `duracaoDias` (Int NOT NULL),
// que é quem decide QUANTAS doses o curso tem (`dosesTotaisEsperadas`).
const INTERVALO_DIAS: Record<string, number> = {
  '1x2dias': 2, '1x3dias': 3, '1xSemana': 7,
  '1x21dias': 21, '1x30dias': 30, '1x90dias': 90,
};

// 🔴 Hora Início NÃO é obrigatória em frequência nenhuma (2026-08-23) — a função
// `precisaHoraInicio` que existia aqui foi REMOVIDA junto com a do backend, e o
// Set `FREQUENCIAS_SEM_HORARIO` que só a alimentava saiu com ela. Quem define a
// grade das doses é a PRIMEIRA EXECUÇÃO, não o formulário: "de 12 em 12h"
// executado às 20:00 tem a próxima às 08:00 (ver
// backend/src/lib/agendaDoses.js#semAncoraDeHorario). Preenchida, a hora só
// antecipa a definição dessa âncora. NÃO reintroduzir a obrigatoriedade.

// Frequências com MAIS DE UMA dose no MESMO dia — "Uma vez ao dia" fica de fora
// de propósito: a próxima dose é só amanhã, então iniciar num horário que já
// passou hoje não deixa nada "atrasado" na hora do cadastro. Já "de 4 em 4h"
// (etc.) começando num horário passado nasceria com a 1ª dose já vencida.
const FREQUENCIAS_MESMO_DIA = new Set(['12em12h', '8em8h', '6em6h', '4em4h', '1em1h']);

// Rótulo do campo por frequência — "1x por semana" fala em SEMANAS (1 dose por
// semana, então nº de semanas == nº de vezes); as demais usam o genérico "vezes".
const QTD_LABEL: Record<string, string> = {
  '1xSemana': 'QTD. SEMANAS',
};

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
  FINALIZADO:           { label: 'Em Execução',         cls: 'bg-emerald-100 text-emerald-700' },
  EXECUTADO:            { label: 'Executado',           cls: 'bg-blue-100 text-blue-700'      },
  CANCELADO:            { label: 'Cancelado',           cls: 'bg-red-100 text-red-700'        },
  CANCELADO_PARCIALMENTE: { label: 'Cancel. Parcial',  cls: 'bg-orange-100 text-orange-700'  },
};

// Prescrição em que TODOS os itens são aplicados pelo proprietário nunca passa pelo
// plantão: o backend já a finaliza direto em EXECUTADO (ver `finalizar`). O que muda
// aqui é só o RÓTULO — "Executado pelo Proprietário" —, para a lista não sugerir que
// alguém da clínica aplicou as doses.
// ⚠️ `every` sobre lista VAZIA é `true`: sem itens, nenhum sufixo (o `length > 0`).
const todoDoProprietario = (g: { itens: ItemGrupo[] }) =>
  g.itens.length > 0 && g.itens.every(i => i.aplicadaPeloProprietario === true);

/** Selo de status do grupo, com o sufixo quando o curso inteiro é do proprietário. */
const statusDoGrupo = (g: PrescricaoGrupo): { label: string; cls: string } => {
  const base = STATUS_GRUPO[g.status] ?? { label: g.status, cls: 'bg-gray-100 text-gray-600' };
  return todoDoProprietario(g)
    ? { ...base, label: `${base.label} pelo Proprietário` }
    : base;
};

// Ordem das abas de filtro por status no histórico
const STATUS_ORDER: StatusGrupo[] = ['SALVO', 'FINALIZADO', 'EXECUTADO', 'CANCELADO_PARCIALMENTE', 'CANCELADO'];

// Categoria de uma prescrição a partir dos seus itens — espelha o agrupamento do
// backend (`categoriaPara` em PrescricaoGrupoController): medicamento comum e
// procedimento convivem no MESMO documento ('Geral'); só o CONTROLADO se separa,
// porque o receituário de controle especial é documento distinto por lei.
// 'Misto' só aparece em grupo legado, criado quando a separação era por tipo.
type CategoriaPresc = 'Controlado' | 'Geral' | 'Misto';

const CATEGORIA_BADGE: Record<CategoriaPresc, string> = {
  Controlado: 'bg-red-100 text-red-700',
  Geral:      'bg-blue-100 text-blue-700',
  Misto:      'bg-gray-100 text-gray-600',
};

function categoriaGrupo(g: PrescricaoGrupo): CategoriaPresc {
  const cats = new Set<CategoriaPresc>(
    g.itens.map(i =>
      i.tipo !== 'PROCEDIMENTO' && i.medicamentoCat?.controlado ? 'Controlado' : 'Geral',
    ),
  );
  return cats.size === 1 ? [...cats][0] : 'Misto';
}

const FORM_VAZIO = (): FormItem => ({
  tipo: 'MEDICAMENTO', medicamento: '', medicamentoCatId: null,
  dosagem: '', unidade: '', via: '', frequencia: '',
  horaInicio: '', duracaoDias: '', dataInicio: hojeLocalStr(),
  observacao: '', medicamentoCliente: false, aplicadaPeloProprietario: false,
});

const labelPosologia = (v: string) => POSOLOGIAS.find(p => p.value === v)?.label ?? POSOLOGIA_LABEL_LEGADO[v] ?? v;

/**
 * Horizonte gravado quando o vet escolhe USO CONTÍNUO e não informa a duração.
 *
 * POR QUE NÃO É "sem fim": `Prescricao.duracaoDias` é `Int NOT NULL` e TODA a execução
 * (janela do item, dias restantes, o que aparece no plantão) é contada a partir dele.
 * Deixar vazio chegaria ao backend como 0 → `Math.max(… || 1, 1)` = 1 dia, e o
 * tratamento contínuo sumiria da Execução de Prescrição no dia seguinte — silenciosamente.
 * Com um ano, o item segue aparecendo até alguém CANCELAR a prescrição, que é o jeito
 * de encerrar um uso contínuo. O vet continua livre para digitar uma duração.
 */
const DIAS_USO_CONTINUO = 365;

/** Duração efetiva a enviar ao backend (ver DIAS_USO_CONTINUO). */
const duracaoParaEnvio = (item: { frequencia: string; duracaoDias: number | '' }): number => {
  if (item.frequencia === 'agora') return 1;
  const informada = Number(item.duracaoDias);
  if (informada >= 1) return informada;
  return item.frequencia === 'continuo' ? DIAS_USO_CONTINUO : 1;
};

const formatarData = (d: string | null) => {
  if (!d) return '—';
  const [year, month, day] = d.split('T')[0].split('-').map(Number);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
};

/**
 * O item é medicamento sujeito a CONTROLE ESPECIAL?
 *
 * Quem classifica é o CATÁLOGO (`medicamentoCat.controlado`), nunca o texto digitado
 * em `medicamento` — o campo é livre e "Gabapentina" escrita à mão não prova nada.
 * Item fora do catálogo conta como comum: sem cadastro não há classificação, e
 * presumir controle levaria remédio corriqueiro para o receituário especial.
 */
const itemControlado = (i: { tipo: string; medicamentoCat?: { controlado: boolean } | null }) =>
  i.tipo !== 'PROCEDIMENTO' && i.medicamentoCat?.controlado === true;

/** A prescrição tem algum medicamento sujeito a controle especial? */
const grupoTemControlado = (g: PrescricaoGrupo) => g.itens.some(itemControlado);

/**
 * A prescrição com SÓ os itens que saem no papel comum.
 *
 * 🔴 O controlado é retirado porque ele vai para o receituário PRÓPRIO (a "Receita
 * Controlada" da Central de Documentos): imprimi-lo nos dois lugares produziria duas
 * receitas válidas do mesmo medicamento controlado — exatamente o que a via
 * numerada existe para impedir.
 * ⚠️ Só recorte quando o receituário REALMENTE for emitido. Se o modelo não existir
 * no acervo, imprima o grupo INTEIRO: um papel com os itens certos é melhor que um
 * papel de onde o medicamento controlado sumiu sem que ninguém percebesse.
 */
const semControlados = (g: PrescricaoGrupo): PrescricaoGrupo =>
  ({ ...g, itens: g.itens.filter(i => !itemControlado(i)) });

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
    `Status: ${statusDoGrupo(g).label}`,
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

// Converte a prescrição da tela no formato da FOLHA. Fonte única do Imprimir e
// do PDF que vai por WhatsApp/e-mail — dois montadores divergiriam, e o papel
// impresso deixaria de ser igual ao papel enviado ao cliente.
// ⚠️ `veterinario.id` vai junto: é o que permite buscar a assinatura escaneada
// de QUEM PRESCREVEU (nunca a de quem está imprimindo).
function montarGrupoPrint(grupo: PrescricaoGrupo, animal?: PrintAnimalPrescricao | null): PrintGrupoPrescricao {
  return {
    numero:          grupo.numero,
    numeroFormatado: grupo.numeroFormatado,
    status:          grupo.status,
    finalizadoEm:    null,
    finalizadoPor:   null,
    executadoPor:    null,
    veterinario:     { id: grupo.veterinario.id, fullName: grupo.veterinario.fullName },
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
  };
}

function imprimirPrescricao(grupo: PrescricaoGrupo, animal?: PrintAnimalPrescricao | null) {
  void imprimirPrescricaoPrint(montarGrupoPrint(grupo, animal));
}

function nomeArquivoPrescricao(g: PrescricaoGrupo, animal?: PrintAnimalPrescricao | null): string {
  const paciente = animal?.nome ? `-${animal.nome.trim().replace(/\s+/g, '-').toLowerCase()}` : '';
  return `prescricao-${g.numeroFormatado.replace(/[^\w-]/g, '')}${paciente}.pdf`;
}

/**
 * RECEITUÁRIO DE CONTROLE ESPECIAL — o desvio de Imprimir / WhatsApp / E-mail quando
 * a prescrição tem medicamento controlado.
 *
 * 🔴 São DOIS papéis, e é assim de propósito: o controlado sai no receituário PRÓPRIO
 * (documento numerado da Central, com identificação do comprador e via da farmácia) e
 * os demais itens continuam saindo na receita comum. Tudo num papel só faria o remédio
 * corriqueiro nascer num receituário de controle especial; tudo no comum deixaria o
 * controlado sem a via que a norma exige.
 *
 * A ordem importa: o papel comum sai PRIMEIRO e a navegação vem depois — sair da tela
 * antes de disparar a impressão cancelaria o diálogo do navegador.
 *
 * ⚠️ SEM o modelo no acervo (ou sem permissão para ler a Central), NADA é recortado: a
 * ação faz exatamente o que fazia antes, com o grupo INTEIRO, e um aviso diz por quê.
 * Fallback silencioso aqui significaria imprimir uma receita de onde o medicamento
 * controlado sumiu sem ninguém perceber.
 *
 * Função de MÓDULO, não hook: a lista de prescrições e o modal de visualização têm o
 * mesmo botão de imprimir, e duas cópias divergiriam na primeira correção (28-g).
 */
async function receituarioControladoOuComum(
  g: PrescricaoGrupo,
  animalId: number,
  navigate: (rota: string) => void,
  acaoComum: (grupo: PrescricaoGrupo) => void,
): Promise<void> {
  if (!grupoTemControlado(g)) { acaoComum(g); return; }

  const modelo = await buscarModeloReceitaControlada();
  if (!modelo) {
    acaoComum(g);
    toast(`O modelo "${NOME_RECEITA_CONTROLADA}" não foi encontrado na Central de `
      + 'Documentos. A receita saiu completa, com os controlados nela.',
      { icon: '⚠️', duration: 7000 });
    return;
  }

  // Prescrição SÓ de controlados não tem papel comum — disparar a impressão de uma
  // receita sem nenhum item entregaria uma folha em branco.
  const comuns = semControlados(g);
  if (comuns.itens.length > 0) acaoComum(comuns);

  navigate(rotaReceitaControlada(animalId, modelo.id, g.id));
  toast.success(comuns.itens.length > 0
    ? 'Os demais itens saíram na receita comum. Complete o receituário de controle especial.'
    : 'Complete o receituário de controle especial para imprimir.');
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
  animal?:              AnimalPrescricao | null;
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
  const navigate = useNavigate();
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

  // Erro de AÇÃO: mora no rodapé, junto do botão que disparou a ação (mesmo padrão
  // do Cadastro de Proprietário). No topo do formulário ele ficava fora da vista de
  // quem acabou de clicar em Salvar — e, no modal, atrás do overlay.
  const [erroAcao, setErroAcao] = useState<ErroAcaoDados | null>(null);
  const setErroInline = (mensagem: string | null, campos?: string[]) =>
    setErroAcao(mensagem ? { mensagem, campos } : null);

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
  // Medicamento/procedimento já prescrito em OUTRA prescrição desta MESMA evolução —
  // aviso, nunca bloqueio (pedido explícito). `itensEvolucao` é o snapshot dos itens
  // ativos (não cancelados) de outros grupos da evolução, carregado uma vez ao abrir
  // o formulário; `duplicataPendente` guarda a Promise em aberto enquanto o usuário
  // decide, para `handleAdicionarMais` poder aguardar a resposta antes de prosseguir.
  const [itensEvolucao,    setItensEvolucao]    = useState<{ tipo: TipoItem; nome: string }[]>([]);
  const [duplicataPendente, setDuplicataPendente] = useState<{
    tipo: TipoItem; nome: string; resolve: (ok: boolean) => void;
  } | null>(null);
  // Itens de tipos diferentes viram prescrições separadas (Controlado/Normal/
  // Procedimento) — por isso é um array. Uma única categoria = 1 prescrição.
  const [savedGrupos,      setSavedGrupos]      = useState<{ id: number; numeroFormatado: string }[] | null>(null);
  // IDs ainda pendentes de finalização (retry após alerta de estoque) — evita
  // re-finalizar grupos já finalizados (que retornariam 400 "não está SALVO").
  const pendingFinalizeRef = useRef<number[] | null>(null);
  // Grupos-DESTINO criados por um split de categoria (`grupoDestino` do add/editar
  // item) durante ESTA sessão de edição. `executarFinalizacao` só conhecia
  // `grupo.id` (o documento que estava na tela) — o item que migrou de categoria
  // (ex: virou CONTROLADO) ficava numa prescrição irmã nova, SALVA, que ninguém
  // mandava finalizar: o "Finalizar" da tela reportava sucesso, mas aquele item
  // nunca chegava à Execução de Prescrição. Ver armadilha registrada no CLAUDE.md.
  const extraGrupoIdsRef = useRef<Set<number>>(new Set());
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
  // Refs (não state) para o resultado da carga RÁPIDA dos 5 primeiros não
  // atropelar uma busca que o usuário já tenha digitado enquanto ela ainda
  // estava em voo — `carregarMedicamentos` roda uma vez só (useCallback com
  // dependência em animalId), então lê o valor MAIS RECENTE por aqui, não pelo
  // `medBusca`/`allMedsLoaded` capturados no fechamento da função.
  const medBuscaRef       = useRef('');
  const allMedsLoadedRef  = useRef(false);
  const [allMedsLoaded,       setAllMedsLoaded]       = useState(false);
  const [backgroundSearching, setBackgroundSearching] = useState(false);
  const [showImportOrc,       setShowImportOrc]       = useState(false);

  // Importa itens ACEITO de orçamento → localItens (medicamento e procedimento/combo)
  const importarDoOrcamento = (itensOrc: OrcamentoItemImport[]) => {
    const novos: FormItem[] = itensOrc.map(i => ({
      ...FORM_VAZIO(),
      tipo:             i.tipo === 'MEDICAMENTO' ? 'MEDICAMENTO' : 'PROCEDIMENTO',
      medicamento:      i.descricao,
      medicamentoCatId: i.tipo === 'MEDICAMENTO' ? i.refId : null,
      unidade:          i.unidade ?? '',
      // Posologia orçada volta preenchida (só medicamento tem dias/frequência)
      frequencia:       i.frequencia ?? '',
      duracaoDias:      i.dias ?? '',
      observacao:       'Importado do orçamento',
      orcamentoItemId:  i.id,
      valorOrcado:      i.valorUnitario,
      especialidade:    i.especialidade ?? null,
    }));
    setLocalItens(prev => [...prev, ...novos]);

    // A especialidade é obrigatória no orçamento — traz junto na importação e já
    // posiciona o filtro do formulário de procedimento na especialidade importada.
    const espImportada = itensOrc.find(i => i.tipo !== 'MEDICAMENTO' && i.especialidade)?.especialidade;
    if (espImportada) setProcEspecialidade(espImportada);
  };

  // Remove o que só existe no front antes de enviar. `orcamentoItemId` e `valorOrcado`
  // AGORA vão no payload: é assim que o valor aceito pelo cliente chega à fatura.
  const semRastreio = (itens: FormItem[]) =>
    itens.map(i => {
      const c = { ...i, duracaoDias: duracaoParaEnvio(i) };
      delete c.especialidade;
      return c;
    });

  // Item ÚNICO indo para o servidor (incluir/editar em prescrição já salva) — mesma
  // normalização de duração do `semRastreio`.
  const itemParaEnvio = (i: FormItem) => ({ ...i, duracaoDias: duracaoParaEnvio(i) });

  // Marca no orçamento os itens que foram efetivamente salvos (chamar após o POST).
  const marcarOrcamentoSalvo = (itens: FormItem[]) =>
    marcarOrcamentoImportado(itens.map(i => i.orcamentoItemId).filter((n): n is number => !!n));

  const set = <K extends keyof FormItem>(k: K, v: FormItem[K]) => {
    // Mexeu no formulário, o erro anterior perdeu a validade
    setErroAcao(null);
    setForm(prev => ({ ...prev, [k]: v }));
  };

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

  /** Trocar (ou limpar) o MEDICAMENTO zera o formulário inteiro. Dosagem, unidade,
   *  via, posologia, duração, observação, valor orçado e as marcas de quem fornece /
   *  quem aplica pertencem ao medicamento ANTERIOR — mantê-los prescreve a posologia
   *  de um remédio para outro. Só sobrevivem o tipo e o que vem do catálogo do
   *  medicamento novo. */
  const selecionarMedicamento = (m: MedicamentoCat) => {
    const conv = getConversaoUnidade(m.unidade);
    setErroAcao(null);
    setForm({
      ...FORM_VAZIO(),
      tipo:             form.tipo,
      medicamento:      m.nome,
      medicamentoCatId: m.id,
      unidade:          conv ? conv.subunidade : m.unidade,
      via:              m.vias[0]?.via ?? '',
    });
  };

  const limparMedicamento = () => {
    setErroAcao(null);
    setForm({ ...FORM_VAZIO(), tipo: form.tipo });
  };

  // Medicamento DIGITADO À MÃO, sem correspondência no catálogo (mesma lógica que o
  // Procedimento já tem via texto livre) — o item nasce sem `medicamentoCatId`; ao
  // salvar, o backend cadastra (ou reaproveita) uma entrada PRIVADA da empresa com
  // esse nome (lib/catalogoManual.js), então da próxima vez ele já aparece na busca.
  // Sem catálogo, via/unidade caem no `select` manual — mesmo fallback que já existe
  // quando `medicamentoCatId` é null (ver `viasDisponiveis`/`unidadeCatalogo` abaixo).
  const criarMedicamentoLivre = (nome: string) => {
    setErroAcao(null);
    setForm({ ...FORM_VAZIO(), tipo: form.tipo, medicamento: nome, medicamentoCatId: null });
    setShowMedDropdown(false);
    setMedBusca('');
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

  // Catálogo de medicamento pode chegar a milhares de linhas (ver CLAUDE.md —
  // ~4.900 só o global) — buscar tudo de uma vez deixava o dropdown vazio/
  // travado até o request inteiro voltar. Duas fases:
  //   1. 5 primeiros — rápido, só para o dropdown já mostrar algo ao abrir;
  //   2. catálogo completo, em BACKGROUND — quando chega, o filtro vira
  //      client-side (mesmo comportamento de antes).
  // A fase 1 só escreve em `medicamentos` se o usuário AINDA não tiver digitado
  // nada nem a fase 2 já tiver chegado — senão ela sobrescreveria um resultado
  // mais recente (busca digitada, ou o catálogo completo já carregado).
  const carregarMedicamentos = useCallback(async () => {
    setLoadingMeds(true);

    api.get('/medicamentos/para-atendimento', {
      params: { animalId, tipo: 'medicamento', limit: 5 },
    }).then(r => {
      if (medBuscaRef.current.trim() === '' && !allMedsLoadedRef.current) {
        setMedicamentos(r.data?.dados ?? []);
      }
    }).catch(() => {});

    try {
      const r = await api.get('/medicamentos/para-atendimento', {
        params: { animalId, tipo: 'medicamento' },
      });
      const lista: MedicamentoCat[] = r.data?.dados ?? [];
      setAllMeds(lista);
      allMedsLoadedRef.current = true;
      setAllMedsLoaded(true);
    } catch {}
    finally { setLoadingMeds(false); }
  }, [animalId]);

  // Mantém a ref sincronizada com o state — lida por `carregarMedicamentos`
  // (useCallback com closure antiga) para saber se o usuário já digitou algo.
  useEffect(() => { medBuscaRef.current = medBusca; }, [medBusca]);

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
      setErroInline(`${isMed ? 'Medicamento' : 'Procedimento'} é obrigatório`, ['medicamento']);
      return false;
    }
    if (isMed && !form.dosagem.toString().trim()) {
      setErroInline('Dosagem é obrigatória', ['dosagem']); return false;
    }
    if (isMed && !form.unidade.trim()) {
      setErroInline('Unidade é obrigatória', ['unidade']); return false;
    }
    if (isMed && !form.via.trim()) {
      setErroInline('Via de administração é obrigatória', ['via']); return false;
    }
    if (!form.frequencia.trim()) {
      setErroInline('Frequência é obrigatória', ['frequencia']); return false;
    }
    // Dose única ("Agora") não exige duração em dias — é sempre 1.
    // "Contínuo" (legado, não mais oferecido no formulário — ver
    // POSOLOGIA_LABEL_LEGADO) segue isento aqui pelo mesmo motivo de sempre:
    // não tinha fim previsto e a edição de um item antigo já chega com
    // `duracaoDias` preenchido (ver `carregarItemParaEdicao`), então a exceção
    // nunca precisa segurar nada na prática.
    if (form.frequencia !== 'agora' && form.frequencia !== 'continuo'
        && (!form.duracaoDias || Number(form.duracaoDias) < 1)) {
      setErroInline(INTERVALO_DIAS[form.frequencia] ? 'Qtd. de Vezes é obrigatória' : 'Duração (dias) é obrigatória', ['duracaoDias']);
      return false;
    }
    // Hora Início é OPCIONAL em toda frequência (2026-08-23) — o horário-base das
    // doses é o da 1ª EXECUÇÃO, não o do formulário. Ver a nota no topo do arquivo.
    // Começando HOJE, a hora não pode já ter passado — senão a 1ª dose nasce
    // atrasada antes mesmo de a prescrição ser salva. Só na CRIAÇÃO do item: um
    // item já existente (local ou salvo) pode ter sido cadastrado horas atrás e
    // continuar com o mesmo horário — reeditar outro campo dele (dosagem, via...)
    // não pode ficar bloqueado só porque o relógio andou depois do cadastro.
    const criandoItemNovo = editingLocalIdx === null && editingServerId === null;
    if (criandoItemNovo && FREQUENCIAS_MESMO_DIA.has(form.frequencia) && form.horaInicio.trim() && form.dataInicio === hojeLocalStr()) {
      const agora = new Date();
      const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
      if (form.horaInicio < horaAtual) {
        setErroInline('Hora Início não pode ser anterior ao horário atual', ['horaInicio']);
        return false;
      }
    }
    if (!form.dataInicio.trim()) {
      setErroInline('Data de início é obrigatória', ['dataInicio']); return false;
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
      setErroInline(`${isMed ? 'Medicamento' : 'Procedimento'} já adicionado nesta prescrição`, ['medicamento']);
      return false;
    }
    return true;
  };

  const formEstaVazio = () => !form.medicamento.trim();

  // Itens (medicamento/procedimento) já prescritos em OUTRAS prescrições desta
  // MESMA evolução — carrega uma vez ao abrir o formulário. `limit` alto para não
  // depender da paginação da lista visível (10 por página); exclui o próprio grupo
  // (senão o item que já está NESTE documento se auto-denunciaria) e prescrições
  // CANCELADAS (item cancelado não é "já prescrito" — decisão do pedido).
  useEffect(() => {
    if (!evolucaoId || isReadOnly) { setItensEvolucao([]); return; }
    let cancelado = false;
    api.get(`/clinica/prescricoes/grupos/animal/${animalId}?limit=500`)
      .then(res => {
        if (cancelado) return;
        const todos: PrescricaoGrupo[] = res.data?.dados ?? [];
        const itens = todos
          .filter(g => g.evolucaoId === evolucaoId && g.status !== 'CANCELADO' && g.id !== grupo?.id)
          .flatMap(g => g.itens.map(it => ({ tipo: it.tipo, nome: it.medicamento })));
        setItensEvolucao(itens);
      })
      .catch(() => {});
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolucaoId, animalId, grupo?.id, isReadOnly]);

  // Pergunta (não bloqueia) antes de inserir um item já prescrito em OUTRO
  // documento desta evolução — resolve na hora (sem duplicata) ou só depois que o
  // usuário decidir no ConfirmModal (ver render no fim do componente).
  const confirmarDuplicataSeNecessario = (tipo: TipoItem, nome: string): Promise<boolean> => {
    const nomeNorm = nome.trim().toLowerCase();
    const dup = itensEvolucao.find(it => it.tipo === tipo && it.nome.trim().toLowerCase() === nomeNorm);
    if (!dup) return Promise.resolve(true);
    return new Promise(resolve => setDuplicataPendente({ tipo, nome, resolve }));
  };

  // ── Adicionar / atualizar item ──────────────────────────────────────────────

  const handleAdicionarMais = async (): Promise<boolean> => {
    if (!validarForm()) return false;
    if (!(await confirmarDuplicataSeNecessario(form.tipo, form.medicamento))) return false;

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
        const res = await api.put(`/clinica/prescricoes/grupos/${grupo!.id}/itens/${editingServerId}`, itemParaEnvio(form));
        const destino = res.data.grupoDestino as { id: number; numeroFormatado: string; novo: boolean } | null;
        if (destino) {
          // Categoria mudou → o item foi movido para outra prescrição. Guarda o
          // destino para o Finalizar desta sessão alcançar esse grupo também.
          extraGrupoIdsRef.current.add(destino.id);
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
        const res = await api.post(`/clinica/prescricoes/grupos/${grupo!.id}/itens`, itemParaEnvio(form));
        const destino = res.data.grupoDestino as { id: number; numeroFormatado: string; novo: boolean } | null;
        if (destino) {
          // Categoria diferente do grupo → foi para uma prescrição separada. Guarda
          // o destino para o Finalizar desta sessão alcançar esse grupo também.
          extraGrupoIdsRef.current.add(destino.id);
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
      setErroInline(msg ?? 'Erro ao salvar item');
    } finally {
      setSaving(false);
    }
    return ok;
  };

  const handleEditarLocal = (idx: number) => {
    const item = localItens[idx];
    setForm(item);
    // Reposiciona o filtro de especialidade no valor do item (importado do orçamento)
    if (item.especialidade) setProcEspecialidade(item.especialidade);
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
      aplicadaPeloProprietario: item.aplicadaPeloProprietario === true,
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
      setErroInline(msg ?? 'Erro ao remover item');
    } finally {
      setRemovendoItemId(null);
    }
  };

  // ── Salvar (create mode) ────────────────────────────────────────────────────

  // Medicamento SEM dosagem não pode ser salvo. `validarForm` só cobre o item que
  // está no formulário — itens importados do orçamento entram direto na lista, sem
  // dosagem, então a checagem precisa acontecer também sobre a lista inteira.
  const bloqueadoPorDosagem = (itens: FormItem[]): boolean => {
    const semDosagem = itens.find(
      i => i.tipo === 'MEDICAMENTO' && !String(i.dosagem ?? '').trim(),
    );
    if (!semDosagem) return false;
    setErroInline(`Informe a dosagem de "${semDosagem.medicamento}" antes de salvar.`);
    return true;
  };

  /**
   * Lista efetiva a salvar = itens da lista + o que está no formulário.
   *
   * Quando o formulário está EDITANDO um item (`editingLocalIdx`), ele SUBSTITUI
   * aquele item — não entra como um novo. Sem isso, quem importava do orçamento,
   * clicava em "Alterar" para informar dosagem/via e ia direto no Salvar (sem passar
   * por "Atualizar item") via o item ORIGINAL, ainda sem dosagem, continuar na lista:
   * o salvamento era barrado com "Informe a dosagem de …" apontando justamente o
   * medicamento que a pessoa acabara de preencher — e, se passasse, salvaria duplicado.
   */
  const itensParaSalvar = (): FormItem[] => {
    if (formEstaVazio()) return localItens;
    if (editingLocalIdx !== null) {
      return localItens.map((it, i) => (i === editingLocalIdx ? form : it));
    }
    return [...localItens, form];
  };

  const handleSalvar = async () => {
    const itens = itensParaSalvar();
    if (itens.length === 0) {
      setErroInline('Adicione ao menos um item na prescrição');
      return;
    }
    if (!formEstaVazio() && !validarForm()) return;
    if (bloqueadoPorDosagem(itens)) return;
    setSaving(true);
    try {
      const res = await api.post('/clinica/prescricoes/grupos', { animalId, evolucaoId, itens: semRastreio(itens) });
      const grupos = res.data.dados as { id: number; numeroFormatado: string }[];
      // Salvou → só agora marca os itens de orçamento como importados
      await marcarOrcamentoSalvo(itens);
      toast.success(grupos.length > 1 ? `${grupos.length} prescrições salvas` : 'Prescrição salva');
      clearDraft();
      setLocalItens([]);
      resetForm();
      setEditingLocalIdx(null);   // a lista foi zerada — índice de edição não aponta mais nada
      setSavedGrupos(grupos);
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao salvar prescrição');
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
        const itens = itensParaSalvar();
        if (itens.length === 0) { setErroInline('Adicione ao menos um item'); return; }
        if (!formEstaVazio() && !validarForm()) return;
        if (bloqueadoPorDosagem(itens)) return;
        const res = await api.post('/clinica/prescricoes/grupos', { animalId, evolucaoId, itens: semRastreio(itens) });
        const grupos = res.data.dados as { id: number; numeroFormatado: string }[];
        // Grupos criados (persistidos) → marca os itens de orçamento como importados
        await marcarOrcamentoSalvo(itens);
        // Registra os grupos criados — se a finalização falhar (ex: alerta de
        // estoque), a nova tentativa os reutiliza em vez de criar duplicados
        setSavedGrupos(grupos);
        setEditingLocalIdx(null);   // já persistido: o índice de edição não vale mais
        ids = grupos.map(g => g.id);
      } else if (savedGrupos) {
        ids = savedGrupos.map(g => g.id);
      } else if (grupo) {
        ids = [grupo.id];
      } else {
        ids = [];
      }

      // Grupos-destino de um split de categoria feito NESTA sessão (item que virou
      // CONTROLADO/GERAL na edição e migrou para uma prescrição irmã) — sem isto,
      // esse item ficava numa prescrição SALVA que ninguém finalizava e nunca
      // aparecia na Execução de Prescrição, mesmo com o "Finalizar" respondendo OK.
      if (extraGrupoIdsRef.current.size > 0) {
        for (const extraId of extraGrupoIdsRef.current) {
          if (!ids.includes(extraId)) ids.push(extraId);
        }
        extraGrupoIdsRef.current.clear();
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
            setErroInline(resp?.data?.error ?? 'Erro ao finalizar prescrição');
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
      setErroInline(resp?.data?.error ?? 'Erro ao finalizar prescrição');
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
    const termo = medBusca.trim();
    // "Cadastrar novo" só aparece quando o texto digitado não bate EXATAMENTE com
    // nenhum item já existente — evita convidar a criar duplicata de algo que já
    // está na lista (a pessoa clica no item de verdade, não recadastra).
    const temCorrespondenciaExata = termo !== '' &&
      medicamentos.some(m => m.nome.toLowerCase() === termo.toLowerCase());
    const mostraCriarNovo = termo !== '' && !temCorrespondenciaExata;

    if (loadingMeds && !backgroundSearching && medicamentos.length === 0 && !mostraCriarNovo)
      return <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-emerald-500" /></div>;
    if (medicamentos.length === 0 && !backgroundSearching && !mostraCriarNovo)
      return <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhum medicamento encontrado</p>;
    const onSelect = (m: MedicamentoCat) => {
      selecionarMedicamento(m);
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
        {/* Só os 5 primeiros chegaram ainda — o catálogo completo (milhares de
            itens) segue carregando sozinho; sem digitar nada, não há por que
            travar a UI esperando por ele. */}
        {!allMedsLoaded && !backgroundSearching && termo === '' && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-100">
            <Loader2 size={10} className="animate-spin text-gray-300" />
            <span className="text-[10px] text-gray-400">Carregando o restante do catálogo...</span>
          </div>
        )}
        {mostraCriarNovo && (
          <button type="button" onMouseDown={() => criarMedicamentoLivre(termo)}
            className="w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center gap-1.5 font-medium">
            <Plus size={13} className="flex-shrink-0" />
            Cadastrar "{termo}" como novo medicamento
          </button>
        )}
      </>
    );
  };

  const isMed           = form.tipo === 'MEDICAMENTO';
  // Dose única ("Agora"): não faz sentido pedir duração em dias
  const isDoseUnica     = form.frequencia === 'agora';
  // Uso contínuo não tem fim previsto — a duração vira OPCIONAL (mas segue editável,
  // diferente da dose única, que é sempre 1 dia).
  const isUsoContinuo   = form.frequencia === 'continuo';
  // "1x a cada N dias": o campo de duração vira "Qtd. de Vezes" — ver INTERVALO_DIAS.
  const intervaloDias   = INTERVALO_DIAS[form.frequencia] ?? null;
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
  // O rodapé só existe se algum botão dele for renderizar (ver o bloco Footer)
  const mostraRodape  =
    (isCreate && !!savedGrupos)                                                    // estado "recém-salvo"
    || (grupo != null && ['FINALIZADO', 'EXECUTADO', 'CANCELADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status) && podeImprimir)
    || (!isCreate && canEdit && !isReadOnly && !showItemForm)                      // "Inserir" (abre o form)
    || !isInline                                                                   // "Fechar/Cancelar" do modal
    || (!showItemForm && (canEdit || canFinalizarCancelar) && !isReadOnly);         // "Finalizar"

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
                <span className={`inline-flex mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusDoGrupo(grupo).cls}`}>
                  {statusDoGrupo(grupo).label}
                </span>
              )}
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X size={18} />
            </button>
          </div>
        )}

        {/* Rede de segurança: React normaliza `change` para BORBULHAR, então o
            handler aqui cobre todo campo de dentro — inclusive o que não passa
            pelo `set` (combobox de medicamento, seletor de procedimento) e o que
            for adicionado depois, sem precisar tocar em cada um. */}
        <div className={isInline ? '' : 'flex-1 overflow-y-auto'}
          onChange={() => setErroAcao(null)}
          onInput={() => setErroAcao(null)}>
          <div className="px-5 py-3 space-y-3">

            {/* O botão "Importar orçamento" saiu daqui: passou para a MESMA LINHA das
                abas Medicamento/Procedimento, encostado à direita (ver abaixo). Fica
                aqui só o modal, que não tem posição na tela. */}
            {showImportOrc && (
              <ImportarOrcamentoModal
                animalId={animalId}
                tipos={['MEDICAMENTO', 'PROCEDIMENTO', 'COMBO']}
                onFechar={() => setShowImportOrc(false)}
                onImportar={importarDoOrcamento}
              />
            )}

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

                {/* Tipo do item à ESQUERDA, "Importar orçamento" à DIREITA (mesma linha).
                    `justify-between` + `mr-auto` no grupo da esquerda: com o Importar
                    escondido (edição / já salvo), as abas continuam à esquerda em vez de
                    esticar pela linha. */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 mr-auto">
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

                  {/* Importar orçamento (opcional) — só na criação */}
                  {isCreate && !savedGrupos && (
                    <button onClick={() => setShowImportOrc(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors">
                      <Receipt size={13} /> Importar orçamento
                    </button>
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
                            className={classeErro(erroAcao, 'medicamento', 'w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:border-emerald-500 bg-white')}>
                            <span className={form.medicamento ? 'text-gray-900 truncate' : 'text-gray-400'}>
                              {form.medicamento || 'Selecionar medicamento...'}
                            </span>
                            {form.medicamento ? (
                              <X size={13} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                                onClick={e => { e.stopPropagation(); limparMedicamento(); }} />
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
                      <div className={classeErro(erroAcao, 'dosagem', classeErro(erroAcao, 'unidade', 'flex items-center h-[38px] border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500'))}>
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
                        className={classeErro(erroAcao, 'via', `w-full h-[38px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${!form.via ? 'text-gray-400' : 'text-gray-900'}`)}>
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
                        onChange={e => {
                          setProcEspecialidade(e.target.value);
                          // Trocar a especialidade invalida o procedimento escolhido e
                          // TUDO que veio junto dele (valor orçado, posologia, via,
                          // observação): o formulário recomeça limpo. `clearCurrentType`
                          // também descarta o backup do tipo — senão alternar
                          // Medicamento↔Procedimento ressuscitaria o procedimento da
                          // especialidade anterior.
                          clearCurrentType();
                        }}
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
                          className={classeErro(erroAcao, 'medicamento', 'w-full flex items-center justify-between border border-gray-200 rounded-xl px-3 py-2 text-sm text-left focus:outline-none focus:border-emerald-500 bg-white')}>
                          <span className={form.medicamento ? 'text-gray-900 truncate' : 'text-gray-400'}>
                            {form.medicamento || 'Selecionar medicamento...'}
                          </span>
                          {form.medicamento ? (
                            <X size={13} className="text-gray-400 flex-shrink-0 ml-2 cursor-pointer"
                              onClick={e => { e.stopPropagation(); limparMedicamento(); }} />
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
                        className={classeErro(erroAcao, 'medicamento', 'w-full pl-8 pr-3 border border-gray-200 rounded-xl py-2 text-sm text-gray-900 focus:outline-none focus:border-emerald-500')}
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
                      <div className={classeErro(erroAcao, 'dosagem', classeErro(erroAcao, 'unidade', 'flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:border-emerald-500'))}>
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
                        className={classeErro(erroAcao, 'via', `w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${!form.via ? 'text-gray-400' : 'text-gray-900'}`)}>
                        <option value="">— Selecionar —</option>
                        {viasDisponiveis.map(v => <option key={v} className="text-gray-900">{v}</option>)}
                      </select>
                    </div>
                  </div>
                )}
                  </>
                )}

                {/* Frequência + Hora + Duração + Data Início
                    Larguras via fr (não col-span inteiro): Hora Início pediu +30% e Qtd
                    pediu redução — em grid-cols-8 (inteiros) essas frações não cabem, daí
                    o grid-template-columns explícito só no breakpoint sm+. */}
                <div className="grid grid-cols-2 sm:grid-cols-[3fr_1.3fr_1.3fr_2fr] gap-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 whitespace-nowrap">FREQUÊNCIA *</label>
                    <select value={form.frequencia}
                      onChange={e => {
                        const v = e.target.value;
                        set('frequencia', v);
                        // Dose única: força duração = 1 (o back ignora dias em "agora")
                        if (v === 'agora') set('duracaoDias', 1);
                      }}
                      className={classeErro(erroAcao, 'frequencia', `w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500 ${!form.frequencia ? 'text-gray-400' : 'text-gray-900'}`)}>
                      <option value="">— Selecionar —</option>
                      {POSOLOGIAS.map(p => <option key={p.value} value={p.value} className="text-gray-900">{p.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      HORA INÍCIO
                    </label>
                    <input type="time" value={form.horaInicio} onChange={e => set('horaInicio', e.target.value)}
                      className={classeErro(erroAcao, 'horaInicio', 'w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500')} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 whitespace-nowrap">
                      {intervaloDias ? QTD_LABEL[form.frequencia] ?? 'QTD. DE VEZES' : 'DURAÇÃO (DIAS)'}{!isDoseUnica && !isUsoContinuo && ' *'}
                    </label>
                    <input type="number" min="1"
                      value={
                        isDoseUnica ? ''
                        : intervaloDias ? (form.duracaoDias === '' ? '' : Math.max(1, Math.round(Number(form.duracaoDias) / intervaloDias)))
                        : form.duracaoDias
                      }
                      disabled={isDoseUnica}
                      onChange={e => {
                        if (e.target.value === '') { set('duracaoDias', ''); return; }
                        const n = Number(e.target.value);
                        set('duracaoDias', intervaloDias ? n * intervaloDias : n);
                      }}
                      placeholder={isDoseUnica ? 'Dose única' : isUsoContinuo ? 'Opcional' : intervaloDias ? 'Ex: 5' : 'Ex: 7'}
                      className={classeErro(erroAcao, 'duracaoDias', `w-full border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:border-emerald-500 ${isDoseUnica ? 'bg-gray-50 text-gray-400 cursor-not-allowed placeholder:text-gray-400' : ''}`)} />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 whitespace-nowrap">DATA INÍCIO</label>
                    <DateInput
                      value={form.dataInicio}
                      onChange={v => set('dataInicio', v)}
                      className={classeErro(erroAcao, 'dataInicio', 'w-full border border-gray-200 rounded-xl px-2 py-2 text-xs text-gray-900 focus-within:border-emerald-500')}
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

                {/* Quem FORNECE × quem APLICA — lado a lado, são decisões irmãs e
                    ambas do ITEM: a mesma prescrição pode ter o injetável que a
                    clínica aplica na baia e a pomada que o tratador passa em casa.
                    "Fornecido pelo Cliente" → não baixa estoque (só medicamento);
                    "Aplicada pelo Proprietário" → fora do plantão, da fatura e do
                    estoque (vale também para PROCEDIMENTO).
                    `items-center`: os botões Inserir/Finalizar dividem esta linha e são
                    bem mais altos que o texto do checkbox — com `items-start` tudo
                    encostava no topo e os rótulos ficavam desalinhados dos botões. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                    </div>
                  )}

                  <div>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.aplicadaPeloProprietario}
                        onChange={e => set('aplicadaPeloProprietario', e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <span className="text-sm text-red-600 font-medium">
                        {isMed ? 'Será aplicado pelo Proprietário' : 'Será executado pelo Proprietário'}
                      </span>
                    </label>
                  </div>

                  {/* A linha que explicava o destino do item ("Vai à Execução de
                      Prescrição — …") foi RETIRADA a pedido. A regra continua valendo
                      no backend, documentada na matriz "quem FORNECE × quem APLICA"
                      (CLAUDE.md, rotas de /clinica/prescricoes) — só não é mais escrita
                      na tela. Não reintroduzir sem pedido. */}

                  {/* Inserir + Finalizar na MESMA LINHA dos checkboxes, encostados à
                      direita (`ml-auto`). Enquanto o formulário está aberto, é aqui que
                      eles vivem — o rodapé mantém as versões de quando ele está fechado
                      (abrir o form / finalizar uma prescrição já salva), senão não
                      haveria como finalizar sem o formulário na tela. */}
                  <div className="flex items-center gap-2 ml-auto">
                    {canEdit && !isReadOnly && (
                      <button
                        onClick={handleAdicionarMais}
                        disabled={saving || formEstaVazio()}
                        className="px-5 py-2 border border-emerald-600 text-emerald-700 hover:bg-emerald-50 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                        {saving && <Loader2 size={13} className="animate-spin" />}
                        {editandoItem ? 'Atualizar item' : 'Inserir'}
                      </button>
                    )}
                    {(canEdit || canFinalizarCancelar) && !isReadOnly && (
                      <button onClick={handleSalvarUnificado}
                        disabled={saving || finalizing || (isCreate && localItens.length === 0 && formEstaVazio())}
                        className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                        {(saving || finalizing) ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                        Finalizar
                      </button>
                    )}
                  </div>
                </div>
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
                          aplicadaPeloProprietario={item.aplicadaPeloProprietario}
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
                          aplicadaPeloProprietario={item.aplicadaPeloProprietario}
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

        {/* Footer — com Inserir/Finalizar movidos para a linha dos checkboxes, ele pode
            ficar SEM nenhum botão (criação inline com o formulário aberto). Nesse caso
            não renderiza: senão sobra uma faixa vazia com borda no fim do card. */}
        {(mostraRodape || erroAcao) && (
        <div className={`px-5 py-4 border-t border-gray-100 ${!isInline ? 'flex-shrink-0' : 'mt-2'}`}>
          {/* Erro pertence à superfície da ação: aqui, colado no botão que foi clicado */}
          <ErroAcao erro={erroAcao} className="mb-3" />
          <div className="flex items-center justify-end gap-2 flex-wrap">
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
                    Finalizar
                  </button>
                )}
              </>
            ) : (
              <>
                {/* Imprimir — FINALIZADO, EXECUTADO ou já CANCELADO (o registro impresso continua útil) */}
                {grupo != null && ['FINALIZADO', 'EXECUTADO', 'CANCELADO', 'CANCELADO_PARCIALMENTE'].includes(grupo.status) && podeImprimir && (
                  <button onClick={() => void receituarioControladoOuComum(grupo!, animalId, navigate, gr => imprimirPrescricao(gr, animal))}
                    className="flex items-center gap-1.5 px-4 py-2 border border-blue-200 text-blue-600 hover:bg-blue-50 rounded-xl text-sm transition-colors">
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

                {/* NÃO há "Inserir/Atualizar item" aqui: com o formulário aberto ele
                    mora na linha dos checkboxes, e com o formulário fechado quem abre
                    a inclusão é o botão "Inserir" logo acima. */}

                {/* Fechar / Cancelar — modal only */}
                {!isInline && (
                  <button onClick={onClose}
                    className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                    {isReadOnly ? 'Fechar' : 'Cancelar'}
                  </button>
                )}

                {/* Finalizar — é o antigo "Salvar", que já absorveu o Finalizar: grava
                    e finaliza quando o usuário tem permissão de finalizar (desacoplado
                    de canEdit, como o Finalizar antigo — FORNECEDOR finaliza o próprio
                    item). Com o formulário ABERTO ele mora na linha dos checkboxes;
                    aqui atende o form fechado (prescrição salva que ainda vai finalizar). */}
                {!showItemForm && (canEdit || canFinalizarCancelar) && !isReadOnly && (
                  <button onClick={handleSalvarUnificado}
                    disabled={saving || finalizing || (isCreate && localItens.length === 0 && formEstaVazio())}
                    className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5">
                    {(saving || finalizing) ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    Finalizar
                  </button>
                )}
              </>
            )}
          </div>
          </div>
        </div>
        )}
      </div>

      <ModalJustificativa
        aberto={removendoItemId !== null}
        titulo="Remover item da prescrição?"
        descricao={serverItens.find(it => it.id === removendoItemId)?.medicamento ?? undefined}
        acaoLabel="Remover"
        onConfirmar={(motivo) => { if (removendoItemId !== null) handleRemoverServer(removendoItemId, motivo); }}
        onFechar={() => setRemovendoItemId(null)}
      />
      {duplicataPendente && (
        <ConfirmModal
          open
          variante="aviso"
          titulo={`${duplicataPendente.tipo === 'MEDICAMENTO' ? 'Medicamento' : 'Procedimento'} já prescrito nesta evolução`}
          mensagem={
            <>
              O {duplicataPendente.tipo === 'MEDICAMENTO' ? 'medicamento' : 'procedimento'}{' '}
              <strong>{duplicataPendente.nome}</strong> já foi prescrito nesta evolução (em outra
              prescrição). Deseja continuar mesmo assim?
            </>
          }
          labelConfirmar="Continuar mesmo assim"
          labelCancelar="Cancelar"
          onConfirmar={() => { duplicataPendente.resolve(true); setDuplicataPendente(null); }}
          onCancelar={() => { duplicataPendente.resolve(false); setDuplicataPendente(null); }}
        />
      )}
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

// `destinoDoItem()` foi REMOVIDA junto com a linha de texto que ela alimentava sob os
// checkboxes ("Vai à Execução de Prescrição — …"), a pedido. A matriz "quem FORNECE ×
// quem APLICA" que ela espelhava continua sendo a regra e vive no backend
// (`PrescricaoGrupoController.finalizar`/`executar`) e no CLAUDE.md.

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
  horaInicio, duracaoDias, dataInicio, observacao, medicamentoCliente, aplicadaPeloProprietario, executado, emAndamento,
  isEditing, canEdit, canRemove, onEdit, onRemove,
  isDragging, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  label: string; tipo: TipoItem;
  dosagem: string | null; unidade: string | null; via: string; frequencia: string;
  horaInicio?: string | null; duracaoDias?: number | ''; dataInicio?: string; observacao?: string | null;
  medicamentoCliente?: boolean; aplicadaPeloProprietario?: boolean; executado?: boolean;
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
  // "1x a cada N dias": a duração é guardada em DIAS (para `dosesTotaisEsperadas`
  // no backend arredondar certo), mas aqui exibimos em VEZES — e o "Fim" é a data
  // da ÚLTIMA dose (início + (vezes-1)×intervalo), não início+duracaoDias-1, que
  // sobraria alguns dias além do curso real (duracaoDias = vezes×intervalo).
  const intervaloRow = INTERVALO_DIAS[frequencia] ?? null;
  const vezesRow = intervaloRow && duracaoDias ? Math.max(1, Math.round(Number(duracaoDias) / intervaloRow)) : null;
  const dtFim  = !isDoseUnicaRow && dataInicio && duracaoDias
    ? calcDataFim(dataInicio, intervaloRow && vezesRow ? (vezesRow - 1) * intervaloRow + 1 : duracaoDias)
    : '';
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
        {aplicadaPeloProprietario && (
          <span title="Aplicado pelo proprietário — fora da Execução de Prescrição"
            className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
            Proprietário
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
        {!isDoseUnicaRow && duracaoDias && (
          intervaloRow
            ? <InfoChip label="Qtd:" value={`${vezesRow}x`} />
            : <InfoChip label="Dur:" value={`${duracaoDias}d`} />
        )}
        {dtIni           && <InfoChip label="Início:" value={dtIni} />}
        {dtFim           && <InfoChip label="Fim:" value={dtFim} />}
        {observacao      && <InfoChip label="Obs:" value={observacao} />}
      </div>

      {(canEdit || podeRemover) && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {canEdit && (
            <button onClick={onEdit}
              className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
              <Pencil size={12} />
            </button>
          )}
          {/* Ícone de CANCELAR (Ban), o mesmo da tela de Pedido de Exames — e não a
              lixeira: nada aqui é excluído de verdade, o registro clínico fica no
              histórico como cancelado. */}
          {podeRemover && (
            <button onClick={onRemove} title="Cancelar item"
              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <Ban size={12} />
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
            <Ban size={18} className="text-red-600" />
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


// ─── SubModuloPrescricao ──────────────────────────────────────────────────────

export default function SubModuloPrescricao({ animalId, animal, onFaturaAtualizada, evolucaoId, evolucaoDeOutro, onSalvo, openItemId, onViewConsumed, editItemId, onEditConsumed, pacienteInativo}: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { podeExecutar, isGestor, loading: loadingPerms } = usePermissoes();

  // 🔴 PACIENTE INATIVO = SOMENTE LEITURA. O prontuário fica congelado na data
  // e hora da inativação: tudo continua visível, nada mais é criado, alterado,
  // finalizado ou cancelado até o gestor reativar. Entra AQUI, nas permissões, para
  // alcançar todo botão de uma vez — o backend recusa igual (lib/animalInativo.js),
  // e oferecer ação que vai dar 400 é a armadilha 28-d.
  // ⚠️ Imprimir/compartilhar ficam de fora: são SAÍDA de conteúdo, não escrita.
  const podeCriar    = !pacienteInativo && (isGestor || podeExecutar('atendimento.prescricoes.criar'));
  const podeEditar   = !pacienteInativo && (isGestor || podeExecutar('atendimento.prescricoes.editar'));
  const podeFinalizar = !pacienteInativo && (isGestor || podeExecutar('atendimento.prescricoes.finalizar'));
  const podeImprimir  = isGestor || podeExecutar('atendimento.prescricoes.imprimir');

  const canEdit = podeCriar;
  const canFinalizarCancelar = podeFinalizar;
  // FORNECEDOR só edita/finaliza/cancela itens que ele próprio criou (mesmo que a MatrizPerfil conceda EQUIPE/FULL)

  // Erro de ação da LISTA: pertence à linha cujo botão foi clicado, não ao topo da
  // página — de onde o usuário não vê o retorno do que acabou de acionar.
  const [erroLinha, setErroLinha] = useState<{ id: number; mensagem: string } | null>(null);
  // Envio do PDF em curso — o spinner tem de ser do BOTÃO clicado, não de todos:
  // é preciso saber a linha E o canal. Mesma lição do `execItemId` do plantão.
  const [enviandoPdf, setEnviandoPdf] = useState<{ id: number; canal: 'whatsapp' | 'email' } | null>(null);
  const erroDaLinha = (id: number) => (erroLinha?.id === id ? erroLinha.mensagem : null);
  const semPermissao = (acao: string, grupoId?: number) => {
    const msg = `Sem permissão para ${acao}. Verifique com o responsável da equipe.`;
    if (grupoId != null) setErroLinha({ id: grupoId, mensagem: msg });
    else                 setErroInline(msg);
  };

  const [grupos,             setGrupos]             = useState<PrescricaoGrupo[]>([]);
  const [loading,            setLoading]            = useState(false);
  const [total,              setTotal]              = useState(0);
  const [salvos,             setSalvos]             = useState(0);
  const [contagens,          setContagens]          = useState<Record<string, number>>({});
  const [filtroStatus,       setFiltroStatus]       = useState<'todos' | StatusGrupo>('todos');
  const [page,               setPage]               = useState(1);
  const [limit]                                     = useState(10);
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
      const statusParam = filtroStatus !== 'todos' ? `&status=${filtroStatus}` : '';
      const res = await api.get(`/clinica/prescricoes/grupos/animal/${animalId}?page=${page}&limit=${limit}${statusParam}`);
      setGrupos(res.data.dados ?? []);
      setTotal(res.data.total ?? 0);
      setSalvos(res.data.salvos ?? 0);
      setContagens(res.data.contagens ?? {});
    } catch { setErroInline('Erro ao carregar prescrições'); }
    finally { setLoading(false); }
  }, [animalId, page, limit, filtroStatus]);

  useEffect(() => { if (!loadingPerms) carregar(); }, [carregar, loadingPerms]);

  const abrirEdicao = (g: PrescricaoGrupo) => { setEditingGrupo(g); };

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
  // Erro de CARGA da página (falha ao listar) — este sim pertence ao topo.
  // Erro de AÇÃO vive em `erroLinha` (na linha) ou `erroReabrir` (no modal).
  const [erroInline, setErroInline] = useState<string | null>(null);

  // Erro do reabrir: o modal continua aberto, então a mensagem tem de aparecer
  // DENTRO dele — no topo da página ela ficaria atrás do overlay.
  const [erroReabrir, setErroReabrir] = useState<string | null>(null);

  const handleAlterar = (g: PrescricaoGrupo) => {
    setErroLinha(null);
    if (g.status === 'SALVO') { abrirEdicao(g); return; }
    setErroReabrir(null);
    setReabrindo(g);
  };

  const confirmarReabrir = async () => {
    if (!reabrindo) return;
    setReabrindoLoading(true);
    setErroReabrir(null);
    try {
      const res = await api.post(`/clinica/prescricoes/grupos/${reabrindo.id}/reabrir`);
      const g = (res.data?.dados as PrescricaoGrupo) ?? { ...reabrindo, status: 'SALVO' as StatusGrupo };
      setReabrindo(null);
      abrirEdicao(g);
      carregar();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setErroReabrir(e?.response?.data?.error ?? 'Erro ao reabrir prescrição');
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
        if (res.data?.dados) { setEditingGrupo(res.data.dados as PrescricaoGrupo); }
        onEditConsumed?.();
      })
      .catch(() => {});
  }, [editItemId]);

  const handleFinalizarDireto = async (grupoId: number) => {
    if (!podeFinalizar) { semPermissao('finalizar prescrição', grupoId); return; }
    setErroLinha(null);
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
        setErroLinha({ id: grupoId, mensagem: resp?.data?.error ?? 'Erro ao finalizar prescrição' });
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
      setErroLinha({ id: alertaDireto.grupoId, mensagem: msg ?? 'Erro ao finalizar prescrição' });
    } finally {
      setLoadingForceDireto(false);
    }
  };
  // ─── Ações da prescrição — UMA declaração para a tabela E para o card ───────
  // `AcaoRegistro` decide a forma por CSS (ícone no desktop, botão com rótulo no
  // mobile), então os dois blocos chamam a MESMA função. Antes eram duas listas
  // paralelas que já haviam divergido: o card mobile não tinha o Finalizar.
  // WhatsApp / E-mail mandam o PDF da MESMA folha do Imprimir, anexado de verdade
  // (Puppeteer no backend) — ver utils/compartilharPdf.ts. Sem telefone/e-mail do
  // cliente, ou sem provider configurado, cai no fallback: baixa o PDF e abre o
  // app com o texto pronto, para a pessoa anexar.
  // ⚠️ `prepararPrescricao` roda ANTES: ele resolve a assinatura do veterinário e
  // converte logo/foto/assinatura para `data:` — o PDF do servidor bloqueia
  // qualquer outra origem e a folha nasceria sem imagem nenhuma.
  const opcoesPdfPrescricao = async (gr: PrescricaoGrupo) => {
    const pronto = await prepararPrescricao(montarGrupoPrint(gr, animal));
    return {
      gerarHtml:   () => gerarHtmlPrescricao(pronto),
      nomeArquivo: nomeArquivoPrescricao(gr, animal),
      documento:   'Prescrição',
      texto:       montarTextoPrescricao(gr),
      titulo:      `Prescrição ${gr.numeroFormatado}`,
    };
  };

  const compartilharPrescricao = async (gr: PrescricaoGrupo, canal: 'whatsapp' | 'email') => {
    setEnviandoPdf({ id: gr.id, canal });
    try {
      const opts = await opcoesPdfPrescricao(gr);
      if (canal === 'whatsapp') await enviarPdfWhatsAppComAviso(opts, animal?.user?.phone);
      else                      await enviarPdfEmailComAviso(opts, animal?.user?.email);
    } finally {
      setEnviandoPdf(null);
    }
  };

  const acoesDoGrupo = (g: PrescricaoGrupo) => {
    // AUTORIA (2026-08-04): a prescrição é do profissional que a criou ou assumiu —
    // só o gestor mexe na de outro. O slug continua sendo o de EDITAR (não o de
    // CRIAR), e a prescrição já executada segue travada.
    const meuRegistro = isGestor || g.veterinarioId === (user?.id ?? 0);
    const editavel    = grupoNaoExecutado(g) && podeEditar && meuRegistro;
    const cancelavel  = ['SALVO', 'FINALIZADO', 'CANCELADO_PARCIALMENTE'].includes(g.status)
      && canFinalizarCancelar && meuRegistro;
    const imprimivel  = ['FINALIZADO', 'EXECUTADO', 'CANCELADO', 'CANCELADO_PARCIALMENTE'].includes(g.status)
      && podeImprimir;
    return (
      <AcoesRegistro>
        <AcaoRegistro tom="alterar" icone={Pencil} rotulo="Alterar"
          visivel={editavel} onClick={() => handleAlterar(g)} />
        <AcaoRegistro tom="ver" icone={Eye} rotulo="Visualizar"
          onClick={() => abrirVisualizacao(g)} />
        <AcaoRegistro tom="finalizar" icone={CheckCircle2} rotulo="Finalizar"
          titulo="Finalizar prescrição"
          visivel={g.status === 'SALVO' && meuRegistro && canFinalizarCancelar}
          onClick={() => handleFinalizarDireto(g.id)} />
        {/* Com medicamento CONTROLADO, os três passam pelo receituário próprio:
            o controlado vai para o documento da Central e o resto sai aqui. Ver
            `receituarioControladoOuComum`. Sem controlado, nada muda. */}
        <AcaoRegistro tom="imprimir" icone={Printer} rotulo="Imprimir"
          titulo="Imprimir prescrição" visivel={imprimivel}
          onClick={() => void receituarioControladoOuComum(g, animalId, navigate, gr => imprimirPrescricao(gr, animal))} />
        {/* Compartilhar é saída de conteúdo do sistema: segue IMPRIMIR */}
        <AcaoRegistro tom="whatsapp" icone={MessageCircle} rotulo="WhatsApp"
          titulo="Enviar o PDF por WhatsApp" visivel={podeImprimir}
          carregando={enviandoPdf?.id === g.id && enviandoPdf.canal === 'whatsapp'}
          desabilitado={enviandoPdf !== null}
          onClick={() => void receituarioControladoOuComum(g, animalId, navigate, gr => compartilharPrescricao(gr, 'whatsapp'))} />
        <AcaoRegistro tom="email" icone={Mail} rotulo="E-mail"
          titulo="Enviar o PDF por e-mail" visivel={podeImprimir}
          carregando={enviandoPdf?.id === g.id && enviandoPdf.canal === 'email'}
          desabilitado={enviandoPdf !== null}
          onClick={() => void receituarioControladoOuComum(g, animalId, navigate, gr => compartilharPrescricao(gr, 'email'))} />
        <AcaoRegistro tom="cancelar" icone={Ban} rotulo="Cancelar"
          titulo="Cancelar prescrição" visivel={cancelavel}
          onClick={() => { setErroLinha(null); setDeletingId(g.id); }} />
      </AcoesRegistro>
    );
  };

  const fecharModal = () => { setEditingGrupo(null); };
  const onSaved = () => { carregar(); onFaturaAtualizada(); onSalvo?.(); };

  const handleExcluirCancelar = async (motivo: string) => {
    if (deletingId === null) return;
    if (!podeFinalizar) { semPermissao('cancelar prescrição', deletingId); setDeletingId(null); return; }
    const grupoId = deletingId;
    setErroLinha(null);
    try {
      await api.post(`/clinica/prescricoes/grupos/${grupoId}/cancelar`, { motivo });
      toast.success('Prescrição cancelada');
      carregar();
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { error?: string; code?: string } } })?.response?.data;
      setErroLinha({
        id: grupoId,
        mensagem: data?.code === 'EXECUTADO'
          ? 'Esta prescrição já foi executada e não pode ser alterada ou cancelada.'
          : (data?.error ?? 'Erro ao cancelar prescrição'),
      });
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
  // Evolução existe, mas é de OUTRO profissional (não assumida) — mesma regra
  // que o backend já aplica em PrescricaoGrupoController.criar; aqui só evita o
  // formulário inteiro preenchido pra falhar com 403 no fim.
  const bloqueadaPorAutoria = !semEvolucaoAtiva && !!evolucaoDeOutro;

  // Guard de acesso à página — mesmo padrão de Evolução/Vacina/Exames
  if (!loadingPerms && !isGestor && !podeExecutar('atendimento.prescricoes.ler')) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <FileText size={32} className="mb-3" />
        <p className="text-sm">Sem permissão para visualizar prescrições</p>
      </div>
    );
  }

  return (
    <>
      <div ref={viewTopRef} />

      <InlineError message={erroInline} className="mx-5 mt-4" />

      {/* Edição inline — MESMO layout da criação (isInline), não mais um modal
          popup: era a única tela do submódulo que fugia do padrão (view/create
          já eram inline), e o usuário perdia o contexto da página ao editar. */}
      {editingGrupo && (
        <div className="border-b border-gray-100">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="flex items-center gap-1.5">
              <Pencil size={12} className="text-amber-500" />
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Editando Prescrição #{editingGrupo.numeroFormatado}
              </p>
            </div>
            <button onClick={fecharModal}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Fechar edição">
              <X size={16} />
            </button>
          </div>
          <GrupoModal
            key={`edit-${editingGrupo.id}`}
            animalId={animalId}
            animal={animal}
            grupo={editingGrupo}
            canEdit={podeEditar}
            canFinalizarCancelar={canFinalizarCancelar}
            podeImprimir={podeImprimir}
            onClose={fecharModal}
            onSaved={onSaved}
            isInline
          />
        </div>
      )}

      {/* Visualização inline (Histórico de Evolução Clínica): campos da
          prescrição populados no formulário da página, somente leitura */}
      {!editingGrupo && viewingGrupo && (
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
      {!editingGrupo && !viewingGrupo && canEdit && (
        semEvolucaoAtiva ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4 border-b border-gray-100">
            <FileText size={28} className="mb-2 text-gray-200" />
            <p className="font-medium text-sm text-gray-500">Evolução necessária</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Inicie uma evolução na aba Evolução para registrar prescrições neste atendimento.
            </p>
          </div>
        ) : bloqueadaPorAutoria ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400 px-4 border-b border-gray-100">
            <FileText size={28} className="mb-2 text-gray-200" />
            <p className="font-medium text-sm text-gray-500">Evolução de outro profissional</p>
            <p className="text-xs mt-1 text-center max-w-xs">
              Você só pode prescrever dentro de um atendimento seu. Assuma esta evolução na aba Evolução para registrar prescrições aqui.
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

      {/* Filtros por status */}
      {(() => {
        const totalGeral  = Object.values(contagens).reduce((a, b) => a + b, 0);
        const statusTabs  = STATUS_ORDER.filter(s => (contagens[s] ?? 0) > 0 || filtroStatus === s);
        if (totalGeral === 0) return null;
        return (
          <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-50">
            {(['todos', ...statusTabs] as ('todos' | StatusGrupo)[]).map(key => {
              const isActive = filtroStatus === key;
              const label    = key === 'todos' ? 'Todos' : STATUS_GRUPO[key].label;
              const count    = key === 'todos' ? totalGeral : (contagens[key] ?? 0);
              return (
                <button key={key} onClick={() => { setFiltroStatus(key); setPage(1); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    isActive ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}>
                  {label}
                  <span className={isActive ? 'text-emerald-100' : 'text-gray-400'}>({count})</span>
                </button>
              );
            })}
          </div>
        );
      })()}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={22} className="animate-spin text-emerald-600" />
        </div>
      ) : grupos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-300">
          <FileText size={38} className="mb-3" />
          <p className="text-sm text-gray-400">
            {filtroStatus === 'todos'
              ? 'Nenhuma prescrição encontrada'
              : `Nenhuma prescrição com status "${STATUS_GRUPO[filtroStatus].label}"`}
          </p>
        </div>
      ) : (
      <>

      {/* Desktop table — janela de 5 linhas: o histórico cresce sem empurrar o
          resto da tela para fora da dobra (ver components/JanelaLista). */}
      <JanelaLista className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nº</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">Data<br />Início</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">Data<br />Fim</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Tipo / Itens</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsável</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Justificativa</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {grupos.map(g => {
              return (
                <tr key={g.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => abrirVisualizacao(g)}
                      className="font-mono font-bold text-emerald-700 hover:text-emerald-900 text-sm hover:underline">
                      #{g.numeroFormatado}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">{formatarData(g.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <p className="text-xs text-gray-700">
                      {dataFimGrupo(g) ? formatarData(dataFimGrupo(g)!) : <span className="text-gray-300">—</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORIA_BADGE[categoriaGrupo(g)]}`}>
                      {categoriaGrupo(g)}
                    </span>
                    {g.itens.some(i => i.aplicadaPeloProprietario) && (
                      <span className="ml-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700"
                        title={g.itens.every(i => i.aplicadaPeloProprietario)
                          ? 'Todos os itens são aplicados pelo proprietário — fora do plantão e da fatura'
                          : 'Contém item(ns) aplicado(s) pelo proprietário — fora do plantão e da fatura'}>
                        Proprietário{g.itens.every(i => i.aplicadaPeloProprietario) ? '' : ' (parcial)'}
                      </span>
                    )}
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
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${statusDoGrupo(g).cls}`}>
                      {statusDoGrupo(g).label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(g.status === 'CANCELADO' || g.status === 'CANCELADO_PARCIALMENTE')
                      ? <JustificativaCancelamento texto={g.motivoCancelamento} className="block max-w-[220px]" />
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {acoesDoGrupo(g)}
                    {/* Erro na superfície da ação: embaixo dos botões desta linha */}
                    <ErroAcao
                      erro={erroDaLinha(g.id) ? { mensagem: erroDaLinha(g.id)! } : null}
                      className="mt-2 max-w-xs mx-auto text-left whitespace-normal"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </JanelaLista>

      {/* Mobile cards */}
      <JanelaLista className="md:hidden divide-y divide-gray-50">
        {grupos.map(g => {
          return (
          <div key={g.id} data-item-lista className="px-4 py-3">
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
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${statusDoGrupo(g).cls}`}>
                {statusDoGrupo(g).label}
              </span>
            </div>
            <p className="text-xs text-gray-500">{g.veterinario.fullName} • {g.itens.length} item{g.itens.length !== 1 ? 'ns' : ''}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{formatarData(g.createdAt)}</p>
            {(g.status === 'CANCELADO' || g.status === 'CANCELADO_PARCIALMENTE') && g.motivoCancelamento && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                Justificativa:{' '}
                <JustificativaCancelamento texto={g.motivoCancelamento} className="inline-block align-bottom max-w-[70vw]" />
              </p>
            )}
            <div className="mt-2">{acoesDoGrupo(g)}</div>
            {/* Erro na superfície da ação: embaixo dos botões deste card */}
            <ErroAcao
              erro={erroDaLinha(g.id) ? { mensagem: erroDaLinha(g.id)! } : null}
              className="mt-2"
            />
          </div>
          );
        })}
      </JanelaLista>

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
        mensagem={
          <>
            Esta prescrição está finalizada. Para editá-la ela voltará a rascunho e as reservas de
            estoque serão liberadas. Ao terminar, finalize-a novamente para reenviá-la à execução.
            <ErroAcao erro={erroReabrir ? { mensagem: erroReabrir } : null} className="mt-3" />
          </>
        }
        labelConfirmar={reabrindoLoading ? 'Reabrindo…' : 'Reabrir e editar'}
        onConfirmar={confirmarReabrir}
        onCancelar={() => { if (!reabrindoLoading) { setErroReabrir(null); setReabrindo(null); } }}
      />
    </>
  );
}