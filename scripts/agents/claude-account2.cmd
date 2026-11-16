@echo off
rem Second Claude Code account for F.O.R.C.E. (role: web-deploy, see docs\AGENT_PLAN.md).
rem Own config folder: login, settings and usage limits stay separate from account 1
rem (default %USERPROFILE%\.claude). No credentials are copied between accounts.
rem First start: Claude Code asks you to log in. Use the SECOND account (private browser
rem window if the browser is signed in to the first one).
set "CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude-account2"
rem Optional first argument: the folder to start in (for example D:\FED\.worktrees\multi)
if not "%~1"=="" (cd /d "%~1") else if exist "D:\FED\.worktrees\web" (cd /d "D:\FED\.worktrees\web") else (cd /d "D:\FED")
title Claude account 2 - web-deploy
echo Claude account 2 ^| config: %CLAUDE_CONFIG_DIR% ^| folder: %CD%
echo First prompt: Act as web-deploy (.claude\agents\web-deploy.md). Do task T0 in D:\FED\.agent-board\TASKS.md.
claude --model sonnet --effort medium --add-dir D:\FED\.agent-board
