import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Suprime saída de console em produção para não expor detalhes internos ao usuário final.
// Em desenvolvimento, mantenha VITE_DEBUG=true no .env para reativar.
if (!import.meta.env.DEV || import.meta.env.VITE_SUPPRESS_CONSOLE === 'true') {
  const noop = () => {};
  console.log   = noop;
  console.info  = noop;
  console.warn  = noop;
  console.error = noop;
  console.debug = noop;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});


const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <App />
      </GoogleOAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
