import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the app from /<repo>/; set BASE_PATH in CI (see .github/workflows/deploy.yml).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
