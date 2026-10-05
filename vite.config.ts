/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { assetsInlineLimit: 100_000_000, cssCodeSplit: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
