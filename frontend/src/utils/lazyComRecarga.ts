import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// 🔴 ARQUIVO DE TELA QUE SUMIU DEPOIS DE UM DEPLOY (2026-10-10). As telas são
// carregadas sob demanda e cada deploy publica arquivos com nomes NOVOS: a aba aberta
// antes do deploy pede, ao abrir uma tela, o arquivo da versão ANTERIOR — que não
// existe mais — e o import falha. Recarregar busca a versão nova inteira.
//
// ⚠️ Por que AQUI e não no `vite:preloadError` com `preventDefault()` (a versão de
// 2026-10-09): com `preventDefault()` o Vite faz o import RESOLVER com `undefined`, e o
// `React.lazy` quebra lendo `.default` — "Cannot read properties of undefined (reading
// 'default')" na tela, antes de o reload acontecer. Aqui, na falha, a promessa fica
// PENDENTE: a tela segue no "Carregando…" do Suspense até a página recarregar.
//
// ⚠️ UMA vez por minuto, no máximo: se o arquivo faltar de verdade (deploy quebrado), o
// reload em laço travaria a aba. Passado o freio, o erro segue para o ErrorBoundary.

const CHAVE = 's2vet_reload_versao';
const FREIO_MS = 60_000;

/** Recarrega a página para a versão nova; `false` quando o freio já foi usado. */
function recarregarParaVersaoNova(): boolean {
  let ultimo = 0;
  try { ultimo = Number(sessionStorage.getItem(CHAVE)) || 0; } catch { /* sem storage */ }
  if (Date.now() - ultimo < FREIO_MS) return false;
  try { sessionStorage.setItem(CHAVE, String(Date.now())); } catch { /* sem storage */ }
  window.location.reload();
  return true;
}

/** `React.lazy` que, se o arquivo da tela não vier, recarrega a página uma vez. */
export function lazyComRecarga<P extends object>(
  importar: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    try {
      const modulo = await importar();
      if (modulo?.default) return modulo;
      throw new Error('O arquivo da tela não foi carregado.');
    } catch (err) {
      if (recarregarParaVersaoNova()) {
        return new Promise<{ default: ComponentType<P> }>(() => { /* aguarda o reload */ });
      }
      throw err;
    }
  });
}
