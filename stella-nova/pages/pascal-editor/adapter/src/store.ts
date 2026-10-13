// ============================================================================
//  PASCAL EDITOR  ·  adapter/src/store.ts — browser storage for the editor
// ----------------------------------------------------------------------------
//  Upstream keeps scenes in SQLite behind a Next.js scenes API. This static
//  build keeps one scene in IndexedDB in the browser of the person who uses
//  it. Nothing goes to a server.
//    database "sn-pascal-editor", version 1
//      store "scene"      key "current" -> { graph, savedAt }
//      store "artifacts"  key sha256    -> { bytes, mimeType }
//  The artifact store (geometry and scripts that nodes name as
//  artifact://<sha256>) loads all rows into memory at start, because the
//  editor asks for an artifact URL synchronously.
//
//  grep -n targets
//    scene read/write ..... "export async function loadScene"
//    artifact store ....... "export async function makeArtifactStore"
// ============================================================================
import type { ArtifactStore } from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/editor'

const DB_NAME = 'sn-pascal-editor'
const SCENE = 'scene'
const ARTIFACTS = 'artifacts'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SCENE)) db.createObjectStore(SCENE)
      if (!db.objectStoreNames.contains(ARTIFACTS)) db.createObjectStore(ARTIFACTS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB is blocked'))
  })
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result as T)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export type StoredScene = { graph: SceneGraph; savedAt: string }

export async function loadScene(): Promise<StoredScene | null> {
  const row = await run<StoredScene | undefined>(SCENE, 'readonly', (s) => s.get('current'))
  return row ?? null
}

export async function saveScene(graph: SceneGraph): Promise<void> {
  const row: StoredScene = { graph, savedAt: new Date().toISOString() }
  await run(SCENE, 'readwrite', (s) => s.put(row, 'current'))
}

export async function clearScene(): Promise<void> {
  await run(SCENE, 'readwrite', (s) => s.delete('current'))
}

type ArtifactRow = { bytes: ArrayBuffer; mimeType: string }

export async function makeArtifactStore(): Promise<ArtifactStore> {
  const urls = new Map<string, string>()
  const texts = new Map<string, ArrayBuffer>()
  const add = (sha: string, row: ArtifactRow) => {
    urls.set(sha, URL.createObjectURL(new Blob([row.bytes], { type: row.mimeType })))
    texts.set(sha, row.bytes)
  }
  try {
    const keys = await run<IDBValidKey[]>(ARTIFACTS, 'readonly', (s) => s.getAllKeys())
    const rows = await run<ArtifactRow[]>(ARTIFACTS, 'readonly', (s) => s.getAll())
    keys.forEach((k, i) => {
      if (rows[i]) add(String(k), rows[i])
    })
  } catch (error) {
    console.warn('[sn-pascal] artifact store not readable, using memory only', error)
  }
  return {
    url: (sha) => urls.get(sha) ?? null,
    put: async (sha, bytes, mimeType) => {
      if (urls.has(sha)) return sha
      const copy = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0)
      const row: ArtifactRow = { bytes: copy as ArrayBuffer, mimeType }
      add(sha, row)
      try {
        await run(ARTIFACTS, 'readwrite', (s) => s.put(row, sha))
      } catch (error) {
        console.warn('[sn-pascal] artifact not saved to IndexedDB', error)
      }
      return sha
    },
    text: async (sha) => {
      const bytes = texts.get(sha)
      return bytes ? new TextDecoder().decode(bytes) : null
    },
  }
}

export function isSceneGraph(value: unknown): value is SceneGraph {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    !!v.nodes &&
    typeof v.nodes === 'object' &&
    Array.isArray(v.rootNodeIds) &&
    v.rootNodeIds.every((id) => typeof id === 'string')
  )
}
