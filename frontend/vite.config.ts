import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    host: true,           // ← ESSENCIAL: libera acesso pela rede (celular, tablet, etc.)
    port: 5173,
    strictPort: true,     // Não muda de porta automaticamente se 5173 estiver ocupada
    open: false,          // Não abre automaticamente o navegador

    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
      // Proxy para as imagens salvas na pasta uploads
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
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