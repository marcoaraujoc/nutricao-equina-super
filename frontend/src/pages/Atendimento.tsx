// src/pages/Atendimento.tsx
// Shell clínico — delega cada sub-aba ao seu módulo dedicado

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import { useEmpresa } from '../contexts/EmpresaContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import {
  X, Loader2,
  FileText, Pill, Syringe, FlaskConical, Share2,
  History, Search, CalendarDays, CircleDot, ChevronDown, Printer, Pencil, Eye,
  CheckCircle2,
} from 'lucide-react';
import AnimalCard  from '../components/AnimalCard';
import BotaoVoltar from '../components/BotaoVoltar';
import PageContainer from '../components/PageContainer';
import SeletorAnimalInteligente from '../components/SeletorAnimalInteligente';
import ConfirmModal from '../components/ConfirmModal';
import SubModuloEvolucao from './SubModuloEvolucao';
import SubModuloPrescricao from './SubModuloPrescricao';
import SubModuloExames from './SubModuloExames';
import SubModuloEncaminhamento from './SubModuloEncaminhamento';
import Agendamentos from './Agendamentos';
import { imprimirAtendimento, gerarHtmlAtendimento, type PrintAtendimento, type PrintAnimal, type PrintAtendimentoItem } from '../utils/AtendimentoPrint';
import InlineError from '../components/InlineError';
import { formatDataHora } from '../utils/dateUtils';
import { escolherEvolucaoAtiva, lerEvolucaoSelecionada, salvarEvolucaoSelecionada } from '../utils/evolucaoAtiva';


// ─── Types ────────────────────────────────────────────────────────────────────

type SelectedAnimal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;

type AnimalExtended = SelectedAnimal & {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
  baia?:           string | null;
  raca?:           { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
  logoUrl?:        string | null;
  /**
   * Paciente INATIVO — prontuário CONGELADO na data/hora da inativação.
   * ⚠️ Nada a ver com `ativo` (exclusão lógica, em que o paciente SOME de tudo):
   * aqui ele continua aparecendo inteiro, só que em somente leitura.
   * Vem de `GET /animais/:id` (`anexarInativo`, backend/src/lib/animalInativo.js).
   */
  inativo?:        boolean;
  inativoEm?:      string | null;
  inativoMotivo?:  string | null;
  inativoPor?:     { fullName: string } | null;
};

interface EvolucaoAtiva {
  id:               number;
  numero:           number | null;
  tipoAtendimento:  string | null;
  atendimentoNumero: string | null;
  // Quem conduz — decide se o banner pode oferecer "Finalizar Atendimento".
  veterinarioId:    number | null;
  // Agendamento de origem: é o que PROVA que duas evoluções abertas do mesmo animal
  // (mesmo com o mesmo profissional) são consultas DISTINTAS — ver CLAUDE.md,
  // sessão 2026-08-18 parte 3. null = evolução avulsa (EV-XXXX).
  agendamentoId?:   number | null;
  // Rótulo do banner: "Atendimento AG-0013 de 25/08/2026 17:11 - Consulta clínica
  // geral - Em andamento". O título é gerado pela IA ao finalizar, então enquanto o
  // atendimento corre normalmente só há a especialidade — daí o fallback.
  dataInicio?:      string | null;
  titulo?:          string | null;
  especialidade?:   string | null;
}

type SubModulo  = 'agenda' | 'evolucao' | 'prescricao' | 'vacina' | 'exames' | 'encaminhamento';

interface ResumoHistoricoItem {
  id:                string;
  origem:            string;
  data:              string;
  titulo:            string;
  badge:             string;
  status?:           string | null;
  responsavel:       string | null;
  veterinarioId?:    number | null;
  resumo:            string;
  evolucaoId:        number | null;
  dataFim?:          string | null;
  atendimentoNumero?: string | null;
}

interface GrupoResumoHistorico {
  key:      string;
  data:     string;
  evolucao: ResumoHistoricoItem | null;
  subitems: ResumoHistoricoItem[];
}

// Formato do item de PrescricaoGrupo retornado por GET /clinica/prescricoes/grupos/:id
interface PrescricaoGrupoItemRaw {
  tipo:        string;
  medicamento: string;
  dosagem:     string | null;
  unidade:     string | null;
  via:         string;
  frequencia:  string;
  duracaoDias: number;
  observacao:  string | null;
}

// Agrupa os eventos pelo vínculo real evolucaoId — um atendimento (AG-XXXX/EV-XXXX)
// aparece como cabeçalho, com a evolução e seus filhos (prescrição, exame, etc.)
// listados abaixo. Itens sem evolução vinculada (ex: vacina avulsa) ficam soltos.
function agruparHistoricoResumido(itens: ResumoHistoricoItem[]): GrupoResumoHistorico[] {
  const evolucoes = itens.filter(i => i.origem === 'EVOLUCAO');
  const outros     = itens.filter(i => i.origem !== 'EVOLUCAO');
  const evolucaoIds = new Set(evolucoes.map(e => e.evolucaoId));

  const subPorEvolucao = new Map<number, ResumoHistoricoItem[]>();
  const avulsos: ResumoHistoricoItem[] = [];
  for (const item of outros) {
    if (item.evolucaoId != null && evolucaoIds.has(item.evolucaoId)) {
      if (!subPorEvolucao.has(item.evolucaoId)) subPorEvolucao.set(item.evolucaoId, []);
      subPorEvolucao.get(item.evolucaoId)!.push(item);
    } else {
      avulsos.push(item);
    }
  }

  const grupos: GrupoResumoHistorico[] = evolucoes.map(ev => ({
    key:      ev.id,
    data:     ev.data,
    evolucao: ev,
    subitems: subPorEvolucao.get(ev.evolucaoId!) ?? [],
  }));

  for (const item of avulsos) {
    grupos.push({ key: item.id, data: item.data, evolucao: null, subitems: [item] });
  }

  grupos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
  return grupos;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// A VACINA saiu daqui: virou tela apartada (`pages/Vacina.tsx`, rota /clinica/vacina).
// 'vacina' continua existindo no tipo `SubModulo` porque ainda é um DESTINO de
// navegação — o Histórico do Paciente leva para lá —, mas não é mais uma aba.
const SUB_MODULOS: { key: SubModulo; label: string; icon: React.ReactNode }[] = [
  { key: 'agenda',         label: 'Agenda',          icon: <CalendarDays size={15} /> },
  { key: 'evolucao',       label: 'Evolução',       icon: <FileText     size={15} /> },
  { key: 'prescricao',     label: 'Prescrição',     icon: <Pill         size={15} /> },
  { key: 'exames',         label: 'Exames',         icon: <FlaskConical size={15} /> },
  { key: 'encaminhamento', label: 'Encaminhamento', icon: <Share2       size={15} /> },
];

// Cabeçalho de página por submódulo (ícone em box + título + descritivo —
// mesmo padrão de Agendamentos). O título acompanha a aba ativa.
const HEADER_SUBMODULO: Record<SubModulo, { titulo: string; descricao: string; icon: React.ReactNode }> = {
  agenda:         { titulo: 'Minha Agenda',     descricao: 'Agendamentos e atendimentos do dia do profissional.',      icon: <CalendarDays size={20} className="text-emerald-700" /> },
  evolucao:       { titulo: 'Evolução Clínica', descricao: 'Prontuário e registros de evolução do paciente.',          icon: <FileText     size={20} className="text-emerald-700" /> },
  prescricao:     { titulo: 'Prescrição',       descricao: 'Medicamentos e procedimentos prescritos ao paciente.',     icon: <Pill         size={20} className="text-emerald-700" /> },
  vacina:         { titulo: 'Vacinas',          descricao: 'Registro e histórico vacinal do paciente.',                icon: <Syringe      size={20} className="text-emerald-700" /> },
  exames:         { titulo: 'Pedido de Exames', descricao: 'Solicitação e acompanhamento de exames do paciente.',      icon: <FlaskConical size={20} className="text-emerald-700" /> },
  encaminhamento: { titulo: 'Encaminhamento',   descricao: 'Encaminhamentos a prestadores e serviços externos.',       icon: <Share2       size={20} className="text-emerald-700" /> },
};

const ORIGEM_COLOR: Record<string, string> = {
  EVOLUCAO:        'bg-emerald-100 text-emerald-700',
  VACINA:          'bg-teal-100 text-teal-700',
  EXAME:           'bg-purple-100 text-purple-700',
  EXAME_LAB:       'bg-blue-100 text-blue-700',
  EXAME_IMG:       'bg-sky-100 text-sky-700',
  EXAME_BIO:       'bg-violet-100 text-violet-700',
  EXAME_COMPRA:    'bg-amber-100 text-amber-700',
  PRESCRICAO:      'bg-blue-100 text-blue-700',
  ENCAMINHAMENTO:  'bg-orange-100 text-orange-700',
};

// Origens cuja data vem de um <input type="date"> (sem horário — salva como meia-noite
// UTC). Exibir com o fuso do navegador jogaria para o dia anterior; formatar em UTC
// mantém a data que o usuário escolheu.
const ORIGEM_DATA_SEM_HORA = new Set(['VACINA', 'EXAME', 'EXAME_LAB', 'EXAME_IMG', 'EXAME_BIO', 'EXAME_COMPRA']);

// ─── SubMenuClinico ───────────────────────────────────────────────────────────

function SubMenuClinico({ activeTab, onChange }: {
  activeTab: SubModulo;
  onChange:  (t: SubModulo) => void;
}) {
  return (
    <div className="flex overflow-x-auto gap-1 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
      {SUB_MODULOS.map(m => (
        <button key={m.key} onClick={() => onChange(m.key)}
          className={`flex items-center gap-1.5 px-3 py-2 text-[15px] font-medium rounded-t-xl whitespace-nowrap transition-colors flex-shrink-0 ${
            activeTab === m.key
              ? 'bg-white text-emerald-700 border border-gray-100 border-b-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
          }`}>
          {m.icon}{m.label}
        </button>
      ))}
    </div>
  );
}

// ─── HistoricoResumidoPanel ───────────────────────────────────────────────────

const ORIGEM_TO_TAB: Record<string, SubModulo> = {
  EVOLUCAO:       'evolucao',
  VACINA:         'vacina',
  EXAME:          'exames',
  EXAME_LAB:      'exames',
  EXAME_IMG:      'exames',
  EXAME_BIO:      'exames',
  EXAME_COMPRA:   'exames',
  PRESCRICAO:     'prescricao',
  ENCAMINHAMENTO: 'encaminhamento',
};

function HistoricoItemRow({ item, indent, onClick }: {
  item:    ResumoHistoricoItem;
  indent?: boolean;
  onClick: () => void;
}) {
  const data = new Date(item.data).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit',
    ...(ORIGEM_DATA_SEM_HORA.has(item.origem) ? { timeZone: 'UTC' } : {}),
  });
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-0 text-left hover:bg-emerald-50/50 rounded-lg px-1 transition-colors group ${indent ? 'pl-3' : ''}`}
    >
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${ORIGEM_COLOR[item.origem] ?? 'bg-gray-100 text-gray-600'}`}>
        {data}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-800 truncate group-hover:text-emerald-700 transition-colors">{item.titulo}</p>
        {item.resumo && (
          <p className="text-[11px] text-gray-400 truncate mt-0.5">{item.resumo}</p>
        )}
      </div>
    </button>
  );
}

