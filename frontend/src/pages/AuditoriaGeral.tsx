// src/pages/AuditoriaGeral.tsx
// Auditoria (módulo Geral) — exclusões e cancelamentos com justificativa.
// ADMIN: todos os logs; GESTOR/dono: logs da empresa ativa (backend valida).

import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import InlineError from '../components/InlineError';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { usePermissoes } from '../hooks/usePermissoes';
import { useAuth } from '../contexts/AuthContext';
import {
  ScrollText, Search, RefreshCw, ChevronLeft, ChevronRight, Trash2, Ban, ShieldCheck,
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
  motivo:     string | null;
  detalhes:   string | null;
  ip:         string | null;
}

interface Meta { total: number; page: number; limit: number; totalPages: number }

type FiltroCategoria = '' | 'EXCLUSAO' | 'CANCELAMENTO' | 'CONFIGURACAO';

const ENTIDADE_LABEL: Record<string, string> = {
  EVOLUCAO:          'Evolução',
  PRESCRICAO:        'Prescrição',
  PRESCRICAO_ITEM:   'Item de prescrição',
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
};

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
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500">
      SISTEMA
    </span>
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
            <p className="text-sm text-gray-500">Exclusões e cancelamentos com justificativa{isAdmin ? ' — todas as empresas' : ' da empresa ativa'}.</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {([['', 'Todas'], ['EXCLUSAO', 'Exclusões'], ['CANCELAMENTO', 'Cancelamentos'], ['CONFIGURACAO', 'Configuração']] as [FiltroCategoria, string][]).map(([key, label]) => (
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
              <input type="text" placeholder="Buscar por motivo, registro ou usuário..."
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
              <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              <span className="text-gray-400 text-xs">a</span>
              <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500" />
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
                      <th className="py-3 px-4">Registro</th>
                      <th className="py-3 px-4">Justificativa</th>
                      <th className="py-3 px-4">Usuário</th>
                      <th className="py-3 px-4 whitespace-nowrap">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50/60">
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap font-mono">{fmtDataHora(log.timestamp)}</td>
                        <td className="py-3 px-4"><BadgeCategoria categoria={log.categoria} /></td>
                        <td className="py-3 px-4 text-xs text-gray-700 whitespace-nowrap">
                          {log.entidade ? (ENTIDADE_LABEL[log.entidade] ?? log.entidade) : '—'}
                          {log.entidadeId != null && <span className="text-gray-400"> #{log.entidadeId}</span>}
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-600 max-w-[220px]">
                          <span className="line-clamp-2">{log.detalhes ?? log.action}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-800 max-w-[280px]">
                          <span className="line-clamp-2">{log.motivo ?? '—'}</span>
                        </td>
                        <td className="py-3 px-4 text-xs text-gray-500 whitespace-nowrap">{log.userName || log.email || '—'}</td>
                        <td className="py-3 px-4 text-xs text-gray-400 whitespace-nowrap font-mono">{log.ip ?? '—'}</td>
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
                      {log.entidadeId != null && <span className="text-gray-400 text-xs"> #{log.entidadeId}</span>}
                    </p>
                    {(log.detalhes ?? log.action) && (
                      <p className="text-xs text-gray-500 line-clamp-2">{log.detalhes ?? log.action}</p>
                    )}
                    {log.motivo && (
                      <p className="text-xs text-gray-700 bg-gray-50 rounded-lg px-2 py-1.5">
                        <span className="font-semibold text-gray-500">Motivo:</span> {log.motivo}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400">
                      por {log.userName || log.email || '—'}
                      {log.ip && <span className="font-mono"> · {log.ip}</span>}
                    </p>
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
    </PageContainer>
  );
}
