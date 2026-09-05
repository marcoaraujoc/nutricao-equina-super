// frontend/src/components/ProgressoEnvio.tsx
// Barra de progresso do envio de documento (WhatsApp / e-mail), exibida como um
// toast que se ATUALIZA — um único card que acompanha a operação do início ao fim,
// em vez de uma sequência de avisos.
//
// 🔴 O PERCENTUAL É REAL. Cada valor vem de um marco que ACONTECEU no servidor
// (prontidão conferida → PDF gerado, já com o tamanho medido → mensagem aceita),
// transmitido linha a linha por `POST /documentos/{whatsapp,email}` em NDJSON.
// Entre um marco e o próximo a barra NÃO anda — ela não é preenchida por relógio.
// A alternativa (avançar por estimativa de tempo) foi descartada: o número ficaria
// bonito e mentiria, e "nada de inventar valor" é regra deste projeto (CLAUDE.md).
// Por isso a barra tem transição suave de 300ms: o salto entre marcos é um fato,
// mas não precisa ser brusco na tela.
import toast from 'react-hot-toast';
import { MessageCircle, Mail } from 'lucide-react';

export type CanalEnvio = 'whatsapp' | 'email';

interface Props {
  canal: CanalEnvio;
  pct:   number;
  etapa: string;
}

function BarraEnvio({ canal, pct, etapa }: Props) {
  const Icone = canal === 'whatsapp' ? MessageCircle : Mail;
  // Paleta da ação, como no resto do sistema (CLAUDE.md §6): WhatsApp verde, e-mail azul.
  const cor  = canal === 'whatsapp' ? 'bg-green-600'   : 'bg-blue-600';
  const tint = canal === 'whatsapp' ? 'text-green-600' : 'text-blue-600';

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-4 py-3 w-[19rem] max-w-[90vw]"
         role="status" aria-live="polite">
      <div className="flex items-center gap-2 mb-2">
        <Icone className={`w-4 h-4 shrink-0 ${tint}`} />
        <span className="text-sm font-medium text-gray-800 truncate">{etapa}</span>
        {/* `tabular-nums` evita o número "dançar" de largura ao mudar de 9% para 70% */}
        <span className="ml-auto text-sm font-semibold text-gray-500 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${cor} transition-[width] duration-300 ease-out`}
             style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

/**
 * Cria/atualiza o toast de progresso. Devolve o id, que deve ser passado de volta
 * nas chamadas seguintes — é ele que faz o card ser ATUALIZADO em vez de empilhar
 * um toast novo a cada marco.
 * ⚠️ `duration: Infinity`: quem fecha é `fecharProgresso`, no fim da operação. Um
 * toast de progresso que some sozinho no meio do envio deixa o usuário sem saber
 * se ainda está acontecendo alguma coisa.
 */
export function mostrarProgresso(
  canal: CanalEnvio, pct: number, etapa: string, id?: string,
): string {
  return toast.custom(<BarraEnvio canal={canal} pct={pct} etapa={etapa} />,
    { id, duration: Infinity, position: 'bottom-right' });
}

export function fecharProgresso(id?: string): void {
  if (id) toast.dismiss(id);
}
