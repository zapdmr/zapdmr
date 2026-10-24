$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME='C:\Users\User\.jdks\jbr-21.0.11'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:ANDROID_USER_HOME=Join-Path $projectRoot '.android'
$env:GRADLE_USER_HOME=Join-Path $projectRoot '.gradle-user-home'
$env:JAVA_TOOL_OPTIONS='-Duser.home='+(Join-Path $projectRoot '.java-user-home')
$env:PATH=(Join-Path $env:JAVA_HOME 'bin')+';'+$env:PATH
Push-Location $projectRoot
try{
 node scripts/capacitor-cli.cjs sync android
 if($LASTEXITCODE -ne 0){throw 'Falha ao sincronizar a interface.'}
 Push-Location android
 try{& .\gradlew.bat --no-daemon --max-workers=2 --console=plain assembleCarPreview testCarPreviewUnitTest;if($LASTEXITCODE -ne 0){throw 'Falha ao compilar a prévia.'}}finally{Pop-Location}
 $destination=Join-Path $projectRoot 'release\car-preview'
 New-Item -ItemType Directory -Path $destination -Force | Out-Null
 Copy-Item -LiteralPath 'android\app\build\outputs\apk\carPreview\app-carPreview.apk' -Destination (Join-Path $destination 'ZapDMR-Car-Preview.apk')
 $digest=(Get-FileHash -LiteralPath (Join-Path $destination 'ZapDMR-Car-Preview.apk') -Algorithm SHA256).Hash.ToLowerInvariant()
 Set-Content -LiteralPath (Join-Path $destination 'SHA256SUMS.txt') -Value ($digest+'  ZapDMR-Car-Preview.apk') -Encoding ascii
 Write-Host 'Prévia isolada criada. Pacote br.radio.zapdmr.carpreview; não substitui o ZapDMR instalado.'
}finally{Pop-Location}

