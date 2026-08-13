// frontend/src/utils/compartilharPdf.ts
// Compartilhamento de um documento (HTML → PDF) por WhatsApp e e-mail.
//
// ENVIO REAL, pelo backend, quando há destino (telefone/e-mail) disponível:
// o PDF sai do Puppeteer (mesmo "componente de impressão" reutilizável usado por
// documentoWhatsappService.js — texto selecionável, paginação nativa do Chrome,
// nada de captura de tela) e vai anexado de verdade — WhatsApp pela instância da
// clínica (Evolution API), e-mail por SMTP (nodemailer). Ver
// backend/src/controllers/DocumentoCompartilharController.js.
//
// FALLBACK MANUAL só quando o envio real não é possível — sem destino
// (telefone/e-mail do proprietário não cadastrado), sem provider configurado, ou
// falha de rede: baixa o PDF (gerado no NAVEGADOR via utils/gerarPdf.ts, já que o
// Puppeteer é só do backend) e abre o app diretamente (deep link `whatsapp://`/
// `wa.me`, ou `mailto:`) com o texto pronto — anexar o arquivo baixado fica por
// conta do usuário, que é o melhor possível sem um envio de verdade.
import api from '../services/api';
import { htmlParaPdfBlob } from './gerarPdf';
import { abrirWhatsApp, abrirEmail } from './compartilhar';

export interface CompartilharPdfOpcoes {
  /** Gera o HTML completo (<!DOCTYPE html>…</html>) do documento a compartilhar. */
  gerarHtml:    () => string;
  /** Nome do arquivo baixado/anexado, COM a extensão .pdf */
  nomeArquivo:  string;
  /** Texto da mensagem (WhatsApp) / corpo (e-mail). */
  texto:        string;
  /** Assunto do e-mail (fallback: o próprio nome do arquivo). Não usado pelo WhatsApp. */
  titulo?:      string;
}

export interface ResultadoCompartilhar {
  /** true = mandado de verdade pelo backend, PDF já anexado. */
  enviado:   boolean;
  /** Envio "bem-sucedido" mas em modo de teste (provider noop) — nada chegou de fato. */
  simulado?: boolean;
}

/** Baixa o PDF (gerado no navegador) — só o caminho manual precisa disso. */
async function baixarPdfNoNavegador(opts: CompartilharPdfOpcoes): Promise<void> {
  const blob = await htmlParaPdfBlob(opts.gerarHtml());
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = opts.nomeArquivo; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Gera o PDF e manda por WhatsApp. Com `telefone`, tenta o envio REAL pelo
 * backend primeiro (PDF anexado de verdade); sem telefone, ou se o backend não
 * conseguir mandar (provider indisponível), cai no manual: baixa o PDF e abre o
 * WhatsApp DIRETO (sem seletor de aplicativos — deep link, nunca Web Share).
 */
export async function compartilharPdfWhatsApp(
  opts: CompartilharPdfOpcoes,
  telefone?: string | null,
): Promise<ResultadoCompartilhar> {
  if (telefone) {
    try {
      const r = await api.post('/documentos/whatsapp', {
        telefone, html: opts.gerarHtml(), nomeArquivo: opts.nomeArquivo, legenda: opts.texto,
      });
      if (r.data?.sucesso) return { enviado: true, simulado: !!r.data.simulado };
    } catch { /* cai no manual abaixo */ }
  }
  await baixarPdfNoNavegador(opts);
  abrirWhatsApp(opts.texto, telefone ?? undefined);
  return { enviado: false };
}

/**
 * Gera o PDF e manda por e-mail. Com `para`, tenta o envio REAL pelo backend
 * primeiro (PDF anexado de verdade, sem precisar abrir cliente nenhum); sem
 * e-mail, ou se o SMTP não estiver configurado, cai no manual: baixa o PDF e abre
 * o cliente de e-mail padrão (`mailto:`) com o texto pronto — mailto nunca carrega
 * anexo, é limitação do próprio esquema, não deste código.
 */
export async function compartilharPdfEmail(
  opts: CompartilharPdfOpcoes,
  para?: string | null,
): Promise<ResultadoCompartilhar> {
  if (para) {
    try {
      const r = await api.post('/documentos/email', {
        email: para, assunto: opts.titulo ?? opts.nomeArquivo, corpo: opts.texto,
        html: opts.gerarHtml(), nomeArquivo: opts.nomeArquivo,
      });
      if (r.data?.sucesso) return { enviado: true };
    } catch { /* cai no manual abaixo */ }
  }
  await baixarPdfNoNavegador(opts);
  abrirEmail(opts.titulo ?? opts.nomeArquivo, opts.texto, para ?? undefined);
  return { enviado: false };
}
