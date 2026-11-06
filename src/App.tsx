import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen, CircleHelp, Download, Info, EllipsisVertical, SlidersHorizontal, FileCode2, FilePlus2, Folder, FolderOpen, History, Link2, Lock, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { GlPythonWorkspace, addProjectFile, deleteProjectFile, renameProjectFile, updateProjectFile } from 'glpython-editor'
import type { Project, ProjectFileKind, WorkspaceCommand } from 'glpython-editor'
import 'glpython-editor/style.css'
import { initializeAuth } from './auth'
import { exportProjectZip, importProjectFolder, importProjectZip } from './projectStorage'
import { buildShareUrl, readSharedLinkFromLocation } from './projectShare'
import { fetchLibrary, libraryHost, type LibraryState } from './libraries'
import { renderMarkdown } from './markdown'
import { capabilitiesOf, DEFAULT_FEATURES, FEATURE_NAMES, readFeaturesParam, type Feature } from './features'
import { answerTabQueries, claimTabId, isEmptyProject, newTabEntry, otherLiveTabIds, projectFingerprint, pruneEntries, recentlyClosed, removeEntry, saveEntry, startTab, type TabEntry } from './tabProjects'
import { detectLocale, localeNames, saveLocale, translations, type Locale } from './i18n'

// This tab's project to start with (see tabProjects.ts): a share link's
// (`?project=`), else the one this tab held before, else one empty main.py -
// learners arrive by links, and the editor's placeholder says what to do; for
// a link that can't be read, that empty project and a notice. Runs once at
// module load, since every useState initializer below needs the same result.
const EMPTY_PROJECT: Project = { id: 'empty', name: translations[detectLocale()].emptyProjectName, mainFile: 'main.py', files: { 'main.py': { path: 'main.py', label: 'main', kind: 'python', code: '' } } }
const startup = startTab(readSharedLinkFromLocation(), EMPTY_PROJECT, readFeaturesParam())
// OneNote cuts links at 2,083 characters (Internet Explorer's old limit,
// which other programs kept too): «Teilen» copies longer ones with a note.
const LONG_LINK = 2083
// A fresh tab offers the last project closed within a day: after Safari or
// the iPad restarted, a tab comes back empty.
const OFFER_CLOSED_MS = 24 * 60 * 60 * 1000

// «vor 2 Stunden», «2 hours ago»; under a minute «gerade eben».
function timeAgo(time: number, locale: string, justNow: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minutes = Math.round((time - Date.now()) / 60000)
  if (minutes === 0) return justNow
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return format.format(hours, 'hour')
  return format.format(Math.round(hours / 24), 'day')
}

// The IDE's version (the commit it was built from, and when) and the one
// deployed now (version.json, see vite.config.ts): a tab that stayed open -
// on an iPad often for days - offers to load the new one; ⋮ «Info» shows it.
declare const __GLPYTHON_IDE_VERSION__: string
// The glpython-editor version it bundles (its tag), for ⋮ «Info» too: most
// of what learners see (editor, Tests, visualizer, hints) comes from there.
declare const __GLPYTHON_EDITOR_VERSION__: string
declare const __GLPYTHON_IDE_BUILT__: string
const VERSION_CHECK_MS = 30 * 60 * 1000
async function checkForNewVersion(): Promise<'current' | 'available' | 'failed'> {
  if (import.meta.env.DEV) return 'current'
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    const { version } = await response.json() as { version?: string }
    if (!version) return 'failed'
    return version === __GLPYTHON_IDE_VERSION__ ? 'current' : 'available'
  } catch {
    return 'failed'
  }
}

// Moves keyboard focus through a menu's items with the arrow keys, Home and
// End, as a menu does; Escape is the caller's.
function moveMenuFocus(event: ReactKeyboardEvent<HTMLElement>, menu: HTMLElement | null) {
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
  if (items.length === 0) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[event.key]
  if (next === undefined) return
  event.preventDefault()
  items[(next + items.length) % items.length].focus()
}

