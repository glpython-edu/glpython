// Browser check of the IDE: headless Chrome against the production build
// (`vite preview` of dist/), with Pyodide from its CDN. Covers what broke or
// is easy to break by hand:
// - the tab switch with a read-only file (glpython-editor #41: opening it
//   copied its text into the other file), with typing, undo and redo;
// - per-tab projects: two links in two tabs, reload, the bare address, a
//   closed tab's project offered again;
// - share links: a library by URL (served here), a library that gives 404,
//   a link cut at 2,083 characters, the note for a long link;
// - ▶ and «Tests» on a project of two files; ⋮ «Info» and its update check;
// - input() in the console's input line: ▶, a recursive REPL called in the
//   REPL, Stop → EOFError;
// - a task's instructions as a tab (P45): a link's `openFile` and a
//   read-only aufgabe.md shown as a page («Ansicht / Text»), ▶, «Tests»
//   and «Visualisieren» on the file that runs, «Teilen» and a reload keep
//   it; an old link as before; the page's HTML sanitized;
// - compact links (P46): «Teilen» writes `?p=` (raw deflate, base64url),
//   which opens the same project; zlib's test vector, old `?project=` and
//   `#project=` links open; a cut `?p=` link shows the notice;
// - settings through the link (P34 C, `features`): without `repl` no input
//   line, but input() asks; ⋮ «Optionen» switches it back, a reload and
//   «Teilen» keep the tab's settings; `listtree` and `tree`; ▶ without Tests
//   and Tests without ▶; a link without settings as before.
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
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const port = 4196
const base = `http://localhost:${port}/`
const libraryPort = 4197
const libraryBase = `http://localhost:${libraryPort}/`
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' })

// The libraries a link names by URL: bib.py, with CORS as GitHub Pages sends
// it; anything else is a 404 (with CORS too, so the IDE sees the status).
const library = 'def gross(text):\n    return text.upper()\n'
// Also a task's instructions (aufgabe.md), and the same 3 seconds late.
let aufgabe
const libraryServer = http.createServer((request, response) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' }
  const pathname = new URL(request.url, libraryBase).pathname
  if (pathname === '/bib.py') {
    response.writeHead(200, headers)
    response.end(library)
  } else if (pathname === '/aufgabe.md' || pathname === '/langsam/aufgabe.md') {
    setTimeout(() => {
      response.writeHead(200, headers)
      response.end(aufgabe)
    }, pathname === '/aufgabe.md' ? 0 : 3000)
  } else {
    response.writeHead(404, headers)
    response.end('not found')
  }
}).listen(libraryPort)
const stop = () => { server.kill(); libraryServer.close() }
process.on('exit', stop)

