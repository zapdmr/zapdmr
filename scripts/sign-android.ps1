$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseVersion = [string](Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'A versão de release em package.json é inválida.' }
$signingRoot = Join-Path $projectRoot '.android-signing'
$configFile = Join-Path $signingRoot 'release.json'
if (-not (Test-Path -LiteralPath $configFile)) { throw 'Release signing configuration is missing from .android-signing/release.json.' }
$signing = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$sdkLine = Get-Content (Join-Path $projectRoot 'android\local.properties') | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
$sdkPath = ($sdkLine -replace '^sdk\.dir=', '').Replace('\\', '\')
$tools = Join-Path $sdkPath 'build-tools\36.0.0'
$inputApk = Join-Path $projectRoot 'android\app\build\outputs\apk\release\app-release-unsigned.apk'
if (-not (Test-Path -LiteralPath $inputApk)) { throw 'Build assembleRelease before signing.' }
$releaseDir = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$aligned = Join-Path $releaseDir 'ZapDMR-aligned.apk'
$output = Join-Path $releaseDir ("ZapDMR-Android-$releaseVersion.apk")
& (Join-Path $tools 'zipalign.exe') -f -P 16 4 $inputApk $aligned
if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
$env:ZAPDMR_RELEASE_STORE_PASSWORD = $signing.password
try {
  & (Join-Path $tools 'apksigner.bat') sign --ks (Join-Path $signingRoot 'zapdmr-release.jks') --ks-key-alias zapdmr --ks-pass env:ZAPDMR_RELEASE_STORE_PASSWORD --key-pass env:ZAPDMR_RELEASE_STORE_PASSWORD --out $output $aligned
  if ($LASTEXITCODE -ne 0) { throw 'APK release signing failed.' }
} finally { Remove-Item Env:ZAPDMR_RELEASE_STORE_PASSWORD -ErrorAction SilentlyContinue }
& (Join-Path $tools 'apksigner.bat') verify --verbose $output
if ($LASTEXITCODE -ne 0) { throw 'APK signature validation failed.' }
& (Join-Path $tools 'zipalign.exe') -c -P 16 4 $output
if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment validation failed.' }
Remove-Item -LiteralPath $aligned -Force
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $releaseDir "ZapDMR-Android-$releaseVersion.sha256") -Value "$hash  ZapDMR-Android-$releaseVersion.apk" -Encoding ascii
Write-Host "Signed release APK: $output"
