import { load } from 'cheerio'
import { GAME_DISCOVERY_SOURCES, MOMORANK_RISING, MOMORANK_CHANGE_LABELS, isMomoOverview, isMomoRising, isMomoGameUrl, validateGameDiscoveryCollection, validSourceDate, type GameDiscoveryDataset, type GameDiscoveryItem, type GameDiscoveryHighlights } from './game-discovery-sources'

const clean = (value: string | undefined | null, length = 500) => (value || '').replace(/\s+/g,' ').trim().slice(0,length)
const optional = (value: string | undefined | null, length = 500) => clean(value,length) || null
// Locked placeholders are not data. Never recover their values from scripts,
// hidden DOM, paid exports or authenticated endpoints.
const publicOptional = (value: string | undefined | null, length = 500) => {
  const text=optional(value,length)
  return text && !/\bpro\b|解锁|会员专享|付费(?:查看|可见)|升级(?:会员|套餐)/i.test(text) ? text : null
}
export class DiscoverySourceBlocked extends Error {}

export function parseMomorankHtml(html: string, dataset: GameDiscoveryDataset) {
  const config = GAME_DISCOVERY_SOURCES[dataset]
  if (config.provider !== 'momorank') throw new Error('MomoRank 来源类型无效')
  const $ = load(html)
  if (!$('title').text().includes('MomoRank')) throw new Error('来源页面未正确返回')
  // React's streamed S:n containers are public DOM slots moved into view by
  // hydration. Normalize only those slots, never a hidden/blurred paid row.
  $('div[hidden][id]').each((_,el) => { if (/^S:[0-9a-f]+$/.test($(el).attr('id') || '')) $(el).removeAttr('hidden') })
  // Reconstruct only React's public streaming placeholders, without evaluating
  // scripts or reading hydration JSON. This also keeps late change badges in
  // their original public section rather than losing them at the page footer.
  const moves=$('script').toArray().flatMap(el=>[...($(el).html()||'').matchAll(/\$RS\("(S:[0-9a-f]+)","(P:[0-9a-f]+)"\)/g)].map(match=>[match[1],match[2]]))
  for(const [from,to] of moves){
    const slot=$('[id]').filter((_,el)=>$(el).attr('id')===from).first(), target=$('template[id]').filter((_,el)=>$(el).attr('id')===to).first()
    if(slot.length && target.length && !slot.parents('[hidden],[aria-hidden="true"],[class*="blur-"]').length && !target.parents('[hidden],[aria-hidden="true"],[class*="blur-"]').length){target.replaceWith(slot.contents());slot.remove()}
  }
  // No hydration JSON, authenticated endpoints, CSS unblurring, or Pro export.
  $('script,style,[hidden],[aria-hidden="true"],[class*="blur-"],[class*="blur("]').remove()
  const changeSection=$('section[aria-label="榜单变化摘要"]').first()
  const sourceDate = isMomoOverview(dataset) ? changeSection.find('time[datetime]').first().attr('datetime') : $('body').text().match(/数据日期\s*[:：]?\s*(20\d{2}-\d{2}-\d{2})/)?.[1]
  if (!validSourceDate(sourceDate)) throw new Error('未取得来源资料日期，不标记为今天')
  const items: GameDiscoveryItem[] = []
  if (dataset === 'momo_hot_words') {
    const words = new Map<number, GameDiscoveryItem>()
    $('span').filter((_, el) => /^#\d+$/.test($(el).text().trim())).each((_, el) => {
      const position = Number($(el).text().replace('#','')), title = clean($(el).parent().children('span').eq(1).text(),240)
      if (position < 1 || position > 10 || !title || words.has(position)) return
      words.set(position,{ position, sourceId:title, title, summary:null, url:null, metric:null, change:null, tags:[] })
    })
    items.push(...[...words.values()].sort((a,b) => a.position-b.position))
  } else {
    const table = $('table').first(), headers = table.find('thead th').toArray().map(el => clean($(el).text()))
    const nameIndex = headers.findIndex(header => header === '游戏' || header === '合作 IP')
    const rankIndex = headers.findIndex(header => header === '排名')
    if (nameIndex < 0) throw new Error('来源表格结构变化')
    if(isMomoRising(dataset)){
      const expected=[...MOMORANK_RISING.wechat,...MOMORANK_RISING.douyin].find(row=>row.dataset===dataset)?.label
      const requested=new URL(config.url)
      // Current public pages use a shared "当前排名" column. Verify the active
      // board's public navigation, not merely the requested URL or any link.
      const selectedBoard=$('a[aria-current="page"]').toArray().some(el=>{
        if(clean($(el).text())!==expected)return false
        try {
          const selected=new URL($(el).attr('href')||'/',config.url)
          return selected.origin===requested.origin && selected.pathname===requested.pathname
            && selected.searchParams.get('type')===requested.searchParams.get('type') && selected.searchParams.get('view')==='daily'
        } catch {return false}
      })
      if(!expected || !(headers.includes(`${expected}排名`) || (headers.includes('当前排名') && selectedBoard)))throw new Error('来源返回的上升榜分类不匹配，不混入其它榜单')
    }
    // Only the first ten unblurred public rows. Never collect paid/locked rows.
    table.find('tbody tr').slice(0,10).each((index, el) => {
      const cells = $(el).children('td'), nameCell = cells.eq(nameIndex)
      if (cells.length < (isMomoRising(dataset) ? 2 : 3)) return
      const link = nameCell.find('a').filter((_,el)=>isMomoGameUrl(new URL($(el).attr('href')||'/',config.url).toString())).first()
      if (!link.length && nameCell.find('a[href*="/pricing"]').length) return
      const title = clean(link.length ? link.find('[title]').first().attr('title') || link.text()
        : dataset === 'momo_ip' ? nameCell.find('[class*="font-medium"]').first().text()
          : nameCell.text().replace(/wx[a-f0-9]{16}/g,''),240)
      if (!title) throw new Error('来源游戏名称缺失')
      const href = link.attr('href'), candidate = href ? new URL(href,config.url) : null
      const url = candidate && isMomoGameUrl(candidate.toString()) ? candidate.toString() : null
      const headerText = (prefix: string) => { const i=headers.findIndex(header => header.startsWith(prefix)); return i>=0 ? publicOptional(cells.eq(i).text(),100) : null }
      const currentRankIndex=headers.findIndex(header=>header==='当前排名' || header.endsWith('榜排名'))
      const summaryIndex = headers.findIndex(header => header === '简介')
      const nameDesc = dataset === 'momo_ip' ? nameCell.find('p').toArray().map(el=>clean($(el).text())).find(text=>text && text!==title) || '' : ''
      const tagIndex=headers.findIndex(header=>header==='标签')
      const sourceTags=tagIndex>=0?cells.eq(tagIndex).find('span,div').filter((_,tag)=>$(tag).children().length===0).toArray().map(tag=>publicOptional($(tag).text(),40)).filter((tag):tag is string=>Boolean(tag)):[]
      items.push({ position: rankIndex>=0 ? Number(cells.eq(rankIndex).text().replace(/[^0-9]/g,'')) : index+1,
        sourceId: candidate?.pathname.match(/^\/(?:douyin\/)?games\/(\d+)$/)?.[1] || title, title,
        summary: publicOptional(summaryIndex>=0 ? cells.eq(summaryIndex).text() : nameDesc), url,
        metric: dataset === 'momo_ip' ? headerText('热度指数') : isMomoRising(dataset) && currentRankIndex>=0 ? publicOptional(cells.eq(currentRankIndex).text(),100) : null,
        change: isMomoRising(dataset) ? headerText('日升降') || headerText('日上升名次') : headerText('变化'),
        tags: isMomoRising(dataset) && headerText('7日净升降') ? [`7日净升降 ${headerText('7日净升降')}`].map(tag => tag.slice(0,40)) : [...new Set(sourceTags)].slice(0,8),
      })
    })
  }
  const declaredVisible=Number($('body').text().match(/导出 CSV\s*(\d+)\s*条/)?.[1] || 0)
  if (!items.length || (declaredVisible>0 && items.length<Math.min(declaredVisible,10)) || items.some((item,index) => item.position !== index+1)) throw new Error('公开资料为空或不完整，不覆盖旧资料')
  const highlights:GameDiscoveryHighlights={changes:[],rising:[]}
  if(changeSection.length){
    if(changeSection.find('time[datetime]').first().attr('datetime')!==sourceDate)throw new Error('今日变化与榜单日期不一致')
    changeSection.find('ul').each((_,el)=>{
      const list=$(el), label=clean(list.prev().text(),40)
      if(!MOMORANK_CHANGE_LABELS.some(allowed=>allowed===label))return
      const seen=new Set<string>()
      const rows=list.find('li a').slice(0,10).toArray().flatMap(el=>{
        const link=$(el), url=new URL(link.attr('href')||'/',config.url).toString()
        if(!isMomoGameUrl(url)||seen.has(url))return []
        seen.add(url)
        const title=clean(link.attr('title')||link.find('.truncate').first().text(),240)
        const change=publicOptional(link.children('span').last().text(),100)
        return title?[{title,url,change:change===title?null:change}]:[]
      })
      if(rows.length)highlights.changes.push({label,items:rows})
    })
  }
  if(isMomoOverview(dataset)){
    const heading=$('h2').filter((_,el)=>clean($(el).text())==='今日排名上升 Top 10').first()
    const card=heading.parent().parent(), seen=new Set<string>()
    // Each public li may contain desktop/mobile links and a separate Pro CTA.
    // Count games, not anchors, and never confuse the ordinal badge with a rise.
    card.find('ul').first().children('li').slice(0,10).each((_,el)=>{
      const row=$(el),link=row.find('a').filter((_,candidate)=>isMomoGameUrl(new URL($(candidate).attr('href')||'/',config.url).toString())).first()
      if(!link.length)return
      const url=new URL(link.attr('href')!,config.url).toString(),sourceId=new URL(url).pathname.split('/').at(-1)!
      if(seen.has(sourceId))return
      seen.add(sourceId)
      const title=clean(link.find('[title]').first().attr('title') || link.find('.truncate').first().text() || link.attr('title'),240)
      if(!title)throw new Error('排行榜概览公开上升条目缺少名称')
      const change=row.find('span').toArray().map(badge=>publicOptional($(badge).text(),100)).find(text=>text && /^(?:日升\s*\d+\s*名|[+↑]\s*\d+)$/.test(text)) || null
      highlights.rising.push({position:highlights.rising.length+1,sourceId,title,url,summary:null,
        metric:publicOptional(link.find('p').first().text(),100),change,tags:[]})
    })
    if(!heading.length || !highlights.rising.length)throw new Error('排行榜概览缺少公开上升榜，不覆盖旧概览')
  }
  return { sourceDate, items, highlights }
}

