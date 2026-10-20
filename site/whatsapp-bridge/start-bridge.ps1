param([string]$ConfigPath)
$ErrorActionPreference='Stop'
if(-not $ConfigPath){$ConfigPath=Join-Path $PSScriptRoot '..\..\work\whatsapp-bridge\config.dpapi'}
$resolvedConfig=[IO.Path]::GetFullPath($ConfigPath)
if(-not(Test-Path -LiteralPath $resolvedConfig)){throw 'Configuração privada DPAPI ausente. Configure a ponte antes de iniciar.'}
if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\@whiskeysockets\baileys'))){throw 'Dependências ausentes. Execute npm install na pasta whatsapp-bridge.'}
& node (Join-Path $PSScriptRoot 'bridge.mjs') --config $resolvedConfig
exit $LASTEXITCODE
