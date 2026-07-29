import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },

  server: {
    host: true,
    port: 5173,
    strictPort: true,
    open: false,
    allowedHosts: true,

    // Atrás de um túnel HTTPS (Tailscale Funnel / Cloudflare), a página é servida em
    // :443 mas o cliente de HMR tentaria abrir o websocket na porta do dev server
    // (5173) e falharia — o navegador fica reclamando no console e o hot reload morre.
    // Só ativa quando VITE_TUNEL=1 para não quebrar o acesso normal por localhost.
    ...(process.env.VITE_TUNEL === '1'
      ? { hmr: { protocol: 'wss' as const, clientPort: 443 } }
      : {}),

    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        // Sobrescreve o header Origin antes de encaminhar ao backend.
        // Necessário quando o frontend é acessado via Cloudflare Tunnel (ou outro
        // proxy externo): o browser envia Origin: https://xxx.trycloudflare.com,
        // que não está em ALLOWED_ORIGINS do backend. Forçar para o localhost
        // autorizado garante que CORS passe corretamente em dev.
        headers: { origin: 'http://localhost:5173' },
      },
      // Proxy para as imagens salvas na pasta uploads
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        headers: { origin: 'http://localhost:5173' },
      }
    }
  },

  // Configuração para quando rodar preview (build de produção)
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})