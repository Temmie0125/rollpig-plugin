# 🐖 yunzai-plugin-rollpig 🐖

> 今天是什么小猪 - Yunzai-Bot 插件版本

## ✨ 特性

- **今日小猪**: 每天抽取属于你的小猪类型，重复抽到会"升级"（如【猪堡包】Lv.2）🐖
- **猪圈**: 查看个人猪猪图鉴与收集进度，支持 @他人 代查 🐖
- **随机小猪**: 从 PigHub 随机获取猪猪图 🐖
- **找猪**: 从 PigHub 模糊搜索猪猪图 🐖
- **Markdown回复**: 可选开启，官方QQBot 下按 Markdown 格式回复并附加按钮 🐖
- **自定义图鉴**: 将扩展数据丢进 `resource/custom/` 即可扩展本地猪猪图鉴（新增猪猪进入抽取池；与官方 id 冲突时仅覆盖显示，不影响收集进度）🐖
- **管理面板**: QWA / 锅巴 双宿主可视化面板，上传图片与文案、重复性校验、AI 生成文案 🐖

## 📦 安装

### 方法一：直接下载
将插件文件夹放入 Yunzai-Bot 的 `plugins` 目录下

```bash
cd Yunzai-Bot/plugins
git clone https://github.com/ZuBeri05/rollpig-plugin.git
```

### 方法二：手动安装
1. 下载本插件
2. 解压到 `Yunzai-Bot/plugins/` 目录
3. 重启 Yunzai-Bot

## 🕹️ 使用方法

```
#今日小猪 - 抽取今天属于你的小猪（每天一次，重复抽到同一只可升级）
#猪圈 - 查看自己的猪猪图鉴与收集进度（别名：#猪猪图鉴、#我的图鉴）
#猪圈 @某人 - 查看他人的猪猪图鉴（QQ群内可用，频道内不支持代查）
#随机小猪 [数量] - 从PigHub随机获取猪猪图（数量1-20，默认1）
#找猪 [关键词] - 根据关键词查找猪猪
#猪猪设置markdown开启/关闭 - 管理员切换Markdown回复
```

### 使用示例

```
#今日小猪
#猪圈
#猪圈 @群友
#随机小猪 5
#找猪 黑猪
#搜猪 水晶
```

### 🏆 收集与升级

- 每天首次 `#今日小猪` 会随机抽取一只猪猪，并记入你的猪圈
- 抽到重复的猪猪会"升级"：第 1 次抽到为 Lv.1，第 2 次为 Lv.2……以此类推
- `#猪圈` 可查看全部猪猪的解锁状态（Lv 角标）与收集进度百分比

## 📂 目录结构

```
yunzai-plugin-rollpig/
├── index.js                    # 插件主文件
├── guoba.support.js            # 锅巴配置页（Markdown 开关 + VLM 配置）
├── package.json                # 包配置
├── README.md                   # 说明文档
├── lib/
│   ├── custom-store.js         # 自定义图鉴存储/合并/查重
│   └── vlm.js                  # VLM 文案生成（OpenAI 兼容）
├── webadapter/
│   ├── index.js                # 管理面板 API（QWA + 锅巴双宿主）
│   └── panel.html              # 管理面板页面
├── config/
│   ├── config.default.yaml     # 默认配置（勿改）
│   └── config.yaml             # 用户配置（自动生成，可修改）
├── data/                       # 数据目录（自动生成）
│   └── records.json            # 用户记录（含每种猪猪的抽到次数）
└── resource/                   # 资源目录
    ├── pig.json                # 官方小猪信息
    ├── pen.html                # 猪圈图鉴渲染模板
    ├── image/                  # 官方小猪图片
    │   └── *.{png,jpg,...}
    └── custom/                 # 自定义图鉴目录（gitignore，可整目录分发）
        ├── *.json              # 扩展包（任意命名，丢入即读）
        ├── custom-pigs.json    # 面板写入的条目（同 id 时优先于扩展包）
        └── image/              # 自定义猪猪图片
            └── {id}.{扩展名}
```

## 🐷 自定义图鉴扩展

把扩展数据放进 `resource/custom/` 即可，无需改任何代码，保存后自动生效：

- **扩展包**：`resource/custom/` 下任意 `*.json`，格式与 `pig.json` 相同的数组：
  ```json
  [
    { "id": "my-pig", "name": "我的猪猪", "description": "一句话简述", "analysis": "第二人称人格分析" }
  ]
  ```
