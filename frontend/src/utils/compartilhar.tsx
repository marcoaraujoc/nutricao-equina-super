// src/utils/compartilhar.tsx
// Compartilhamento de registros clínicos por WhatsApp e e-mail.
//
// WhatsApp no celular: usar `https://wa.me/?text=` com window.open('_blank')
// abre o WhatsApp Web numa nova aba em muitos navegadores mobile. Para abrir o
// APP diretamente, no celular usamos o esquema nativo `whatsapp://send?text=`
// (navegação na mesma aba). No desktop mantemos `wa.me`, que abre o WhatsApp
// Web/Desktop normalmente.

import toast from 'react-hot-toast';
import { Mail, Copy, ExternalLink } from 'lucide-react';

export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(navigator.userAgent);
}

/**
 * Abre o WhatsApp (app no celular, web no desktop) com o texto pré-preenchido.
 * Se `telefone` for informado (apenas dígitos, formato internacional — Brasil:
 * 55+DDD+número), abre a conversa direto com aquele contato.
 */
export function abrirWhatsApp(texto: string, telefone?: string): void {
  const encoded = encodeURIComponent(texto);
  const fone = (telefone ?? '').replace(/\D/g, '');
  if (isMobileDevice()) {
    // Esquema nativo — abre o aplicativo do WhatsApp diretamente.
    window.location.href = fone
      ? `whatsapp://send?phone=${fone}&text=${encoded}`
      : `whatsapp://send?text=${encoded}`;
  } else {
    window.open(fone ? `https://wa.me/${fone}?text=${encoded}` : `https://wa.me/?text=${encoded}`, '_blank');
  }
}

function textoCopiavelEmail(assunto: string, corpo: string, para?: string): string {
  return [
    `Para: ${para || '(destinatário não informado)'}`,
    `Assunto: ${assunto}`,
    '',
    corpo,
  ].join('\n');
}

/**
 * Link do Gmail com o compose já preenchido — alternativa ao `mailto:` que
 * NÃO depende de nenhum cliente de e-mail instalado nem de permissão de
 * protocolo do navegador: é uma URL https normal, abre numa aba. Só funciona
 * para quem usa Gmail (pede login se não houver sessão do Google no
 * navegador) — por isso é OFERECIDA como opção, nunca a única via.
 */
function urlGmailCompose(assunto: string, corpo: string, para?: string): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', su: assunto, body: corpo });
  if (para) params.set('to', para);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Abre o cliente de e-mail padrão (mailto:). `para` opcional = destinatário.
 *
 * O navegador pode BLOQUEAR o mailto: em silêncio — sem erro, sem aba, sem
 * nada — quando a permissão de protocolo já foi negada uma vez para esta
 * origem (o navegador lembra a escolha e não pergunta de novo). Como não há
 * como a aplicação detectar esse bloqueio, todo clique também mostra um toast
 * com os mesmos dados prontos para copiar e um atalho para o Gmail (que
 * funciona sempre, por ser uma URL comum) — reforço, não substituto do mailto:.
 */
export function abrirEmail(assunto: string, corpo: string, para?: string): void {
  const dest = para ? encodeURIComponent(para) : '';
  window.location.href = `mailto:${dest}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;

  const textoCompleto = textoCopiavelEmail(assunto, corpo, para);
  toast.custom((t) => (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-sm w-full flex gap-3">
      <Mail size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">Abrindo seu app de e-mail…</p>
        <p className="text-xs text-gray-500 mt-0.5">Se nada abrir, use uma das opções abaixo.</p>
        {para && <p className="text-xs text-gray-400 mt-1 truncate">Para: {para}</p>}
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            onClick={() => {
              window.open(urlGmailCompose(assunto, corpo, para), '_blank');
              toast.dismiss(t.id);
            }}
            className="flex items-center gap-1 px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <ExternalLink size={12} /> Abrir no Gmail
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(textoCompleto);
                toast.success('Copiado!');
              } catch {
                toast.error('Não foi possível copiar.');
              }
              toast.dismiss(t.id);
            }}
            className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <Copy size={12} /> Copiar dados
          </button>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="px-2.5 py-1 text-gray-500 hover:text-gray-700 text-xs font-semibold"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  ), { duration: 10000 });
}
