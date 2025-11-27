import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/Song_V1': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
      '/Search': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
      '/Playlist': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
      '/Album': {
        target: 'http://localhost:6969',
        changeOrigin: true,
      },
    }
  }
})
