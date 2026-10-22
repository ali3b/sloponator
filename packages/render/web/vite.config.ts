// The render bundle's build: a plain page with one module, no plugins, every chunk named by its content hash. The Node
// runner (src/bundle.ts) runs this build once into the cache dir and hashes the output: that hash is the bundle's
// identity in every frame-cache key.
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  base: './',
  logLevel: 'warn',
  build: {
    target: 'es2022',
    minify: false,
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: { output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } },
  },
});
