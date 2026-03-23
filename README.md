# lobs-sentinel

Persistent, single-purpose AI agents that run in Docker containers. Each sentinel watches GitHub repos and performs one job — reviewing PRs, triaging issues, enforcing standards, etc.

## Quick Start

```bash
# Build
docker build -t lobs-sentinel .

# Run a PR reviewer watching specific repos
docker run -d \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e GITHUB_TOKEN=ghp_... \
  -v ./config.yaml:/app/config.yaml \
  lobs-sentinel --mode reviewer

# Or run locally
npm install
ANTHROPIC_API_KEY=sk-ant-... GITHUB_TOKEN=ghp_... npx tsx src/main.ts --mode reviewer
```

## Modes

| Mode | What it does |
|------|-------------|
| `reviewer` | Reviews PRs — posts code review comments with approve/request-changes |
| `labeler` | Auto-labels issues and PRs based on content |
| `triage` | Triages new issues — categorizes, assigns priority, asks clarifying questions |

## Configuration

```yaml
# config.yaml
repos:
  - paw-engineering/paw-hub
  - paw-engineering/ship-api
  - lobs-ai/lobs-core

polling:
  interval: 60  # seconds

model: claude-sonnet-4-20250514

reviewer:
  auto_approve: false  # if true, will approve trivial PRs
  style: thorough      # thorough | quick | security-focused
  ignore_drafts: true
  custom_instructions: |
    Focus on TypeScript best practices.
    Flag any security issues.
    Be constructive, not nitpicky.
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for LLM calls |
| `GITHUB_TOKEN` | Yes | GitHub PAT with repo access (or use `gh auth`) |
| `CONFIG_PATH` | No | Path to config file (default: `./config.yaml`) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

## Architecture

```
lobs-sentinel/
├── src/
│   ├── main.ts              ← Entry point, mode selection
│   ├── poller.ts            ← GitHub polling loop
│   ├── llm.ts               ← Anthropic API client
│   ├── config.ts            ← YAML config loader
│   ├── modes/
│   │   ├── reviewer.ts      ← PR review logic
│   │   ├── labeler.ts       ← Issue/PR labeling
│   │   └── triage.ts        ← Issue triage
│   └── github.ts            ← GitHub API helpers (via gh CLI)
├── Dockerfile
├── config.yaml              ← Example config
└── package.json
```

No dependency on lobs-core. Fully standalone. Anyone can run it.
