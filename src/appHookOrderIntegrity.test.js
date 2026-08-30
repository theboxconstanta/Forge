import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// INC-P9.5.2-01 REGRESSION.
//
// The P9.5.2 crash: a `useEffect` was inserted into `App()` whose dependency
// array read `memberGymMovements` / `userProfile` — `const` bindings declared
// ~150-450 lines LOWER in the same function. A dependency array is evaluated
// SYNCHRONOUSLY during render, so this hit the Temporal Dead Zone and threw
// `ReferenceError: Cannot access 'X' before initialization` on EVERY render →
// the global error boundary on every route.
//
// Neither `vite build`, `eslint`, nor 1300 unit tests caught it: the build
// only bundles, eslint's `no-use-before-define` is off for this pattern, and
// NO test mounts `<App/>`, so `App()`'s render body never ran.
//
// This test statically parses `App()` and fails if any hook dependency array
// references a `const`/`let` binding declared LATER in the function body. It is
// deterministic, needs no mocking, and would have caught the exact regression.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'App.jsx'), 'utf8')
const lines = src.split('\n')

const START = lines.findIndex((l) => /^function App\(\) \{/.test(l))
const END = lines.findIndex((l) => /^export default function AppWithBoundary/.test(l))

describe('App() hook-order / temporal-dead-zone integrity (INC-P9.5.2-01)', () => {
  it('locates the App() function body', () => {
    expect(START).toBeGreaterThan(0)
    expect(END).toBeGreaterThan(START)
  })

  it('no hook dependency array references a binding declared later in App()', () => {
    // 1. Map every top-level `const [a, setA] = ...` / `const a = ...` / `let a = ...`
    //    inside App() to the line it is first declared on. Only bindings indented
    //    two spaces (function-body scope), to avoid nested-callback locals.
    const declLine = new Map()
    for (let i = START; i < END; i++) {
      const l = lines[i]
      let m
      // const [a, b, ...] = ...
      if ((m = l.match(/^ {2}(?:const|let) \[([^\]]+)\]\s*=/))) {
        for (const name of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
          if (/^[A-Za-z_$][\w$]*$/.test(name) && !declLine.has(name)) declLine.set(name, i)
        }
      }
      // const a = ...   /   let a = ...
      else if ((m = l.match(/^ {2}(?:const|let) ([A-Za-z_$][\w$]*)\s*=/))) {
        if (!declLine.has(m[1])) declLine.set(m[1], i)
      }
    }

    // 2. Find every hook dependency array: a line containing `}, [ ... ]` that
    //    closes a useEffect / useMemo / useCallback. Capture the deps + line.
    const violations = []
    for (let i = START; i < END; i++) {
      const m = lines[i].match(/^\s*\}, \[([^\]]*)\]\)/)
      if (!m) continue
      const deps = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        // take the leading identifier of each dep expression (`userProfile?.gym_id` -> `userProfile`)
        .map((d) => (d.match(/^([A-Za-z_$][\w$]*)/) || [])[1])
        .filter(Boolean)
      for (const name of deps) {
        const dl = declLine.get(name)
        if (dl !== undefined && dl > i) {
          violations.push(`  dep "${name}" used in the array on line ${i + 1} but declared on line ${dl + 1}`)
        }
      }
    }

    expect(violations, `\nHook dependency array reads a binding before it is declared (temporal dead zone → render crash):\n${violations.join('\n')}\n`).toEqual([])
  })

  it('the P9.5.2 memberGymMovements fetch effect sits after its dependencies', () => {
    const declMember = lines.findIndex((l) => /^ {2}const \[memberGymMovements,/.test(l))
    const declProfile = lines.findIndex((l) => /^ {2}const \[userProfile,/.test(l))
    const effect = lines.findIndex((l) => l.includes('fetchMovementsForGym(userProfile.gym_id)'))
    expect(declMember).toBeGreaterThan(0)
    expect(declProfile).toBeGreaterThan(0)
    expect(effect).toBeGreaterThan(Math.max(declMember, declProfile))
  })
})
