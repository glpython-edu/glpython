// Which parts of the IDE a tab shows (P34 C), in the vocabulary of the
// embed's `features=` (the LiaScript macro's): a share link can set them
// (`"features": [...]` in its payload, or `?features=run,repl` without a
// project), ⋮ «Optionen» switches each one, the tab keeps them, and
// «Teilen» writes them. Names the IDE has no use for (`ide`, `reset`) and
// unknown ones are ignored. A tab without settings shows what the IDE always
// did: everything except the trees.
export const FEATURE_NAMES = ['run', 'tests', 'visualize', 'repl', 'export', 'coverage', 'listtree', 'tree'] as const
export type Feature = typeof FEATURE_NAMES[number]

export const DEFAULT_FEATURES: Feature[] = ['run', 'tests', 'visualize', 'repl', 'export', 'coverage']

// The known names of a list (from a link), in the vocabulary's order; null
// for anything that isn't a list of strings.
export function parseFeatures(value: unknown): Feature[] | null {
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string')) return null
  return FEATURE_NAMES.filter((name) => value.includes(name))
}

// A plain `?features=run,repl` (or `#features=`) on the address.
export function readFeaturesParam(): Feature[] | null {
  const url = new URL(window.location.href)
  const list = url.searchParams.get('features') ?? new URLSearchParams(url.hash.slice(1)).get('features')
  return list === null ? null : parseFeatures(list.split(',').map((name) => name.trim()))
}

// The workspace's capabilities for these features.
export function capabilitiesOf(features: readonly Feature[]) {
  const on = (name: Feature) => features.includes(name)
  return {
    run: on('run'),
    tests: on('tests'),
    visualization: on('visualize'),
    repl: on('repl'),
    export: on('export'),
    coverage: on('coverage'),
    listTree: on('listtree'),
    tree: on('tree'),
  }
}
