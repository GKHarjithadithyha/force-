<#
  Second Claude Code account for F.O.R.C.E. (role: web-deploy, see docs/AGENT_PLAN.md).

  It runs with its OWN config directory (%USERPROFILE%\.claude-account2), so its login,
  settings and usage limits stay separate from your first account, which keeps using the
  default %USERPROFILE%\.claude. No credentials are copied between the two.

  First start: Claude Code asks you to log in. Sign in to claude.ai with the SECOND account
  (use a private browser window if your browser is signed in to the first one).

  Usage:  & 'D:\FED\scripts\agents\claude-account2.ps1' [-WorkDir <path>]
          (if your execution policy blocks local scripts, use claude-account2.cmd instead)
#>
param([string]$WorkDir = 'D:\FED\.worktrees\web')

if (-not (Test-Path $WorkDir)) {
  Write-Warning "$WorkDir does not exist yet; starting in D:\FED (edit only the files the board assigns to web-deploy)."
  $WorkDir = 'D:\FED'
}
$env:CLAUDE_CONFIG_DIR = Join-Path $HOME '.claude-account2'
Set-Location $WorkDir
$host.UI.RawUI.WindowTitle = 'Claude account 2 - web-deploy'
Write-Host "Claude account 2 | config: $env:CLAUDE_CONFIG_DIR | folder: $WorkDir"
Write-Host 'Role: web-deploy. First read D:\FED\docs\AGENT_PLAN.md and D:\FED\.agent-board\TASKS.md.'
claude --model sonnet --effort medium --add-dir D:\FED\.agent-board
