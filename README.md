# 🐖 yunzai-plugin-rollpig 🐖

> 今天是什么小猪 - Yunzai-Bot 插件版本

## ✨ 特性

- **今日小猪**: 每天抽取属于你的小猪类型，重复抽到会"升级"（如【猪堡包】Lv.2）🐖
- **猪圈**: 查看个人猪猪图鉴与收集进度，支持 @他人 代查 🐖
- **随机小猪**: 从 PigHub 随机获取猪猪图 🐖
- **找猪**: 从 PigHub 模糊搜索猪猪图 🐖
- **Markdown回复**: 可选开启，官方QQBot 下按 Markdown 格式回复并附加按钮 🐖

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
├── package.json                # 包配置
├── README.md                   # 说明文档
├── config/
│   ├── config.default.yaml     # 默认配置（勿改）
│   └── config.yaml             # 用户配置（自动生成，可修改）
├── data/                       # 数据目录（自动生成）
│   └── records.json            # 用户记录（含每种猪猪的抽到次数）
└── resource/                   # 资源目录
    ├── pig.json                # 小猪信息
    ├── pen.html                # 猪圈图鉴渲染模板
    └── image/                  # 小猪图片
        └── *.png
```

## 🐷 新增小猪

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
