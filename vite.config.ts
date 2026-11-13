import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The commit the IDE is built from (GitHub's in the deploy) and when,
// compiled in and written to dist/version.json: an open tab compares the two
// and offers to load a newer version, and ⋮ «Info» shows them (App.tsx).
const version = process.env.GITHUB_SHA ?? (() => {
  try { return execSync('git rev-parse HEAD').toString().trim() } catch { return 'dev' }
})()
// The deploy passes the commit's date (GLPYTHON_BUILT, see deploy-pages.yml),
// so a rebuild of the same commit is the same, byte for byte: a push to dev
// rebuilds main's IDE without changing the live site.
const built = process.env.GLPYTHON_BUILT || new Date().toISOString()
// The glpython-editor it bundles, as package.json pins it: the tag
// ("…glpython-editor.git#v0.1.30"), or a commit's first 7 characters.
// The dev channel's build passes its editor commit (GLPYTHON_EDITOR_VERSION,
// see deploy-pages.yml): it installs glpython-editor's dev branch.
const editorVersion = process.env.GLPYTHON_EDITOR_VERSION || (() => {
  const spec = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> }).dependencies?.['glpython-editor'] ?? ''
  const ref = spec.split('#')[1] ?? ''
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref || 'unknown'
})()
const versionFile: Plugin = {
  name: 'glpython-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, built, editor: editorVersion }) })
  },
}

// Cross-origin isolation headers are required so the Pyodide worker can use
// SharedArrayBuffer, which powers the input() dialog bridge.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// The channel (src/channel.ts): "GLPYTHON_CHANNEL=dev npm run build" builds
// the dev IDE, which GitHub Pages serves at /dev/ (its base) with a badge.
const channel = process.env.GLPYTHON_CHANNEL === 'dev' ? 'dev' : 'live'

// https://vite.dev/config/
// The repo is glpython-edu/glpython-edu.github.io, so GitHub Pages serves the
// IDE at the organization's root, https://glpython-edu.github.io/, and Vite's
// default base "/" applies in production too.
export default defineConfig({
  base: channel === 'dev' ? '/dev/' : '/',
  plugins: [react(), versionFile],
  define: {
    __GLPYTHON_CHANNEL__: JSON.stringify(channel),
    __GLPYTHON_IDE_VERSION__: JSON.stringify(version),
    __GLPYTHON_IDE_BUILT__: JSON.stringify(built),
    __GLPYTHON_EDITOR_VERSION__: JSON.stringify(editorVersion),
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