- **图片**：放到 `resource/custom/image/`，文件名为 `{id}.{扩展名}`（png/jpg/jpeg/gif/webp）
- **合并规则**：
  - id 与官方相同 → 仅覆盖显示（名称/文案/图片），收集进度按 id 记录不受影响
  - id 是新的 → 追加进图鉴并进入「今日小猪」抽取池，收集率分母随之扩大
  - 多个 json 同 id 时按文件名顺序后者覆盖前者；面板的 `custom-pigs.json` 最后合并、优先级最高
- 冲突只影响显示，不影响图鉴收集进度

## 🖥️ 管理面板

安装 [QQBot-Web-Adapter](https://github.com/Temmie0125/QQBot-Web-Adapter) 或锅巴（Guoba）后自动出现「🐷 猪猪图鉴管理」页面，两个宿主共用同一份页面：

- 可视化浏览全部官方 + 自定义猪猪（来源徽标、无图标记、重复提示角标），顶部统计标签可点击筛选，支持搜索
- 官方条目为只读详情，防误改；新建/编辑猪猪：分片上传图片（≤20MB）、填写文案；保存同 id 条目即覆盖其显示
- 重复性校验：提交时检查 **图片 MD5 / 名称 / id** 三类重复并列出明细，确认后可选择覆盖保存（不强制拒绝）
- 删除面板条目：覆盖型条目删除后自动恢复官方显示（扩展包条目请直接删除对应 json）
- ✨ AI 生成文案：根据名称、图片与可选备注，自动生成 description 与 analysis（需先在锅巴配置页填写 VLM 配置）

## 🐷 新增小猪（改官方库）

### 1. 编辑 pig.json

在 `resource/pig.json` 中添加小猪信息：

```json
{
  "id": "your-pig-id",
  "name": "你的小猪名字",
  "description": "简短描述",
  "analysis": "详细分析"
}
```

### 2. 添加图片

将对应图片放到 `resource/image/` 目录，文件名为 `{id}.{扩展名}`

支持的图片格式：`png`, `jpg`, `jpeg`, `gif`, `webp`

## ⚙️ 配置说明

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `markdown` | `false` | **Markdown回复**：开启后「今日小猪」「猪圈」按官方QQBot支持的Markdown方式回复 |
| `vlmApiUrl` | 空 | **VLM API 地址**：OpenAI 兼容接口（如 `https://api.example.com/v1`），供面板 AI 生成文案 |
| `vlmApiKey` | 空 | **VLM API Key** |
| `vlmModel` | 空 | **VLM 视觉模型**：需支持图片输入（如 `qwen-vl-plus` / `gpt-4o-mini`） |

- 三项 VLM 字段也可在锅巴「今天是什么小猪」配置页填写，保存后面板「✨ AI生成文案」即刻可用

- 开启 Markdown回复 后，「今日小猪」的回复格式为：**@用户 → 第几次抽到提示 → 猪猪图片 → 名称 → 简述 → 详细描述（引用注释块）→ 按钮（👑猪圈 / 🐷今日猪猪）**；「猪圈」的回复格式为：**【@用户 的猪圈】→ 📦已收集 → ⭐收集率 → 🐷本命猪（抽到次数最多的猪猪）→ 图鉴图片 → 按钮（🐷今日猪猪 / 📖我的图鉴）**
- 仅官方QQBot适配器（QQ群/QQ私聊/QQ频道）生效；其他平台自动回退为普通图片回复
- 修改 `config/config.yaml` 后立即生效，或由管理员发送 `#猪猪设置markdown开启` / `#猪猪设置markdown关闭` 快捷切换
- 每日 0 点自动刷新 PigHub 数据（仅内存缓存，不会写入本地图鉴库与用户记录；「随机小猪」「找猪」获取的 PigHub 猪猪不参与猪圈收集）
- 用户每天只能抽取一次今日小猪
- 随机小猪和找猪功能从 PigHub API 获取数据
- 猪圈图鉴布局根据本地猪猪数量自适应（4~14 列、画布宽度与标题字号联动），扩充 `pig.json` 后无需调整模板

### 记录格式（data/records.json）

```json
{
  "用户ID": {
    "date": "2026/10/21",
    "pig_id": "pig-bun",
    "pigs": { "pig-bun": 2, "pig": 1 },
    "total": 3
  }
}
```

旧版记录（仅 `pig_id` + `date`）会在加载时自动迁移。

## 🙏 鸣谢

- [Yunzai-Bot](https://github.com/yoimiya-kokomi/Miao-Yunzait)
- [PigHub](https://pighub.top/)
- 原 NoneBot 插件：[nonebot-plugin-rollpig](https://github.com/Bearlele/nonebot-plugin-rollpig)
