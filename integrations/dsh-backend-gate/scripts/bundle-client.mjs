import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Script } from 'node:vm'

const PACKAGE_ID = '@maya/dsh-backend-gate'
const result = await build({
  entryPoints: ['client-entry.js'], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2022', external: ['react'], write: false, logLevel: 'silent',
})
const body = result.outputFiles[0].text
const bundle = `window.__ModuleLoader__.load({\n`
  + `  id: ${JSON.stringify(PACKAGE_ID)},\n`
  + `  factory: (require) => {\n`
  + `    var module = { exports: {} };\n`
  + `    var exports = module.exports;\n`
  + `    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`
  + body
  + `\n    return module.exports;\n  },\n});\n`

mkdirSync('lib', { recursive: true })
writeFileSync('lib/client.js', bundle)

const box = { registration: null }
const fakeWindow = { __ModuleLoader__: { load: value => { box.registration = value } } }
const fakeReact = {
  createElement: () => null,
  useState: value => [value, () => {}],
  useEffect: () => {},
}
new Script(bundle).runInNewContext({
  window: fakeWindow,
  fetch: async () => ({ ok: true, json: async () => null }),
  require: id => id === 'react' ? fakeReact : (() => { throw new Error(`unexpected external ${id}`) })(),
})
if (box.registration?.id !== PACKAGE_ID) throw new Error('client module registration id mismatch')
const face = box.registration.factory(id => id === 'react' ? fakeReact : (() => { throw new Error(`unexpected external ${id}`) })())
if (face.name !== 'maya-model-switch-card' || typeof face.apply !== 'function') {
  throw new Error('client bundle does not expose the DSH client plugin face')
}
let slotRegistered = false
face.apply({
  inject(names, callback) {
    if (JSON.stringify(names) !== JSON.stringify(['slots', 'remote.session'])) throw new Error('unexpected client injection')
    callback({
      slots: {
        inject(name, register) {
          if (name !== 'conversation.composer.dock') throw new Error(`unexpected slot ${name}`)
          register()
        },
        register(options, component) {
          if (options.id !== 'maya-model-switch-card' || typeof component !== 'function') throw new Error('invalid composer card registration')
          slotRegistered = true
        },
      },
      remote: { session: { cancel: async () => ({ ok: true, value: { accepted: true } }) } },
    })
  },
})
if (!slotRegistered) throw new Error('client plugin did not register its composer card')
console.log(`built and smoke-checked lib/client.js (${bundle.length} bytes)`)
