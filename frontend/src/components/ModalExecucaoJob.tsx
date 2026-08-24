// src/components/ModalExecucaoJob.tsx
// Rastro passo a passo de uma tarefa agendada executada MANUALMENTE pelo ADMIN
// (POST /monitoracao/agendas/:chave/executar) — o "set -x" dos crons.
//
// POR QUE ESTA TELA EXISTE: a Monitoração só registra execução quando houve TRABALHO ou
// ERRO. Uma tarefa que roda, decide "hoje não é dia" e termina não deixa rastro nenhum,
// e fica indistinguível de uma que nunca rodou porque o servidor estava fora do ar. Aqui
// aparece a DECISÃO — qual configuração foi lida, o que ela determinou e por que cada
// registro foi ou não tocado.
import { X, Loader2, AlertTriangle } from 'lucide-react';

export interface ResultadoJob {
  chave: string;
  nome: string;
  expr: string;
  ativo: boolean;
  duracaoMs: number;
  trace: string[];
  erro?: string;
}

interface Props {
  aberto: boolean;
  nome: string;
  executando: boolean;
  resultado: ResultadoJob | null;
  erro: string | null;
  onFechar: () => void;
}

export default function ModalExecucaoJob({ aberto, nome, executando, resultado, erro, onFechar }: Props) {
  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 rounded-t-2xl">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900 truncate">{nome}</h3>
            <p className="text-xs text-gray-500">
              {executando ? 'Executando agora…' : 'Rastro da execução manual'}
            </p>
          </div>
          {/* Cinza é a cor do X de fechar modal — cromo, não ação do registro (CLAUDE.md §6). */}
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {executando && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
              <Loader2 className="animate-spin text-emerald-600" size={20} />
              A tarefa está rodando para todas as empresas ativas…
            </div>
          )}

          {!executando && erro && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{erro}</span>
            </div>
          )}

          {!executando && resultado && (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mb-3">
                <span>agenda: <span className="font-mono text-gray-700">{resultado.expr}</span></span>
                {!resultado.ativo && <span className="text-amber-600 font-semibold">agenda DESLIGADA</span>}
                <span>duração: {(resultado.duracaoMs / 1000).toFixed(2)}s</span>
              </div>

              {/* O rastro rola dentro do próprio bloco: linha de trace é longa e não pode
                  empurrar a página para o lado (CLAUDE.md — nada de scroll horizontal no body). */}
              <pre className="bg-gray-900 text-gray-100 text-[11px] leading-relaxed rounded-xl p-3 overflow-x-auto whitespace-pre">
                {resultado.trace.length ? resultado.trace.join('\n') : '(a tarefa não registrou nenhum passo)'}
              </pre>

              {resultado.erro && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-red-700 mb-1">Exceção</p>
                  <pre className="bg-red-50 border border-red-200 text-red-800 text-[11px] rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
                    {resultado.erro}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button
            onClick={onFechar}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800 rounded-xl">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
