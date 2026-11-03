import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const transformersOrtBundle = path.resolve(
  __dirname,
  'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs',
);

/**
 * Development server only. GitHub Pages does not send these headers, and
 * `vite preview` must not send them either. Production search workers and
 * any WASM they load have to run single-threaded, without SharedArrayBuffer
 * and without cross-origin isolation. These headers are not evidence that
 * a production worker can use threads.
 */
const developmentIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
} as const;

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: [
      // Optional transformers import. The worldwide search worker does not
      // import onnxruntime-web, and this alias is not a production isolation
      // or GPU requirement for core search.
      { find: /^onnxruntime-web$/, replacement: transformersOrtBundle },
    ],
  },
  server: {
    allowedHosts: ['wetwijzer.github.io', 'neder-laws.github.io', 'localhost', '127.0.0.1'],
    watch: {
      ignored: ['**/ppd/**', '**/ipfs_datasets_py/**', '**/.cache/**', '**/dist/**'],
    },
    headers: developmentIsolationHeaders,
  },
  preview: {
    headers: {},
  },
  build: {
    target: 'es2020', // Ensure modern browser features are supported
    rollupOptions: {
      onwarn(warning, warn) {
        // All warnings are now processed normally
        warn(warning);
      },
    },
  },
  // Module workers. Production search does not use SharedArrayBuffer, COOP, or COEP.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    entries: ['index.html'],
    exclude: ['@huggingface/transformers'], // Exclude transformers.js from pre-bundling to avoid issues with WASM
  },
  // define: {
  //   global: 'globalThis', // Commented out to avoid breaking module name resolution
  // },
});
