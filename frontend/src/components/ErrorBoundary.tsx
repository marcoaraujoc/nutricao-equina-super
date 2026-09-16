import React from 'react';

/**
 * 🔴 A TELA EM BRANCO ERA ISTO (2026-09-15).
 *
 * Até aqui o ÚNICO `ErrorBoundary` da aplicação ficava DENTRO de `ProtectedApp` —
 * abaixo de `AuthProvider`, `EmpresaProvider`, `PeriodoProvider`,
 * `SelectedAnimalProvider`, do `Router` e do `Toaster`. Um erro de render em
 * QUALQUER um deles passava por cima do boundary, o React desmontava a árvore
 * inteira e sobrava **página branca** — e, como o console é silenciado em produção
 * (`main.tsx`), sem nenhuma pista. Clicar não fazia nada porque não havia mais nada
 * montado; só o recarregamento completo trazia o sistema de volta, que é exatamente
 * o sintoma relatado.
 *
 * Agora ele também envolve a aplicação INTEIRA (`main.tsx`), então o pior caso passa
 * a ser uma tela que DIZ o que houve e oferece saída.
 *
 * ⚠️ `componentDidCatch` guarda a mensagem em `sessionStorage` ANTES de qualquer
 * coisa: o console de produção é noop, e sem isso o erro não deixa rastro nenhum
 * para quem for investigar depois.
 * ⚠️ O boundary NÃO captura rejeição de promessa nem erro de handler assíncrono —
 * isso é limitação do React, não omissão. O que ele cobre é o render.
 */

const CHAVE_ULTIMO_ERRO = 's2vet_ultimo_erro';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    try {
      sessionStorage.setItem(CHAVE_ULTIMO_ERRO, JSON.stringify({
        mensagem: error?.message ?? String(error),
        pilha:    error?.stack?.slice(0, 2000) ?? null,
        onde:     errorInfo?.componentStack?.slice(0, 2000) ?? null,
        quando:   new Date().toISOString(),
        rota:     window.location.hash,
      }));
    } catch { /* sessionStorage bloqueado (janela privada): segue sem rastro */ }
    console.error('🚨 ErrorBoundary capturou um erro:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-md w-full text-center bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <h2 className="text-xl font-bold text-red-600 mb-3">Algo deu errado</h2>
            <p className="text-sm text-gray-600 mb-6 break-words">
              {this.state.error?.message || 'Erro desconhecido'}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="bg-emerald-700 hover:bg-emerald-800 text-white px-6 py-2.5 rounded-xl text-sm font-semibold"
              >
                Recarregar a página
              </button>
              {/* Recarregar sozinho repete o erro quando o que está corrompido é o
                  estado guardado no navegador (contexto de empresa, paciente
                  selecionado, rascunhos). Esta saída limpa o que é LOCAL — nunca a
                  sessão do servidor, que continua sendo do cookie HttpOnly. */}
              <button
                onClick={() => {
                  try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignora */ }
                  window.location.href = '/#/login';
                  window.location.reload();
                }}
                className="text-gray-500 hover:text-gray-700 px-6 py-2 rounded-xl text-xs font-medium"
              >
                Limpar dados locais e entrar de novo
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
