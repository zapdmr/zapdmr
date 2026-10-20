param([switch]$DebugApk,[switch]$SkipNativeBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:GRADLE_USER_HOME = Join-Path $projectRoot '.gradle-user-home'
$env:JAVA_TOOL_OPTIONS = '-Duser.home=' + (Join-Path $projectRoot '.java-user-home')
Remove-Item Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22 ou superior antes de compilar.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm não foi encontrado no PATH.' }
$nodeVersion = node --version
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ necessário; encontrado $nodeVersion." }
if (-not ($env:ANDROID_HOME -or $env:ANDROID_SDK_ROOT)) {
  $localProperties = Join-Path $projectRoot 'android\local.properties'
  $sdkLine = if (Test-Path -LiteralPath $localProperties) { Get-Content -LiteralPath $localProperties | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1 }
  if ($sdkLine) {
    $sdkPath = ($sdkLine -replace '^sdk\.dir=', '').Replace('\\', '\')
    $env:ANDROID_SDK_ROOT = $sdkPath
    $env:ANDROID_HOME = $sdkPath
  } else { throw 'Defina ANDROID_HOME ou ANDROID_SDK_ROOT para a pasta do Android SDK instalada pelo Android Studio.' }
}

$gradleLocalConfig = Join-Path $projectRoot 'android\.gradle\config.properties'
if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $gradleLocalConfig)) {
  $javaLine = Get-Content -LiteralPath $gradleLocalConfig | Where-Object { $_ -match '^java\.home=' } | Select-Object -First 1
  if ($javaLine) { $env:JAVA_HOME = (($javaLine -replace '^java\.home=', '').Replace('\\', '\').Replace('\:', ':')) }
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  throw 'Defina JAVA_HOME para o JDK 21 usado pelo Android Studio antes de compilar.'
}
if (-not $env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME = Join-Path $projectRoot '.android' }
$env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  }
  if ($SkipNativeBuild) {
    foreach ($abi in @('arm64-v8a','armeabi-v7a')) {
      $existingHelper = Join-Path $projectRoot ('android/app/src/main/jniLibs/' + $abi + '/libqso_dmr_vocoder_helper.so')
      if (-not (Test-Path -LiteralPath $existingHelper -PathType Leaf)) { throw "Helper de vocoder existente ausente para $abi; não é possível preservar os binários nativos." }
    }
  } else {
    & (Join-Path $PSScriptRoot 'build-vocoder-android.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar o vocoder ARM para Android.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'android'))) {
    node scripts/capacitor-cli.cjs add android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor não conseguiu adicionar a plataforma Android.' }
  }
  node scripts/capacitor-cli.cjs sync android
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor não conseguiu sincronizar a interface web.' }

  $gradle = Join-Path $projectRoot 'android\gradlew.bat'
  if (-not (Test-Path -LiteralPath $gradle)) { throw 'Gradle Wrapper não encontrado em android/gradlew.bat.' }
  Push-Location (Join-Path $projectRoot 'android')
  try {
    $buildTask = if ($DebugApk) { 'assembleDebug' } else { 'assembleRelease' }
    & $gradle --no-daemon --max-workers=2 --console=plain $buildTask
    if ($LASTEXITCODE -ne 0) { throw 'Gradle falhou ao gerar o APK de depuração.' }
  }
  finally { Pop-Location }

  if (-not $DebugApk) {
    & (Join-Path $PSScriptRoot 'sign-android.ps1')
    return
  }
  $apk = Join-Path $projectRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
  if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle terminou, mas app-debug.apk não foi encontrado.' }
  Write-Host "APK criado: $apk"
}
finally { Pop-Location }
