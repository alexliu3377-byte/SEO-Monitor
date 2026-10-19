// Real PostgreSQL engine, isolated in memory. No production access or secrets.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
  ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.content_feed_items (
      id uuid primary key, source text, source_id text, category text, title text,
      url text, first_seen_at timestamptz default now()
    );
  `)
  for (const name of ['20261014_content_transcripts.sql', '20261015_content_article_text.sql', '20261019_transcript_lease_failure_reason.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  }
  await db.exec(`
    insert into content_feed_items(id,source,title,url) values
    ('11111111-1111-4111-8111-111111111111','bilibili','Expired','https://www.bilibili.com/video/fixture1'),
    ('22222222-2222-4222-8222-222222222222','xiaohongshu','Paused source','https://www.xiaohongshu.com/explore/fixture2'),
    ('33333333-3333-4333-8333-333333333333','bilibili','Saved','https://www.bilibili.com/video/fixture3');
    update content_feed_transcripts set status='processing',attempts=3,
      lease_token=gen_random_uuid(),lease_expires_at=now()-interval '1 minute'
      where item_id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
    update content_feed_transcripts set status='completed',attempts=1,transcript_text='保留文字',original_text='保留文字',
      segments='[{"start":0,"end":1,"text":"保留文字"}]'
      where item_id='33333333-3333-4333-8333-333333333333';
  `)
  assert.equal((await db.query("select claim_content_transcript(array['bilibili']) as job")).rows[0].job, null)
  const rows = (await db.query('select * from content_feed_transcripts order by item_id')).rows
  assert.equal(rows[0].status, 'failed')
  assert.equal(rows[0].attempts, 3) // no unlimited retries or manufactured success
  assert.equal(rows[0].lease_token, null)
  assert.match(rows[0].error_message, /回写失败/)
  assert.ok(!rows[0].error_message.includes('连续三次超时'))
  assert.equal(rows[1].status, 'processing') // unrelated source was not modified
  assert.equal(rows[2].status, 'completed')
  assert.equal(rows[2].transcript_text, '保留文字')
  assert.equal((await db.query("select has_function_privilege('authenticated','public.claim_content_transcript(text[])','execute') as allowed")).rows[0].allowed, false)
  assert.equal((await db.query("select has_function_privilege('service_role','public.claim_content_transcript(text[])','execute') as allowed")).rows[0].allowed, true)
  // Existing queue, lease, article preservation and provenance regressions.
  await db.exec('truncate content_feed_items cascade;')
  for (const name of ['content-transcripts-smoke.sql', 'content-article-smoke.sql']) {
    await db.exec('begin;')
    await db.exec(await readFile(new URL(`../tests/sql/${name}`, import.meta.url), 'utf8'))
  }
  console.log(JSON.stringify({ transcriptLeaseSql: true, scopedExpiry: true, completedTextPreserved: true,
    attemptsReset: false, productionWrites: 0 }))
} finally { await db.close() }
