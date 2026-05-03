# 🐖 yunzai-plugin-rollpig 🐖

> 今天是什么小猪 - Yunzai-Bot 插件版本

## ✨ 特性

- **今日小猪**: 抽取今天属于你的小猪类型 🐖
- **随机小猪**: 从 PigHub 随机获取猪猪图 🐖  
- **找猪**: 从 PigHub 模糊搜索猪猪图 🐖

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
#今日小猪 - 抽取今天属于你的小猪
#随机小猪 [数量] - 从PigHub随机获取猪猪图（数量1-20，默认1）
#找猪 [关键词] - 根据关键词查找猪猪
```

### 使用示例

```
#今日小猪
#随机小猪
#随机小猪 5
#找猪 黑猪
#搜猪 水晶
```

## 📂 目录结构

```
yunzai-plugin-rollpig/
├── index.js           # 插件主文件
├── package.json       # 包配置
├── README.md          # 说明文档
├── data/              # 数据目录（自动生成）
│   └── records.json   # 用户记录
└── resource/          # 资源目录
    ├── pig.json       # 小猪信息
    └── image/         # 小猪图片
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

- 每日 0 点自动刷新 PigHub 数据
- 用户每天只能抽取一次今日小猪
- 随机小猪和找猪功能从 PigHub API 获取数据

## 🙏 鸣谢

- [Yunzai-Bot](https://github.com/yoimiya-kokomi/Miao-Yunzait)
- [PigHub](https://pighub.top/)
- 原 NoneBot 插件：[nonebot-plugin-rollpig](https://github.com/Bearlele/nonebot-plugin-rollpig)


