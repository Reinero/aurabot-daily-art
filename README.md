# daily-art · 每日推图

适用于 [Aurabot QQ](https://github.com/aureth-labs/dsh-aurabot-qq) 的 Konachan 和 Yande.re 推图模块。支持白名单定时推送和 QQ 会话按需找图。定时任务可设置推送时间和张数，不消耗模型 token。按需找图由当前会话的 Agent 理解需求，模块负责查询、筛选、下载和发送。

## 安装

需要 Aurabot 1.2.0 或以上和已连接的 QQ 网关。本模块使用扩展 API 1，无 npm 依赖。可选代理功能需要 Node.js 24.5 或以上。

把仓库克隆到 Aurabot 数据目录的 `modules/daily-art` 下。目录名要与模块 ID `daily-art` 一致，`index.mjs` 和 `module.json` 应直接位于该目录。

```powershell
$moduleRoot = Join-Path $env:USERPROFILE '.dsh\plugins-data\aurabot\modules'
git clone https://github.com/Reinero/aurabot-daily-art.git (Join-Path $moduleRoot 'daily-art')
```

如果 Aurabot 使用自定义数据目录，请把 `$moduleRoot` 换成该目录下的 `modules`。Docker 部署时，把模块复制到 **Aurabot 容器**对应的数据卷，确保服务运行用户可读写该目录。加载后可在 Aurabot 的「系统 → 每日推图」配置。

需要 Yande.re 时，将仓库内的 `extras/daily-art-yandere` 复制到同一个 `modules` 目录，使其与 `daily-art` 并列。加载后打开「系统 → Yande.re 推图」，可分别保存定时、张数、白名单、筛选条件和代理，或点击「检测连接」。初次安装时，Yande.re 定时开关关闭，白名单为空。

## 定时推送

在 Aurabot 的「系统 → 每日推图」填写群聊、私聊推送白名单，打开「开启定时推送」并保存。模块加载后默认关闭。
名单独立于 Aurabot 的聊天权限，默认留空，不会从聊天权限自动导入。号码每行一个，也可用逗号分隔。主人私聊若要接收，也要填入私聊推送白名单。
批次建立时确定接收名单，之后加入的目标从新批次开始接收。发送或重试前会重新检查名单，已移除的目标不发送。

「每日推送时间」使用北京时间和 24 小时制，如 `08:30`、`19:15`。每行填一个时间，也可用逗号分隔。默认每天 09:00、17:00 各发一批。每批可选 1–10 张，默认 5 张。启动或保存后会补发当天已过时点但尚未发送的批次，跨日不追发。改张数时，已选图的批次继续使用原张数。
每个时段使用同一批图片，逐个向白名单目标发送。网关明确失败时约 5 分钟后重试未收到的目标；网关回执不明时跳过重发。
总开关关闭或处于试运行时，任务不发送，也不消费当天的批次。

模块从 `https://konachan.net/post.json` 按「系统 → 每日推图」中保存的条件选图，并下载图片后交给 QQ 网关。定时任务不调用模型或视觉工具。

| 筛选项 | 用法 |
| --- | --- |
| 评分 | 默认最低 31。上下限都包含边界，最高分可留空。 |
| 包含、排除标签 | 各最多 5 个英文站点标签。包含条件全部满足，命中任一排除条件就跳过。用空格、换行或逗号分隔。 |
| 分级 | 当前图源 `konachan.net` 只返回 Safe（`s`）。 |
| 宽高与画幅 | 可填最小宽度和高度，也可选横图、竖图或方图。 |
| 排序 | 按新旧、评分或分辨率选图。默认最新优先。 |
| 高级筛选 | 接受 `id`、`width`、`height`、`mpixels`、`ratio`、`date`、`parent`、`user`、`source`、`md5`、`vote`。如 `ratio:16:9 mpixels:2.5..`。使用空格或换行分隔。高级宽高条件与相应的最小宽高只能选一种。 |

高级条件由 [Konachan API](https://konachan.net/help/cheatsheet) 执行。新筛选用于尚未选图的批次，已选好的批次仍按原记录补发。凑不齐设定张数时，模块记录原因并稍后重试。

## 图源、凭据和代理

在「每日推图」可以选填 Konachan 用户名和个人 API Key。先点「检测连接」，再点「保存设置」。定时推送与按需搜索使用已保存的密钥访问 `konachan.net`，分级仍为 Safe。未配置密钥时使用公开接口。密钥保存后输入框为空，如需移除，请点「清除密钥」再保存。
账号凭据不完整或认证被拒绝时，自动用同一代理设置重试公开接口。连接检测会显示回退原因。遇到 Cloudflare 验证或网络故障时，显示对应错误。

「Konachan 代理地址」可填写 `http://` 或 `https://` 代理。Windows 上的本机代理可填写容器能访问的地址，例如 `http://host.docker.internal:7890`。留空时直连。如已保存代理，要恢复直连可点「清除代理」并保存。定时推送和按需找图的 API 请求、图片下载共用此设置。保存后点「检测连接」可检查 API 和样图下载，不会发送 QQ 消息。代理功能需要 Node.js 24.5 或以上。

模块日常只请求 `konachan.net`，包括 `/post.json`、`/tag.json` 和候选图片地址。「检测连接」另外查询 `konachan.com/post.json`。检测结果分别显示两个域名的可达性，日常选图仍使用 Safe 分级。单张图片下载上限为 4 MiB。

## 排查与数据

在「系统 → 日志」查看 `[Konachan]` 记录。连接检测、请求失败和公开接口回退会记录站点、阶段、HTTP 状态、耗时、代理模式及认证方式。Cloudflare 响应会附上 Ray ID（若返回），便于站点运营方查询对应事件。日志省略密钥、代理地址、查询参数和响应正文。

批次和已使用的来源 ID 存在 Aurabot 数据目录的 `modules-data/daily-art/delivery.json`，重启后保留。移除记录会使历史图片重新进入候选。
Yande.re 使用单独的 `modules-data/daily-art/delivery-yandere.json`，API 请求访问 `yande.re`，图片可能从 `files.yande.re` 下载。日志用 `[Yande.re]` 标记。

## 在 QQ 里按需找图

在 Aurabot 已允许聊天的 QQ 会话里，用「konachan找图」开头。例如「konachan找图 初音未来的横图，按评分排序」。Agent 会在同一轮查找并发图，再附上分数、分辨率、题材、人物和作品链接。没指定数量时发 1 张。
想先选图时，在请求里加「先列候选」，再在同一会话发「konachan找图 发第 2 张」。
候选在该会话保留 10 分钟。主人私聊需要「受限」或「完整」权限。定时推送开关及其白名单用于定时任务。

| 工具 | 职责 |
| --- | --- |
| `image_search_help` | 返回图源、筛选规则、排序方式。传 `tag_prefix` 可查 Konachan 的英文标签。 |
| `image_search` | 返回候选的作品 ID、评分、尺寸、标签和作品页。支持包含或排除标签、评分和尺寸下限、画幅，以及按最新、高分或分辨率排序。 |
| `image_send` | 使用搜索批次的 `search_id` 和候选作品 ID，下载并向当前 QQ 会话发送最多 5 张图片。 |

安装配套模块后，发「yande找图 初音未来的横图」即可使用 Yande.re。分两步选图时继续用同一图源的关键词，例如「yande找图 发第 2 张」。两路图源均只选择 API 标记为 Safe（`s`）的作品。Agent 根据元数据挑选，图片由模块下载并交给 QQ 网关。

## 许可

模块源码采用 [MIT 许可](LICENSE)。图片来自 Konachan，作品权利归各自权利人所有。
