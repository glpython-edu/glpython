import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The commit the IDE is built from (GitHub's in the deploy) and when,
// compiled in and written to dist/version.json: an open tab compares the two
// and offers to load a newer version, and ⋮ «Info» shows them (App.tsx).
const version = process.env.GITHUB_SHA ?? (() => {
  try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'dev' }
})()
const built = new Date().toISOString()
const versionFile: Plugin = {
  name: 'glpython-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, built }) })
  },
}

// Cross-origin isolation headers are required so the Pyodide worker can use
// SharedArrayBuffer, which powers the input() dialog bridge.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
// The repo is glpython-edu/glpython-edu.github.io, so GitHub Pages serves the
// IDE at the organization's root, https://glpython-edu.github.io/, and Vite's
// default base "/" applies in production too.
export default defineConfig({
  plugins: [react(), versionFile],
  define: {
    __GLPYTHON_IDE_VERSION__: JSON.stringify(version),
    __GLPYTHON_IDE_BUILT__: JSON.stringify(built),
  },
  // glpython-editor's Pyodide worker is loaded via
  // `new Worker(new URL('./pyodide-worker.js', import.meta.url))`, resolved
  // relative to the editor package's own dist/index.js. In dev, Vite's
  // dependency pre-bundler would otherwise copy that file into
  // node_modules/.vite/deps/ (flattening away its sibling dist/assets/
  // folder and breaking the relative worker reference), so it's excluded
  // from pre-bundling and served directly out of node_modules instead,
  // where the worker asset actually lives next to it.
  optimizeDeps: {
    exclude: ['glpython-editor'],
  },
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
})
