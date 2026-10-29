# RollPig Plus → Yunzai 插件移植方案

## 一、现状与结论

- 当前插件 `rollpig-plugin`：单文件 `index.js` + `lib/custom-store.js` + `lib/vlm.js`，129 只官方猪，`data/records.json` 只保存“最后一次抽取”和累计次数，没有群维度、没有历史快照、没有事件流；渲染走宿主 `puppeteer.screenshot` + art-template；宿主是 TRSS-Yunzai 3.1.3，每条消息都会重新实例化插件类，因此跨消息/定时任务状态必须放模块级或 `globalThis`。
- 参考插件 `nonebot-plugin-rollpig-plus`：165 只本地猪，Pillow 渲染，完整 EX 成长、昨日回顾、烤猪、预约/聚众、保护券、日报、AI 烤猪。数据模型以 `history / snapshots / collection / progress / group_rolls / events / usage / reservations / protections / report_deliveries` 为核心。
- 两套库：77 个相同 id，73 条文案完全一致，60 张图片字节一致；52 个仅当前库、88 个仅 plus 库；另有 17 个同 id 图片不同、4 个同 id 文案不同。
- plus 仓库本身没有 `pig_ex_variants.json`；官方资源包 `pig.felislab.cc` 有 24 只猪的 EX2/EX5 文案和 23 张 EX2 图，其中 22 只存在于本地库。
- 当前宿主 OneBotv11 适配器只打印 `group_msg_emoji_like` 日志、不转发给插件；QQBot 也没有表情回应。续火必须支持回复投票。
- 目标运行环境是 Linux 服务器，开发机是 Windows；所有路径、时区、字体、emoji 都要按 Linux 可复现处理。

## 二、已确认决策

1. **猪库合并**：同 id 一律保留现有条目、不覆盖；只新增 plus 独有 id，且“图片 MD5 + 名称/简述/分析”全部相同才跳过。最终数量由合并脚本打印。
2. **EX 差分**：引入官方差分包（`pig_ex_variants.json` + 23 张 EX2 图），过滤到合并后实际存在的 id；EX5 只有文案没有图，按“文案差分”生效。
3. **续火投票**：表情回应 + 回复「续火/投票/支持」双模式；能收到 reaction notice 就计票，否则统计回复投票消息的成员。
4. **Linux 渲染**：内置全部原版字体（思源黑体 16.5MB、三份宋体子集、ZCOOL 标题体）并额外内置 Noto Color Emoji 字体；用 `@font-face` + `file://` 绝对 URL，确保 Linux 无系统中文字体/emoji 时也能正确渲染。体积增加约 28MB，换取可复现的显示效果。

## 三、实施步骤

### 阶段 0：资源合并与资产落地

1. 新增 `tools/merge-official.mjs`（`.mjs` 不会被 loader 扫描）：
   - 读取当前 `resource/pig.json` 与 `../nonebot-plugin-rollpig-plus/.../resource/pig.json`。
   - 同 id 跳过；跨 id 时计算图片 MD5 + 文本指纹，完全一致才跳过。
   - 复制新增猪图片到 `resource/image/<id>.<ext>`；目标文件已存在且内容不同则报错，不静默覆盖。
   - 原子写回 `pig.json`，先备份 `pig.json.bak`；输出 `added/skipped` 明细。
   - 顺手修复 `astrnomer-pig` 的图片文件名拼写（保留 id 不变，避免旧记录失效）。
2. 新增 `tools/fetch-variants.mjs`：
   - 拉取官方 manifest、`pig_ex_variants.json`、`variant_images` 中所有 `_ex2` 图片。
   - 过滤到合并后存在的 id；EX5 若缺图则移除 `image` 字段但保留 `description/analysis`。
   - 写入 `resource/pig_ex_variants.json` 与 `resource/image/<id>_ex2.png`，带 SHA-256 校验。
3. 复制资源：
   - plus 的 `pig_rules.json`、`refill.jpg`。
   - `daily_report_card/*` → `resource/report/`（39 个文件）。
   - `yesterday_card/*` → `resource/yesterday/`（17 个文件，保留 `backgrounds/`、`decor/`）。
   - 字体 → `resource/fonts/`；下载 `NotoColorEmoji.ttf`。
   - 复制 `LICENSES/` 与 `THIRD_PARTY_NOTICES.md`，在 README 标注来源。
