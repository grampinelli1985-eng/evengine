import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiFootballKey = env.API_FOOTBALL_KEY || env.VITE_APIFOOTBALL_KEY || ''

    return {
        plugins: [react(), tailwindcss()],
        server: {
            proxy: {
                '/api-yahoo': {
                    target: 'https://query1.finance.yahoo.com',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api-yahoo/, ''),
                },
                '/api-brapi': {
                    target: 'https://brapi.dev/api',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api-brapi/, ''),
                },
                '/api/football': {
                    target: 'https://v3.football.api-sports.io',
                    changeOrigin: true,
                    rewrite: (path) => path.replace(/^\/api\/football/, ''),
                    headers: {
                        'x-apisports-key': apiFootballKey,
                    },
                },
            }
        }
    }
})
