import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

const packageId = '@maya/dsh-interrupt-send'
const result = await build({
  entryPoints: ['client-entry.js'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  write: false,
})
const body = result.outputFiles[0].text
const bundle = `window.__ModuleLoader__.load({\n`
  + `  id: ${JSON.stringify(packageId)},\n`
  + `  factory: (require) => {\n`
  + `    var module = { exports: {} };\n`
  + `    var exports = module.exports;\n`
  + body
  + `\n    return module.exports;\n  },\n});\n`

writeFileSync('client.js', bundle)
console.log(`Bundled ${packageId} (${bundle.length} bytes).`)
