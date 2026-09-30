# Figma 网页设计实战培训

适用对象：没有 UI 基础、需要完成网页方案并交付前端的同事。  
训练目标：先建立可复用组件，再用组件组装首页、列表页和详情页，最后形成可执行的前端交付资料。

## 课程原则

1. 先学会操作画布，再学设计。
2. 先统一颜色、文字和间距，再做组件。
3. 先完成 P0 组件，再拼正式页面。
4. 页面只使用组件实例，非必要不 Detach。
5. 参考别人的布局方法，不复制品牌、图片和完整页面。
6. 设计必须包含 Hover、Active、Disabled、缺图和长文字等真实状态。

## 00｜画布操作速查

| 目的 | 操作 |
| --- | --- |
| 任意方向平移画布 | 按住鼠标滚轮（中键）并拖动 |
| 没有鼠标中键时平移 | 按住 `Space`，再按住鼠标左键拖动 |
| 上下 / 横向移动 | 滚轮 / `Shift + 滚轮` |
| 缩放 | `Ctrl/⌘ + 滚轮` |
| 显示全部内容 | `Shift + 1` |
| 聚焦选中对象 | `Shift + 2` |
| 选择 / Frame / 文字 / 矩形 | `V` / `F` / `T` / `R` |
| 进入 / 退出一层 | `Enter` / `Shift + Enter` |
| 复制 | `Alt/Option + 拖动` |
| 添加 Auto Layout | `Shift + A` |

练习：创建三个相隔较远的 Frame，每个放一个标题和按钮。不看工具栏，在三个 Frame 间移动、缩放、复制并选中文字。

## 01｜读懂旧 UI 文件

- 复制原文件做练习稿，不直接破坏原稿。
- 建立 `00 封面`、`01 基础规范`、`02 组件`、`03 页面模板`、`10 正式页面`、`90 归档`。
- 重命名所有页面和 Frame。
- 标出导航、卡片、列表行、页脚等重复模块。

作业：找出至少 10 个重复模块。

## 02｜抓参考页面

- 截图只放在 Reference 区。
- 记录内容宽度、列数、间距、字号层级、颜色和 Hover。
- 每个参考网站只选择 1–2 个值得借鉴的方法，并写清原因。
- 不复制对方 Logo、图片、文字和完整视觉组合。

## 03｜建立基础规范

- 颜色：品牌色、主文字、次文字、背景、边框、危险色。
- 字体：页面标题、区块标题、卡片标题、正文、辅助文字。
- 间距：优先使用 4、8、12、16、24、32、48。
- 圆角：先限制为 4、8、12、999；阴影只设轻、重两档。
- 将常用值保存为 Variables 或 Styles。

## 04｜最小组件库

先完成 P0：

- Button、IconButton、NavItem、SearchInput、Tag
- SectionHeader、AppIconCard、RankingRow
- Header、Footer

需要页面时再补 P1：ArticleCard、Tabs、Breadcrumb、DownloadPanel。最后补 P2：缺图、空内容、加载状态。

每个组件至少检查：用途、尺寸、内容结构、Default、Hover、Active、Disabled、长文字和缺图。

## 05｜Auto Layout

- 横向布局用于导航、标签和按钮组；纵向布局用于卡片和列表。
- 内容尺寸优先用 Hug contents，需要占满剩余空间时用 Fill container。
- 通过 padding 和 gap 控制留白，不凭感觉逐个拖动。
- 主动拉宽、缩窄组件，并替换成长标题测试。

## 06｜Variants 与交互状态

- Button：Default、Hover、Pressed、Disabled。
- NavItem：Default、Hover、Active。
- Card：Default、Hover。
- 分开设置属性，例如 `Size=Medium`、`State=Hover`。
- Hover 不应改变组件尺寸，避免页面跳动。

## 07–08｜用组件组装页面

1. 新建 1440px Frame，内容容器可先使用 1200px。
2. 拖入 Header、推荐区、列表、排行榜和 Footer 的实例。
3. 调整父容器的 padding 与 gap，不逐个挪动子元素。
4. 使用真实长标题、缺图和不同数量内容测试。
5. 复用同一骨架扩展游戏列表页、游戏详情页和文章详情页。

## 09｜原型与检查

- 演示导航 Hover、按钮点击、下拉菜单、Tab 和关键页面跳转。
- 只制作关键流程，不必把设计稿做成完整程序。
- 检查小字号、颜色对比、点击区域、长文字、空数据和错误状态。

## 10｜交付前端

- Ready for dev 区只保留确认后的页面和组件。
- 为重要组件写明用途、尺寸、状态、交互和响应式变化。
- 图标使用 SVG，图片按约定倍率导出，不把文字做成图片。
- 提供页面清单、组件清单、颜色/字体/间距规范、素材和原型入口。
- 与前端逐项确认组件对应关系，确保对方可以复述需求。

## 每次交付检查表

- [ ] 页面有明确名称和版本
- [ ] 所有重复内容已组件化
- [ ] 组件有 Default / Hover / Active / Disabled 等必要状态
- [ ] 页面没有无理由 Detach 的实例
- [ ] 长标题、缺图、空数据已经测试
- [ ] 桌面宽度与响应式规则已经说明
- [ ] 图标、图片和字体可合法使用并可导出
- [ ] 原型入口和关键流程清楚
- [ ] 前端知道哪些是复用组件，哪些是页面特例

## 官方资料

- [Frames](https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design)
- [Auto Layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout)
- [Components 与 Variants 基础](https://help.figma.com/hc/en-us/articles/39636737843735-Components-collection-Variants-and-component-set-fundamentals)
- [创建和使用 Variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants)
- [开发交付](https://help.figma.com/hc/en-us/articles/360040521453-Optimize-design-files-for-developer-handoff)
