param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '..\..\work\whatsapp-bridge\config.dpapi' }
$resolvedConfig = [IO.Path]::GetFullPath($ConfigPath)
if (-not (Test-Path -LiteralPath $resolvedConfig)) { throw 'Configuração protegida da ponte ausente.' }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$mutex = [Threading.Mutex]::new($false, 'Local\ZapDMRWhatsAppSupervisor')
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { return }
    while ($true) {
        $available = $false
        try {
            $status = Invoke-RestMethod -Uri 'http://127.0.0.1:4193/status' -TimeoutSec 5
            $available = $null -ne $status.status
        } catch {}
        if (-not $available) {
            # The bridge owns its session lock and reconnects an already paired account.
            # Keep its stdout private and preserve a paused or QR-waiting live process.
            $bridgeArgs = @('"' + (Join-Path $PSScriptRoot 'bridge.mjs') + '"', '--config', '"' + $resolvedConfig + '"')
            try {
                Start-Process -FilePath $nodePath -ArgumentList $bridgeArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -Wait
            } catch {}
        }
        Start-Sleep -Seconds 15
    }
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
