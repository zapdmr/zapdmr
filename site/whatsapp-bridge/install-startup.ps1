param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '..\..\work\whatsapp-bridge\config.dpapi' }
$resolvedConfig = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $resolvedConfig)) { throw 'Configuração protegida da ponte ausente.' }
$supervisor = Join-Path $PSScriptRoot 'supervise-bridge.ps1'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $supervisor + '" -ConfigPath "' + $resolvedConfig + '"'
$startup = [Environment]::GetFolderPath('Startup')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $startup 'ZapDMR WhatsApp.lnk'))
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Mantém a ponte de confirmação WhatsApp do ZapDMR ativa após entrar no Windows.'
$shortcut.Save()
Start-Process -FilePath $powershellPath -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
Write-Output 'Retomada da ponte configurada para este usuário ao entrar no Windows.'
