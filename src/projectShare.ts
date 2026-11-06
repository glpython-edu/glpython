import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { Project, ProjectFile } from 'glpython-editor'

// URL query parameter used to carry a whole project (name, main file, and
// every file's path/label/kind/code, and readOnly for a file to read only,
// e.g. a course's library), the same idea as webTigerPython's
// `?code=` parameter but extended to a full multi-file project instead of a
// single source string.
//
// Version 2 (P25) adds libraries by URL: `{path, url, readOnly: true}`
// without the code, which the IDE fetches when the link opens - so a link
// with a course's parser stays short. A link without libraries stays
// version 1, which every IDE reads.
//
// `openFile` (P45, optional, any version): the tab open when the project
// opens, e.g. a task's instructions (`aufgabe.md`, read-only, shown as a
// page); ▶ still runs `mainFile`. One that isn't in the project is ignored;
// an IDE from before reads the link as it did. A file with its code can be
// `readOnly: true` too.
const SHARE_PARAM = 'project'
// GitHub Pages answers "414 URI Too Long" when a request's path and query
// exceed 8192 characters - a program of roughly 5,000 to 30,000 characters,
// depending on how well it compresses. A longer link carries the project in
// the fragment instead ("#project=..."), which the browser never sends to
// the server. The glpython LiaScript macro builds its «In IDE öffnen» links
// the same way.
const MAX_PATH_AND_QUERY = 8192

type LibraryReference = { path: string; url: string; readOnly?: boolean; label?: string; kind?: string }

type SharedProjectPayload = {
  v: number
  name: string
  mainFile: string
  openFile?: string
  files: Record<string, ProjectFile | LibraryReference>
}

// What the address brings: no link, one that can't be read (cut off, e.g.
// by OneNote at 2,083 characters, or damaged), or a project with the URLs
// of its libraries.
export type SharedLink =
  | { status: 'none' }
  | { status: 'broken' }
  | { status: 'ok'; project: Project; libraries: Record<string, string>; openFile?: string }

function isProjectFile(value: unknown): value is ProjectFile {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<ProjectFile>
  return typeof file.path === 'string' && typeof file.label === 'string' && typeof file.code === 'string' && (file.kind === 'python' || file.kind === 'text')
    && (file.readOnly === undefined || typeof file.readOnly === 'boolean')
}

function isLibraryReference(value: unknown): value is LibraryReference {
  if (!value || typeof value !== 'object') return false
  const library = value as Partial<LibraryReference> & { code?: unknown }
  return typeof library.path === 'string' && typeof library.url === 'string' && library.code === undefined
}

function isSharedProjectPayload(value: unknown): value is SharedProjectPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SharedProjectPayload>
  if (typeof payload.name !== 'string' || typeof payload.mainFile !== 'string' || !payload.files || typeof payload.files !== 'object') return false
  return Object.values(payload.files).every((file) => isProjectFile(file) || isLibraryReference(file))
}

// `libraries`: the project's libraries by URL (path → URL); they go into the
// link as URLs, not as their code.
// `openFile`: the tab to open with (only if it is one of the project's).
export function encodeProjectForUrl(project: Project, libraries: Record<string, string> = {}, openFile?: string): string {
  const files: Record<string, ProjectFile | LibraryReference> = {}
  for (const [path, file] of Object.entries(project.files)) if (!libraries[path]) files[path] = file
  for (const [path, url] of Object.entries(libraries)) files[path] = { path, url, readOnly: true }
  const payload: SharedProjectPayload = { v: Object.keys(libraries).length > 0 ? 2 : 1, name: project.name, mainFile: project.mainFile, ...(openFile && openFile !== project.mainFile && files[openFile] ? { openFile } : {}), files }
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function decodeProjectFromUrl(encoded: string): SharedLink {
  try {
    const json = decompressFromEncodedURIComponent(encoded)
    if (!json) return { status: 'broken' }
    const payload = JSON.parse(json) as unknown
    if (!isSharedProjectPayload(payload) || !isProjectFile(payload.files[payload.mainFile])) return { status: 'broken' }
    const files: Record<string, ProjectFile> = {}
    const libraries: Record<string, string> = {}
    for (const [path, file] of Object.entries(payload.files)) {
      if (isProjectFile(file)) files[path] = file
      else libraries[path] = file.url
    }
    const openFile = typeof payload.openFile === 'string' && payload.files[payload.openFile] ? payload.openFile : undefined
    return {
      status: 'ok',
      project: { id: `shared-${Date.now()}`, name: payload.name.trim() || 'Shared project', mainFile: payload.mainFile, files },
      libraries,
      ...(openFile ? { openFile } : {}),
    }
  } catch {
    return { status: 'broken' }
  }
}

export function buildShareUrl(project: Project, libraries: Record<string, string> = {}, openFile?: string): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  const encoded = encodeProjectForUrl(project, libraries, openFile)
  url.searchParams.set(SHARE_PARAM, encoded)
  if (url.pathname.length + url.search.length <= MAX_PATH_AND_QUERY) return url.toString()
  url.search = ''
  url.hash = new URLSearchParams({ [SHARE_PARAM]: encoded }).toString()
  return url.toString()
}

// Reads a shared project out of the current page URL (if present, in the
// query or, for a long one, the fragment). The tab then holds it as its own
// project and leaves the bare start page in the address (claimTabId), so
// reloading or re-sharing doesn't keep re-importing the same snapshot.
export function readSharedLinkFromLocation(): SharedLink {
  const url = new URL(window.location.href)
  const encoded = url.searchParams.get(SHARE_PARAM) ?? new URLSearchParams(url.hash.slice(1)).get(SHARE_PARAM)
  return encoded ? decodeProjectFromUrl(encoded) : { status: 'none' }
}
