# F.O.R.C.E. multi-agent plan

The lead is the main Claude Code session. It plans the work, gives each agent one focused task with the files it needs, merges results, and is the only one that commits. Agents never commit or push.

## Who runs where

| Session | Login | Folder | Role |
| --- | --- | --- | --- |
| Claude account 1 (main session) | default `%USERPROFILE%\.claude` | `D:\FED` (branch `agents/workforce-setup`) | lead + firebase-backend; spawns qa-tester (haiku) |
| Claude account 2 (separate session) | own config `%USERPROFILE%\.claude-account2`, started by `scripts\agents\claude-account2.cmd` | `D:\FED\.worktrees\web` (branch `agent/web`) | web-deploy |
| Codex CLI | ChatGPT login (`codex login status`) | `D:\FED\.worktrees\android` (branch `agent/android`) | Android integration, independent debugging |

The two Claude accounts are not connected to each other: you start account 2 yourself and give it its task from the board. The lead merges the worktree branches.

## Task board

`D:\FED\.agent-board\TASKS.md` (git-ignored, one shared copy reached by absolute path from every worktree). Only the lead edits TASKS.md. Each agent writes only `status-<agent>.md`, at most 5 lines per entry: `<time> <task> <done|blocked|failed>: <one line>`. The lead records Codex results there from `codex exec` output.

## Agents and file ownership

| Agent | Runs as | Owns (may edit) | Model |
| --- | --- | --- | --- |
| lead | main Claude Code session | `docs/DECISIONS.md`, `docs/INTEGRATION.md`, `docs/AGENT_PLAN.md`, root `package.json`, `.claude/**`, `fedfront/engine/index.ts`, `fedfront/components/cloud-sync-status.tsx`, merges | session model |
| firebase-backend | Claude subagent (`.claude/agents/firebase-backend.md`) | `packages/cloud/**`, `packages/cloud-agent/**`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.env.cloud.example`, `FIREBASE_SETUP.md`; additive methods in `packages/storage/src/store.ts` | sonnet |
| web-deploy | Claude subagent (`.claude/agents/web-deploy.md`) | `fedfront/**` (except the two lead files above), `.github/workflows/**`, `docs/RELEASE_READINESS.md`, `docs/ENVIRONMENT.md`, hosting config | sonnet |
| qa-tester | Claude subagent (`.claude/agents/qa-tester.md`) | nothing (read-only test runner) | haiku |
| codex | Codex CLI (when installed) | `android/**` (new) and read-only independent review/testing | ChatGPT plan |

One file has one owner. A task that needs another owner's file goes back to the lead.

## Protected (no agent edits without the user's approval)

`firmware/**`, `packages/protocol/**` (ESP32 BLE protocol), `packages/engine/**` (calculation engine), `packages/device/**`, `packages/storage/src/db.ts` (Dexie schema), existing local data (IndexedDB), `.env.cloud`, `secrets/**`, service-account files.

## Always ask the user first

Deleting files or data; editing outside D:\FED; system settings; global installs; anything with credentials or tokens; production deployments (`firebase deploy`, `vercel --prod`, `netlify deploy --prod`); `git push`. These are also `ask` rules in `.claude/settings.json`.

## Token rules

- Each task names its files. Agents run `graphify query` before reading and read only the lines it points to; no repository-wide scans.
- Agents reply in at most 15 lines: files changed, commands with pass/fail counts, open issues.
- The lead passes results on as summaries, not as file contents.

## Worktrees (only when two agents edit at the same time)

- Claude subagents: the lead spawns them with `isolation: "worktree"`. New worktrees start from local HEAD (`worktree.baseRef: "head"`).
- Codex or manual: `git worktree add .worktrees/<name> -b agent/<name>`, then `npm ci` inside it. Do not symlink `node_modules`: the npm workspace links would point back at the main checkout's packages.
- Worktrees start from the last commit. Uncommitted work in the main checkout is not in them, so commit (or stash) it first.
- `.worktrees/` and `.claude/worktrees/` are git-ignored. Removing a worktree needs approval.

## Codex

Installed (`codex-cli 0.169.0`, logged in with ChatGPT). Codex reads `AGENTS.md`.
- review or test, read-only: `codex exec -s read-only -C D:\FED "<task>"`
- Android work in its own worktree: `codex exec -s workspace-write -C D:\FED\.worktrees\android "<task>"` (asks for approval)

## Second Claude account

A separate session with its own login and usage limits (see "Who runs where"). Start it with `scripts\agents\claude-account2.cmd`; check its login with `set CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-account2` then `claude auth status`. No shared tokens or credentials.

## Work in flight (16 Nov 2026)

The Firestore security-fix pass is committed as work in progress on `agents/workforce-setup` (owner: firebase-backend, task T1). Its tests are not passing yet; see the board.
