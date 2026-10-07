'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Component, Editor } from 'grapesjs'
import type { PageStudioFavoriteModule } from '@/lib/page-studio'

type ModuleCategory = '常用' | '导航' | '内容' | '广告' | '布局' | '按钮' | '基础组件' | '我的模块'
type PreviewKind = 'nav' | 'banner' | 'waterfall' | 'list' | 'feature' | 'columns2' | 'columns3' | 'title' | 'text' | 'image' | 'icon' | 'iconCard' | 'iconGrid' | 'tabs' | 'tag' | 'button' | 'buttons' | 'pager' | 'carousel' | 'numbers'

type StudioModule = {
  id: string
  name: string
  description: string
  category: Exclude<ModuleCategory, '我的模块'>
  preview: PreviewKind
  html: string
}

type LibraryView = 'templates' | 'modules' | 'favorites'

type PageTemplate = {
  id: string
  name: string
  description: string
  accent: string
  preview: 'download' | 'content'
  html: string
}

const PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#eef2f7"/><path d="m145 285 120-128 78 82 58-61 96 107H145z" fill="#cbd5e1"/><circle cx="438" cy="112" r="32" fill="#cbd5e1"/></svg>')}`
const section = 'box-sizing:border-box;width:100%;max-width:1200px;margin:0 auto 16px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;'
const heading = 'margin:0;color:#0f172a;font-size:24px;line-height:1.3;'
const button = 'display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:8px;background:#059669;color:#fff;text-decoration:none;font-weight:700;'
const compactButton = 'display:inline-flex;box-sizing:border-box;min-height:30px;align-items:center;justify-content:center;padding:0 12px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;'

