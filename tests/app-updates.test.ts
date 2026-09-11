import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAppUpdate } from '../lib/app-update-extractor'
import {
  cleanAppUpdateMultiline,
  csvCell,
  normalizeAppVersion,
  normalizePublicHttpUrl,
} from '../lib/app-updates'
import { appStoreResultToUpdate, parseAppStoreIds } from '../lib/app-store'

test('app version normalization removes labels and keeps comparable characters', () => {
  assert.equal(normalizeAppVersion(' Version v2.03.1-beta '), '2.03.1-beta')
  assert.equal(normalizeAppVersion('版本号：V4.0.0'), '4.0.0')
  assert.equal(normalizeAppVersion('not a version'), null)
})

test('public URL normalization accepts only http and https', () => {
  assert.equal(normalizePublicHttpUrl('https://example.com/update', 100), 'https://example.com/update')
  assert.equal(normalizePublicHttpUrl('javascript:alert(1)', 100), null)
  assert.equal(normalizePublicHttpUrl('https://user:secret@example.com/', 100), null)
})

test('CSV output escapes quotes, commas and spreadsheet formulas', () => {
  assert.equal(csvCell('普通文字'), '"普通文字"')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('a"b'), '"a""b"')
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"')
})

test('extractor reads explicit selectors and resolves relative downloads', () => {
  const result = extractAppUpdate(`
    <html><body>
      <span class="version">v3.2.1</span>
      <section class="notes">修复登录问题\n提升启动速度</section>
      <time class="date">2026年9月10日</time>
      <span class="size">36.5 MB</span>
      <a class="download" href="/files/app.apk">下载</a>
    </body></html>
  `, 'https://downloads.example.com/app', {
    versionSelector: '.version', changelogSelector: '.notes', releaseDateSelector: '.date',
    packageSizeSelector: '.size', downloadUrlSelector: '.download',
  })
  assert.equal(result?.normalizedVersion, '3.2.1')
  assert.equal(result?.releaseDate, '2026-09-10')
  assert.equal(result?.packageSize, '36.5 MB')
  assert.equal(result?.downloadUrl, 'https://downloads.example.com/files/app.apk')
  assert.match(cleanAppUpdateMultiline(result?.changelog, 30_000), /修复登录问题\s+提升启动速度/)
})

test('extractor tolerates invalid optional selectors', () => {
  const result = extractAppUpdate(
    '<html><body><p>最新版本：2.5.0</p><h2>更新日志</h2><p>修复问题</p></body></html>',
    'https://example.com/app',
    { versionSelector: '[', changelogSelector: '[' }
  )
  assert.equal(result?.normalizedVersion, '2.5.0')
  assert.equal(result?.changelog, '修复问题')
})

test('App Store batch input accepts links and numeric ids without duplicates', () => {
  assert.deepEqual(parseAppStoreIds(`
    https://apps.apple.com/cn/app/example/id123456789
    987654321
    id123456789
    invalid
  `), ['123456789', '987654321'])
})

test('App Store lookup data becomes a reviewable release', () => {
  const result = appStoreResultToUpdate({
    wrapperType: 'software',
    kind: 'software',
    trackId: 123456789,
    trackName: 'Example App',
    bundleId: 'com.example.app',
    version: '4.2.1',
    releaseNotes: '修复登录问题',
    currentVersionReleaseDate: '2026-09-10T01:02:03Z',
    fileSizeBytes: '52428800',
    trackViewUrl: 'https://apps.apple.com/cn/app/example/id123456789',
  })
  assert.equal(result?.normalizedVersion, '4.2.1')
  assert.equal(result?.releaseDate, '2026-09-10')
  assert.equal(result?.packageSize, '50.0 MB')
  assert.equal(result?.changelog, '修复登录问题')
})
