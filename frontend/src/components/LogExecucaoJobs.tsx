// src/components/LogExecucaoJobs.tsx
//
// Log de execução das tarefas agendadas, na tela de Configuração.
//
// POR QUE EXISTE: até 2026-08-28 só entrava no histórico a execução que fez TRABALHO ou
// deu ERRO. Com isso, "a tarefa rodou e não havia o que fazer" ficava idêntico a "a
// tarefa não rodou" — as duas produziam a mesma coisa: nada. Foi assim que 7
// prescrições com a janela de tratamento vencida ficaram dias sem cancelamento: o job
// não rodava (servidor fora do ar às 23:40) e a ausência de registro parecia normal.
// Agora TODA execução vira linha, e a pergunta "essa tarefa rodou?" tem resposta.
//
// A janela é de 15 DIAS — é o que o job `expurgo_execucoes_cron` preserva. Guardar mais
// transformaria o log num arquivo morto que ninguém lê e que só engorda o backup.

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Play, Clock, Mail } from 'lucide-react';
import api from '../services/api';
import InlineError from './InlineError';
import { formatDataHora } from '../utils/dateUtils';

type Periodo = 'dia' | 'semana' | 'mes';

interface Execucao {
  id:          number;
  nome:        string;
  ok:          boolean;
  resumo:      string | null;
  erro:        string | null;
  notificado:  boolean;
  origem:      string;
  duracaoMs:   number | null;
  executadoEm: string;
}

interface Totais { total: number; sucessos: number; erros: number; alertas: number }

const PERIODOS: { chave: Periodo; label: string }[] = [
  { chave: 'dia',    label: 'Hoje'          },
  { chave: 'semana', label: 'Últimos 7 dias' },
  { chave: 'mes',    label: 'Últimos 30 dias' },
];

/** ms → "1,2 s" / "340 ms". Duração é o que denuncia o job que passou a demorar demais. */
const formatDuracao = (ms: number | null): string => {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
};

export default function LogExecucaoJobs() {
  const [periodo,   setPeriodo]   = useState<Periodo>('semana');
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [totais,    setTotais]    = useState<Totais | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [erro,      setErro]      = useState<string | null>(null);
  const [aberta,    setAberta]    = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await api.get(`/monitoracao/execucoes?periodo=${periodo}`);
      if (!res.data) { setExecucoes([]); setTotais(null); return; } // GET 403 → null
      setExecucoes(res.data.dados?.execucoes ?? []);
      setTotais(res.data.dados?.totais ?? null);
    } catch {
      setErro('Erro ao carregar o log de execução das tarefas.');
    } finally {
      setLoading(false);
    }
  }, [periodo]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold text-gray-800">Log de execução das tarefas</h2>
        <button onClick={carregar} disabled={loading}
          title="Atualizar"
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-xs font-medium transition-colors">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Atualizar
        </button>
      </div>
      <p className="text-gray-500 mb-3 text-xs">
        Toda execução é registrada — inclusive a que não teve trabalho, que é o que
        distingue “rodou e não havia o que fazer” de “não rodou”. Mantido por 15 dias.
      </p>

      <div className="bg-white shadow rounded-3xl p-5 sm:p-8">
        <InlineError message={erro} className="mb-4" />

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {PERIODOS.map(p => (
            <button key={p.chave} onClick={() => setPeriodo(p.chave)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                periodo === p.chave
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
              }`}>
              {p.label}
            </button>
          ))}
          {totais && (
            <span className="text-[11px] text-gray-400 ml-auto">
              {totais.total} execução(ões) · {totais.sucessos} ok · {totais.erros} com erro
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-emerald-600" /></div>
        ) : execucoes.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-sm text-gray-400">Nenhuma execução registrada no período.</p>
            <p className="text-xs text-gray-300 mt-1">
              Se as tarefas estão ligadas e nada aparece aqui, o servidor não estava no ar no horário delas.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {execucoes.map(e => {
              // Resumo e erro são textos longos (o diário lista uma linha por empresa);
              // a linha mostra o começo e o clique abre o inteiro. Cortar sem dar como
              // ver o resto esconde justamente o que explica a execução.
              const detalhe = e.erro ?? e.resumo ?? '';
              const expandida = aberta === e.id;
              return (
                <li key={e.id} className="py-2.5">
                  <button onClick={() => setAberta(expandida ? null : e.id)}
                    className="w-full text-left flex items-start gap-2">
                    {e.ok
                      ? <CheckCircle2 size={15} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                      : <XCircle      size={15} className="text-red-500 flex-shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{e.nome}</span>
                        {e.origem === 'MANUAL' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
                            <Play size={9} /> manual
                          </span>
                        )}
                        {e.notificado && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                            <Mail size={9} /> alerta enviado
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                        <span>{formatDataHora(e.executadoEm)}</span>
                        <span className="inline-flex items-center gap-1"><Clock size={10} />{formatDuracao(e.duracaoMs)}</span>
                      </p>
                      {detalhe && (
                        <p className={`text-xs mt-1 whitespace-pre-wrap ${e.ok ? 'text-gray-600' : 'text-red-600'} ${expandida ? '' : 'line-clamp-2'}`}>
                          {detalhe}
                        </p>
                      )}
                      {!detalhe && (
                        <p className="text-xs text-gray-400 mt-1">Sem trabalho nesta execução.</p>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
