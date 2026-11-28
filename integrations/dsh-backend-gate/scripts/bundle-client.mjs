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

const checkOnly = process.argv.includes('--check')

const box = { registration: null }
const fakeWindow = { __ModuleLoader__: { load: value => { box.registration = value } } }
const fakeReact = {
  createElement: () => null,
  useState: value => [value, () => {}],
  useEffect: () => {},
  useRef: value => ({ current: value }),
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
const registeredSlots = new Set()
const expectedSlots = { 'maya-model-switch-card': 'conversation.input.dock', 'maya-model-unload': 'conversation.input.model.options' }
face.apply({
  inject(names, callback) {
    if (JSON.stringify(names) !== JSON.stringify(['slots', 'sessions'])) throw new Error('unexpected client injection')
    callback({
      slots: {
        inject(name, register) {
          if (!Object.values(expectedSlots).includes(name)) throw new Error(`unexpected slot ${name}`)
          register()
        },
        register(options, component) {
          if (options.name !== expectedSlots[options.id] || typeof component !== 'function') throw new Error('invalid composer/menu registration')
          if (registeredSlots.has(options.id)) throw new Error('duplicate composer slot')
          registeredSlots.add(options.id)
          component({ sessionId: 'smoke-session', useSession: selector => selector({ running: false, sessionId: 'smoke-session' }) })
        },
      },
      sessions: { binding: () => ({ session: { cancel: async () => ({ ok: true, value: { accepted: true } }) } }) },
    })
  },
})
if (registeredSlots.size !== 2) throw new Error('client plugin did not register the composer card and model-menu control')
if (!checkOnly) {
  mkdirSync('lib', { recursive: true })
  writeFileSync('lib/client.js', bundle)
}
console.log(`${checkOnly ? 'checked' : 'built'} and smoke-checked composer card and model-menu slot (${bundle.length} bytes)`)
