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
      '/api': {
        target: 'https://music.163.com',
        changeOrigin: true,
        headers: {
          'Referer': 'https://music.163.com/',
          'Origin': 'https://music.163.com'
        }
      }
    }
  }
})
