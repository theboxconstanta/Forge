// Realtime delivers one postgres_changes event PER ROW. A series edit or
// "Delete series" touches dozens of `classes` rows in one transaction, and
// re-running a full-list fetch for every one of those events floods the
// network and lets slower, older responses overwrite newer ones.
//
// coalescedRefresh(run) returns a trigger with no added delay:
//   - idle      -> run() starts immediately (the first event is never held back);
//   - in flight -> the trigger only marks "dirty"; when the current run
//                  finishes, run() executes exactly once more, so the
//                  final fetch always starts after the last event and the
//                  list never stays stale.
// A burst of N events therefore costs at most 2 fetches, and runs never
// overlap (no out-of-order responses).
export function coalescedRefresh(run) {
  let running = false
  let dirty = false
  const loop = async () => {
    running = true
    try {
      do {
        dirty = false
        try { await run() } catch (err) { console.error('[coalescedRefresh]', err) }
      } while (dirty)
    } finally {
      running = false
    }
  }
  return () => {
    if (running) { dirty = true; return }
    loop()
  }
}