4. 新增 `tools/validate-assets.mjs`：
   - 校验 `pig.json` id 唯一、每只猪有图片、差分引用文件存在、报告/昨日资源与字体齐全。
5. 运行 `node tools/merge-official.mjs --dry-run` 先核对数量，再实际执行；把最终数量写入 README。

### 阶段 1：核心基础模块

1. `lib/app-config.js`：集中 `DEFAULT_CONFIG`、`readConfig()`、`saveConfig()`、`updateConfig()`；配置仍是顶层扁平 key，避免锅巴保存报错。
   - 新增：`aiRoastEnabled=false`、`roastCooldownHours=8`、`roastChargeMax=2`、`dailyReportDefault=false`。
   - `lib/vlm.js` 改为复用 `readConfig()`，不再各自读 YAML。
2. `lib/time.js`：固定 Asia/Shanghai（UTC+8），提供 `todayStr(offset)`、`dateParts()`、`nowIso()`、`reportCutoffIso()`、`latestReportQueryDate()`、`cronForShanghai(hour, minute)`。
   - 所有业务日期改为 `YYYY-MM-DD`；日报截止 23:45；查询窗口 00:10–23:44。
   - 定时任务按宿主本地时区换算上海时间生成 cron，Linux 用 UTC 也不会错点。
3. `lib/state.js`：单文件 `data/state.json` + 原子写 + 模块级互斥队列。
   - 首次启动自动迁移 `data/records.json`：`pigs` → `copies/collection`，`date/pig_id` → `history/snapshot`，保留旧文件不删。
   - 结构：`history`、`snapshots`、`group_rolls`、`group_active`、`collection`、`pig_progress`、`draw_state`、`daily_feeds`、`usage`、`force_usage`、`events`、`protected`、`protection_details`、`unrolled_attempts`、`reservations`、`refills`、`report_groups`、`report_deliveries`、`settlements`、`user_names`。
   - 损坏时尝试 `.bak`，保留 `.broken-<ts>`；写入失败抛可读错误，不静默丢数据。
4. `lib/pigs.js`：官方+自定义合并池、`expertLevel(copies, growthBonus)`、差分解析、图片探测、`pig_rules` 合并。
   - EX：`clamp(copies - 1 + growth_bonus, 0, 5)`。
   - 差分：从 1 到当前等级逐级覆盖 `image/description/analysis`；支持纯文案等级；自定义差分文件可覆盖。
   - 食物/人类/已吃掉/已售出集合 = plus `pig_rules.json` ∪ 当前库已有熟食 id（`pig-bun`、`pig-dumpling`、`pig-tamagoyaki`、`pig-bone-soup`、`porkchop-rice` 等）。
5. `lib/render.js`：统一 `puppeteer.screenshot` 调用，所有图片/字体用 `pathToFileURL`，`saveId` 唯一（date/gid/uid/时间戳），避免并发覆盖；兼容返回 `segment.image`、Buffer、路径三种情况。
6. 更新 `pen.html` 与 `renderPen`：按 EX 等级显示、按等级取差分图、统计只计当前合并池（修复现有“文本统计与图片统计不一致”）。

### 阶段 2：今日小猪 / 昨日 / 明日

1. `lib/daily-roll.js`：
   - 加权保底：未拥有猪权重 `1 + min(duplicate_streak*0.5, 4)`；新猪重置 streak，重复 +1。
   - `getOrCreateDailyRoll(userId, proposedPigId, date, {makeup})` 原子创建 `history + snapshot + progress + group_roll`。
   - 重复查看返回原猪，不再抽；记录存在但资源缺失时提示“已抽出但本机缺资源”，不重新随机。
   - 快照记录：`pig_id/is_new_pig/previous_copies/copies/previous_level/level/collection_size/is_makeup/created_at`。
   - 成长文案使用 plus 的新猪/重复升级/同等级/差分解锁四组文案，占位符保持一致。
