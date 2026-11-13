import { initialProject, type Project } from 'glpython-editor'
import type { LibraryState } from './libraries'
import type { SharedLink } from './projectShare'
import type { Feature } from './features'
import { channelKey } from './channel'

// Per-tab projects (P25), as in WebTigerPython: each browser tab has its own
// project. Opening a share link never replaces another tab's work, and
// closing a tab releases its project - no new tab loads it by itself.
//
// - The tab's id is in sessionStorage and in history.state, never in the
//   address: the address stays the bare start page, as in WebTigerPython.
//   A reload keeps both. When iPad Safari unloads a background tab and
//   rebuilds it, only history.state survives (checked with the storage-check
//   page, iPadOS 26.6); after quitting Safari, neither does.
// - The projects are in localStorage, one entry per tab id. Nothing is
//   deleted when a tab goes away: a page can't tell a close from Safari
//   unloading it. A project no open tab holds is listed under «Zuletzt
//   geschlossen» for 14 days, and a fresh tab offers the last one it finds.
const SESSION_KEY = channelKey('glpython-tab')
const STATE_KEY = channelKey('glpythonTab')
const ENTRY_PREFIX = channelKey('glpython-tab-project:')
// The one project the IDE kept before per-tab projects; taken over once.
const LEGACY_KEY = channelKey('glpython-project')
const KEEP_MS = 14 * 24 * 60 * 60 * 1000

export type TabEntry = {
  id: string
  project: Project
  // The project's fingerprint at the last «Teilen» or «Herunterladen» (or
  // when it was opened from a link, or as an empty project): changes since
  // then are unsaved.
  savedFingerprint: string
  // The last change to the project.
  changedAt: number
  // Its libraries by URL (path → state), see libraries.ts.
  libraries?: Record<string, LibraryState>
  // The tab it opens with (a share link's `openFile`, e.g. a task's
  // instructions), also after a reload and in its own «Teilen» links; a
  // library by URL becomes it once fetched.
  openFile?: string
  // The tabs' order, as in the link (libraries by URL among the files).
  fileOrder?: string[]
  // Which parts the IDE shows in this tab (features.ts), from a link or
  // ⋮ «Optionen»; without it, the IDE's defaults.
  features?: Feature[]
}

// A fresh tab's project: one empty file to run. Decided by content, not by
// name (which follows the language at creation), so an untouched one is
// never offered or listed as closed. Tabs from before November 2026 started
// with glpython-editor's starter project; untouched, it counts the same.
export function isEmptyProject(project: Project): boolean {
  const files = Object.values(project.files)
  return (files.length === 1 && files[0].path === project.mainFile && files[0].code === '') || projectFingerprint(project) === FORMER_STARTER
}

// Changes of a project's content (name, the learner's files, file to run), as
// a short hash. Read-only files (a course's libraries) aren't the learner's
// work: a library arriving after its fetch is no change.
export function projectFingerprint(project: Project): string {
  const text = JSON.stringify([project.name, project.mainFile, Object.values(project.files).filter((file) => !file.readOnly).map((file) => [file.path, file.kind, file.code])])
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

const FORMER_STARTER = projectFingerprint(initialProject)

function newTabId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function readJson<T>(storage: Storage, key: string): T | null {
  try {
    const value = storage.getItem(key)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

export function loadEntry(id: string): TabEntry | null {
  const entry = readJson<TabEntry>(localStorage, ENTRY_PREFIX + id)
  return entry && entry.project && entry.project.files ? entry : null
}

// Saves an entry; when the storage is full, the oldest projects no tab
// holds make room first.
export function saveEntry(entry: TabEntry, liveIds: Set<string> = new Set()): void {
  const value = JSON.stringify(entry)
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      localStorage.setItem(ENTRY_PREFIX + entry.id, value)
      return
    } catch {
      const oldest = listEntries().filter((other) => other.id !== entry.id && !liveIds.has(other.id)).sort((a, b) => a.changedAt - b.changedAt)[0]
      if (!oldest) return
      removeEntry(oldest.id)
    }
  }
}

export function removeEntry(id: string): void {
  try { localStorage.removeItem(ENTRY_PREFIX + id) } catch { /* storage unavailable */ }
}

export function listEntries(): TabEntry[] {
  const entries: TabEntry[] = []
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(ENTRY_PREFIX)) continue
      const entry = loadEntry(key.slice(ENTRY_PREFIX.length))
      if (entry) entries.push(entry)
    }
  } catch { /* storage unavailable */ }
  return entries
}

// Projects not changed for 14 days are gone.
export function pruneEntries(keepId: string): void {
  const limit = Date.now() - KEEP_MS
  for (const entry of listEntries()) if (entry.id !== keepId && entry.changedAt < limit) removeEntry(entry.id)
}

function readTabId(): string | null {
  try {
    const fromSession = sessionStorage.getItem(SESSION_KEY)
    if (fromSession) return fromSession
  } catch { /* storage unavailable */ }
  const state = history.state as Record<string, unknown> | null
  return state && typeof state[STATE_KEY] === 'string' ? state[STATE_KEY] as string : null
}

