import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import manifest from './public/manifest.json';

// Custom plugin to copy content script CSS
const copyContentCss = () => ({
  name: 'copy-content-css',
  closeBundle() {
    const srcPath = resolve(__dirname, 'src/content/styles.css');
    const destDir = resolve(__dirname, 'dist/src/content');
    const destPath = resolve(destDir, 'styles.css');

    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(srcPath, destPath);
    console.log('✓ Copied content script CSS to dist/src/content/styles.css');
  },
});

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    copyContentCss(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'src/options/index.html'),
      },
    },
  },
});
