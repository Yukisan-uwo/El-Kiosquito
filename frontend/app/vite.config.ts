/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// El Kiosquito — frontend. Ver frontend/prompt-interfaces-ia.md y el doc de
// proyecto "El Kiosquito — Sistema de Diseño Frontend" para las reglas que
// este código debe respetar (paleta, tipografía, catálogo cerrado de
// animaciones, restricción sobre densidad).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
