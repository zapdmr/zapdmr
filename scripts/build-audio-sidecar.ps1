$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceDir = Join-Path $projectRoot 'native\audio-sidecar'
# Use a dedicated build directory so a previous NMake cache cannot conflict
# with the Visual Studio generator below.
$buildDir = Join-Path $projectRoot 'native\build\audio-sidecar-vs2022'

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  throw 'CMake não encontrado. Abra o Developer PowerShell do Visual Studio 2022 x64.'
}

cmake -S $sourceDir -B $buildDir -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw 'Configuração CMake do ZapDMRAudio falhou.' }

cmake --build $buildDir --config Release
if ($LASTEXITCODE -ne 0) { throw 'Compilação do ZapDMRAudio falhou.' }

$exe = Join-Path $buildDir 'bin\ZapDMRAudio.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Executável não encontrado: $exe" }
Get-Item -LiteralPath $exe | Select-Object FullName, Length, LastWriteTime
