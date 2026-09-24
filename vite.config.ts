import { defineConfig } from 'vitest/config'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({
  // The custom domain serves the app at the root; set BASE_PATH only when hosting under a sub-path.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  test: { environment: 'jsdom' },
})
