import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
//import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    //vueDevTools(),
    // PWA 仅在 build（生产）时启用；dev 模式下 SW 会拦截带 ?t= 时间戳的源码请求并返回旧 Content-Length，
    // 触发 416 Requested Range Not Satisfiable，所以开发环境必须禁用。
    VitePWA({
      disable: command === 'serve',
      registerType: 'autoUpdate',
      manifest: {
        name: 'GeoMesh3D',
        short_name: 'GeoMesh3D',
        description: 'GeoMesh3D 在线三维几何学习辅助平台',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // 预缓存构建产物：JS/CSS/HTML/字体/本地图片等
        // dat/patt/td 为 AR 模式每次进入都要用的静态资源，一并预缓存
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json,dat,patt,td}'],
        // ar.js 等库超过默认 2MB 限制，需要放宽
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 运行时缓存策略说明：
        // - 头像/缩略图等后端图片【不在这里缓存】：它们带 Authorization 头，
        //   统一由 src/utils/imageCache.ts（Cache Storage）管理，
        //   避免 SW StaleWhileRevalidate 每次都在后台重新下载一遍。
        // - 不缓存 API 请求，避免不同用户/不同 token 之间读到旧数据。
        runtimeCaching: [
          {
            // AR 静态资源（相机标定参数、识别图案）：内容不变，CacheFirst 零重复下载
            urlPattern: /\/(?:data|arcode)\/.+/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'geomesh-ar-assets',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 天
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('/three/')) return 'three'
          if (id.includes('/vue-router/')) return 'vue-router'
          if (id.includes('/vue/')) return 'vue'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
}))
