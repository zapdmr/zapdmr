$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$siteRoot = Join-Path $projectRoot 'site'
$releaseDir = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$destination = Join-Path $releaseDir 'ZapDMR-Site-Cloudflare-1.3.0.zip'
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($destination, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
$files = @(
    'README.md','LICENSE','server.mjs','public-pages.mjs','package.json',
    '.env.example','Caddyfile','zapdmr.service','VERIFICACAO-2026-10-19.md','AUTENTICACAO.md',
    'public/index.html','public/site.js','public/site.css','public/ZapDMR.png','public/_headers',
    'cloudflare/api.mjs','cloudflare/worker.mjs','cloudflare/schema.sql',
    'cloudflare/package.json','cloudflare/package-lock.json','cloudflare/wrangler.jsonc',
    'cloudflare/README.md','cloudflare/.gitignore','cloudflare/configure-secrets.mjs'
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
Set-Content -LiteralPath (Join-Path $releaseDir 'SHA256SUMS-Site-Cloudflare-1.3.0.txt') -Value ($checksum + '  ' + [IO.Path]::GetFileName($destination)) -Encoding utf8
Get-Item -LiteralPath $destination | Select-Object FullName,Length
