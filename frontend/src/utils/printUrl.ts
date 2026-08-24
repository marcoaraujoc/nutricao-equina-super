// frontend/src/utils/printUrl.ts
import api from '../services/api';

// Resolve URL relativa (ex: "/uploads/empresas/x.png") para absoluta — necessário porque
// o HTML dos relatórios/impressões é escrito via iframe.contentDocument.write()/srcDoc,
// cujo base URL não resolve caminhos relativos contra a origem da aplicação.
export function resolverUrlAbsoluta(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Baixa uma imagem PROTEGIDA (ex.: "/api/midia/<chave>", exige sessão) e devolve
// como `data:` URI — necessário para o MESMO HTML de impressão (gerarHtmlFatura
// e afins) também virar PDF correto no SERVIDOR (WhatsApp/e-mail/link público).
//
// O gerador de PDF do backend (documentoWhatsappService.htmlParaPdf, Puppeteer)
// BLOQUEIA toda requisição que não seja `data:` — proteção contra SSRF, já que o
// HTML pode conter dado de tenant. Uma <img src="/api/midia/..."> funciona
// perfeitamente na impressão AO VIVO do navegador (tem rede e cookie de sessão)
// e nasce QUEBRADA em qualquer PDF gerado no servidor. Resolvendo para `data:`
// ANTES de montar o HTML, a MESMA string funciona nos dois — impressão e PDF.
export async function carregarComoDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    // `api` já tem baseURL "/api" — a URL vinda do backend (ex.: "/api/midia/xyz")
    // JÁ inclui esse prefixo, então passá-la direto duplicava ("/api/api/midia/xyz",
    // 404 silencioso e a logo nunca carregava). Tira o prefixo antes de chamar.
    const caminho = url.replace(/^\/api(\/|$)/, '/');
    const res = await api.get(caminho, { responseType: 'blob' });
    if (!res.data) return null; // 403 do interceptor (GET) — ver services/api.ts
    const blob: Blob = res.data;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
