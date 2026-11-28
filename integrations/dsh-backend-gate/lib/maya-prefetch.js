import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./maya-prefetch.py', import.meta.url))
const timeoutMs = 120_000

// An OS file-cache warmer. Windows may reclaim these pages under memory
// pressure, so the next model load always retains its normal disk fallback.
export function createMayaPrefetch({ python, cwd, config, enabled }) {
  let worker
  let state
  function stop() {
    const running = worker
    worker = undefined
    state = undefined
    if (running && running.exitCode === null && running.signalCode === null) running.kill()
  }
  return {
    get state() { return state },
    stop,
    start() {
      stop()
      if (!enabled || process.platform !== 'win32') return
      let child
      try {
        child = spawn(python, [script, config], { cwd, stdio: 'ignore', windowsHide: true })
      } catch {
        return
      }
      worker = child
      state = 'warming'
      const timer = setTimeout(() => { if (worker === child) stop() }, timeoutMs)
      timer.unref()
      const finish = code => {
        clearTimeout(timer)
        if (worker !== child) return
        worker = undefined
        state = code === 0 ? 'prefetched' : undefined
      }
      child.once('error', () => finish())
      child.once('exit', finish)
    },
  }
}
