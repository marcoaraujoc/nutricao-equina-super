// frontend/src/components/CompartilharPdfBotoes.tsx
// Par de botões WhatsApp + E-mail que mandam o PDF do documento (Puppeteer, pelo
// backend) com o telefone/e-mail do destinatário já anexado de verdade; sem
// destino ou sem provider configurado, caem no fallback manual (baixa o PDF no
// navegador e abre o app DIRETO, sem seletor de aplicativos) — ver
// utils/compartilharPdf.ts para os dois caminhos.
// Cores da ação seguem a paleta do módulo de Atendimento (CLAUDE.md §6): WhatsApp
// verde (cor da própria marca), e-mail azul.
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { enviarPdfEmailComAviso, type CompartilharPdfOpcoes } from '../utils/compartilharPdf';
import AcaoRegistro from './AcaoRegistro';
import EnviarWhatsApp from './EnviarWhatsApp';
import { useEscolhaDestinatario, type CanalDestino } from './EscolherDestinatario';

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
  /**
   * MOTIVO pelo qual aquele canal está indisponível para ESTE destinatário — texto
   * não vazio desabilita o botão e vira o tooltip. Nasceu das formas de recebimento
   * da fatura (o cliente escolhe no cadastro por quais canais quer receber).
   *
   * ⚠️ Desabilitar com o motivo à mostra, e não esconder: botão que some é lido como
   * perda de permissão, e ninguém descobre que a decisão está no cadastro do cliente.
   * Não confundir com `visivel={false}` do AcaoRegistro, que é para ação SEM PERMISSÃO
   * (armadilha 28-d) — aqui a pessoa tem a permissão, o destinatário é que não quer.
   */
  whatsappIndisponivel?: string | null;
  emailIndisponivel?:    string | null;
  size?:       number;
  className?:  string;
  /**
   * Pergunta PARA QUEM enviar antes de mandar (proprietário, equipe veterinária, um
   * veterinário ou um prestador) — Evolução, Prescrição, Exames e Encaminhamento,
   * 2026-10-09. Sem esta prop o envio vai direto ao `telefone`/`emailPara`, como sempre.
   */
  escolherDestinatario?: { animalId?: number | null; prestadorId?: number | null };
}

export default function CompartilharPdfBotoes({
  telefone, emailPara, disabled, aoPreparar, size = 14, className = '',
  whatsappIndisponivel = null, emailIndisponivel = null, escolherDestinatario, ...opts
}: CompartilharPdfBotoesProps) {
  const [enviando, setEnviando] = useState<'whatsapp' | 'email' | null>(null);
  const { escolher, modalDestinatario } = useEscolhaDestinatario();

  // O WhatsApp é o componente único de envio (`EnviarWhatsApp`) — o MESMO que a
  // fatura usa no painel e no bloco do paciente. Aqui fica só o e-mail, e o estado
  // compartilhado impede os dois envios ao mesmo tempo.
  // Com `escolherDestinatario`, os dois canais perguntam PARA QUEM antes de enviar.
  const perguntar = (canal: CanalDestino) => async () => {
    const dest = await escolher({ canal, ...escolherDestinatario });
    return dest ? dest.contatos : null;
  };

  const handleEmail = async () => {
    let para: string | string[] | null | undefined = emailPara;
    if (escolherDestinatario) {
      para = await perguntar('email')();
      if (para == null) return;
    }
    setEnviando('email');
    try {
      await aoPreparar?.();
      await enviarPdfEmailComAviso(opts, para);
    } finally { setEnviando(null); }
  };

  // Os dois saem por `AcaoRegistro`: ícone no desktop, botão com rótulo no mobile —
  // a mesma forma que WhatsApp/E-mail têm no resto do sistema. `size` continua na
  // assinatura por compatibilidade, mas quem dita o tamanho agora é o breakpoint.
  return (
    <>
      <EnviarWhatsApp {...opts} tipo={opts.documento ?? 'Documento'} telefone={telefone}
        aoPreparar={aoPreparar} indisponivel={whatsappIndisponivel}
        titulo="Enviar por WhatsApp" className={className}
        desabilitado={disabled || enviando === 'email'}
        resolverDestino={escolherDestinatario ? perguntar('whatsapp') : undefined}
        onEnviandoChange={(on) => setEnviando(on ? 'whatsapp' : null)} />
      <AcaoRegistro tom="email" icone={Mail} rotulo="E-mail"
        titulo={emailIndisponivel || 'Enviar por e-mail'} className={className}
        desabilitado={disabled || enviando !== null || !!emailIndisponivel}
        carregando={enviando === 'email'}
        onClick={handleEmail} />
      {modalDestinatario}
    </>
  );
}