function publicDetailJson(html: string): Record<string, any> {
  const $=load(html)
  for (const script of $('script').toArray()) {
    const text=$(script).html() || '', start=text.indexOf('window.__DETAIL_DATA__=')
    if (start<0) continue
    const body=text.slice(start+'window.__DETAIL_DATA__='.length).trimStart()
    let depth=0, quoted=false, escaped=false
    for (let i=0;i<body.length;i++) {
      const char=body[i]
      if (quoted) { if (escaped) escaped=false; else if (char==='\\') escaped=true; else if (char==='"') quoted=false; continue }
      if (char==='"') quoted=true
      else if (char==='{') depth++
      else if (char==='}' && --depth===0) return JSON.parse(body.slice(0,i+1))
    }
  }
  throw new Error('微信官网展示资料结构变化')
}
export function parseWechatPublicHtml(html: string, dataset: GameDiscoveryDataset): GameDiscoveryItem[] {
  const config=GAME_DISCOVERY_SOURCES[dataset]
  if (config.provider!=='wechat') throw new Error('微信来源类型无效')
  const data=publicDetailJson(html), rankId=Number(new URL(config.url).pathname.match(/\/(\d+)\.html$/)?.[1])
  if (data.head_info?.rank_id!==rankId || !Array.isArray(data.list) || !data.list.length || data.list.length>100) throw new Error('微信官网展示榜单无效')
  return data.list.map((raw,index) => {
    const app=raw.wxag_game?.app_info, base=app?.base
    if (!base || typeof base.appid!=='string' || !/^wx[a-f0-9]{16}$/.test(base.appid) || !base.appname) throw new Error('微信小游戏条目无效')
    // Do not persist friend names, avatar URLs, account data, download tokens,
    // promotional counters, or raw embedded objects from the source page.
    const tags=[base.game_type_main_name,base.game_type_sub_name].filter((tag):tag is string => typeof tag==='string' && Boolean(tag.trim()))
    return { position:index+1, sourceId:base.appid, title:clean(base.appname,240), summary:optional(app.detail?.brief_intro),
      url:null, metric:null, change:null, tags:[...new Set(tags)].map(tag => clean(tag,40)).slice(0,8) }
  })
}

