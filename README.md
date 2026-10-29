# 🐖 yunzai-plugin-rollpig 🐖

> 今天是什么小猪 - Yunzai-Bot 插件（RollPig Plus 移植版）

## ✨ 特性

- **今日小猪**：每天抽取专属小猪；重复抽取累积 EX Lv.0–5，连续重复会提高新猪权重（软保底）
- **EX 差分**：达到 EX 等级自动切换专属立绘与文案（随插件内置官方 EX 差分资源）
- **昨日小猪**：昨日回顾卡（足迹 / 高光 / 小结 / 今日余波）；昨天漏抽会自动免费补签
- **明日小猪**：随机预测文案
- **完整烤猪**：今日烤猪、烤群友、随机烤群友、加急生火、强行点火、未抽猪惩罚、反噬、每日加餐
- **预约 / 聚众烤猪**：目标未抽猪或受保护时自动建预约；回复通知发送「加入」即可添柴；保护目标需要凑够火力
- **烤箱续火**：10 分钟群体投票回满本群活跃玩家的普通烤猪次数；支持表情回应与回复「续火」双模式
- **猪圈日报**：每天 23:45（上海时间）生成报纸版式长图，含见闻、头条、事件追踪、名人堂、次日保护券；默认关闭推送，群主/管理员可单群开启
- **PigHub**：随机小猪 / 找猪
- **管理面板**：QWA / 锅巴双宿主；浏览、上传图片、查重、AI 生成文案
- **AI 烤猪**：复用锅巴 VLM 配置，独立开关；失败自动回退本地文案，不影响面板 AI 文案

## 📦 安装

1. 将本插件放入 `Yunzai-Bot/plugins/rollpig-plugin`
2. 在 Yunzai 根目录执行 `pnpm i`（本插件不新增 npm 依赖）
3. 重启 Bot

Linux 服务器建议安装中文字体/Chromium 依赖；本插件已内置中文字体与 Noto Color Emoji，不依赖系统字体也能正常渲染日报和昨日卡。

## 🕹️ 命令

| 命令 | 说明 |
| --- | --- |
| `#今日小猪` / `#今天是什么小猪` / `#猪来` | 抽取或查看今日小猪（每天一次，跨群全局） |
| `#昨日小猪` | 查看昨日回顾；昨天未抽会自动补签 |
| `#明日小猪` | 明日预测 |
| `#猪圈` / `#猪猪图鉴` / `#我的猪圈` | 个人猪圈长图（支持 `@某人` 代查） |
| `#随机小猪 [1-20]` | PigHub 随机图片 |
| `#找猪 关键词` / `#搜猪 关键词` | PigHub 搜索 |
| `#今日烤猪` | 把自己的今日小猪做成料理 |
| `#烤群友 @目标` / 回复目标发送 `#烤群友` | 普通烤群友；60% 成功 / 30% 逃脱 / 10% 反噬 |
| `#加急生火 @目标` | 每日一次；普通目标必中，保护目标贡献 2 点火力 |
| `#强行点火 @目标` | 仅 Bot 主人；无视保护/接管预约 |
| `#随机烤群友` / `#随机烤猪` / `#抽个群友烤了` | 从本群今日已抽猪成员中随机开烤 |
| 回复预约通知发送 `#加入` / `#加入预约` / `#加入烤猪` | 加入预约；最多 12 人 |
| `#烤箱续火` | 发起 10 分钟续火投票；回复投票消息发送 `#续火` 也可计票 |
| `#猪圈日报` | 查看本群最近一期封版日报（00:10–23:44） |
| `#小猪日报 开启/关闭/状态 [群号]` | 群主/管理员控制本群日报推送；主人可指定群号 |
| `#猪猪设置markdown开启/关闭` | 主人切换官方 QQBot 的 Markdown 回复 |

### 烤猪规则摘要

- 普通烤群友默认 2 次充能，每 8 小时恢复 1 次；可在锅巴调整
- 目标已抽猪且未受保护 → 立即结算；目标未抽猪或受保护 → 预约/聚众烤猪
- 前一天在本群被烤次数最多且 ≥2 的人获得次日保护券：首日 Lv.3，连续受保护每日 +1，最高 Lv.5
- 保护 Lv.1–5 分别需要 2/3/4/5/6 点火力；普通参与 1 点，加急 2 点
- 每天第一次普通烤猪成功（或作为普通参与者预约成功）可让今日小猪加餐成长 1 级；EX5 静默且不占机会
- 未抽猪就烤群友：第一次警告，第二次起自己变成熟食并计入被烤次数

### 日报说明

- 定时推送默认**全局关闭**；群主/管理员在群内发送 `#小猪日报 开启` 单独开启
- 23:45 截止数据并开始出刊（随机延迟 0–10 分钟），失败重试到次日 00:10
- 关闭推送不影响保护结算，也不影响群友主动发送 `#猪圈日报` 查卡

## ⚙️ 配置

