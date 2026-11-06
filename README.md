# glpython

A browser-based educational Python IDE with Microsoft 365 and OneDrive integration.

This repository is the **shell application**: the classroom chrome (top bar,
files drawer, menu, auth, project persistence) that embeds the reusable
editor/visualizer/graphics core from
[glpython-editor](https://github.com/glpython-edu/glpython-editor) via the
`<GlPythonWorkspace>` component. The split exists so the editor, Python
execution, execution visualizer, and `gturtle` graphics panel can be embedded
in other contexts beyond this classroom shell.

- **glpython-editor** owns: the Monaco-based code editor, the Pyodide Web
  Worker and its `input()`/`gturtle` runtime, the step-by-step execution
  visualizer, and the turtle graphics canvas.
- **glpython** (this repo) owns: the overall page layout, the files drawer,
  language switching, Microsoft sign-in, and project persistence (local
  storage, ZIP/folder import-export, URL sharing).

## Layout

The IDE looks like the LiaScript embed, only larger:

- **One bar on top:** the logo, the workspace's own buttons in the embed's
  order and labels (**▶ Ausführen · Tests · Visualisieren**; ■ Stoppen in
  place of ▶ while Python is busy), and on the right **Teilen** and **⋮**
  (Python neu starten, open a folder or a ZIP project, download, language, and
  under development tools: delete the local project, with a confirmation).
  There is no Zurücksetzen in the bar: ▶ already starts with a fresh namespace
  and an empty console, ■ stops a hung program, and «Python neu starten» (a new
  Python and an empty console, as the embed's Reset; the code stays) is in ⋮.
- **Left edge:** **Dateien** (a drawer over the editor: the project name, its
  files, new, rename, delete) and **Python-Referenz**, labelled in their
  tooltips. Every file is also a tab above the editor.
- **Below:** the workspace in its stacked layout (editor on top, console
  below, a draggable divider; graphics beside the editor only while a program
  draws; the visualizer in place of the editor). See glpython-editor's README.
- The runtime's status shows only while it loads or failed; no footer.

## Run locally

```bash
npm install
npm run dev
```

The Pyodide runtime is loaded from jsDelivr when the browser worker starts, so
the first run needs an internet connection.

## Using a local glpython-editor checkout

By default, `glpython-editor` is installed straight from its GitHub repo (see
the `glpython-editor` entry in `package.json`). To develop both repos
together, point npm at a local checkout instead:

```bash
npm install ../glpython-editor
```

Remember to revert `package.json` back to the `github:` reference before
committing, and run `npm install` again to restore the published dependency.

## Language

The interface language can be changed in the ⋮ menu, which marks the active
language. On first load, the language is auto-detected from the browser's
language settings and then remembered per browser via local storage.

## Project persistence

**Each browser tab has its own project** (as in WebTigerPython), saved
automatically in the browser:

- Opening a share link starts a new tab project; it never replaces the work in
  another tab. The address bar then shows only the start page, so there is no
  link to copy from it - links come from **Teilen**.
- A reload keeps the tab's project, and so does iPad Safari rebuilding a
  background tab. The tab's id is kept in its session storage and its history
  entry (`history.state`), never in the address.
- **Closing or reloading** a tab whose project changed since the last
  **Teilen** or **Projekt herunterladen** brings the browser's own question
  (desktop browsers; iPad Safari never asks).
- A closed tab's project is kept for 14 days: ⋮ **Zuletzt geschlossen** lists
  them («Öffnen» in this tab if it holds only an untouched empty project, else in a
  new tab; «Entfernen»). A new tab offers the last one changed within a day
  right away («Zuletzt bearbeitet: auswerter.py (vor 2 Stunden).» · «Öffnen»),
  since after quitting Safari or restarting the iPad a tab comes back empty.
- A new tab starts with **one empty `main.py`**; the editor's placeholder
  («Code hier eingeben») says what to do. Learners arrive by links, and the
  IDE needs one file to run. An untouched empty project counts as saved and
  never appears under «Zuletzt geschlossen».
- ⋮ **Neues leeres Projekt** gives the tab that empty project; opening a
  folder or a ZIP gives it that project. The one before goes to «Zuletzt
  geschlossen».
- The one project the IDE kept before per-tab projects becomes the first
  tab's project, once.
- A tab that stays open notices a newer IDE version (`version.json`, written
  by the build, checked when the tab comes back into view and every 30
  minutes): «Neue Version verfügbar.» · «Neu laden». The code survives the
  reload; Python's session doesn't.
- ⋮ **Info** shows the version - the short commit and the build date, as in
  `version.json` - and **Nach Updates suchen** runs the same check: «Diese
  Version ist aktuell.», or the notice with «Neu laden». When a learner reports
  a problem, it tells whether their browser still runs an old version.

The ⋮ menu and the bar support:

- **Ordner öffnen** in browsers with the File System Access API
- **Projekt öffnen** (a ZIP) in all modern browsers with file upload support
- **Projekt herunterladen** as a ZIP with all project files and `glpython.json`
  metadata
- **Teilen**, which serializes the entire project structure (files, contents,
  and metadata) into a compressed link (`?p=`, or `#p=` beyond GitHub Pages'
  URL limit; see «The link format» below) so a project can be shared or
  reopened without a server, similar to
  [webtigerpython.ethz.ch](https://webtigerpython.ethz.ch/). A link longer
  than 2,083 characters (OneNote cuts links there) is still copied, with a
  note to download the project for a hand-in and a **Herunterladen** button.

**The link format.** A share link carries the project as JSON (the payload
below: `v`, `name`, `mainFile`, optional `openFile`, `files` in tab order),
in one of two encodings:
- **`?p=`** (written since P46): the JSON's UTF-8 bytes compressed with **raw
  deflate** (RFC 1951: no zlib or gzip header or checksum; the IDE uses
  [fflate](https://github.com/101arrowz/fflate) at level 9, Node's
  `zlib.deflateRawSync(bytes, { level: 9 })` is equally right), written in
  **base64url** (RFC 4648 §5, alphabet `A–Z a–z 0–9 - _`) **without `=`
  padding**. Any raw deflate stream reads, whichever encoder wrote it. About
  40 % shorter than `?project=` for a program: a hand-in of 1,980 characters
  becomes 1,185.
- **`?project=`** (before P46): lz-string's `compressToEncodedURIComponent`.
  The IDE reads it forever, so every link handed in keeps working.

A link longer than 8,192 characters in path and query puts the same value in
the fragment instead: `#p=…` (or `#project=…`). A test vector: the payload

```json
{"v":1,"name":"Test","mainFile":"main.py","files":{"main.py":{"path":"main.py","label":"main","kind":"python","code":"print(\"Grüezi\")\n"}}}
```

(exactly these bytes, as `JSON.stringify` writes them) gives, with
`zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url')`,

```text
VcxBCoMwFATQu8yqQhDc_gO0F3CZTVq_-DF-gwbBhtysOy9WAiK4m3kMk7CBGgN1E4PQ8hphMDnRp_giJdZhh0EvnldQuogSgovDbeTdm_0pMBhFOxDCHoe59M_cldOwiMaHxWs5fvwVi8oqcs5_
```

so `https://glpython-edu.github.io/?p=VcxBCoMw…` opens it (`test:browser`
checks this). The IDE's own encoder may write other bytes for the same
payload; both open.

**Libraries by URL.** A share link (version 2) can name a library by its URL
instead of carrying its code, e.g. a course's `parser.py`:
`{"path": "parser.py", "url": "https://…/parser.py", "readOnly": true}`. The
IDE fetches it once when the link opens (https only, or http on localhost; at
most 1 MB; without cookies; the server must send CORS headers, as GitHub
Pages and raw.githubusercontent.com do) and keeps the text with the tab's
project, so a reload or working offline uses that copy. The file drawer lists
it with its host and a lock: a Python file under **Bibliotheken**, any
other file (e.g. a task's instructions) under **Zum Lesen**. If it can't be loaded
(e.g. HTTP 404, no network, no CORS), the drawer and a notice say so
(«Die Bibliothek parser.py konnte nicht geladen werden (HTTP 404).») with
**Erneut versuchen**; importing it then raises Python's own
`ModuleNotFoundError`, as in the LiaScript macro. **Teilen** names it by URL
again; the ZIP holds its code and lists its URL in `glpython.json`
(`"libraries"`). Links of version 1, with every file's code, open as before.

**A link that can't be read** (cut off when copied, or damaged) opens an empty
project with «Dieser Link ist unvollständig oder beschädigt. Möglicherweise
wurde er beim Kopieren gekürzt.» - never another project.

ZIP projects preserve relative paths, the project name, the configured
Python entry point, and which files are read-only (`readOnly` in
`glpython.json`).

A **read-only file** (`readOnly: true` on the file, e.g. in a share link from
a course, as the LiaScript macro builds for its libraries) is shown with a
lock: it can be read, run and imported, but not edited, renamed or deleted -
e.g. a parser that learners use as a black box. This local format is also the shape planned for OneDrive
folder synchronization.

**A task's instructions as a tab.** A share link can name the tab that is
open when the project opens: `"openFile": "aufgabe.md"` next to `mainFile`
(any version; one that isn't among the files is ignored, and an IDE from
before opens the link as it did). ▶, **Tests** and **Visualisieren** always
act on `mainFile`, whichever tab is open. A Markdown file (`.md`) has a switch
**Ansicht / Text** at the end of the tabs: a read-only one opens as a page, an
editable one as its text. The page is rendered with
[marked](https://marked.js.org/) and sanitized with
[DOMPurify](https://github.com/cure53/DOMPurify) (both pinned): HTML written
in the Markdown shows as text, scripts, event attributes and `javascript:`
links are removed, links open in a new tab, code is only shown. The tab's
project, **Teilen**, a reload and the ZIP (`"openFile"` in `glpython.json`)
keep `openFile`. The instructions can come by URL, like a library (a shorter
link for the hand-in): that tab becomes the open one once it has loaded,
unless the learner has chosen another tab in the meantime; if it can't be
loaded, `mainFile` stays open. The tabs follow the order of the files in the
link (libraries by URL among them), and **Teilen** writes them in that order;
a new file comes last. For example:

```json
{
  "v": 2,
  "name": "Aufgabe 1",
  "mainFile": "auswerter.py",
  "openFile": "aufgabe.md",
  "files": {
    "aufgabe.md": { "path": "aufgabe.md", "url": "https://…/aufgabe.md", "readOnly": true },
    "parser.py": { "path": "parser.py", "url": "https://…/parser.py", "readOnly": true },
    "auswerter.py": { "path": "auswerter.py", "label": "auswerter", "kind": "python", "code": "…" }
  }
}
```

in either encoding of «The link format» above.
A Markdown file can also carry its code (`"kind": "text", "code": "…"`,
`"readOnly": true`); then it is open at once.

## Microsoft sign-in

Copy `.env.example` to `.env.local` and set the client ID from a Microsoft
Entra ID single-page application registration:

```bash
cp .env.example .env.local
```

Register `http://localhost:5173` as a SPA redirect URI. Use `common` for
accounts from multiple tenants, or set `VITE_ENTRA_TENANT_ID` to the school
tenant ID. The current sign-in requests the delegated `User.Read` permission;
Graph OneDrive permissions will be added next.

Sign-in/sign-out use MSAL's redirect flow (full-page navigation) rather than
popups, since the strict `Cross-Origin-Opener-Policy` required for the
`input()` dialog's `SharedArrayBuffer` bridge (owned by `glpython-editor`)
breaks popup-based auth.

## Cross-origin isolation

`glpython-editor`'s `input()` dialog relies on `SharedArrayBuffer`, which
browsers only allow on
[cross-origin isolated](https://developer.chrome.com/blog/enabling-shared-array-buffer/)
pages. The dev server and preview server send the required
`Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers
automatically (see `vite.config.ts`). For static hosts that can't set custom
response headers (such as GitHub Pages), `public/coi-serviceworker.js`
(vendored from [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker),
MIT licensed) enables isolation via a Service Worker instead; it only
activates if the page isn't already isolated, so it's safe to keep alongside
the Vite headers.

## Deployment

Every push to `main` publishes the app to GitHub Pages at the organization's
root, <https://glpython-edu.github.io/> (the repo is named
`glpython-edu.github.io`). `npm run build && npm run preview` serves the same
layout locally. The embed for LiaScript courses lives next to it, at
<https://glpython-edu.github.io/glpython-editor/>, deployed from
glpython-editor.

## Next integration step

Add an Entra ID application registration, configure MSAL.js with the tenant
client ID, and connect the save action to Microsoft Graph `drive/items`
endpoints. SharePoint assignment workflows can then be layered on top of the
same file model.

## Lizenz / License

MIT – see [LICENSE](LICENSE). The libraries the build bundles (React, Monaco's
React wrapper, lucide, MSAL, JSZip, lz-string, glpython-editor) and the vendored
coi-serviceworker are listed with their notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
