$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseVersion = [string](Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'A versão de release em package.json é inválida.' }
$releaseDir = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$destination = Join-Path $releaseDir "ZapDMR-Android-$releaseVersion-source.zip"
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($destination, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
$sourcePrefix = "ZapDMR-$releaseVersion-source/"
$skipDirectories = @('.git', '.idea', '.gradle', '.android', '.android-signing', '.android-user-home', 'node_modules', 'build', 'jniLibs', 'public', '.gradle-home', '.gradle-user-home', '.java-user-home', '.wrangler', 'data', 'private', 'state', 'auth', 'credentials', 'sessions', 'work')
$skipExtensions = @('.exe', '.dll', '.so', '.a', '.o', '.bin', '.img', '.jks', '.keystore', '.apk', '.zip', '.log', '.dpapi', '.pem', '.key', '.pfx', '.p12', '.db', '.sqlite', '.sqlite3')
function Add-SourceFile([string]$path, [string]$name) {
    $entry = $archive.CreateEntry($sourcePrefix + $name.Replace('\','/'), [IO.Compression.CompressionLevel]::Fastest)
    $inputStream = [IO.File]::OpenRead($path)
    $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
}
function Add-SourceTree([string]$path, [string]$prefix) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    foreach ($item in Get-ChildItem -LiteralPath $path -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        if ($item.PSIsContainer) {
            if ($item.Name -in $skipDirectories -or $item.Name -like 'build-*') { continue }
            Add-SourceTree $item.FullName ($prefix + '/' + $item.Name)
        } elseif ($item.Name -notin @('.git','local.properties','google-services.json','creds.json','credentials.json') -and ($item.Name -notlike '.env*' -or $item.Name -eq '.env.example') -and $item.Name -notlike '.dev.vars*' -and $item.Name -notlike '*.dpapi*' -and $item.Name -notlike '*-wal' -and $item.Name -notlike '*-shm' -and $item.Extension -notin $skipExtensions) {
            Add-SourceFile $item.FullName ($prefix + '/' + $item.Name)
        }
    }
}
try {
    foreach ($name in @('package.json','package-lock.json','capacitor.config.json','tsconfig.server.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md','AGENTS.md','.gitignore')) {
        Add-SourceFile (Join-Path $projectRoot $name) $name
    }
    foreach ($name in @('web','src','electron','scripts','docs','android')) { Add-SourceTree (Join-Path $projectRoot $name) $name }
    Add-SourceFile (Join-Path $projectRoot 'data\talkgroups-brasil.json') 'data/talkgroups-brasil.json'
    Add-SourceTree (Join-Path $projectRoot 'site\public') 'site/public'
    foreach ($name in @('server.mjs','public-pages.mjs','package.json','README.md','AUTENTICACAO.md','WHATSAPP-OTP.md','ZAPCHAT-ANEXOS.md','AVISOS-VERSOES.md','VERIFICACAO-1.4.0.md','VERIFICACAO-1.4.1.md','VERIFICACAO-1.4.2.md','VERIFICACAO-1.4.3.md','VERIFICACAO-1.4.5.md','VERIFICACAO-2026-10-19.md','.env.example','Caddyfile','zapdmr.service','LICENSE')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('site/'+$name))) { Add-SourceFile (Join-Path $projectRoot ('site/'+$name)) ('site/'+$name) } }
    foreach ($name in @('api.mjs','attachments.mjs','release-notifications.mjs','worker.mjs','schema.sql','package.json','package-lock.json','wrangler.jsonc','configure-secrets.mjs','configure-whatsapp-bridge.mjs','README.md','.gitignore')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('site/cloudflare/'+$name))) { Add-SourceFile (Join-Path $projectRoot ('site/cloudflare/'+$name)) ('site/cloudflare/'+$name) } }
    Add-SourceTree (Join-Path $projectRoot 'site\cloudflare\migrations') 'site/cloudflare/migrations'
    if (Test-Path -LiteralPath (Join-Path $projectRoot 'site\VERIFICACAO-2026-10-20.md')) { Add-SourceFile (Join-Path $projectRoot 'site\VERIFICACAO-2026-10-20.md') 'site/VERIFICACAO-2026-10-20.md' }
    foreach ($name in @('bridge.mjs','dpapi.ps1','start-bridge.ps1','supervise-bridge.ps1','install-startup.ps1','package.json','package-lock.json','README.md','.gitignore')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('site/whatsapp-bridge/'+$name))) { Add-SourceFile (Join-Path $projectRoot ('site/whatsapp-bridge/'+$name)) ('site/whatsapp-bridge/'+$name) } }
    Add-SourceTree (Join-Path $projectRoot 'native\audio-sidecar') 'native/audio-sidecar'
    Add-SourceTree (Join-Path $projectRoot 'native\vocoder-android\vocoder-main') 'native/vocoder-android/vocoder-main'
    Add-SourceTree (Join-Path $projectRoot 'native\boost_1_88_0\boost') 'native/boost_1_88_0/boost'
    $boostLicense = Join-Path $projectRoot 'native\boost_1_88_0\LICENSE_1_0.txt'
    if (Test-Path -LiteralPath $boostLicense) { Add-SourceFile $boostLicense 'native/boost_1_88_0/LICENSE_1_0.txt' }
    Add-SourceTree (Join-Path $projectRoot 'native\vocoder-android\vocoder-main\build-android-arm64-v8a\_deps\dynarmic-src') 'native/vocoder-android/dynarmic-source'
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Host "GPL corresponding source archive: $destination"
