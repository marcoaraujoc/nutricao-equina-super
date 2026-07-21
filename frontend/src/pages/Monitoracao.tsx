// src/pages/Monitoracao.tsx
// Monitoração das tarefas agendadas (cron) — ADMIN.
// Mostra os alertas/execuções por período (dia, semana, mês).
import { useState, useEffect, useCallback } from 'react';
import { Activity, Loader2, CheckCircle2, XCircle, Mail, AlertCircle, X } from 'lucide-react';
import api from '../services/api';
import PageContainer from '../components/PageContainer';
import BotaoVoltar from '../components/BotaoVoltar';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';

type Periodo = 'dia' | 'semana' | 'mes';

interface PorTarefa {
  nome: string; execucoes: number; sucessos: number; erros: number; alertas: number; ultima: string | null;
}
interface Execucao {
  id: number; nome: string; ok: boolean; resumo: string | null; erro: string | null;
  notificado: boolean; executadoEm: string;
}
interface Dados {
  periodo: Periodo;
  totais: { total: number; sucessos: number; erros: number; alertas: number };
  porTarefa: PorTarefa[];
  execucoes: Execucao[];
}

const PERIODOS: { v: Periodo; l: string }[] = [
  { v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' },
];

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export default function Monitoracao() {
  const { user } = useAuth();
  const { isGestor } = usePermissoes();
  const isAdmin = isGestor || user?.userType === 'ADMIN'; // ADMIN ou GESTOR

  const [periodo, setPeriodo] = useState<Periodo>('dia');
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(true);
  const [detalhe, setDetalhe] = useState<Execucao | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/monitoracao/execucoes', { params: { periodo } });
      if (!res.data) return;
      setDados(res.data.dados as Dados);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  }, [periodo]);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    carregar();
  }, [isAdmin, carregar]);

  if (!isAdmin) {
    return (
      <PageContainer maxWidth="5xl">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">A Monitoração é restrita ao administrador.</p>
        </div>
      </PageContainer>
    );
  }

  const tiles = [
    { label: 'Execuções', valor: dados?.totais.total ?? 0, cls: 'text-gray-900' },
    { label: 'Sucessos',  valor: dados?.totais.sucessos ?? 0, cls: 'text-emerald-700' },
    { label: 'Erros',     valor: dados?.totais.erros ?? 0, cls: (dados?.totais.erros ?? 0) > 0 ? 'text-red-600' : 'text-gray-900' },
    { label: 'Alertas enviados', valor: dados?.totais.alertas ?? 0, cls: 'text-indigo-600' },
  ];

  return (
    <PageContainer maxWidth="5xl">
      <BotaoVoltar className="mb-4" />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Activity size={22} className="text-emerald-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Monitoração</h1>
            <p className="text-xs text-gray-400">Tarefas agendadas e alertas enviados por e-mail</p>
          </div>
        </div>
        {/* Seletor de período */}
        <div className="inline-flex rounded-xl bg-gray-100 p-0.5 self-end sm:self-auto">
          {PERIODOS.map(p => (
            <button key={p.v} onClick={() => setPeriodo(p.v)}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                periodo === p.v ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-emerald-600" size={30} /></div>
      ) : (
        <div className="space-y-4">
          {/* Totais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map(t => (
              <div key={t.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t.label}</p>
                <p className={`text-2xl font-bold mt-1 ${t.cls}`}>{t.valor}</p>
              </div>
            ))}
          </div>

          {/* Resumo por tarefa */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Por tarefa</p>
            </div>
            {(!dados || dados.porTarefa.length === 0) ? (
              <p className="text-center text-sm text-gray-400 py-8">Nenhuma execução registrada no período.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {dados.porTarefa.map(t => (
                  <div key={t.nome} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{t.nome}</p>
                      <p className="text-[11px] text-gray-400">Última: {fmt(t.ultima)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 text-[11px] font-bold">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">{t.sucessos} ok</span>
                      {t.erros > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700">{t.erros} erro{t.erros > 1 ? 's' : ''}</span>}
                      {t.alertas > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600"><Mail size={10} />{t.alertas}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Histórico de eventos */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Eventos ({dados?.execucoes.length ?? 0})</p>
            </div>
            {(!dados || dados.execucoes.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-300">
                <CheckCircle2 size={30} className="mb-2 text-emerald-300" />
                <p className="text-sm text-gray-400">Nenhum alerta ou erro no período — tudo tranquilo.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {dados.execucoes.map(e => (
                  <button key={e.id} onClick={() => setDetalhe(e)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {e.ok ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" /> : <XCircle size={14} className="text-red-500 flex-shrink-0" />}
                        <span className="text-sm font-semibold text-gray-800 truncate">{e.nome}</span>
                        {e.notificado && <span title="Alerta enviado por e-mail"><Mail size={12} className="text-indigo-400 flex-shrink-0" /></span>}
                      </div>
                      <span className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">{fmt(e.executadoEm)}</span>
                    </div>
                    {e.ok ? (
                      <p className="text-xs text-gray-500 pl-5 truncate">{e.resumo ?? '—'}</p>
                    ) : (
                      <p className="text-xs text-red-600 pl-5 flex items-start gap-1">
                        <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                        <span className="truncate">{(e.erro ?? 'Erro').split('\n')[0]}</span>
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detalhe da execução: o que foi feito / para quem / o que foi enviado ── */}
      {detalhe && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4"
          onClick={() => setDetalhe(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[85vh] flex flex-col border border-gray-100"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {detalhe.ok ? <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" /> : <XCircle size={16} className="text-red-500 flex-shrink-0" />}
                <h3 className="font-bold text-gray-900 truncate">{detalhe.nome}</h3>
              </div>
              <button onClick={() => setDetalhe(null)} className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="font-semibold">Executado em:</span> {fmt(detalhe.executadoEm)}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-gray-500">Status:</span>
                <span className={`px-2 py-0.5 rounded-full font-bold ${detalhe.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  {detalhe.ok ? 'Sucesso' : 'Erro'}
                </span>
                {detalhe.notificado && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-bold">
                    <Mail size={10} /> Alerta enviado ao admin
                  </span>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                  {detalhe.ok ? 'O que foi feito' : 'Detalhe do erro'}
                </p>
                <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-xl p-3 whitespace-pre-wrap break-words font-sans">
                  {(detalhe.ok ? detalhe.resumo : detalhe.erro) || 'Sem detalhes registrados para esta execução.'}
                </pre>
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setDetalhe(null)}
                className="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 font-medium hover:bg-gray-50 transition-colors">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
