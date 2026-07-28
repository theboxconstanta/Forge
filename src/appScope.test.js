import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import globals from 'globals'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Regression test for the P0 production crash (2026-07-28): a JSX block
// referencing Admin()-local state (postTransferPanel and friends) was
// placed inside App()'s own render tree instead, throwing
// "ReferenceError: postTransferPanel is not defined" on every render for
// every existing Member. App.jsx carries a file-wide `/* eslint-disable */`
// (line 2), so the project's own no-undef rule never actually ran against
// it - allowInlineConfig: false here deliberately bypasses that disable
// for this one check, without touching the file itself.
describe('App.jsx has no out-of-scope identifier references (no-undef)', () => {
  it('every identifier used in App.jsx resolves within its own lexical scope', () => {
    const filePath = path.resolve(__dirname, 'App.jsx')
    const src = fs.readFileSync(filePath, 'utf8')
    const linter = new Linter()
    const messages = linter.verify(src, [{
      files: ['**/*.jsx'],
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        globals: globals.browser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: { 'no-undef': 'error' },
    }], { filename: 'App.jsx', allowInlineConfig: false })

    const undefErrors = messages.filter(m => m.ruleId === 'no-undef')
    const summary = undefErrors.map(m => `line ${m.line}: ${m.message}`).join('\n')
    expect(undefErrors, `Found undefined-reference errors (likely a variable used outside its declaring component):\n${summary}`).toHaveLength(0)
  })
})
