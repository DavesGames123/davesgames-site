// ============================================================================
//  PASCAL EDITOR  ·  adapter/vite.config.mjs — static build of the editor
// ----------------------------------------------------------------------------
//  build.sh copies this folder to <clone>/apps/sn-static and runs vite here.
//  The config:
//    - uses base './' so the build works under any sub-path of the site
//    - points next/image, next/link and next/navigation at small shims,
//      because the editor packages import them and no Next.js server runs
//    - points "@/..." at the upstream apps/editor folder, so the page reuses
//      the upstream Build tab, Paint panel and viewer toolbar unchanged
//    - changes root paths ('/audios/', '/icons/', '/cursor.svg') in the
//      upstream sources to './' paths at build time. The source files on
//      disk do not change. Without this, the browser asks the site root.
//    - maps process.env to globalThis.__SN_ENV (inline script in the page)
//    - writes THIRD_PARTY_LICENSES.txt for the npm packages in the bundle
//
//  grep -n targets
//    asset origin ......... "ASSET_ORIGIN"
//    root path rewrite .... "ROOT_PATHS"
//    shims ................ "next/image"
//    licence list ......... "THIRD_PARTY"
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const upstreamApp = path.resolve(here, '../editor')
const outDir = process.env.SN_OUT_DIR || path.resolve(here, 'dist')

// ASSET_ORIGIN: 'cdn' (default) keeps the upstream asset origin,
// editor.pascal.app, for 3D models, materials and HDRIs. The catalog items
// load from Pascal's public Supabase storage in either mode, because upstream
// names those URLs in full. 'self' loads /items, /material and /hdri from this
// build (build.sh copies them, about 24 MB more).
const ASSET_ORIGIN = process.env.SN_ASSET_ORIGIN || 'cdn'
// The packages read process.env.X. Vite only accepts names or literals in
// "define", so process.env becomes globalThis.__SN_ENV, which an inline
// script in index.html fills before the bundle runs.
const assetsCdn =
  ASSET_ORIGIN === 'self'
    ? "new URL('.', document.baseURI).href.replace(/\\/$/, '')"
    : JSON.stringify('https://editor.pascal.app')

function envScript() {
  return {
    name: 'sn-env-script',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: `globalThis.__SN_ENV = { NODE_ENV: 'production', NEXT_PUBLIC_ASSETS_CDN_URL: ${assetsCdn} };`,
        },
      ]
    },
  }
}

const ROOT_PATHS = /(['"`(])\/(audios\/|icons\/|cursor\.svg)/g

function rootPathRewrite() {
  return {
    name: 'sn-root-path-rewrite',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('node_modules/.vite') || !/\.(tsx?|jsx?)$/.test(id.split('?')[0])) return null
      if (!/[/\\](packages|apps[/\\]editor)[/\\]/.test(id)) return null
      if (!ROOT_PATHS.test(code)) return null
      ROOT_PATHS.lastIndex = 0
      return { code: code.replace(ROOT_PATHS, '$1./$2'), map: null }
    },
  }
}

// THIRD_PARTY: writes THIRD_PARTY_LICENSES.txt with the name, version,
// licence and licence text of each npm package that goes into the bundle.
function thirdPartyLicences() {
  return {
    name: 'sn-third-party-licences',
    generateBundle() {
      const pkgs = new Map()
      for (const id of this.getModuleIds()) {
        const clean = id.replace(/^\0/, '').split('?')[0]
        const m = clean.match(/^(.*[/\\]node_modules[/\\])((?:@[^/\\]+[/\\])?[^/\\]+)/)
        let dir = m ? m[1] + m[2] : null
        if (!dir) {
          const w = clean.match(/^(.*[/\\]packages[/\\][^/\\]+)[/\\]/)
          dir = w ? w[1] : null
        }
        if (!dir || pkgs.has(dir)) continue
        try {
          const real = fs.realpathSync(dir)
          const pj = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'))
          const files = fs.readdirSync(real)
          const lf = files.find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
          // No licence field: use the line under a "Licence" heading in the README.
          let license = typeof pj.license === 'string' ? pj.license : pj.license?.type
          const rf = files.find((f) => /^readme(\.|$)/i.test(f))
          if (!license && rf) {
            const md = fs.readFileSync(path.join(real, rf), 'utf8').match(/#+\s*licen[cs]e\s*\n+\s*([^\n]+)/i)
            if (md) license = `${md[1].trim()} (from README)`
          }
          pkgs.set(dir, {
            name: pj.name,
            version: pj.version,
            license: license ?? 'UNKNOWN',
            text: lf ? fs.readFileSync(path.join(real, lf), 'utf8').trim() : '',
          })
        } catch {}
      }
      const list = [...new Map([...pkgs.values()].map((p) => [`${p.name}@${p.version}`, p])).values()]
        .sort((a, b) => a.name.localeCompare(b.name))
      const body = list
        .map((p) => `${'='.repeat(72)}\n${p.name} ${p.version}  (${p.license})\n${'-'.repeat(72)}\n${p.text || '(no licence file in the package)'}\n`)
        .join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source: `Packages bundled into this build of Pascal Editor (${list.length}).\n\n${body}`,
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [envScript(), rootPathRewrite(), react(), tailwindcss(), thirdPartyLicences()],
  resolve: {
    alias: [
      { find: /^next\/image$/, replacement: path.resolve(here, 'src/shims/next-image.tsx') },
      { find: /^next\/link$/, replacement: path.resolve(here, 'src/shims/next-link.tsx') },
      { find: /^next\/navigation$/, replacement: path.resolve(here, 'src/shims/next-navigation.ts') },
      { find: /^@\//, replacement: `${upstreamApp}/` },
    ],
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': 'globalThis.__SN_ENV',
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 8000,
    assetsDir: 'assets',
    // One main chunk. With code splitting, Rollup puts core/registry modules
    // that import each other into different chunks and warns that the
    // execution order can break. One chunk removes that risk. Workers stay
    // separate files.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  worker: { format: 'es' },
})
