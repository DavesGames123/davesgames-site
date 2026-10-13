// ============================================================================
//  PASCAL EDITOR  ·  adapter/src/main.tsx — entry of the static build
// ----------------------------------------------------------------------------
//  Order at start:
//    1. register the built-in node kinds (walls, slabs, roofs, items and so
//       on) from @pascal-app/nodes, as upstream apps/editor/lib/bootstrap.ts
//       does. The third-party plugins of the hosted app do not load here.
//    2. open the IndexedDB artifact store and give it to @pascal-app/core
//    3. mount <App> into #root
// ============================================================================
import './app.css'
import { type AnyNodeDefinition, configureArtifactStore, nodeRegistry, registerNode } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { makeArtifactStore } from './store'

for (const def of builtinPlugin.nodes ?? []) {
  if (nodeRegistry.has((def as AnyNodeDefinition).kind)) continue
  registerNode(def as AnyNodeDefinition)
}

async function start() {
  try {
    configureArtifactStore(await makeArtifactStore())
  } catch (error) {
    console.warn('[sn-pascal] artifact store fell back to memory', error)
  }
  const root = document.getElementById('root')
  if (!root) throw new Error('#root is missing')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
