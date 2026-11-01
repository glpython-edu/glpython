// Browser check of the IDE: headless Chrome against the production build
// (`vite preview` of dist/), with Pyodide from its CDN. Covers what broke or
// is easy to break by hand:
// - the tab switch with a read-only file (glpython-editor #41: opening it
//   copied its text into the other file), with typing, undo and redo;
// - per-tab projects: two links in two tabs, reload, the bare address, a
//   closed tab's project offered again;
// - share links: a library by URL (served here), a library that gives 404,
//   a link cut at 2,083 characters, the note for a long link;
// - ▶ and «Tests» on a project of two files; ⋮ «Info» and its update check.
// The browser's «leave the page» question and the iPad cases stay manual:
// headless Chrome can't confirm them.
//
// Needs Google Chrome (GitHub's ubuntu-latest has it).
//   npm run build && npm run test:browser
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import lz from 'lz-string'
import { chromium } from 'playwright-core'

const port = 4196
const base = `http://localhost:${port}/`
const libraryPort = 4197
const libraryBase = `http://localhost:${libraryPort}/`
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' })

// The libraries a link names by URL: bib.py, with CORS as GitHub Pages sends
// it; anything else is a 404 (with CORS too, so the IDE sees the status).
const library = 'def gross(text):\n    return text.upper()\n'
const libraryServer = http.createServer((request, response) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }
  if (new URL(request.url, libraryBase).pathname === '/bib.py') {
    response.writeHead(200, headers)
    response.end(library)
  } else {
    response.writeHead(404, headers)
    response.end('not found')
  }
}).listen(libraryPort)
const stop = () => { server.kill(); libraryServer.close() }
process.on('exit', stop)

const file = (path, code, extra = {}) => ({ path, label: path, kind: 'python', code, ...extra })
const link = (files, mainFile, version = 1) => {
  const url = new URL(base)
  url.searchParams.set('project', lz.compressToEncodedURIComponent(JSON.stringify({ v: version, name: 'Check', mainFile, files: Object.fromEntries(files.map((entry) => [entry.path, entry])) })))
  return url.toString()
}
const helfer = 'def doppelt(x):\n    return 2 * x\n'
const main = 'from helfer import doppelt\n\n\ndef viermal(x):\n    """\n    >>> viermal(2)\n    8\n    """\n    return doppelt(doppelt(x))\n\n\nprint(viermal(21))\n'
const twoFiles = link([file('helfer.py', helfer), file('main.py', main)], 'main.py')
const withReadOnly = link([file('bib.py', library, { readOnly: true }), file('main.py', 'from bib import gross\nprint(gross("hallo"))\n')], 'main.py')
const byUrl = (url) => link([{ path: 'bib.py', url, readOnly: true }, file('main.py', 'from bib import gross\nprint(gross("hallo"))\n')], 'main.py', 2)
// A file that compresses badly, for a link longer than 2,083 characters.
let seed = 7
const noise = Array.from({ length: 220 }, (_, index) => { seed = (seed * 1103515245 + 12345) % 2147483648; return `w${index} = ${seed}` }).join('\n')
const long = link([file('main.py', `${noise}\nprint(len([w0, w1]))\n`)], 'main.py')

