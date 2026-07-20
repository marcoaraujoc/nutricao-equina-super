// src/pages/Atendimento.tsx
// Shell clínico — delega cada sub-aba ao seu módulo dedicado

import { useState, useEffect, useCallback, useRef } from 'react';
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
import ConfirmModal from '../components/ConfirmModal';
import SubModuloEvolucao from './SubModuloEvolucao';
import SubModuloPrescricao from './SubModuloPrescricao';
import SubModuloVacina from './SubModuloVacina';
import SubModuloExames from './SubModuloExames';
import SubModuloEncaminhamento from './SubModuloEncaminhamento';
import SubModuloMinhaAgenda from './SubModuloMinhaAgenda';
import { imprimirAtendimento, gerarHtmlAtendimento, type PrintAtendimento, type PrintAnimal, type PrintAtendimentoItem } from '../utils/AtendimentoPrint';

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectedAnimal = NonNullable<ReturnType<typeof useSelectedAnimal>['selectedAnimal']>;

type AnimalExtended = SelectedAnimal & {
  dataNascimento?: string | Date | null;
  idadeAnos?:      number | null;
  baia?:           string | null;
  raca?:           { nome: string } | null;
  user?:           { fullName: string; email: string } | null;
  logoUrl?:        string | null;
};

interface EvolucaoAtiva {
  id:               number;
  numero:           number | null;
  tipoAtendimento:  string | null;
  atendimentoNumero: string | null;
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

const SUB_MODULOS: { key: SubModulo; label: string; icon: React.ReactNode }[] = [
  { key: 'agenda',         label: 'Agenda',          icon: <CalendarDays size={15} /> },
  { key: 'evolucao',       label: 'Evolução',       icon: <FileText     size={15} /> },
  { key: 'prescricao',     label: 'Prescrição',     icon: <Pill         size={15} /> },
  { key: 'vacina',         label: 'Vacina',         icon: <Syringe      size={15} /> },
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
}: {
  animalId:    number;
  animal:      AnimalExtended | null;
  refreshKey:  number;
  onItemClick: (tab: SubModulo, itemId: number) => void;
  onEditClick: (grupo: GrupoResumoHistorico) => void;
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
                    {!emAndamento && (
                      <button onClick={() => handleImprimir(grupo)} disabled={gerandoRelatorio} title="Imprimir atendimento"
                        className="p-1 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
                        {gerandoRelatorio ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
                      </button>
                    )}
                    {!emAndamento && ev.evolucaoId != null && (
                      <button onClick={() => handleVisualizar(grupo)} disabled={gerandoRelatorio} title="Visualizar atendimento"
                        className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40">
                        {gerandoRelatorio ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                      </button>
                    )}
                    {ev.evolucaoId != null && (
                      <button onClick={() => onEditClick(grupo)} title={emAndamento ? 'Continuar atendimento' : 'Editar atendimento'}
                        className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0">
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
                <button onClick={() => imprimirAtendimento(previewAtendimento, printAnimal)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                  <Printer size={13} /> Imprimir
                </button>
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

// ─── SeletorAnimalInteligente ─────────────────────────────────────────────────

function SeletorAnimalInteligente({ animais, animalAtual, onSelecionar }: {
  animais:      AnimalExtended[];
  animalAtual:  AnimalExtended | null;
  onSelecionar: (a: AnimalExtended) => void;
}) {
  const [filtroDono,     setFiltroDono]     = useState('');
  const [dropdownAberto, setDropdownAberto] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownAberto(false); setFiltroDono('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (animais.length <= 1) return null;

  const nomesCount = animais.reduce<Record<string, number>>((acc, a) => {
    acc[a.nome] = (acc[a.nome] ?? 0) + 1; return acc;
  }, {});

  const animalTemDuplicata  = animalAtual ? (nomesCount[animalAtual.nome] ?? 0) > 1 : false;
  const duplicatas          = animalAtual ? animais.filter(a => a.nome === animalAtual.nome) : [];
  const duplicatasFiltradas = filtroDono.trim()
    ? duplicatas.filter(a => (a.user?.fullName ?? '').toLowerCase().includes(filtroDono.toLowerCase()))
    : duplicatas;

  return (
    <div className="space-y-2 mb-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
        <select value={animalAtual?.id ?? ''}
          onChange={e => {
            const sel = animais.find(a => a.id === Number(e.target.value));
            if (sel) { onSelecionar(sel); setFiltroDono(''); }
          }}
          className="w-full border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:border-emerald-600 shadow-sm">
          {animais.map(a => (
            <option key={a.id} value={a.id}>
              {a.nome}{(nomesCount[a.nome] ?? 0) > 1 ? ` — ${a.user?.fullName ?? '?'}` : ''}
            </option>
          ))}
        </select>
      </div>
      {animalTemDuplicata && (
        <div className="relative" ref={dropdownRef}>
          <label className="block text-xs font-medium text-amber-700 mb-1">
            ⚠️ {duplicatas.length} animais com o nome "{animalAtual?.nome}" — filtre pelo proprietário:
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" value={filtroDono}
              onChange={e => { setFiltroDono(e.target.value); setDropdownAberto(true); }}
              onFocus={() => setDropdownAberto(true)}
              placeholder="Nome do proprietário..."
              className="w-full pl-9 pr-4 py-2.5 border border-amber-300 rounded-2xl text-sm text-gray-900 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 bg-amber-50" />
          </div>
          {dropdownAberto && duplicatasFiltradas.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-2xl shadow-xl z-20 overflow-hidden max-h-56 overflow-y-auto">
              {duplicatasFiltradas.map(a => (
                <button key={a.id}
                  onClick={() => { onSelecionar(a); setFiltroDono(''); setDropdownAberto(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
                    a.id === animalAtual?.id ? 'bg-emerald-50' : ''
                  }`}>
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {a.photoUrl
                      ? <img src={a.photoUrl as string} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">🐾</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{a.nome}</p>
                    <p className="text-xs text-gray-400 truncate">Proprietário: {a.user?.fullName ?? '—'}</p>
                  </div>
                  {a.id === animalAtual?.id && <span className="w-2 h-2 bg-emerald-500 rounded-full flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}
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
  const { setSelectedAnimal, selectedAnimal } = useSelectedAnimal();
  const { user }                              = useAuth();
  const { podeExecutar, isGestor }            = usePermissoes();
  const { contextoAtivo, loading: empresaLoading } = useEmpresa();
  const navigate                              = useNavigate();
  const location                              = useLocation();
  const { animalId: animalIdParam }           = useParams<{ animalId?: string }>();

  const podeFinalizarEvolucao = isGestor || podeExecutar('atendimento.evolucoes.finalizar');
  // FORNECEDOR: regra de autoria — só finaliza a evolução que ele próprio criou
  const isFornecedor = user?.userType === 'FORNECEDOR';

  const effectiveAnimalId = animalIdParam || selectedAnimal?.id?.toString();

  // Persiste o agendamentoId entre navegações e re-logins (localStorage por animal).
  // Recalculado a cada mudança de location.search/animalId — não pode ser um useState
  // inicializado uma única vez, pois /clinica/agenda e /clinica/evolucao/:animalId
  // renderizam o MESMO componente <Atendimento />, então navegar entre eles (ex: botão
  // "Iniciar" da agenda) não remonta o componente, só troca a rota.
  const [agendamentoIdFromUrl, setAgendamentoIdFromUrl] = useState<number | undefined>();

  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('agendamentoId');
    if (fromUrl && animalIdParam) {
      localStorage.setItem(`s2vet_ag_${animalIdParam}`, fromUrl);
      setAgendamentoIdFromUrl(Number(fromUrl));
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
  const [evolucaoAtiva,   setEvolucaoAtiva]   = useState<EvolucaoAtiva | null>(null);
  const [historicoKey,    setHistoricoKey]    = useState(0);
  const [openItemId,        setOpenItemId]        = useState<number | null>(null);
  const [editEvolucaoId,    setEditEvolucaoId]    = useState<number | null>(null);
  const [editPrescricaoId,  setEditPrescricaoId]  = useState<number | null>(null);
  // Itens do atendimento pendentes de abrir em VISUALIZAÇÃO (somente leitura)
  // em cada aba — setados pelos botões Visualizar/Editar do Histórico de
  // Evolução Clínica e consumidos quando a aba correspondente é aberta.
  const [viewPrescricaoId,  setViewPrescricaoId]  = useState<number | null>(null);
  const [viewExameId,       setViewExameId]       = useState<number | null>(null);
  const [viewVacinaId,      setViewVacinaId]      = useState<number | null>(null);
  // Finalizar Atendimento (banner) — mesma ação do Finalizar da aba Evolução
  const [confirmFinalizarAt, setConfirmFinalizarAt] = useState(false);
  const [finalizandoAt,      setFinalizandoAt]      = useState(false);
  // Remonta a aba Evolução após finalizar pelo banner (recarrega a lista e limpa o form)
  const [evolucaoTabKey,     setEvolucaoTabKey]     = useState(0);

  const refreshHistorico = () => setHistoricoKey(k => k + 1);

  const handleFinalizarAtendimento = async () => {
    if (!evolucaoAtiva) return;
    setConfirmFinalizarAt(false);
    setFinalizandoAt(true);
    const evolucaoId = evolucaoAtiva.id;
    try {
      const res = await api.get(`/clinica/evolucoes/${evolucaoId}`);
      const ev = res.data?.dados as { especialidade: string; texto: string | null; veterinarioId: number } | undefined;
      if (!ev) { toast.error('Não foi possível carregar a evolução do atendimento'); return; }
      if (isFornecedor && ev.veterinarioId !== (user?.id ?? 0)) {
        toast.error('Sem permissão para finalizar evolução de outro profissional. Verifique com o responsável da equipe.');
        return;
      }
      if (!ev.texto?.trim()) {
        toast.error('O texto da evolução é obrigatório. Preencha a evolução antes de finalizar o atendimento.');
        return;
      }
      await api.put(`/clinica/evolucoes/${evolucaoId}`, {
        especialidade: ev.especialidade,
        texto:         ev.texto,
        status:        'FINALIZADA',
      });
      toast.success('Atendimento finalizado!');
      setEvolucaoAtiva(null);
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
      toast.error(msg ?? 'Erro ao finalizar atendimento');
    } finally { setFinalizandoAt(false); }
  };

  // Visualizar/Editar do Histórico de Evolução Clínica: carrega cada registro
  // vinculado ao atendimento na sua página correspondente. A evolução em si é
  // aberta pelo próprio SubModuloEvolucao (populada em leitura ou edição); aqui
  // resolvemos prescrição/exame/vacina buscando nas listas de cada módulo pelo
  // evolucaoId (o histórico unificado filtra por status e esconderia, p.ex.,
  // prescrição ainda em SALVO). Visualizar → tudo somente leitura; Editar →
  // prescrição abre no formulário de edição (o que já foi executado permanece
  // somente leitura pelas regras de status existentes); exame e vacina não têm
  // formulário de edição — abrem sempre em visualização.
  const carregarAtendimentoNasPaginas = useCallback(async (evolucaoId: number, modo: 'visualizar' | 'editar') => {
    if (!effectiveAnimalId) return;
    type ComEvolucao = { id: number; evolucaoId?: number | null };
    const [prescRes, exameRes, vacinaRes] = await Promise.allSettled([
      api.get(`/clinica/prescricoes/grupos/animal/${effectiveAnimalId}?page=1&limit=50`),
      api.get(`/clinica/exames/animal/${effectiveAnimalId}?page=1&limit=50`),
      api.get(`/clinica/vacinas/animal/${effectiveAnimalId}`),
    ]);
    const dadosDe = (r: PromiseSettledResult<{ data?: { dados?: unknown } }>): ComEvolucao[] =>
      r.status === 'fulfilled' ? ((r.value.data?.dados ?? []) as ComEvolucao[]) : [];

    const presc  = dadosDe(prescRes).find(g => g.evolucaoId === evolucaoId);
    const exame  = dadosDe(exameRes).find(e => e.evolucaoId === evolucaoId);
    const vacina = dadosDe(vacinaRes).find(v => v.evolucaoId === evolucaoId);

    if (modo === 'editar') {
      setEditPrescricaoId(presc?.id ?? null);
      setViewPrescricaoId(null);
    } else {
      setViewPrescricaoId(presc?.id ?? null);
      setEditPrescricaoId(null);
    }
    setViewExameId(exame?.id ?? null);
    setViewVacinaId(vacina?.id ?? null);
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
  }, [effectiveAnimalId]);

  const carregarEvolucaoAtiva = useCallback(async () => {
    if (!effectiveAnimalId) return;
    try {
      const res = await api.get(`/clinica/evolucoes/animal/${effectiveAnimalId}?status=EM_ANDAMENTO&limit=1&page=1`);
      const dados = res.data?.dados ?? [];
      if (dados.length > 0) {
        const ev = dados[0];
        setEvolucaoAtiva({
          id:               ev.id,
          numero:           ev.numero ?? null,
          tipoAtendimento:  ev.tipoAtendimento ?? null,
          atendimentoNumero: ev.atendimentoNumero ?? null,
        });
      } else {
        setEvolucaoAtiva(null);
      }
    } catch { /* silencioso */ }
  }, [effectiveAnimalId]);

  useEffect(() => {
    setEvolucaoAtiva(null);
    setViewPrescricaoId(null);
    setViewExameId(null);
    setViewVacinaId(null);
    carregarAnimal();
    carregarEvolucaoAtiva();
  }, [effectiveAnimalId]);

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

  const renderSubModulo = () => {
    switch (activeTab) {
      case 'agenda':
        return (
          <SubModuloMinhaAgenda
            onSelecionarAnimal={handleSelecionarAnimalFromAgenda}
          />
        );
      case 'evolucao':
        return (
          <SubModuloEvolucao
            key={`evtab-${evolucaoTabKey}`}
            animalId={animalIdNum}
            animal={animal}
            faturaId={null}
            onFaturaAtualizada={() => {}}
            onEvolucaoChange={setEvolucaoAtiva}
            onSalvo={refreshHistorico}
            openItemId={openItemId}
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
            animal={animal ? { ...animal, photoUrl: animal.photoUrl ?? null } : null}
            onFaturaAtualizada={() => {}}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId ?? viewPrescricaoId ?? undefined}
            onViewConsumed={() => { setOpenItemId(null); setViewPrescricaoId(null); }}
            editItemId={editPrescricaoId}
            onEditConsumed={() => setEditPrescricaoId(null)}
          />
        );
      case 'vacina':
        return (
          <SubModuloVacina
            animalId={animalIdNum}
            animal={animal}
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
            openItemId={openItemId ?? viewVacinaId ?? undefined}
            onViewConsumed={() => { setOpenItemId(null); setViewVacinaId(null); }}
          />
        );
      case 'exames':
        return (
          <SubModuloExames
            animalId={animalIdNum}
            animal={animal}
            evolucaoId={evolucaoAtiva?.id}
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
            evolucaoId={evolucaoAtiva?.id}
            atendimentoNumero={evolucaoAtiva?.atendimentoNumero ?? undefined}
            onSalvo={refreshHistorico}
          />
        );
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <PageContainer>

      <BotaoVoltar className="mb-4" />

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

      {evolucaoAtiva && (
        <div className="flex items-center gap-2 mt-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm text-emerald-800 font-medium">
          <CircleDot size={15} className="text-emerald-500 flex-shrink-0 animate-pulse" />
          <span className="flex-1 min-w-0">
            Atendimento <span className="font-bold">{evolucaoAtiva.atendimentoNumero}</span> em andamento
          </span>
          {podeFinalizarEvolucao && (
            <button onClick={() => setConfirmFinalizarAt(true)} disabled={finalizandoAt}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition-colors flex-shrink-0">
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
                  onItemClick={(tab, itemId) => {
                    setOpenItemId(itemId);
                    setActiveTab(tab);
                    navigate(effectiveAnimalId ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
                  }}
                  onEditClick={abrirEdicaoAtendimento}
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
                        setOpenItemId(itemId);
                        setShowHistoricoM(false);
                        setActiveTab(tab);
                        navigate(effectiveAnimalId ? `/clinica/${tab}/${effectiveAnimalId}` : `/clinica/${tab}`);
                      }}
                      onEditClick={(grupo) => {
                        setShowHistoricoM(false);
                        abrirEdicaoAtendimento(grupo);
                      }}
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