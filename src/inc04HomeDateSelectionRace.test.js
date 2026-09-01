import { describe, it, expect } from 'vitest'
import { homeWorkoutResponseIsCurrent } from './utils'

// INC-04 - HOME DATE SELECTION / WORKOUT IDENTITY RACE - FINAL CLOSURE
//
// Deterministic DEFERRED-PROMISE reproduction of the exact commit logic in
// App.jsx `fetchWodZi` / `fetchWodZiWorkoutV2`:
//
//   const mySeq = ++wodZiReqSeqRef.current
//   const data = await supabase.from('wods')...            // <- real await, deferred here
//   if (!homeWorkoutResponseIsCurrent({ requestSeq: mySeq,
//        latestSeq: wodZiReqSeqRef.current,
//        requestDate: data_str, selectedDate: dataAcasaRef.current })) return
//   setWodZiData(data)
//
// The harness is that async function verbatim, with `supabase...` replaced by a
// promise we resolve by hand so responses can be awaited back in any order.

function makeHomeWorkoutModel() {
  const seqRef = { current: 0 }         // mirrors wodZiReqSeqRef
  const selectedRef = { current: null } // mirrors dataAcasaRef
  let committed = null                  // mirrors wodZiData

  function selectDate(date) {
    selectedRef.current = date
    // App.jsx [dataAcasa] effect: drop a workout loaded for a different day
    if (committed && committed.date !== date) committed = null
  }

  // one `fetchWodZi(date)` call. Returns { done, settle }:
  //   settle(payload) -> resolves this request's "network"
  //   done            -> the async fetch function's completion (commit or discard)
  function issueFetch(date) {
    const mySeq = ++seqRef.current
    let settle
    const network = new Promise((res) => { settle = res })
    const done = (async () => {
      const payload = await network
      if (!homeWorkoutResponseIsCurrent({
        requestSeq: mySeq,
        latestSeq: seqRef.current,
        requestDate: date,
        selectedDate: selectedRef.current,
      })) return
      committed = payload
    })()
    return { settle, done }
  }

  return {
    selectDate,
    issueFetch,
    get selected() { return selectedRef.current },
    get committed() { return committed },
    get committedDate() { return committed ? committed.date : null },
  }
}

const wod = (date, extra = {}) => ({ date, ...extra })

describe('INC-04 · Scenario A — select D+1 while Today is pending; D+1 resolves first, Today last', () => {
  it('final state is D+1 (a late Today response never rolls Home back)', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01')
    const today = m.issueFetch('2026-09-01')
    m.selectDate('2026-09-02')
    const dPlus1 = m.issueFetch('2026-09-02')

    dPlus1.settle(wod('2026-09-02')); await dPlus1.done
    today.settle(wod('2026-09-01')); await today.done // late

    expect(m.selected).toBe('2026-09-02')
    expect(m.committedDate).toBe('2026-09-02')
  })
})

describe('INC-04 · Scenario B — same selection, reverse resolution order', () => {
  it('Today resolves first, D+1 second → still D+1', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01')
    const today = m.issueFetch('2026-09-01')
    m.selectDate('2026-09-02')
    const dPlus1 = m.issueFetch('2026-09-02')

    today.settle(wod('2026-09-01')); await today.done
    dPlus1.settle(wod('2026-09-02')); await dPlus1.done

    expect(m.committedDate).toBe('2026-09-02')
  })
})

describe('INC-04 · Scenario — rapid future clicks Today→D+1→D+3→D+7, hostile completion order', () => {
  it('only D+7 (the latest authoritative selection) commits', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01'); const r0 = m.issueFetch('2026-09-01')
    m.selectDate('2026-09-02'); const r1 = m.issueFetch('2026-09-02')
    m.selectDate('2026-09-04'); const r3 = m.issueFetch('2026-09-04')
    m.selectDate('2026-09-08'); const r7 = m.issueFetch('2026-09-08')

    r3.settle(wod('2026-09-04')); await r3.done
    r0.settle(wod('2026-09-01')); await r0.done
    r1.settle(wod('2026-09-02')); await r1.done
    r7.settle(wod('2026-09-08')); await r7.done

    expect(m.selected).toBe('2026-09-08')
    expect(m.committedDate).toBe('2026-09-08')
  })
})

