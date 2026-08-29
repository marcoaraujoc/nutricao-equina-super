// src/pages/AuditoriaGeral.tsx
// Auditoria (módulo Geral) — exclusões e cancelamentos com justificativa.
// ADMIN: todos os logs; GESTOR/dono: logs da empresa ativa (backend valida).

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import InlineError from '../components/InlineError';
import DateInput from '../components/DateInput';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import {
  ScrollText, Search, RefreshCw, ChevronLeft, ChevronRight, Trash2, Ban, ShieldCheck,
  ArrowLeftRight, PencilLine, PlusCircle, Eye, X, CheckCircle2, ShieldAlert, FileDown,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LogAuditoria {
  id:         number;
  userName:   string;
  email:      string;
  action:     string;
  timestamp:  string;
  categoria:  string | null;
  entidade:   string | null;
  entidadeId: number | null;
  animalId:   number | null;
  /** Nome do paciente resolvido pelo backend. null = animal excluído (cai no id). */
  animalNome: string | null;
  motivo:     string | null;
  detalhes:   string | null;
  ip:         string | null;
}

interface Meta { total: number; page: number; limit: number; totalPages: number }

type FiltroCategoria = '' | 'EXCLUSAO' | 'CANCELAMENTO' | 'CONFIGURACAO' | 'TRANSFERENCIA' | 'ALTERACAO' | 'CRIACAO' | 'EXECUCAO' | 'ACESSO_NEGADO' | 'EXPORTACAO';

const ENTIDADE_LABEL: Record<string, string> = {
  ANIMAL:            'Paciente',
  LOGIN:             'Login',
  MODULO:            'Módulo/funcionalidade',
  MIDIA:             'Mídia/Arquivo',
  REGISTRO_CLINICO:  'Registro clínico',
  EVOLUCAO:          'Evolução',
  PRESCRICAO:        'Prescrição',
  PRESCRICAO_ITEM:   'Item de prescrição',
  PRESCRICAO_DOSE:   'Dose de prescrição',
  EXAME_CLINICO:     'Exame clínico',
  EXAME_NUTRICIONAL: 'Exame nutricional',
  VACINA:            'Vacina',
  ENCAMINHAMENTO:    'Encaminhamento',
  AGENDAMENTO:       'Agendamento',
  ESTOQUE_FARMACIA:  'Estoque — Farmácia',
  ESTOQUE_VACINA:    'Estoque — Vacina',
  MEDICAMENTO:       'Medicamento (catálogo)',
  PROCEDIMENTO:      'Procedimento (catálogo)',
  DIETA_ITEM:        'Item de dieta',
  CONFIGURACAO_SEGURANCA: 'Configuração de segurança',
  USUARIO:           'Usuário (equipe)',
  FORNECEDOR:        'Fornecedor',
  PRESTADOR:         'Prestador',
  TRATADOR:          'Tratador',
  PROPRIETARIO:      'Proprietário',
  LOCALIZACAO:       'Localização',
};

/**
 * Tira as referências numéricas do texto EXIBIDO (`#81`, `(#182)`, `item#41.dosagem`).
 *
 * Os geradores no backend pararam de gravá-las, mas o AuditLog é um LEDGER IMUTÁVEL:
 * as linhas escritas antes disso continuam com o texto antigo, e reescrevê-las seria
 * adulterar a auditoria. Então a limpeza é de APRESENTAÇÃO — vale para o histórico
 * inteiro sem tocar em nada gravado.
 *
 * NÃO se aplica a `motivo`: ali é o texto que o usuário digitou, e mexer nas palavras
 * dele numa tela de auditoria é pior do que exibir um "#".
 */
const semReferencias = (texto: string): string =>
  texto
    .replace(/\s*\(#\d+\)/g, '')    // "Paulete (#182)" → "Paulete"
    .replace(/#\d+/g, '')           // "EVOLUCAO #81", "item#41.dosagem"
    .replace(/[ \t]{2,}/g, ' ')     // espaço duplo deixado para trás
    .replace(/\s+([,.])/g, '$1')    // pontuação que ficou solta
    .trim();
// ⚠️ `;` fora da regra de pontuação acima DE PROPÓSITO: " ; " é o separador entre as
// mudanças de campo, e colar o ponto-e-vírgula na palavra anterior quebraria o split
// de `DetalhesFormatados` — o modal voltaria a mostrar tudo numa linha só.

const fmtDataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function BadgeCategoria({ categoria }: { categoria: string | null }) {
  if (categoria === 'EXCLUSAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
      <Trash2 size={9} /> EXCLUSÃO
    </span>
  );
  if (categoria === 'CANCELAMENTO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
      <Ban size={9} /> CANCELAMENTO
    </span>
  );
  if (categoria === 'CONFIGURACAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
      <ShieldCheck size={9} /> CONFIGURAÇÃO
    </span>
  );
  // Troca de responsável (assumir / transferir) — o `detalhes` traz de quem para quem
  if (categoria === 'TRANSFERENCIA') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">
      <ArrowLeftRight size={9} /> TRANSFERÊNCIA
    </span>
  );
  if (categoria === 'CRIACAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-700">
      <PlusCircle size={9} /> CRIAÇÃO
    </span>
  );
  if (categoria === 'ALTERACAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
      <PencilLine size={9} /> ALTERAÇÃO
    </span>
  );
  // Execução de dose de prescrição — o `detalhes` traz previsto x executado x quem
  if (categoria === 'EXECUCAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-700">
      <CheckCircle2 size={9} /> EXECUÇÃO
    </span>
  );
  // Tentativa BLOQUEADA — login recusado, módulo sem permissão ou paciente fora do escopo
  if (categoria === 'ACESSO_NEGADO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
      <ShieldAlert size={9} /> ACESSO NEGADO
    </span>
  );
  // Extração em massa de prontuário (Administração > Exportação)
  if (categoria === 'EXPORTACAO') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
      <FileDown size={9} /> EXPORTAÇÃO
    </span>
  );
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
      SISTEMA
    </span>
  );
}

/**
 * `detalhes` é uma linha só, mas com estrutura: `registrarAlteracao` e
 * `registrarTransferencia` (lib/auditoria.js) separam os blocos por " | " e as
 * mudanças de campo por " ; ". Na tabela isso vira um parágrafo cortado em duas
 * linhas; aqui é quebrado de volta para que se leia mudança a mudança — que é o
 * motivo de existir o "Visualizar".
 */
function DetalhesFormatados({ texto }: { texto: string }) {
  const limpo  = semReferencias(texto);
  const blocos = limpo.split(' | ').flatMap(b => b.split(' ; '));
  if (blocos.length <= 1) {
    return <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{limpo}</p>;
  }
  return (
    <ul className="space-y-1">
      {blocos.map((b, i) => (
        <li key={i} className="text-sm text-gray-800 break-words flex gap-2">
          <span className="text-gray-300 select-none">•</span>
          <span className="whitespace-pre-wrap">{b.trim()}</span>
        </li>
      ))}
    </ul>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{rotulo}</p>
      {children}
    </div>
  );
}

/** Entrada completa da auditoria — a tabela corta `detalhes`/`motivo` em 2 linhas. */
function ModalLog({ log, onFechar }: { log: LogAuditoria; onFechar: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col max-h-[88vh] overflow-hidden">
        <div className="bg-emerald-700 px-5 py-3.5 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText size={15} className="text-white/90 flex-shrink-0" />
            <p className="font-bold text-sm text-white truncate">Registro de auditoria</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-white/60 hover:text-white flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <BadgeCategoria categoria={log.categoria} />
            <span className="text-xs text-gray-500 font-mono">{fmtDataHora(log.timestamp)}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo rotulo="Tipo de registro">
              <p className="text-sm text-gray-800">
                {log.entidade ? (ENTIDADE_LABEL[log.entidade] ?? log.entidade) : '—'}
              </p>
            </Campo>
            <Campo rotulo="Paciente">
              {/* Nome vem do backend (`animalNome`). Animal já excluído fica sem nome —
                  o id NÃO é exibido no lugar, por decisão: a tela não mostra referência
                  numérica. O `animalId` continua na coluna do banco para rastreio. */}
              <p className="text-sm text-gray-800">
                {log.animalNome ?? (log.animalId != null ? 'Paciente excluído' : '—')}
              </p>
            </Campo>
            <Campo rotulo="Usuário">
              <p className="text-sm text-gray-800 break-words">{log.userName || '—'}</p>
              {log.email && <p className="text-xs text-gray-500 break-words">{log.email}</p>}
            </Campo>
            <Campo rotulo="Endereço IP">
              <p className="text-sm text-gray-800 font-mono">{log.ip ?? '—'}</p>
            </Campo>
          </div>

          <Campo rotulo="Ação">
            <p className="text-sm text-gray-800 break-words">{semReferencias(log.action) || '—'}</p>
          </Campo>

          <Campo rotulo="Detalhes">
            {log.detalhes
              ? <DetalhesFormatados texto={log.detalhes} />
              : <p className="text-sm text-gray-400">Sem detalhes registrados.</p>}
          </Campo>

          <Campo rotulo="Justificativa">
            {log.motivo
              ? <p className="text-sm text-gray-800 whitespace-pre-wrap break-words bg-gray-50 rounded-xl px-3 py-2">{log.motivo}</p>
              : <p className="text-sm text-gray-400">Sem justificativa registrada.</p>}
          </Campo>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end flex-shrink-0">
          <button onClick={onFechar}
            className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm hover:bg-gray-50">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function AuditoriaGeral() {
  const { isGestor, loading: loadingPerms } = usePermissoes();
  const { user } = useAuth();
  const isAdmin = user?.userType === 'ADMIN';

  const [logs,       setLogs]       = useState<LogAuditoria[]>([]);
  const [meta,       setMeta]       = useState<Meta>({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [loading,    setLoading]    = useState(false);
  const [semAcesso,  setSemAcesso]  = useState(false);
  const [erroInline, setErroInline] = useState<string | null>(null);

  const [categoria,  setCategoria]  = useState<FiltroCategoria>('');
  const [entidade,   setEntidade]   = useState('');
  const [busca,      setBusca]      = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim,    setDataFim]    = useState('');
  const [page,       setPage]       = useState(1);
  // Entrada aberta no modal — a tabela corta detalhes/justificativa em 2 linhas
  const [logAberto,  setLogAberto]  = useState<LogAuditoria | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (categoria)  params.categoria  = categoria;
      if (entidade)   params.entidade   = entidade;
      if (busca)      params.busca      = busca;
      if (dataInicio) params.dataInicio = dataInicio;
      if (dataFim)    params.dataFim    = dataFim;

      const res = await api.get('/audit/logs', { params });
      if (!res.data) { setSemAcesso(true); return; } // GET 403 → null
      setSemAcesso(false);
      setLogs(res.data.dados ?? []);
      setMeta(res.data.meta ?? { total: 0, page: 1, limit: 50, totalPages: 1 });
      setErroInline(null);
    } catch { setErroInline('Erro ao carregar auditoria.'); }
    finally { setLoading(false); }
  }, [page, categoria, entidade, busca, dataInicio, dataFim]);

  useEffect(() => {
    if (loadingPerms) return;
    if (!isGestor && !isAdmin) return;
    carregar();
  }, [carregar, loadingPerms, isGestor, isAdmin]);

  // Volta para a primeira página quando um filtro muda
  useEffect(() => { setPage(1); }, [categoria, entidade, busca, dataInicio, dataFim]);

  if (loadingPerms) return (
    <PageContainer maxWidth="7xl">
      <div className="flex justify-center py-16">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full" />
      </div>
    </PageContainer>
  );

  if ((!isGestor && !isAdmin) || semAcesso) return (
    <PageContainer maxWidth="7xl">
      <div className="text-center py-16">
        <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
        <p className="text-gray-500 mt-2">Apenas gestores podem visualizar a auditoria.</p>
      </div>
    </PageContainer>
  );

  return (
    <PageContainer maxWidth="7xl">
      <div className="space-y-5">
        <BotaoVoltar className="mb-6" />

        <InlineError message={erroInline} />

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <ScrollText size={20} className="text-emerald-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Auditoria</h1>
            <p className="text-sm text-gray-500">Exclusões, cancelamentos e tentativas de acesso negado{isAdmin ? ' — todas as empresas' : ' da empresa ativa'}.</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {([['', 'Todas'], ['ACESSO_NEGADO', 'Acesso negado'], ['EXCLUSAO', 'Exclusões'], ['CANCELAMENTO', 'Cancelamentos'], ['TRANSFERENCIA', 'Transferências'], ['ALTERACAO', 'Alterações'], ['CRIACAO', 'Criações'], ['EXECUCAO', 'Execuções'], ['EXPORTACAO', 'Exportações'], ['CONFIGURACAO', 'Configuração']] as [FiltroCategoria, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setCategoria(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  categoria === key
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative md:col-span-2">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input type="text" placeholder="Buscar por paciente, motivo, registro ou usuário..."
                value={busca} onChange={(e) => setBusca(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <select value={entidade} onChange={(e) => setEntidade(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">Todos os tipos</option>
              {Object.entries(ENTIDADE_LABEL).map(([slug, label]) => (
                <option key={slug} value={slug}>{label}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              {/* `compacto`: barra de filtros — o erro de data vai no `title` e na cor,
                  não num bloco abaixo, que desalinharia a linha inteira. Vazio aqui
                  significa "sem filtro de período" (ver o `if (dataInicio)` do
                  carregar), então zerar numa data inválida é o comportamento certo. */}
              <DateInput
                value={dataInicio} onChange={setDataInicio} compacto
                aria-label="Data inicial"
                className="flex-1 border border-gray-200 rounded-xl px-2 py-2 text-xs focus-within:ring-2 focus-within:ring-emerald-500"
              />
              <span className="text-gray-400 text-xs">a</span>
              <DateInput
                value={dataFim} onChange={setDataFim} compacto
                aria-label="Data final"
                className="flex-1 border border-gray-200 rounded-xl px-2 py-2 text-xs focus-within:ring-2 focus-within:ring-emerald-500"
              />
              <button onClick={carregar} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>

        {/* Lista */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Registros de Auditoria</p>
            <span className="text-xs text-gray-400">{meta.total} registro{meta.total !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <p className="text-center py-12 text-gray-400 text-sm">Carregando...</p>
          ) : logs.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Nenhum registro de auditoria encontrado.</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      <th className="py-3 px-4 whitespace-nowrap">Data / Hora</th>
                      <th className="py-3 px-4">Ação</th>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-4">Paciente</th>
                      {/* "Registro" (detalhes) e "Justificativa" saíram da grade: eram
                          textos longos cortados em duas linhas, que não se liam nem na
                          tabela nem no card. Continuam inteiros no modal Visualizar e
                          continuam alcançáveis pela busca. */}
                      <th className="py-3 px-4">Usuário</th>
                      <th className="py-3 px-4 whitespace-nowrap">IP</th>
                      <th className="py-3 px-4 whitespace-nowrap text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/60">
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap font-mono">{fmtDataHora(log.timestamp)}</td>
                        <td className="py-3 px-4"><BadgeCategoria categoria={log.categoria} /></td>
                        <td className="py-3 px-4 text-xs text-gray-700 whitespace-nowrap">
                          {log.entidade ? (ENTIDADE_LABEL[log.entidade] ?? log.entidade) : '—'}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-700 whitespace-nowrap">
                          {log.animalNome ?? (log.animalId != null
                            ? <span className="text-gray-400 italic">Paciente excluído</span>
                            : <span className="text-gray-300">—</span>)}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">{log.userName || log.email || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap font-mono">{log.ip ?? '—'}</td>
                        <td className="py-3 px-4 text-center">
                          <button onClick={() => setLogAberto(log)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors whitespace-nowrap">
                            <Eye size={12} /> Visualizar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-gray-100">
                {logs.map((log) => (
                  <div key={log.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <BadgeCategoria categoria={log.categoria} />
                      <span className="text-[10px] text-gray-400 font-mono">{fmtDataHora(log.timestamp)}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">
                      {log.entidade ? (ENTIDADE_LABEL[log.entidade] ?? log.entidade) : 'Sistema'}
                    </p>
                    {(log.animalNome || log.animalId != null) && (
                      <p className="text-xs text-gray-600">
                        <span className="text-gray-400">Paciente: </span>
                        {log.animalNome ?? <span className="italic text-gray-400">excluído</span>}
                      </p>
                    )}
                    {/* Detalhes e justificativa moram no modal Visualizar — ver a nota
                        no cabeçalho da tabela. */}
                    <p className="text-[11px] text-gray-400">
                      por {log.userName || log.email || '—'}
                      {log.ip && <span className="font-mono"> · {log.ip}</span>}
                    </p>
                    <button onClick={() => setLogAberto(log)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 text-emerald-700 rounded-xl text-xs font-semibold hover:bg-emerald-50 transition-colors">
                      <Eye size={12} /> Visualizar
                    </button>
                  </div>
                ))}
              </div>

              {/* Paginação */}
              {meta.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    <ChevronLeft size={13} /> Anterior
                  </button>
                  <span className="text-xs text-gray-500">Página {meta.page} de {meta.totalPages}</span>
                  <button disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    Próxima <ChevronRight size={13} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {logAberto && <ModalLog log={logAberto} onFechar={() => setLogAberto(null)} />}
    </PageContainer>
  );
}
