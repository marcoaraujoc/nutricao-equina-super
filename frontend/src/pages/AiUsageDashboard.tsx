// src/pages/AiUsageDashboard.tsx
// Dashboard de monitoramento de uso e custo de LLM
// Visível para todos os usuários autenticados (resumo + projeção)
// Log detalhado apenas para ADMIN

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import {
  ArrowLeft, Zap, DollarSign, Clock, AlertTriangle,
  TrendingUp, BarChart2, RefreshCw, CheckCircle, XCircle,
} from 'lucide-react';
import { formatDateShort, formatDateTime } from '../utils/dateUtils';
import PageContainer from '../components/PageContainer';
import ConsumoPorClienteIA from '../components/ConsumoPorClienteIA';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModuloUso {
  modulo:        string;
  chamadas:      number;
  tokens:        number;
  tokensEntrada: number;
  tokensSaida:   number;
  custoUsd:      number;
  mediaTokens:   number;
}

interface Resumo {
  periodo: string;
  totalChamadas: number;
  totalTokens: number;
  custoTotalUsd: number;
  custoTotalBrl: number;
  mediaLatenciaMs: number;
  totalErros: number;
  taxaErroPercent: number;
  topOperacoes: { operacao: string; chamadas: number; tokens: number; custoUsd: number }[];
  porModulo: ModuloUso[];
}

interface DiaEvol {
  data: string;
  chamadas: number;
  tokens: number;
  custoUsd: number;
  erros: number;
}

interface Projecao {
  baseObservada: string;
  mediaDiaria: { chamadas: number; tokens: number; custoUsd: number };
  projecao30dias: { chamadas: number; tokens: number; custoUsd: number; custoBrl: number };
}

interface LogItem {
  id: number;
  createdAt: string;
  operacao: string;
  modulo: string;
  modelo: string;
  provedor: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensTotal: number;
  custoUsd: number;
  latenciaMs: number;
  sucesso: boolean;
  erroMensagem?: string;
  usuario: string;
}

