$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$destination = Join-Path $releaseDir 'ZapDMR-Android-1.3.0-source.zip'
Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($destination, [IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
$sourcePrefix = 'ZapDMR-1.3.0-source/'
$skipDirectories = @('.git', '.idea', '.gradle', '.android', 'node_modules', 'build', 'jniLibs', 'public', '.gradle-home', '.gradle-user-home')
$skipExtensions = @('.exe', '.dll', '.so', '.a', '.o', '.bin', '.img', '.jks', '.keystore', '.apk', '.zip', '.log')
function Add-SourceFile([string]$path, [string]$name) {
    $entry = $archive.CreateEntry($sourcePrefix + $name.Replace('\','/'), [IO.Compression.CompressionLevel]::Fastest)
    $inputStream = [IO.File]::OpenRead($path)
    $outputStream = $entry.Open()
    try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
}
function Add-SourceTree([string]$path, [string]$prefix) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    foreach ($item in Get-ChildItem -LiteralPath $path -Force) {
        if ($item.PSIsContainer) {
            if ($item.Name -in $skipDirectories -or $item.Name -like 'build-*') { continue }
            Add-SourceTree $item.FullName ($prefix + '/' + $item.Name)
        } elseif ($item.Name -ne '.git' -and $item.Name -ne 'local.properties' -and $item.Extension -notin $skipExtensions) {
            Add-SourceFile $item.FullName ($prefix + '/' + $item.Name)
        }
    }
}
try {
    foreach ($name in @('package.json','package-lock.json','capacitor.config.json','tsconfig.server.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md','.gitignore')) {
        Add-SourceFile (Join-Path $projectRoot $name) $name
    }
    foreach ($name in @('web','src','electron','scripts','docs','android')) { Add-SourceTree (Join-Path $projectRoot $name) $name }
    Add-SourceTree (Join-Path $projectRoot 'site\public') 'site/public'
    foreach ($name in @('server.mjs','public-pages.mjs','package.json','README.md','.env.example','Caddyfile','zapdmr.service','LICENSE')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('site/'+$name))) { Add-SourceFile (Join-Path $projectRoot ('site/'+$name)) ('site/'+$name) } }
    foreach ($name in @('api.mjs','worker.mjs','schema.sql','package.json','package-lock.json','wrangler.jsonc','README.md','.gitignore')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('site/cloudflare/'+$name))) { Add-SourceFile (Join-Path $projectRoot ('site/cloudflare/'+$name)) ('site/cloudflare/'+$name) } }
    Add-SourceTree (Join-Path $projectRoot 'native\audio-sidecar') 'native/audio-sidecar'
    Add-SourceTree (Join-Path $projectRoot 'native\vocoder-android\vocoder-main') 'native/vocoder-android/vocoder-main'
    Add-SourceTree (Join-Path $projectRoot 'native\boost_1_88_0\boost') 'native/boost_1_88_0/boost'
    $boostLicense = Join-Path $projectRoot 'native\boost_1_88_0\LICENSE_1_0.txt'
    if (Test-Path -LiteralPath $boostLicense) { Add-SourceFile $boostLicense 'native/boost_1_88_0/LICENSE_1_0.txt' }
    Add-SourceTree (Join-Path $projectRoot 'native\vocoder-android\vocoder-main\build-android-arm64-v8a\_deps\dynarmic-src') 'native/vocoder-android/dynarmic-source'
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Host "GPL corresponding source archive: $destination"
