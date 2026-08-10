// 内容归类——2026-08-10 用户要求报告里能看出"这个月的收益主要是什么类型内容
// 带来的"。自己站点提交的内容（分组任务）没有像 raw_keywords.content_type 那样
// 在抓取时就分好类，只能事后从URL路径/关键词本身猜。URL路径匹配不上时退回看
// 排名词本身判断（用户明确要求，不要直接扔进"未分类"）。

export type ContentCategory = '游戏' | '应用' | '专题' | '资讯'

export function classifyContentCategory(url: string | null, keyword: string): ContentCategory {
  const u = (url ?? '').toLowerCase()
  // /youxi/（"游戏"拼音）实测是 site_tracking_records 里最常见的路径段（全站
  // 27000+条里占了近12000条），漏掉这个会导致绝大多数游戏内容被误判成应用。
  if (u.includes('/game/') || u.includes('/games/') || u.includes('/shouyou/') || u.includes('/youxi/')) return '游戏'
  if (u.includes('/zt/')) return '专题'
  if (u.includes('/article/') || u.includes('/news/') || u.includes('/zixun/')) return '资讯'
  if (u.includes('/app/') || u.includes('/down/') || u.includes('/ruanjian/')) return '应用'

  if (/游戏|手游/.test(keyword)) return '游戏'
  if (/新闻|资讯/.test(keyword)) return '资讯'
  if (/专题|活动/.test(keyword)) return '专题'
  // 判断不出来默认归"应用"，跟项目里 raw_keywords.content_type 一贯"不确定就算app"的惯例一致。
  return '应用'
}
