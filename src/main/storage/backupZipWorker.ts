/**
 * Worker-thread entry for backup zip building. Spawned from backup.ts
 * via electron-vite's `?nodeWorker` import, which bundles this file as
 * its own chunk next to the main bundle. See backupZip.ts for why the
 * zip is built off the main thread.
 *
 * Replies with exactly one message: `{ ok: true }` or
 * `{ ok: false, message }`. A worker that dies without replying (e.g.
 * it couldn't load) is treated by the caller as "worker unavailable"
 * and the zip is built in-process instead.
 */

import { parentPort, workerData } from 'worker_threads'
import { buildZip, type ZipPlan } from './backupZip'

const plan = workerData as ZipPlan | undefined
// Guard: this module is also loaded (as a plain import) under vitest,
// which may itself run in a worker with its own workerData.
if (parentPort && plan?.kind === 'backup-zip') {
  const port = parentPort
  buildZip(plan).then(
    () => port.postMessage({ ok: true }),
    (err: unknown) =>
      port.postMessage({ ok: false, message: err instanceof Error ? err.message : String(err) })
  )
}
