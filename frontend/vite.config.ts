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