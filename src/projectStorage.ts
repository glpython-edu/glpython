import JSZip from 'jszip'
import type { Project, ProjectFile, ProjectFileKind } from 'glpython-editor'

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>
}

type ProjectMetadata = { name?: string; mainFile?: string; openFile?: string; readOnly?: string[]; libraries?: Record<string, string> }

// An imported project, with the URLs of its libraries (path → URL) that
// glpython.json lists: their code is in the ZIP, and a share link of it
// names them by URL again.
export type ImportedProject = { project: Project; libraries: Record<string, string>; openFile?: string }

function librariesOf(files: Record<string, ProjectFile>, metadata: ProjectMetadata): Record<string, string> {
  const libraries = metadata.libraries && typeof metadata.libraries === 'object' ? metadata.libraries : {}
  return Object.fromEntries(Object.entries(libraries).filter(([path, url]) => files[path] && typeof url === 'string'))
}

// The tab to open with, if glpython.json names one of the files.
function openFileOf(files: Record<string, ProjectFile>, metadata: ProjectMetadata): { openFile?: string } {
  return typeof metadata.openFile === 'string' && files[metadata.openFile] ? { openFile: metadata.openFile } : {}
}

// The files glpython.json lists as read-only, marked so.
function withReadOnly(files: Record<string, ProjectFile>, metadata: ProjectMetadata): Record<string, ProjectFile> {
  const readOnly = Array.isArray(metadata.readOnly) ? metadata.readOnly : []
  return Object.fromEntries(Object.entries(files).map(([path, file]) => [path, readOnly.includes(path) ? { ...file, readOnly: true } : file]))
}

// `libraries`: the project's libraries by URL (path → URL). The ZIP holds
// their code, so a hand-in is complete; glpython.json keeps their URLs.
export async function exportProjectZip(project: Project, libraries: Record<string, string> = {}, openFile?: string): Promise<Blob> {
  const zip = new JSZip()
  for (const file of Object.values(project.files)) zip.file(file.path, file.code)
  // Which files are read-only (e.g. a course's library) travels in the
  // metadata, so a ZIP round trip keeps it.
  const readOnly = Object.values(project.files).filter((file) => file.readOnly).map((file) => file.path)
  const urls = Object.fromEntries(Object.entries(libraries).filter(([path]) => project.files[path]))
  zip.file('glpython.json', JSON.stringify({ name: project.name, mainFile: project.mainFile, ...(openFile && openFile !== project.mainFile && project.files[openFile] ? { openFile } : {}), ...(readOnly.length > 0 ? { readOnly } : {}), ...(Object.keys(urls).length > 0 ? { libraries: urls } : {}) }, null, 2))
  return zip.generateAsync({ type: 'blob' })
}

export async function importProjectZip(file: File, fallback: Project): Promise<ImportedProject> {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && entry.name !== 'glpython.json' && !entry.name.startsWith('__MACOSX/'))
  const metadataEntry = zip.file('glpython.json')
  const metadata = metadataEntry ? JSON.parse(await metadataEntry.async('text')) as ProjectMetadata : {}
  const files = await Promise.all(entries.map(async (entry) => {
    const path = entry.name.replace(/^\/+/, '')
    const code = await entry.async('text')
    return [path, createProjectFile(path, code)] as const
  }))
  const importedFiles = withReadOnly(Object.fromEntries(files), metadata)
  const pythonFiles = Object.values(importedFiles).filter((entry) => entry.kind === 'python')
  const mainFile = metadata.mainFile && importedFiles[metadata.mainFile]
    ? metadata.mainFile
    : pythonFiles[0]?.path ?? Object.keys(importedFiles)[0]

  return { project: { ...fallback, name: metadata.name || file.name.replace(/\.zip$/i, '') || fallback.name, mainFile, files: importedFiles }, libraries: librariesOf(importedFiles, metadata), ...openFileOf(importedFiles, metadata) }
}

export async function importProjectFolder(fallback: Project): Promise<ImportedProject | null> {
  const pickerWindow = window as DirectoryPickerWindow
  if (!pickerWindow.showDirectoryPicker) return null

  const directory = await pickerWindow.showDirectoryPicker()
  const files: ProjectFile[] = []
  await readDirectory(directory, '', files)
  const metadata = await readProjectMetadata(directory)
  const importedFiles = withReadOnly(Object.fromEntries(files.map((file) => [file.path, file])), metadata)
  const pythonFiles = files.filter((file) => file.kind === 'python')
  const mainFile = metadata.mainFile && importedFiles[metadata.mainFile]
    ? metadata.mainFile
    : importedFiles['main.py']
      ? 'main.py'
      : pythonFiles[0]?.path ?? files[0]?.path
  return { project: { ...fallback, name: metadata.name || directory.name, mainFile, files: importedFiles }, libraries: librariesOf(importedFiles, metadata), ...openFileOf(importedFiles, metadata) }
}

async function readProjectMetadata(directory: FileSystemDirectoryHandle): Promise<ProjectMetadata> {
  try {
    const metadataHandle = await directory.getFileHandle('glpython.json')
    const metadataFile = await metadataHandle.getFile()
    return JSON.parse(await metadataFile.text()) as ProjectMetadata
  } catch {
    return {}
  }
}

async function readDirectory(directory: FileSystemDirectoryHandle, prefix: string, files: ProjectFile[]): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      if (file.name === 'glpython.json' || file.name.startsWith('.')) continue
      files.push(createProjectFile(path, await file.text()))
    } else {
      await readDirectory(handle, path, files)
    }
  }
}

function createProjectFile(path: string, code: string): ProjectFile {
  const extension = path.split('.').pop()?.toLowerCase()
  const kind: ProjectFileKind = extension === 'py' ? 'python' : 'text'
  return { path, label: path.split('/').pop()?.replace(/\.[^/.]+$/, '') || path, code, kind }
}
