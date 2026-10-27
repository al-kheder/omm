[English](./README.md) | [Türkçe](./README.tr.md) | [한국어](./README.ko.md) | [日本語](./README.ja.md) | [中文](./README.zh.md)

> 이 문서는 영어 README를 번역한 것입니다. 일부 표현이 부자연스러울 수 있습니다.

<p align="center">
  <img src="./docs/logo.jpg" alt="omm logo" width="80"/>
</p>

<h1 align="center">Oh-my-mermaid</h1>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

<p align="center">
  AI는 몇 초 만에 코드를 작성합니다. 사람이 이해하는 데는 몇 시간이 걸립니다.<br/>
  이해를 건너뛰면, 코드베이스는 블랙박스가 됩니다 — 본인에게조차.<br/><br/>
  <strong>omm이 그 격차를 해소합니다 — AI가 생성한, 사람을 위한 아키텍처 문서.</strong>
</p>

---

## 빠른 시작

Node.js 18 이상과 Git이 필요합니다.

**1. CLI를 설치하고 스킬을 등록합니다.** 터미널에 붙여넣기:

```bash
npm install -g github:al-kheder/omm && omm setup
```

npm 12 이상에서는 설치 명령에 `--allow-git=all`을 추가하세요. npm 12는 기본적으로 GitHub에서의 설치를 차단합니다.

`omm setup`은 찾은 모든 AI 도구에 스킬을 등록합니다([지원 AI 도구](#지원-ai-도구) 참고). Claude Code는 `claude` 명령이 설치되어 있을 때만 찾습니다. VS Code 확장이나 데스크톱 앱만 사용한다면 Claude Code 안에서 플러그인을 추가하세요:

```
/plugin marketplace add al-kheder/omm
/plugin install oh-my-mermaid@al-kheder-omm
```

**2. 코드베이스를 스캔합니다.** 프로젝트에서 AI 코딩 도구를 열고 실행:

```
/omm-scan
```

Claude Code에서는 스킬이 `/oh-my-mermaid:omm-scan`으로 표시됩니다. 스캔 결과는 프로젝트의 `.omm/`에 저장됩니다.

**3. 결과를 봅니다.** 프로젝트 폴더에서 실행:

```bash
omm view
```

그런 다음 http://localhost:3000 을 엽니다. 다른 포트는 `--port <n>`으로 지정하세요. 뷰어는 내 컴퓨터에서 오는 연결만 받으며, `.omm/`이 바뀌면 실시간으로 갱신됩니다. 도구 모음의 **clean**은 파일 경로를 숨기고, **svg** / **png**는 선택한 다이어그램을 내려받습니다. 예를 들어 고객용 슬라이드에 넣을 때 사용합니다. **mono | color**는 흑백 화면과 각 요소의 의미(시작/종료, 결정, 데이터 저장소 …)를 색으로 보여주는 화면을 전환합니다. **flow**는 데이터나 작업이 이동하는 화살표를 따라 작은 파일 아이콘을 움직여 프로세스가 어떻게 진행되는지 보여 줍니다.

## 예시

> omm이 자기 자신을 스캔했습니다. 이것이 결과입니다.

<table><tr>
<td width="50%"><img src="./docs/screenshot.png" alt="omm viewer"/></td>
<td width="50%"><img src="./docs/demo.gif" alt="omm scan demo"/></td>
</tr></table>

## 작동 방식

AI가 코드베이스를 분석하고 **관점(perspective)** 을 생성합니다 — 아키텍처를 바라보는 다양한 렌즈(구조, 데이터 흐름, 외부 연동 등). 각 관점에는 Mermaid 다이어그램과 문서 필드가 포함됩니다.

모든 노드는 **재귀적으로 분석**됩니다. 복잡한 노드는 자체 다이어그램을 가진 중첩 자식 element가 됩니다. 단순한 노드는 리프로 남습니다. 파일시스템이 트리를 직접 반영합니다:

```
.omm/
├── overall-architecture/           ← 관점
│   ├── description.md
│   ├── diagram.mmd
│   ├── context.md
│   ├── main-process/               ← 중첩 element
│   │   ├── description.md
│   │   ├── diagram.mmd
│   │   └── auth-service/           ← 더 깊은 중첩
│   │       └── ...
│   └── renderer/
│       └── ...
├── data-flow/
└── external-integrations/
```

뷰어는 파일시스템에서 중첩을 자동 감지합니다 — 자식이 있는 element는 확장 가능한 그룹으로, 나머지는 노드로 렌더링됩니다.

각 element는 최대 7개 필드를 가집니다: `description`, `diagram`, `context`, `constraint`, `concern`, `todo`, `note`.

다이어그램은 플로우차트(`graph` / `flowchart`), 데이터베이스 스키마 같은 데이터 모델을 위한 ER 다이어그램(`erDiagram`), 요청이나 프로토콜의 호출 순서를 위한 시퀀스 다이어그램(`sequenceDiagram`), 또는 생명주기와 상태 머신을 위한 상태 다이어그램(`stateDiagram-v2`)입니다. 네 형식 모두 `omm validate`로 검증되고 뷰어에서 렌더링됩니다. 플로우차트는 비기술 독자를 위한 프로세스 다이어그램으로도 쓸 수 있습니다: 시작/종료, 단계, 예/아니오 결정, 입력/출력, 문서, 하위 프로세스, 역할별 레인(`subgraph`).

## CLI

```bash
omm setup                          # AI 도구에 스킬 등록
omm view                           # 인터랙티브 뷰어 열기
omm config language ko             # 콘텐츠 언어 설정
omm update                         # 최신 버전으로 업데이트
```

전체 명령어는 `omm help`를 참고하세요.

## 스킬

스킬은 **AI 코딩 도구 안에서** 실행하는 명령어입니다 (터미널이 아닙니다). `/`로 시작합니다.

| 스킬 | 기능 |
| --- | --- |
| `/omm-scan` | 코드베이스 분석 → 아키텍처 문서 생성 |
| `/omm-view` | 브라우저에서 아키텍처 뷰어 열기 |
| `/omm-push` | 로그인 + 연결 + 클라우드 푸시를 한 번에 |

## 클라우드 (선택 사항)

모든 기능은 로컬에서 동작하며, 계정이나 서버가 필요하지 않습니다. `login`, `link`, `push`, `pull` 명령은 호환되는 서버를 지정한 경우에만 동작합니다:

```bash
export OMM_API_URL=https://your-server.example
omm login && omm link && omm push
```

기본으로 설정된 서버는 없습니다.

## 지원 AI 도구

| 플랫폼 | 설정 |
| --- | --- |
| Claude Code | `omm setup claude` |
| Codex | `omm setup codex` |
| Cursor | `omm setup cursor` |
| OpenClaw | `omm setup openclaw` |
| Antigravity | `omm setup antigravity` |

`omm setup`을 실행하면 설치된 모든 도구를 자동 감지하고 설정합니다.

## 로드맵

[docs/ROADMAP.md](./docs/ROADMAP.md)를 참고하세요.

## 개발 & 기여

```bash
git clone https://github.com/al-kheder/omm.git
cd omm
corepack enable   # provides the pinned pnpm version
pnpm install && pnpm build
pnpm test
```

이슈와 PR을 환영합니다. [Conventional Commits](https://www.conventionalcommits.org/)를 사용해주세요.

## 라이선스

[MIT](./LICENSE)
