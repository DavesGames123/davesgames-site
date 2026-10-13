// ============================================================================
//  PASCAL EDITOR  ·  adapter/src/app.tsx — the editor with browser storage
// ----------------------------------------------------------------------------
//  This is the static version of upstream apps/editor/components/
//  scene-loader.tsx. It mounts the upstream <Editor> with the same sidebar
//  tabs (Scene, Build, Paint, Items, Settings) and the same viewer toolbar.
//  Differences from upstream:
//    - onLoad and onSave use IndexedDB (store.ts), not /api/scenes
//    - no live-scene EventSource, no rename API, no share panel, no sign-in
//    - no thumbnail upload
//    - the navbar has New, Import JSON and Export JSON
//    - only the built-in node plugin loads (see main.tsx)
//
//  grep -n targets
//    sidebar tabs ......... "const SIDEBAR_TABS"
//    load and save ........ "const handleLoad"
//    navbar ............... "function StaticNavbar"
// ============================================================================
import {
  Editor,
  getSavedSceneDocument,
  ItemsPanel,
  type SaveStatus,
  type SceneGraph,
  type SidebarTab,
} from '@pascal-app/editor'
import { Download, FilePlus, Hammer, Layers, Package, Palette, Settings, Upload } from 'lucide-react'
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { BuildTab } from '@/components/build-tab'
import { PaintPanel } from '@/components/paint-panel'
import { EditorViewerToolbarLeft, EditorViewerToolbarRight } from '@/components/viewer-toolbar'
import { clearScene, isSceneGraph, loadScene, saveScene } from './store'

function EditorItemsPanel() {
  return <ItemsPanel showSourceFilter={false} showTagFilters={false} />
}

const tabIcon = (src: string) => (
  <img alt="" className="h-8 w-8 object-contain" height={32} src={src} width={32} />
)

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scene',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
    icon: tabIcon('./icons/scene.webp'),
  },
  {
    id: 'build',
    label: 'Build',
    component: BuildTab,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Hammer className="h-5 w-5" />,
    icon: tabIcon('./icons/build.webp'),
  },
  {
    id: 'paint',
    label: 'Paint',
    component: PaintPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Palette className="h-5 w-5" />,
    icon: tabIcon('./icons/paint.webp'),
  },
  {
    id: 'items',
    label: 'Items',
    component: EditorItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
    icon: tabIcon('./icons/couch.webp'),
  },
  {
    id: 'settings',
    label: 'Settings',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
    icon: tabIcon('./icons/settings.webp'),
  },
]

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Saved in this browser',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved in this browser',
  paused: 'Autosave paused',
  error: 'Save failed',
}

const BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs hover:bg-accent hover:text-foreground'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function StaticNavbar({ status, onError }: { status: SaveStatus; onError: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)

  const exportJson = () => {
    const doc = getSavedSceneDocument()
    const date = new Date().toISOString().split('T')[0]
    download(`pascal-scene_${date}.json`, JSON.stringify(doc, null, 2))
  }

  const importJson = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      onError('That file is not JSON.')
      return
    }
    if (!isSceneGraph(parsed)) {
      onError('That JSON file is not a Pascal scene (it needs nodes and rootNodeIds).')
      return
    }
    if (!window.confirm('Replace the scene in this browser with the file? Export first to keep it.')) return
    const { nodes, rootNodeIds, collections, materials, installedPlugins } = parsed
    await saveScene({ nodes, rootNodeIds, collections, materials, installedPlugins })
    window.location.reload()
  }

  const newScene = async () => {
    if (!window.confirm('Start a new scene? This deletes the scene in this browser. Export first to keep it.'))
      return
    await clearScene()
    window.location.reload()
  }

  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-border/30 border-b bg-sidebar px-2 lg:px-3">
      <span className="mr-2 font-semibold text-foreground text-sm">Pascal Editor</span>
      <span className="truncate text-muted-foreground text-xs" title="Scenes stay in IndexedDB in this browser">
        {STATUS_TEXT[status]}
      </span>
      <span className="flex-1" />
      <button className={BTN} onClick={newScene} title="New scene" type="button">
        <FilePlus className="h-4 w-4" />
        <span className="hidden xl:inline">New</span>
      </button>
      <button className={BTN} onClick={() => fileRef.current?.click()} title="Import a scene JSON file" type="button">
        <Upload className="h-4 w-4" />
        <span className="hidden xl:inline">Import</span>
      </button>
      <button className={BTN} onClick={exportJson} title="Export the scene as a JSON file" type="button">
        <Download className="h-4 w-4" />
        <span className="hidden xl:inline">Export</span>
      </button>
      <input accept="application/json,.json" className="hidden" onChange={importJson} ref={fileRef} type="file" />
    </nav>
  )
}

export function App() {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.classList.add('dark')
  }, [])

  const handleLoad = useCallback(async () => {
    try {
      const row = await loadScene()
      return row?.graph ?? null
    } catch (e) {
      setError('This browser blocks IndexedDB, so the scene will not be kept. Use Export to save it.')
      console.warn('[sn-pascal] load failed', e)
      return null
    }
  }, [])

  const handleSave = useCallback(async (graph: SceneGraph) => {
    try {
      await saveScene(graph)
      setError(null)
    } catch (e) {
      setError('Save to browser storage failed. Use Export to keep your work.')
      throw e
    }
  }, [])

  return (
    <div className="dark relative h-screen w-screen">
      {error && (
        <div className="dark pointer-events-auto absolute top-14 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background px-4 py-2 text-center shadow-xl">
          <p className="font-medium text-destructive text-xs">{error}</p>
          <button className="mt-1 text-muted-foreground text-xs underline" onClick={() => setError(null)} type="button">
            Dismiss
          </button>
        </div>
      )}
      <Editor
        layoutVersion="v2"
        navbarSlot={<StaticNavbar onError={setError} status={status} />}
        onLoad={handleLoad}
        onSave={handleSave}
        onSaveStatusChange={setStatus}
        projectId="sn-local"
        projectName="Pascal scene"
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={<EditorViewerToolbarLeft />}
        viewerToolbarRight={<EditorViewerToolbarRight vrButton={null} vrLabel="Enter VR" />}
      />
    </div>
  )
}
