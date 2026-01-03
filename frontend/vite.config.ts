import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3000',
            '/uploads': 'http://localhost:3000'
        }
    },
    preview: {
        host: '0.0.0.0',
        port: Number(process.env.PORT) || 4173,
        allowedHosts: ['.up.railway.app']
    }
})
