# 内容发现：字幕优先的视频文字

## 上线行为

- B站、小红书、小黑盒攻略、小黑盒 NS 资料入库时自动创建去重队列。
- 采集电脑优先读取平台中文字幕：人工字幕优先于自动字幕，弹幕不算字幕。没有字幕且未受登录限制时，才使用本地CPU语音备用。不使用付费接口，也不在Vercel处理视频。
- 繁体统一转简体，不猜改游戏名或错词。`查看原文`旁有同样紧凑的`查看文字`，弹窗和复制均为纯文字，不显示时间。标明平台字幕/平台自动字幕/本地语音识别，提示对照原文核实。
- 原始文字、转换后文字和时间段保存到独立表；重采集和标题修改不会清空已完成文字。列表每次只查当前20条的状态，打开弹窗才读取正文，不在列表请求中携带文字、音频或时间段。小黑盒文章正文与视频文字独立保存；视频失败时保留正文，显示未完成原因，不能冒充全部完成。
- 原子领取、2小时租约，失败6小时、访问受限24小时后重试，最多3次。过期结果不能覆盖已完成文字；成功重新采集可恢复之前因登录受限的任务。
- 每轮默认10条；语音备用最多30分钟/100MB，不截断长视频伪装成完整结果，不持续下载直播、不整套下载多集或付费内容。临时媒体、同平台Cookie在任务结束后清除，Cookie不上传数据库。
- 画面字幕OCR尚未启用。小红书可能没有可供直接读取的字幕；不能以B站验证结果宣称所有来源都已验证。

## 已验证的Windows环境

Python 3.12.10、Node 24.20.0。CTranslate2 4.8.3在该电脑加载模型发生访问违规，4.5.0通过；PyAV 19.0.1参数与faster-whisper 1.2.1不兼容，18.1.0通过。
固定依赖：faster-whisper 1.2.1、CTranslate2 4.5.0（Windows）、setuptools 80.9.0（Windows）、PyAV 18.1.0、OpenCC Python 0.1.7。
`CONTENT_TRANSCRIBE_VAD=false`：ONNX静音检测在该电脑导入时崩溃，关闭VAD后语音测试生成文字；这不代表VAD已修复。`small`、`medium`都有错词，平台自动字幕更接近本条测试视频，但也不是已校对原稿。

## 部署

1. 仅应用`supabase/migrations/20261014_content_transcripts.sql`，不要连其它待迁移文件一起推送。它会为已有B站/小红书缓存创建队列，不修改原文元数据。
2. 部署主站。领取/回写接口使用现有`TREND_INGEST_SECRET`；文字查看仍要求活跃账号登录。表和RPC不开放给浏览器匿名/普通数据库角色。
3. 推送独立`trend-collector-worker`，采集电脑更新同一个原有仓库，不换项目、不搬登录资料。

```powershell
cd C:\actions-runner\_work\trend-collector-worker\trend-collector-worker
git pull origin main
npm.cmd install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-content-transcription.ps1
```

虚拟环境位于`C:\trend-collector-data\transcription-venv`，模型位于`C:\trend-collector-data\transcripts\models`，均在runner仓库之外。

## 先跑一条

使用采集电脑现有的环境文件。下面是用户之前使用的路径；若实际配置在仓库`.env.local`，替换为真实路径，不能把密钥直接贴进命令或日志。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-content-transcription.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local" -Source bilibili -Limit 1
```

只有`completed`且入库已确认才表示取得文字。图文/无语音与失败、登录受限分别标识，失败不能当作成功。检查后台真实条目的`查看文字`及来源标签，然后才安排批量运行。

## 电脑任务

- 原有B站采集完成、浏览器关闭后自动处理B站队列；小红书早上人工登录并采集后处理，不增加凌晨小红书访问。
- Windows补处理任务建议05:30 MYT，只处理B站。下面命令必须在采集电脑明确执行才会注册；代码上线不等于电脑任务已配置。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-content-transcription-task.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local" -At "05:30" -Limit 10
Get-ScheduledTaskInfo -TaskName SEO-Content-Text-Bilibili
```

