import { getBrowserClient } from './supabase'

export type PageStudioPage = {
  id: string
  name: string
  path: string
  html: string
  css: string
  targetDevice?: 'desktop' | 'mobile'
  projectData?: Record<string, unknown>
  baselineHtml?: string
  baselineCss?: string
}

export type PageStudioDiffLine = {
  type: 'same' | 'added' | 'removed'
  value: string
}

export type PageStudioProject = {
  id: string
  name: string
  status: 'draft' | 'exported'
  createdAt: string
  updatedAt: string
  activePageId: string
  pages: PageStudioPage[]
}

export type PageStudioFavoriteModule = {
  id: string
  name: string
  category: string
  html: string
  css: string
  createdAt: string
  updatedAt?: string
  version?: number
  versions?: Array<{ version: number; html: string; css: string; createdAt: string }>
  sourceName?: string
  sourceUrl?: string
}

export type PageStudioProjectVersion = {
  id: number
  projectId: string
  versionNo: number
  label: string
  project: PageStudioProject
  createdAt: string
}

const STORAGE_KEY = 'qixin-page-studio-projects-v1'
const FAVORITE_MODULES_STORAGE_KEY = 'qixin-page-studio-favorite-modules-v1'

const STARTER_HTML = `<header class="site-header">
  <a class="brand" href="/">页面名称</a>
  <nav aria-label="主导航">
    <a href="/">首页</a>
    <a href="/about.html">关于我们</a>
  </nav>
</header>
<main>
  <section class="hero">
    <p class="eyebrow">页面主题</p>
    <h1>在这里输入页面主标题</h1>
    <p>选择画布中的文字、图片或区块，就可以在右侧修改内容和样式。</p>
    <a class="primary-link" href="#content">查看内容</a>
  </section>
  <section id="content" class="content-grid">
    <article><h2>内容模块一</h2><p>适合放置重点说明、产品特点或文章摘要。</p></article>
    <article><h2>内容模块二</h2><p>区块可以拖动排序，也可以从左侧继续添加。</p></article>
    <article><h2>内容模块三</h2><p>图片使用网址引用，避免导出文件过大。</p></article>
  </section>
</main>
<footer>© 页面项目</footer>`

const STARTER_CSS = `* { box-sizing: border-box; }
body { margin: 0; color: #0f172a; background: #ffffff; font-family: Arial, "Microsoft YaHei", sans-serif; line-height: 1.6; }
.site-header { min-height: 64px; padding: 0 6%; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; }
.brand { color: #0f172a; font-weight: 700; text-decoration: none; }
nav { display: flex; gap: 24px; }
nav a { color: #475569; text-decoration: none; }
.hero { padding: 80px 6%; background: #f8fafc; }
.eyebrow { color: #059669; font-weight: 700; }
h1 { max-width: 760px; margin: 8px 0 16px; font-size: clamp(36px, 6vw, 68px); line-height: 1.08; }
.hero > p:not(.eyebrow) { max-width: 660px; color: #475569; }
.primary-link { display: inline-block; margin-top: 18px; padding: 11px 18px; border: 1px solid #059669; border-radius: 8px; color: #047857; text-decoration: none; font-weight: 700; }
.content-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; padding: 48px 6%; }
article { padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; }
article h2 { margin-top: 0; font-size: 20px; }
footer { padding: 28px 6%; border-top: 1px solid #e2e8f0; color: #64748b; }`

const MOBILE_STARTER_CSS = `${STARTER_CSS}
.site-header { align-items: flex-start; flex-direction: column; gap: 12px; padding: 16px 20px; }
nav { gap: 16px; }
.hero { padding: 48px 20px; }
.content-grid { grid-template-columns: 1fr; padding: 28px 20px; }
footer { padding: 24px 20px; }`

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createPageStudioProject(name: string, html = STARTER_HTML, css = STARTER_CSS): PageStudioProject {
  const now = new Date().toISOString()
  const pageId = uid('page')
  return {
    id: uid('project'),
    name: name.trim() || '未命名页面项目',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    activePageId: pageId,
    pages: [{ id: pageId, name: '首页', path: 'index.html', html, css, targetDevice: 'desktop' }],
  }
}

