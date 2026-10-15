/** One coarse step up while the ring still clashes, then bisection down to this ratio between the clashing and the clear apex. */
const STEP = 1.1
const TOLERANCE = 1.0005
const MAX_STEPS = 64

/**
 * The smallest apex at or above `apex` that `clashes` accepts, to within TOLERANCE: grows by STEP until clear, then
 * bisects between the last clashing apex and the first clear one. `exhausted` reports a ring that never cleared, whose
 * apex is then the last one tried.
 */
export function growToClear(clashes: (apex: number) => boolean, apex: number): { apex: number; exhausted: boolean } {
  if (!clashes(apex)) return { apex, exhausted: false }
  let [bad, good] = [apex, apex * STEP]
  for (let steps = 1; clashes(good); steps++) {
    if (steps >= MAX_STEPS) return { apex: good, exhausted: true }
    ;[bad, good] = [good, good * STEP]
  }
  while (good / bad > TOLERANCE) {
    const mid = Math.sqrt(bad * good)
    if (clashes(mid)) bad = mid
    else good = mid
  }
  return { apex: good, exhausted: false }
}
