// src/components/AvisoRegistroAssumido.tsx
//
// AVISO DE REGISTRO PERDIDO — outro profissional assumiu ou alterou o registro
// que esta tela tem aberto.
//
// 🔴 A TELA NÃO FECHA E O TEXTO NÃO SOME. Quem estava escrevendo continua vendo
// o que digitou: o conteúdo local é preservado para a pessoa copiar o que
// importa. O que muda é que os campos ficam em SOMENTE LEITURA e o Salvar sai —
// botão que só falha depois do clique é a pior das saídas (armadilha 28-d).
//
// ⚠️ NÃO existe "mesclar automaticamente". Juntar dois textos clínicos sem uma
// regra de negócio explícita produz um prontuário que ninguém escreveu — e que
// leva a assinatura de alguém. As duas saídas oferecidas são DESCARTAR e
// ATUALIZAR (recarregar o que está gravado); o que a pessoa quiser aproveitar do
// próprio texto, ela copia.
//
// ⚠️ Não é `AcaoRegistro`: isto é um estado da TELA, não uma ação sobre a linha
// de um registro. Por isso a paleta âmbar de aviso, e não a da §6.

import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  /** Nome de quem assumiu. `null` = não foi possível resolver — a frase fica genérica. */
  porNome?:   string | null;
  /** Instante da tomada, ISO. Omitido quando o backend não o informou. */
  em?:        string | null;
  /** Rótulo do registro na frase ("evolução", "agendamento"). */
  registro?:  string;
  /** Recarrega do servidor. Obrigatório: sem saída, o aviso vira beco sem saída. */
  onAtualizar: () => void;
  /** Some com o texto local não gravado. Opcional — só aparece se houver rascunho. */
  onDescartar?: () => void;
  atualizando?: boolean;
}

/** "às 19:42" no fuso de quem olha — nunca fixo em Brasília (§6). */
function horaDe(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return ` às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function AvisoRegistroAssumido({
  porNome, em, registro = 'evolução', onAtualizar, onDescartar, atualizando = false,
}: Props) {
  const quem = porNome?.trim();
  const frase = quem
    ? `Esta ${registro} foi assumida por ${quem}${horaDe(em)}.`
    : `Esta ${registro} foi assumida por outro profissional${horaDe(em)}.`;

  return (
    <div
      // `role="alert"` + `aria-live`: o estado muda sozinho, sem clique nenhum —
      // sem isto, quem usa leitor de tela continua digitando sem saber.
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{frase}</p>
          <p className="mt-1 text-amber-800">
            Você não possui mais permissão para editar este registro. O texto que
            você digitou continua na tela para conferência, mas <strong>não foi
            gravado</strong> — copie o que precisar antes de atualizar.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAtualizar}
              disabled={atualizando}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${atualizando ? 'animate-spin' : ''}`} aria-hidden />
              {atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            {onDescartar && (
              <button
                type="button"
                onClick={onDescartar}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                Descartar minhas alterações
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