2. 重写 `#今日小猪`：
   - 使用上海日期；群内记录 `group_rolls` 与 `group_active`。
   - 回复使用差分后的名称/文案/图片；标题在重复时显示 `EX Lv.N`。
   - 保留 Markdown/按钮逻辑；按钮增加 `#昨日小猪`、`#今日烤猪`（仅 QQBot）。
   - 目标用户抽猪后触发该用户待开炉预约的结算。
3. `#明日小猪`：43 条预测文案随机回复，无状态。
4. `#昨日小猪`：
   - `lib/yesterday.js` 1:1 移植 plus 的 `yesterday_recap.py`：事件归一化、角色 family、足迹/高光/小结/余波、跨群、稳定散列选句。
   - 无快照时自动补签：用同一保底权重抽昨天，`makeup=true`、不写群记录、不触发预约/保护；补签文案前缀。
   - `resource/yesterday.html`：720px 宽、粉梦背景、书本/装饰图、英雄图、角色句、结果句、统计带、高光/小结/余波/补签档案；标题 ZCOOL，正文思源黑体。
   - 昨日记录中的猪资源缺失时提示，不再伪造随机猪。

### 阶段 3：完整烤猪机制

1. `lib/roast/charges.js`：1:1 移植 token bucket。
   - `max_charges` 1–6，默认 2；`cooldown` 默认 8h，最小 60s；满格锚点归零；返回剩余秒数并格式化为“x小时x分/x分x秒”。
   - `force_usage` 每日一次；`强行点火` 仅 master。
2. `lib/roast/flow.js`：
   - 特殊形态：human/food/eaten/sold，自烤/指定烤/随机烤分别使用 plus 对应拦截文案池。
   - 目标解析：显式 @（多个 @ 报错）、回复目标、@Bot；@自己拦截；非群成员拦截。
   - 概率：成功 60 / 逃脱 30 / 反噬 10；加急/强行必中；反噬时攻击者不可烤则纯文字。
   - 未抽猪攻击：第一次警告，第二次起变成熟食反噬；每天每群每种特殊反噬只计一次保护次数。
   - 烤 Bot：纯文字反噬，不扣充能，记录 `bot_backfire`。
   - 随机烤：从本群今日已抽猪且仍在群的成员中排除攻击者/Bot 后随机。
3. `lib/roast/text.js` + `lib/ai-roast.js`：
   - 移植 `texts.py` 中全部烤猪/反噬/逃脱/续火/预约/加餐/保护文案，占位符不变。
   - AI 烤猪复用 `vlmApiUrl/vlmApiKey/vlmModel`，只受 `aiRoastEnabled` 控制；管理面板 AI 生成文案不受影响。
   - 移植 PvP/PvE prompt、`origin_feature` 提取、240 字截断、20s 超时、并发 4、失败回退本地池。
   - 本地 `data/roast-library.json` 保存 AI 生成文案，按 `origin|food|pvp` 分组，软目标 5 条；不做远程共享文案同步。
4. `lib/roast/events.js`：事件记录与统计。
   - 字段：`event_id/date/created_at/type/attacker/target/names/food/group_id/reservation_id/participant_ids/participant_names/participant_count/backfire_victim_id(s)/special_reason/force_mode`。
   - 移植 `roast_statistics.py`：success 计目标、backfire 计实际受害者、bot_backfire/unrolled 同群同日同人同种只计一次。
5. `lib/roast/protection.js`：
   - 23:45 结算次日保护：每个活跃群取被烤次数最多且 ≥2 的人；平票按事件首次出现。
   - 首日 Lv.3；连续受保护每日 +1，最高 Lv.5；当日被成功烤成时保护等级 +1（最高 5，不继承到次日）。
   - 保护只影响本群；关闭日报推送也照常结算；写 `settlements` 幂等标记，失败可重试。
   - 保护期内普通烤猪转入聚众预约；加急贡献 2 点，普通 1 点；门槛 Lv.1–5 = 2/3/4/5/6 火力。
