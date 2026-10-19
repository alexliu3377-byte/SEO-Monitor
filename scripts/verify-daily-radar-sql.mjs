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
  // Include the real historical trigger, not just a simplified fresh schema.
  const hardening = await readFile(new URL('../supabase/migrations/20260903_audit_hardening.sql', import.meta.url), 'utf8')
  const legacyStart = hardening.indexOf('create or replace function public.prevent_duplicate_active_group_claim()')
  const legacyGuard = hardening.slice(legacyStart,hardening.indexOf('create index',legacyStart))
  await db.exec(legacyGuard)
  const retireLegacyGuard = await readFile(new URL('../supabase/migrations/20261019_retire_keyword_only_claim_guard.sql', import.meta.url), 'utf8')
  const recommendation = await readFile(new URL('../supabase/migrations/20261013_paged_recommendations.sql', import.meta.url), 'utf8')
  await db.exec(recommendation.slice(0,recommendation.indexOf('create or replace function public.get_task_group_recommendations_page'))+'\ncommit;')
  for (const name of ['20261019_daily_radar_cache.sql','20261019_url_task_claim_identity.sql','20261019_recommendation_page_history.sql','20261019_radar_page_query.sql','20261019_radar_group_completion_filter.sql','20261019_radar_all_dates_page.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
  }
  assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgrelid='member_claimed_keywords'::regclass and tgname='prevent_duplicate_active_group_claim'")).rows[0].n,0)
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
  await db.query(`insert into rank_changes values($1,'分页筛选甲',$2,'rankup',300),($1,'分页筛选乙',$2,'rankup',200),
    ($1,'分页筛选丙',$2,'rankup',100),($1,'分页筛选他日',$2::date-1,'rankup',400)`,[site,date])
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
  const secondFilteredPage=(await db.query(`select get_daily_radar_page(p_date=>$1,p_scope=>'global',p_tab=>'rank',
    p_keyword=>'分页筛选',p_page=>1,p_size=>1,p_sort=>'volume') as result`,[date])).rows[0].result
  assert.equal(secondFilteredPage.total,3) // date/search are applied BEFORE paging
  assert.deepEqual(secondFilteredPage.data.map(row=>row.keyword),['分页筛选乙'])
  const siteStreak=async siteFilter=>(await db.query(`select get_daily_radar_page(p_date=>$1,p_scope=>'global',p_tab=>'streak',p_site=>$2) as result`,[date,siteFilter])).rows[0].result
  assert.equal((await siteStreak('a.com')).total,1)
  assert.equal((await siteStreak('b.com')).total,0)
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
  // Reproduce the real grouped query path at production-sized candidate counts.
  // Global-only probes cannot catch correlated completion scans in the workspace.
  await db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,final_keyword,status,submitted_at)
    values($1,$2,$3::date-3,'candidate-1','candidate-2','submitted',now()),
      ($1,$2,$3::date-4,'another-original','candidate-2','submitted',now()),
      ($1,$2,$3::date-3,'candidate-3',null,'submitted',$3::timestamp at time zone 'Asia/Kuala_Lumpur'-interval '1 second'),
      ($1,$2,$3,'candidate-4',null,'submitted',null),
      ($1,$2,$3::date-1,'candidate-5',null,'submitted',null),
      ('55555555-5555-4555-8555-555555555555',$2,$3,'candidate-6',null,'submitted',now()),
      ($1,$2,$3,'candidate-7',null,'pending',null),
      ($1,$2,$3,'candidate-8',null,'dismissed',now())`,[group,user,date])
  await db.query(`with fixture as (
    select jsonb_agg(jsonb_build_object('keyword','candidate-'||n,'volume',30001-n,
      'streak',3,'domain','a.com','sites',array['a.com','b.com'],'siteCount',2,'last_date',$1::text)) as rows
    from generate_series(1,30000) n
  ) insert into radar_daily_cache(data_date,scope_key,payload)
    select $1::date,'group-regression',jsonb_build_object('rankWords',rows,'streakWords',rows,'cross',rows,'wordLib',rows)
    from fixture`,[date])
  const groupedPage=async(tab,extra={})=>(await db.query(`select get_daily_radar_page(
    p_date=>$1,p_scope=>'group-regression',p_tab=>$2,p_group_id=>$3,p_page=>$4,p_size=>20,
    p_keyword=>$5,p_sort=>'volume') as result`,[date,tab,extra.group===undefined?group:extra.group,extra.page??0,extra.keyword??''])).rows[0].result
  for(const tab of ['cross','rank','streak']) {
    const first=await groupedPage(tab), second=await groupedPage(tab,{page:1})
    assert.equal(first.total,29997) // original + final + null-submitted date fallback
    assert.equal(second.total,first.total)
    assert.equal(first.data.length,20)
    assert.equal(second.data.length,20)
    assert.deepEqual(first.data.slice(0,5).map(row=>row.keyword),['candidate-3','candidate-5','candidate-6','candidate-7','candidate-8'])
    assert.equal(new Set([...first.data,...second.data].map(row=>row.keyword)).size,40)
    const last=await groupedPage(tab,{page:1499})
    assert.equal(last.data.length,17)
    assert.equal(last.data.at(-1).keyword,'candidate-30000')
    assert.equal((await groupedPage(tab,{group:null})).total,30000)
    assert.equal((await groupedPage(tab,{keyword:'candidate-1'})).total,11110)
  }
  assert.equal((await groupedPage('wordLib')).total,30000)
  // All dates must remain one bounded server page, never a 2,000-row client cap.
  await db.query(`insert into radar_daily_cache(data_date,scope_key,payload)
    select $1::date-n,'group-regression','{}' from generate_series(0,6) n
    where $1::date-n<>$2::date`,[today,date])
  const allLarge=(await db.query(`select get_daily_radar_page(p_date=>null,p_scope=>'group-regression',
    p_tab=>'rank',p_group_id=>$1,p_page=>100,p_size=>20) as result`,[group])).rows[0].result
  assert.equal(allLarge.cacheReady,true)
  assert.equal(allLarge.date,'all')
  assert.equal(allLarge.total,29997)
  assert.equal(allLarge.data.length,20)
  // Repeated terms retain their dated events. A completion hides only events on
  // or before that completion; subsequent signals remain actionable.
  await db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,status,submitted_at)
    values($1,$2,$3::date-5,'done-window','submitted',($3::date-3)::timestamp at time zone 'Asia/Kuala_Lumpur')`,[group,user,today])
  await db.query(`with days as (select $1::date-n as d,n from generate_series(0,6) n),
    fixtures as (select d,jsonb_build_array(
      jsonb_build_object('keyword','repeat','first_date',$1::date-6,'last_date',d,'volume',100,'streak',case when n=6 then 2 else 3 end),
      jsonb_build_object('keyword','unique-'||n,'first_date',d,'last_date',d,'volume',50,'streak',2),
      jsonb_build_object('keyword','done-window','first_date',$1::date-6,'last_date',d,'volume',10,'streak',3)
    ) as rows from days)
    insert into radar_daily_cache(data_date,scope_key,payload)
    select d,'all-regression',jsonb_build_object('rankWords',rows,'streakWords',rows,'cross',rows,'wordLib',rows) from fixtures`,[today])
  const windowPage=async(tab='rank',badge='all',selectedGroup=group,pg=0)=>(await db.query(`select get_daily_radar_page(
    p_date=>null,p_scope=>'all-regression',p_tab=>$1,p_group_id=>$2,p_page=>$3,p_size=>4,p_badge=>$4) as result`,[tab,selectedGroup,pg,badge])).rows[0].result
  const completionCutoff=(await db.query('select ($1::date-3)::text as d',[today])).rows[0].d
  for(const tab of ['cross','rank','streak']){
    const first=await windowPage(tab),added=await windowPage(tab,'new'),updated=await windowPage(tab,'updated')
    assert.equal(first.total,17)
    assert.equal(added.total,8)
    assert.equal(updated.total,9)
    assert.equal(first.data.length,4)
    assert.equal((await windowPage(tab,'all',null)).total,21)
    const allRows=[]
    for(let pg=0;pg<5;pg++)allRows.push(...(await windowPage(tab,'all',group,pg)).data)
    assert.equal(new Set(allRows.map(row=>row.keyword+'|'+row.last_date)).size,17)
    assert.equal(allRows.filter(row=>row.keyword==='done-window').length,3)
    assert.ok(allRows.filter(row=>row.keyword==='done-window').every(row=>row.last_date>completionCutoff))
    const repeated=(await db.query(`select get_daily_radar_page(p_date=>null,p_scope=>'all-regression',p_tab=>$1,
      p_keyword=>'repeat',p_badge=>'updated',p_size=>2,p_page=>2) as result`,[tab])).rows[0].result
    assert.equal(repeated.total,6)
    assert.equal(repeated.data.length,2)
  }
  assert.equal((await windowPage('wordLib')).total,21)
  assert.equal((await windowPage()).cachedDates.length,7)
  await db.query(`insert into radar_daily_cache(data_date,scope_key,payload)
    select data_date,'partial-regression',payload from radar_daily_cache where scope_key='all-regression' and data_date=$1::date`,[date])
  const partial=(await db.query(`select get_daily_radar_page(null,'partial-regression','rank') as result`)).rows[0].result
  assert.equal(partial.cacheReady,true) // missing today's cache cannot block other dates
  assert.equal(partial.total,3)
  assert.deepEqual(partial.cachedDates,[date])
  const missing=(await db.query(`select get_daily_radar_page(null,'missing-scope','rank') as result`)).rows[0].result
  assert.equal(missing.cacheReady,false)
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query(`select has_function_privilege($1,
      'public.get_daily_radar_page(date,text,text,uuid,integer,integer,text,text,integer,integer,text,text,text)','execute') as allowed`,[role])).rows[0].allowed,false)
  }
  const insertUpdate = async (url,source='手动添加',assignee=user,keyword='7723游戏盒') => db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,page_url,source,operation_type,status)
    values($1,$2,$3,$4,$5,$6,'更新','pending')`,[group,assignee,today,keyword,url,source])
  await insertUpdate('https://www.f71.com/app/400081.html')
  // Reproduce the deployed database: identity lookup allowed URL B while the
  // leftover keyword-only INSERT trigger still rejected it because URL A exists.
  await db.exec(legacyGuard)
  const beforeClaims=(await db.query('select * from member_claimed_keywords order by id')).rows
  assert.equal((await db.query(`select find_active_task_claim($1,$2,'7723游戏盒','http://m.f71.com/app/333858.html','更新','跌词更新') as result`,[group,today])).rows[0].result,null)
  await assert.rejects(insertUpdate('http://m.f71.com/app/333858.html','跌词更新'),/group, date, and keyword/)
  // Fail closed if the replacement guard is disabled, leaving the old guard intact.
  await db.exec('alter table member_claimed_keywords disable trigger guard_member_claim_identity')
  await assert.rejects(db.exec(retireLegacyGuard),/active task-identity guard/)
  await db.exec('rollback')
  assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgrelid='member_claimed_keywords'::regclass and tgname='prevent_duplicate_active_group_claim'")).rows[0].n,1)
  await db.exec('alter table member_claimed_keywords enable trigger guard_member_claim_identity')
  await db.exec(retireLegacyGuard)
  await db.exec(retireLegacyGuard) // safe to reapply
  assert.deepEqual((await db.query('select * from member_claimed_keywords order by id')).rows,beforeClaims)
  await insertUpdate('http://m.f71.com/app/333858.html','跌词更新')
  await assert.rejects(insertUpdate('https://m.f71.com/app/400081.html#section'),/already claimed/)
  await assert.rejects(insertUpdate('https://www.f71.com/app/333858.html','涨排更新','55555555-5555-4555-8555-555555555555','同页其它词'),/already claimed/)
  await db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,source,operation_type,status)
    values($1,$2,$3,'ordinary-new','手动添加','新增','pending')`,[group,user,today])
  await assert.rejects(db.query(`insert into member_claimed_keywords(group_id,user_id,claimed_date,keyword,source,operation_type,status)
    values($1,'55555555-5555-4555-8555-555555555555',$2,'ordinary-new','手动添加','新增','pending')`,[group,today]),/already claimed/)
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
    liveCompletionFiltering:true,legacyKeywordGuardReproduced:true,legacyKeywordGuardRetired:true,existingTasksPreserved:true,
    groupedCandidates:30000,allSevenDates:true,combinedBadgeAndSearch:true,completionOriginalAndFinal:true,completionDateBoundary:true,
    legacyDatesInvented:false,cacheOnlyCleanup:true,productionWrites:0}))
} finally { await db.close() }
