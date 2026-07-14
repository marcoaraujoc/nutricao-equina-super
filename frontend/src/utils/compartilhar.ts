// src/utils/compartilhar.ts
// Compartilhamento de registros clínicos por WhatsApp e e-mail.
//
// WhatsApp no celular: usar `https://wa.me/?text=` com window.open('_blank')
// abre o WhatsApp Web numa nova aba em muitos navegadores mobile. Para abrir o
// APP diretamente, no celular usamos o esquema nativo `whatsapp://send?text=`
// (navegação na mesma aba). No desktop mantemos `wa.me`, que abre o WhatsApp
// Web/Desktop normalmente.

function isMobileDevice(): boolean {
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

/** Abre o cliente de e-mail padrão. `para` opcional = destinatário. */
export function abrirEmail(assunto: string, corpo: string, para?: string): void {
  const dest = para ? encodeURIComponent(para) : '';
  window.location.href = `mailto:${dest}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
}
