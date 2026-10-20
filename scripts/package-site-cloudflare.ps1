$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseVersion = [string](Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Versão de release inválida.' }
$siteRoot = Join-Path $projectRoot 'site'
$releaseDir = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$destination = Join-Path $releaseDir "ZapDMR-Site-Cloudflare-$releaseVersion.zip"
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($destination, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
$files = @(
    'README.md','LICENSE','server.mjs','public-pages.mjs','package.json',
    '.env.example','Caddyfile','zapdmr.service','VERIFICACAO-2026-10-19.md','VERIFICACAO-2026-10-20.md','AUTENTICACAO.md','WHATSAPP-OTP.md',
    'public/index.html','public/site.js','public/site.css','public/ZapDMR.png','public/_headers',
    'cloudflare/api.mjs','cloudflare/worker.mjs','cloudflare/schema.sql',
    'cloudflare/package.json','cloudflare/package-lock.json','cloudflare/wrangler.jsonc',
    'cloudflare/README.md','cloudflare/.gitignore','cloudflare/configure-secrets.mjs','cloudflare/configure-whatsapp-bridge.mjs',
    'cloudflare/migrations/0001_whatsapp_otp.sql',
    'whatsapp-bridge/bridge.mjs','whatsapp-bridge/dpapi.ps1','whatsapp-bridge/start-bridge.ps1',
    'whatsapp-bridge/package.json','whatsapp-bridge/package-lock.json','whatsapp-bridge/README.md','whatsapp-bridge/.gitignore'
)
try {
    foreach ($name in $files) {
        $file = Join-Path $siteRoot $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Arquivo de publicação ausente: $name" }
        $entry = $archive.CreateEntry('zapdmr-site/' + $name, [IO.Compression.CompressionLevel]::Optimal)
        $inputStream = [IO.File]::OpenRead($file)
        $outputStream = $entry.Open()
        try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$checksum = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $releaseDir "SHA256SUMS-Site-Cloudflare-$releaseVersion.txt") -Value ($checksum + '  ' + [IO.Path]::GetFileName($destination)) -Encoding utf8
Get-Item -LiteralPath $destination | Select-Object FullName,Length