function HistoricoResumidoPanel({
  animalId,
  animal,
  refreshKey,
  onItemClick,
  onEditClick,
  podeEditarEvolucao,
  podeImprimir,
}: {
  animalId:    number;
  animal:      AnimalExtended | null;
  refreshKey:  number;
  onItemClick: (tab: SubModulo, itemId: number) => void;
  onEditClick: (grupo: GrupoResumoHistorico) => void;
  podeEditarEvolucao: (ev: ResumoHistoricoItem) => boolean;
  podeImprimir: boolean;
}) {
  const [itens,             setItens]             = useState<ResumoHistoricoItem[]>([]);
  const [carregando,        setCarregando]        = useState(false);
  const [expandidos,        setExpandidos]        = useState<Set<string>>(new Set());
  const [busca,             setBusca]             = useState('');
  const [previewAtendimento, setPreviewAtendimento] = useState<PrintAtendimento | null>(null);

  useEffect(() => {
    if (!animalId) return;
    const termo = busca.trim();
    setCarregando(true);
    // Busca server-side: com termo, o backend filtra por palavra em TODO o
    // histórico; sem termo, retorna apenas os 10 registros mais recentes.
    const t = setTimeout(() => {
      const params = termo ? { busca: termo } : { limit: 10 };
      api.get(`/clinica/historico/animal/${animalId}`, { params })
        .then(res => { if (res.data) setItens(res.data.dados ?? []); })
        .catch(() => {})
        .finally(() => setCarregando(false));
    }, termo ? 300 : 0);
    return () => clearTimeout(t);
  }, [animalId, refreshKey, busca]);

  const grupos = agruparHistoricoResumido(itens);
  // A filtragem é feita no backend (params.busca). `termo` aqui só controla a UI:
  // expandir os grupos durante a busca e a mensagem de "sem resultado".
  const termo = busca.trim();
  const clicar = (item: ResumoHistoricoItem) => {
    const tab = ORIGEM_TO_TAB[item.origem];
    if (tab) onItemClick(tab, parseInt(item.id.split('-')[1]));
  };
  const toggleExpandido = (key: string) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const printAnimal: PrintAnimal | null = animal
    ? { nome: animal.nome, photoUrl: animal.photoUrl, raca: animal.raca, user: animal.user, idadeAnos: animal.idadeAnos, logoUrl: animal.logoUrl }
    : null;

  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);

  // Monta o objeto de impressão/visualização do atendimento. Para itens de
  // PRESCRICAO, busca o grupo completo (com dosagem/via/frequência/duração de
  // cada medicamento) — o resumo do histórico só traz os nomes dos remédios.
  const montarPrintAtendimento = async (grupo: GrupoResumoHistorico): Promise<PrintAtendimento | null> => {
    if (!grupo.evolucao) return null;

    const itensPrint: PrintAtendimentoItem[] = await Promise.all(
      [grupo.evolucao, ...grupo.subitems].map(async (it): Promise<PrintAtendimentoItem> => {
        const base: PrintAtendimentoItem = {
          origem: it.origem, badge: it.badge, titulo: it.titulo,
          resumo: it.resumo, responsavel: it.responsavel, data: it.data,
        };
        if (it.origem === 'PRESCRICAO') {
          const grupoId = parseInt(it.id.split('-')[1]);
          try {
            const res = await api.get(`/clinica/prescricoes/grupos/${grupoId}`);
            const itensGrupo = (res.data?.dados?.itens ?? []) as PrescricaoGrupoItemRaw[];
            base.prescricaoItens = itensGrupo.map(m => ({
              tipo: m.tipo, medicamento: m.medicamento, dosagem: m.dosagem, unidade: m.unidade,
              via: m.via, frequencia: m.frequencia, duracaoDias: m.duracaoDias, observacao: m.observacao,
            }));
          } catch { /* mantém o resumo simples em caso de falha */ }
        }
        return base;
      }),
    );

    return { atendimentoNumero: grupo.evolucao.atendimentoNumero ?? 'EV-', itens: itensPrint };
  };

  const handleImprimir = async (grupo: GrupoResumoHistorico) => {
    setGerandoRelatorio(true);
    try {
      const at = await montarPrintAtendimento(grupo);
      if (at) imprimirAtendimento(at, printAnimal);
    } finally { setGerandoRelatorio(false); }
  };

  const handleVisualizar = async (grupo: GrupoResumoHistorico) => {
    setGerandoRelatorio(true);
    try {
      const at = await montarPrintAtendimento(grupo);
      if (at) setPreviewAtendimento(at);
    } finally { setGerandoRelatorio(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <History size={15} className="text-emerald-600" />
        <span className="font-semibold text-sm text-gray-900">Histórico do Paciente</span>
      </div>

      <div className="px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar no histórico..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 bg-white transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {carregando ? (
          <div className="flex justify-center py-10">
            <Loader2 size={20} className="animate-spin text-emerald-600" />
          </div>
        ) : itens.length === 0 ? (
          <p className="text-center text-gray-300 text-xs py-10">
            {termo ? `Nenhum resultado para “${termo}”` : 'Nenhum registro encontrado'}
          </p>
        ) : (
          <div className="px-3 space-y-2">
            {grupos.map(grupo => {
              // Avulso (sem evolução vinculada) — item único, sem cabeçalho AG-/EV-
              if (!grupo.evolucao) {
                const item = grupo.subitems[0];
                return <HistoricoItemRow key={grupo.key} item={item} onClick={() => clicar(item)} />;
              }
              const ev          = grupo.evolucao;
              const emAndamento = ev.status === 'EM_ANDAMENTO';
              const expandido   = expandidos.has(grupo.key) || !!termo;
              const totalItens  = (emAndamento ? 0 : 1) + grupo.subitems.length; // evolução (se finalizada) + filhos
              return (
                <div key={grupo.key}>
                  <div className="flex items-center gap-1 px-1 pb-1">
                    <button
                      onClick={() => toggleExpandido(grupo.key)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                    >
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded font-mono tracking-wider flex-shrink-0">
                        {ev.atendimentoNumero ?? 'EV-'}
                      </span>
                      {emAndamento ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          <Loader2 size={9} className="animate-spin" /> Em andamento
                        </span>
                      ) : ev.dataFim && (
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {new Date(ev.dataFim).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400 truncate">{totalItens} registro{totalItens !== 1 ? 's' : ''}</span>
                      <ChevronDown size={12} className={`text-gray-400 flex-shrink-0 transition-transform ${expandido ? 'rotate-180' : ''}`} />
                    </button>
                    {!emAndamento && podeImprimir && (
                      <button onClick={() => handleImprimir(grupo)} disabled={gerandoRelatorio} title="Imprimir atendimento"
                        className="p-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
                        {gerandoRelatorio ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                      </button>
                    )}
                    {!emAndamento && ev.evolucaoId != null && (
                      <button onClick={() => handleVisualizar(grupo)} disabled={gerandoRelatorio} title="Visualizar atendimento"
                        className="p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
                        {gerandoRelatorio ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                      </button>
                    )}
                    {ev.evolucaoId != null && podeEditarEvolucao(ev) && (
                      <button onClick={() => onEditClick(grupo)} title={emAndamento ? 'Continuar atendimento' : 'Editar atendimento'}
                        className="p-1 text-orange-600 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors flex-shrink-0">
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>
                  {expandido && (
                    <div className="border-l-2 border-emerald-100 ml-2">
                      {!emAndamento && <HistoricoItemRow item={ev} indent onClick={() => clicar(ev)} />}
                      {grupo.subitems.map(sub => (
                        <HistoricoItemRow key={sub.id} item={sub} indent onClick={() => clicar(sub)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewAtendimento && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 lg:p-4"
          onClick={() => setPreviewAtendimento(null)}>
          {/* Celular e tablet (iPad): quase tela cheia. Desktop (lg+): folha A4. */}
          <div className="bg-white rounded-2xl shadow-xl w-full h-full lg:w-[794px] lg:h-[90vh] lg:max-h-[1123px] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
              <span className="font-bold text-gray-900 text-sm">
                Atendimento {previewAtendimento.atendimentoNumero}
              </span>
              <div className="flex items-center gap-2">
                {podeImprimir && (
                  <button onClick={() => imprimirAtendimento(previewAtendimento, printAnimal)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                    <Printer size={13} /> Imprimir
                  </button>
                )}
                <button onClick={() => setPreviewAtendimento(null)} className="p-1 text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            </div>
            <iframe
              title="Pré-visualização do atendimento"
              srcDoc={gerarHtmlAtendimento(previewAtendimento, printAnimal)}
              className="flex-1 w-full rounded-b-2xl"
              style={{ border: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tabFromPath(pathname: string): SubModulo {
  if (pathname.includes('/agenda'))         return 'agenda';
  if (pathname.includes('/prescricao'))     return 'prescricao';
  if (pathname.includes('/vacina'))         return 'vacina';
  if (pathname.includes('/exames'))         return 'exames';
  if (pathname.includes('/encaminhamento')) return 'encaminhamento';
  return 'evolucao';
}

// ─── Atendimento ──────────────────────────────────────────────────────────────

const Atendimento = () => {
  const { setSelectedAnimal, selectedAnimal, refreshSelectedAnimal } = useSelectedAnimal();
  const { user }                              = useAuth();
  const { podeExecutar, isGestor, permissoes } = usePermissoes();
  const { contextoAtivo, loading: empresaLoading } = useEmpresa();
  const navigate                              = useNavigate();
  const location                              = useLocation();
  const { animalId: animalIdParam }           = useParams<{ animalId?: string }>();

  const podeFinalizarEvolucao = isGestor || podeExecutar('atendimento.evolucoes.finalizar');
  const podeImprimirEvolucao  = isGestor || podeExecutar('atendimento.evolucoes.imprimir');
  // FORNECEDOR: regra de autoria — só finaliza a evolução que ele próprio criou
  const isFornecedor = user?.userType === 'FORNECEDOR';

  // AUTORIA (CLAUDE.md 28-c): finalizar vale sobre o atendimento que a pessoa conduz —
  // o que ela criou ou ASSUMIU. Ter a permissão não basta: enquanto a evolução for de
  // outro profissional, o caminho é ASSUMIR (aba Evolução), e só então finalizar.
  // Sem este recorte o banner oferecia o Finalizar do atendimento alheio, e o clique
  // morria em 403 do backend — que já aplica a mesma regra.
  const evolucaoAtivaEhMinha = (ev: EvolucaoAtiva | null) =>
    !!ev && (isGestor || ev.veterinarioId === (user?.id ?? 0));

  // Botão "Editar" do Histórico do Paciente: MESMA regra do Histórico de Evolução
  // Clínica (SubModuloEvolucao) — antes o painel mostrava "Editar" sem checagem de
  // autoria/permissão, divergindo da aba de evolução. Agora reflete as mesmas ações.
  const podeEditarEvolucaoHist = (ev: ResumoHistoricoItem): boolean => {
    const nivelEditar   = isGestor ? 'FULL' : (permissoes['atendimento.evolucoes.editar'] ?? 'NENHUM');
    const eProprioAutor = ev.veterinarioId != null && ev.veterinarioId === (user?.id ?? 0);
    const podeEditarEsta = isFornecedor
      ? (nivelEditar !== 'NENHUM' && eProprioAutor)
      : (nivelEditar === 'FULL' || ((nivelEditar === 'EQUIPE' || nivelEditar === 'PROPRIO') && eProprioAutor));
    return (ev.status === 'EM_ANDAMENTO' && podeEditarEsta) || (isGestor && ev.status === 'FINALIZADA');
  };

  const effectiveAnimalId = animalIdParam || selectedAnimal?.id?.toString();

  // Persiste o agendamentoId entre navegações e re-logins (localStorage por animal).
  // Recalculado a cada mudança de location.search/animalId — não pode ser um useState
  // inicializado uma única vez, pois /clinica/agenda e /clinica/evolucao/:animalId
  // renderizam o MESMO componente <Atendimento />, então navegar entre eles (ex: botão
  // "Iniciar" da agenda) não remonta o componente, só troca a rota.
  const [agendamentoIdFromUrl, setAgendamentoIdFromUrl] = useState<number | undefined>();
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('agendamentoId');
    if (fromUrl && animalIdParam) {
      localStorage.setItem(`s2vet_ag_${animalIdParam}`, fromUrl);
      setAgendamentoIdFromUrl(Number(fromUrl));
      // Chegar com o agendamento na URL é ato EXPLÍCITO (o "Iniciar" da agenda) e
      // vence uma escolha anterior no banner: é este o atendimento de agora. Sem
      // isto, iniciar a segunda consulta do dia deixaria o shell preso na primeira.
      setEvolucaoSelecionadaId(null);
      salvarEvolucaoSelecionada(animalIdParam, null);
      return;
    }
    if (animalIdParam) {
      const stored = localStorage.getItem(`s2vet_ag_${animalIdParam}`);
      if (stored) { setAgendamentoIdFromUrl(Number(stored)); return; }
    }
    setAgendamentoIdFromUrl(undefined);
  }, [location.search, animalIdParam]);

  const [animal,          setAnimal]          = useState<AnimalExtended | null>(null);
  const [todosAnimais,    setTodosAnimais]    = useState<AnimalExtended[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [activeTab,       setActiveTab]       = useState<SubModulo>(() => tabFromPath(location.pathname));
  const [showHistoricoM,  setShowHistoricoM]  = useState(false);
  // TODAS as evoluções EM ANDAMENTO do paciente — o mesmo animal pode ter mais de uma
  // (consultas distintas no mesmo dia), e o banner as lista para o usuário ESCOLHER
  // qual está conduzindo agora. É a escolha que decide a que atendimento prescrição,
  // exame, encaminhamento e vacina lançados nas abas se vinculam.
  const [evolucoesAbertas,      setEvolucoesAbertas]      = useState<EvolucaoAtiva[]>([]);
  const [evolucaoSelecionadaId, setEvolucaoSelecionadaId] = useState<number | null>(null);
  const [historicoKey,    setHistoricoKey]    = useState(0);
  const [openItemId,        setOpenItemId]        = useState<number | null>(null);
  // Abre uma evolução específica vinda de FORA do shell (hoje: o número do atendimento
  // clicável na fatura — Financeiro > Faturamento). `openItemId` é ESTADO, e quem chega
  // por link não tem como setá-lo: o item viaja na URL, mesma razão do `?item=` da
  // Vacina. Parâmetro PRÓPRIO (`?evolucao=`) para não colidir com o `?item=` da tela
  // apartada de Vacina, que é outro registro em outra tela.
  useEffect(() => {
    const alvo = new URLSearchParams(location.search).get('evolucao');
    if (alvo) setOpenItemId(Number(alvo));
  }, [location.search]);
  const [editEvolucaoId,    setEditEvolucaoId]    = useState<number | null>(null);
  const [editPrescricaoId,  setEditPrescricaoId]  = useState<number | null>(null);
  // Itens do atendimento pendentes de abrir em VISUALIZAÇÃO (somente leitura)
  // em cada aba — setados pelos botões Visualizar/Editar do Histórico de
  // Evolução Clínica e consumidos quando a aba correspondente é aberta.
  const [viewPrescricaoId,  setViewPrescricaoId]  = useState<number | null>(null);
  const [viewExameId,       setViewExameId]       = useState<number | null>(null);
  // Finalizar Atendimento (banner) — mesma ação do Finalizar da aba Evolução
  const [confirmFinalizarAt, setConfirmFinalizarAt] = useState(false);
  const [finalizandoAt,      setFinalizandoAt]      = useState(false);
  // Remonta a aba Evolução após finalizar pelo banner (recarrega a lista e limpa o form)
  const [evolucaoTabKey,     setEvolucaoTabKey]     = useState(0);

  // A evolução ATIVA é DERIVADA, nunca um estado à parte: guardar as duas coisas
  // (lista + ativa) deixaria a ativa apontando para uma evolução que já foi
  // finalizada/cancelada por outra aba. Regra em `utils/evolucaoAtiva.ts`.
  const evolucaoAtiva = useMemo(
    () => escolherEvolucaoAtiva(evolucoesAbertas, {
      selecionadaId: evolucaoSelecionadaId,
      agendamentoId: agendamentoIdFromUrl ?? null,
      meuUserId:     user?.id ?? null,
    }),
    [evolucoesAbertas, evolucaoSelecionadaId, agendamentoIdFromUrl, user?.id],
  );

  // Texto do banner em uma string só — é o `title` da faixa: no mobile ela é cortada
  // com "…" (uma linha), então o texto inteiro precisa continuar alcançável.
  const rotuloAtendimentoAtivo = useMemo(() => {
    if (!evolucaoAtiva) return '';
    const nome = evolucaoAtiva.titulo?.trim() || evolucaoAtiva.especialidade;
    return [
      `Atendimento ${evolucaoAtiva.atendimentoNumero ?? '—'}`,
      evolucaoAtiva.dataInicio ? `de ${formatDataHora(evolucaoAtiva.dataInicio)}` : null,
    ].filter(Boolean).join(' ') + (nome ? ` - ${nome}` : '') + ' - Em andamento';
  }, [evolucaoAtiva]);

  // Atendimento escolhido que FECHOU (finalizado/cancelado, aqui ou por outro
  // profissional): a escolha morre com ele e a decisão volta ao automático.
  // `escolherEvolucaoAtiva` já ignora o id órfão — isto só evita que ele fique
  // guardado no localStorage. Guardado por `length > 0` para não apagar a escolha
  // enquanto a lista ainda está sendo carregada (ela nasce vazia).
  useEffect(() => {
    if (evolucaoSelecionadaId == null || evolucoesAbertas.length === 0) return;
    if (evolucoesAbertas.some(e => e.id === evolucaoSelecionadaId)) return;
    setEvolucaoSelecionadaId(null);
    salvarEvolucaoSelecionada(effectiveAnimalId, null);
  }, [evolucoesAbertas, evolucaoSelecionadaId, effectiveAnimalId]);

  // Escolha explícita no banner. Persistida por paciente porque o shell é DESMONTADO
  // ao navegar para as telas apartadas (Vacina, Execução de Prescrição) — voltar de lá
  // sem isso reabriria em outro atendimento.
  const selecionarEvolucao = useCallback((id: number) => {
    setEvolucaoSelecionadaId(id);
    salvarEvolucaoSelecionada(effectiveAnimalId, id);
    // Limpa o que estava aberto em visualização do atendimento ANTERIOR: prescrição e
    // exame carregados ali não pertencem ao atendimento recém-escolhido.
    setViewPrescricaoId(null);
    setViewExameId(null);
  }, [effectiveAnimalId]);

  // A aba Evolução sabe antes do shell quando uma evolução nasce, é assumida,
  // finalizada ou cancelada — por isso ela reporta a LISTA inteira a cada recarga
  // (fonte da verdade) e, à parte, a evolução recém-CRIADA.
  // ⚠️ As duas precisam ser estáveis (`useCallback` sem dependência instável): elas
  // entram nas dependências do `carregarEvolucoes` do submódulo, e identidade nova a
  // cada render fecha um laço de requisições (o 429 documentado no CLAUDE.md).
  const handleEvolucoesAbertasChange = useCallback((abertas: EvolucaoAtiva[]) => {
    setEvolucoesAbertas(abertas);
  }, []);

  // Quem acabou de abrir o atendimento está conduzindo ELE: a evolução nova entra
  // selecionada, senão a prescrição lançada em seguida se vincularia à consulta
  // anterior que continua aberta em paralelo.
  const handleEvolucaoCriada = useCallback((ev: EvolucaoAtiva) => {
    setEvolucoesAbertas(prev => prev.some(e => e.id === ev.id)
      ? prev.map(e => (e.id === ev.id ? { ...e, ...ev } : e))
      : [ev, ...prev]);
    setEvolucaoSelecionadaId(ev.id);
    salvarEvolucaoSelecionada(effectiveAnimalId, ev.id);
  }, [effectiveAnimalId]);

  const refreshHistorico = () => setHistoricoKey(k => k + 1);

  const handleFinalizarAtendimento = async () => {
    if (!evolucaoAtiva) return;
    setConfirmFinalizarAt(false);
    setFinalizandoAt(true);
    const evolucaoId = evolucaoAtiva.id;
    try {
      const res = await api.get(`/clinica/evolucoes/${evolucaoId}`);
      const ev = res.data?.dados as { especialidade: string; texto: string | null; veterinarioId: number } | undefined;
      if (!ev) { setErroInline('Não foi possível carregar a evolução do atendimento'); return; }
      // Autoria vale para TODO perfil, não só FORNECEDOR (o recorte por userType era
      // resquício da regra antiga). Relido do servidor de propósito: entre carregar o
      // banner e clicar, outra pessoa pode ter assumido o atendimento.
      if (!isGestor && ev.veterinarioId !== (user?.id ?? 0)) {
        setErroInline('Este atendimento é conduzido por outro profissional. Assuma a evolução antes de finalizá-la.');
        return;
      }
      if (!ev.texto?.trim()) {
        setErroInline('O texto da evolução é obrigatório. Preencha a evolução antes de finalizar o atendimento.');
        return;
      }
      await api.put(`/clinica/evolucoes/${evolucaoId}`, {
        especialidade: ev.especialidade,
        texto:         ev.texto,
        status:        'FINALIZADA',
      });
      toast.success('Atendimento finalizado!');
      // Só o atendimento finalizado sai da lista — os outros em paralelo continuam
      // abertos, e a escolha cai no automático quando era ELE o selecionado.
      setEvolucoesAbertas(prev => prev.filter(e => e.id !== evolucaoId));
      if (evolucaoSelecionadaId === evolucaoId) {
        setEvolucaoSelecionadaId(null);
        salvarEvolucaoSelecionada(effectiveAnimalId, null);
      }
      refreshHistorico();
      setEvolucaoTabKey(k => k + 1);

      // Título sugerido pela LLM — mesmo best-effort do Finalizar da aba Evolução
      api.post('/clinica/evolucoes/interpretar', { texto: ev.texto })
        .then(llmRes => {
          const titulo = (llmRes.data?.dados as { titulo?: string } | undefined)?.titulo;
          if (!titulo) return;
          return api.patch(`/clinica/evolucoes/${evolucaoId}/titulo`, { titulo })
            .then(() => refreshHistorico());
        })
        .catch(() => { /* não-crítico */ });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { mensagem?: string } } })?.response?.data?.mensagem;
      setErroInline(msg ?? 'Erro ao finalizar atendimento');
    } finally { setFinalizandoAt(false); }
  };

  // Visualizar/Editar do Histórico de Evolução Clínica: carrega cada registro
  // vinculado ao atendimento na sua página correspondente. A evolução em si é
  // aberta pelo próprio SubModuloEvolucao (populada em leitura ou edição); aqui
  // resolvemos prescrição/exame buscando nas listas de cada módulo pelo
  // evolucaoId (o histórico unificado filtra por status e esconderia, p.ex.,
  // prescrição ainda em SALVO). Visualizar → tudo somente leitura; Editar →
  // prescrição abre no formulário de edição (o que já foi executado permanece
  // somente leitura pelas regras de status existentes); o exame não tem formulário
  // de edição — abre sempre em visualização. A VACINA não entra: tem tela apartada.
  const carregarAtendimentoNasPaginas = useCallback(async (evolucaoId: number, modo: 'visualizar' | 'editar') => {
    if (!effectiveAnimalId) return;
    type ComEvolucao = { id: number; evolucaoId?: number | null };
    const [prescRes, exameRes] = await Promise.allSettled([
      api.get(`/clinica/prescricoes/grupos/animal/${effectiveAnimalId}?page=1&limit=50`),
      api.get(`/clinica/exames/animal/${effectiveAnimalId}?page=1&limit=50`),
    ]);
    const dadosDe = (r: PromiseSettledResult<{ data?: { dados?: unknown } }>): ComEvolucao[] =>
      r.status === 'fulfilled' ? ((r.value.data?.dados ?? []) as ComEvolucao[]) : [];

    const presc  = dadosDe(prescRes).find(g => g.evolucaoId === evolucaoId);
    const exame  = dadosDe(exameRes).find(e => e.evolucaoId === evolucaoId);

    if (modo === 'editar') {
      setEditPrescricaoId(presc?.id ?? null);
      setViewPrescricaoId(null);
    } else {
      setViewPrescricaoId(presc?.id ?? null);
      setEditPrescricaoId(null);
    }
    setViewExameId(exame?.id ?? null);
  }, [effectiveAnimalId]);

  // Botão "Editar" do Histórico do Paciente: carrega para edição TODOS os
  // registros do atendimento que possuem tela de edição (evolução + prescrição —
  // vacina/exame/encaminhamento hoje só têm visualização no app).
  const abrirEdicaoAtendimento = (grupo: GrupoResumoHistorico) => {
    if (!grupo.evolucao?.evolucaoId) return;
    setEditEvolucaoId(grupo.evolucao.evolucaoId);
    const presc = grupo.subitems.find(s => s.origem === 'PRESCRICAO');
    setEditPrescricaoId(presc ? parseInt(presc.id.split('-')[1]) : null);
    setActiveTab('evolucao');
    navigate(effectiveAnimalId ? `/clinica/evolucao/${effectiveAnimalId}` : '/clinica/evolucao');
  };

  // Sincroniza aba quando o usuário navega pelo Sidebar
  useEffect(() => {
    setActiveTab(tabFromPath(location.pathname));
  }, [location.pathname]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const carregarAnimal = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/animais/${effectiveAnimalId}`);
      // GET 403 → data null: o id da URL é de OUTRA empresa (link antigo, sessão
      // restaurada ou troca de contexto). Em vez de seguir com animal nulo — e deixar
      // todos os submódulos batendo 403 nesse id —, larga o id da URL e cai no
      // paciente do contexto ativo (a rota sem id usa o selectedAnimal).
      if (!res.data) {
        if (animalIdParam) navigate(location.pathname.replace(/\/\d+$/, ''), { replace: true });
        // Sem id na URL, o inacessível é o PACIENTE SELECIONADO (ex.: seleção herdada
        // de outra empresa): refaz a seleção com a lista do contexto ativo, senão o
        // card do animal fica vazio sem explicação.
        else await refreshSelectedAnimal();
        return;
      }
      const a   = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
      // Logo da empresa/equipe para relatórios/impressões — busca best-effort,
      // nunca bloqueia o carregamento do animal (fallback: marca S2Vet no template).
      api.get(`/animais/${effectiveAnimalId}/logo-empresa`)
        .then(res2 => {
          const logoUrl = res2.data?.dados?.logoUrl ?? null;
          setAnimal(prev => prev ? { ...prev, logoUrl } : prev);
        })
        .catch(() => {});
    } catch (err) { console.error('Erro ao carregar animal:', err); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveAnimalId, animalIdParam, location.pathname, refreshSelectedAnimal]);

  // Carrega TODAS as evoluções em andamento do paciente. Quem escolhe entre elas é o
  // usuário (banner) ou, na falta de escolha, `escolherEvolucaoAtiva` — este loader
  // não decide nada, só traz a lista. limit=20: atendimento em paralelo é a exceção,
  // não a regra; passar disso é caso a investigar, não a paginar aqui.
  const carregarEvolucoesAbertas = useCallback(async () => {
    if (!effectiveAnimalId) { setEvolucoesAbertas([]); return; }
    try {
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?status=EM_ANDAMENTO&limit=20&page=1`);
      type EvDados = {
        id: number; veterinarioId?: number | null; agendamentoId?: number | null;
        numero?: number | null; tipoAtendimento?: string | null; atendimentoNumero?: string | null;
        dataInicio?: string | null; titulo?: string | null; especialidade?: string | null;
      };
      const dados: EvDados[] = res.data?.dados ?? [];
      setEvolucoesAbertas(dados.map(ev => ({
        id:               ev.id,
        numero:           ev.numero ?? null,
        tipoAtendimento:  ev.tipoAtendimento ?? null,
        atendimentoNumero: ev.atendimentoNumero ?? null,
        veterinarioId:    ev.veterinarioId ?? null,
        agendamentoId:    ev.agendamentoId ?? null,
        dataInicio:       ev.dataInicio ?? null,
        titulo:           ev.titulo ?? null,
        especialidade:    ev.especialidade ?? null,
      })));
    } catch { /* silencioso */ }
  }, [effectiveAnimalId]);

  useEffect(() => {
    setEvolucoesAbertas([]);
    setEvolucaoSelecionadaId(lerEvolucaoSelecionada(effectiveAnimalId));
    setViewPrescricaoId(null);
    setViewExameId(null);
    carregarAnimal();
  }, [effectiveAnimalId]);

  // Separado do reset acima de propósito: recarrega também quando o AGENDAMENTO da URL
  // muda (ex.: "Iniciar" de uma segunda consulta do mesmo animal), e rodar o reset a
  // cada troca de agendamento limparia estado (viewPrescricaoId/viewExameId) à toa.
  useEffect(() => { carregarEvolucoesAbertas(); }, [carregarEvolucoesAbertas, agendamentoIdFromUrl]);

  // Lista de pacientes (alimenta o SeletorAnimal). ESPERA o contexto ativo resolver —
  // senão no login a busca ia sem os headers x-empresa-id/x-equipe-id e voltava vazia,
  // obrigando a "trocar o seletor" para os animais aparecerem. Refaz ao trocar de contexto.
  useEffect(() => {
    if (empresaLoading) return;
    setCarregandoLista(true);
    api.get('/animais')
      .then(res => setTodosAnimais(res.data?.dados ?? []))
      .catch(() => {})
      .finally(() => setCarregandoLista(false));
  }, [empresaLoading, contextoAtivo?.empresaId, contextoAtivo?.equipeId]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelecionarAnimal = (a: AnimalExtended) => {
    setSelectedAnimal(a);
    navigate(`/clinica/evolucao/${a.id}`);
  };

  // Auto-seleciona um paciente quando a lista termina de carregar e nenhum está
  // selecionado — assim a tela fica utilizável logo após o login, sem precisar
  // trocar o seletor. Apenas define o animal ativo (não navega/troca de aba); o
  // SeletorAnimal continua disponível para trocar. Ignora a aba "Minha Agenda".
  useEffect(() => {
    if (effectiveAnimalId || activeTab === 'agenda') return;
    if (empresaLoading || carregandoLista) return;
    if (todosAnimais.length > 0) setSelectedAnimal(todosAnimais[0]);
  }, [effectiveAnimalId, activeTab, empresaLoading, carregandoLista, todosAnimais, setSelectedAnimal]);

  const handleSelecionarAnimalFromAgenda = useCallback(async (animalId: number) => {
    try {
      const res = await api.get(`/animais/${animalId}`);
      if (!res.data) return;
      const a = (res.data?.dados ?? res.data) as AnimalExtended;
      setAnimal(a);
      setSelectedAnimal(a);
      setTodosAnimais(prev => prev.some(x => x.id === a.id) ? prev : [...prev, a]);
    } catch { /* silencioso */ }
  }, []);

  // ── Guard ─────────────────────────────────────────────────────────────────
  // A aba "Minha Agenda" funciona sem animal selecionado

  if (!effectiveAnimalId && activeTab !== 'agenda') {
    // Ainda resolvendo o contexto ativo ou carregando a lista → não mostra "sem
    // animais" prematuramente (o auto-seleciona escolhe um assim que a lista chega).
    if (empresaLoading || carregandoLista) {
      return (
        <PageContainer>
          <BotaoVoltar className="mb-4" />
          <div className="text-center py-20 text-gray-400 text-sm">Carregando pacientes…</div>
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <BotaoVoltar className="mb-4" />
        <div className="text-center py-20">
          <p className="text-gray-500 text-sm">Você ainda não possui animais sob sua responsabilidade.</p>
          <p className="text-gray-400 text-xs mt-1">Solicite o vínculo com um animal para começar.</p>
        </div>
      </PageContainer>
    );
  }

  const animalIdNum = effectiveAnimalId ? Number(effectiveAnimalId) : 0;

  /**
   * 🔴 Paciente INATIVO deixa o prontuário em SOMENTE LEITURA (2026-09-02).
   *
   * Tudo continua na tela — evolução, prescrição, exame, encaminhamento, agendamento,
   * vacina, histórico e os cancelamentos —, mas nada mais pode ser criado, alterado,
   * finalizado, executado ou cancelado a partir da data e hora da inativação. Reativado
   * pelo gestor, o histórico volta a seguir o trâmite normal.
   *
   * O estado desce para os quatro submódulos e entra nas permissões DELES, o que apaga
   * todo botão de escrita de uma vez. O backend recusa igual — `bloquearSeAnimalInativo`
   * em `lib/animalInativo.js` — então o front aqui é a cortesia de não oferecer o que
   * vai falhar (28-d), nunca a única defesa.
   */
  const pacienteInativo = !!animal?.inativo;

  /**
   * Vai para um submódulo abrindo um item do Histórico do Paciente.
   *
   * VACINA é tela APARTADA: sair daqui desmonta este shell e leva o `openItemId` de
   * estado junto. Por isso o item viaja na URL (`?item=`) — é a única forma de a tela
   * de destino saber o que abrir.
   */
  const irParaSubmodulo = (tab: SubModulo, itemId: number) => {
    const base = effectiveAnimalId ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`;
    if (tab === 'vacina') { navigate(`${base}?item=${itemId}`); return; }
    setOpenItemId(itemId);
    setActiveTab(tab);
    navigate(base);
  };

  const renderSubModulo = () => {
    switch (activeTab) {
      case 'agenda':
        // É a MESMA tela de `/agendamentos`, em modo aba: só o card "Agendamentos do
        // Dia", com o mesmo layout, as mesmas ações e o mesmo reagendamento. A única
        // diferença é o escopo — o profissional vê apenas a agenda dele.
        // ⚠️ Não recriar uma agenda paralela aqui: foi o que gerou a divergência
        // documentada na armadilha 28-g do CLAUDE.md.
        return (
          <Agendamentos
            modoMinhaAgenda
            onSelecionarAnimal={handleSelecionarAnimalFromAgenda}
          />
        );
      case 'evolucao':
        return (
          <SubModuloEvolucao
            key={`evtab-${evolucaoTabKey}`}
            animalId={animalIdNum}
            pacienteInativo={pacienteInativo}
            animal={animal}
            faturaId={null}
            onFaturaAtualizada={() => {}}
            onEvolucaoCriada={handleEvolucaoCriada}
            onEvolucoesAbertasChange={handleEvolucoesAbertasChange}
            // Troca do atendimento carregado: clicar no Nº de uma evolução EM ANDAMENTO
            // no histórico. É este par que faz o banner acima e o vínculo de
            // prescrição/exame/encaminhamento/vacina seguirem o clique.
            evolucaoAtivaId={evolucaoAtiva?.id ?? null}
            onSelecionarEvolucao={selecionarEvolucao}
            // Assumir/finalizar/cancelar mexe em quem está aberto: relê a lista pela
            // consulta PRÓPRIA do shell (sem os filtros da aba, que podem esconder
            // um atendimento em paralelo do banner).
            onSalvo={() => { refreshHistorico(); carregarEvolucoesAbertas(); }}
            openItemId={openItemId ?? undefined}
            onViewConsumed={() => setOpenItemId(null)}
            editItemId={editEvolucaoId}
            onEditConsumed={() => setEditEvolucaoId(null)}
            agendamentoId={agendamentoIdFromUrl}
            onAbrirAtendimento={carregarAtendimentoNasPaginas}
          />
        );
      case 'prescricao':
        return (
          <SubModuloPrescricao
            animalId={animalIdNum}
            pacienteInativo={pacienteInativo}
            animal={animal ? {
              ...animal,
              photoUrl: animal.photoUrl ?? null,
              peso:     animal.peso ?? null,
              baia:     animal.baia ?? null,
              especie:  animal.especie ?? null,
              raca:     animal.raca ?? null,
            } : null}
            onFaturaAtualizada={() => {}}
            evolucaoId={evolucaoAtiva?.id}
            evolucaoDeOutro={!!evolucaoAtiva && !evolucaoAtivaEhMinha(evolucaoAtiva)}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId ?? viewPrescricaoId ?? undefined}
            onViewConsumed={() => { setOpenItemId(null); setViewPrescricaoId(null); }}
            editItemId={editPrescricaoId}
            onEditConsumed={() => setEditPrescricaoId(null)}
          />
        );
      // 'vacina' NÃO tem case: a tela é apartada (pages/Vacina.tsx). Chegar aqui com
      // essa aba só acontece no instante entre o clique e a navegação — ver `default`.
      case 'exames':
        return (
          <SubModuloExames
            animalId={animalIdNum}
            pacienteInativo={pacienteInativo}
            animal={animal}
            evolucaoId={evolucaoAtiva?.id}
            evolucaoDeOutro={!!evolucaoAtiva && !evolucaoAtivaEhMinha(evolucaoAtiva)}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId ?? viewExameId ?? undefined}
            onViewConsumed={() => { setOpenItemId(null); setViewExameId(null); }}
          />
        );
      case 'encaminhamento':
        return (
          <SubModuloEncaminhamento
            animalId={animalIdNum}
            pacienteInativo={pacienteInativo}
            evolucaoId={evolucaoAtiva?.id}
            evolucaoDeOutro={!!evolucaoAtiva && !evolucaoAtivaEhMinha(evolucaoAtiva)}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
          />
        );
      default:
        return null;   // 'vacina' — a navegação já está a caminho da tela apartada
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>

      <BotaoVoltar className="mb-4" />

      <InlineError message={erroInline} className="mb-4" />

      {/* 🔴 O PRONTUÁRIO ESTÁ CONGELADO — sem este aviso, quem abre a tela vê os
          botões de ação simplesmente AUSENTES e conclui que perdeu permissão. A
          faixa diz o estado, desde quando, por quem, por quê e qual é a saída. */}
      {pacienteInativo && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Paciente inativo — prontuário em somente leitura
            {animal?.inativoEm && <> desde {formatDataHora(animal.inativoEm)}</>}.
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            Todo o histórico continua visível e pode ser impresso ou enviado. Nada pode
            ser criado, alterado, finalizado ou cancelado até o gestor reativar o
            paciente.
            {animal?.inativoMotivo && <> Motivo: “{animal.inativoMotivo}”.</>}
            {animal?.inativoPor?.fullName && <> Inativado por {animal.inativoPor.fullName}.</>}
          </p>
        </div>
      )}

      {/* Cabeçalho — título acompanha o submódulo ativo */}
      <div className="mt-2 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
          {HEADER_SUBMODULO[activeTab].icon}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{HEADER_SUBMODULO[activeTab].titulo}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{HEADER_SUBMODULO[activeTab].descricao}</p>
        </div>
      </div>

      <SeletorAnimalInteligente
        animais={todosAnimais}
        animalAtual={animal}
        onSelecionar={handleSelecionarAnimal}
      />

      {animal && <AnimalCard animal={animal} />}

      {/* UM banner só: o atendimento CARREGADO na tela. Havendo outros em andamento
          (consultas distintas — ex.: Clínica e Dermatologia no mesmo dia), a troca é
          pelo Nº no card "Histórico de Evolução Clínica", não por uma segunda faixa
          aqui — duas faixas competindo pela mesma informação foi recusado a pedido. */}
      {evolucaoAtiva && (
        // MOBILE: o texto do atendimento fica em UMA linha (corta com "…", inteiro no
        // `title`) e o Finalizar desce para BAIXO dele — antes a faixa quebrava em
        // quatro ou cinco linhas disputando espaço com o botão. No desktop os dois
        // voltam para a mesma linha.
        <div className="flex flex-col md:flex-row md:items-center gap-2 mt-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium">
          <div className="flex items-center gap-2 min-w-0 md:flex-1">
            <CircleDot size={15} className="text-emerald-500 flex-shrink-0 animate-pulse" />
            <span className="min-w-0 truncate" title={rotuloAtendimentoAtivo}>
              Atendimento <span className="font-bold">{evolucaoAtiva.atendimentoNumero ?? '—'}</span>
              {evolucaoAtiva.dataInicio && ` de ${formatDataHora(evolucaoAtiva.dataInicio)}`}
              {(evolucaoAtiva.titulo?.trim() || evolucaoAtiva.especialidade) &&
                ` - ${evolucaoAtiva.titulo?.trim() || evolucaoAtiva.especialidade}`}
              {' - Em andamento'}
            </span>
          </div>
          {podeFinalizarEvolucao && evolucaoAtivaEhMinha(evolucaoAtiva) && (
            <button onClick={() => setConfirmFinalizarAt(true)} disabled={finalizandoAt}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition-colors flex-shrink-0 self-stretch md:self-auto">
              {finalizandoAt ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Finalizar Atendimento
            </button>
          )}
        </div>
      )}

      {/* ── Desktop ── */}
      <div className="hidden md:block mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
              setOpenItemId(null);
              navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
            }} />
        <div className="flex gap-4 items-start">
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-b-2xl rounded-tr-2xl border border-gray-100 shadow-sm min-h-96 overflow-hidden">
              {renderSubModulo()}
            </div>
          </div>
          {activeTab !== 'agenda' && animalIdNum > 0 && (
            <div className="w-72 flex-shrink-0 sticky top-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col"
                style={{ maxHeight: 'calc(100vh - 240px)', height: 'calc(100vh - 240px)' }}>
                <HistoricoResumidoPanel
                  animalId={animalIdNum}
                  animal={animal}
                  refreshKey={historicoKey}
                  onItemClick={(tab, itemId) => irParaSubmodulo(tab, itemId)}
                  onEditClick={abrirEdicaoAtendimento}
                  podeEditarEvolucao={podeEditarEvolucaoHist}
                  podeImprimir={podeImprimirEvolucao}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile ── */}
      <div className="md:hidden mt-4">
        <SubMenuClinico activeTab={activeTab} onChange={(tab) => {
                setOpenItemId(null);
                navigate(effectiveAnimalId && tab !== 'agenda' ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
              }} />
        <div className="bg-white rounded-b-2xl border border-gray-100 shadow-sm overflow-hidden">
          {renderSubModulo()}
        </div>
        {activeTab !== 'agenda' && animalIdNum > 0 && (
          <>
            <button onClick={() => setShowHistoricoM(true)}
              className="fixed bottom-6 right-4 flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-2xl shadow-lg font-semibold text-sm z-40">
              <History size={15} />
              Histórico
            </button>
            {showHistoricoM && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-end" onClick={() => setShowHistoricoM(false)}>
                <div className="bg-white rounded-t-2xl w-full max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
                    <span className="font-bold text-gray-900 text-sm">Histórico do Paciente</span>
                    <button onClick={() => setShowHistoricoM(false)} className="p-1 text-gray-400"><X size={18} /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <HistoricoResumidoPanel
                      animalId={animalIdNum}
                      animal={animal}
                      refreshKey={historicoKey}
                      onItemClick={(tab, itemId) => {
                        setShowHistoricoM(false);
                        irParaSubmodulo(tab, itemId);
                      }}
                      onEditClick={(grupo) => {
                        setShowHistoricoM(false);
                        abrirEdicaoAtendimento(grupo);
                      }}
                      podeEditarEvolucao={podeEditarEvolucaoHist}
                      podeImprimir={podeImprimirEvolucao}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmFinalizarAt}
        titulo="Finalizar atendimento"
        mensagem={`Finalizar o atendimento ${evolucaoAtiva?.atendimentoNumero ?? ''}? Esta ação não poderá ser revertida.`}
        labelConfirmar="Finalizar"
        variante="aviso"
        onConfirmar={handleFinalizarAtendimento}
        onCancelar={() => setConfirmFinalizarAt(false)}
      />

    </PageContainer>
  );
};

export default Atendimento;