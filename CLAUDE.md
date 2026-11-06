# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The glpython IDE: a browser Python IDE for the classroom, deployed to GitHub Pages at the organization's root, https://glpython-edu.github.io/. The repo is `glpython-edu/glpython-edu.github.io` (that name is what makes it the root site); its local clone is `../glpython`. It is only the **shell**: the top bar (with the workspace's buttons portaled in), the files drawer and the ⋮ menu (README «Layout»), Microsoft sign-in (MSAL redirect flow) and project persistence (local storage, folder/ZIP import, ZIP export, share links). Everything inside the workspace is the `<GlPythonWorkspace>` component from **glpython-editor** (`../glpython-editor`): the Monaco editor, the Pyodide worker, the REPL, the visualizer, the turtle panel. Changes to those belong there, not here.

Sibling repos: `../glpython-editor` (the component, runtime and LiaScript embed; read its CLAUDE.md) and `../glpython-liascript` (the LiaScript macro).

## Commands

```bash
npm run dev     # vite with COOP/COEP headers (input() needs SharedArrayBuffer)
npm run build   # tsc -b && vite build (base /)
npm run lint    # oxlint; 7 known warnings, all in the vendored public/coi-serviceworker.js
npm run test:browser  # after a build: scripts/check-ide-browser.mjs, the IDE in headless Chrome
```

The one automated check is `test:browser` (`scripts/check-ide-browser.mjs`): `playwright-core` drives the installed Chrome (GitHub's runner has one) against `vite preview` of `dist/`, with Pyodide from its CDN and its own fixtures (it serves a library by URL itself). It covers tab switches with a read-only file, per-tab projects, share links (library by URL, 404, cut and long links), ▶ and Tests, ⋮ «Info», `input()` in the console (a recursive REPL, Stop → `EOFError`), and a task's instructions as a tab (`openFile`, a read-only `aufgabe.md` as a page, sanitizing); add regression cases there. The browser's «leave the page» question and the iPad stay manual. `.github/workflows/ci.yml` runs `npm ci`, the build (tsc catches type changes in a new editor tag), lint and `test:browser` on every pull request. Pushes to `main` deploy to GitHub Pages (`deploy-pages.yml`). To check a change in the browser, use `npm run dev`; `npm run build && npm run preview` serves the production layout. The embed is a separate project site under the same origin, https://glpython-edu.github.io/glpython-editor/. The IDE's `coi-serviceworker.js` registers for scope `/`, which includes it, so after a change to that worker check the embed too: its demo page opened directly, and a LiaScript course.

## Layout

- `src/App.tsx` — the shell. It renders `GlPythonWorkspace` (stacked layout; its buttons go into the bar through `actionsContainer`, every file is a tab with `closeFileTabs: false`) and uses glpython-editor's project helpers (`addProjectFile`, `renameProjectFile`, …).
- `src/index.css` — the shell's styles (`ide-*` classes), from glpython-editor's `--glp-*` tokens. glpython-editor's `style.css` styles only the workspace (plus `icon-button`, `hidden-input` and `auth-notice`, which the shell uses too).
- `src/i18n.ts` — only the shell's own strings (`ShellStrings`, de/en). The workspace's strings come from glpython-editor's `coreStrings`, so don't copy them here. A new workspace string goes into glpython-editor's `src/i18n.ts`.
- `src/tabProjects.ts`: per-tab projects (P25). The tab's id is in sessionStorage and `history.state` (never in the address); projects are in localStorage, one entry per id. Nothing is deleted when a tab goes away: a page can't tell a close from iPad Safari unloading it (only `history.state` survives that). Open tabs answer over a BroadcastChannel, which finds duplicated tabs and the projects for «Zuletzt geschlossen».
- `src/projectStorage.ts` (folder/ZIP) and `src/projectShare.ts` (share links: written as `?p=`, raw deflate (fflate, synchronous so «Teilen» copies within the tap on an iPad) in base64url without padding; `?project=` (lz-string) read forever; versioned payload: v1 every file's code, v2 also libraries by URL, fetched by `src/libraries.ts`; optional `openFile`, the tab to open with (a library by URL once fetched, unless the learner chose a tab: `tabChosenRef`), kept on the `TabEntry`, in «Teilen» links and in the ZIP; the tabs in the link's order (`fileOrder`), which «Teilen» keeps; a link that can't be read opens an empty project with a notice).
- `src/markdown.ts`: the workspace's `renderMarkdown` (marked + DOMPurify, both pinned; HTML in the Markdown becomes text, links get `target="_blank"` and `rel="noopener noreferrer"`).
- `src/auth.ts` — MSAL. Only active with `VITE_ENTRA_CLIENT_ID` in `.env.local` (README «Microsoft sign-in»).
- `vite.config.ts` — `optimizeDeps.exclude: ['glpython-editor']` keeps the editor's worker next to its `dist/index.js`. Don't remove it.

## glpython-editor dependency

- `package.json` pins `glpython-editor` by tag: `git+https://github.com/glpython-edu/glpython-editor.git#vX.Y.Z`. The editor's `prepare` script builds its `dist/` on install.
- **Bumping it** (after the tag exists in glpython-editor; see that repo's CLAUDE.md «Releases»):
  1. On a branch, run `npm install "glpython-editor@git+https://github.com/glpython-edu/glpython-editor.git#vX.Y.Z"`.
  2. npm rewrites the spec as `github:…`. Restore the `git+https://…` form in `package.json` and `package-lock.json`, so the diff is the tag plus the lock's `resolved` commit.
  3. Run `npm ci && npm run build`, check that `node_modules/glpython-editor/dist` contains the new code, and open a PR titled «Bump glpython-editor to vX.Y.Z».
- **Trying an unreleased editor change:** build it in `../glpython-editor`, temporarily replace `node_modules/glpython-editor/dist` with its `dist/` (back it up first), run `npm run build`, then restore. Alternatively `npm install ../glpython-editor`, but then restore `package.json`/`package-lock.json` before committing.

## Licence

MIT (`LICENSE`). `THIRD_PARTY_NOTICES.md` lists what the build bundles, with license texts; the build strips license comments, so `npm run build` copies `LICENSE` and the notices into `dist/` (the deployed site). When a dependency is added or changed, update it: the bundled packages are the `node_modules` paths in the source maps of `npx vite build --sourcemap`.

## Conventions

- Work on a branch from `main`, one PR per package of work, CI green before handing over. Merging to `main` deploys the IDE.
- UI texts in German and English. German uses Swiss spelling (ss, no ß) and never addresses the learner as «du» or «Sie».
- Behaviour must match CPython. The runtime lives in glpython-editor, so a Python discrepancy is fixed there.
- Report follow-ups instead of fixing them silently.
- Code comments explain why, in full sentences, like the existing ones.