const MODULES: StudioModule[] = [
  { id: 'nav-logo', name: 'Logo＋主导航', description: 'Logo、栏目和搜索入口', category: '导航', preview: 'nav', html: `<header data-studio-module="导航栏" style="${section}display:flex;align-items:center;gap:28px;"><img src="${PLACEHOLDER}" alt="网站 Logo" style="width:160px;height:52px;object-fit:contain;"/><nav aria-label="主导航" style="display:flex;flex:1;align-items:center;justify-content:center;gap:30px;"><a href="#" style="color:#059669;font-weight:800;text-decoration:none;">首页</a><a href="#" style="color:#334155;text-decoration:none;">手机游戏</a><a href="#" style="color:#334155;text-decoration:none;">手机应用</a><a href="#" style="color:#334155;text-decoration:none;">新闻资讯</a><a href="#" style="color:#334155;text-decoration:none;">排行榜</a></nav><a href="#" aria-label="搜索" style="color:#475569;text-decoration:none;font-size:20px;">⌕</a></header>` },
  { id: 'nav-compact', name: '简洁栏目导航', description: '适合页面内部栏目切换', category: '导航', preview: 'nav', html: `<nav data-studio-module="栏目导航" aria-label="栏目导航" style="${section}display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;"><a href="#" style="padding:10px 18px;border-radius:8px;background:#059669;color:#fff;text-decoration:none;font-weight:700;">推荐</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">游戏</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">应用</a><a href="#" style="padding:10px 18px;color:#475569;text-decoration:none;">专题</a></nav>` },
  { id: 'section-title-tabs', name: '图标栏目标题', description: '图标、标题、切换标签和更多', category: '内容', preview: 'title', html: `<div data-studio-module="图标栏目标题" style="box-sizing:border-box;display:flex;width:100%;min-height:46px;align-items:center;gap:18px;padding:8px 12px;border-bottom:2px solid #6366f1;background:#fff;"><div style="display:flex;align-items:center;gap:8px;white-space:nowrap;"><span aria-hidden="true" style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:7px;background:#eef2ff;color:#4f46e5;font-size:17px;">◆</span><h2 style="margin:0;color:#0f172a;font-size:20px;line-height:1.2;">热门应用</h2></div><nav aria-label="栏目切换" style="display:flex;min-width:0;flex:1;align-items:center;gap:6px;"><a href="#" style="padding:6px 10px;border-radius:6px;background:#4f46e5;color:#fff;text-decoration:none;font-size:13px;">推荐</a><a href="#" style="padding:6px 10px;color:#64748b;text-decoration:none;font-size:13px;">游戏</a><a href="#" style="padding:6px 10px;color:#64748b;text-decoration:none;font-size:13px;">应用</a></nav><a href="#" style="color:#0284c7;text-decoration:none;font-size:13px;white-space:nowrap;">更多 ›</a></div>` },
  { id: 'tab-bar', name: '栏目切换标签', description: '手游、应用、热点、专题', category: '导航', preview: 'tabs', html: `<nav data-studio-module="栏目切换标签" aria-label="内容分类" style="box-sizing:border-box;display:flex;width:100%;align-items:center;gap:4px;padding:5px;border-radius:9px;background:linear-gradient(90deg,#8b5cf6,#6366f1);"><a href="#" style="padding:8px 13px;border-radius:7px;background:#fff;color:#4f46e5;text-decoration:none;font-weight:700;">🎮 手游</a><a href="#" style="padding:8px 13px;color:#fff;text-decoration:none;">▦ 应用</a><a href="#" style="padding:8px 13px;color:#fff;text-decoration:none;">♨ 热点</a><a href="#" style="padding:8px 13px;color:#fff;text-decoration:none;">▣ 专题</a></nav>` },
  { id: 'icon-grid', name: '游戏／应用图标网格', description: '可继续放入图标卡，自动排列', category: '布局', preview: 'iconGrid', html: `<div data-studio-module="游戏／应用图标网格" data-studio-slot="图标网格" style="box-sizing:border-box;display:grid;width:100%;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;padding:12px;background:#fff;"><p data-studio-placeholder="true" style="grid-column:1/-1;margin:0;padding:24px;border:1px dashed #cbd5e1;border-radius:8px;color:#94a3b8;text-align:center;">把内容放在这里</p></div>` },
  { id: 'app-icon-card', name: '游戏／应用图标卡', description: '方形图标和单行名称', category: '内容', preview: 'iconCard', html: `<a data-studio-module="游戏／应用图标卡" href="#" style="box-sizing:border-box;display:flex;min-width:0;flex-direction:column;align-items:center;gap:8px;color:#1e293b;text-decoration:none;"><img src="${PLACEHOLDER}" alt="游戏或应用图标" style="display:block;width:72px;height:72px;border-radius:15px;object-fit:cover;box-shadow:0 1px 3px rgba(15,23,42,.12);"/><span style="display:block;width:100%;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">游戏／应用名称</span></a>` },
  { id: 'app-icon-card-meta', name: '图标＋标题信息', description: '图标、标题、版本和分类', category: '内容', preview: 'iconCard', html: `<article data-studio-module="图标标题信息" style="box-sizing:border-box;display:flex;min-width:0;align-items:center;gap:10px;padding:8px;"><img src="${PLACEHOLDER}" alt="游戏或应用图标" style="display:block;width:54px;height:54px;flex:none;border-radius:11px;object-fit:cover;"/><div style="min-width:0;flex:1;"><a href="#" style="display:block;overflow:hidden;color:#172554;text-decoration:none;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">游戏／应用名称</a><span style="display:block;margin-top:4px;overflow:hidden;color:#94a3b8;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">v1.0.0 · 角色扮演</span></div></article>` },
  { id: 'icon-recommend-section', name: '游戏／应用推荐区', description: '栏目标题、换一批和图标列表', category: '内容', preview: 'iconGrid', html: `<section data-studio-module="游戏／应用推荐区" style="${section}padding:0;overflow:hidden;"><div style="display:flex;min-height:48px;align-items:center;gap:16px;padding:8px 14px;border-bottom:2px solid #6366f1;"><div style="display:flex;align-items:center;gap:8px;"><span aria-hidden="true" style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:7px;background:#eef2ff;color:#4f46e5;">◆</span><h2 style="margin:0;font-size:20px;color:#0f172a;white-space:nowrap;">热门游戏</h2></div><nav aria-label="推荐分类" style="display:flex;min-width:0;flex:1;gap:5px;"><a href="#" style="padding:6px 10px;border-radius:6px;background:#4f46e5;color:#fff;text-decoration:none;font-size:13px;">推荐</a><a href="#" style="padding:6px 10px;color:#64748b;text-decoration:none;font-size:13px;">新游</a><a href="#" style="padding:6px 10px;color:#64748b;text-decoration:none;font-size:13px;">热门</a></nav><button type="button" style="${compactButton}border:1px solid #cbd5e1;background:#fff;color:#475569;cursor:pointer;"><span aria-hidden="true" style="margin-right:5px;">↻</span>换一批</button><a href="#" style="color:#0284c7;text-decoration:none;font-size:13px;white-space:nowrap;">更多 ›</a></div><div data-studio-slot="推荐图标列表" style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:14px;padding:16px;">${Array.from({ length: 8 }, (_, index) => `<a href="#" style="display:flex;min-width:0;flex-direction:column;align-items:center;gap:8px;color:#1e293b;text-decoration:none;"><img src="${PLACEHOLDER}" alt="游戏图标 ${index + 1}" style="display:block;width:72px;height:72px;border-radius:15px;object-fit:cover;box-shadow:0 1px 3px rgba(15,23,42,.12);"/><span style="display:block;width:100%;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">游戏名称 ${index + 1}</span></a>`).join('')}</div></section>` },
  { id: 'compact-list-row', name: '紧凑信息列表项', description: '标题、分类和查看按钮', category: '内容', preview: 'list', html: `<div data-studio-module="紧凑信息列表项" style="box-sizing:border-box;display:grid;width:100%;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px dotted #e2e8f0;"><a href="#" style="overflow:hidden;color:#1e293b;text-decoration:none;text-overflow:ellipsis;white-space:nowrap;">这里是内容标题</a><span style="color:#94a3b8;font-size:12px;white-space:nowrap;">角色扮演</span><a href="#" style="${compactButton}border:1px solid #bae6fd;color:#0284c7;">查看</a></div>` },
  { id: 'tag-link', name: '分类标签', description: '游戏、应用或专题分类入口', category: '基础组件', preview: 'tag', html: `<a data-studio-module="分类标签" href="#" style="display:inline-flex;box-sizing:border-box;min-height:28px;align-items:center;padding:0 10px;border:1px solid #bae6fd;border-radius:6px;background:#f0f9ff;color:#0284c7;text-decoration:none;font-size:13px;white-space:nowrap;">角色扮演</a>` },
  { id: 'more-button', name: '更多按钮', description: '放在栏目标题右侧', category: '按钮', preview: 'button', html: `<a data-studio-module="更多按钮" href="#" style="${compactButton}color:#0284c7;">更多 ›</a>` },
  { id: 'view-button', name: '查看按钮', description: '适合列表末端操作', category: '按钮', preview: 'button', html: `<a data-studio-module="查看按钮" href="#" style="${compactButton}border:1px solid #bae6fd;background:#fff;color:#0284c7;">查看</a>` },
  { id: 'download-button', name: '下载按钮', description: '主要下载操作按钮', category: '按钮', preview: 'button', html: `<a data-studio-module="下载按钮" href="#" style="${compactButton}background:#059669;color:#fff;">下载</a>` },
  { id: 'refresh-button', name: '换一批按钮', description: '用于推荐内容刷新入口', category: '按钮', preview: 'button', html: `<button data-studio-module="换一批按钮" type="button" style="${compactButton}border:1px solid #cbd5e1;background:#fff;color:#475569;cursor:pointer;"><span aria-hidden="true" style="margin-right:5px;">↻</span>换一批</button>` },
  { id: 'waterfall', name: '瀑布图片栏', description: '图片卡片自动换行排列', category: '内容', preview: 'waterfall', html: `<section data-studio-module="瀑布图片栏" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><h2 style="${heading}">热门推荐</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;">${[1,2,3,4,5,6,7,8].map(i => `<article style="overflow:hidden;border:1px solid #e2e8f0;border-radius:10px;background:#fff;"><img src="${PLACEHOLDER}" alt="推荐图片 ${i}" style="display:block;width:100%;aspect-ratio:16/10;object-fit:cover;"/><div style="padding:10px;"><strong style="display:block;color:#0f172a;">内容标题 ${i}</strong><span style="color:#94a3b8;font-size:12px;">内容说明</span></div></article>`).join('')}</div></section>` },
  { id: 'info-list', name: '文章资讯列表', description: '标题、日期，可选查看按钮', category: '内容', preview: 'list', html: `<section data-studio-module="文章资讯列表" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;"><h2 style="${heading}">最新资讯</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div>${[1,2,3,4,5,6].map(i => `<article style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid #f1f5f9;"><a href="#" style="overflow:hidden;color:#1e293b;text-decoration:none;text-overflow:ellipsis;white-space:nowrap;">这里是文章资讯标题 ${i}</a><time style="color:#94a3b8;font-size:13px;">2026/10/01</time><a href="#" style="padding:6px 12px;border:1px solid #bae6fd;border-radius:6px;color:#0284c7;text-decoration:none;font-size:13px;">查看</a></article>`).join('')}</div></section>` },
  { id: 'download-list', name: '下载资源列表', description: '图标、名称、说明和下载按钮', category: '内容', preview: 'list', html: `<section data-studio-module="下载资源列表" style="${section}"><h2 style="${heading}margin-bottom:12px;">热门下载</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">${[1,2,3,4].map(i => `<article style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;"><img src="${PLACEHOLDER}" alt="应用图标 ${i}" style="width:58px;height:58px;border-radius:12px;object-fit:cover;"/><div style="min-width:0;flex:1;"><strong style="display:block;color:#0f172a;">应用名称 ${i}</strong><span style="color:#94a3b8;font-size:12px;">版本与简短介绍</span></div><a href="#" style="${button}min-height:34px;padding:0 12px;font-size:13px;">下载</a></article>`).join('')}</div></section>` },
  { id: 'banner-ad', name: '横幅广告位', description: '整行广告图，可修改链接', category: '广告', preview: 'banner', html: `<aside data-studio-module="横幅广告" aria-label="广告" style="${section}padding:0;overflow:hidden;"><a href="#" style="display:block;"><img src="${PLACEHOLDER}" alt="横幅广告" style="display:block;width:100%;height:150px;object-fit:cover;"/></a></aside>` },
  { id: 'feature-cards', name: '专题图片广告', description: '专题、攻略或文章入口', category: '广告', preview: 'feature', html: `<section data-studio-module="专题图片广告" style="${section}"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><h2 style="${heading}">精选专题</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;">${[1,2,3].map(i => `<a href="#" style="position:relative;display:block;overflow:hidden;border-radius:10px;color:#fff;text-decoration:none;"><img src="${PLACEHOLDER}" alt="专题 ${i}" style="display:block;width:100%;aspect-ratio:16/9;object-fit:cover;filter:brightness(.72);"/><strong style="position:absolute;left:14px;right:14px;bottom:12px;font-size:16px;">专题或文章标题 ${i}</strong></a>`).join('')}</div></section>` },
  { id: 'two-columns', name: '一屏两个模块', description: '左右各放一个内容模块', category: '布局', preview: 'columns2', html: `<section data-studio-module="双栏布局" style="${section}display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;"><div data-studio-slot="左侧模块" style="min-height:180px;padding:20px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">左侧模块</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div><div data-studio-slot="右侧模块" style="min-height:180px;padding:20px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">右侧模块</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div></section>` },
  { id: 'three-columns', name: '一屏三个模块', description: '三个等宽内容区域', category: '布局', preview: 'columns3', html: `<section data-studio-module="三栏布局" style="${section}display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;">${['左侧模块','中间模块','右侧模块'].map(label => `<div data-studio-slot="${label}" style="min-height:170px;padding:18px;border:1px dashed #94a3b8;border-radius:10px;background:#f8fafc;"><h3 style="margin:0 0 8px;">${label}</h3><p style="margin:0;color:#64748b;">把内容放在这里</p></div>`).join('')}</section>` },
  { id: 'title', name: '标题栏', description: '标题和可选更多入口', category: '基础组件', preview: 'title', html: `<div data-studio-module="标题栏" style="${section}display:flex;align-items:center;justify-content:space-between;padding:12px 16px;"><h2 style="${heading}">区块标题</h2><a href="#" style="color:#0284c7;text-decoration:none;">更多 ›</a></div>` },
  { id: 'text', name: '文字说明', description: '可直接双击修改的段落', category: '基础组件', preview: 'text', html: `<div data-studio-module="文字说明" style="${section}"><p style="margin:0;color:#475569;line-height:1.8;">双击这里修改文字，可以填写模块说明、文章简介或其他内容。</p></div>` },
  { id: 'image', name: '单张图片', description: 'Logo、配图或广告图片', category: '基础组件', preview: 'image', html: `<div data-studio-module="单张图片" style="${section}padding:0;overflow:hidden;"><img src="${PLACEHOLDER}" alt="图片说明" style="display:block;width:100%;height:auto;object-fit:cover;"/></div>` },
  { id: 'icon-text', name: 'Icon＋文字', description: '图标搭配短说明', category: '基础组件', preview: 'icon', html: `<div data-studio-module="图标文字" style="${section}display:flex;align-items:center;gap:12px;"><span aria-hidden="true" style="display:inline-flex;width:42px;height:42px;align-items:center;justify-content:center;border-radius:10px;background:#ecfdf5;color:#047857;font-size:22px;">★</span><div><strong style="display:block;color:#0f172a;">功能标题</strong><span style="color:#64748b;font-size:13px;">在这里填写功能说明</span></div></div>` },
  { id: 'buttons', name: '操作按钮组', description: '下载、查看和更多按钮', category: '基础组件', preview: 'buttons', html: `<div data-studio-module="操作按钮" style="${section}display:flex;align-items:center;justify-content:center;gap:12px;"><a href="#" style="${button}">下载</a><a href="#" style="${button}background:#0284c7;">查看</a><a href="#" style="${button}background:#fff;color:#475569;border:1px solid #cbd5e1;">更多</a></div>` },
  { id: 'number-group', name: '数字／排名组', description: '可设置分段颜色和选中数字', category: '基础组件', preview: 'numbers', html: `<div data-studio-module="数字／排名组" data-studio-number-group="top3" data-studio-selected-number="1" style="${section}display:flex;align-items:center;justify-content:center;gap:8px;">${Array.from({ length: 10 }, (_, index) => { const number = index + 1; const highlighted = number <= 3; return `<button type="button" data-studio-number="${number}" aria-label="数字 ${number}" style="display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;border:${number === 1 ? '2px solid #059669' : '1px solid #cbd5e1'};border-radius:8px;background:${number === 1 ? '#059669' : highlighted ? '#f97316' : '#f1f5f9'};color:${number === 1 || highlighted ? '#ffffff' : '#475569'};font-weight:700;box-shadow:${number === 1 ? '0 0 0 3px #a7f3d0' : 'none'};">${number}</button>` }).join('')}</div>` },
  { id: 'pager', name: '翻页按钮', description: '上一页、页码和下一页', category: '基础组件', preview: 'pager', html: `<nav data-studio-module="翻页按钮" aria-label="分页" style="${section}display:flex;align-items:center;justify-content:center;gap:8px;"><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">上一页</a><a href="#" style="padding:8px 12px;border-radius:7px;background:#059669;color:#fff;text-decoration:none;">1</a><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">2</a><a href="#" style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;color:#475569;text-decoration:none;">下一页</a></nav>` },
  { id: 'carousel-arrows', name: '左右切换按钮', description: '用于轮播或横向内容区', category: '基础组件', preview: 'carousel', html: `<div data-studio-module="左右切换按钮" style="${section}display:flex;align-items:center;justify-content:space-between;min-height:100px;"><button type="button" aria-label="上一项" style="width:44px;height:44px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;color:#334155;font-size:24px;">‹</button><span style="color:#94a3b8;">轮播内容区域</span><button type="button" aria-label="下一项" style="width:44px;height:44px;border:1px solid #cbd5e1;border-radius:50%;background:#fff;color:#334155;font-size:24px;">›</button></div>` },
]

function combineModules(...ids: string[]) {
  return ids.map(id => MODULES.find(module => module.id === id)?.html || '').join('')
}

const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: 'nostalgia-download-home',
    name: '怀旧下载首页',
    description: '导航、横幅、游戏推荐、专题与下载列表',
    accent: 'from-amber-100 via-orange-50 to-emerald-50',
    preview: 'download',
    html: `<div data-studio-module="怀旧下载首页模板" style="box-sizing:border-box;width:100%;padding:16px 0 32px;background:#f1f5f9;">${combineModules('nav-logo', 'banner-ad', 'section-title-tabs', 'icon-recommend-section', 'feature-cards', 'download-list', 'pager')}</div>`,
  },
  {
    id: 'content-app-home',
    name: '资讯／应用首页',
    description: '主导航、栏目切换、焦点专题、资讯与应用内容',
    accent: 'from-sky-100 via-indigo-50 to-violet-100',
    preview: 'content',
    html: `<div data-studio-module="资讯应用首页模板" style="box-sizing:border-box;width:100%;padding:16px 0 32px;background:#f8fafc;">${combineModules('nav-logo', 'nav-compact', 'feature-cards', 'info-list', 'waterfall', 'pager')}</div>`,
  },
]

