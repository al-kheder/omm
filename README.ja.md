[English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

> このドキュメントは英語のREADMEから翻訳されたものです。一部の表現が不自然な場合があります。

<p align="center">
  <img src="./docs/logo.jpg" alt="omm logo" width="80"/>
</p>

<h1 align="center">Oh-my-mermaid</h1>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

<p align="center">
  AIは数秒でコードを書きます。人間が理解するには数時間かかります。<br/>
  理解をスキップすると、コードベースはブラックボックスになります — あなた自身にとっても。<br/><br/>
  <strong>ommがそのギャップを埋めます — AIが生成した、人間のためのアーキテクチャドキュメント。</strong>
</p>

---

## クイックスタート

Node.js 18以上とGitが必要です。

**1. CLIをインストールし、スキルを登録します。** ターミナルに貼り付けてください：

```bash
npm install -g github:al-kheder/omm && omm setup
```

npm 12以降では、インストールコマンドに`--allow-git=all`を追加してください。npm 12はデフォルトでGitHubからのインストールをブロックします。

`omm setup`は見つかったすべてのAIツールにスキルを登録します（[対応AIツール](#対応aiツール)を参照）。Claude Codeは`claude`コマンドがインストールされている場合のみ検出されます。VS Code拡張機能やデスクトップアプリだけを使っている場合は、Claude Code内からプラグインを追加してください：

```
/plugin marketplace add al-kheder/omm
/plugin install oh-my-mermaid@al-kheder-omm
```

**2. コードベースをスキャンします。** プロジェクトでAIコーディングツールを開いて実行：

```
/omm-scan
```

Claude Codeではスキルは`/oh-my-mermaid:omm-scan`として表示されます。スキャン結果はプロジェクトの`.omm/`に書き込まれます。

**3. 結果を表示します。** プロジェクトフォルダで実行：

```bash
omm view
```

その後 http://localhost:3000 を開きます。別のポートを使うには`--port <n>`を指定します。ビューアは自分のマシンからの接続のみを受け付け、`.omm/`の変更に合わせてライブで更新されます。

## 例

> ommが自分自身をスキャンしました。これがその結果です。

<table><tr>
<td width="50%"><img src="./docs/screenshot.png" alt="omm viewer"/></td>
<td width="50%"><img src="./docs/demo.gif" alt="omm scan demo"/></td>
</tr></table>

## 仕組み

AIがコードベースを分析し、**パースペクティブ**を生成します — アーキテクチャを見るための様々なレンズ（構造、データフロー、外部連携など）。各パースペクティブにはMermaidダイアグラムとドキュメントフィールドが含まれます。

すべてのノードが**再帰的に分析**されます。複雑なノードは独自のダイアグラムを持つネストされた子エレメントになります。シンプルなノードはリーフとして残ります。ファイルシステムがツリーを直接反映します：

```
.omm/
├── overall-architecture/           ← パースペクティブ
│   ├── description.md
│   ├── diagram.mmd
│   ├── context.md
│   ├── main-process/               ← ネストされたエレメント
│   │   ├── description.md
│   │   ├── diagram.mmd
│   │   └── auth-service/           ← より深いネスト
│   │       └── ...
│   └── renderer/
│       └── ...
├── data-flow/
└── external-integrations/
```

ビューアはファイルシステムからネストを自動検出します — 子を持つエレメントは展開可能なグループとして、それ以外はノードとしてレンダリングされます。

各エレメントは最大7つのフィールドを持ちます：`description`、`diagram`、`context`、`constraint`、`concern`、`todo`、`note`。

ダイアグラムはフローチャート（`graph` / `flowchart`）、データベーススキーマなどのデータモデル用のER図（`erDiagram`）、またはリクエストやプロトコルの呼び出し順序を表すシーケンス図（`sequenceDiagram`）です。いずれも `omm validate` で検証され、ビューアーで表示されます。

## CLI

```bash
omm setup                          # AIツールにスキルを登録
omm view                           # インタラクティブビューアを開く
omm config language ja             # コンテンツ言語を設定
omm update                         # 最新バージョンに更新
```

完全なコマンドリストは`omm help`を参照してください。

## スキル

スキルは**AIコーディングツール内で**実行するコマンドです（ターミナルではありません）。`/`で始まります。

| スキル | 機能 |
| --- | --- |
| `/omm-scan` | コードベース分析 → アーキテクチャドキュメント生成 |
| `/omm-view` | ブラウザでアーキテクチャビューアーを開く |
| `/omm-push` | ログイン + リンク + クラウドプッシュを一度に |

## クラウド（オプション）

すべての機能はローカルで動作し、アカウントやサーバーは不要です。`login`、`link`、`push`、`pull` コマンドは、互換サーバーを指定した場合にのみ動作します：

```bash
export OMM_API_URL=https://your-server.example
omm login && omm link && omm push
```

デフォルトではサーバーは設定されていません。

## 対応AIツール

| プラットフォーム | セットアップ |
| --- | --- |
| Claude Code | `omm setup claude` |
| Codex | `omm setup codex` |
| Cursor | `omm setup cursor` |
| OpenClaw | `omm setup openclaw` |
| Antigravity | `omm setup antigravity` |

`omm setup`を実行すると、インストール済みのすべてのツールを自動検出して設定します。

## ロードマップ

[docs/ROADMAP.md](./docs/ROADMAP.md)を参照してください。

## 開発 & 貢献

```bash
git clone https://github.com/al-kheder/omm.git
cd omm
corepack enable   # provides the pinned pnpm version
pnpm install && pnpm build
pnpm test
```

IssueとPRを歓迎します。[Conventional Commits](https://www.conventionalcommits.org/)を使用してください。

## ライセンス

[MIT](./LICENSE)