配置文件：`config/config.yaml`（首次运行从 `config.default.yaml` 复制）；也可在锅巴「今天是什么小猪」配置页修改。

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `markdown` | `false` | 官方 QQBot Markdown 回复 |
| `vlmApiUrl` | `''` | OpenAI 兼容接口地址，如 `https://api.example.com/v1` |
| `vlmApiKey` | `''` | API Key |
| `vlmModel` | `''` | 面板 VLM / AI 烤猪共用的模型名 |
| `aiRoastEnabled` | `false` | AI 烤猪独立开关；复用上方三项 VLM 配置 |
| `roastCooldownHours` | `8` | 普通烤猪每多少小时恢复 1 次 |
| `roastChargeMax` | `2` | 普通烤猪最大充能（1–6） |
| `dailyReportDefault` | `false` | 日报全局默认开关；单群设置优先 |

## 🐷 自定义图鉴

- 扩展包：`resource/custom/*.json`，格式与 `pig.json` 相同的数组
- 图片：`resource/custom/image/{id}.{png|jpg|jpeg|gif|webp}`
- 自定义差分：`resource/custom/pig_ex_variants.json`（同官方 schema，可覆盖/扩展）
- 同 id 覆盖显示字段，收集进度按 id 保留；新 id 追加进抽取池
- 管理面板（QWA）支持浏览、搜索、分片上传、MD5/名称/id 查重与 AI 生成文案

## 💾 数据

- `data/state.json`：所有玩法状态（抽取历史、快照、图鉴、群记录、事件、充能、预约、保护、日报投递）
- `data/records.json`：旧版记录；首次启动自动迁移到 `state.json`，旧文件保留不删
- `data/roast-library.json`：AI 烤猪本地文案库
- `data/state.json.bak`：最多每小时备份一次；损坏时自动尝试恢复
- `data/` 已被 gitignore

数据保留：抽取历史/快照/群记录 14 天，烤猪事件 7 天；图鉴收集永久保留。

## 📂 目录结构

```
rollpig-plugin/
├── index.js                    # 插件入口、命令注册、定时任务
├── guoba.support.js            # 锅巴配置页
├── lib/
│   ├── app-config.js           # 配置读写与类型归一化
│   ├── time.js                 # Asia/Shanghai 日期与 cron
│   ├── state.js                # state.json 原子存储/迁移/清理
│   ├── pigs.js                 # 猪库/EX/差分/烤猪形态
│   ├── daily.js                # 抽取/保底/快照/补签
│   ├── yesterday.js            # 昨日回顾业务
│   ├── yesterday-render.js     # 昨日卡渲染
│   ├── texts.js                # 文案池读取/稳定选句
│   ├── render.js               # 宿主渲染器/字体/素材 URL
│   ├── ai-roast.js             # AI 烤猪（复用 VLM 配置）
│   ├── roast/                  # 充能、烤猪结果、事件、保护、预约、续火
│   ├── report/                 # 日报装配、视图、渲染、定时任务
│   └── commands/               # 命令层
├── resource/
│   ├── pig.json                # 官方猪库（217 只）
│   ├── pig_rules.json          # 熟食/人类/已吃掉/已售出
│   ├── pig_ex_variants.json    # EX 差分文案
│   ├── image/                  # 猪猪图片 + EX2 差分图
│   ├── report/                 # 日报报纸素材
│   ├── yesterday/              # 昨日卡素材
│   ├── fonts/                  # 思源黑体/宋体子集/ZCOOL/Emoji
│   ├── report.html / yesterday.html / pen.html
│   └── refill.jpg
├── tools/                      # 一次性合并/下载/校验/预览/烟雾测试
├── config/
└── data/                       # 运行时生成（gitignore）
```

## 🧰 维护工具

```bash
# 合并 plus 本地猪库（同 id 跳过；跨 id 完全重复跳过）
node tools/merge-official.mjs --dry-run
node tools/merge-official.mjs

# 拉取官方 EX 差分（过滤到当前猪库）
node tools/fetch-variants.mjs

# 下载 Noto Color Emoji 分片
node tools/fetch-emoji-font.mjs

# 校验猪库/差分/素材/字体
node tools/validate-assets.mjs

# 生成日报/昨日卡预览
node tools/render-preview.mjs

# 本地烟雾测试（使用独立的 .smoke-data/，不会碰生产 data/）
node tools/smoke.mjs
node tools/command-smoke.mjs
node tools/report-job-smoke.mjs
```

## 📜 素材与许可

- 玩法与文案移植自 [nonebot-plugin-rollpig-plus](https://github.com/Felis2026/nonebot-plugin-rollpig-plus)（MIT）
- EX 差分与部分猪图来自 [rollpig-resources](https://github.com/Felis2026/rollpig-resources)
- 思源黑体、Noto Serif SC 子集、ZCOOL 快乐体、Noto Color Emoji 均按 OFL/Apache 许可使用；详见 `LICENSES/` 与 `THIRD_PARTY_NOTICES.md`

## ⚠️ 说明

- 抽猪是「每用户每天一次、跨群全局」；群记录只用于日报、随机烤猪和保护
- 业务日期固定按 Asia/Shanghai（UTC+8），Linux 用 UTC 时区也不会错点
- 当前版本为单进程本地存储，不包含 Cloud 多实例同步、远程共享烤猪文案、远端资源自动同步
