import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            // 将前端 /api 请求代理到本地后端，避免 CORS
            '/api': {
                // 中文注释：后端运行在 8787；仍支持用 VITE_API_BASE_URL 覆盖
                target: process.env.VITE_API_BASE_URL || 'http://localhost:8787',
                changeOrigin: true
            }
        }
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    // 生产环境构建优化
    build: {
        outDir: 'dist',
        sourcemap: false,
        minify: 'terser',
        cssCodeSplit: true,
        reportCompressedSize: true,
        chunkSizeWarningLimit: 1024,
        rollupOptions: {
            output: {
                manualChunks: {
                    vendor: ['react', 'react-dom'],
                    ui: ['@radix-ui/react-dialog', '@radix-ui/react-select', '@radix-ui/react-tabs']
                }
            }
        }
    }
})