6. `lib/roast/reservations.js`：
   - 单进程本地状态机：`pending → ready → completed`；目标抽猪后激活；达标立即结算，另有 60s 轮询兜底。
   - 预约通知保存 message_id；回复「加入/加入预约/加入烤猪」加入；也支持继续 `烤群友 @目标` 加入。
   - 最多 12 人；主厨消耗充能/加急，加入免费；加急可把 1 点贡献升到 2 点并消耗当日加急次数。
   - 结果快照只算一次；多人反噬随机 1–N 人并固定名单；一张卡 + 图外完整名单。
   - 加餐：普通成功/普通参与者（贡献 1）当日一次，`growth_bonus + 1`；EX5 静默不占机会；加急/强行/自烤/逃脱/反噬不触发。
   - `强行点火` 可突破保护或接管 pending 预约；原普通参与者保留加餐资格，执行者不占名额、不领加餐。
7. `lib/roast/refill.js`：
   - `烤箱续火`：本群今日活跃 ≥3、发起人活跃、单群同时一轮、10 分钟。
   - 门槛 25/35/45/55% 活跃人数，封顶 8/12/16/20，最低 2 票；群主/管理员 2 票，普通 1 票；至少 2 名不同投票人。
   - 投票消息附 `refill.jpg`，提示“表情回应或回复「续火」”；reaction notice 可用则计票，否则回复计票。
   - 成功把本群今日活跃用户的普通充能回满；不恢复加急次数。

### 阶段 4：猪圈日报

1. `lib/report/build.js`：1:1 移植 `daily_report.py`。
   - 数据：群今日抽猪（截止 23:45）、事件、活跃用户、Bot 排除、成员昵称、每人今日猪/EX/图鉴数/最近猪。
   - 概览：小猪数量、普通烤猪、第三指标（预约/逃脱/翻车/种类）；见闻优先级与阈值；头条评分/标签；事件追踪 mutual/personal_turn/reservation_followup/repeat_target；名人堂三榜与并列排序。
   - 文本池全部来自 `texts.py`，占位符一致；名字/数字用富文本 span 高亮。
2. `resource/report.html`：
   - 1024px 逻辑宽、动态高度、报纸版式：报头（猪读报 + 猪圈日报 + 日期/星期）、今日猪圈统计带、猪圈见闻、今日头条、事件追踪、猪圈名人堂、次日保护券、页脚“数据截止 23:45”。
   - 使用 `resource/report/` 39 个素材；纸纹背景、红/黑油墨、图标、条码全部保留；标题用宋体子集，正文思源黑体，emoji 用内置 Noto Color Emoji。
   - `{{@html}}` 输出富文本；所有用户输入先转义。
3. `lib/report/job.js`：
   - 23:45 上海时间触发，随机延迟 0–600s，数据截止固定 23:45；先结算所有活跃群保护（与推送并行），再推送开启日报的群。
   - 只推“今日有活动 + 群日报开启 + Bot 在群”的群；图片单发，无文字说明。
   - 失败每 30s 重试至次日 00:10；`report_deliveries` 记录 sent/skipped/failed/sending/uncertain，重启后防重。
   - 启动恢复：仅在 23:45–00:10 窗口内补跑；`*/5 23,0 * * *` 轻量检查。
4. `#猪圈日报`：
   - 23:45–00:09 提示“本期日报正在出刊，00:10 后再来翻报纸”；其余时间只读重建昨日封版卡。
   - 同群同日 5 分钟内存缓存；无活动提示休刊；保护未确认时隐藏保护券并追加提示。
5. `小猪日报 开启/关闭/状态 [群号]`（别名 `每日总结设置`、`rollpig日报`）：
   - 群主/管理员可改本群；master 可指定任意群；默认全局关闭（`dailyReportDefault=false`），单群覆盖。
   - 关闭推送不影响主动查卡，也不影响保护结算。

### 阶段 5：命令、配置、面板、文档

1. `index.js` 规则新增：
   - `#明日小猪`、`#昨日小猪`、`#今日烤猪`
   - `#烤群友` / `#加急生火` / `#强行点火`（支持 @目标、回复目标、`@目标 烤群友`）
   - `#随机烤群友`（别名 `随机烤猪`、`抽个群友烤了`）
   - `#加入` / `#加入预约` / `#加入烤猪`（仅回复预约通知时生效，否则放行）
   - `#烤箱续火`（别名沿用 plus）
   - `#续火` / `#投票` / `#支持`（仅回复投票消息时计票）
   - `#猪圈日报`
   - `#小猪日报 ...`
   - 保留现有 `#今日小猪`、`#随机小猪`、`#找猪`、`#猪圈`、`#猪猪设置markdown`。