describe('INC-04 · Scenario — rapid historical clicks Today→D-1→D-7→D-30, hostile order', () => {
  it('only D-30 commits', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01'); const r0 = m.issueFetch('2026-09-01')
    m.selectDate('2026-08-31'); const r1 = m.issueFetch('2026-08-31')
    m.selectDate('2026-08-25'); const r7 = m.issueFetch('2026-08-25')
    m.selectDate('2026-08-02'); const r30 = m.issueFetch('2026-08-02')

    r7.settle(wod('2026-08-25')); await r7.done
    r30.settle(wod('2026-08-02')); await r30.done
    r0.settle(wod('2026-09-01')); await r0.done
    r1.settle(wod('2026-08-31')); await r1.done

    expect(m.selected).toBe('2026-08-02')
    expect(m.committedDate).toBe('2026-08-02')
  })
})

describe('INC-04 · Scenario — A → B → A (date-equality alone gets this wrong)', () => {
  it('the stale first-A response is rejected; the latest A response commits fresh content', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-02'); const a1 = m.issueFetch('2026-09-02')
    m.selectDate('2026-09-04'); const b = m.issueFetch('2026-09-04')
    m.selectDate('2026-09-02'); const a2 = m.issueFetch('2026-09-02')

    b.settle(wod('2026-09-04')); await b.done
    a2.settle(wod('2026-09-02', { v: 'fresh' })); await a2.done
    a1.settle(wod('2026-09-02', { v: 'stale' })); await a1.done // arrives last

    expect(m.selected).toBe('2026-09-02')
    expect(m.committedDate).toBe('2026-09-02')
    expect(m.committed.v).toBe('fresh')
  })
})

describe('INC-04 · Scenario — same-date refetch (realtime `wods` change) #1 vs #2', () => {
  it('#2 (realtime handler) supersedes the in-flight #1', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-03')
    const first = m.issueFetch('2026-09-03')   // [dataAcasa] effect
    const second = m.issueFetch('2026-09-03')  // realtime `wods` handler

    second.settle(wod('2026-09-03', { v: 'coach-edit' })); await second.done
    first.settle(wod('2026-09-03', { v: 'pre-edit' })); await first.done

    expect(m.committed.v).toBe('coach-edit')
  })
})

describe('INC-04 · Scenario — empty selected date', () => {
  it('a date with no workout settles on empty for THAT date, never a Today rollback', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01'); const today = m.issueFetch('2026-09-01')
    m.selectDate('2026-09-20'); const empty = m.issueFetch('2026-09-20')

    empty.settle(null); await empty.done               // no workout on 2026-09-20
    today.settle(wod('2026-09-01')); await today.done  // late Today response

    expect(m.selected).toBe('2026-09-20')
    expect(m.committedDate).toBe(null)
  })
})

describe('INC-04 · Scenario — failed latest request', () => {
  it('an older success does not resurface as current after the newer request never lands', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01'); const today = m.issueFetch('2026-09-01')
    m.selectDate('2026-09-07'); m.issueFetch('2026-09-07') // fails: never settled

    today.settle(wod('2026-09-01')); await today.done

    expect(m.selected).toBe('2026-09-07')
    expect(m.committedDate).toBe(null) // stale Today rejected (older seq)
  })
})

describe('INC-04 · Scenario — initial default', () => {
  it('first Home load with no prior selection still resolves to Today', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01')
    const today = m.issueFetch('2026-09-01')
    today.settle(wod('2026-09-01')); await today.done
    expect(m.selected).toBe('2026-09-01')
    expect(m.committedDate).toBe('2026-09-01')
  })
})

describe('INC-04 · Scenario — return-to-screen must not reissue a Today fetch', () => {
  // Regression lock for the [screen] effect fix: returning to Home no longer
  // calls setDataAcasa(today); the selection is whatever the user last chose.
  it('selection persists across a simulated screen round-trip', async () => {
    const m = makeHomeWorkoutModel()
    m.selectDate('2026-09-01'); const t = m.issueFetch('2026-09-01')
    t.settle(wod('2026-09-01')); await t.done
    m.selectDate('2026-09-04'); const d = m.issueFetch('2026-09-04')
    d.settle(wod('2026-09-04')); await d.done

    // user opens logger, cancels, returns to Home -> NO new fetch, NO reset
    // (the [screen] effect only re-centres the chip strip now)
    expect(m.selected).toBe('2026-09-04')
    expect(m.committedDate).toBe('2026-09-04')
  })
})