export async function fetchGameDiscoveryDataset(dataset: GameDiscoveryDataset, request: typeof fetch = fetch) {
  const config=GAME_DISCOVERY_SOURCES[dataset], collectedAt=new Date().toISOString()
  const response=await request(config.url,{ signal:AbortSignal.timeout(20_000), redirect:'error', cache:'no-store', headers:{ Accept:'text/html', 'Accept-Language':'zh-CN,zh;q=0.9' } })
  if ([401,403,429].includes(response.status)) throw new DiscoverySourceBlocked(`${config.provider}: HTTP ${response.status}，停止本来源后续请求`)
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`)
  const reader=response.body?.getReader()
  if (!reader) throw new Error('来源响应为空')
  const chunks:Uint8Array[]=[];let size=0
  try { while(true) { const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000)throw new Error('来源页面超过 2MB');chunks.push(value) } }
  finally { await reader.cancel().catch(()=>undefined);reader.releaseLock() }
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const html=new TextDecoder().decode(bytes)
  const result=config.provider==='wechat' ? {sourceDate:null,items:parseWechatPublicHtml(html,dataset)} : parseMomorankHtml(html,dataset)
  const modified=response.headers.get('last-modified')
  return validateGameDiscoveryCollection({dataset,collectedAt,...result,sourceModifiedAt:modified && Number.isFinite(Date.parse(modified)) ? new Date(modified).toISOString() : null})
}
