[English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

> 本文档翻译自英文 README。部分表述可能不够自然。

<p align="center">
  <img src="./docs/logo.jpg" alt="omm logo" width="80"/>
</p>

<h1 align="center">Oh-my-mermaid</h1>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

<p align="center">
  AI 几秒钟就能写出代码。人类理解它需要几个小时。<br/>
  跳过理解，代码库就变成了黑盒 — 即使对你自己而言。<br/><br/>
  <strong>omm 弥合了这个差距 — 由 AI 生成的、为人类准备的架构文档。</strong>
</p>

---

## 快速开始

需要 Node.js 18 或更高版本以及 Git。

**1. 安装 CLI 并注册技能。** 在终端中粘贴：

```bash
npm install -g github:al-kheder/omm && omm setup
```

使用 npm 12 或更高版本时，请在安装命令中加上 `--allow-git=all`，因为 npm 12 默认阻止从 GitHub 安装。

`omm setup` 会为找到的每个 AI 工具注册技能（见[支持的 AI 工具](#支持的-ai-工具)）。只有安装了 `claude` 命令时才能找到 Claude Code。如果你只使用 VS Code 扩展或桌面应用，请在 Claude Code 中添加插件：

```
/plugin marketplace add al-kheder/omm
/plugin install oh-my-mermaid@al-kheder-omm
```

**2. 扫描代码库。** 在项目中打开 AI 编码工具并运行：

```
/omm-scan
```

在 Claude Code 中，该技能显示为 `/oh-my-mermaid:omm-scan`。扫描结果写入项目的 `.omm/` 目录。

**3. 查看结果。** 在项目文件夹中运行：

```bash
omm view
```

然后打开 http://localhost:3000。使用 `--port <n>` 指定其他端口。查看器只接受来自本机的连接，并在 `.omm/` 变化时实时更新。工具栏中的 **clean** 可隐藏文件路径，**svg** / **png** 可下载所选图表，例如放进给客户的幻灯片中。**mono | color** 可在黑白显示和按元素类型（开始/结束、判断、数据存储等）着色的显示之间切换。

## 示例

> omm 扫描了自己。这是它发现的结果。

<table><tr>
<td width="50%"><img src="./docs/screenshot.png" alt="omm viewer"/></td>
<td width="50%"><img src="./docs/demo.gif" alt="omm scan demo"/></td>
</tr></table>

## 工作原理

AI 分析代码库并生成 **视角（perspective）** — 观察架构的不同镜头（结构、数据流、外部集成等）。每个视角包含 Mermaid 图表和文档字段。

每个节点都会被**递归分析**。复杂的节点会成为具有自己图表的嵌套子元素。简单的节点保持为叶子节点。文件系统直接反映树结构：

```
.omm/
├── overall-architecture/           ← 视角
│   ├── description.md
│   ├── diagram.mmd
│   ├── context.md
│   ├── main-process/               ← 嵌套元素
│   │   ├── description.md
│   │   ├── diagram.mmd
│   │   └── auth-service/           ← 更深层嵌套
│   │       └── ...
│   └── renderer/
│       └── ...
├── data-flow/
└── external-integrations/
```

查看器自动从文件系统检测嵌套 — 有子元素的元素渲染为可展开的组，其他渲染为节点。

每个元素最多包含 7 个字段：`description`、`diagram`、`context`、`constraint`、`concern`、`todo`、`note`。

图表可以是流程图（`graph` / `flowchart`）、用于数据库结构等数据模型的 ER 图（`erDiagram`），用于表示请求或协议中调用顺序的时序图（`sequenceDiagram`），或用于生命周期和状态机的状态图（`stateDiagram-v2`）。四者都由 `omm validate` 校验，并在查看器中渲染。流程图也可用作面向非技术读者的业务流程图：开始/结束、步骤、是/否判断、输入/输出、文档、子流程，以及每个角色一条泳道（`subgraph`）。

## CLI

```bash
omm setup                          # 向 AI 工具注册技能
omm view                           # 打开交互式查看器
omm config language zh             # 设置内容语言
omm update                         # 更新到最新版本
```

完整命令列表请运行 `omm help`。

## 技能

技能是在 **AI 编码工具内部**运行的命令（不是终端）。以 `/` 开头。

| 技能 | 功能 |
| --- | --- |
| `/omm-scan` | 分析代码库 → 生成架构文档 |
| `/omm-view` | 在浏览器中打开架构查看器 |
| `/omm-push` | 一步完成登录 + 链接 + 推送到云端 |

## 云端（可选）

所有功能均可在本地运行，无需账号或服务器。`login`、`link`、`push` 和 `pull` 命令仅在指定兼容服务器时可用：

```bash
export OMM_API_URL=https://your-server.example
omm login && omm link && omm push
```

默认未配置任何服务器。

## 支持的 AI 工具

| 平台 | 设置 |
| --- | --- |
| Claude Code | `omm setup claude` |
| Codex | `omm setup codex` |
| Cursor | `omm setup cursor` |
| OpenClaw | `omm setup openclaw` |
| Antigravity | `omm setup antigravity` |

运行 `omm setup` 自动检测并配置所有已安装的工具。

## 路线图

请参阅 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 开发 & 贡献

```bash
git clone https://github.com/al-kheder/omm.git
cd omm
corepack enable   # provides the pinned pnpm version
pnpm install && pnpm build
pnpm test
```

欢迎提交 Issue 和 PR。请使用 [Conventional Commits](https://www.conventionalcommits.org/)。

## 许可证

[MIT](./LICENSE)
