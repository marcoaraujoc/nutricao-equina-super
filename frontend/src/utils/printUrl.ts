// frontend/src/utils/printUrl.ts
// Resolve URL relativa (ex: "/uploads/empresas/x.png") para absoluta — necessário porque
// o HTML dos relatórios/impressões é escrito via iframe.contentDocument.write()/srcDoc,
// cujo base URL não resolve caminhos relativos contra a origem da aplicação.
export function resolverUrlAbsoluta(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:')) return url;
  return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
}
