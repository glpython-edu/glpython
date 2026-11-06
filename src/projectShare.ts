import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
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
//
// Two encodings of the same JSON payload (P46):
// - `?p=` (written since P46): the payload's UTF-8 bytes compressed with raw
//   deflate (RFC 1951, no zlib or gzip header; fflate's deflateSync, level 9),
//   in base64url (RFC 4648 §5: A-Z a-z 0-9 - _) without "=" padding. About a
//   third shorter than lz-string for a program. Any raw deflate stream reads,
//   e.g. Node's zlib.deflateRawSync.
// - `?project=` (before P46): lz-string's compressToEncodedURIComponent.
//   Read forever: every link handed in must keep working.
// fflate works synchronously, so «Teilen» builds the link and copies it in
// the tap's own handler, as iPad Safari requires for the clipboard.
const COMPACT_PARAM = 'p'
const SHARE_PARAM = 'project'
// A link's payload inflates to at most this many bytes (a short link can't
// expand into a page-freezing amount).
const MAX_PAYLOAD_BYTES = 8_000_000
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
  | { status: 'ok'; project: Project; libraries: Record<string, string>; openFile?: string; order: string[] }

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
// `openFile`: the tab to open with (only if it is one of the project's);
// `order`: the order of the tabs (files not in it follow).
function payloadOf(project: Project, libraries: Record<string, string>, openFile: string | undefined, order: string[]): SharedProjectPayload {
  const files: Record<string, ProjectFile | LibraryReference> = {}
  const paths = [...new Set([...order, ...Object.keys(project.files), ...Object.keys(libraries)])]
  for (const path of paths) {
    if (libraries[path]) files[path] = { path, url: libraries[path], readOnly: true }
    else if (project.files[path]) files[path] = project.files[path]
  }
  return { v: Object.keys(libraries).length > 0 ? 2 : 1, name: project.name, mainFile: project.mainFile, ...(openFile && openFile !== project.mainFile && files[openFile] ? { openFile } : {}), files }
}

// The old encoding (`?project=`), for the checks and as a reference.
export function encodeProjectForUrl(project: Project, libraries: Record<string, string> = {}, openFile?: string, order: string[] = []): string {
  return compressToEncodedURIComponent(JSON.stringify(payloadOf(project, libraries, openFile, order)))
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

// The compact encoding (`?p=`), see above.
export function encodeProjectCompact(project: Project, libraries: Record<string, string> = {}, openFile?: string, order: string[] = []): string {
  return toBase64Url(deflateSync(strToU8(JSON.stringify(payloadOf(project, libraries, openFile, order))), { level: 9 }))
}

function inflatePayload(encoded: string): string | null {
  const bytes = fromBase64Url(encoded)
  if (!bytes || bytes.length === 0) return null
  const inflated = inflateSync(bytes)
  if (inflated.length > MAX_PAYLOAD_BYTES) return null
  return strFromU8(inflated)
}

export function decodeProjectFromUrl(encoded: string, compact = false): SharedLink {
  try {
    const json = compact ? inflatePayload(encoded) : decompressFromEncodedURIComponent(encoded)
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
      // The tabs in the link's order (libraries by URL among the files).
      order: Object.keys(payload.files),
    }
  } catch {
    return { status: 'broken' }
  }
}

export function buildShareUrl(project: Project, libraries: Record<string, string> = {}, openFile?: string, order: string[] = []): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  const encoded = encodeProjectCompact(project, libraries, openFile, order)
  url.searchParams.set(COMPACT_PARAM, encoded)
  if (url.pathname.length + url.search.length <= MAX_PATH_AND_QUERY) return url.toString()
  url.search = ''
  url.hash = new URLSearchParams({ [COMPACT_PARAM]: encoded }).toString()
  return url.toString()
}

// Reads a shared project out of the current page URL (if present, in the
// query or, for a long one, the fragment). The tab then holds it as its own
// project and leaves the bare start page in the address (claimTabId), so
// reloading or re-sharing doesn't keep re-importing the same snapshot.
// Both encodings, in the query and in the fragment.
export function readSharedLinkFromLocation(): SharedLink {
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const compact = url.searchParams.get(COMPACT_PARAM) ?? fragment.get(COMPACT_PARAM)
  if (compact !== null) return decodeProjectFromUrl(compact, true)
  const encoded = url.searchParams.get(SHARE_PARAM) ?? fragment.get(SHARE_PARAM)
  return encoded ? decodeProjectFromUrl(encoded) : { status: 'none' }
}
