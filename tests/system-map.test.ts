import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { legacyContentRedirect } from '../lib/system-routes'

test('system map has a canonical content route without redirect loops', () => {
  assert.equal(legacyContentRedirect('/system-map'), '/content/system-map')
  assert.equal(legacyContentRedirect('/content/system-map'), null)
})

test('system map server page rejects unauthenticated and non-super users', async () => {
  const source = readFileSync(new URL('../app/(dashboard)/system-map/page.tsx', import.meta.url), 'utf8')
  for (const role of [null, 'normal', 'admin', 'unknown', 'super']) {
    let rendered = false
    const exported: { default?: () => Promise<unknown> } = {}
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, {
      exports: exported,
      require(name: string) {
        if (name === 'next/navigation') return { redirect: (path: string) => { throw new Error(`redirect:${path}`) } }
        if (name === '@/lib/get-user-profile') return { getUserProfile: async () => role ? { role } : null }
        if (name === './system-map-client') return { default: 'client' }
        if (name === 'react/jsx-runtime') return { jsx: () => { rendered = true; return 'page' } }
        throw new Error(`Unexpected dependency ${name}`)
      },
    })
    if (role === 'super') {
      assert.equal(await exported.default!(), 'page')
      assert.equal(rendered, true)
    } else {
      await assert.rejects(exported.default!(), { message: role ? 'redirect:/' : 'redirect:/login' })
      assert.equal(rendered, false)
    }
  }
})
