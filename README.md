# RyuriHime 的个人站

[在线访问](https://ryurihime.github.io) · [RSS](https://ryurihime.github.io/atom.xml)

RyuriHime 的个人博客，用于记录随笔、题解、学习笔记和归档内容。站点由 Hexo 生成，通过 GitHub Actions 自动部署到 GitHub Pages。

## 功能

- Markdown 写作，支持 LaTeX 公式、代码高亮、目录和文章搜索
- 首页文章流、归档、分类、标签、关于页、RSS 和 Sitemap
- 响应式布局，适配桌面端和移动端
- 本地写作后台，提供接近 Typora 的即时渲染体验
- 全站卡片不透明度调节，默认 90%

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 静态站点 | Hexo 8 |
| 主题 | Butterfly 5.7 |
| 构建工具 | Node.js 22、pnpm 11 |
| 本地脚本 | Python 3.12 |
| 部署 | GitHub Pages、GitHub Actions |

## 环境要求

- Node.js 22 或更高版本
- pnpm 11 或更高版本
- Python 3.12 或更高版本
- Python 包：`Pillow`、`PyYAML`

## 本地开发

```powershell
git clone https://github.com/RyuriHime/RyuriHime.github.io.git
cd RyuriHime.github.io
pnpm install
python -m pip install pillow pyyaml
pnpm run build
pnpm run preview
```

本地预览地址：<http://127.0.0.1:4000>

### 写作后台

```powershell
pnpm run admin
```

启动后可以访问：

- <http://127.0.0.1:4000>：站点预览
- <http://127.0.0.1:4010>：写作后台

后台使用 Vditor 的即时渲染模式编辑文章、页面配置和关于页资料，保存后可重新构建站点。后台是本地写作工具，不参与静态站点发布。

## 写作

文章存放在 `source/_posts`，使用 Markdown 编写。Front Matter 示例：

```markdown
---
title: 文章标题
date: '2026-11-19 12:00:00'
categories:
  - 学习笔记
tags:
  - 算法
description: 文章摘要
mathjax: true
toc: true
---

正文从这里开始。
```

## 配置

- `_config.yml`：站点名称、URL、永久链接、文章列表、RSS、搜索和 Sitemap
- `_config.butterfly.yml`：主题、导航栏、侧栏和第三方资源
- `source/_data/profile.yml`：关于页的头像、简介和联系方式
- `scripts/`：构建时执行的 Hexo 脚本

## 项目结构

```text
.
├── .github/workflows/pages.yml   # GitHub Pages 部署流程
├── _config.yml                   # Hexo 配置
├── _config.butterfly.yml         # 主题配置
├── scripts/                      # 构建脚本
├── source/
│   ├── _posts/                   # 文章
│   ├── _data/profile.yml         # 关于页资料
│   ├── css/                      # 自定义样式
│   ├── js/                       # 页面交互
│   └── images/                   # 站点图片
├── tools/                        # 写作后台与构建工具
├── package.json
└── README.md
```

## 私有素材

站内部分壁纸属于个人购买素材，原始文件和构建中间文件不纳入版本控制。公开仓库只保留站点运行所需内容；缺少私有素材时，构建会使用公开占位图。

## 部署

推送到 `main` 分支后，`.github/workflows/pages.yml` 会自动构建并部署。

首次部署时，在仓库的 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions**。

部署前可在本地执行：

```powershell
pnpm run clean
pnpm run build
```

站点地址：<https://ryurihime.github.io>

## 内容说明

早期文章从博客园迁移，原永久链接保留为 `/p/<id>/`。文章版权归作者所有；第三方依赖遵循各自的开源许可证。
