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
// falha de rede: baixa o PDF e abre o app diretamente (deep link `whatsapp://`/
// `wa.me`, ou `mailto:`) com o texto pronto — anexar o arquivo baixado fica por
// conta do usuário, que é o melhor possível sem um envio de verdade.
//
// ⚠️ Descoberto em produção: no desktop, `abrirWhatsApp` abre o `wa.me` via
// `window.open(_blank)`, que só funciona dentro da janela de "user
// activation" do navegador (poucos segundos após o clique) — depois disso o
// navegador BLOQUEIA o popup em silêncio, sem erro nenhum. O Puppeteer sobe
// um Chromium do zero a cada chamada (nada rápido); se o envio real tenta e
// FALHA, e o fallback ainda tenta gerar o PDF pelo backend de novo, dois
// round-trips já bastam para estourar essa janela — sintoma: o botão "parece"
// reabrir o app do WhatsApp (association do SO com `wa.me`, fora do nosso
// controle) mas o PDF nunca chega a ser baixado, porque o clique perdeu a
// ativação antes de chegar em `baixarPdfNoNavegador`.
// Por isso: `TIMEOUT_ENVIO_MS` é folgado (sucesso do envio real não passa
// pelo `window.open`, então não tem pressa nenhuma) — mas `TIMEOUT_PDF_MS` é
// CURTO de propósito, porque é o passo que vem logo antes do `abrirWhatsApp`
// do fallback: sem resposta rápida, é melhor usar já o gerador client-side
// (sempre disponível, sem rede) do que arriscar perder o clique do usuário.
//
// ⚠️ `TIMEOUT_ENVIO_MS` precisa cobrir o pior caso do backend, não só o caso
// feliz: o Puppeteer sobe um Chromium do ZERO a cada chamada (nada rápido —
// ver documentoWhatsappService.js) e, se a Evolution API oscilar, o cliente
// HTTP dela ainda tenta de novo por conta própria (3 tentativas, até 15s cada
// — ver EvolutionService.js#chamar), o que sozinho já soma ~46s no pior caso.
// Com um teto curto aqui, o envio REAL — que teria dado certo, WhatsApp
// conectado e tudo — era abortado do lado do FRONTEND antes de a resposta
// chegar, e a tela caía no fallback manual (baixa o PDF, abre o wa.me/app)
// mesmo com a instância da clínica saudável.
import api from '../services/api';
import { htmlParaPdfBlob } from './gerarPdf';
import { abrirWhatsApp, abrirEmail } from './compartilhar';

const TIMEOUT_ENVIO_MS = 60000; // envio real — cobre Puppeteer + retries da Evolution (~46s no pior caso)
const TIMEOUT_PDF_MS   = 1200;  // PDF do fallback via backend — curto, precede o abrirWhatsApp/abrirEmail

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

/**
 * Gera o PDF de um HTML — PREFERE o backend (Puppeteer, mesmo pipeline do
 * envio real e do botão Imprimir de cada tela: texto selecionável, paginação
 * nativa do Chrome via `page.pdf()`), com um teto curto de espera
 * (`TIMEOUT_PDF_MS`). Sem resposta a tempo (ou erro), cai para o gerador
 * client-side (`utils/gerarPdf.ts`, captura de tela — fidelidade menor, mas
 * sempre disponível e rápido) — nunca deixa o usuário esperando o Puppeteer.
 */
async function gerarPdf(html: string, nomeArquivo: string): Promise<Blob> {
  try {
    const r = await api.post('/documentos/pdf', { html, nomeArquivo }, {
      responseType: 'blob', timeout: TIMEOUT_PDF_MS,
    });
    return r.data as Blob;
  } catch {
    return htmlParaPdfBlob(html);
  }
}

// WhatsApp só resolve o `wa.me`/`whatsapp://` para uma conversa ESPECÍFICA com
// o número no formato internacional (Brasil: 55 + DDD + número). Sem o "55",
// o link não casa com o contato — o app abre "genérico" (tela de conversas,
// sem ninguém pré-selecionado) e quem está mandando a mensagem pode acabar
// escrevendo na conversa errada (ex.: a do proprietário do animal, por ser um
// contato recente, em vez do responsável financeiro que deveria receber a
// fatura). Mesma normalização que `Faturamento.tsx#foneIntl` já fazia — só
// que aquela cobria a tela de fechamento em lote, não este fallback genérico.
function foneIntl(telefone?: string | null): string | undefined {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (!d) return undefined;
  return d.startsWith('55') ? d : `55${d}`;
}

/** Baixa o PDF — só o caminho manual precisa disso. */
async function baixarPdfNoNavegador(opts: CompartilharPdfOpcoes): Promise<void> {
  const blob = await gerarPdf(opts.gerarHtml(), opts.nomeArquivo);
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
      }, { timeout: TIMEOUT_ENVIO_MS });
      if (r.data?.sucesso) return { enviado: true, simulado: !!r.data.simulado };
    } catch { /* cai no manual abaixo */ }
  }
  await baixarPdfNoNavegador(opts);
  abrirWhatsApp(opts.texto, foneIntl(telefone));
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
      }, { timeout: TIMEOUT_ENVIO_MS });
      if (r.data?.sucesso) return { enviado: true };
    } catch { /* cai no manual abaixo */ }
  }
  await baixarPdfNoNavegador(opts);
  abrirEmail(opts.titulo ?? opts.nomeArquivo, opts.texto, para ?? undefined);
  return { enviado: false };
}
