import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite')
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table sites(id uuid primary key,domain text);
    create table task_groups(id uuid primary key,site_domains text[]);
    create table task_group_members(group_id uuid,user_id uuid,username text);
    create table member_rec_dismissals(group_id uuid,user_id uuid,keyword text,dismissed_at timestamptz);
    create table raw_keywords(site_id uuid,keyword text,content_date date,discovered_at timestamptz default now());
    create table rank_changes(site_id uuid,keyword text,stat_date date,type text,volume int);
    create table site_keyword_ranks(site_id uuid,keyword text,stat_date date,type text,volume int,platform text,rank_position int);
    create table keyword_signal_rollup(site_id uuid,keyword text,type text,recent_dates date[],last_seen date,
      latest_rank_position int,latest_prev_rank int,max_volume int,latest_url text,latest_title text,primary key(site_id,keyword,type));
    create table keyword_volume(keyword text primary key,volume bigint,baseline_volume bigint,baseline_date date,
      stat_date date,last_volume_increase_date date,net_volume_change bigint generated always as(volume-baseline_volume) stored);
    create table member_claimed_keywords(id uuid primary key default gen_random_uuid(),group_id uuid,user_id uuid,claimed_date date,
      keyword text,final_keyword text,page_url text,source text,operation_type text,status text,submitted_at timestamptz,created_at timestamptz default now());
    create unique index member_claimed_keywords_unique_active on member_claimed_keywords(group_id,user_id,keyword,claimed_date) where status<>'dismissed';
  `)
  const normalization = await readFile(new URL('../supabase/migrations/20260924_prevent_repeated_new_submission.sql', import.meta.url), 'utf8')
  await db.exec(normalization.slice(0, normalization.indexOf('create index')) + '\ncommit;')
  const recommendation = await readFile(new URL('../supabase/migrations/20261013_paged_recommendations.sql', import.meta.url), 'utf8')
  await db.exec(recommendation.slice(0,recommendation.indexOf('create or replace function public.get_task_group_recommendations_page'))+'\ncommit;')
  for (const name of ['20261019_daily_radar_cache.sql','20261019_url_task_claim_identity.sql','20261019_recommendation_page_history.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  }
  const today = (await db.query("select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as d")).rows[0].d
  const date = (await db.query('select ($1::date-2)::text as d', [today])).rows[0].d
  const site = '11111111-1111-4111-8111-111111111111', site2 = '22222222-2222-4222-8222-222222222222'
  const group = '33333333-3333-4333-8333-333333333333', user = '44444444-4444-4444-8444-444444444444'
  await db.query('insert into sites values($1,\'a.com\'),($2,\'b.com\')', [site,site2])
  for (const id of [site,site2]) {
    await db.query(`insert into raw_keywords(site_id,keyword,content_date) values
      ($1,'软件甲',$2::date-10),($1,'软件甲官方版',$2),($1,'软件甲免费版',$2),($1,'未来预约',$2::date+20)`, [id,date])
  }
  await db.query(`insert into rank_changes values($1,'软件甲官方版',$2,'rankup',100),($1,'真正连续',$2,'rankup',30),($1,'不连续',$2,'rankup',20)`,[site,date])
  await db.query(`insert into keyword_signal_rollup(site_id,keyword,type,recent_dates) values
    ($1,'真正连续','rankup',array[$2::date-2,$2::date-1,$2::date,$2::date+1]),
    ($1,'不连续','rankup',array[$2::date-4,$2::date-2,$2::date])`,[site,date])
  await db.query(`insert into keyword_volume(keyword,volume,baseline_volume,stat_date,last_volume_increase_date)
    values('只有历史日期',50,10,$1,$2),('完全未知',30,10,$1,null),('新观测',10,10,$1,null)`,[today,date])
  await db.exec("update keyword_volume set volume=25 where keyword='新观测'")
  const observations = (await db.query("select * from keyword_volume_observations where keyword='新观测' order by id")).rows
  assert.equal(observations.length,2)
  assert.equal(Number(observations[1].previous_volume),10)
  assert.equal(Number(observations[1].volume),25)
  const build = async day => db.query('select refresh_daily_radar_cache($1,\'global\') as result',[day])
  const page = async (tab, pg=0, size=20, selectedGroup=null, selectedDate=date) =>
    (await db.query('select get_daily_radar_page($1,\'global\',$2,$3,$4,$5) as page',[selectedDate,tab,selectedGroup,pg,size])).rows[0].page
  await build(date)
  await build(today)
  const newPage = await page('newWords')
  assert.equal(newPage.total,2)
  assert.ok(newPage.data.every(row=>row.last_date===date && !row.keyword.includes('未来')))
  assert.equal((await page('newWords',0,1)).data.length,1)
  assert.notEqual((await page('newWords',0,1)).data[0].keyword,(await page('newWords',1,1)).data[0].keyword)
  assert.equal((await page('cross')).data[0].keyword,'软件甲官方版')
  const streak = await page('streak')
  assert.equal(streak.total,1)
  assert.equal(streak.data[0].keyword,'真正连续')
  assert.equal(streak.data[0].streak,3) // tomorrow's date is excluded
  assert.equal((await page('wordLib')).data[0].keyword,'软件甲')
  const legacyVolume = (await page('volumeRising')).data[0]
  assert.equal(legacyVolume.historicalValuesKnown,false)
  assert.equal(legacyVolume.change,null)
  assert.equal((await page('volumeRising',0,20,null,today)).data[0].change,15)
  // Completed old pending task: submitted today, claimed before the signal.
  await db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,source,operation_type,status,submitted_at)
    values($1,$2,$3::date-3,'软件甲官方版','共新增词','新增','submitted',now())`,[group,user,date])
  assert.equal((await page('newWords',0,20,group)).total,1)
  assert.equal((await page('wordLib',0,20,group)).total,1)
  const insertUpdate = async url => db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,page_url,source,operation_type,status)
    values($1,$2,$3,'7723游戏盒',$4,'手动添加','更新','pending')`,[group,user,today,url])
  await insertUpdate('https://www.f71.com/app/1.html')
  await insertUpdate('f71.com/app/2.html') // same keyword, another page is allowed
  await assert.rejects(insertUpdate('https://m.f71.com/app/1.html#section'),/already claimed/)
  const saved = (await db.query('select * from member_claimed_keywords order by created_at')).rows
  await db.query('update member_claimed_keywords set final_keyword=\'允许编辑\' where id=$1',[saved.at(-1).id])
  // Decline ownership/cooldown must follow page A even if page B has the same term.
  await db.query('insert into task_groups values($1,array[\'a.com\'])',[group])
  await db.query('insert into task_group_members values($1,$2,\'组员\')',[group,user])
  await db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,page_url,source,operation_type,status,submitted_at)
    values($1,$2,$3::date-40,'同名词','https://a.com/page-A','手动添加','新增','submitted',now()-interval '40 days'),
    ($1,$2,$3::date-1,'同名词','https://a.com/page-B','手动添加','更新','submitted',now()-interval '1 day')`,[group,user,today])
  await db.query(`insert into keyword_signal_rollup(site_id,keyword,type,last_seen,max_volume,latest_url)
    values($1,'同名词','rankdown',$2,100,'https://a.com/page-A')`,[site,today])
  const recommendations = (await db.query("select get_task_group_recommendations_page($1,array[$2::uuid],'rankdown') as result",[group,user])).rows[0].result
  assert.equal(recommendations.total,1) // page B's recent update must not hide page A
  assert.equal(recommendations.rows[0].url,'https://a.com/page-A')
  await db.query("update keyword_signal_rollup set last_seen=$1::date-6 where keyword='同名词'",[today])
  assert.equal((await db.query("select get_task_group_recommendations_page($1,array[$2::uuid],'rankdown') as result",[group,user])).rows[0].result.total,1)
  await db.query("update keyword_signal_rollup set last_seen=$1::date-7 where keyword='同名词'",[today])
  assert.equal((await db.query("select get_task_group_recommendations_page($1,array[$2::uuid],'rankdown') as result",[group,user])).rows[0].result.total,0)
  const oldest=(await db.query('select ($1::date-6)::text as d',[today])).rows[0].d
  const expired=(await db.query('select ($1::date-7)::text as d',[today])).rows[0].d
  await build(oldest)
  assert.equal((await page('rank',0,20,null,oldest)).cacheReady,true)
  await assert.rejects(build(expired),/Invalid daily radar/)
  await db.query(`insert into radar_daily_cache(data_date,scope_key,payload) values($1::date-7,'global','{}'),($1::date-8,'global','{}')`,[today])
  assert.equal((await page('rank',0,20,null,expired)).cacheReady,false)
  assert.equal((await db.query('select prune_daily_radar_cache() as removed')).rows[0].removed,2)
  assert.equal((await db.query('select count(*)::int as n from keyword_volume_observations')).rows[0].n,4)
  await db.exec("insert into keyword_volume(keyword,volume,stat_date) values('基线缺失',1,current_date); update keyword_volume set volume=4 where keyword='基线缺失'")
  await build(today)
  const noBaseline=(await page('volumeRising',0,20,null,today)).data.find(row=>row.keyword==='基线缺失')
  assert.equal(noBaseline.change,3)
  assert.equal(noBaseline.netChange,null) // unknown baseline is not zero
  assert.equal((await db.query("select has_function_privilege('authenticated','public.refresh_daily_radar_cache(date,text,text[],text[])','execute') as allowed")).rows[0].allowed,false)
  await assert.rejects(build('2099-01-01'),/Invalid daily radar/)
  console.log(JSON.stringify({dailyRadarSql:true,datesIndependent:true,pagination:true,consecutive:true,urlIdentity:true,
    liveCompletionFiltering:true,legacyDatesInvented:false,cacheOnlyCleanup:true,productionWrites:0}))
} finally { await db.close() }
