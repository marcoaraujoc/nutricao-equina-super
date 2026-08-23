// src/pages/AnimalDetail.tsx
// Tela do animal — header com dados resumidos, Histórico unificado (evoluções,
// vacinas, exames, prescrições, encaminhamentos) e painel de Agendamentos.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  Search, ChevronDown, Loader2, CalendarClock,
  Clock, User as UserIcon, X, Check, Ban,
  Pill, Syringe, FlaskConical, Send, FileText, ExternalLink,
  Scan, Activity, Building2, ArrowLeftRight,
} from 'lucide-react';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import ModalJustificativa from '../components/ModalJustificativa';
import ProprietarioFormModal from '../components/ProprietarioFormModal';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import InlineError from '../components/InlineError';
import MemoriaClinicaPanel from '../components/MemoriaClinicaPanel';
import type { MemoriaClinica } from '../components/MemoriaClinicaPanel';
import GraficosAnimalPanel from '../components/GraficosAnimalPanel';
import FotoAnimal from '../components/FotoAnimal';
import LaudoTexto from '../components/LaudoTexto';
import { formatNumeroClinico } from '../utils/numeroClinico';

// Ícone do título acompanha a espécie do animal (a espécie atendida pela empresa/equipe)
const ESPECIE_EMOJI: Record<string, string> = {
  'equino': '🐴', 'canino': '🐶', 'felino': '🐱', 'bovino': '🐮',
  'ovino': '🐑', 'caprino': '🐐', 'suíno': '🐷', 'suino': '🐷',
  'réptil': '🦎', 'reptil': '🦎', 'ave': '🐦',
};

