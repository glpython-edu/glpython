// The channel this IDE was built for (vite.config.ts): "live" at
// https://glpython-edu.github.io/ from main, "dev" at
// https://glpython-edu.github.io/dev/ from dev, against glpython-editor's
// dev branch. The dev IDE shows a badge, so that nobody shares a dev link
// with learners by mistake.
declare const __GLPYTHON_CHANNEL__: 'live' | 'dev'
export const CHANNEL = __GLPYTHON_CHANNEL__

// Both channels share the origin, so the dev IDE keeps its tab projects
// under keys of its own: a dev build can't rewrite or list the live IDE's
// projects, nor answer its tabs.
export const channelKey = (key: string) => CHANNEL === 'dev' ? `dev:${key}` : key
