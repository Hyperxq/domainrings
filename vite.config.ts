import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({
  // GitHub Pages serves the app under /domainrings/; local dev and other hosts stay at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  test: { environment: 'jsdom' },
})
