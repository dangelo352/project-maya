/**
 * Build the browser entry into the DSH client-module format used by RC5: a
 * self-registering classic script with React resolved by the host module table.
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Script } from 'node:vm'

const PACKAGE_ID = '@maya/dsh-server-tps'
const result = await build({
  entryPoints: ['client-entry.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  write: false,
  logLevel: 'silent',
})
const body = result.outputFiles[0].text
const bundle = `window.__ModuleLoader__.load({\n`
  + `  id: ${JSON.stringify(PACKAGE_ID)},\n`
  + `  factory: (require) => {\n`
  + `    var module = { exports: {} };\n`
  + `    var exports = module.exports;\n`
  + `    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n`
  + body
  + `\n    return module.exports;\n  },\n`
  + `});\n`

mkdirSync('.', { recursive: true })
writeFileSync('client.js', bundle)

const registrationBox = { registration: null }
const fakeWindow = { __ModuleLoader__: { load: value => { registrationBox.registration = value } } }
const fakeReact = { createElement: () => null, useState: value => [value, () => {}], useEffect: () => {} }
new Script(bundle).runInNewContext({
  window: fakeWindow,
  fetch: async () => ({ ok: true, json: async () => ({ approx_tps: 0, active_streams: 0, timestamp: Date.now() }) }),
  require: specifier => {
    if (specifier === 'react') return fakeReact
    throw new Error(`unexpected external ${specifier}`)
  },
})
const registration = registrationBox.registration
if (registration?.id !== PACKAGE_ID) throw new Error('client module registration id mismatch')
const face = registration.factory(specifier => {
  if (specifier === 'react') return fakeReact
  throw new Error(`unexpected external ${specifier}`)
})
if (face.name !== 'dsh-server-tps' || !Array.isArray(face.inject) || typeof face.apply !== 'function') {
  throw new Error('built client bundle does not expose the DSH plugin face')
}
let registered = false
face.apply({
  inject(names, callback) {
    if (JSON.stringify(names) !== JSON.stringify(['slots'])) {
      throw new Error('client requested an unexpected service')
    }
    callback({ slots: {
      inject(name, register) {
        if (name !== 'conversation.composer.dock') throw new Error('unexpected composer slot')
        register()
      },
      register(_options, component) {
        if (typeof component !== 'function') throw new Error('composer component was not registered')
        registered = true
      },
    } })
  },
})
if (!registered) throw new Error('client plugin did not register its composer slot')
console.log(`built and smoke-checked client.js (${bundle.length} bytes)`)