export function readPageStudioProjects(): PageStudioProject[] {
  if (typeof window === 'undefined') return []
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (!value) return []
    const projects = JSON.parse(value) as PageStudioProject[]
    return Array.isArray(projects) ? projects : []
  } catch {
    return []
  }
}

function cloudStorageError(error: { code?: string; message?: string }) {
  if (error.code === '42P01') return new Error('页面设计数据库尚未初始化，请先运行 20260930_page_studio_cloud_storage.sql')
  return new Error(error.message || '页面设计资料同步失败')
}

async function upsertCloudRows(table: 'page_studio_projects' | 'page_studio_favorite_modules', items: Array<PageStudioProject | PageStudioFavoriteModule>) {
  if (items.length === 0) return
  const client = getBrowserClient() as any
  const rows = items.map(item => ({
    id: item.id,
    payload: item,
    updated_at: 'updatedAt' in item ? item.updatedAt : item.createdAt,
  }))
  const { error } = await client.from(table).upsert(rows, { onConflict: 'id' })
  if (error) throw cloudStorageError(error)
}

export async function loadPageStudioProjects(): Promise<PageStudioProject[]> {
  const local = readPageStudioProjects()
  const client = getBrowserClient() as any
  const { data, error } = await client.from('page_studio_projects').select('payload').order('updated_at', { ascending: false })
  if (error) throw cloudStorageError(error)
  const cloud = (data ?? []).map((row: { payload: PageStudioProject }) => row.payload).filter(Boolean)
  if (cloud.length === 0 && local.length > 0) {
    await upsertCloudRows('page_studio_projects', local)
    return local
  }
  writePageStudioProjects(cloud)
  return cloud
}

export function writePageStudioProjects(projects: PageStudioProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  window.dispatchEvent(new CustomEvent('page-studio-projects-changed'))
}

export function readPageStudioFavoriteModules(): PageStudioFavoriteModule[] {
  if (typeof window === 'undefined') return []
  try {
    const value = window.localStorage.getItem(FAVORITE_MODULES_STORAGE_KEY)
    if (!value) return []
    const modules = JSON.parse(value) as PageStudioFavoriteModule[]
    return Array.isArray(modules) ? modules : []
  } catch {
    return []
  }
}

export async function loadPageStudioFavoriteModules(): Promise<PageStudioFavoriteModule[]> {
  const local = readPageStudioFavoriteModules()
  const client = getBrowserClient() as any
  const { data, error } = await client.from('page_studio_favorite_modules').select('payload').order('updated_at', { ascending: false })
  if (error) throw cloudStorageError(error)
  const cloud = (data ?? []).map((row: { payload: PageStudioFavoriteModule }) => row.payload).filter(Boolean)
  if (cloud.length === 0 && local.length > 0) {
    await upsertCloudRows('page_studio_favorite_modules', local)
    return local
  }
  writePageStudioFavoriteModules(cloud)
  return cloud
}

function writePageStudioFavoriteModules(modules: PageStudioFavoriteModule[]) {
  window.localStorage.setItem(FAVORITE_MODULES_STORAGE_KEY, JSON.stringify(modules))
  window.dispatchEvent(new CustomEvent('page-studio-favorite-modules-changed'))
}

export async function createPageStudioFavoriteModule(input: Pick<PageStudioFavoriteModule, 'name' | 'category' | 'html' | 'css'> & { sourceName?: string; sourceUrl?: string }) {
  const now = new Date().toISOString()
  const favorite: PageStudioFavoriteModule = {
    id: uid('module'),
    name: input.name.trim() || '未命名模块',
    category: input.category.trim() || '通用',
    html: input.html,
    css: input.css,
    createdAt: now,
    updatedAt: now,
    version: 1,
    versions: [],
    sourceName: input.sourceName?.trim().slice(0, 100) || undefined,
    sourceUrl: input.sourceUrl?.trim().slice(0, 500) || undefined,
  }
  writePageStudioFavoriteModules([favorite, ...readPageStudioFavoriteModules()])
  await upsertCloudRows('page_studio_favorite_modules', [favorite])
  return favorite
}