let failed = 0
const check = async (label, body) => {
  try {
    await body()
    console.log(`${label}: ok`)
  } catch (error) {
    failed += 1
    console.error(`${label}: ${error.message}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const newContext = async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-CH', permissions: ['clipboard-read', 'clipboard-write'] })
  // The «leave the page» question (unsaved changes) and the copy-by-hand
  // prompt: accepted.
  context.on('page', (page) => page.on('dialog', (dialog) => { dialog.accept().catch(() => {}) }))
  return context
}
const open = async (context, url) => {
  const page = await context.newPage()
  await page.goto(url)
  await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 60000 })
  await page.waitForTimeout(800)
  return page
}
const pythonReady = (page) => page.locator('.runtime-badge').waitFor({ state: 'detached', timeout: 120000 })
const editorText = (page) => page.evaluate(() => window.monaco.editor.getEditors()[0].getValue())
const tabs = (page) => page.locator('.editor-tab').allInnerTexts()
const openTab = async (page, name) => { await page.locator('.editor-tab', { hasText: name }).click(); await page.waitForTimeout(250) }
const typeAtStart = async (page, text) => {
  await page.locator('.monaco-editor .view-lines').click({ position: { x: 200, y: 10 } })
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
  await page.waitForTimeout(300)
}
// The tab's project as saved (tabProjects.ts).
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem(`glpython-tab-project:${sessionStorage.getItem('glpython-tab')}`)).project)
const notices = (page) => page.locator('.ide-notice').allInnerTexts()
const consoleText = (page) => page.locator('.console').innerText()

try {
  for (let attempt = 0; ; attempt++) {
    try { await fetch(base); break } catch { if (attempt > 100) throw new Error('vite preview did not start') }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  await check('fresh tab: one empty main.py; the former starter isn\'t offered', async () => {
    const context = await newContext()
    // A tab from before: glpython-editor's untouched starter project.
    await context.addInitScript(() => {
      if (localStorage.getItem('glpython-tab-project:alt')) return
      const code = '# main.py is the project entry point\nfrom gturtle import *\nfrom greetings import welcome\n\nprint(welcome("Python learner"))\n\nmakeTurtle()\nfor _ in range(4):\n    forward(100)\n    right(90)'
      const project = { id: 'first-steps', name: 'First steps', mainFile: 'main.py', files: {
        'main.py': { path: 'main.py', label: 'Main program', kind: 'python', code },
        'greetings.py': { path: 'greetings.py', label: 'Greetings helper', kind: 'python', code: 'def welcome(name):\n    return f"Hello, {name}!"' },
        'notes.md': { path: 'notes.md', label: 'Lesson notes', kind: 'text', code: '# Variables and output\n\nUse print() to show a value.\nStore reusable values in variables.' },
      } }
      localStorage.setItem('glpython-tab-project:alt', JSON.stringify({ id: 'alt', project, savedFingerprint: '', changedAt: Date.now() }))
    })
    const page = await open(context, base)
    assert.deepEqual(await tabs(page), ['main.py'])
    assert.equal(await editorText(page), '')
    await page.waitForTimeout(500)
    assert.deepEqual(await notices(page), [], 'no offer of the former starter')
    await context.close()
  })

  await check('#41: tab switches, typing, undo, redo keep each file its own', async () => {
    const context = await newContext()
    const page = await open(context, withReadOnly)
    for (const name of ['bib.py', 'main.py', 'bib.py', 'main.py', 'bib.py', 'main.py']) await openTab(page, name)
    await typeAtStart(page, '# eigene Zeile\n')
    await page.keyboard.press('ControlOrMeta+z')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await page.waitForTimeout(300)
    await openTab(page, 'bib.py')
    await typeAtStart(page, 'kaputt')
    for (const name of ['main.py', 'bib.py', 'main.py']) await openTab(page, name)
    const project = await stored(page)
    assert.equal(project.files['bib.py'].code, library, 'the read-only file is unchanged')
    assert.equal(project.files['bib.py'].readOnly, true)
    assert.ok(project.files['main.py'].code.startsWith('# eigene Zeile\nfrom bib import gross'), `main.py: ${JSON.stringify(project.files['main.py'].code.slice(0, 40))}`)
    assert.ok(await page.locator('.editor-tab', { hasText: 'bib.py' }).locator('.tab-read-only').count() === 1, 'lock on the read-only tab')
    await context.close()
  })

  await check('per tab: two links, reload, bare address, closed tab offered again', async () => {
    const context = await newContext()
    const first = await open(context, twoFiles)
    assert.equal(first.url(), base, 'the address shows only the start page')
    await typeAtStart(first, '# erster Tab\n')
    const second = await open(context, twoFiles)
    assert.ok(!(await editorText(second)).includes('# erster Tab'), 'the second tab has the link\'s code')
    assert.ok((await editorText(first)).includes('# erster Tab'), 'the first tab keeps its work')
    await first.reload()
    await first.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 60000 })
    await first.waitForTimeout(500)
    assert.ok((await editorText(first)).includes('# erster Tab'), 'reload keeps the code')
    await first.close()
    const third = await open(context, base)
    await third.waitForTimeout(800)
    assert.match((await notices(third)).join(' | '), /Zuletzt bearbeitet: main\.py/)
    await third.locator('.ide-notice').getByRole('button', { name: 'Öffnen' }).click()
    await third.waitForTimeout(400)
    assert.ok((await editorText(third)).includes('# erster Tab'), 'reopened in place')
    await context.close()
  })

  await check('links: a library by URL is read-only and runs', async () => {
    const context = await newContext()
    const page = await open(context, byUrl(`${libraryBase}bib.py`))
    await page.waitForFunction(() => [...document.querySelectorAll('.editor-tab')].some((tab) => tab.textContent.includes('bib.py')), null, { timeout: 15000 })
    assert.equal(await page.locator('.editor-tab', { hasText: 'bib.py' }).locator('.tab-read-only').count(), 1)
    await page.getByRole('button', { name: 'Dateien' }).first().click()
    assert.match(await page.locator('.ide-libraries').innerText(), /bib\.py\s+von localhost:4197/)
    await page.keyboard.press('Escape')
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('HALLO'), null, { timeout: 60000 })
    await context.close()
  })

  await check('links: a library that gives 404', async () => {
    const context = await newContext()
    const page = await open(context, byUrl(`${libraryBase}fehlt.py`))
    await page.waitForFunction(() => document.querySelector('.ide-notice')?.textContent.includes('HTTP 404'), null, { timeout: 15000 })
    assert.match((await notices(page)).join(' | '), /Die Bibliothek bib\.py konnte nicht geladen werden \(HTTP 404\)\./)
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('ModuleNotFoundError'), null, { timeout: 60000 })
    assert.match(await consoleText(page), /ModuleNotFoundError: No module named 'bib'/)
    await context.close()
  })

  await check('links: a link cut at 2,083 characters', async () => {
    assert.ok(long.length > 2083, `the long link has ${long.length} characters`)
    const context = await newContext()
    // Another project in this browser first: it must not show instead.
    const other = await open(context, twoFiles)
    await typeAtStart(other, '# anderes Projekt\n')
    const page = await open(context, long.slice(0, 2083))
    assert.match((await notices(page)).join(' | '), /Dieser Link ist unvollständig oder beschädigt\./)
    assert.deepEqual(await tabs(page), ['main.py'])
    assert.equal(await editorText(page), '')
    await context.close()
  })

  await check('links: «Teilen» on a long link shows the note', async () => {
    const context = await newContext()
    const page = await open(context, long)
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.waitForTimeout(500)
    assert.match((await notices(page)).join(' | '), /Dieser Link ist sehr lang \(\d+ Zeichen\)\. Manche Programme, z\. B\. OneNote, kürzen solche Links\./)
    assert.equal(await page.locator('.ide-notice').getByRole('button', { name: 'Herunterladen' }).count(), 1)
    await context.close()
  })

  await check('▶ and «Tests» on two files', async () => {
    const context = await newContext()
    const page = await open(context, twoFiles)
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('84'), null, { timeout: 60000 })
    await page.getByRole('button', { name: 'Tests', exact: true }).click()
    await page.locator('.test-summary').waitFor({ timeout: 60000 })
    assert.equal(await page.locator('.test-summary').innerText(), '1 von 1 Beispielen bestanden')
    await context.close()
  })

  await check('⋮ «Info»: the version from version.json, and the update check', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../dist/version.json', import.meta.url), 'utf8'))
    const context = await newContext()
    const page = await open(context, base)
    await page.locator('.ide-menu-button').click()
    await page.getByRole('menuitem', { name: 'Info' }).click()
    const dialog = page.getByRole('dialog')
    assert.match(await dialog.innerText(), new RegExp(`Version\\s+${version.slice(0, 7)}`))
    await dialog.getByRole('button', { name: 'Nach Updates suchen' }).click()
    await page.waitForFunction(() => document.querySelector('.ide-info-check [role=status]')?.textContent === 'Diese Version ist aktuell.', null, { timeout: 10000 })
    // A newer deploy: the same check offers the reload.
    await page.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 'neuer', built: new Date().toISOString() }) }))
    await dialog.getByRole('button', { name: 'Nach Updates suchen' }).click()
    await dialog.getByText('Neue Version verfügbar.').waitFor({ timeout: 10000 })
    assert.equal(await dialog.getByRole('button', { name: 'Neu laden' }).count(), 1)
    await context.close()
  })
} finally {
  await browser.close()
  stop()
}
if (failed > 0) process.exit(1)
console.log('IDE browser checks passed.')