function emojiEspecie(nome?: string | null): string {
  if (!nome) return '🐾';
  return ESPECIE_EMOJI[nome.trim().toLowerCase()] ?? '🐾';
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Solicitacao {
  status:       string;
  vetUserId:    number;
  veterinario?: { fullName: string; email: string } | null;
}

interface AnimalData {
  id:                number;
  nome:              string;
  peso:              number;
  sexo:              string;
  photoUrl?:         string | null;
  dataNascimento?:   string | null;
  idadeAnos?:        number | null;
  categoriaAnimal?:  string | null;
  tipoExercicio?:    string | null;
  baia?:             string | null;
  local?:            string | null;
  veterinarioNome?:  string | null;
  raca?:             { nome: string } | null;
  especie?:          { nome: string } | null;
  user?:             { fullName: string; email: string } | null;
  solicitacoes?:     Solicitacao[];
  // Exclusão lógica — paciente inativado some das telas normais. Ausente
  // (undefined) é tratado como ativo, nunca como bloqueio de transferência.
  ativo?:            boolean;
  // Paciente INATIVO — somente leitura (diferente de exclusão lógica: continua
  // aparecendo, só não aceita registro novo nem edição do cadastro).
  inativo?:          boolean;
  inativoEm?:        string | null;
  inativoMotivo?:    string | null;
  inativoPor?:       { fullName: string } | null;
}

type OrigemEvento = 'EVOLUCAO' | 'VACINA' | 'EXAME' | 'EXAME_LAB' | 'EXAME_IMG' | 'EXAME_BIO' | 'EXAME_COMPRA' | 'ENCAMINHAMENTO' | 'PRESCRICAO';

interface EventoHistorico {
  id:                string;
  origem:            OrigemEvento;
  data:              string;
  titulo:            string;
  badge:             string;
  status:            string | null;
  responsavel:       string | null;
  resumo:            string;
  evolucaoId:        number | null;
  atendimentoNumero?: string | null;
}

type TipoAgendamento = 'CONSULTA' | 'VACINA' | 'RETORNO' | 'EXAME' | 'PROCEDIMENTO';

interface Agendamento {
  id:          number;
  tipo:        TipoAgendamento;
  titulo:      string;
  dataHora:    string;
  observacao:  string | null;
  status:      string;
  veterinario: { id: number; fullName: string } | null;
}

// ─── Detail record types ──────────────────────────────────────────────────────

interface DetalheEvolucao {
  id: number; titulo: string | null; especialidade: string | null;
  texto: string; status: string; dataInicio: string;
  veterinario: { fullName: string } | null;
  midias?: { id: number; tipo: string; nome: string | null }[];
}

interface DetalheVacina {
  id: number; nome: string; fabricante: string | null; lote: string | null;
  dose: string | null; via: string | null; quantidade: number | null;
  cliente: boolean; ativo: boolean; dataAplicacao: string;
  dataReforco: string | null; observacao: string | null;
  numero: number | null; tipoAtendimento: string | null;
  motivoInativacao: string | null;
  veterinario: { fullName: string } | null;
  loteVacina: { lote: string; validade: string } | null;
}

interface GrupoExameDetalhe {
  tipo:             string;
  laboratorio:      string | null;
  nome:             string | null;
  exames:           string[] | null;
  tipoAmostra:      string | null;
  indicacaoClinica: string | null;
  obs:              string | null;
}

interface DetalheExame {
  id: number; tipo: string; descricao: string | null;
  resultado: string | null; status: string; dataSolicitacao: string;
  observacao: string | null;
  veterinario: { fullName: string } | null;
}

interface DetalheEncaminhamento {
  id: number; especialidade: string; motivo: string; urgencia: string;
  status: string; dataEncaminhamento: string;
  destinoExterno: string | null;
  veterinario: { fullName: string } | null;
  prestador: { fullName: string } | null;
}

interface ItemPrescricao {
  id: number; tipo: string; medicamento: string;
  dosagem: string | null; unidade: string | null; via: string;
  frequencia: string; duracaoDias: number; dataInicio: string;
  observacao: string | null; medicamentoCliente: boolean;
  /** Aplicado pelo proprietário em casa: fora do plantão, da fatura e do estoque. */
  aplicadaPeloProprietario?: boolean;
}

interface DetalhePrescricao {
  id: number; numero: number; numeroFormatado: string; status: string;
  createdAt: string; veterinario: { fullName: string };
  itens: ItemPrescricao[];
}

type DetalheRecord =
  | { tipo: 'EVOLUCAO';       dados: DetalheEvolucao }
  | { tipo: 'VACINA';         dados: DetalheVacina }
  | { tipo: 'EXAME';          dados: DetalheExame }
  | { tipo: 'ENCAMINHAMENTO'; dados: DetalheEncaminhamento }
  | { tipo: 'PRESCRICAO';     dados: DetalhePrescricao };

interface GrupoHistorico {
  key:      string;
  data:     string;
  evolucao: EventoHistorico | null;
  subitems: EventoHistorico[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BADGE_ORIGEM: Record<OrigemEvento, string> = {
  EVOLUCAO:       'bg-emerald-100 text-emerald-700',
  VACINA:         'bg-teal-100 text-teal-700',
  EXAME:          'bg-purple-100 text-purple-700',
  EXAME_LAB:      'bg-blue-100 text-blue-700',
  EXAME_IMG:      'bg-sky-100 text-sky-700',
  EXAME_BIO:      'bg-violet-100 text-violet-700',
  EXAME_COMPRA:   'bg-amber-100 text-amber-700',
  ENCAMINHAMENTO: 'bg-orange-100 text-orange-700',
  PRESCRICAO:     'bg-blue-100 text-blue-700',
};

const BADGE_TIPO_AG: Record<TipoAgendamento, string> = {
  VACINA:       'bg-amber-100 text-amber-700',
  CONSULTA:     'bg-blue-100 text-blue-700',
  RETORNO:      'bg-teal-100 text-teal-700',
  EXAME:        'bg-purple-100 text-purple-700',
  PROCEDIMENTO: 'bg-emerald-100 text-emerald-700',
};

const POSOLOGIAS: Record<string, string> = {
  '1xDia': '1x/dia', '12em12h': '12 em 12h', '8em8h': '8 em 8h',
  '6em6h': '6 em 6h', '4em4h': '4 em 4h', '1em1h': '1 em 1h',
  'continuo': 'Contínuo', 'agora': 'Dose única', 'seNecessario': 'Se necessário',
  'SOS': 'SOS', '1x2dias': '1x/2 dias', '1x3dias': '1x/3 dias',
  '1xSemana': '1x/semana', '1x21dias': '1x/21 dias', '1x30dias': '1x/30 dias',
  '1x90dias': '1x/90 dias',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mesAbrev = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();

const diaDoMes = (iso: string) => new Date(iso).getDate();

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

// Para datas que vêm de um <input type="date"> (sem horário — salvas como meia-noite
// UTC): formatar no fuso do navegador jogaria para o dia anterior em fusos negativos
// (ex: Brasil). Mantém a data que o usuário escolheu.
const formatDateSemHora = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

const labelFreq = (v: string) => POSOLOGIAS[v] ?? v;

function parseExtraExame(obs: string | null): { grupos?: GrupoExameDetalhe[] | null; laboratorio?: string | null; [k: string]: unknown } | null {
  if (!obs) return null;
  try { return JSON.parse(obs) as { grupos?: GrupoExameDetalhe[] | null }; }
  catch { return null; }
}

const calcularIdade = (dataNascimento?: string | null, idadeAnos?: number | null): string => {
  if (dataNascimento) {
    const nasc = new Date(dataNascimento);
    const hoje = new Date();
    let anos = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) anos--;
    if (anos >= 1) return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
    const meses = Math.max(0, (hoje.getFullYear() - nasc.getFullYear()) * 12 + hoje.getMonth() - nasc.getMonth());
    return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  }
  if (idadeAnos) return `${idadeAnos} ${idadeAnos === 1 ? 'ano' : 'anos'}`;
  return '—';
};

function parseEventoId(ev: EventoHistorico): { origem: OrigemEvento; numId: number } | null {
  const [origem, rawId] = ev.id.split('-');
  const numId = Number(rawId);
  if (!origem || isNaN(numId)) return null;
  return { origem: origem.toUpperCase() as OrigemEvento, numId };
}

const ISO_DIA = (iso: string) => iso.substring(0, 10);

function agruparEventos(eventos: EventoHistorico[]): GrupoHistorico[] {
  const evolucoes = eventos.filter(e => e.origem === 'EVOLUCAO');
  const outros    = eventos.filter(e => e.origem !== 'EVOLUCAO');

  const evolucaoIds = new Set(evolucoes.map(e => e.evolucaoId));

  // Agrupa filhos pelo vínculo real evolucaoId (AG-XXXX/EV-XXXX pai); sem
  // vínculo válido (ex: vacina avulsa, exame de compra) cai no bucket "avulso" por dia.
  const subPorEvolucao = new Map<number, EventoHistorico[]>();
  const avulsosPorDia  = new Map<string, EventoHistorico[]>();

  for (const ev of outros) {
    if (ev.evolucaoId != null && evolucaoIds.has(ev.evolucaoId)) {
      if (!subPorEvolucao.has(ev.evolucaoId)) subPorEvolucao.set(ev.evolucaoId, []);
      subPorEvolucao.get(ev.evolucaoId)!.push(ev);
    } else {
      const k = ISO_DIA(ev.data);
      if (!avulsosPorDia.has(k)) avulsosPorDia.set(k, []);
      avulsosPorDia.get(k)!.push(ev);
    }
  }

  const grupos: GrupoHistorico[] = evolucoes.map(ev => ({
    key:      ev.id,
    data:     ev.data,
    evolucao: ev,
    subitems: subPorEvolucao.get(ev.evolucaoId!) ?? [],
  }));

  for (const [dia, subs] of avulsosPorDia) {
    grupos.push({
      key:      `avulso-${dia}`,
      data:     dia + 'T12:00:00',
      evolucao: null,
      subitems: subs,
    });
  }

  // Ordem decrescente por data e, no empate (ex.: vários registros no mesmo dia),
  // desempate pelo Nº do registro em ordem decrescente — o id sequencial cresce com a
  // criação, então o registro mais novo (maior número) vem primeiro.
  const numFinal = (s: string): number => { const m = /(\d+)$/.exec(s); return m ? Number(m[1]) : 0; };
  const subDesc = (a: EventoHistorico, b: EventoHistorico) => {
    const dd = new Date(b.data).getTime() - new Date(a.data).getTime();
    return dd !== 0 ? dd : numFinal(b.id) - numFinal(a.id);
  };
  const grupoDesc = (a: GrupoHistorico, b: GrupoHistorico) => {
    const dd = new Date(b.data).getTime() - new Date(a.data).getTime();
    return dd !== 0 ? dd : numFinal(b.evolucao?.id ?? b.key) - numFinal(a.evolucao?.id ?? a.key);
  };
  for (const g of grupos) g.subitems.sort(subDesc);
  grupos.sort(grupoDesc);
  return grupos;
}

// ─── Header — dados do animal ─────────────────────────────────────────────────

function CampoHeader({ label, valor, className = '' }: { label: string; valor: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="block text-[10px] uppercase text-gray-400 tracking-widest">{label}</span>
      <span className="block text-sm text-gray-900 truncate mt-0.5" title={valor}>{valor}</span>
    </div>
  );
}

function HeaderAnimal({ animal }: { animal: AnimalData }) {
  const solAceita = animal.solicitacoes?.find(s => s.status === 'ACEITO');
  const vetNome   = solAceita?.veterinario?.fullName ?? animal.veterinarioNome ?? null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
      <div className="flex gap-4 sm:gap-6">
        <div className="w-20 h-20 sm:w-28 sm:h-24 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
          <FotoAnimal url={animal.photoUrl} nome={animal.nome} />
        </div>
        <div className="flex-1 min-w-0">
          {/* Mobile (< md): nome completo na 1ª linha; Idade, Peso e Baia na 2ª */}
          <div className="md:hidden space-y-3">
            <CampoHeader label="Nome" valor={animal.nome} />
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <CampoHeader label="Idade" valor={calcularIdade(animal.dataNascimento, animal.idadeAnos)} />
              <CampoHeader label="Peso"  valor={animal.peso ? `${animal.peso} kg` : '—'} />
              <CampoHeader label="Baia"  valor={animal.baia ?? '—'} />
            </div>
          </div>

          {/* Desktop (>= md): completo em 2 linhas */}
          <div className="hidden md:block">
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 pb-3 border-b border-gray-50">
              <CampoHeader label="Nome"    valor={animal.nome} />
              <CampoHeader label="Espécie" valor={animal.especie?.nome ?? '—'} />
              <CampoHeader label="Raça"    valor={animal.raca?.nome ?? '—'} />
              <CampoHeader label="Idade"   valor={calcularIdade(animal.dataNascimento, animal.idadeAnos)} />
              <CampoHeader label="Peso"    valor={animal.peso ? `${animal.peso} kg` : '—'} />
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-3 pt-3">
              <CampoHeader label="Baia"             valor={animal.baia ?? '—'} />
              <CampoHeader label="Local"            valor={animal.local ?? '—'} />
              <CampoHeader label="Tipo de Trabalho" valor={animal.tipoExercicio ?? '—'} />
              <CampoHeader label="Proprietário"     valor={animal.user?.fullName ?? '—'} />
              {vetNome && <CampoHeader label="Vet. Responsável" valor={vetNome} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DetalheModal ─────────────────────────────────────────────────────────────

function RowDetalhe({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 w-32 flex-shrink-0 pt-0.5 font-medium">{label}</span>
      <span className="text-sm text-gray-800 flex-1">{value}</span>
    </div>
  );
}

function DetalheModalEvolucao({ dados }: { dados: DetalheEvolucao }) {
  return (
    <div className="space-y-0">
      <RowDetalhe label="Especialidade" value={dados.especialidade ?? 'Clínica Geral'} />
      <RowDetalhe label="Status"        value={dados.status} />
      <RowDetalhe label="Data"          value={formatDate(dados.dataInicio)} />
      <RowDetalhe label="Responsável"   value={dados.veterinario?.fullName} />
      {dados.texto && (
        <div className="py-2.5 border-b border-gray-50">
          <span className="text-xs text-gray-400 font-medium block mb-1.5">Texto</span>
          <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{dados.texto}</p>
        </div>
      )}
      {dados.midias && dados.midias.length > 0 && (
        <RowDetalhe
          label="Mídias"
          value={`${dados.midias.length} arquivo${dados.midias.length > 1 ? 's' : ''} anexado${dados.midias.length > 1 ? 's' : ''}`}
        />
      )}
    </div>
  );
}

function DetalheModalVacina({ dados }: { dados: DetalheVacina }) {
  // MESMA formatação e lógica do Nº da prescrição (linha "Nº Prescrição", abaixo):
  // #074, mono/negrito/emerald. Era `VC-0004` em teal e sob o rótulo "Nº Atendimento",
  // que é OUTRO número (o do atendimento: AG-0012/EV-0007) — ver utils/numeroClinico.
  const vcNum = formatNumeroClinico(dados.numero);
  return (
    <div className="space-y-0">
      {vcNum && <RowDetalhe label="Nº Vacina" value={<span className="font-mono font-bold text-emerald-700">#{vcNum}</span>} />}
      {dados.cliente && (
        <div className="py-2.5 border-b border-gray-50">
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
            Vacina do cliente
          </span>
        </div>
      )}
      <RowDetalhe label="Status"        value={!dados.ativo ? 'Inativa' : dados.dataReforco && new Date(dados.dataReforco) < new Date() ? 'Vencida' : 'Vigente'} />
      <RowDetalhe label="Fabricante"    value={dados.fabricante} />
      <RowDetalhe label="Lote"          value={dados.lote} />
      {dados.loteVacina && <RowDetalhe label="Val. Lote" value={formatDateSemHora(dados.loteVacina.validade)} />}
      <RowDetalhe label="Tipo dose"     value={dados.dose} />
      {dados.quantidade != null && dados.quantidade > 1 && <RowDetalhe label="Qtd doses" value={String(dados.quantidade)} />}
      <RowDetalhe label="Via"           value={dados.via} />
      <RowDetalhe label="Data aplicação" value={formatDateSemHora(dados.dataAplicacao)} />
      {dados.dataReforco && <RowDetalhe label="Reforço" value={formatDateSemHora(dados.dataReforco)} />}
      <RowDetalhe label="Executor"      value={dados.veterinario?.fullName} />
      <RowDetalhe label="Observação"    value={dados.observacao} />
      {!dados.ativo && dados.motivoInativacao && (
        <div className="py-2.5">
          <span className="text-xs text-gray-400 font-medium block mb-1">Motivo da inativação</span>
          <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">{dados.motivoInativacao}</p>
        </div>
      )}
    </div>
  );
}

function DetalheModalExame({ dados }: { dados: DetalheExame }) {
  const extra  = parseExtraExame(dados.observacao);
  const grupos = extra?.grupos?.filter(g => g.exames && g.exames.length > 0) ?? [];

  // Agrupa por laboratório preservando a ordem de aparição
  const labOrder: string[]                       = [];
  const labMap: Map<string, GrupoExameDetalhe[]> = new Map();
  for (const g of grupos) {
    const key = g.laboratorio?.trim() || 'Sem laboratório';
    if (!labMap.has(key)) { labMap.set(key, []); labOrder.push(key); }
    labMap.get(key)!.push(g);
  }

  const temBlocos = labOrder.length > 0;

  return (
    <div className="space-y-0">
      <RowDetalhe label="Status"      value={dados.status} />
      <RowDetalhe label="Data"        value={formatDateSemHora(dados.dataSolicitacao)} />
      <RowDetalhe label="Responsável" value={dados.veterinario?.fullName} />

      {/* Blocos por laboratório */}
      {temBlocos && (
        <div className="pt-3 space-y-3">
          {labOrder.map(lab => {
            const gs = labMap.get(lab)!;
            return (
              <div key={lab} className="border border-blue-100 rounded-xl overflow-hidden">
                {/* Cabeçalho — nome do laboratório */}
                <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 border-b border-blue-100">
                  <FlaskConical size={13} className="text-blue-500 flex-shrink-0" />
                  <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">{lab}</span>
                </div>

                {/* Grupos deste laboratório */}
                <div className="divide-y divide-gray-50">
                  {gs.map((g, gi) => (
                    <div key={gi} className="px-3 py-2.5">
                      {g.nome && (
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                          {g.nome}
                        </p>
                      )}
                      <ul className="space-y-0.5">
                        {g.exames!.map((ex, ei) => (
                          <li key={ei} className="flex items-start gap-1.5 text-sm text-gray-800">
                            <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                            {ex}
                          </li>
                        ))}
                      </ul>
                      {g.tipoAmostra && (
                        <p className="text-[11px] text-gray-400 mt-1.5">Amostra: {g.tipoAmostra}</p>
                      )}
                      {g.obs && (
                        <p className="text-[11px] text-gray-400 mt-0.5">Obs: {g.obs}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback: sem grupos estruturados */}
      {!temBlocos && dados.descricao && (
        <div className="py-2.5 border-b border-gray-50">
          <span className="text-xs text-gray-400 font-medium block mb-1.5">Exames</span>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{dados.descricao}</p>
        </div>
      )}

      {dados.resultado && (
        <div className="py-2.5 pt-3">
          <span className="text-xs text-gray-400 font-medium block mb-1.5">Resultado</span>
          <LaudoTexto texto={dados.resultado} className="text-sm text-gray-800 whitespace-pre-wrap" />
        </div>
      )}
    </div>
  );
}

function DetalheModalEncaminhamento({ dados }: { dados: DetalheEncaminhamento }) {
  const urgenciaCls =
    dados.urgencia === 'URGENTE' ? 'text-red-600 font-semibold' :
    dados.urgencia === 'ALTA'    ? 'text-orange-600 font-semibold' :
    'text-gray-700';
  return (
    <div className="space-y-0">
      <RowDetalhe label="Especialidade" value={dados.especialidade} />
      <RowDetalhe label="Urgência"      value={<span className={urgenciaCls}>{dados.urgencia}</span>} />
      <RowDetalhe label="Status"        value={dados.status} />
      <RowDetalhe label="Data"          value={formatDate(dados.dataEncaminhamento)} />
      <RowDetalhe label="Responsável"   value={dados.veterinario?.fullName} />
      <RowDetalhe
        label="Destino"
        value={dados.prestador?.fullName ?? dados.destinoExterno ?? <span className="text-gray-400 italic">Externo</span>}
      />
      {dados.motivo && (
        <div className="py-2.5">
          <span className="text-xs text-gray-400 font-medium block mb-1.5">Motivo</span>
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{dados.motivo}</p>
        </div>
      )}
    </div>
  );
}

const STATUS_PRESCRICAO: Record<string, { label: string; cls: string }> = {
  SALVO:                  { label: 'Salvo',          cls: 'bg-amber-100 text-amber-700' },
  FINALIZADO:             { label: 'Finalizado',     cls: 'bg-emerald-100 text-emerald-700' },
  EXECUTADO:              { label: 'Executado',      cls: 'bg-blue-100 text-blue-700' },
  CANCELADO:              { label: 'Cancelado',      cls: 'bg-red-100 text-red-700' },
  CANCELADO_PARCIALMENTE: { label: 'Cancel. Parcial', cls: 'bg-orange-100 text-orange-700' },
};

function DetalheModalPrescricao({ dados }: { dados: DetalhePrescricao }) {
  const st = STATUS_PRESCRICAO[dados.status] ?? { label: dados.status, cls: 'bg-gray-100 text-gray-600' };
  return (
    <div className="space-y-0">
      <RowDetalhe label="Nº Prescrição" value={<span className="font-mono font-bold text-emerald-700">#{dados.numeroFormatado}</span>} />
      <RowDetalhe label="Status"        value={<span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${st.cls}`}>{st.label}</span>} />
      <RowDetalhe label="Data"          value={formatDate(dados.createdAt)} />
      <RowDetalhe label="Veterinário"   value={dados.veterinario.fullName} />
      {dados.itens.length > 0 && (
        <div className="pt-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">
            ITENS ({dados.itens.length})
          </p>
          <div className="space-y-2">
            {dados.itens.map(item => (
              <div key={item.id} className="border border-gray-100 rounded-xl px-3 py-2.5 bg-gray-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    item.tipo === 'MEDICAMENTO' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {item.tipo === 'MEDICAMENTO' ? <Pill size={9} /> : null}
                    {item.tipo === 'MEDICAMENTO' ? 'Med' : 'Proc'}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{item.medicamento}</span>
                  {item.medicamentoCliente && (
                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                      Cliente
                    </span>
                  )}
                  {item.aplicadaPeloProprietario && (
                    <span title="Aplicado pelo proprietário — fora da Execução de Prescrição"
                      className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                      Proprietário
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                  {item.dosagem && <span>Dose: {item.dosagem}{item.unidade ? ' ' + item.unidade : ''}</span>}
                  {item.via     && <span>Via: {item.via}</span>}
                  {item.frequencia && <span>Freq: {labelFreq(item.frequencia)}</span>}
                  {item.duracaoDias && <span>Dur: {item.duracaoDias}d</span>}
                  {item.dataInicio  && <span>Início: {formatDate(item.dataInicio)}</span>}
                  {item.observacao  && <span>Obs: {item.observacao}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const DETALHE_CONFIG: Record<OrigemEvento, { icon: React.ReactNode; title: string; accentCls: string }> = {
  EVOLUCAO:       { icon: <FileText size={16} />,    title: 'Evolução Clínica',    accentCls: 'text-emerald-600' },
  VACINA:         { icon: <Syringe size={16} />,     title: 'Vacina',              accentCls: 'text-teal-600'    },
  EXAME:          { icon: <FlaskConical size={16} />, title: 'Exame Clínico',       accentCls: 'text-purple-600'  },
  EXAME_LAB:      { icon: <FlaskConical size={16} />, title: 'Exame Laboratorial',  accentCls: 'text-blue-600'    },
  EXAME_IMG:      { icon: <Scan size={16} />,         title: 'Exame de Imagem',     accentCls: 'text-sky-600'     },
  EXAME_BIO:      { icon: <FlaskConical size={16} />, title: 'Exame Bioquímico',    accentCls: 'text-violet-600'  },
  EXAME_COMPRA:   { icon: <Activity size={16} />,     title: 'Exame de Compra',     accentCls: 'text-amber-600'   },
  ENCAMINHAMENTO: { icon: <Send size={16} />,         title: 'Encaminhamento',      accentCls: 'text-orange-600'  },
  PRESCRICAO:     { icon: <Pill size={16} />,         title: 'Prescrição',          accentCls: 'text-blue-600'    },
};

function DetalheModal({
  ev, detalhe, loading, onFechar,
}: {
  ev:      EventoHistorico;
  detalhe: DetalheRecord | null;
  loading: boolean;
  onFechar: () => void;
}) {
  const cfg = DETALHE_CONFIG[ev.origem];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92vh] flex flex-col border border-gray-100">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className={cfg.accentCls}>{cfg.icon}</span>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{cfg.title}</p>
              <h3 className="font-bold text-gray-900 text-sm leading-tight">{ev.titulo}</h3>
            </div>
          </div>
          <button onClick={onFechar} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={22} className="animate-spin text-gray-400" />
            </div>
          ) : !detalhe ? (
            <p className="text-center text-sm text-gray-400 py-12">Não foi possível carregar os dados.</p>
          ) : (
            <>
              {detalhe.tipo === 'EVOLUCAO'       && <DetalheModalEvolucao       dados={detalhe.dados} />}
              {detalhe.tipo === 'VACINA'         && <DetalheModalVacina         dados={detalhe.dados} />}
              {detalhe.tipo === 'EXAME'          && <DetalheModalExame          dados={detalhe.dados} />}
              {detalhe.tipo === 'ENCAMINHAMENTO' && <DetalheModalEncaminhamento dados={detalhe.dados} />}
              {detalhe.tipo === 'PRESCRICAO'     && <DetalheModalPrescricao     dados={detalhe.dados} />}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 flex-shrink-0">
          <button onClick={onFechar}
            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Histórico — componentes cascata ─────────────────────────────────────────

function SubItemHistorico({ ev, onClick }: {
  ev:      EventoHistorico;
  onClick: (ev: EventoHistorico) => void;
}) {
  const cfg = DETALHE_CONFIG[ev.origem];
  return (
    <button onClick={() => onClick(ev)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-left transition-colors border border-transparent hover:border-gray-200 group">
      <span className={`${cfg.accentCls} flex-shrink-0`}>{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-800 truncate block">{ev.titulo}</span>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wide ${BADGE_ORIGEM[ev.origem]}`}>
            {ev.badge}
          </span>
          {ev.status && <span className="text-[10px] text-gray-400">{ev.status}</span>}
        </div>
      </div>
      <ExternalLink size={12} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
    </button>
  );
}

function GrupoHistoricoItem({
  grupo, expandido, onToggle, onClickEvento,
}: {
  grupo:         GrupoHistorico;
  expandido:     boolean;
  onToggle:      (key: string) => void;
  onClickEvento: (ev: EventoHistorico) => void;
}) {
  const ev       = grupo.evolucao;
  const totalSub = grupo.subitems.length;

  if (!ev) {
    return (
      <div className="border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden">
        <button onClick={() => onToggle(grupo.key)}
          className="w-full flex items-start gap-3 p-3 sm:p-4 hover:bg-gray-50 text-left transition-colors">
          <div className="flex flex-col items-center justify-center w-12 h-14 border border-gray-200 rounded-xl flex-shrink-0">
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mesAbrev(grupo.data)}</span>
            <span className="text-lg font-bold text-gray-900 leading-none mt-0.5">{diaDoMes(grupo.data)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-bold text-gray-600">Registros avulsos</span>
            <p className="text-xs text-gray-400 mt-0.5">{totalSub} registro{totalSub !== 1 ? 's' : ''}</p>
          </div>
          <ChevronDown size={16} className={`text-gray-400 flex-shrink-0 mt-1 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </button>
        {expandido && (
          <div className="border-t border-gray-50 px-3 pb-3 pt-2 space-y-1.5">
            {grupo.subitems.map(sub => (
              <SubItemHistorico key={sub.id} ev={sub} onClick={onClickEvento} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gray-100 rounded-2xl bg-white shadow-sm overflow-hidden">
      {/* Cabeçalho — evolução (toggle) */}
      <button onClick={() => onToggle(grupo.key)}
        className="w-full flex items-start gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-gray-50 text-left transition-colors group">
        <div className="flex flex-col items-center justify-center w-12 h-14 border border-gray-200 rounded-xl flex-shrink-0">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mesAbrev(ev.data)}</span>
          <span className="text-lg font-bold text-gray-900 leading-none mt-0.5">{diaDoMes(ev.data)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded font-mono tracking-wider">{ev.atendimentoNumero ?? 'EV-'}</span>
            <span className="text-sm font-bold text-gray-900">{ev.titulo}</span>
            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${BADGE_ORIGEM[ev.origem]}`}>
              {ev.badge}
            </span>
          </div>
          {ev.responsavel && (
            <p className="text-[10px] text-gray-400 font-mono uppercase mt-0.5">por: {ev.responsavel}</p>
          )}
          {!expandido && totalSub > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {totalSub} registro{totalSub !== 1 ? 's' : ''} vinculado{totalSub !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          {totalSub > 0 && (
            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {totalSub}
            </span>
          )}
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandido ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Sub-itens */}
      {expandido && (
        <div className="border-t border-gray-50">
          <div className="px-3 pt-2 pb-1">
            <button onClick={() => onClickEvento(ev)}
              className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-800 py-1 font-medium transition-colors">
              <FileText size={12} />
              Ver detalhes da evolução
              <ExternalLink size={11} />
            </button>
          </div>
          {totalSub > 0 && (
            <div className="px-3 pb-3 space-y-1.5">
              {grupo.subitems.map(sub => (
                <SubItemHistorico key={sub.id} ev={sub} onClick={onClickEvento} />
              ))}
            </div>
          )}
          {totalSub === 0 && <div className="pb-2" />}
        </div>
      )}
    </div>
  );
}

// ─── Agendamentos ─────────────────────────────────────────────────────────────

function CardAgendamento({ ag, podeGerenciar, onConcluir, onCancelar }: {
  ag:            Agendamento;
  podeGerenciar: boolean;
  onConcluir:    (id: number) => void;
  onCancelar:    (id: number) => void;
}) {
  // REAGENDADO (e o legado TRANSFERIDO): sai da grade como o cancelado, mas NÃO é desistência —
  // tem badge próprio e mostra para quando o atendimento foi movido (observacao).
  const isTransferido    = ag.status === 'REAGENDADO' || ag.status === 'TRANSFERIDO';
  // CANCELADO_AUTOMATICAMENTE: a rotina noturna encerrou sozinha (agendamento nunca
  // realizado, ou EM_ANDAMENTO que ficou pendurado sem conclusão). Conta como cancelado
  // para o card (opacidade, some das ações), com um rótulo próprio no badge.
  const isCanceladoAuto  = ag.status === 'CANCELADO_AUTOMATICAMENTE';
  const isCancelado    = ag.status === 'CANCELADO' || isCanceladoAuto || isTransferido;
  const isConcluido    = ag.status === 'CONCLUIDO';
  const isEmAndamento  = ag.status === 'EM_ANDAMENTO';
  const isFinalizado   = ag.status === 'FINALIZADO';
  const isEncerrado    = isConcluido || isFinalizado;
  return (
    <div className={`border rounded-2xl p-3 bg-white ${isCancelado ? 'border-red-100 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`flex flex-col items-center justify-center w-11 h-12 border rounded-xl flex-shrink-0 ${isCancelado ? 'border-red-100' : 'border-gray-200'}`}>
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{mesAbrev(ag.dataHora)}</span>
          <span className="text-base font-bold text-gray-900 leading-none mt-0.5">{diaDoMes(ag.dataHora)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-block text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${BADGE_TIPO_AG[ag.tipo] ?? 'bg-gray-100 text-gray-500'}`}>
              {ag.tipo}
            </span>
            {isCancelado && (
              <span className={`inline-block text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
                isTransferido ? 'bg-violet-100 text-violet-700' : isCanceladoAuto ? 'bg-red-50 text-red-400' : 'bg-red-100 text-red-600'
              }`}>
                {isTransferido ? 'Transferido' : isCanceladoAuto ? 'Cancelado automaticamente' : 'Cancelado'}
              </span>
            )}
            {isEmAndamento && (
              <span className="inline-block text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-blue-100 text-blue-700">
                Em andamento
              </span>
            )}
            {isEncerrado && (
              <span className="inline-block text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700">
                {isFinalizado ? 'Finalizado' : 'Concluído'}
              </span>
            )}
          </div>
          <p className={`text-xs font-bold mt-1.5 leading-snug ${isCancelado ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{ag.titulo}</p>
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-400">
            <Clock size={10} /> {horaDe(ag.dataHora)}
          </div>
          {/* Transferido: para quando foi. Cancelado: por quê. Os dois vêm da observação. */}
          {isCancelado && ag.observacao && (
            <p className={`text-[11px] mt-1 italic ${isTransferido ? 'text-violet-600' : 'text-red-500'}`}>
              {isTransferido ? ag.observacao : `Motivo: ${ag.observacao}`}
            </p>
          )}
          {ag.veterinario && (
            <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-500 font-medium">
              <UserIcon size={10} /> Vet: {ag.veterinario.fullName}
            </div>
          )}
        </div>
        {podeGerenciar && !isCancelado && !isEncerrado && (
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            {/* Concluir direto só faz sentido ANTES do atendimento começar — uma vez
                EM_ANDAMENTO, o encerramento passa pela evolução, não por um flip de
                status aqui. */}
            {!isEmAndamento && (
              <button onClick={() => onConcluir(ag.id)} title="Concluir"
                className="p-1 text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                <Check size={12} />
              </button>
            )}
            {/* EM_ANDAMENTO nunca é excluído — só cancelado (`onExcluir` já grava
                status: CANCELADO, nunca um hard delete). Ícone precisa refletir isso:
                Trash2 prometia exclusão que a ação nunca fez. */}
            <button onClick={() => onCancelar(ag.id)} title="Cancelar agendamento"
              className="p-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <Ban size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

const ENDPOINT: Record<OrigemEvento, (id: number) => string> = {
  EVOLUCAO:       id => `/clinica/evolucoes/${id}`,
  VACINA:         id => `/clinica/vacinas/${id}`,
  EXAME:          id => `/clinica/exames/${id}`,
  EXAME_LAB:      id => `/clinica/exames/${id}`,
  EXAME_IMG:      id => `/clinica/exames/${id}`,
  EXAME_BIO:      id => `/clinica/exames/${id}`,
  EXAME_COMPRA:   id => `/clinica/exames/${id}`,
  ENCAMINHAMENTO: id => `/clinica/encaminhamentos/${id}`,
  PRESCRICAO:     id => `/clinica/prescricoes/grupos/${id}`,
};

const AnimalDetail = () => {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isGestor } = usePermissoes();
  const { user } = useAuth();
  const podeTransferirPropriedade = isGestor || user?.userType === 'ADMIN';
  const [showTransferencia, setShowTransferencia] = useState(false);
  const [animal,       setAnimal]       = useState<AnimalData | null>(null);
  // Paciente existe, mas é de OUTRA empresa/equipe que não a do contexto ativo
  const [foraDoContexto, setForaDoContexto] = useState(false);
  const [historico,    setHistorico]    = useState<EventoHistorico[]>([]);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [busca,        setBusca]        = useState('');
  const [expandidos,   setExpandidos]   = useState<Set<string>>(new Set());
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline,   setErroInline]   = useState<string | null>(null);

  // Detalhe
  const [detalheEv,      setDetalheEv]      = useState<EventoHistorico | null>(null);
  const [cancelandoAgId, setCancelandoAgId] = useState<number | null>(null);
  const [detalheRecord,  setDetalheRecord]  = useState<DetalheRecord | null>(null);
  const [detalheLoading, setDetalheLoading] = useState(false);

  const carregarAgendamentos = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get(`/clinica/agendamentos/animal/${id}?futuros=1`);
      if (!res.data) return;
      setAgendamentos(res.data.dados ?? []);
    } catch { /* silencioso */ }
  }, [id]);

  // ── Memória Clínica do Paciente (IA, persistida; append só com evento novo) ──
  const [memoriaIA,         setMemoriaIA]         = useState<MemoriaClinica | null>(null);
  const [atualizandoResumo, setAtualizandoResumo] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    (async () => {
      try {
        // 1) Exibe imediatamente o resumo salvo
        const res = await api.get(`/clinica/resumo-atendimento/animal/${id}`);
        if (cancelado || !res.data) return;
        const dados = res.data?.dados ?? null;
        setMemoriaIA(dados);
        // 2) Havendo evento novo (procedimento, fatura manual etc.), apenda via IA
        if (dados?.desatualizado) {
          setAtualizandoResumo(true);
          try {
            const upd = await api.post(`/clinica/resumo-atendimento/animal/${id}/atualizar`);
            if (!cancelado && upd.data?.dados) setMemoriaIA(upd.data.dados);
          } catch { /* mantém o resumo salvo */ }
          finally { if (!cancelado) setAtualizandoResumo(false); }
        }
      } catch { /* silencioso */ }
    })();
    return () => { cancelado = true; };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setForaDoContexto(false);
    Promise.all([
      api.get(`/animais/${id}`).then(res => {
        // GET 403 → o interceptor resolve com data null (services/api.ts). Aqui isso
        // significa: o paciente não é da empresa/equipe ATIVA. Sem este aviso a tela
        // ficava vazia e o console enchia de 403 sem explicar nada ao usuário.
        if (res.data) setAnimal(res.data.dados ?? res.data);
        else          setForaDoContexto(true);
      }).catch(() => {}),
      api.get(`/clinica/historico/animal/${id}`).then(res => {
        if (res.data) setHistorico(res.data.dados ?? []);
      }).catch(() => {}),
      carregarAgendamentos(),
    ]).finally(() => setLoading(false));
  }, [id, carregarAgendamentos]);

  const handleConcluirAg = async (agId: number) => {
    try {
      await api.patch(`/clinica/agendamentos/${agId}/status`, { status: 'CONCLUIDO' });
      toast.success('Agendamento concluído');
      carregarAgendamentos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) setErroInline('Erro ao concluir agendamento');
    }
  };

  const handleCancelarAg = async (agId: number, motivo?: string) => {
    // Cancelamento exige justificativa — abre o modal e retorna aqui com o motivo
    if (!motivo) { setCancelandoAgId(agId); return; }
    try {
      await api.patch(`/clinica/agendamentos/${agId}/status`, { status: 'CANCELADO', motivo });
      toast.success('Agendamento cancelado');
      setCancelandoAgId(null);
      carregarAgendamentos();
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) setErroInline('Erro ao cancelar agendamento');
    }
  };

  const handleAbrirDetalhe = async (ev: EventoHistorico) => {
    const parsed = parseEventoId(ev);
    if (!parsed) return;
    setDetalheEv(ev);
    setDetalheRecord(null);
    setDetalheLoading(true);
    try {
      const url = ENDPOINT[parsed.origem](parsed.numId);
      const res = await api.get(url);
      if (!res.data) { setDetalheLoading(false); return; }
      const dados = res.data.dados ?? res.data;
      const tipoDetalhe = (parsed.origem.startsWith('EXAME') ? 'EXAME' : parsed.origem) as DetalheRecord['tipo'];
      setDetalheRecord({ tipo: tipoDetalhe, dados } as DetalheRecord);
    } catch {
      setErroInline('Não foi possível carregar os dados do registro.');
    } finally {
      setDetalheLoading(false);
    }
  };

  const fecharDetalhe = () => {
    setDetalheEv(null);
    setDetalheRecord(null);
  };

  const grupos = useMemo(() => agruparEventos(historico), [historico]);

  // Memória Clínica → registro de origem. O "ref" do tópico casa com o id do
  // histórico; prescrição carrega sufixo de tipo (prescricao-5-MEDICAMENTO),
  // então o prefixo "origem-id" também é aceito como chave.
  const eventoPorRef = useMemo(() => {
    const mapa = new Map<string, EventoHistorico>();
    for (const ev of historico) {
      if (!mapa.has(ev.id)) mapa.set(ev.id, ev);
      const base = ev.id.split('-').slice(0, 2).join('-');
      if (!mapa.has(base)) mapa.set(base, ev);
    }
    return mapa;
  }, [historico]);

  const refsAbriveis = useMemo(() => new Set(eventoPorRef.keys()), [eventoPorRef]);

  const abrirPorRef = (ref: string) => {
    const ev = eventoPorRef.get(ref);
    if (ev) handleAbrirDetalhe(ev);
  };

  const gruposFiltrados = useMemo(() => {
    if (!busca.trim()) return grupos;
    const q = busca.toLowerCase();
    return grupos.filter(g => {
      const ev = g.evolucao;
      const matchEv = ev
        ? (ev.titulo.toLowerCase().includes(q) ||
           ev.resumo.toLowerCase().includes(q) ||
           ev.badge.toLowerCase().includes(q) ||
           (ev.responsavel ?? '').toLowerCase().includes(q))
        : false;
      const matchSub = g.subitems.some(s =>
        s.titulo.toLowerCase().includes(q) ||
        s.resumo.toLowerCase().includes(q) ||
        s.badge.toLowerCase().includes(q)
      );
      return matchEv || matchSub;
    });
  }, [grupos, busca]);

  // Auto-expande grupos cujo sub-item bate na busca
  useEffect(() => {
    if (!busca.trim()) return;
    const q = busca.toLowerCase();
    const toExpand = new Set<string>();
    for (const g of grupos) {
      if (g.subitems.some(s =>
        s.titulo.toLowerCase().includes(q) ||
        s.resumo.toLowerCase().includes(q) ||
        s.badge.toLowerCase().includes(q)
      )) toExpand.add(g.key);
    }
    if (toExpand.size > 0) setExpandidos(toExpand);
  }, [busca, grupos]);

  const toggleExpand = (key: string) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (loading) return (
    <PageContainer maxWidth="7xl">
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if (!animal) return (
    <PageContainer maxWidth="7xl">
      <BotaoVoltar />
      {foraDoContexto ? (
        <div className="text-center py-20 max-w-md mx-auto">
          <Building2 size={40} className="mx-auto mb-4 text-gray-300" />
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Paciente de outra empresa</h2>
          <p className="text-sm text-gray-500">
            Este paciente não pertence à empresa/equipe ativa no momento. Troque a empresa
            no seletor do menu lateral para acessá-lo.
          </p>
          <button onClick={() => navigate('/animais')}
            className="mt-6 px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl text-sm font-semibold transition-colors">
            Ver pacientes desta empresa
          </button>
        </div>
      ) : (
        <div className="text-center py-20 text-red-500">Animal não encontrado</div>
      )}
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
    <div className="space-y-5">

      {/* ── Header — mesmo layout de Meus Pacientes (AnimaisVet) ─────────── */}
      <BotaoVoltar />

      <InlineError message={erroInline} />
      <div className="flex items-center justify-between gap-3 mt-2">
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-gray-900">
          <span className="text-[22px] leading-none">{emojiEspecie(animal.especie?.nome)}</span>
          Detalhamento do Animal
        </h1>
        {/* Tela somente de visualização — criação de agendamento fica na Agenda.
            Transferência de Propriedade é a exceção: ação de GESTOR/ADMIN, regra
            basal (mesma família de "só o gestor transfere agenda", CLAUDE.md §12
            28-b/28-c) — não some por falta de registro, some por falta de cargo. */}
        {podeTransferirPropriedade && animal.ativo !== false && !animal.inativo && (
          <button
            onClick={() => setShowTransferencia(true)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-semibold transition-colors flex-shrink-0">
            <ArrowLeftRight size={14} /> Transferência de Propriedade
          </button>
        )}
      </div>

      {animal.inativo && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3 border bg-amber-50 border-amber-300 text-amber-800">
          <span className="text-lg mt-0.5">🔒</span>
          <div className="flex-1">
            {/* Rótulo "Bloqueado" (não "Inativo"): a tela de Pacientes tem um recurso
                DIFERENTE — a exclusão lógica de Animal.ativo — que também usa a palavra
                "Inativo". Este banner é do BLOQUEIO (Animal.inativo): o paciente segue
                visível em toda tela, só trava novos registros/edição. */}
            <p className="font-semibold text-sm">Paciente bloqueado — somente leitura</p>
            <p className="text-xs mt-0.5">
              Nenhum registro novo pode ser criado nem o cadastro editado enquanto durar.
              {animal.inativoMotivo && <> Motivo: “{animal.inativoMotivo}”.</>}
              {animal.inativoPor?.fullName && <> Bloqueado por {animal.inativoPor.fullName}.</>}
              {' '}Só o gestor pode desbloquear.
            </p>
          </div>
        </div>
      )}

      {/* Header — dados do animal */}
      <HeaderAnimal animal={animal} />

      {/* Histórico + Agendamentos */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch">

        {/* Histórico */}
        <div className="flex-1 min-w-0 w-full bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <span className="w-1 h-5 bg-emerald-500 rounded-full" />
              <h2 className="font-bold text-gray-900">Histórico</h2>
            </div>
            <div className="relative w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
                placeholder="Buscar no histórico do animal..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-full text-sm text-gray-900 focus:outline-none focus:border-emerald-500 bg-gray-50/50" />
            </div>
          </div>

          <div className="p-3 sm:p-4 space-y-2.5">
            {gruposFiltrados.length === 0 ? (
              <p className="text-center text-sm text-gray-300 py-12">
                {historico.length === 0 ? 'Nenhum registro no histórico ainda' : 'Nenhum resultado para a busca'}
              </p>
            ) : gruposFiltrados.map(g => (
              <GrupoHistoricoItem
                key={g.key}
                grupo={g}
                expandido={expandidos.has(g.key)}
                onToggle={toggleExpand}
                onClickEvento={handleAbrirDetalhe}
              />
            ))}
          </div>
        </div>

        {/* Memória Clínica do Paciente (IA) */}
        <MemoriaClinicaPanel
          memoria={memoriaIA}
          atualizando={atualizandoResumo}
          onAbrirRef={abrirPorRef}
          refsAbriveis={refsAbriveis}
        />

        {/* Agendamentos */}
        <div className="w-full lg:w-80 flex-shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-50 rounded-xl flex items-center justify-center">
                <CalendarClock size={15} className="text-emerald-600" />
              </div>
              <h2 className="font-bold text-gray-900 text-sm">Agendamentos</h2>
            </div>
            {/* Criação de agendamento não é feita por aqui — usar a tela de Agenda */}
          </div>
          <div className="p-3 space-y-2.5 flex-1 min-h-0 max-h-[60vh] lg:max-h-none overflow-y-auto">
            {agendamentos.length === 0 ? (
              <p className="text-center text-sm text-gray-300 py-10">Nenhum agendamento futuro</p>
            ) : agendamentos.map(ag => (
              <CardAgendamento key={ag.id} ag={ag}
                podeGerenciar={false}  // tela somente de visualização — gerenciar na Agenda
                onConcluir={handleConcluirAg}
                onCancelar={handleCancelarAg} />
            ))}
          </div>
        </div>
      </div>

      {/* Gráficos — peso ao longo do tempo + evolução de um parâmetro de exame */}
      <GraficosAnimalPanel animalId={String(animal.id)} />

      {/* Modais */}
      {detalheEv && (
        <DetalheModal
          ev={detalheEv}
          detalhe={detalheRecord}
          loading={detalheLoading}
          onFechar={fecharDetalhe}
        />
      )}

      <ModalJustificativa
        aberto={cancelandoAgId !== null}
        titulo="Cancelar agendamento?"
        acaoLabel="Cancelar agendamento"
        onConfirmar={(motivo) => { if (cancelandoAgId !== null) handleCancelarAg(cancelandoAgId, motivo); }}
        onFechar={() => setCancelandoAgId(null)}
      />

      {showTransferencia && id && (
        <ProprietarioFormModal
          modoTransferencia={{
            animalId: Number(id),
            onConcluido: (animalAtualizado) => {
              // O toast de sucesso já é disparado pelo próprio modal.
              setAnimal(animalAtualizado as AnimalData);
            },
          }}
          onClose={() => setShowTransferencia(false)}
        />
      )}
    </div>
    </PageContainer>
  );
};

export default AnimalDetail;