export async function updatePageStudioFavoriteModule(moduleId: string, input: Pick<PageStudioFavoriteModule, 'html' | 'css'>) {
  const modules = readPageStudioFavoriteModules()
  const index = modules.findIndex(item => item.id === moduleId)
  if (index < 0) throw new Error('找不到这个收藏模块')
  const current = modules[index]
  const currentVersion = current.version ?? 1
  const next: PageStudioFavoriteModule = {
    ...current,
    html: input.html,
    css: input.css,
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
    versions: [
      ...(current.versions ?? []),
      { version: currentVersion, html: current.html, css: current.css, createdAt: current.updatedAt ?? current.createdAt },
    ].slice(-20),
  }
  modules[index] = next
  writePageStudioFavoriteModules(modules)
  await upsertCloudRows('page_studio_favorite_modules', [next])
  return next
}

export async function deletePageStudioFavoriteModule(moduleId: string) {
  writePageStudioFavoriteModules(readPageStudioFavoriteModules().filter(module => module.id !== moduleId))
  const client = getBrowserClient() as any
  const { error } = await client.from('page_studio_favorite_modules').delete().eq('id', moduleId)
  if (error) throw cloudStorageError(error)
}

export async function savePageStudioProject(project: PageStudioProject, options: { createVersion?: boolean; label?: string } = {}) {
  const projects = readPageStudioProjects()
  const next = { ...project, updatedAt: new Date().toISOString() }
  const index = projects.findIndex(item => item.id === project.id)
  if (index >= 0) projects[index] = next
  else projects.unshift(next)
  writePageStudioProjects(projects)
  await upsertCloudRows('page_studio_projects', [next])
  if (options.createVersion) {
    const client = getBrowserClient() as any
    const { data: latest, error: latestError } = await client
      .from('page_studio_project_versions')
      .select('version_no')
      .eq('project_id', next.id)
      .order('version_no', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestError) throw cloudStorageError(latestError)
    const { error: versionError } = await client.from('page_studio_project_versions').insert({
      project_id: next.id,
      version_no: (latest?.version_no ?? 0) + 1,
      label: options.label?.trim().slice(0, 80) || '手动保存',
      payload: next,
    })
    if (versionError) throw cloudStorageError(versionError)
  }
  return next
}

export async function loadPageStudioProjectVersions(projectId: string): Promise<PageStudioProjectVersion[]> {
  const client = getBrowserClient() as any
  const { data, error } = await client
    .from('page_studio_project_versions')
    .select('id, project_id, version_no, label, payload, created_at')
    .eq('project_id', projectId)
    .order('version_no', { ascending: false })
    .limit(30)
  if (error) throw cloudStorageError(error)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    projectId: row.project_id,
    versionNo: row.version_no,
    label: row.label,
    project: row.payload,
    createdAt: row.created_at,
  }))
}

export async function deletePageStudioProject(projectId: string) {
  writePageStudioProjects(readPageStudioProjects().filter(project => project.id !== projectId))
  const client = getBrowserClient() as any
  const { error } = await client.from('page_studio_projects').delete().eq('id', projectId)
  if (error) throw cloudStorageError(error)
}

export async function getPageStudioProject(projectId: string) {
  return (await loadPageStudioProjects()).find(project => project.id === projectId) ?? null
}

export function addPageStudioPage(project: PageStudioProject, name: string, targetDevice: 'desktop' | 'mobile' = 'desktop'): PageStudioProject {
  const pageId = uid('page')
  const base = name.trim() || `页面 ${project.pages.length + 1}`
  const pathBase = base
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '') || `page-${project.pages.length + 1}`
  return {
    ...project,
    activePageId: pageId,
    pages: [...project.pages, { id: pageId, name: base, path: `${pathBase}.html`, html: STARTER_HTML, css: targetDevice === 'mobile' ? MOBILE_STARTER_CSS : STARTER_CSS, targetDevice }],
  }
}

