import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getT } from './translations'

// Static contract for the Class Editing feature: how App.jsx wires it,
// that the existing delete actions are untouched, and that the migration
// stays additive. Behavior of the SQL itself is exercised against a real
// Postgres by supabase/tests/class-edit/run.mjs (PGlite).

const here = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(here, 'App.jsx'), 'utf8')
const sheet = readFileSync(join(here, 'ClassEditSheet.jsx'), 'utf8')
const migration = readFileSync(join(here, '..', 'supabase', 'migrations', '20261008090000_class_edit_series_scope.sql'), 'utf8')

describe('Admin -> Classes card wiring', () => {
  it('card actions in order: Participants | Edit | Delete class | Delete series', () => {
    const i = app.indexOf('<Users size={13} color="#0E0E0E" />')
    const j = app.indexOf('<Pencil size={13}', i)
    const k = app.indexOf('onClick={() => stergeClasa(c.id)}', j)
    const l = app.indexOf('stergeSeria(c) }}', k)
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
    expect(k).toBeGreaterThan(j)
    expect(l).toBeGreaterThan(k)
  })
  it('pencil button is an accessible native button opening the sheet', () => {
    expect(app).toMatch(/<button type="button" className="class-edit-btn" aria-label=\{t\.adminClassEditAria\} title=\{t\.adminClassEditAria\} onClick=\{\(\) => setClasaEditata\(c\)\}/)
  })
  it('success path closes, toasts the server count, then refreshes the list', () => {
    expect(app).toMatch(/onSaved=\{async \(result\) => \{\s*setClasaEditata\(null\)\s*showToast\(t\.toastClassEditSaved\(result\.affected\)\)\s*await refreshClase\(\)/)
  })
  it('recurring creates carry one shared series_id; one-off creates none', () => {
    expect(app).toMatch(/series_id: repetitiva \? newSeriesId\(\) : null \}/)
  })
  it('existing delete handlers unchanged', () => {
    expect(app).toMatch(/const stergeClasa = async \(id\) => \{/)
    expect(app).toMatch(/const stergeSeria = async \(c\) => \{/)
    expect(app).toMatch(/if \(window\.confirm\(t\.adminClassDeleteSeriesConfirm\(c\.name, c\.start_time\?\.slice\(0,5\)\)\)\) stergeSeria\(c\)/)
  })
  it('Delete series: both the refund lookup and the delete are confined to the class own series', () => {
    const start = app.indexOf('const stergeSeria = async (c) => {')
    const body = app.slice(start, app.indexOf('await refreshClase()', start))
    expect(body.split("scopeToOwnSeries(supabase.from('classes').select('id')").length - 1).toBe(1)
    expect(body.split("scopeToOwnSeries(supabase.from('classes').delete()").length - 1).toBe(1)
    expect(body.split(".gte('date', aziS), c)").length - 1).toBe(2)
    expect(body).not.toMatch(/\.gte\('date', aziS\)\s*\n/) // no unscoped query left
  })
  it('member realtime: classes/bookings events refresh the class list through one coalesced trigger', () => {
    expect(app).toContain('const refreshClaseDB = coalescedRefresh(() => fetchClaseDB())')
    const ch = app.slice(app.indexOf("supabase.channel('realtime-app')"), app.indexOf("table: 'class_waitlist'"))
    expect(ch).toMatch(/table: 'classes' \}, \(\) => \{\s*refreshClaseDB\(\)\s*\}/)
    expect(ch).toContain('fetchRezervari(); refreshClaseDB(); fetchAbonamentMeu()')
    expect(ch).not.toContain('fetchClaseDB()')
  })
  it('the sheet never writes to classes directly - only through the RPC', () => {
    expect(sheet).not.toMatch(/from\('classes'\)/)
    expect(sheet).toMatch(/editClassScope\(supabase/)
  })
})

describe('translations', () => {
  it('RO and EN define the same class-edit keys', () => {
    const ro = Object.keys(getT('ro')).filter(k => k.startsWith('adminClassEdit') || k === 'toastClassEditSaved').sort()
    const en = Object.keys(getT('en')).filter(k => k.startsWith('adminClassEdit') || k === 'toastClassEditSaved').sort()
    expect(ro.length).toBeGreaterThan(40)
    expect(ro).toEqual(en)
  })
})

describe('migration 20261008090000 safety', () => {
  const sql = migration.replace(/--.*$/gm, '')
  it('additive only: no DROP TABLE/COLUMN, no DELETE, no TRUNCATE', () => {
    expect(sql).not.toMatch(/drop\s+table/i)
    expect(sql).not.toMatch(/drop\s+column/i)
    expect(sql).not.toMatch(/\bdelete\s+from\b/i)
    expect(sql).not.toMatch(/\btruncate\b/i)
  })
  it('never writes bookings, subscriptions, members or profiles', () => {
    expect(sql).not.toMatch(/(update|insert\s+into)\s+(public\.)?(bookings|subscriptions|members|profiles)\b/i)
  })
  it('columns + index are idempotent', () => {
    expect(sql).toMatch(/add column if not exists series_id uuid/)
    expect(sql).toMatch(/add column if not exists series_exception boolean not null default false/)
    expect(sql).toMatch(/create index if not exists classes_gym_series_date_idx/)
  })
  it('backfill only fills NULL series_id from multi-row insert batches', () => {
    expect(sql).toMatch(/where series_id is null and created_at is not null\s+group by gym_id, created_at\s+having count\(\*\) > 1/)
  })
  it('RPC is SECURITY INVOKER (RLS stays the write boundary) and not callable by anon', () => {
    expect(sql).toMatch(/function public\.edit_class_scope\([\s\S]*?\)\s*returns jsonb\s*language plpgsql\s*security invoker/)
    expect(sql).toMatch(/revoke all on function public\.edit_class_scope\(uuid, text, jsonb, jsonb, boolean\) from anon/)
    expect(sql).toMatch(/grant execute on function public\.edit_class_scope\(uuid, text, jsonb, jsonb, boolean\) to authenticated/)
  })
  it('ended occurrences use the P0-01 Europe/Bucharest boundary', () => {
    expect(sql).toMatch(/now\(\) at time zone 'Europe\/Bucharest'/)
  })
})