2. `this.task` 改为数组：PigHub 刷新、日报、预约/续火轮询（每分钟，仅在有 pending 时工作）、数据清理（03:30 上海时间）。把 `pigCache` 移到 `globalThis`，修复现有定时刷新与消息实例不共享缓存的问题。
3. `guoba.support.js` 新增：
   - `aiRoastEnabled` Switch（“AI 烤猪，复用下方 VLM 配置，不影响面板 AI 文案”）
   - `roastCooldownHours`、`roastChargeMax`
   - `dailyReportDefault` Switch
   - 保留现有 VLM 三项；`getConfigData/setConfigData` 支持布尔/数字类型，避免全部被字符串化。
4. 管理面板：VLM 配置仍由锅巴维护；`/rollpig/pigs` 返回 `aiRoastEnabled`，面板显示状态标签即可，不改变现有 AI 生成文案流程。
5. `README.md`：更新特性、命令表、配置表、数据文件说明、迁移说明、Linux 字体/emoji 说明、素材来源与许可证、日报默认关闭和单群开启方式。
6. `package.json` 版本升到 2.0.0。

## 四、数据与兼容

- `data/records.json` 只读保留；首次运行迁移到 `data/state.json`，旧用户次数 → `copies`，最后一天记录 → `history/snapshot`；`duplicate_streak` 从 0 开始。
- 图鉴进度按 id 不变；EX 显示改为 `EX Lv.0–5`（第一次抽到 EX0，原 Lv.1 对应 EX0）。`#猪圈` 角标改为 EX。
- 抽猪仍是“每用户每天一次、跨群全局”；群记录只用于日报/随机烤/保护，不改变抽猪次数。
- 旧记录里的猪若已从库中删除，按 plus 语义提示缺资源，不再当天重复抽。
- 不实现 Cloud/多实例同步、远程共享烤猪文案、远程资源自动同步、`小猪图鉴` 图片版、`本周小猪`、`小猪投稿`（不在本次需求内）；这些可在后续单独加。

## 五、验证

1. `node --check` 所有 JS；`node tools/validate-assets.mjs` 校验猪库、差分、报告/昨日素材、字体。
2. 新增纯函数单测（`node --test tests/*.test.mjs`）：上海日期/cron、EX 钳制、稀疏差分、token bucket、保护计数、日报指标/见闻/头条选择、合并去重。
3. `tools/render-preview.mjs`：用宿主渲染器渲染一份完整日报和一份昨日卡到 `temp/preview-*.png`，对照 plus 的 `docs/assets/preview-daily.jpg`、`preview-yesterday-custom-font.png` 检查版式；同时验证 Linux 字体/emoji 的 `@font-face` 路径。
4. 不自动重启 Bot；完成后由你在 Linux 服务器重启加载，重点验证：今日/昨日/明日、重复保底、差分升级、烤群友/预约/聚众/续火、日报推送与单群开关。

## 六、主要风险与处理

- **日报版式偏差**：HTML/CSS 逐段对照原图，使用同一套 1024px 逻辑尺寸、素材、字体；用预览脚本迭代。
- **Linux 字体/emoji 缺失**：全部字体内置，`font-display: block`，渲染前等 `networkidle`；若服务器 Chromium 缺 emoji 支持，内置 Noto Color Emoji 兜底。
- **状态并发**：模块级互斥 + 原子 rename；任务与消息实例共享模块状态，不使用 `this.xxx`。
- **预约/保护边界**：结果快照固定、结算幂等、失败重试；先跑单测再联调。
- **AI 接口不可用**：只影响文案，自动回退本地文案池；不改变概率和结果。
- **素材体积**：约增加 28MB 字体 + 约 10MB 猪图/差分/卡片素材；已在 Linux 可复现性上取舍。