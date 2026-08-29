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
import toast from 'react-hot-toast';
import { compartilharPdfWhatsApp, compartilharPdfEmail, type CompartilharPdfOpcoes } from '../utils/compartilharPdf';
import AcaoRegistro from './AcaoRegistro';

export interface CompartilharPdfBotoesProps extends CompartilharPdfOpcoes {
  /** Telefone do destinatário (WhatsApp) — dígitos com DDI, ex: 5511987654321. */
  telefone?:   string | null;
  /** E-mail do destinatário — preenche o "Para" do fallback mailto:. */
  emailPara?:  string | null;
  /** Desabilita os dois botões (ex.: enquanto o documento ainda não existe). */
  disabled?:   boolean;
  size?:       number;
  className?:  string;
}

export default function CompartilharPdfBotoes({
  telefone, emailPara, disabled, size = 14, className = '', ...opts
}: CompartilharPdfBotoesProps) {
  const [enviando, setEnviando] = useState<'whatsapp' | 'email' | null>(null);

  const handleWhatsApp = async () => {
    setEnviando('whatsapp');
    try {
      const r = await compartilharPdfWhatsApp(opts, telefone);
      if (r.enviado) {
        toast.success(r.simulado ? 'Envio simulado (WhatsApp em modo de teste).' : 'PDF enviado por WhatsApp.');
      } else {
        toast('PDF baixado — anexe-o na conversa do WhatsApp.', { icon: '📎', duration: 5000 });
      }
    } catch {
      toast.error('Erro ao gerar o PDF para o WhatsApp.');
    } finally {
      setEnviando(null);
    }
  };

  const handleEmail = async () => {
    setEnviando('email');
    try {
      const r = await compartilharPdfEmail(opts, emailPara);
      if (r.enviado) {
        toast.success('PDF enviado por e-mail, já anexado.');
      } else {
        toast('PDF baixado — anexe-o no e-mail antes de enviar.', { icon: '📎', duration: 5000 });
      }
    } catch {
      toast.error('Erro ao gerar o PDF para o e-mail.');
    } finally {
      setEnviando(null);
    }
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
