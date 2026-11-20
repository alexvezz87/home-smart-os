import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  build: {
    outDir: '../public/vue',
    emptyOutDir: true,
    target: 'es2018',
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.js',
      name: 'HomeSmartVue',
      formats: ['iife'],
      fileName: () => 'home-vue.js'
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => (
          assetInfo.name && assetInfo.name.endsWith('.css')
            ? 'home-vue.css'
            : '[name][extname]'
        )
      }
    }
  }
});
