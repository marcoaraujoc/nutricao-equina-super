// frontend/src/components/ProgressoEnvio.tsx
// Barra de progresso do envio de documento (WhatsApp / e-mail) — card ÚNICO,
// centralizado na tela, que acompanha a operação do início ao fim.
//
// 🔴 O PERCENTUAL É REAL. Cada valor vem de um marco que ACONTECEU no servidor
// (prontidão conferida → PDF gerado, já com o tamanho medido → mensagem aceita),
// transmitido linha a linha por `POST /documentos/{whatsapp,email}` em NDJSON.
// Entre um marco e o próximo a barra NÃO anda — ela não é preenchida por relógio.
// A alternativa (avançar por estimativa de tempo) foi descartada: o número ficaria
// bonito e mentiria, e "nada de inventar valor" é regra deste projeto (CLAUDE.md).
// Por isso a barra tem transição suave de 300ms: o salto entre marcos é um fato,
// mas não precisa ser brusco na tela.
//
// ⚠️ NÃO usa `react-hot-toast`, ao contrário dos outros avisos deste fluxo, e o
// motivo é técnico: o toast é renderizado dentro de um wrapper com `transform`
// (a animação de entrada), e `position: fixed` dentro de um elemento transformado
// passa a ser relativo a ELE, não à viewport — não há CSS que centralize o card na
// página a partir de lá. Por isso este componente monta o próprio portal no
// `<body>`. Os toasts de RESULTADO (sucesso / "PDF baixado, anexe…") continuam
// saindo pelo react-hot-toast, em `utils/compartilharPdf.ts`.
import { createRoot, type Root } from 'react-dom/client';
import { MessageCircle, Mail, X } from 'lucide-react';

export type CanalEnvio = 'whatsapp' | 'email';

/**
 * 🔴 A PARTIR DAQUI NÃO HÁ MAIS O QUE CANCELAR. 85 é o marco "Enviando ao
 * WhatsApp"/"Enviando o e-mail": daí em diante a mensagem está a caminho do
 * destinatário, e mensagem entregue não se desfaz. Deixar o botão ali produziria o
 * pior resultado possível — a tela dizendo "cancelado" enquanto o cliente recebe o
 * documento. Antes desse ponto o cancelamento é REAL: o backend percebe que o
 * cliente desistiu e não chega a chamar o provider (ver DocumentoCompartilharController).
 */
const PCT_SEM_VOLTA = 85;

interface Props {
  canal: CanalEnvio;
  pct:   number;
  etapa: string;
  onCancelar?: () => void;
}

function CardProgresso({ canal, pct, etapa, onCancelar }: Props) {
  const podeCancelar = !!onCancelar && pct < PCT_SEM_VOLTA;
  const Icone = canal === 'whatsapp' ? MessageCircle : Mail;
  // Paleta da ação, como no resto do sistema (CLAUDE.md §6): WhatsApp verde, e-mail azul.
  const cor  = canal === 'whatsapp' ? 'bg-green-600'   : 'bg-blue-600';
  const tint = canal === 'whatsapp' ? 'text-green-600' : 'text-blue-600';

  return (
    // ⚠️ `pointer-events-none` no wrapper de propósito: o card informa, não bloqueia.
    // Um overlay que captura clique vira armadilha se algum caminho de erro deixar de
    // fechá-lo — a tela inteira ficaria travada. Os botões de envio já se desabilitam
    // sozinhos enquanto a operação corre, então não há clique duplo a impedir aqui.
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
         role="status" aria-live="polite">
      <div className="pointer-events-auto bg-white rounded-2xl shadow-2xl ring-1 ring-black/5
                      px-6 py-5 w-[22rem] max-w-[90vw]">
        <div className="flex items-center gap-2.5 mb-3">
          <Icone className={`w-5 h-5 shrink-0 ${tint}`} />
          <span className="text-sm font-medium text-gray-800 truncate">{etapa}</span>
          {/* `tabular-nums` evita o número "dançar" de largura ao ir de 9% para 70% */}
          <span className="ml-auto text-base font-semibold text-gray-600 tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${cor} transition-[width] duration-300 ease-out`}
               style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>

        {/* O botão SAI de cena passando do ponto sem volta, em vez de ficar
            desabilitado: um "Cancelar" apagado no fim do envio convida ao clique e
            depois não explica por que não funcionou. A frase que o substitui diz o
            que está acontecendo. */}
        <div className="mt-3 flex justify-end min-h-[1.75rem] items-center">
          {podeCancelar ? (
            <button type="button" onClick={onCancelar}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium
                         text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          ) : (
            <span className="text-xs text-gray-400">
              {pct >= 100 ? 'Concluído' : 'Não é mais possível cancelar'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Portal imperativo: o progresso é disparado de `utils/compartilharPdf.ts`, que é um
// módulo comum e não um componente — não há árvore React de onde renderizar. UM host
// só, reaproveitado entre envios.
let host: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * Cria/atualiza o card de progresso. Devolve um id que deve ser passado de volta nas
 * chamadas seguintes — quem tem id em mãos sabe que precisa chamar `fecharProgresso`.
 */
export function mostrarProgresso(
  canal: CanalEnvio, pct: number, etapa: string, _id?: string, onCancelar?: () => void,
): string {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  root!.render(<CardProgresso canal={canal} pct={pct} etapa={etapa} onCancelar={onCancelar} />);
  return 'progresso-envio';
}

/**
 * Fecha o card. Idempotente: chamar sem nunca ter aberto (envio que falhou antes do
 * primeiro marco) não faz nada.
 * ⚠️ O `unmount` é adiado num `setTimeout(0)`: chamá-lo durante o próprio ciclo de
 * render do React 18 dispara aviso e pode perder a atualização final (o 100%).
 */
export function fecharProgresso(id?: string): void {
  if (!id || !root) return;
  const r = root, h = host;
  root = null; host = null;
  setTimeout(() => { r.unmount(); h?.remove(); }, 0);
}