type Periodo = '7d' | '30d' | '90d' | 'mes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatUsd = (v: number) => `$${v.toFixed(4)}`;
const formatBrl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const formatTokens = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` :
  v >= 1_000     ? `${(v / 1_000).toFixed(1)}k` :
  String(v);

// A operação logada carrega a versão do prompt (ex.: 'parse_laudo@v5') — o
// rótulo é resolvido pela chave, sem a versão.
const OPERACAO_LABEL: Record<string, string> = {
  parse_laudo:                     'Parse de laudo',
  parse_composicao_texto:          'Composição (PDF)',
  parse_composicao_visao:          'Composição (imagem)',
  interpretacao_clinica:           'Interpretação clínica',
  resumo_historico:                'Resumo do histórico',
  memoria_clinica:                 'Memória clínica',
  analise_financeira:              'Análise financeira',
  interpretacao_agendamento:       'Interpretação de agendamento',
  analise_nota_clinica:            'Nota clínica ditada',
  transcricao_audio:               'Transcrição de áudio',
  extrair_resultado_sessao_equino: 'Laudo equino (body-map)',
  relatorio_nutricional:           'Relatório nutricional',
};

const labelOperacao = (op: string) => {
  const chave = op.split('@')[0];
  return OPERACAO_LABEL[chave] ?? chave;
};

const MODULO_LABEL: Record<string, string> = {
  ATENDIMENTO:     'Atendimento',
  MEMORIA_CLINICA: 'Memória clínica',
  FINANCEIRO:      'Financeiro',
  EXAMES:          'Exames',
  NUTRICAO:        'Nutrição',
  AGENDA:          'Agenda',
  TRANSCRICAO:     'Transcrição',
  LEGADO:          'Anterior ao registro de módulo',
  OUTROS:          'Outros',
};

const labelModulo = (m: string) => MODULO_LABEL[m] ?? m;

const MODULO_COR: Record<string, string> = {
  ATENDIMENTO:     'bg-emerald-100 text-emerald-700',
  MEMORIA_CLINICA: 'bg-violet-100 text-violet-700',
  FINANCEIRO:      'bg-amber-100 text-amber-700',
  EXAMES:          'bg-blue-100 text-blue-700',
  NUTRICAO:        'bg-lime-100 text-lime-700',
  AGENDA:          'bg-sky-100 text-sky-700',
  TRANSCRICAO:     'bg-fuchsia-100 text-fuchsia-700',
};

const corModulo = (m: string) => MODULO_COR[m] ?? 'bg-gray-100 text-gray-600';

const PERIODO_LABEL: Record<Periodo, string> = {
  '7d':  'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  'mes': 'Mês atual',
};

// ─── Subcomponentes ───────────────────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color = 'emerald', loading = false,
}: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  color?: 'emerald' | 'blue' | 'amber' | 'red'; loading?: boolean;
}) {
  const colors = {
    emerald: 'bg-emerald-50 text-emerald-600',
    blue:    'bg-blue-50 text-blue-600',
    amber:   'bg-amber-50 text-amber-600',
    red:     'bg-red-50 text-red-600',
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors[color]}`}>
          <Icon size={20} />
        </div>
      </div>
      <div className="mt-4">
        {loading ? (
          <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        )}
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function MiniBar({ label, value, max, color = '#059669' }: {
  label: string; value: number; max: number; color?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span className="truncate max-w-[60%]">{labelOperacao(label)}</span>
        <span className="font-semibold">{formatUsd(value)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function EvolucaoChart({ data }: { data: DiaEvol[] }) {
  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-gray-300 text-sm">
      Sem dados suficientes
    </div>
  );

  const maxCusto = Math.max(...data.map(d => d.custoUsd), 0.0001);

  return (
    <div className="flex items-end gap-1 h-32 mt-2">
      {data.slice(-30).map((d, i) => {
        const h = Math.max((d.custoUsd / maxCusto) * 100, 2);
        const dataFmt = formatDateShort(d.data);
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
            <div
              className="w-full rounded-t bg-emerald-400 hover:bg-emerald-600 transition-colors cursor-default"
              style={{ height: `${h}%` }} />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
              {dataFmt}<br />
              {d.chamadas} chamadas<br />
              {formatUsd(d.custoUsd)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AiUsageDashboard() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const isAdmin   = user?.role?.toUpperCase() === 'ADMIN';

  const [periodo,   setPeriodo]   = useState<Periodo>('30d');
  const [resumo,    setResumo]    = useState<Resumo | null>(null);
  const [evolucao,  setEvolucao]  = useState<DiaEvol[]>([]);
  const [projecao,  setProjecao]  = useState<Projecao | null>(null);
  const [logs,      setLogs]      = useState<LogItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [logPage,   setLogPage]   = useState(1);
  const [logTotal,  setLogTotal]  = useState(0);
  const [filtroMod, setFiltroMod] = useState<string>('');

  const carregar = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [resRes, evolRes, projRes] = await Promise.all([
        api.get(`/ai-usage/resumo?periodo=${periodo}`),
        api.get(`/ai-usage/evolucao-diaria?periodo=${periodo}`),
        api.get('/ai-usage/projecao-mensal'),
      ]);
      setResumo(resRes.data.dados);
      setEvolucao(evolRes.data.dados ?? []);
      setProjecao(projRes.data.dados);

      if (isAdmin) {
        const qs = new URLSearchParams({ page: String(logPage), limit: '20', periodo });
        if (filtroMod) qs.set('modulo', filtroMod);
        const logRes = await api.get(`/ai-usage/log-recente?${qs.toString()}`);
        if (logRes.data) {
          setLogs(logRes.data.dados ?? []);
          setLogTotal(logRes.data.paginacao?.total ?? 0);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar dashboard de IA:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [periodo, logPage, isAdmin, filtroMod]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { setLogPage(1); }, [filtroMod, periodo]);

  const maxCustoOperacao = Math.max(...(resumo?.topOperacoes.map(o => o.custoUsd) ?? [0]));

  return (
    <PageContainer maxWidth="7xl">
      <div className="w-full">

        {/* Voltar */}
        <button onClick={() => navigate('/')}
          className="flex items-center gap-2 text-emerald-700 hover:text-emerald-800 font-medium mb-4 mt-6 text-sm">
          <ArrowLeft size={18} /> Voltar
        </button>

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Monitoramento de IA</h1>
            <p className="text-sm text-gray-500 mt-0.5">Consumo e custo de LLM em tempo real</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Seletor de período */}
            <div className="flex gap-1 bg-white border border-gray-200 rounded-2xl p-1">
              {(Object.keys(PERIODO_LABEL) as Periodo[]).map(p => (
                <button key={p} onClick={() => setPeriodo(p)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    periodo === p ? 'bg-emerald-700 text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}>
                  {p === 'mes' ? 'Este mês' : p}
                </button>
              ))}
            </div>
            {/* Atualizar */}
            <button onClick={() => carregar(true)} disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-xl text-xs text-gray-500 bg-white hover:bg-gray-50 transition-colors">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Atualizar
            </button>
          </div>
        </div>

        {/* ── Cards de resumo ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard icon={Zap}          label="Total de chamadas"    color="emerald"
            value={loading ? '...' : String(resumo?.totalChamadas ?? 0)}
            sub={PERIODO_LABEL[periodo]} loading={loading} />
          <StatCard icon={BarChart2}    label="Tokens consumidos"    color="blue"
            value={loading ? '...' : formatTokens(resumo?.totalTokens ?? 0)}
            sub="entrada + saída" loading={loading} />
          <StatCard icon={DollarSign}   label="Custo total"          color="amber"
            value={loading ? '...' : formatUsd(resumo?.custoTotalUsd ?? 0)}
            sub={loading ? '' : formatBrl(resumo?.custoTotalBrl ?? 0)} loading={loading} />
          <StatCard icon={Clock}        label="Latência média"       color="blue"
            value={loading ? '...' : `${resumo?.mediaLatenciaMs ?? 0} ms`}
            sub="chamadas com sucesso" loading={loading} />
        </div>

        {/* ── Segunda linha ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

          {/* Evolução diária */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Custo diário (USD)</h2>
              <span className="text-xs text-gray-400">{PERIODO_LABEL[periodo]}</span>
            </div>
            {loading
              ? <div className="h-32 bg-gray-50 rounded-xl animate-pulse mt-2" />
              : <EvolucaoChart data={evolucao} />
            }
            {/* Eixo X simplificado */}
            {!loading && evolucao.length > 0 && (
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-gray-400">
                  {formatDateShort(evolucao[0]?.data)}
                </span>
                <span className="text-[10px] text-gray-400">
                  {formatDateShort(evolucao[evolucao.length - 1]?.data)}
                </span>
              </div>
            )}
          </div>

          {/* Top operações */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Custo por operação</h2>
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 bg-gray-50 rounded animate-pulse mb-3" />
                ))
              : resumo?.topOperacoes.length === 0
                ? <p className="text-xs text-gray-400 text-center py-6">Sem dados no período</p>
                : resumo?.topOperacoes.map(op => (
                    <MiniBar key={op.operacao} label={op.operacao}
                      value={op.custoUsd} max={maxCustoOperacao} />
                  ))
            }
          </div>
        </div>

        {/* ── Consumo por cliente (metering) — ADMIN ── */}
        {isAdmin && (
          <ConsumoPorClienteIA periodo={periodo} formatTokens={formatTokens} formatUsd={formatUsd} />
        )}

        {/* ── Consumo por módulo ── */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Consumo por módulo</h2>
              <p className="text-xs text-gray-400 mt-0.5">Quem chamou a LLM em {PERIODO_LABEL[periodo].toLowerCase()}</p>
            </div>
            <span className="text-xs text-gray-400">{resumo?.porModulo?.length ?? 0} módulos</span>
          </div>

          {loading ? (
            <p className="text-center py-10 text-gray-400 text-sm">Carregando...</p>
          ) : (resumo?.porModulo?.length ?? 0) === 0 ? (
            <p className="text-center py-10 text-gray-300 text-sm">Nenhuma chamada no período</p>
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="md:hidden divide-y divide-gray-50">
                {resumo?.porModulo.map(m => (
                  <div key={m.modulo} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${corModulo(m.modulo)}`}>
                        {labelModulo(m.modulo)}
                      </span>
                      <span className="text-xs font-semibold text-emerald-700">{formatUsd(m.custoUsd)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
                      <span>{m.chamadas} chamadas</span>
                      <span>{formatTokens(m.tokens)} tokens</span>
                      <span>{formatTokens(m.mediaTokens)}/chamada</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: tabela */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left  px-5 py-3 text-xs font-medium text-gray-400">Módulo</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Chamadas</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Tokens entrada</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Tokens saída</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Total</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Média/chamada</th>
                      <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo?.porModulo.map(m => (
                      <tr key={m.modulo} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${corModulo(m.modulo)}`}>
                            {labelModulo(m.modulo)}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-700 text-right font-medium">{m.chamadas}</td>
                        <td className="px-5 py-3 text-xs text-gray-500 text-right">{formatTokens(m.tokensEntrada)}</td>
                        <td className="px-5 py-3 text-xs text-gray-500 text-right">{formatTokens(m.tokensSaida)}</td>
                        <td className="px-5 py-3 text-xs text-gray-700 text-right font-medium">{formatTokens(m.tokens)}</td>
                        <td className="px-5 py-3 text-xs text-gray-500 text-right">{formatTokens(m.mediaTokens)}</td>
                        <td className="px-5 py-3 text-xs text-emerald-700 text-right font-semibold">{formatUsd(m.custoUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ── Projeção mensal ── */}
        {projecao && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-emerald-600" />
              <h2 className="text-sm font-semibold text-gray-800">Projeção para 30 dias</h2>
              <span className="text-xs text-gray-400 ml-1">baseado nos {projecao.baseObservada}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Chamadas estimadas', value: String(projecao.projecao30dias.chamadas) },
                { label: 'Tokens estimados',   value: formatTokens(projecao.projecao30dias.tokens) },
                { label: 'Custo estimado USD', value: formatUsd(projecao.projecao30dias.custoUsd) },
                { label: 'Custo estimado BRL', value: formatBrl(projecao.projecao30dias.custoBrl), highlight: true },
              ].map(({ label, value, highlight }) => (
                <div key={label} className={`rounded-xl p-4 ${highlight ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50'}`}>
                  <p className={`text-xl font-bold ${highlight ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Taxa de erro ── */}
        {resumo && resumo.totalErros > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">
                {resumo.totalErros} {resumo.totalErros === 1 ? 'erro detectado' : 'erros detectados'}
                {' '}({resumo.taxaErroPercent}% das chamadas)
              </p>
              <p className="text-xs text-red-500 mt-0.5">
                Verifique o log detalhado para diagnóstico
              </p>
            </div>
          </div>
        )}

        {/* ── Log recente (apenas ADMIN) ── */}
        {isAdmin && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-gray-800">Log de chamadas</h2>
                <p className="text-xs text-gray-400 mt-0.5">Tokens de entrada e saída por chamada</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={filtroMod}
                  onChange={e => setFiltroMod(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs text-gray-600 bg-white"
                >
                  <option value="">Todos os módulos</option>
                  {resumo?.porModulo.map(m => (
                    <option key={m.modulo} value={m.modulo}>{labelModulo(m.modulo)}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-400">{logTotal} registros</span>
              </div>
            </div>

            {loading ? (
              <p className="text-center py-10 text-gray-400 text-sm">Carregando...</p>
            ) : logs.length === 0 ? (
              <p className="text-center py-10 text-gray-300 text-sm">Nenhuma chamada registrada</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Data/hora</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Módulo</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Operação</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Modelo</th>
                        <th className="text-left px-5 py-3 text-xs font-medium text-gray-400">Usuário</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Entrada</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Saída</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Total</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Custo</th>
                        <th className="text-right px-5 py-3 text-xs font-medium text-gray-400">Latência</th>
                        <th className="text-center px-5 py-3 text-xs font-medium text-gray-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log => (
                        <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-5 py-3 text-xs text-gray-500">
                            {formatDateTime(log.createdAt)}
                          </td>
                          <td className="px-5 py-3">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg whitespace-nowrap ${corModulo(log.modulo)}`}>
                              {labelModulo(log.modulo)}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs font-medium text-gray-700">
                            {labelOperacao(log.operacao)}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-500 font-mono">
                            {log.modelo}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-500">{log.usuario}</td>
                          <td className="px-5 py-3 text-xs text-gray-500 text-right">
                            {formatTokens(log.tokensEntrada)}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-500 text-right">
                            {formatTokens(log.tokensSaida)}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-700 text-right font-medium">
                            {formatTokens(log.tokensTotal)}
                          </td>
                          <td className="px-5 py-3 text-xs text-emerald-700 text-right font-semibold">
                            {formatUsd(log.custoUsd)}
                          </td>
                          <td className="px-5 py-3 text-xs text-gray-500 text-right">
                            {log.latenciaMs}ms
                          </td>
                          <td className="px-5 py-3 text-center">
                            {log.sucesso
                              ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                              : <span title={log.erroMensagem ?? ''}>
                                  <XCircle size={14} className="text-red-400 mx-auto" />
                                </span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Paginação */}
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    Página {logPage} de {Math.ceil(logTotal / 20)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setLogPage(p => Math.max(1, p - 1))}
                      disabled={logPage === 1}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      ← Anterior
                    </button>
                    <button
                      onClick={() => setLogPage(p => p + 1)}
                      disabled={logPage >= Math.ceil(logTotal / 20)}
                      className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">
                      Próxima →
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </PageContainer>
  );
}