只在该Windows用户登录且电脑开机时执行，不需要GitHub Runner在线。错过时间不补跑到上班时段，不唤醒电脑，不默认覆盖同名任务（更新需显式`-Replace`）。该脚本不会立即启动任务。日志在`C:\trend-collector-data\transcripts\logs`。
独立仓库的`Transcribe collected videos`只供手动恢复，不另加03:00定时，避免重复任务。
采集和转写共享专用浏览器互斥锁；手动窗口未关闭时，不杀浏览器、不删登录资料，停止该来源并提示。强制关机遗留锁时，核对记录的PID和任务均已停止后再清理该锁，不清空登录目录。旧连续采集脚本不在新锁范围内，不应同时共用资料目录。

## 检查

主站和采集器运行各自Node测试、类型检查；Python运行`tests/test_transcribe_content.py`（媒体/ASR使用fixture，繁简转换使用真实OpenCC）。数据库队列/来源/租约测试在事务中回滚。UI检查桌面、手机、横屏、焦点、纯文字及错误重试。
本地测试不能代替采集电脑上的真实字幕读取与入库。Runner离线或未安装电脑任务时，应明确报告未完成这部分验证。

## 小黑盒图文与视频（2026/10/15）

另应用 `20261015_content_article_text.sql`，扩展同一个私有队列，保留旧RPC供正在运行的旧任务兼容。文章原文与简体正文分别保存，不使用列表标题/摘要冒充全文，不为文章伪造时间戳。
正文选择器来自平台公开BBSLink组件的 `.post__content`、`.image-text__content`、`.bbs-video__content-wrapper`；没有这些内容时不退回整页。去除导航、评论、脚本及视频控件。检测到可见验证码、空壳或跳转不正确时停止该来源，等待人工恢复，不逆向签名或绕过验证。
视频支持页面实际提供的单个官方CDN媒体文件或B站嵌入地址；不支持的CDN、多视频、blob或其它嵌入明确标记受限，保留正文，不声称所有小黑盒视频均能处理。原生MP4缺少时长时仅允许有100MB下载上限的本地探测；未知时长流媒体不下载。识别前仍核对本地时长上限。
本机公开文章访问只得到空壳/验证码组件，未宣称真实小黑盒正文、原生视频端到端验证成功。上线前通过DOM fixture、Python媒体fixture、SQL回滚测试和弹窗测试；采集电脑仍须逐源各测试一条。

## 新夜间串行任务（替代旧05:30独立任务）

单个Windows任务 `SEO-Content-Night` 在01:30启动，内部依次等到：01:30攻略采集、02:00 NS采集、02:30 B站采集、04:00攻略文字、05:00 NS文字、06:00 B站文字。上一阶段未结束则顺延；一个来源失败继续其它来源，不重叠启动。夜间采集关闭立即转文字，小红书手动采集仍会处理文字。所有转文字程序另有跨来源互斥锁。
08:00停止开启新阶段和领取新文字，夜间单个文字子进程限30分钟、单轮启动预算40分钟；正在处理的一条可能顺延。它不保证网络、验证码、长音频或积压能在当晚全部完成，也不删除或假完成未处理的队列。
任务仅在现有用户登录、电脑开机且不休眠时执行；错过启动时间不补跑至白天。不注册XHS自动任务、不保存密码、不立即启动、不默认覆盖已有同名任务。

先在采集电脑更新仓库，运行依赖检查；然后各测试一条：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-content-transcription.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local" -Source xiaoheihe_guide -Limit 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-content-transcription.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local" -Source xiaoheihe_ns -Limit 1
```

真实条目查看正常后再注册：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-night-content-task.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local" -ReplaceStandaloneTranscription
```

此显式开关只在新任务注册成功后停用旧 `SEO-Content-Text-Bilibili`，不删除任务或登录资料。确认新任务后，将独立采集仓库的Actions变量 `CONTENT_LOCAL_NIGHT_ENABLED` 设为 `true`：只跳过GitHub旧的小黑盒/B站自动任务，保留手动恢复，三个公开来源不变。未确认电脑注册前不得提前启用该变量，以免采集断档。
三个公开来源由GitHub托管Runner运行，与电脑流程不互相依赖；GitHub触发延迟仍可能发生，不能承诺9点前全部完成。SEO主仓库任务不在本次排程变更范围内。

每天早上小红书手动运行一次：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-xiaohongshu.ps1 -EnvFile "C:\SEOCollector\seo-monitor\.env.trend.local"
```

若登录有效，无需每天重新登录；若失效，在原专用浏览器恢复登录并关闭窗口后重试。夜间任务注册、GitHub切换、真实来源测试均须分别记录，不能以脚本上线代替电脑已配置。
