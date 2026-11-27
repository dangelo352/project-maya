import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Script } from 'node:vm'

const packageId = '@maya/dsh-maya-settings'
const result = await build({
  entryPoints: ['client-entry.js'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022',
  external: ['react'], write: false, logLevel: 'silent',
})
const body = result.outputFiles[0].text
const bundle = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(packageId)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n${body}\n    return module.exports;\n  },\n});\n`
mkdirSync('lib', { recursive: true })
writeFileSync('lib/client.js', bundle)

const registration = { value: null }
const fakeReact = { createElement: () => null, Fragment: Symbol('Fragment'), useState: (initial) => [initial, () => {}], useEffect: () => {} }
new Script(bundle).runInNewContext({
  window: { __ModuleLoader__: { load: (item) => { registration.value = item } } },
  require: (id) => { if (id === 'react') return fakeReact; throw new Error(`unexpected external ${id}`) },
})
if (registration.value?.id !== packageId) throw new Error('client module registration mismatch')
const face = registration.value.factory((id) => { if (id === 'react') return fakeReact; throw new Error(`unexpected external ${id}`) })
if (face.name !== 'maya-live-settings' || typeof face.apply !== 'function') throw new Error('invalid client plugin face')
console.log(`Built and smoke-checked lib/client.js (${bundle.length} bytes)`)