const CATEGORIES: ModuleCategory[] = ['常用', '导航', '内容', '广告', '布局', '按钮', '基础组件']
const COMMON_IDS = new Set(['nav-logo', 'icon-recommend-section', 'section-title-tabs', 'icon-grid', 'app-icon-card', 'app-icon-card-meta', 'compact-list-row', 'more-button', 'view-button', 'download-button', 'banner-ad', 'two-columns', 'three-columns'])
const CONTAINER_TAGS = new Set(['main', 'header', 'footer', 'section', 'article', 'aside', 'nav', 'div', 'ul', 'ol', 'li'])

function insertionTargetFor(component: Component | undefined): Component | null {
  let current = component
  while (current?.parent()) {
    const tagName = String(current.get('tagName') || '').toLowerCase()
    if (CONTAINER_TAGS.has(tagName) && current.get('droppable') !== false && !current.is('text')) return current
    current = current.parent()
  }
  return null
}

function insertionTargetLabel(component: Component): string {
  const attributes = component.getAttributes()
  return String(
    attributes['data-studio-slot']
    || attributes['data-studio-module']
    || component.getName()
    || component.get('tagName')
    || '选中模块'
  )
}

function ModulePreview({ kind }: { kind: PreviewKind }) {
  const bars = kind === 'columns3' ? 3 : kind === 'columns2' ? 2 : kind === 'waterfall' ? 4 : 1
  if (kind === 'nav') return <div className="flex h-full items-center gap-2 px-2"><span className="h-4 w-10 rounded bg-emerald-500" /><span className="ml-auto h-2 w-8 rounded bg-slate-300" /><span className="h-2 w-8 rounded bg-slate-300" /><span className="h-2 w-8 rounded bg-slate-300" /></div>
  if (kind === 'list') return <div className="space-y-1.5 p-2">{[1,2,3].map(item => <div key={item} className="flex items-center gap-2"><span className="h-2 flex-1 rounded bg-slate-300" /><span className="h-3 w-8 rounded bg-sky-200" /></div>)}</div>
  if (kind === 'iconGrid') return <div className="grid h-full grid-cols-6 items-center gap-1.5 px-2">{[1,2,3,4,5,6].map(item => <span key={item} className="aspect-square rounded-md bg-gradient-to-br from-indigo-200 to-violet-400" />)}</div>
  if (kind === 'iconCard') return <div className="flex h-full items-center justify-center gap-2"><span className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-300 to-violet-500" /><span className="h-2 w-14 rounded bg-slate-300" /></div>
  if (kind === 'tabs') return <div className="flex h-full items-center justify-center gap-1 bg-gradient-to-r from-violet-500 to-indigo-500 px-2">{[1,2,3,4].map(item => <span key={item} className={`h-5 w-9 rounded ${item === 1 ? 'bg-white' : 'bg-white/25'}`} />)}</div>
  if (kind === 'tag') return <div className="flex h-full items-center justify-center"><span className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1 text-[8px] text-sky-600">角色扮演</span></div>
  if (kind === 'button') return <div className="flex h-full items-center justify-center"><span className="rounded-md border border-slate-200 bg-white px-4 py-1.5 text-[9px] font-semibold text-sky-600">按钮</span></div>
  if (kind === 'numbers') return <div className="flex h-full items-center justify-center gap-1">{[1,2,3,4,5,6].map(item => <span key={item} className={`flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold text-white ${item <= 3 ? 'bg-orange-500' : 'bg-slate-300'}`}>{item}</span>)}</div>
  if (kind === 'buttons' || kind === 'pager' || kind === 'carousel') return <div className="flex h-full items-center justify-center gap-2">{[1,2,3].map(item => <span key={item} className={`h-5 rounded ${item === 2 ? 'w-8 bg-emerald-500' : 'w-7 bg-slate-300'}`} />)}</div>
  if (kind === 'title' || kind === 'text' || kind === 'icon') return <div className="flex h-full items-center gap-2 px-3"><span className="h-6 w-6 rounded bg-emerald-200" /><div className="flex-1 space-y-1.5"><div className="h-2 w-2/3 rounded bg-slate-400" /><div className="h-1.5 rounded bg-slate-200" /></div></div>
  return <div className="grid h-full gap-1.5 p-2" style={{ gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))` }}>{Array.from({ length: kind === 'waterfall' ? 8 : bars }).map((_, item) => <span key={item} className={`${kind === 'banner' || kind === 'image' ? 'min-h-10' : 'min-h-5'} rounded bg-gradient-to-br from-slate-200 to-slate-300`} />)}</div>
}

function PageTemplatePreview({ kind }: { kind: PageTemplate['preview'] }) {
  return <div className="h-full p-3">
    <div className="mx-auto h-full max-w-[210px] overflow-hidden rounded-md border border-white/80 bg-white/90 shadow-sm">
      <div className="flex h-5 items-center gap-1.5 border-b border-slate-200 px-2"><span className="h-2 w-7 rounded bg-emerald-500" /><span className="ml-auto h-1.5 w-5 rounded bg-slate-300" /><span className="h-1.5 w-5 rounded bg-slate-300" /><span className="h-1.5 w-5 rounded bg-slate-300" /></div>
      <div className="m-2 h-7 rounded bg-gradient-to-r from-slate-300 to-slate-200" />
      {kind === 'download'
        ? <><div className="mx-2 grid grid-cols-6 gap-1">{[1,2,3,4,5,6].map(item => <span key={item} className="aspect-square rounded bg-gradient-to-br from-violet-300 to-indigo-400" />)}</div><div className="mx-2 mt-2 grid grid-cols-2 gap-1.5"><span className="h-8 rounded bg-amber-100" /><span className="h-8 rounded bg-emerald-100" /></div></>
        : <><div className="mx-2 grid grid-cols-3 gap-1">{[1,2,3].map(item => <span key={item} className="h-7 rounded bg-sky-100" />)}</div><div className="mx-2 mt-2 space-y-1.5">{[1,2,3].map(item => <span key={item} className="block h-1.5 rounded bg-slate-200" />)}</div></>}
    </div>
  </div>
}

export default function PageStudioModuleLibrary({ editor, favorites, onManageFavorites }: { editor: Editor | null; favorites: PageStudioFavoriteModule[]; onManageFavorites: () => void }) {
  const [view, setView] = useState<LibraryView>('templates')
  const [category, setCategory] = useState<ModuleCategory>('常用')
  const [query, setQuery] = useState('')
  const [insertAt, setInsertAt] = useState<'selection' | 'page'>('page')
  const [targetLabel, setTargetLabel] = useState('')
  const insertionTargetRef = useRef<Component | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const modules = useMemo(() => MODULES.filter(module => {
    const matchesCategory = category === '常用' ? COMMON_IDS.has(module.id) : module.category === category
    return matchesCategory && (!normalizedQuery || `${module.name} ${module.description}`.toLowerCase().includes(normalizedQuery))
  }), [category, normalizedQuery])
  const visibleFavorites = favorites.filter(item => !normalizedQuery || `${item.name} ${item.category}`.toLowerCase().includes(normalizedQuery))

  useEffect(() => {
    if (!editor) return
    const updateTarget = () => {
      const target = insertionTargetFor(editor.getSelected())
      insertionTargetRef.current = target
      setTargetLabel(target ? insertionTargetLabel(target) : '')
      if (target) setInsertAt('selection')
      else setInsertAt('page')
    }
    editor.on('component:selected component:deselected', updateTarget)
    updateTarget()
    return () => {
      editor.off('component:selected component:deselected', updateTarget)
      insertionTargetRef.current = null
    }
  }, [editor])

  function addHtml(html: string, css?: string, forcePage = false) {
    if (!editor) return
    const target = !forcePage && insertAt === 'selection' ? insertionTargetRef.current : null
    if (target?.getAttributes()['data-studio-slot']) {
      const placeholders = target.components().filter((component: Component) => component.getAttributes()['data-studio-placeholder'] === 'true')
      placeholders.forEach((component: Component) => component.remove())
      if (target.getInnerHTML().includes('把内容放在这里')) target.components().reset()
    }
    const added = target ? target.append(html) : editor.addComponents(html)
    if (css) editor.addStyle(css)
    const component = Array.isArray(added) ? added[0] : added
    if (component) editor.select(component)
  }

  function switchView(nextView: LibraryView) {
    setView(nextView)
    setQuery('')
  }

  return <div className="bg-white">
    <div className="grid grid-cols-3 gap-1 border-b border-slate-200 bg-slate-50 p-2" role="tablist" aria-label="搭建内容选择">
      {([
        ['templates', '整页模板'],
        ['modules', '内容模块'],
        ['favorites', '我的收藏'],
      ] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => switchView(value)} className={`h-9 rounded-md px-2 text-xs font-semibold transition ${view === value ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}>{label}</button>)}
    </div>

    {view === 'templates' && <>
      <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2.5 text-[11px] leading-4 text-emerald-800">
        点击模板会把整套结构加入<strong>页面底部</strong>，不会覆盖你已经做好的内容。
      </div>
      <div className="space-y-3 p-3">
        {PAGE_TEMPLATES.map(template => <button key={template.id} type="button" disabled={!editor} onClick={() => addHtml(template.html, undefined, true)} className="group block w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-emerald-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-50">
          <div className={`h-28 border-b border-slate-100 bg-gradient-to-br ${template.accent}`}><PageTemplatePreview kind={template.preview} /></div>
          <span className="flex items-center justify-between gap-2 px-3 pt-2.5 text-sm font-bold text-slate-800 group-hover:text-emerald-800"><span>{template.name}</span><span className="text-[11px] font-semibold text-emerald-600">一键加入</span></span>
          <span className="block px-3 pb-3 pt-1 text-[11px] leading-4 text-slate-500">{template.description}</span>
        </button>)}
      </div>
    </>}

    {(view === 'modules' || view === 'favorites') && <div className="border-b border-slate-200 p-3">
      <label className="block"><span className="sr-only">搜索{view === 'favorites' ? '收藏' : '模块'}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={view === 'favorites' ? '搜索我的收藏…' : '搜索导航、列表、广告…'} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></label>
      {targetLabel ? <div className="mt-2 flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-1">
        <button type="button" aria-pressed={insertAt === 'selection'} onClick={() => setInsertAt('selection')} className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-[11px] font-medium ${insertAt === 'selection' ? 'bg-white text-emerald-800 shadow-sm' : 'text-emerald-700 hover:bg-white/60'}`} title={`加入“${targetLabel}”里面`}>加入：{targetLabel}</button>
        <button type="button" aria-pressed={insertAt === 'page'} onClick={() => setInsertAt('page')} className={`shrink-0 rounded-md px-2 py-1.5 text-[11px] font-medium ${insertAt === 'page' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:bg-white/60'}`}>页面底部</button>
      </div> : <p className="mt-2 text-[11px] leading-4 text-slate-500">先选中画布中的模块或栏位即可放进去；未选中时会加入页面底部。</p>}
    </div>}

    {view === 'modules' && <>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2" style={{ scrollbarWidth: 'thin' }}>{CATEGORIES.map(item => <button key={item} type="button" onClick={() => setCategory(item)} className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium ${category === item ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{item}</button>)}</div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {modules.map(module => <button key={module.id} type="button" disabled={!editor} onClick={() => addHtml(module.html)} className="group overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-emerald-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-50">
          <div className="h-16 border-b border-slate-100 bg-slate-50"><ModulePreview kind={module.preview} /></div>
          <span className="block px-2.5 pt-2 text-xs font-semibold text-slate-800 group-hover:text-emerald-800">{module.name}</span>
          <span className="block px-2.5 pb-2 pt-0.5 text-[10px] leading-4 text-slate-500">{module.description}</span>
        </button>)}
      </div>
      {modules.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-400">没有找到符合条件的模块</div>}
    </>}

    {view === 'favorites' && <>
      <div className="grid grid-cols-2 gap-2 p-3">
        {visibleFavorites.map(module => <button key={module.id} type="button" disabled={!editor} onClick={() => addHtml(module.html, module.css)} className="group overflow-hidden rounded-lg border border-amber-200 bg-white text-left transition hover:border-amber-400 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:opacity-50">
          <div className="flex h-16 items-center justify-center border-b border-amber-100 bg-amber-50 text-xs font-semibold text-amber-700">已收藏模块</div>
          <span className="block px-2.5 pt-2 text-xs font-semibold text-slate-800">{module.name}</span><span className="block px-2.5 pb-2 pt-0.5 text-[10px] text-slate-500">{module.category}</span>
        </button>)}
      </div>
      {visibleFavorites.length === 0 && <div className="px-4 py-10 text-center text-xs leading-5 text-slate-400">{favorites.length === 0 ? '还没有收藏模块；在画布中选中喜欢的模块后点击“存为我的模块”。' : '没有找到符合条件的收藏'}</div>}
      <div className="border-t border-slate-100 p-3"><button type="button" onClick={onManageFavorites} className="h-9 w-full rounded-md border border-amber-300 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100">管理我的收藏</button></div>
    </>}
  </div>
}
