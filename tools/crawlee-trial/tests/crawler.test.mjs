import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { runComparison } from '../crawler.mjs'
import { SOURCES } from '../rules.mjs'

test('Crawlee deduplicates, retries one 503, and stops at 403/429/redirect/oversize', async () => {
  const hits = new Map()
  const html = '<li><a href="https://www.niucoo.cn/game/123.html"><div class="imgInfo"><p>fixture game</p><p class="tip">今天发布</p></div></a></li>'
  const server = createServer((req, res) => {
    hits.set(req.url, (hits.get(req.url) ?? 0) + 1)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (req.url === '/temporary' && hits.get(req.url) === 1) { res.writeHead(503); res.end('temporary'); return }
    if (req.url === '/blocked') { res.writeHead(403); res.end('blocked'); return }
    if (req.url === '/limited') { res.writeHead(429); res.end('limited'); return }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/should-not-follow' }); res.end(); return }
    if (req.url === '/large') { res.writeHead(200, { 'Content-Length': 3 * 1024 * 1024 }); res.end(); return }
    if (req.url === '/chunked-large') { res.write(Buffer.alloc(1024 * 1024, 'a')); res.write(Buffer.alloc(1024 * 1024, 'b')); res.end(Buffer.alloc(1024 * 1024, 'c')); return }
    res.end(html)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const paths = ['/temporary', '/blocked', '/limited', '/redirect', '/large', '/chunked-large']
    const sources = paths.map(name => ({ ...SOURCES[0], domain: name, url: `http://127.0.0.1:${server.address().port}${name}` }))
    const reports = await runComparison(sources, { allowLocalForTests: true, quiet: true })
    assert.equal(reports.length, paths.length)
    assert.equal(hits.get('/temporary'), 2)
    assert.equal(reports[0].attempts, 2)
    for (const name of paths.slice(1)) {
      assert.equal(hits.get(name), 1, name + ' must not retry')
      assert.equal(reports.find(row => row.domain === name).status, 'failed')
    }
    assert.equal(hits.has('/should-not-follow'), false)
  } finally { await new Promise(resolve => server.close(resolve)) }
})
test('production rejects arbitrary sources before making a request', async () => {
  await assert.rejects(() => runComparison([{ ...SOURCES[0], url: 'http://127.0.0.1/' }]), /allowlisted/)
})