export function buildPageDocument(project: PageStudioProject, page: PageStudioPage) {
  const title = page.name.replace(/[<>&"]/g, '')
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n<style>\n${page.css}\n</style>\n</head>\n<body>\n${page.html}\n</body>\n</html>`
}

export function buildPagePrototypeDocument(project: PageStudioProject, page: PageStudioPage) {
  const interactionRuntime = `
<style>
[data-studio-interaction-target][hidden] { display: none !important; }
[data-studio-interaction-target].studio-interaction-open {
  display: var(--studio-interaction-display, block) !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
</style>
<script>
(() => {
  const targets = Array.from(document.querySelectorAll('[data-studio-interaction-target]'));
  const findTarget = id => targets.find(node => node.getAttribute('data-studio-interaction-target') === id);
  const open = target => {
    target.style.setProperty('--studio-interaction-display', target.getAttribute('data-studio-display') || 'block');
    target.hidden = false;
    target.classList.add('studio-interaction-open');
  };
  const close = target => {
    target.classList.remove('studio-interaction-open');
    target.hidden = true;
  };
  document.querySelectorAll('[data-studio-interaction][data-studio-target]').forEach(trigger => {
    const target = findTarget(trigger.getAttribute('data-studio-target'));
    if (!target) return;
    close(target);
    const mode = trigger.getAttribute('data-studio-interaction');
    if (mode === 'click-toggle') {
      trigger.addEventListener('click', event => {
        if (!trigger.getAttribute('href') || trigger.getAttribute('href') === '#') event.preventDefault();
        const nextOpen = target.hidden;
        targets.forEach(close);
        if (nextOpen) open(target);
        trigger.setAttribute('aria-expanded', String(nextOpen));
      });
      return;
    }
    let closeTimer;
    const enter = () => { window.clearTimeout(closeTimer); open(target); };
    const leave = () => { closeTimer = window.setTimeout(() => close(target), 120); };
    trigger.addEventListener('mouseenter', enter);
    trigger.addEventListener('mouseleave', leave);
    target.addEventListener('mouseenter', enter);
    target.addEventListener('mouseleave', leave);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-studio-interaction], [data-studio-interaction-target]')) return;
    targets.forEach(close);
  });
})();
</script>`
  return buildPageDocument(project, page).replace('</body>', `${interactionRuntime}\n</body>`)
}

export function downloadPageDocument(project: PageStudioProject, page: PageStudioPage) {
  const blob = new Blob([buildPageDocument(project, page)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = page.path || 'index.html'
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function copyPageDocument(project: PageStudioProject, page: PageStudioPage) {
  const documentText = buildPageDocument(project, page)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(documentText)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = documentText
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function stripCssImageReferences(css: string) {
  return css
    .replace(/@import\s+(?:url\()?[^;]+;?/gi, '')
    .replace(/background-image\s*:\s*url\([^;]+;?/gi, 'background-image: none;')
    .replace(/background\s*:\s*([^;]*?)url\([^;]+;?/gi, 'background: #f1f5f9;')
}

const IMAGE_PLACEHOLDER_DATA_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <rect width="320" height="180" fill="#f1f5f9"/>
    <rect x="1" y="1" width="318" height="178" rx="8" fill="none" stroke="#94a3b8" stroke-dasharray="7 6"/>
    <path d="M126 116l28-31 19 20 12-13 28 24H126z" fill="#cbd5e1"/>
    <circle cx="190" cy="66" r="11" fill="#cbd5e1"/>
  </svg>
`)}`

export function extractImportedCode(rawHtml: string, rawCss: string, options: { removeImages?: boolean } = {}) {
  const removeImages = options.removeImages ?? true
  const source = rawHtml.trim()
  if (!source || typeof DOMParser === 'undefined') return { html: source || STARTER_HTML, css: rawCss.trim() || STARTER_CSS }
  const documentValue = new DOMParser().parseFromString(source, 'text/html')
  const styleText = Array.from(documentValue.querySelectorAll('style')).map(style => style.textContent ?? '').join('\n')
  documentValue.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove())
  documentValue.querySelectorAll('*').forEach(element => {
    Array.from(element.attributes).forEach(attribute => {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
    })
  })

  if (removeImages) {
    documentValue.querySelectorAll('picture source, video source').forEach(node => node.remove())
    documentValue.querySelectorAll('video[poster]').forEach(video => video.removeAttribute('poster'))
    documentValue.querySelectorAll('img').forEach((image, index) => {
      const alt = image.getAttribute('alt')?.trim() || `待替换图片 ${index + 1}`
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
      image.setAttribute('src', IMAGE_PLACEHOLDER_DATA_URL)
      image.setAttribute('alt', alt)
      image.setAttribute('data-studio-image-placeholder', String(index + 1))
    })
    documentValue.querySelectorAll<HTMLElement>('[style]').forEach(element => {
      const style = element.getAttribute('style') ?? ''
      element.setAttribute('style', stripCssImageReferences(style))
    })
  }

  const combinedCss = [styleText, rawCss.trim()].filter(Boolean).join('\n\n')
  return {
    html: documentValue.body.innerHTML.trim() || source,
    css: (removeImages ? stripCssImageReferences(combinedCss) : combinedCss.replace(/@import\s+(?:url\()?[^;]+;?/gi, '')) || STARTER_CSS,
  }
}

function readableCode(value: string, kind: 'html' | 'css') {
  const normalized = kind === 'html'
    ? value.replace(/>\s*</g, '>\n<')
    : value.replace(/}\s*/g, '}\n').replace(/;\s*/g, ';\n')
  return normalized.split('\n').map(line => line.trim()).filter(Boolean)
}

function indexDiff(before: string[], after: string[]): PageStudioDiffLine[] {
  const result: PageStudioDiffLine[] = []
  const size = Math.max(before.length, after.length)
  for (let index = 0; index < size; index += 1) {
    if (before[index] === after[index] && before[index] !== undefined) result.push({ type: 'same', value: before[index] })
    else {
      if (before[index] !== undefined) result.push({ type: 'removed', value: before[index] })
      if (after[index] !== undefined) result.push({ type: 'added', value: after[index] })
    }
  }
  return result
}

export function diffPageCode(beforeValue: string, afterValue: string, kind: 'html' | 'css'): PageStudioDiffLine[] {
  const before = readableCode(beforeValue, kind)
  const after = readableCode(afterValue, kind)
  if (before.length > 700 || after.length > 700) return indexDiff(before, after)

  const columns = after.length + 1
  const matrix = new Uint16Array((before.length + 1) * columns)
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      const position = left * columns + right
      matrix[position] = before[left] === after[right]
        ? matrix[(left + 1) * columns + right + 1] + 1
        : Math.max(matrix[(left + 1) * columns + right], matrix[left * columns + right + 1])
    }
  }

  const result: PageStudioDiffLine[] = []
  let left = 0
  let right = 0
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      result.push({ type: 'same', value: before[left] }); left += 1; right += 1
    } else if (matrix[(left + 1) * columns + right] >= matrix[left * columns + right + 1]) {
      result.push({ type: 'removed', value: before[left] }); left += 1
    } else {
      result.push({ type: 'added', value: after[right] }); right += 1
    }
  }
  while (left < before.length) result.push({ type: 'removed', value: before[left++] })
  while (right < after.length) result.push({ type: 'added', value: after[right++] })
  return result
}

export function buildPageChangeReport(project: PageStudioProject, page: PageStudioPage) {
  const htmlDiff = diffPageCode(page.baselineHtml ?? page.html, page.html, 'html').filter(line => line.type !== 'same')
  const cssDiff = diffPageCode(page.baselineCss ?? page.css, page.css, 'css').filter(line => line.type !== 'same')
  const render = (title: string, lines: PageStudioDiffLine[]) => [
    `## ${title}`,
    ...(lines.length ? lines.map(line => `${line.type === 'added' ? '+' : '-'} ${line.value}`) : ['（没有修改）']),
  ].join('\n')
  return [
    `项目：${project.name}`,
    `页面：${page.name}（${page.path}）`,
    `设计端：${page.targetDevice === 'mobile' ? 'M端' : 'PC端'}`,
    '',
    render('HTML 修改', htmlDiff),
    '',
    render('CSS 修改', cssDiff),
  ].join('\n')
}
