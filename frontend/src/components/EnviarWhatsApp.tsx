// frontend/src/components/EnviarWhatsApp.tsx
//
// 🔴 ENVIO POR WHATSAPP DE QUALQUER DOCUMENTO — um componente só (2026-09-26).
//
// O envio é SEMPRE o mesmo, seja fatura, prescrição, vacina ou exame: o HTML de
// impressão do documento vira PDF no servidor (Puppeteer) e sai ANEXADO pela
// instância de WhatsApp da clínica (`utils/compartilharPdf.ts`).
// 🔴 (2026-09-30) ANTES de tudo o SERVIÇO é conferido (`verificarServicoWhatsApp`):
// desativado/não configurado → o card central informa que é preciso ATIVÁ-LO, e nada
// é gerado nem aberto. O plano B (baixa o PDF e abre o WhatsApp para anexar à mão)
// ficou para o que não é o serviço — cliente sem telefone, falha no envio — e o card
// diz o MOTIVO.
//
// POR QUÊ virou componente: a fatura tinha TRÊS botões de WhatsApp escritos à parte
// (fechamento em lote, fatura aberta e fatura por paciente), cada um com o seu estado,
// a sua trava e o seu telefone — e o do lote funcionava enquanto os outros dois caíam
// no plano B. Com um componente, o que muda de um documento para outro é só o que ele
// RECEBE (o HTML, o nome do arquivo, o texto e o destino) e o TIPO, que é só SAÍDA:
// dá nome ao documento na mensagem de resultado ("Fatura enviada por WhatsApp com
// Sucesso") e no rótulo do botão. Nenhuma regra de envio depende do tipo.
//
// ⚠️ `gerarHtml` é SÍNCRONO de propósito: é ele que roda dentro da janela de "user
// activation" do navegador, de que o plano B depende para abrir o app. Preparo
// assíncrono (imagens em `data:`, assinatura) vai em `aoPreparar`.
// ⚠️ `indisponivel` DESABILITA com o motivo no `title` — não esconde. Ação SEM
// PERMISSÃO não se renderiza (28-d); aqui a pessoa tem a permissão, quem recusou o
// canal foi o destinatário (formas de recebimento da fatura).
import { useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { enviarPdfWhatsAppComAviso, type CompartilharPdfOpcoes } from '../utils/compartilharPdf';
import AcaoRegistro from './AcaoRegistro';
import { BTN_ACAO, TOM_ACAO } from '../utils/tomAcao';

/**
 * O documento que está saindo. Só SAÍDA: vai para a frase do resultado e para o
 * rótulo/tooltip. A lista é a dos documentos que o sistema já envia — texto livre
 * continua aceito para o próximo sem precisar mexer aqui.
 */
export type TipoDocumentoEnvio =
  | 'Fatura' | 'Prescrição' | 'Vacina' | 'Exame' | 'Pedido de Exames'
  | 'Encaminhamento' | 'Evolução' | 'Orçamento' | 'Dieta' | 'Documento'
  | (string & {});

/**
 * Forma do botão — nunca o comportamento:
 *   registro → `AcaoRegistro` (ícone no desktop, pílula no mobile) — linha de lista
 *   barra    → botão com rótulo da barra de ações de um DOCUMENTO (fatura)
 *   compacto → a mesma barra, menor (bloco do paciente dentro da fatura)
 */
export type AparenciaEnvio = 'registro' | 'barra' | 'compacto';

export interface EnviarWhatsAppProps extends Omit<CompartilharPdfOpcoes, 'documento'> {
  tipo: TipoDocumentoEnvio;
  /** Destino. Sem ele o envio automático não tem para onde ir e cai no plano B. */
  telefone?: string | null;
  aoPreparar?: () => Promise<void>;
  /** Texto não vazio = canal recusado pelo destinatário; vira o tooltip. */
  indisponivel?: string | null;
  desabilitado?: boolean;
  aparencia?: AparenciaEnvio;
  rotulo?: string;
  /** Tooltip; padrão "Enviar <tipo> por WhatsApp". */
  titulo?: string;
  className?: string;
  /** Avisa quem está em volta (ex.: travar o botão de e-mail ao lado). */
  onEnviandoChange?: (enviando: boolean) => void;
  /** `true` quando saiu ANEXADO de verdade; `false` no plano B ou no cancelamento. */
  onConcluido?: (enviado: boolean) => void;
}

export default function EnviarWhatsApp({
  tipo, telefone, aoPreparar, indisponivel = null, desabilitado = false,
  aparencia = 'registro', rotulo = 'WhatsApp', titulo, className = '',
  onEnviandoChange, onConcluido, ...opcoes
}: EnviarWhatsAppProps) {
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    // A trava também mora aqui, não só no `disabled`: teclado e leitor de tela
    // passam por cima de atributo.
    if (enviando || desabilitado || indisponivel) return;
    setEnviando(true);
    onEnviandoChange?.(true);
    try {
      await aoPreparar?.();
      // Nunca lança: o resultado (e o motivo do plano B) vai no card central.
      const enviado = await enviarPdfWhatsAppComAviso({ ...opcoes, documento: tipo }, telefone);
      onConcluido?.(enviado);
    } finally {
      setEnviando(false);
      onEnviandoChange?.(false);
    }
  };

  const dica = indisponivel || titulo || `Enviar ${String(tipo).toLowerCase()} por WhatsApp`;
  const travado = desabilitado || enviando || !!indisponivel;

  if (aparencia === 'registro') {
    return (
      <AcaoRegistro tom="whatsapp" icone={MessageCircle} rotulo={rotulo} titulo={dica}
        className={className} desabilitado={travado} carregando={enviando} onClick={enviar} />
    );
  }

  const compacto = aparencia === 'compacto';
  return (
    <button type="button" onClick={enviar} disabled={travado} title={dica}
      className={`${BTN_ACAO} ${TOM_ACAO.whatsapp} ${compacto ? '!px-2 !py-1 !text-[11px]' : ''} disabled:opacity-50 disabled:cursor-not-allowed ${className}`}>
      {enviando
        ? <Loader2 size={compacto ? 11 : 13} className="animate-spin"/>
        : <MessageCircle size={compacto ? 12 : 13}/>} {rotulo}
    </button>
  );
}