const file = (path, code, extra = {}) => ({ path, label: path, kind: 'python', code, ...extra })
const link = (files, mainFile, version = 1, extra = {}) => {
  const url = new URL(base)
  url.searchParams.set('project', lz.compressToEncodedURIComponent(JSON.stringify({ v: version, name: 'Check', mainFile, ...extra, files: Object.fromEntries(files.map((entry) => [entry.path, entry])) })))
  return url.toString()
}
// A shared link's payload, in either encoding; the compact one (`?p=`, raw
// deflate in base64url) read with Node's zlib, as a course's script would.
const payloadOf = (shareUrl) => {
  const url = new URL(shareUrl)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const compact = url.searchParams.get('p') ?? fragment.get('p')
  if (compact !== null) return JSON.parse(inflateRawSync(Buffer.from(compact, 'base64url')).toString('utf8'))
  return JSON.parse(lz.decompressFromEncodedURIComponent(url.searchParams.get('project') ?? fragment.get('project')))
}
// A link in the compact form, written with Node's zlib (not the IDE's fflate).
const compactLink = (payload) => `${base}?p=${deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 }).toString('base64url')}`
// The fixed test vector in the README: this payload, deflated with zlib at
// level 9, in base64url without padding.
const vectorPayload = { v: 1, name: 'Test', mainFile: 'main.py', files: { 'main.py': { path: 'main.py', label: 'main', kind: 'python', code: 'print("Grüezi")\n' } } }
const vector = 'VcxBCoMwFATQu8yqQhDc_gO0F3CZTVq_-DF-gwbBhtysOy9WAiK4m3kMk7CBGgN1E4PQ8hphMDnRp_giJdZhh0EvnldQuogSgovDbeTdm_0pMBhFOxDCHoe59M_cldOwiMaHxWs5fvwVi8oqcs5_'
const helfer = 'def doppelt(x):\n    return 2 * x\n'
const main = 'from helfer import doppelt\n\n\ndef viermal(x):\n    """\n    >>> viermal(2)\n    8\n    """\n    return doppelt(doppelt(x))\n\n\nprint(viermal(21))\n'
const twoFiles = link([file('helfer.py', helfer), file('main.py', main)], 'main.py')
const greeting = link([file('main.py', 'name = input("Name: ")\nprint("Hallo", name)\n')], 'main.py')
const language = link([file('main.py', 'def berechnen(text):\n    return eval(text)\n\ndef repl():\n    text = input("> ")\n    if text == "ende":\n        return\n    print(berechnen(text))\n    repl()\n')], 'main.py')
// A task: the file to work in, a library by URL and the instructions, open
// at the start.
const auswerter = 'from bib import gross\n\n\ndef auswerten(text):\n    """\n    >>> auswerten("ok")\n    \'OK\'\n    """\n    return gross(text)\n\n\nprint(auswerten("hallo"))\n'
aufgabe = '# Aufgabe 1\n\nErgänzen Sie `auswerten` in **auswerter.py**.\n\n- Tab *aufgabe.md*: diese Anleitung\n- Tab *auswerter.py*: Ihr Code\n\n```python\nauswerten("ok")\n```\n\n| Datei | Zweck |\n|---|---|\n| bib.py | Bibliothek |\n\n[Python-Doku](https://docs.python.org/3/)\n'
const task = (instructions = aufgabe) => link([file('auswerter.py', auswerter), { path: 'bib.py', url: `${libraryBase}bib.py`, readOnly: true }, { path: 'aufgabe.md', label: 'aufgabe', kind: 'text', code: instructions, readOnly: true }], 'auswerter.py', 2, { openFile: 'aufgabe.md' })
// The same with aufgabe.md by URL, first in the link, as a course writes it.
const taskByUrl = (url) => link([{ path: 'aufgabe.md', url, readOnly: true }, { path: 'bib.py', url: `${libraryBase}bib.py`, readOnly: true }, file('auswerter.py', auswerter)], 'auswerter.py', 2, { openFile: 'aufgabe.md' })
const hostile = '# Test\n\n<script>window.hacked = 1</script>\n\n<img src="x" onerror="window.hacked = 2">\n\n[Klick](javascript:window.hacked=3)\n\n<a href="#" onclick="window.hacked = 4">a</a>\n'
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

  // input(): the console's >>> line becomes the program's input line, with
  // the prompt in front; prompt and answer stay in the transcript.
  const programLine = (page) => page.locator('.repl-line--program .repl-input')
  const answer = async (page, text, prompt) => {
    await programLine(page).waitFor({ timeout: 60000 })
    assert.equal(await page.locator('.repl-line--program .repl-prompt').textContent(), prompt)
    assert.ok(await programLine(page).evaluate((element) => element === document.activeElement), 'the input line has the focus')
    await programLine(page).fill(text)
    await programLine(page).press('Enter')
  }
  // A REPL input, once the REPL is free again (until then it keeps the text).
  const enterRepl = async (page, text) => {
    const line = page.locator('.repl-line .repl-input')
    await page.getByRole('textbox', { name: 'Python-Eingabe' }).fill(text)
    for (let attempt = 0; attempt < 100 && await line.inputValue() === text; attempt++) {
      await line.press('Enter')
      await page.waitForTimeout(100)
    }
  }
  const replBack = (page) => page.locator('.repl-line:not(.repl-line--program)').waitFor({ timeout: 60000 })

  await check('input(): ▶ asks in the console, no dialog', async () => {
    const context = await newContext()
    const page = await open(context, greeting)
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await answer(page, 'Zoë', 'Name: ')
    assert.equal(await page.locator('.input-dialog').count(), 0)
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('Hallo Zoë'), null, { timeout: 60000 })
    assert.match(await consoleText(page), /Name: Zoë\nHallo Zoë/)
    await context.close()
  })

  await check('input(): a recursive REPL called in the REPL, then Stop → EOFError', async () => {
    const context = await newContext()
    const page = await open(context, language)
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.locator('.console').getByText('(Keine Ausgabe)').waitFor({ timeout: 60000 })
    await enterRepl(page, 'repl()')
    await answer(page, '1 + 2', '> ')
    await answer(page, '2 * (3 + 4)', '> ')
    await answer(page, 'ende', '> ')
    await replBack(page)
    assert.match(await consoleText(page), />>> repl\(\)\n(Visualisieren\n)?> 1 \+ 2\n3\n> 2 \* \(3 \+ 4\)\n14\n> ende/)
    // Stop while it waits: EOFError, and the session stays (no restart).
    await enterRepl(page, 'repl()')
    await answer(page, '6 * 7', '> ')
    await programLine(page).waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: 'Stop' }).click()
    await page.locator('.console').getByText('EOFError: EOF when reading a line').waitFor({ timeout: 60000 })
    const text = await consoleText(page)
    assert.match(text, /> 6 \* 7\n42\n> \n[\s\S]*EOFError: EOF when reading a line/)
    assert.doesNotMatch(text, /neu gestartet/)
    await enterRepl(page, 'berechnen("2 ** 10")')
    await page.locator('.console').getByText('1024').waitFor({ timeout: 60000 })
    await context.close()
  })

  const markdownSwitch = (page) => page.locator('.markdown-switch button[aria-pressed="true"]').innerText()
  await check('a task: opens on aufgabe.md as a page; ▶, Tests, Visualisieren run auswerter.py', async () => {
    const context = await newContext()
    const page = await open(context, task())
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    assert.equal(await page.locator('.markdown-page h1').innerText(), 'Aufgabe 1')
    assert.equal(await page.locator('.markdown-page table td').first().innerText(), 'bib.py')
    assert.equal((await page.locator('.markdown-page pre code').innerText()).trim(), 'auswerten("ok")')
    assert.deepEqual(await page.locator('.markdown-page a').evaluateAll((links) => links.map((a) => [a.target, a.rel])), [['_blank', 'noopener noreferrer']])
    assert.equal(await markdownSwitch(page), 'Ansicht')
    // As text: read-only, typing changes nothing.
    await page.locator('.markdown-switch button', { hasText: 'Text' }).click()
    await page.locator('.markdown-page').waitFor({ state: 'detached' })
    await typeAtStart(page, 'xyz')
    assert.equal(await editorText(page), aufgabe)
    await page.locator('.markdown-switch button', { hasText: 'Ansicht' }).click()
    await page.locator('.markdown-page').waitFor()
    // The drawer: the lock, no rename or delete.
    await page.getByRole('button', { name: 'Dateien' }).click()
    const row = page.locator('.ide-file-list li', { hasText: 'aufgabe.md' })
    assert.equal(await row.locator('.ide-file-read-only').count(), 1)
    assert.equal(await row.getByRole('button', { name: /umbenennen|löschen/ }).count(), 0)
    await page.keyboard.press('Escape')
    // The buttons act on the file that runs, with aufgabe.md open.
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('HALLO'), null, { timeout: 60000 })
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    await page.getByRole('button', { name: 'Tests', exact: true }).click()
    await page.locator('.test-summary').waitFor({ timeout: 60000 })
    assert.equal(await page.locator('.test-summary').innerText(), '1 von 1 Beispielen bestanden')
    await page.getByRole('button', { name: 'Visualisieren' }).click()
    await page.waitForFunction(() => document.querySelector('.visualizer-view')?.textContent.includes('def auswerten(text):'), null, { timeout: 60000 })
    await context.close()
  })

  await check('a task: «Teilen» and a reload keep openFile and readOnly', async () => {
    const context = await newContext()
    const page = await open(context, task())
    await page.locator('.ide-library-name', { hasText: 'bib.py' }).count()
    await page.waitForFunction(() => document.querySelector('.ide-notice') === null || !document.querySelector('.ide-notice').textContent.includes('bib.py'), null, { timeout: 15000 })
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.waitForTimeout(500)
    const shared = payloadOf(await page.evaluate(() => navigator.clipboard.readText()))
    assert.equal(shared.openFile, 'aufgabe.md')
    assert.equal(shared.mainFile, 'auswerter.py')
    assert.deepEqual([shared.files['aufgabe.md'].readOnly, shared.files['aufgabe.md'].code], [true, aufgabe])
    assert.deepEqual(shared.files['bib.py'], { path: 'bib.py', url: `${libraryBase}bib.py`, readOnly: true })
    await page.reload()
    await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 60000 })
    await page.waitForTimeout(500)
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    assert.equal(await page.locator('.markdown-page h1').innerText(), 'Aufgabe 1')
    assert.equal((await stored(page)).files['aufgabe.md'].readOnly, true)
    await context.close()
  })

  await check('a task by URL: aufgabe.md opens as a page once loaded, tabs in the link\'s order', async () => {
    const context = await newContext()
    const page = await open(context, taskByUrl(`${libraryBase}aufgabe.md`))
    await page.locator('.markdown-page h1').waitFor({ timeout: 15000 })
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    assert.equal(await markdownSwitch(page), 'Ansicht')
    assert.deepEqual(await tabs(page), ['aufgabe.md', 'bib.py', 'auswerter.py'])
    // The drawer: Python files by URL as libraries, the instructions to read.
    await page.getByRole('button', { name: 'Dateien' }).click()
    assert.deepEqual(await page.locator('.ide-libraries').evaluateAll((groups) => groups.map((group) => [group.querySelector('.ide-project-label').textContent, [...group.querySelectorAll('.ide-library-name > span')].map((name) => name.textContent)])), [['Bibliotheken', ['bib.py']], ['Zum Lesen', ['aufgabe.md']]])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.waitForTimeout(500)
    const shared = payloadOf(await page.evaluate(() => navigator.clipboard.readText()))
    assert.equal(shared.openFile, 'aufgabe.md')
    assert.deepEqual(Object.keys(shared.files), ['aufgabe.md', 'bib.py', 'auswerter.py'])
    assert.deepEqual(shared.files['aufgabe.md'], { path: 'aufgabe.md', url: `${libraryBase}aufgabe.md`, readOnly: true })
    await page.reload()
    await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 60000 })
    await page.locator('.markdown-page h1').waitFor({ timeout: 15000 })
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    assert.deepEqual(await tabs(page), ['aufgabe.md', 'bib.py', 'auswerter.py'])
    await context.close()
  })

  await check('a task by URL: a slow aufgabe.md doesn\'t take the tab the learner chose', async () => {
    const context = await newContext()
    const page = await open(context, taskByUrl(`${libraryBase}langsam/aufgabe.md`))
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'auswerter.py', 'the file that runs until it has loaded')
    await openTab(page, 'bib.py')
    await page.locator('.editor-tab', { hasText: 'aufgabe.md' }).waitFor({ timeout: 15000 })
    await page.waitForTimeout(500)
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'bib.py')
    await context.close()
  })

  await check('a task by URL: an aufgabe.md that fails leaves the file that runs open', async () => {
    const context = await newContext()
    const page = await open(context, taskByUrl(`${libraryBase}fehlt/aufgabe.md`))
    await page.waitForFunction(() => document.querySelector('.ide-notice')?.textContent.includes('HTTP 404'), null, { timeout: 15000 })
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'auswerter.py')
    assert.deepEqual(await tabs(page), ['bib.py', 'auswerter.py'])
    await context.close()
  })

  await check('compact links: «Teilen» writes ?p=, which opens the same project, order and tab', async () => {
    const context = await newContext()
    const page = await open(context, taskByUrl(`${libraryBase}aufgabe.md`))
    await page.locator('.markdown-page h1').waitFor({ timeout: 15000 })
    await openTab(page, 'auswerter.py')
    await typeAtStart(page, '# meine Lösung\n')
    await openTab(page, 'aufgabe.md')
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.waitForTimeout(500)
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(shareUrl, /^http:\/\/localhost:\d+\/\?p=[A-Za-z0-9_-]+$/, 'the compact form, no padding')
    const before = await stored(page)
    const again = await open(context, shareUrl)
    await again.locator('.markdown-page h1').waitFor({ timeout: 15000 })
    assert.equal(await again.locator('.editor-tab.active').innerText(), 'aufgabe.md')
    assert.deepEqual(await tabs(again), ['aufgabe.md', 'bib.py', 'auswerter.py'])
    const after = await stored(again)
    for (const path of ['auswerter.py', 'aufgabe.md', 'bib.py']) assert.deepEqual([after.files[path].code, after.files[path].readOnly], [before.files[path].code, before.files[path].readOnly], path)
    assert.match(after.files['auswerter.py'].code, /^# meine Lösung\n/)
    assert.equal(after.mainFile, 'auswerter.py')
    await context.close()
  })

  await check('compact links: zlib\'s test vector opens; old ?project= and #project= links too', async () => {
    assert.equal(deflateRawSync(Buffer.from(JSON.stringify(vectorPayload), 'utf8'), { level: 9 }).toString('base64url'), vector, 'the README\'s vector')
    const context = await newContext()
    const page = await open(context, `${base}?p=${vector}`)
    assert.equal(await editorText(page), 'print("Grüezi")\n')
    const fragment = new URL(twoFiles)
    const oldFragment = await open(context, `${base}#project=${fragment.searchParams.get('project')}`)
    assert.deepEqual(await tabs(oldFragment), ['helfer.py', 'main.py'])
    const oldQuery = await open(context, twoFiles)
    assert.deepEqual(await tabs(oldQuery), ['helfer.py', 'main.py'])
    await context.close()
  })

  await check('compact links: a cut ?p= link shows the notice', async () => {
    const context = await newContext()
    const full = compactLink({ v: 1, name: 'Check', mainFile: 'main.py', files: { 'main.py': file('main.py', noise) } })
    const page = await open(context, full.slice(0, Math.floor(full.length * 0.6)))
    assert.match((await notices(page)).join(' | '), /Dieser Link ist unvollständig oder beschädigt\./)
    assert.deepEqual(await tabs(page), ['main.py'])
    assert.equal(await editorText(page), '')
    await context.close()
  })

  // P34 C: what a tab shows. The buttons in the top bar, the REPL line.
  const settingsPayload = (features, files = [file('main.py', 'name = input("Name: ")\nprint("Hallo", name)\n')]) => ({ v: 1, name: 'Check', mainFile: 'main.py', ...(features ? { features } : {}), files: Object.fromEntries(files.map((entry) => [entry.path, entry])) })
  const barButtons = (page) => page.locator('.ide-actions .editor-actions > button').evaluateAll((buttons) => buttons.map((button) => button.textContent.replace(/\s+/g, ' ').trim().replace(/ ?Stop$/, '').replace(/^Ausführen.*/, 'Ausführen')))
  const replLine = (page) => page.locator('.repl-line:not(.repl-line--program)').count()
  const options = async (page) => {
    await page.locator('.ide-menu-button').click()
    await page.getByRole('menuitem', { name: 'Optionen' }).click()
    return page.getByRole('dialog', { name: 'Optionen' })
  }

  await check('settings: without repl no input line, input() still asks; ⋮ Optionen, reload and Teilen', async () => {
    const context = await newContext()
    const page = await open(context, compactLink(settingsPayload(['run', 'tests', 'visualize', 'ide'])))
    assert.deepEqual(await barButtons(page), ['Ausführen', 'Tests', 'Visualisieren'])
    assert.equal(await replLine(page), 0, 'no REPL line')
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await answer(page, 'Ada', 'Name: ')
    await page.waitForFunction(() => document.querySelector('.console')?.textContent.includes('Hallo Ada'), null, { timeout: 30000 })
    assert.equal(await replLine(page), 0, 'still no REPL line')
    // ⋮ Optionen: the REPL line back on.
    const dialog = await options(page)
    assert.deepEqual(await dialog.locator('label').evaluateAll((labels) => labels.map((label) => [label.textContent.trim(), label.querySelector('input').checked])), [['▶ Ausführen', true], ['Tests', true], ['Visualisieren', true], ['Eingabezeile in der Konsole (>>>)', false], ['→-Kette kopieren (im Visualisierer)', false], ['Nach Tests: Zeilen, die kein Beispiel ausführt', false], ['Listen als Baum', false], ['Visualisierer-Modus «Baum»', false]])
    await dialog.getByLabel('Eingabezeile in der Konsole (>>>)').check()
    await page.keyboard.press('Escape')
    assert.equal(await replLine(page), 1, 'the REPL line is back')
    await page.reload()
    await page.waitForFunction(() => window.monaco?.editor.getEditors().length > 0, null, { timeout: 60000 })
    assert.equal(await replLine(page), 1, 'after a reload')
    await page.getByRole('button', { name: 'Teilen' }).click()
    await page.waitForTimeout(500)
    assert.deepEqual(payloadOf(await page.evaluate(() => navigator.clipboard.readText())).features, ['run', 'tests', 'visualize', 'repl'])
    await context.close()
  })

  await check('settings: listtree and tree - «Baum» in the visualizer, trees in the console', async () => {
    const context = await newContext()
    const page = await open(context, compactLink(settingsPayload(['run', 'repl', 'visualize', 'listtree', 'tree'], [file('main.py', 'baum = ["+", 2, ["*", 3, 4]]\nx = 2 + 3 * 4\n')])))
    assert.deepEqual(await barButtons(page), ['Ausführen', 'Visualisieren'])
    await pythonReady(page)
    await page.getByRole('button', { name: 'Ausführen' }).click()
    await page.waitForTimeout(1500)
    await enterRepl(page, 'baum')
    await page.locator('.repl-entry-tree').first().waitFor({ timeout: 30000 })
    await page.locator('.ide-actions').getByRole('button', { name: 'Visualisieren' }).click()
    await page.locator('.visualizer-mode').waitFor({ timeout: 60000 })
    assert.deepEqual(await page.locator('.visualizer-mode button').allInnerTexts(), ['Kasten', 'Ersetzung', 'Baum'])
    await page.locator('.visualizer-mode button', { hasText: 'Baum' }).click()
    await page.getByRole('button', { name: 'Letzter Schritt' }).click()
    await page.locator('.locals-row[data-name="baum"] .value-tree').first().waitFor({ timeout: 10000 })
    await context.close()
  })

  await check('settings: ▶ without Tests, Tests without ▶', async () => {
    const context = await newContext()
    const runOnly = await open(context, compactLink(settingsPayload(['run', 'repl'])))
    assert.deepEqual(await barButtons(runOnly), ['Ausführen'])
    const testsOnly = await open(context, compactLink(settingsPayload(['tests', 'repl'], [file('main.py', 'def f():\n    """\n    >>> f()\n    1\n    """\n    return 1\n')])))
    assert.deepEqual(await barButtons(testsOnly), ['Tests'])
    await pythonReady(testsOnly)
    await testsOnly.getByRole('button', { name: 'Tests', exact: true }).click()
    await testsOnly.locator('.test-summary').waitFor({ timeout: 60000 })
    await context.close()
  })

  await check('settings: a link without features, old and new form, as before', async () => {
    const context = await newContext()
    for (const url of [link([file('main.py', 'print(1)\n')], 'main.py'), compactLink(settingsPayload(null))]) {
      const page = await open(context, url)
      assert.deepEqual(await barButtons(page), ['Ausführen', 'Tests', 'Visualisieren'])
      assert.equal(await replLine(page), 1)
      const dialog = await options(page)
      assert.deepEqual(await dialog.locator('input').evaluateAll((inputs) => inputs.map((input) => input.checked)), [true, true, true, true, true, true, false, false], 'the defaults')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Teilen' }).click()
      await page.waitForTimeout(500)
      assert.equal(payloadOf(await page.evaluate(() => navigator.clipboard.readText())).features, undefined, 'no settings written')
    }
    await context.close()
  })

  await check('settings: ?features= on a link without a project', async () => {
    const context = await newContext()
    const page = await open(context, `${base}?features=run,visualize`)
    assert.deepEqual(await barButtons(page), ['Ausführen', 'Visualisieren'])
    assert.equal(await replLine(page), 0)
    await context.close()
  })

  await check('an old link: opens on the file that runs, Markdown as text', async () => {
    const context = await newContext()
    const page = await open(context, link([file('main.py', 'print(1)\n'), { path: 'notizen.md', label: 'notizen', kind: 'text', code: '# Notizen\n' }], 'main.py', 1, { openFile: 'fehlt.md' }))
    assert.equal(await page.locator('.editor-tab.active').innerText(), 'main.py')
    assert.equal(await page.locator('.markdown-switch').count(), 0)
    await openTab(page, 'notizen.md')
    assert.equal(await markdownSwitch(page), 'Text', 'an editable file opens as its text')
    assert.equal(await page.locator('.markdown-page').count(), 0)
    await context.close()
  })

  await check('a task: the page shows HTML as text, runs no script, no javascript: link', async () => {
    const context = await newContext()
    const page = await open(context, task(hostile))
    const pageText = await page.locator('.markdown-page').innerText()
    assert.match(pageText, /<script>window\.hacked = 1<\/script>/, 'HTML shows as text')
    assert.equal(await page.locator('.markdown-page script, .markdown-page img, .markdown-page [onerror], .markdown-page [onclick]').count(), 0)
    const link = page.locator('.markdown-page a', { hasText: 'Klick' })
    assert.equal(await link.getAttribute('href'), null, 'no javascript: href')
    await link.click()
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.hacked), undefined)
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