// The IDE is the embed, only larger (P18): one bar on top with the
// workspace's own buttons (▶ Ausführen · Tests · Visualisieren, put there by
// the workspace), Teilen and a ⋮ menu for what is rarely needed (among it
// «Python neu starten»: ▶ already starts afresh and ■ stops a hung program,
// and learners read «Zurücksetzen» as "reset my code");
// at the left edge the files (a drawer) and the Python reference; below, the
// workspace in its stacked layout.
function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const t = translations[locale]
  const [project, setProject] = useState(() => startup.entry.project)
  // The tab open at the start: the link's `openFile` (e.g. a task's
  // instructions), else the file that runs. A library by URL is a file
  // only once fetched: until then, the file that runs.
  const [activeFile, setActiveFile] = useState(() => startup.entry.openFile && startup.entry.project.files[startup.entry.openFile] ? startup.entry.openFile : startup.entry.project.mainFile)
  // That `openFile`, kept with the tab's project and in its «Teilen» links.
  // A library by URL becomes the open tab once fetched - unless the learner
  // has chosen a tab in the meantime.
  const [openFile, setOpenFile] = useState(startup.entry.openFile)
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  const tabChosenRef = useRef(false)
  const chooseTab = (path: string) => {
    tabChosenRef.current = true
    setActiveFile(path)
  }
  // The tabs' order: the link's (libraries by URL among the files), new
  // files after them.
  const [fileOrder, setFileOrder] = useState(startup.entry.fileOrder)
  // Which parts the IDE shows in this tab (features.ts): a link's settings or
  // ⋮ «Optionen»'s, else the defaults. Settings once chosen go into «Teilen».
  const [features, setFeatures] = useState<Feature[] | undefined>(startup.entry.features)
  const shownFeatures = features ?? DEFAULT_FEATURES
  const [isOptionsOpen, setIsOptionsOpen] = useState(false)
  const optionsDialogRef = useRef<HTMLDivElement | null>(null)
  const toggleFeature = (name: Feature) => setFeatures((current) => {
    const now = current ?? DEFAULT_FEATURES
    return FEATURE_NAMES.filter((other) => other === name ? !now.includes(name) : now.includes(other))
  })
  // This tab's project (tabProjects.ts): its id, and its fingerprint at the
  // last «Teilen»/«Herunterladen» - changes since then are unsaved, and the
  // browser asks before the tab is closed or reloaded.
  const [tabId, setTabId] = useState(startup.entry.id)
  const [savedFingerprint, setSavedFingerprint] = useState(startup.entry.savedFingerprint)
  const changedAtRef = useRef(startup.entry.changedAt)
  const lastFingerprintRef = useRef(projectFingerprint(startup.entry.project))
  const unsavedRef = useRef(false)
  // The offer of a closed project in a fresh tab, the «Zuletzt geschlossen»
  // list (null while closed), and the notice of a new IDE version.
  const [closedOffer, setClosedOffer] = useState<TabEntry[]>([])
  const [closedList, setClosedList] = useState<TabEntry[] | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  // ⋮ «Info»: open, and the result of its «Nach Updates suchen».
  const [isInfoOpen, setIsInfoOpen] = useState(false)
  const [infoCheck, setInfoCheck] = useState<'idle' | 'checking' | 'current' | 'available' | 'failed'>('idle')
  const infoDialogRef = useRef<HTMLDivElement | null>(null)
  // The project's libraries by URL (libraries.ts); a link that couldn't be
  // read; the length of a long link just copied.
  const [libraries, setLibraries] = useState<Record<string, LibraryState>>(() => startup.entry.libraries ?? {})
  const [brokenLink, setBrokenLink] = useState(startup.broken)
  const [longLinkLength, setLongLinkLength] = useState<number | null>(null)
  const fetchingRef = useRef(new Set<string>())
  const [authErrorKey, setAuthErrorKey] = useState<'' | 'init' | 'config' | 'cancelled'>('')
  // The workspace decides itself when to show graphics (only while the
  // program draws); these props are for hosts with their own toggle.
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(false)
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  // «Python neu starten»: the workspace's reset command - a new Python and an
  // empty console, as the embed's Reset; the code is the IDE's and stays.
  const [workspaceCommand, setWorkspaceCommand] = useState<WorkspaceCommand | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const filesButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const closedDialogRef = useRef<HTMLDivElement | null>(null)
  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId

  useEffect(() => {
    const fingerprint = projectFingerprint(project)
    if (fingerprint !== lastFingerprintRef.current) changedAtRef.current = Date.now()
    lastFingerprintRef.current = fingerprint
    unsavedRef.current = fingerprint !== savedFingerprint
    saveEntry({ id: tabId, project, savedFingerprint, changedAt: changedAtRef.current, libraries, ...(openFile && (project.files[openFile] || libraries[openFile]) ? { openFile } : {}), ...(fileOrder ? { fileOrder } : {}), ...(features ? { features } : {}) })
  }, [project, savedFingerprint, tabId, libraries, openFile, fileOrder, features])

  // Libraries still to fetch: once, when the link opened (and again after
  // «Erneut versuchen»); fetched, a library is a read-only file of the project.
  useEffect(() => {
    for (const [path, library] of Object.entries(libraries)) {
      if (library.status !== 'loading' || fetchingRef.current.has(path)) continue
      fetchingRef.current.add(path)
      const forTab = tabIdRef.current
      void fetchLibrary(library.url, t).then((result) => {
        fetchingRef.current.delete(path)
        if (tabIdRef.current !== forTab) return
        if ('code' in result) setProject((current) => ({ ...current, files: { ...current.files, [path]: { path, label: path.replace(/\.[^/.]+$/, ''), kind: /\.py$/i.test(path) ? 'python' : 'text', code: result.code, readOnly: true } } }))
        if ('code' in result && path === openFileRef.current && !tabChosenRef.current) setActiveFile(path)
        setLibraries((current) => current[path]?.url !== library.url ? current : { ...current, [path]: 'code' in result ? { url: library.url, status: 'loaded' } : { url: library.url, status: 'failed', failure: result.failure } })
      })
    }
  }, [libraries, t])
  const retryLibrary = (path: string) => setLibraries((current) => current[path] ? { ...current, [path]: { url: current[path].url, status: 'loading' } } : current)
  const libraryUrls = Object.fromEntries(Object.entries(libraries).map(([path, library]) => [path, library.url]))

  // Other IDE tabs ask which projects are open; a duplicated tab (same id as
  // an open one) takes its own copy; a fresh tab offers the last closed
  // project; projects older than 14 days go.
  useEffect(() => {
    const stopAnswering = answerTabQueries(() => tabIdRef.current)
    void otherLiveTabIds().then((liveIds) => {
      if (liveIds.has(tabIdRef.current)) {
        const copy = newTabEntry(project, savedFingerprint, changedAtRef.current, libraries, openFile, fileOrder, features)
        setTabId(copy.id)
      }
      if (startup.fresh) setClosedOffer(recentlyClosed(tabIdRef.current, liveIds).filter((entry) => Date.now() - entry.changedAt < OFFER_CLOSED_MS))
      pruneEntries(tabIdRef.current)
    })
    return stopAnswering
    // Once, at the start of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Closing or reloading the tab with unsaved changes: the browser's own
  // question (not on an iPad, whose Safari never asks).
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // A new IDE version: checked when the tab comes back into view and every
  // 30 minutes (not in development, which has no version.json).
  useEffect(() => {
    if (import.meta.env.DEV) return
    // Offline: tried again later.
    const check = async () => { if (await checkForNewVersion() === 'available') setUpdateAvailable(true) }
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => { void check() }, VERSION_CHECK_MS)
    void check()
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    initializeAuth().catch(() => setAuthErrorKey('init'))
  }, [])

  // The drawer and the menu take keyboard focus when they open; a click
  // elsewhere closes them (the drawer: anywhere but itself and 📁).
  useEffect(() => {
    if (!isDrawerOpen) return
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!drawerRef.current?.contains(event.target as Node) && !filesButtonRef.current?.contains(event.target as Node)) setIsDrawerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isDrawerOpen])
  useEffect(() => {
    if (!isMenuOpen) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuButtonRef.current?.contains(event.target as Node)) setIsMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isMenuOpen])

  const closeDrawer = () => {
    setIsDrawerOpen(false)
    filesButtonRef.current?.focus()
  }
  const closeMenu = () => {
    setIsMenuOpen(false)
    menuButtonRef.current?.focus()
  }
  // A menu item: closes the menu, then acts.
  const fromMenu = (action: () => void) => () => {
    setIsMenuOpen(false)
    action()
  }

  const selectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale)
    saveLocale(nextLocale)
  }

  const renameProject = () => {
    const requestedName = window.prompt(t.promptRenameProject, project.name)?.trim()
    if (!requestedName || requestedName === project.name) return
    setProject((currentProject) => ({ ...currentProject, name: requestedName }))
  }

  const addFile = () => {
    const requestedPath = window.prompt(t.promptFileName, t.promptDefaultFileName)?.trim()
    if (!requestedPath || project.files[requestedPath]) return
    const kind: ProjectFileKind = requestedPath.endsWith('.py') ? 'python' : 'text'
    const newFile = { path: requestedPath, label: requestedPath.replace(/\.[^/.]+$/, ''), kind, code: '' }
    setProject((currentProject) => addProjectFile(currentProject, newFile))
    setActiveFile(requestedPath)
  }

  const renameFile = (path: string) => {
    const requestedPath = window.prompt(t.promptRenameFile, path)?.trim()
    if (!requestedPath || requestedPath === path || project.files[requestedPath]) return
    setProject((currentProject) => renameProjectFile(currentProject, path, requestedPath))
    if (activeFile === path) setActiveFile(requestedPath)
    if (openFile === path) setOpenFile(requestedPath)
    setFileOrder((order) => order?.map((other) => other === path ? requestedPath : other))
  }

  const deleteFile = (path: string) => {
    if (Object.keys(project.files).length === 1 || !window.confirm(t.confirmDeleteFile(path))) return
    const remainingPaths = Object.keys(project.files).filter((filePath) => filePath !== path)
    setProject((currentProject) => deleteProjectFile(currentProject, path))
    if (activeFile === path) setActiveFile(remainingPaths[0])
    if (openFile === path) setOpenFile(undefined)
  }

  const downloadProject = async () => {
    const blob = await exportProjectZip(project, libraryUrls, openFile)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.zip`
    link.click()
    URL.revokeObjectURL(url)
    setSavedFingerprint(projectFingerprint(project))
  }

  // Teilen: the link to a copy of this project, copied with a short
  // confirmation beside the button, or shown to copy by hand.
  const shareProject = async () => {
    const shareUrl = buildShareUrl(project, libraryUrls, openFile, orderedPaths, features)
    setLongLinkLength(shareUrl.length > LONG_LINK ? shareUrl.length : null)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 3000)
    } catch {
      window.prompt(t.shareLinkPromptLabel, shareUrl)
    }
    setSavedFingerprint(projectFingerprint(project))
  }

  // Another project in this tab (opened, imported, or «Neues leeres
  // Projekt»): a new tab project, so the one before stays among «Zuletzt
  // geschlossen» - unless it is an untouched empty one, which there is nothing
  // to come back to.
  const switchTabProject = (nextProject: Project, nextSavedFingerprint: string, entry?: TabEntry, nextLibraries: Record<string, string> = {}, nextOpenFile?: string) => {
    if (isEmptyProject(project)) removeEntry(tabId)
    const next = entry ?? newTabEntry(nextProject, nextSavedFingerprint, Date.now(), Object.fromEntries(Object.entries(nextLibraries).map(([path, url]) => [path, { url, status: 'loaded' as const }])), nextOpenFile)
    if (entry) claimTabId(entry.id)
    changedAtRef.current = next.changedAt
    lastFingerprintRef.current = projectFingerprint(next.project)
    setTabId(next.id)
    setSavedFingerprint(next.savedFingerprint)
    setProject(next.project)
    setActiveFile(next.openFile && next.project.files[next.openFile] ? next.openFile : next.project.mainFile)
    setOpenFile(next.openFile)
    setFileOrder(next.fileOrder)
    setFeatures(next.features)
    tabChosenRef.current = false
    setLibraries(next.libraries ?? {})
    setClosedOffer([])
    setBrokenLink(false)
    setLongLinkLength(null)
  }

  // A closed project: in this tab if it holds only an untouched empty project,
  // else in a new browser tab (`?restore=`, see startTab).
  const openClosedProject = (entry: TabEntry) => {
    setClosedList(null)
    if (isEmptyProject(project)) switchTabProject(entry.project, entry.savedFingerprint, entry)
    else window.open(`/?restore=${encodeURIComponent(entry.id)}`, '_blank', 'noopener')
  }
  const showClosedProjects = () => {
    void otherLiveTabIds().then((liveIds) => setClosedList(recentlyClosed(tabIdRef.current, liveIds)))
  }
  const removeClosedProject = (entry: TabEntry) => {
    removeEntry(entry.id)
    setClosedList((list) => list?.filter((other) => other.id !== entry.id) ?? null)
    setClosedOffer((list) => list.filter((other) => other.id !== entry.id))
  }
  useEffect(() => {
    if (closedList) closedDialogRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [closedList])

  // ⋮ «Info»: the version (when a learner reports a problem: «Was steht unter
  // ⋮ → Info?») and the same check as the «Neue Version verfügbar» notice.
  const versionDate = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(__GLPYTHON_IDE_BUILT__))
  const checkForUpdates = async () => {
    setInfoCheck('checking')
    const result = await checkForNewVersion()
    setInfoCheck(result)
    if (result === 'available') setUpdateAvailable(true)
  }
  const closeInfo = () => {
    setIsInfoOpen(false)
    menuButtonRef.current?.focus()
  }
  useEffect(() => {
    if (isInfoOpen) infoDialogRef.current?.querySelector<HTMLElement>('button')?.focus()
  }, [isInfoOpen])
  const closeOptions = () => {
    setIsOptionsOpen(false)
    menuButtonRef.current?.focus()
  }
  useEffect(() => {
    if (isOptionsOpen) optionsDialogRef.current?.querySelector<HTMLElement>('input')?.focus()
  }, [isOptionsOpen])

  const openFolder = async () => {
    try {
      const importedProject = await importProjectFolder(project)
      if (!importedProject) {
        zipInputRef.current?.click()
        return
      }
      switchTabProject(importedProject.project, projectFingerprint(importedProject.project), undefined, importedProject.libraries, importedProject.openFile)
    } catch {
      // Folder picker not supported or cancelled - importProjectFolder already
      // falls back to the hidden zip <input> above when appropriate.
    }
  }

  const openZip = async (file: File) => {
    const importedProject = await importProjectZip(file, project)
    switchTabProject(importedProject.project, projectFingerprint(importedProject.project), undefined, importedProject.libraries, importedProject.openFile)
  }

  const authErrorMessage = authErrorKey === 'init' ? t.authInitError : authErrorKey === 'config' ? t.authConfigError : authErrorKey === 'cancelled' ? t.authCancelledError : ''
  const filePaths = Object.keys(project.files)
  const orderIndex = (path: string) => { const index = fileOrder?.indexOf(path) ?? -1; return index === -1 ? Infinity : index }
  const orderedPaths = [...filePaths].sort((a, b) => orderIndex(a) - orderIndex(b))
  // The learner's own files; libraries are listed apart in the drawer.
  const ownPaths = filePaths.filter((path) => !libraries[path])

  return (
    <div className="ide">
      <header className="ide-bar">
        <div className="ide-brand"><span className="ide-brand-mark" aria-hidden="true"><Sparkles size={16} /></span><span>glpython</span></div>
        <div className="ide-actions" ref={setActionsContainer} />
        <div className="ide-bar-end">
          {shareCopied && <span className="ide-share-status" role="status">{t.shareCopied}</span>}
          <button type="button" className="secondary-button" onClick={() => { void shareProject() }}><Link2 size={15} /> {t.share}</button>
          <div className="ide-menu">
            <button type="button" ref={menuButtonRef} className="icon-button ide-menu-button" aria-label={t.moreActions} title={t.moreActions} aria-haspopup="menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}><EllipsisVertical size={18} /></button>
            {isMenuOpen && <div className="ide-menu-list" role="menu" ref={menuRef} aria-label={t.moreActions} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeMenu() } else if (event.key === 'Tab') setIsMenuOpen(false); else moveMenuFocus(event, menuRef.current) }}>
              <button type="button" role="menuitem" onClick={fromMenu(() => setWorkspaceCommand((current) => ({ id: (current?.id ?? 0) + 1, type: 'reset' })))}><RotateCcw size={15} /> {t.restartPython}</button>
              <div className="ide-menu-group" role="group" aria-label={t.projectMenu}>
              <button type="button" role="menuitem" onClick={fromMenu(() => switchTabProject(EMPTY_PROJECT, projectFingerprint(EMPTY_PROJECT)))}><FilePlus2 size={15} /> {t.newProject}</button>
              <button type="button" role="menuitem" onClick={fromMenu(showClosedProjects)}><History size={15} /> {t.recentlyClosed}</button>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); void openFolder() }}><FolderOpen size={15} /> {t.openFolder}</button>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); zipInputRef.current?.click() }}><Upload size={15} /> {t.openProject}</button>
              <button type="button" role="menuitem" onClick={fromMenu(() => { void downloadProject() })}><Download size={15} /> {t.downloadProject}</button>
              </div>
              <div className="ide-menu-group" role="group" aria-label={t.language}>
                <span className="ide-menu-label" aria-hidden="true">{t.language}</span>
                {(Object.keys(localeNames) as Locale[]).map((code) => <button type="button" key={code} role="menuitemradio" aria-checked={code === locale} onClick={fromMenu(() => selectLocale(code))}><span className="ide-menu-check" aria-hidden="true" /> {localeNames[code]}</button>)}
              </div>
              <div className="ide-menu-group">
                <button type="button" role="menuitem" onClick={fromMenu(() => setIsOptionsOpen(true))}><SlidersHorizontal size={15} /> {t.options}</button>
                <button type="button" role="menuitem" onClick={fromMenu(() => { setInfoCheck('idle'); setIsInfoOpen(true) })}><Info size={15} /> {t.about}</button>
              </div>
            </div>}
          </div>
          <input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openZip(file); event.target.value = '' }} />
        </div>
      </header>
      <div className="ide-body">
        <nav className="ide-rail" aria-label={t.ideTools}>
          <button type="button" ref={filesButtonRef} className="icon-button" aria-label={t.files} title={t.files} aria-expanded={isDrawerOpen} aria-controls="ide-files" onClick={() => setIsDrawerOpen((open) => !open)}><Folder size={19} /></button>
          <a className="icon-button" href="https://docs.python.org/3/reference/index.html" target="_blank" rel="noreferrer" aria-label={t.pythonReference} title={t.pythonReference}><CircleHelp size={19} /></a>
        </nav>
        {isDrawerOpen && <aside id="ide-files" className="ide-drawer" ref={drawerRef} aria-label={t.files} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeDrawer() } }}>
          <div className="ide-drawer-head">
            <span className="ide-drawer-title">{t.files}</span>
            <button type="button" className="icon-button small" aria-label={t.closeFiles} title={t.closeFiles} onClick={closeDrawer}><X size={16} /></button>
          </div>
          <div className="ide-project-name">
            <span className="ide-project-label">{t.projectName}</span>
            <div className="ide-project-row"><strong>{project.name}</strong><button type="button" className="icon-button small" aria-label={t.renameProject} title={t.renameProject} onClick={renameProject}><Pencil size={15} /></button></div>
          </div>
          <ul className="ide-file-list">
            {ownPaths.map((path) => { const file = project.files[path]; return <li key={path} className={path === activeFile ? 'active' : undefined}>
              <button type="button" className="ide-file-open" aria-current={path === activeFile ? 'true' : undefined} onClick={() => chooseTab(path)}>{file.kind === 'python' ? <FileCode2 size={15} /> : <BookOpen size={15} />}<span>{path}</span></button>
              {/* A read-only file (e.g. a course's library) can't be renamed or deleted either. */}
              {file.readOnly ? <span className="ide-file-read-only" role="img" aria-label={t.readOnlyFile} title={t.readOnlyFile}><Lock size={14} /></span> : <>
              <button type="button" className="icon-button small" aria-label={t.renameFile(path)} title={t.renameFile(path)} onClick={() => renameFile(path)}><Pencil size={14} /></button>
              <button type="button" className="icon-button small ide-file-delete" aria-label={t.deleteFile(path)} title={t.deleteFile(path)} disabled={ownPaths.length === 1} onClick={() => deleteFile(path)}><Trash2 size={14} /></button>
              </>}
            </li> })}
          </ul>
          <button type="button" className="secondary-button ide-new-file" onClick={addFile}><Plus size={15} /> {t.addFile}</button>
          {/* Files by URL (libraries.ts): read-only, with where they come from -
              Python files as libraries, other files (e.g. a task's instructions)
              to read. */}
          {[{ heading: t.libraries, python: true }, { heading: t.readingFiles, python: false }].map(({ heading, python }) => {
            const group = Object.entries(libraries).filter(([path]) => /\.py$/i.test(path) === python)
            return group.length > 0 && <div className="ide-libraries" key={heading}>
              <span className="ide-project-label">{heading}</span>
              <ul className="ide-file-list">
                {group.map(([path, library]) => <li key={path} className={path === activeFile ? 'active' : undefined}>
                  <button type="button" className="ide-file-open" aria-current={path === activeFile ? 'true' : undefined} disabled={library.status !== 'loaded'} onClick={() => chooseTab(path)}>{/\.py$/i.test(path) ? <FileCode2 size={15} /> : <BookOpen size={15} />}<span className="ide-library-name"><span>{path}</span><small className={library.status === 'failed' ? 'ide-library-failed' : undefined}>{library.status === 'loaded' ? t.librarySource(libraryHost(library.url)) : library.status === 'loading' ? t.libraryLoading : t.libraryFailed(path, library.failure ?? '')}</small></span></button>
                  {library.status === 'failed'
                    ? <button type="button" className="icon-button small" aria-label={t.retryLibrary(path)} title={t.retryLibrary(path)} onClick={() => retryLibrary(path)}><RotateCcw size={14} /></button>
                    : <span className="ide-file-read-only" role="img" aria-label={t.readOnlyFile} title={t.readOnlyFile}><Lock size={14} /></span>}
                </li>)}
              </ul>
            </div>
          })}
        </aside>}
        <main className="ide-main">
          {authErrorMessage && <div className="auth-notice" role="status">{authErrorMessage}</div>}
          {brokenLink && <div className="ide-notice ide-notice--warning" role="alert"><span>{t.brokenLink}</span><button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={() => setBrokenLink(false)}><X size={15} /></button></div>}
          {Object.entries(libraries).filter(([, library]) => library.status === 'failed').map(([path, library]) => <div key={path} className="ide-notice ide-notice--warning" role="status"><span>{t.libraryFailed(path, library.failure ?? '')}</span><button type="button" className="secondary-button" onClick={() => retryLibrary(path)}><RotateCcw size={14} /> {t.retry}</button></div>)}
          {longLinkLength !== null && <div className="ide-notice" role="status"><span>{t.longLink(longLinkLength)}</span><button type="button" className="secondary-button" onClick={() => { void downloadProject() }}><Download size={14} /> {t.downloadForHandIn}</button><button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={() => setLongLinkLength(null)}><X size={15} /></button></div>}
          {updateAvailable && <div className="ide-notice" role="status"><span>{t.updateAvailable}</span><button type="button" className="secondary-button" onClick={() => window.location.reload()}><RotateCcw size={14} /> {t.reloadNow}</button></div>}
          {closedOffer.length > 0 && <div className="ide-notice" role="status"><span>{t.lastEdited(closedOffer[0].project.mainFile, timeAgo(closedOffer[0].changedAt, locale, t.justNow))}</span><button type="button" className="secondary-button" onClick={() => openClosedProject(closedOffer[0])}>{t.openClosed}</button>{closedOffer.length > 1 && <button type="button" className="secondary-button" onClick={showClosedProjects}>{t.showAllClosed}</button>}<button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={() => setClosedOffer([])}><X size={15} /></button></div>}
          <GlPythonWorkspace
            project={project}
            activeFile={activeFile}
            openFiles={orderedPaths}
            onOpenFile={chooseTab}
            onCloseFile={() => undefined}
            onFileCodeChange={(path, code) => setProject((currentProject) => updateProjectFile(currentProject, path, code))}
            isGraphicsOpen={isGraphicsOpen}
            onGraphicsOpenChange={setIsGraphicsOpen}
            actionsContainer={actionsContainer}
            command={workspaceCommand}
            capabilities={{ breadcrumbs: false, closeFileTabs: false, resetOutput: false, ...capabilitiesOf(shownFeatures) }}
            renderMarkdown={renderMarkdown}
            t={t}
          />
        </main>
      </div>
      {isInfoOpen && <div className="ide-dialog-backdrop" role="presentation" onClick={closeInfo}>
        <div className="ide-dialog ide-info" role="dialog" aria-modal="true" aria-labelledby="ide-info-title" ref={infoDialogRef} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeInfo() } }}>
          <div className="ide-dialog-head"><strong id="ide-info-title">glpython</strong><button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={closeInfo}><X size={16} /></button></div>
          <dl className="ide-info-list">
            <dt>{t.version}</dt><dd><code>{__GLPYTHON_IDE_VERSION__.slice(0, 7)}</code></dd>
            <dt>{t.editorVersion}</dt><dd><code>{__GLPYTHON_EDITOR_VERSION__}</code></dd>
            <dt>{t.built}</dt><dd>{versionDate}</dd>
          </dl>
          <div className="ide-info-check">
            <button type="button" className="secondary-button" onClick={() => { void checkForUpdates() }} disabled={infoCheck === 'checking'}><RotateCcw size={14} /> {t.checkForUpdates}</button>
            <span role="status">{infoCheck === 'checking' ? t.checkingForUpdates : infoCheck === 'current' ? t.upToDate : infoCheck === 'failed' ? t.updateCheckFailed : ''}</span>
          </div>
          {infoCheck === 'available' && <div className="ide-notice" role="status"><span>{t.updateAvailable}</span><button type="button" className="secondary-button" onClick={() => window.location.reload()}><RotateCcw size={14} /> {t.reloadNow}</button></div>}
        </div>
      </div>}
      {/* ⋮ «Optionen»: which parts this tab shows (a link sets where it starts). */}
      {isOptionsOpen && <div className="ide-dialog-backdrop" role="presentation" onClick={closeOptions}>
        <div className="ide-dialog ide-options" role="dialog" aria-modal="true" aria-labelledby="ide-options-title" ref={optionsDialogRef} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeOptions() } }}>
          <div className="ide-dialog-head"><strong id="ide-options-title">{t.options}</strong><button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={closeOptions}><X size={16} /></button></div>
          <p className="ide-dialog-hint">{t.optionsHint}</p>
          <ul className="ide-options-list">
            {FEATURE_NAMES.map((name) => <li key={name}><label><input type="checkbox" checked={shownFeatures.includes(name)} onChange={() => toggleFeature(name)} /> <span>{t.featureLabels[name]}</span></label></li>)}
          </ul>
        </div>
      </div>}
      {closedList && <div className="ide-dialog-backdrop" role="presentation" onClick={() => setClosedList(null)}>
        <div className="ide-dialog" role="dialog" aria-modal="true" aria-labelledby="ide-closed-title" ref={closedDialogRef} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setClosedList(null); menuButtonRef.current?.focus() } }}>
          <div className="ide-dialog-head"><strong id="ide-closed-title">{t.recentlyClosed}</strong><button type="button" className="icon-button small" aria-label={t.dismiss} title={t.dismiss} onClick={() => setClosedList(null)}><X size={16} /></button></div>
          <p className="ide-dialog-hint">{t.recentlyClosedHint}</p>
          {closedList.length === 0 ? <p>{t.recentlyClosedEmpty}</p> : <ul className="ide-closed-list">
            {closedList.map((entry) => <li key={entry.id}>
              <span className="ide-closed-name"><strong>{entry.project.mainFile}</strong> <span>{entry.project.name} · {timeAgo(entry.changedAt, locale, t.justNow)}</span></span>
              <button type="button" className="secondary-button" onClick={() => openClosedProject(entry)}>{t.openClosed}</button>
              <button type="button" className="icon-button small" aria-label={t.removeClosed(entry.project.mainFile)} title={t.removeClosed(entry.project.mainFile)} onClick={() => removeClosedProject(entry)}><Trash2 size={14} /></button>
            </li>)}
          </ul>}
        </div>
      </div>}
    </div>
  )
}

export default App
