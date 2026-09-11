import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAppUpdate } from '../lib/app-update-extractor'
import {
  cleanAppUpdateMultiline,
  csvCell,
  normalizeAppVersion,
  normalizePublicHttpUrl,
} from '../lib/app-updates'
import {
  appStoreResultToUpdate,
  isAppStoreChart,
  isAppStoreGame,
  parseAppStoreIds,
  parseAppStoreVersionHistoryHtml,
} from '../lib/app-store'
import { appStoreDailyDiscoveryPlan } from '../lib/app-store-discovery'
import { googlePlayAppToUpdate, googlePlayPackageFromUrl } from '../lib/google-play'
import { parseTapTapAppHtml, tapTapAppIdFromUrl } from '../lib/taptap'

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

test('App Store chart input only accepts supported public charts', () => {
  assert.equal(isAppStoreChart('top-free'), true)
  assert.equal(isAppStoreChart('top-paid'), true)
  assert.equal(isAppStoreChart('top-grossing'), false)
})

test('App Store discovery plan is deterministic and bounded for a day', () => {
  const date = new Date('2026-09-11T05:00:00Z')
  const first = appStoreDailyDiscoveryPlan(date, 50)
  const second = appStoreDailyDiscoveryPlan(date, 50)
  assert.deepEqual(first, second)
  assert.equal(first.terms.length, 12)
  assert.deepEqual(first.charts, ['top-free', 'top-paid'])
  assert.match(first.country, /^[a-z]{2}$/)
})

test('App Store mixed discovery reserves half of the searches for games', () => {
  const plan = appStoreDailyDiscoveryPlan(new Date('2026-09-11T05:00:00Z'), 12, 'mixed')
  assert.equal(plan.mode, 'mixed')
  assert.equal(plan.terms.length, 12)
  assert.equal(plan.terms.filter(term => /游戏|game|RPG/i.test(term)).length, 6)
})

test('App Store game discovery supports a games-only expansion run', () => {
  const plan = appStoreDailyDiscoveryPlan(new Date('2026-09-11T05:00:00Z'), 12, 'games')
  assert.equal(plan.mode, 'games')
  assert.equal(plan.terms.length, 12)
  assert.ok(plan.terms.every(term => /游戏|手游|game|RPG|开放世界/i.test(term)))
})

test('App Store game classification uses the Apple Games genre', () => {
  const base = {
    trackId: 123456789,
    trackName: 'Example',
    bundleId: 'com.example.game',
    version: '1.0.0',
    trackViewUrl: 'https://apps.apple.com/app/id123456789',
  }
  assert.equal(isAppStoreGame({ ...base, primaryGenreId: 6014 }), true)
  assert.equal(isAppStoreGame({ ...base, genreIds: ['6014', '7001'] }), true)
  assert.equal(isAppStoreGame({ ...base, primaryGenreName: 'Games' }), true)
  assert.equal(isAppStoreGame({ ...base, primaryGenreName: 'Productivity' }), false)
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

test('App Store product page history becomes multiple releases', () => {
  const payload = [{ pageData: { shelves: [{ items: [
    { $kind: 'TitledParagraph', style: 'detail', primarySubtitle: '8.0.2', secondarySubtitle: 'Tue Sep 08 2026 04:16:59 GMT+0000 (Coordinated Universal Time)', text: '新增功能' },
    { $kind: 'TitledParagraph', style: 'detail', primarySubtitle: '8.0.1', secondarySubtitle: 'Fri Aug 21 2026 01:14:17 GMT+0000 (Coordinated Universal Time)', text: '修复问题' },
    { $kind: 'TitledParagraph', style: 'overview', primarySubtitle: '版本 8.0.2', text: '重复摘要' },
  ] }] } }]
  const html = `<script type="application/json" id="serialized-server-data">${JSON.stringify(payload)}</script>`
  const releases = parseAppStoreVersionHistoryHtml(html, 'https://apps.apple.com/cn/app/id123456789')
  assert.deepEqual(releases.map(release => release.version), ['8.0.2', '8.0.1'])
  assert.equal(releases[0].releaseDate, '2026-09-08')
  assert.equal(releases[0].changelog, '新增功能')
})

test('Google Play keeps update text but never stores a download URL', () => {
  assert.equal(googlePlayPackageFromUrl('https://play.google.com/store/apps/details?id=com.example.game'), 'com.example.game')
  const release = googlePlayAppToUpdate({
    appId: 'com.example.game', title: 'Example', version: 'VARY',
    updated: Date.parse('2026-09-10T00:00:00Z'), recentChanges: '修复问题<br>提升性能',
  } as never)
  assert.equal(release?.normalizedVersion, '2026.09.10')
  assert.equal(release?.changelog, '修复问题\n提升性能')
  assert.equal(release?.downloadUrl, null)
})

test('TapTap parses public version entries and never stores a download URL', () => {
  assert.equal(tapTapAppIdFromUrl('/app/186013'), '186013')
  const result = parseTapTapAppHtml(`
    <h1>示例游戏</h1>
    <div class="app-update-log-entry">
      <div>版本：1.2.3</div><div>更新于 2026/09/10</div>
      <div class="app-update-log-entry-content">新增地图并修复闪退</div>
    </div>
  `, 'https://www.taptap.cn/app/186013')
  assert.equal(result.title, '示例游戏')
  assert.equal(result.releases[0].normalizedVersion, '1.2.3')
  assert.equal(result.releases[0].downloadUrl, null)
})
