export type PageStudioPage = {
  id: string
  name: string
  path: string
  html: string
  css: string
  targetDevice?: 'desktop' | 'mobile'
  projectData?: Record<string, unknown>
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

const STORAGE_KEY = 'qixin-page-studio-projects-v1'

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

export function writePageStudioProjects(projects: PageStudioProject[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  window.dispatchEvent(new CustomEvent('page-studio-projects-changed'))
}

export function savePageStudioProject(project: PageStudioProject) {
  const projects = readPageStudioProjects()
  const next = { ...project, updatedAt: new Date().toISOString() }
  const index = projects.findIndex(item => item.id === project.id)
  if (index >= 0) projects[index] = next
  else projects.unshift(next)
  writePageStudioProjects(projects)
  return next
}

export function deletePageStudioProject(projectId: string) {
  writePageStudioProjects(readPageStudioProjects().filter(project => project.id !== projectId))
}

export function getPageStudioProject(projectId: string) {
  return readPageStudioProjects().find(project => project.id === projectId) ?? null
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
