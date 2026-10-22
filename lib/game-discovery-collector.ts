import { load } from 'cheerio'
import { GAME_DISCOVERY_SOURCES, validateGameDiscoveryCollection, validSourceDate, type GameDiscoveryDataset, type GameDiscoveryItem } from './game-discovery-sources'

const clean = (value: string | undefined | null, length = 500) => (value || '').replace(/\s+/g,' ').trim().slice(0,length)
const optional = (value: string | undefined | null, length = 500) => clean(value,length) || null
export class DiscoverySourceBlocked extends Error {}

export function parseMomorankHtml(html: string, dataset: GameDiscoveryDataset) {
  const config = GAME_DISCOVERY_SOURCES[dataset]
  if (config.provider !== 'momorank') throw new Error('MomoRank 来源类型无效')
  const $ = load(html)
  if (!$('title').text().includes('MomoRank')) throw new Error('来源页面未正确返回')
  // React's streamed S:n containers are public DOM slots moved into view by
  // hydration. Normalize only those slots, never a hidden/blurred paid row.
  $('div[hidden][id]').each((_,el) => { if (/^S:\d+$/.test($(el).attr('id') || '')) $(el).removeAttr('hidden') })
  // No hydration JSON, authenticated endpoints, CSS unblurring, or Pro export.
  $('script,style,[hidden],[aria-hidden="true"],[class*="blur-"],[class*="blur("]').remove()
  const sourceDate = $('body').text().match(/数据日期\s*[:：]?\s*(20\d{2}-\d{2}-\d{2})/)?.[1]
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
    // Only the first ten unblurred public rows. Never collect paid/locked rows.
    table.find('tbody tr').slice(0,10).each((index, el) => {
      const cells = $(el).children('td'), nameCell = cells.eq(nameIndex)
      if (cells.length < 3 || nameCell.find('a[href*="/pricing"]').length) return
      const link = nameCell.find('a[href^="/games/"]').first()
      const title = clean(link.length ? link.find('[title]').first().attr('title') || link.text()
        : dataset === 'momo_ip' ? nameCell.find('[class*="font-medium"]').first().text()
          : nameCell.text().replace(/wx[a-f0-9]{16}/g,''),240)
      if (!title) throw new Error('来源游戏名称缺失')
      const href = link.attr('href'), candidate = href ? new URL(href,config.url) : null
      const url = candidate?.origin === 'https://www.momorank.com' && /^\/games\/\d+$/.test(candidate.pathname) ? candidate.toString() : null
      const headerText = (prefix: string) => { const i=headers.findIndex(header => header.startsWith(prefix)); return i>=0 ? optional(cells.eq(i).text(),100) : null }
      const summaryIndex = headers.findIndex(header => header === '简介')
      const nameDesc = dataset === 'momo_ip' ? nameCell.find('p').toArray().map(el=>clean($(el).text())).find(text=>text && text!==title) || '' : ''
      const tagIndex=headers.findIndex(header=>header==='标签')
      const sourceTags=tagIndex>=0?cells.eq(tagIndex).find('span,div').filter((_,tag)=>$(tag).children().length===0).toArray().map(tag=>clean($(tag).text(),40)).filter(Boolean):[]
      items.push({ position: rankIndex>=0 ? Number(cells.eq(rankIndex).text().replace(/[^0-9]/g,'')) : index+1,
        sourceId: candidate?.pathname.match(/^\/games\/(\d+)$/)?.[1] || title, title,
        summary: optional(summaryIndex>=0 ? cells.eq(summaryIndex).text() : nameDesc), url,
        metric: dataset === 'momo_ip' ? headerText('热度指数') : dataset === 'momo_rising' ? headerText('畅销榜排名') : null,
        change: headerText(dataset === 'momo_rising' ? '日升降' : '变化'),
        tags: dataset === 'momo_rising' && headerText('7日净升降') ? [`7日净升降 ${headerText('7日净升降')}`].map(tag => tag.slice(0,40)) : [...new Set(sourceTags)].slice(0,8),
      })
    })
  }
  const declaredVisible=Number($('body').text().match(/导出 CSV\s*(\d+)\s*条/)?.[1] || 0)
  if (!items.length || (declaredVisible>0 && items.length<Math.min(declaredVisible,10)) || items.some((item,index) => item.position !== index+1)) throw new Error('公开资料为空或不完整，不覆盖旧资料')
  return { sourceDate, items }
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
