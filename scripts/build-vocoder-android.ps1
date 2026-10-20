$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$moduleRoot = Join-Path $projectRoot 'native\vocoder-android\vocoder-main'
$androidRoot = Join-Path $projectRoot 'android'

if (-not (Test-Path -LiteralPath (Join-Path $androidRoot 'local.properties'))) {
  throw 'Android SDK nÃ£o encontrado: android/local.properties estÃ¡ ausente.'
}
$sdkLine = Get-Content -LiteralPath (Join-Path $androidRoot 'local.properties') | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
if (-not $sdkLine) { throw 'A propriedade sdk.dir estÃ¡ ausente de android/local.properties.' }
$sdkPath = ($sdkLine -replace '^sdk\.dir=', '').Replace('\\', '\')

$ndkPath = $env:ANDROID_NDK_HOME
if (-not $ndkPath -or -not (Test-Path -LiteralPath (Join-Path $ndkPath 'build\cmake\android.toolchain.cmake'))) {
  $ndkRoot = Join-Path $sdkPath 'ndk'
  $ndk = Get-ChildItem -LiteralPath $ndkRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'build\cmake\android.toolchain.cmake') } | Sort-Object Name -Descending | Select-Object -First 1
  if ($ndk) { $ndkPath = $ndk.FullName }
}
if (-not $ndkPath -or -not (Test-Path -LiteralPath (Join-Path $ndkPath 'build\cmake\android.toolchain.cmake'))) {
  throw 'Instale o Android NDK 27.x no SDK Manager (Android Studio > Tools > SDK Manager > SDK Tools) e tente novamente.'
}

$cmakePath = $null
$ninjaPath = $null
$cmakeRoot = Join-Path $sdkPath 'cmake'
$cmakePackage = Get-ChildItem -LiteralPath $cmakeRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($cmakePackage) {
  $candidate = Join-Path $cmakePackage.FullName 'bin\cmake.exe'
  if (Test-Path -LiteralPath $candidate) { $cmakePath = $candidate }
  $candidate = Join-Path $cmakePackage.FullName 'bin\ninja.exe'
  if (Test-Path -LiteralPath $candidate) { $ninjaPath = $candidate }
}
if (-not $cmakePath) { $cmakePath = (Get-Command cmake -ErrorAction SilentlyContinue).Source }
if (-not $ninjaPath) { $ninjaPath = (Get-Command ninja -ErrorAction SilentlyContinue).Source }
if (-not $cmakePath -or -not $ninjaPath) {
  throw 'Instale CMake e Ninja no Android SDK Manager (SDK Tools); ambos sÃ£o necessÃ¡rios para compilar o vocoder GPL.'
}

$boostRoot = $env:BOOST_ROOT
if (-not $boostRoot) {
  foreach ($candidate in @((Join-Path $projectRoot 'native\boost_1_88_0'), (Join-Path $moduleRoot 'boost_1_88_0'), (Join-Path $projectRoot 'native\vocoder-android\boost_1_88_0'))) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'boost\version.hpp')) { $boostRoot = $candidate; break }
  }
}
if (-not $boostRoot -or -not (Test-Path -LiteralPath (Join-Path $boostRoot 'boost\version.hpp'))) {
  throw 'Boost headers 1.88+ nÃ£o encontrados. Instale-os e defina BOOST_ROOT para a pasta que contÃ©m boost\version.hpp.'
}
if (-not (Test-Path -LiteralPath (Join-Path $moduleRoot 'CMakeLists.txt'))) { throw 'CÃ³digo-fonte GPL do vocoder nÃ£o encontrado.' }

$jniRoot = Join-Path $androidRoot 'app\src\main\jniLibs'
$env:ANDROID_NDK_HOME = $ndkPath
$abis = @('arm64-v8a')
foreach ($abi in $abis) {
  $buildDir = Join-Path $moduleRoot "build-android-$abi"
  $toolchain = Join-Path $ndkPath 'build\cmake\android.toolchain.cmake'
  $configureArgs = @(
        '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
        '-DCMAKE_CXX_STANDARD=17',
        '-DFMT_USE_NONTYPE_TEMPLATE_PARAMETERS=0',
        '-DCMAKE_CXX_FLAGS=-Wno-error -Wno-error=unused-command-line-argument',
    '-G', 'Ninja', '-S', $moduleRoot, '-B', $buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    "-DCMAKE_MAKE_PROGRAM=$ninjaPath",
    "-DCMAKE_TOOLCHAIN_FILE=$toolchain",
    "-DANDROID_ABI=$abi", '-DANDROID_PLATFORM=android-24', '-DANDROID_STL=c++_static',
    '-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-z,max-page-size=16384',
    '-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,max-page-size=16384',
    '-DCMAKE_FIND_ROOT_PATH_MODE_PROGRAM=BOTH', '-DCMAKE_POLICY_DEFAULT_CMP0167=OLD',
    '-DBoost_NO_BOOST_CMAKE=ON', "-DBOOST_ROOT=$boostRoot", "-DBoost_INCLUDE_DIR=$boostRoot", '-DBoost_ADDITIONAL_VERSIONS=1.88'
  )
  $vendoredDynarmic = Join-Path $projectRoot 'native\vocoder-android\dynarmic-source'
  if (Test-Path -LiteralPath (Join-Path $vendoredDynarmic 'CMakeLists.txt')) {
    $configureArgs += "-DFETCHCONTENT_SOURCE_DIR_DYNARMIC=$vendoredDynarmic"
  }
  & $cmakePath @configureArgs
  if ($LASTEXITCODE -ne 0) { throw "CMake nÃ£o conseguiu configurar o helper GPL para $abi." }
  & $cmakePath --build $buildDir --target qso_dmr_vocoder_helper --config Release --parallel 2
  if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o helper GPL para $abi." }
  $artifact = Join-Path $buildDir 'libqso_dmr_vocoder_helper.so'
  if (-not (Test-Path -LiteralPath $artifact)) { throw "CMake nÃ£o produziu o helper Android esperado: $artifact" }
  $destination = Join-Path (Join-Path $jniRoot $abi) 'libqso_dmr_vocoder_helper.so'
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath $artifact -Destination $destination -Force
  & (Join-Path $ndkPath 'toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-strip.exe') $destination
  if ($LASTEXITCODE -ne 0) { throw 'Unable to strip ARM64 vocoder helper.' }
  Write-Host "Helper vocoder compilado para ${abi}: $destination"
}

# ARMv7 runs the firmware natively; it cannot use the ARM64 Dynarmic CMake target.
& (Join-Path $moduleRoot 'build_android_v7a.bat')
if ($LASTEXITCODE -ne 0) { throw 'Failed to build ARMv7 vocoder helper.' }
$v7Artifact = Join-Path $moduleRoot 'build-android-v7a\libqso_dmr_vocoder_helper.so'
$v7Destination = Join-Path $jniRoot 'armeabi-v7a\libqso_dmr_vocoder_helper.so'
New-Item -ItemType Directory -Path (Split-Path -Parent $v7Destination) -Force | Out-Null
Copy-Item -LiteralPath $v7Artifact -Destination $v7Destination -Force
Write-Host "ARMv7 vocoder helper: $v7Destination"


