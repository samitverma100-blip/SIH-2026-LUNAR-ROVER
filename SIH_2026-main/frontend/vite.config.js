import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        terrain: resolve(__dirname, 'terrain.html'),
      },
      // terrain.html resolves "three" at runtime via its own <script type="importmap">
      // pointing at a CDN — it's never bundled locally, so tell Rollup not to try.
      external: (id) => id === 'three' || id.startsWith('three/addons/'),
    },
  },
})
