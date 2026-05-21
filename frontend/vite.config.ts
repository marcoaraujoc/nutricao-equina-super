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