// Marks this tab as holding `id`, and leaves the bare start page in the
// address (a share link's `?project=`/`#project=` is gone then).
export function claimTabId(id: string): void {
  try { sessionStorage.setItem(SESSION_KEY, id) } catch { /* storage unavailable */ }
  const state = history.state && typeof history.state === 'object' ? history.state as Record<string, unknown> : {}
  history.replaceState({ ...state, [STATE_KEY]: id }, '', window.location.pathname)
}

// The project this tab starts with: a share link's (always a new tab
// project, its libraries still to fetch), else the one this tab held before
// (reload, or Safari rebuilding the tab), else - in a tab without one - the
// IDE's former single project (once) or `empty` (one empty main.py). `fresh`
// is true for the empty one: only then is another tab's project offered (see
// recentlyClosed). A link that can't be read gives `empty` and `broken`:
// never another project.
// `features`: a plain `?features=` on the address, for this tab (a link's
// own `features` win).
export function startTab(link: SharedLink, empty: Project, features: Feature[] | null = null): { entry: TabEntry; fresh: boolean; broken: boolean } {
  const started = startTabEntry(link, empty)
  const chosen = (link.status === 'ok' ? link.features : undefined) ?? features ?? undefined
  if (chosen) {
    started.entry = { ...started.entry, features: chosen }
    saveEntry(started.entry)
  }
  return started
}

function startTabEntry(link: SharedLink, empty: Project): { entry: TabEntry; fresh: boolean; broken: boolean } {
  const restoreId = new URLSearchParams(window.location.search).get('restore')
  if (link.status === 'broken') return { entry: newTabEntry(empty, projectFingerprint(empty)), fresh: false, broken: true }
  if (link.status === 'ok') {
    const libraries = Object.fromEntries(Object.entries(link.libraries).map(([path, url]) => [path, { url, status: 'loading' as const }]))
    return { entry: newTabEntry(link.project, projectFingerprint(link.project), Date.now(), libraries, link.openFile, link.order), fresh: false, broken: false }
  }
  // «Öffnen» in «Zuletzt geschlossen» opens a closed project in a new tab.
  const restored = restoreId ? loadEntry(restoreId) : null
  if (restored) {
    claimTabId(restored.id)
    return { entry: restored, fresh: false, broken: false }
  }
  const ownId = readTabId()
  const own = ownId ? loadEntry(ownId) : null
  if (own) {
    claimTabId(own.id)
    return { entry: own, fresh: false, broken: false }
  }
  const legacy = readJson<Project>(localStorage, LEGACY_KEY)
  if (legacy && legacy.files) {
    // Counts as unsaved: it was never shared from a tab.
    const entry = newTabEntry(legacy, '')
    try { localStorage.removeItem(LEGACY_KEY) } catch { /* storage unavailable */ }
    return { entry, fresh: false, broken: false }
  }
  return { entry: newTabEntry(empty, projectFingerprint(empty)), fresh: true, broken: false }
}

// A new tab project, held by this tab: an empty one, an imported project, or
// a copy (a duplicated tab gets its own). The one this tab held before stays
// as it is, among «Zuletzt geschlossen».
export function newTabEntry(project: Project, savedFingerprint: string, changedAt = Date.now(), libraries: Record<string, LibraryState> = {}, openFile?: string, fileOrder?: string[], features?: Feature[]): TabEntry {
  const entry: TabEntry = { id: newTabId(), project, savedFingerprint, changedAt, libraries, ...(openFile ? { openFile } : {}), ...(fileOrder ? { fileOrder } : {}), ...(features ? { features } : {}) }
  saveEntry(entry)
  claimTabId(entry.id)
  return entry
}

// The ids the other open tabs hold, asked over a BroadcastChannel: each
// open IDE tab answers with its own (see answerTabQueries).
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(channelKey('glpython-tabs'))
export function answerTabQueries(currentId: () => string): () => void {
  if (!channel) return () => undefined
  const answer = (event: MessageEvent) => { if (event.data?.type === 'who') channel.postMessage({ type: 'here', id: currentId() }) }
  channel.addEventListener('message', answer)
  return () => channel.removeEventListener('message', answer)
}
export function otherLiveTabIds(): Promise<Set<string>> {
  if (!channel) return Promise.resolve(new Set())
  return new Promise((resolve) => {
    const ids = new Set<string>()
    const collect = (event: MessageEvent) => { if (event.data?.type === 'here' && typeof event.data.id === 'string') ids.add(event.data.id) }
    channel.addEventListener('message', collect)
    channel.postMessage({ type: 'who' })
    window.setTimeout(() => {
      channel.removeEventListener('message', collect)
      resolve(ids)
    }, 300)
  })
}

// The projects no open tab holds, most recently changed first - without
// untouched empty ones, which there is nothing to come back to.
export function recentlyClosed(currentId: string, liveIds: Set<string>): TabEntry[] {
  return listEntries()
    .filter((entry) => entry.id !== currentId && !liveIds.has(entry.id) && !isEmptyProject(entry.project))
    .sort((a, b) => b.changedAt - a.changedAt)
}
