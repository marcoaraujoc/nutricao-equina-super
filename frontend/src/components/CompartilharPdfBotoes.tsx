// frontend/src/components/CompartilharPdfBotoes.tsx
// Par de botões WhatsApp + E-mail que mandam o PDF do documento (Puppeteer, pelo
// backend) com o telefone/e-mail do destinatário já anexado de verdade; sem
// destino ou sem provider configurado, caem no fallback manual (baixa o PDF no
// navegador e abre o app DIRETO, sem seletor de aplicativos) — ver
// utils/compartilharPdf.ts para os dois caminhos.
// Cores da ação seguem a paleta do módulo de Atendimento (CLAUDE.md §6): WhatsApp
// verde (cor da própria marca), e-mail azul.
import { useState } from 'react';
import { MessageCircle, Mail } from 'lucide-react';
import { enviarPdfWhatsAppComAviso, enviarPdfEmailComAviso, type CompartilharPdfOpcoes } from '../utils/compartilharPdf';
import AcaoRegistro from './AcaoRegistro';

export interface CompartilharPdfBotoesProps extends CompartilharPdfOpcoes {
  /** Telefone do destinatário (WhatsApp) — dígitos com DDI, ex: 5511987654321. */
  telefone?:   string | null;
  /** E-mail do destinatário — preenche o "Para" do fallback mailto:. */
  emailPara?:  string | null;
  /**
   * Roda ANTES de `gerarHtml`, no clique. É onde a tela resolve o que o HTML precisa
   * ter pronto e não pode buscar sozinho: a assinatura do profissional e as imagens
   * convertidas para `data:` (o PDF sai do Puppeteer, que bloqueia toda requisição
   * que não seja `data:` — sem isso a foto e a logo nascem quebradas no arquivo que
   * chega ao cliente).
   * ⚠️ `gerarHtml` é SÍNCRONO de propósito: é ele que roda dentro da janela de "user
   * activation" do navegador, de que o fallback manual depende para abrir o app.
   * O preparo assíncrono mora aqui, separado.
   */
  aoPreparar?: () => Promise<void>;
  /** Desabilita os dois botões (ex.: enquanto o documento ainda não existe). */
  disabled?:   boolean;
  size?:       number;
  className?:  string;
}

export default function CompartilharPdfBotoes({
  telefone, emailPara, disabled, aoPreparar, size = 14, className = '', ...opts
}: CompartilharPdfBotoesProps) {
  const [enviando, setEnviando] = useState<'whatsapp' | 'email' | null>(null);

  // Os avisos vivem em utils/compartilharPdf.ts para que este componente e as
  // telas com fluxo próprio (ex.: o receituário de controle especial da
  // Prescrição) digam exatamente a mesma coisa ao usuário.
  const handleWhatsApp = async () => {
    setEnviando('whatsapp');
    try {
      await aoPreparar?.();
      await enviarPdfWhatsAppComAviso(opts, telefone);
    } finally { setEnviando(null); }
  };

  const handleEmail = async () => {
    setEnviando('email');
    try {
      await aoPreparar?.();
      await enviarPdfEmailComAviso(opts, emailPara);
    } finally { setEnviando(null); }
  };

  // Os dois saem por `AcaoRegistro`: ícone no desktop, botão com rótulo no mobile —
  // a mesma forma que WhatsApp/E-mail têm no resto do sistema. `size` continua na
  // assinatura por compatibilidade, mas quem dita o tamanho agora é o breakpoint.
  return (
    <>
      <AcaoRegistro tom="whatsapp" icone={MessageCircle} rotulo="WhatsApp"
        titulo="Enviar por WhatsApp" className={className}
        desabilitado={disabled || enviando !== null} carregando={enviando === 'whatsapp'}
        onClick={handleWhatsApp} />
      <AcaoRegistro tom="email" icone={Mail} rotulo="E-mail"
        titulo="Enviar por e-mail" className={className}
        desabilitado={disabled || enviando !== null} carregando={enviando === 'email'}
        onClick={handleEmail} />
    </>
  );
}
