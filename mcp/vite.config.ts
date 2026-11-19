import { defineConfig } from 'vite'

// Bundles the MCP server (and the shared CVE engine from src/cve) into one
// Node ESM file. Dependencies stay external and resolve from node_modules.
export default defineConfig({
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rolldownOptions: {
      output: { format: 'es', entryFileNames: 'chaingraph-mcp.mjs', banner: '#!/usr/bin/env node' },
    },
  },
})
