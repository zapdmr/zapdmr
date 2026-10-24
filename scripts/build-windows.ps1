param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22 ou superior antes de compilar.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd não foi encontrado no PATH.' }
$nodeVersion = node --version
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ necessário; encontrado $nodeVersion." }

$audioSidecar = Join-Path $PSScriptRoot '..\native\build\audio-sidecar-vs2022\bin\ZapDMRAudio.exe'
if (-not (Test-Path -LiteralPath $audioSidecar -PathType Leaf) -or (Get-Item (Join-Path $projectRoot 'native/audio-sidecar/src/main.cpp')).LastWriteTimeUtc -gt (Get-Item $audioSidecar -ErrorAction SilentlyContinue).LastWriteTimeUtc) {
  & (Join-Path $PSScriptRoot 'build-audio-sidecar.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'A compilação do ZapDMRAudio falhou.' }
}

$vocoderAssets = Join-Path $projectRoot 'assets\vocoder'
$requiredAssets = @('D002.032.bin', 'd02032-core.img')
foreach ($asset in $requiredAssets) {
  if (-not (Test-Path -LiteralPath (Join-Path $vocoderAssets $asset) -PathType Leaf)) {
    throw "Asset de vocoder ausente: $(Join-Path $vocoderAssets $asset)"
  }
}
$vocoderDll = @('qso_dmr_vocoder.dll', 'qdv_dmr_vocoder.dll') |
  ForEach-Object { Join-Path $vocoderAssets $_ } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $vocoderDll) { throw "DLL do vocoder ausente em $vocoderAssets." }
function Get-Sha256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '') }
  finally { $sha256.Dispose(); $stream.Dispose() }
}
$firmwareHash = Get-Sha256Hex (Join-Path $vocoderAssets 'D002.032.bin')
$coreHash = Get-Sha256Hex (Join-Path $vocoderAssets 'd02032-core.img')
if ($firmwareHash -ne 'C0351F250A834660641BCA3B06BE931C80CC1ED0EF808356C550B99CD0F4C632' -or
    $coreHash -ne 'D40398183E9AA8DB6288A62D9A0E0C233CB143EF5633680ABD829CC03C719F66') {
  throw 'Os hashes dos firmwares em assets/vocoder não correspondem aos esperados pelo ZapDMRAudio.'
}

Push-Location $projectRoot
try {
  if (-not $SkipInstall) {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }
  }
  & npm.cmd run package:win
  if ($LASTEXITCODE -ne 0) { throw 'A compilação do servidor ou o empacotamento Electron Forge falhou.' }

  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
  $appDirectory = Join-Path $projectRoot 'out\ZapDMR-win32-x64'
  $releaseDirectory = Join-Path $projectRoot 'out\make\squirrel.windows\x64'
  $vendorDirectory = Join-Path $projectRoot 'node_modules\electron-winstaller\vendor'
  $squirrelExe = Join-Path $vendorDirectory 'Squirrel.exe'
  $setupIcon = Join-Path $projectRoot 'assets\ZapDMR.ico'
  $loadingGif = Join-Path $projectRoot 'node_modules\electron-winstaller\resources\install-spinner.gif'
  $temporaryPackageDirectory = Join-Path $env:TEMP ('zapdmr-build-' + [guid]::NewGuid().ToString('N'))
  $nupkgPath = Join-Path $temporaryPackageDirectory ("zapdmr.$($package.version).nupkg")

  if (-not (Test-Path -LiteralPath $appDirectory -PathType Container)) { throw "Pasta Electron ausente: $appDirectory" }
  if (-not (Test-Path -LiteralPath $squirrelExe -PathType Leaf)) { throw "Squirrel.exe ausente: $squirrelExe" }
  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $temporaryPackageDirectory | Out-Null
  $releaseInputPath = Join-Path $releaseDirectory ("zapdmr.$($package.version).nupkg")
  if (Test-Path -LiteralPath $releaseInputPath) { Remove-Item -LiteralPath $releaseInputPath -Force }

  $fileStream = [System.IO.File]::Open($nupkgPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  $archive = [System.IO.Compression.ZipArchive]::new($fileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
  try {
    function Add-ZipText([System.IO.Compression.ZipArchive]$Archive, [string]$Name, [string]$Text) {
      $entry = $Archive.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
      $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
      try { $writer.Write($Text) } finally { $writer.Dispose() }
    }

    $version = [System.Security.SecurityElement]::Escape([string]$package.version)
    $productName = [System.Security.SecurityElement]::Escape([string]$package.productName)
    $description = [System.Security.SecurityElement]::Escape([string]$package.description)
    $authors = [System.Security.SecurityElement]::Escape([string]$package.author)
    $nuspec = "<?xml version=`"1.0`" encoding=`"utf-8`"?><package xmlns=`"http://schemas.microsoft.com/packaging/2010/07/nuspec.xsd`"><metadata><id>zapdmr</id><title>$productName</title><version>$version</version><authors>$authors</authors><owners>$authors</owners><requireLicenseAcceptance>false</requireLicenseAcceptance><description>$description</description><copyright>Copyright 2026 ZapDMR</copyright></metadata></package>"
    $relationships = '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="R1" Type="http://schemas.microsoft.com/packaging/2010/07/manifest" Target="/zapdmr.nuspec" /></Relationships>'
    Add-ZipText $archive 'zapdmr.nuspec' $nuspec
    Add-ZipText $archive '_rels/.rels' $relationships

    $appFiles = @(Get-ChildItem -LiteralPath $appDirectory -Recurse -File)
    $extensions = [System.Collections.Generic.SortedSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $extensionlessEntries = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $appFiles) {
      $relativePath = $file.FullName.Substring($appDirectory.Length).TrimStart('\') -replace '\\', '/'
      $entryName = "lib/net45/$relativePath"
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      if ($file.Extension) {
        [void]$extensions.Add($file.Extension.TrimStart('.').ToLowerInvariant())
      } else {
        $extensionlessEntries.Add($entryName)
      }
    }

    $squirrelEntry = $archive.CreateEntry('lib/net45/squirrel.exe', [System.IO.Compression.CompressionLevel]::Optimal)
    $squirrelSource = [System.IO.File]::OpenRead($squirrelExe)
    $squirrelTarget = $squirrelEntry.Open()
    try { $squirrelSource.CopyTo($squirrelTarget) } finally { $squirrelTarget.Dispose(); $squirrelSource.Dispose() }

    $contentTypes = [System.Text.StringBuilder]::new()
    [void]$contentTypes.Append('<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="nuspec" ContentType="application/octet"/>')
    foreach ($extension in $extensions) {
      [void]$contentTypes.Append("<Default Extension=`"$extension`" ContentType=`"application/octet`"/>")
    }
    foreach ($entryName in $extensionlessEntries) {
      [void]$contentTypes.Append("<Override PartName=`"/$entryName`" ContentType=`"application/octet`"/>")
    }
    [void]$contentTypes.Append('</Types>')
    Add-ZipText $archive '[Content_Types].xml' $contentTypes.ToString()
  } finally {
    $archive.Dispose()
    $fileStream.Dispose()
  }

  $squirrelArguments = '--releasify "' + $nupkgPath + '" --releaseDir "' + $releaseDirectory + '" --loadingGif "' + $loadingGif + '" --setupIcon "' + $setupIcon + '" --no-msi --no-delta'
  $squirrelProcess = Start-Process -FilePath $squirrelExe -ArgumentList $squirrelArguments -Wait -PassThru -WindowStyle Hidden
  if ($squirrelProcess.ExitCode -ne 0) { throw "Squirrel falhou com código $($squirrelProcess.ExitCode). Consulte Squirrel-Releasify.log em $vendorDirectory." }

  $setupPath = Join-Path $releaseDirectory 'Setup.exe'
  $installerPath = Join-Path $releaseDirectory 'ZapDMR-Setup.exe'
  if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) { throw 'Squirrel terminou sem gerar Setup.exe.' }
  Move-Item -LiteralPath $setupPath -Destination $installerPath -Force

  $fullPackagePath = Join-Path $releaseDirectory ("zapdmr-$($package.version)-full.nupkg")
  $requiredEntries = @(
    'lib/net45/resources/ZapDMRAudio.exe',
    'lib/net45/resources/vocoder/D002.032.bin',
    'lib/net45/resources/vocoder/d02032-core.img',
    ('lib/net45/resources/vocoder/' + (Split-Path -Leaf $vocoderDll))
  )
  $fullPackage = [System.IO.Compression.ZipFile]::OpenRead($fullPackagePath)
  try {
    $entryNames = @($fullPackage.Entries | ForEach-Object { $_.FullName })
    foreach ($requiredEntry in $requiredEntries) {
      if ($entryNames -notcontains $requiredEntry) { throw "Asset ausente no pacote final: $requiredEntry" }
    }
  } finally { $fullPackage.Dispose() }

  if (-not (Test-Path -LiteralPath (Join-Path $releaseDirectory 'RELEASES') -PathType Leaf)) { throw 'Arquivo RELEASES ausente.' }
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw 'ZapDMR-Setup.exe ausente.' }
  # Publish these three assets together. The in-app updater consumes the full
  # Squirrel package; publishing only the .exe cannot enable future updates.
  $publishDirectory = Join-Path $projectRoot ("release\windows-$($package.version)")
  New-Item -ItemType Directory -Path $publishDirectory -Force | Out-Null
  $publicInstallerName = "ZapDMR-Windows-$($package.version).exe"
  $publicPackageName = Split-Path -Leaf $fullPackagePath
  Copy-Item -LiteralPath $installerPath -Destination (Join-Path $publishDirectory $publicInstallerName) -Force
  Copy-Item -LiteralPath $fullPackagePath -Destination (Join-Path $publishDirectory $publicPackageName) -Force
  $releaseLine = @(Get-Content -LiteralPath (Join-Path $releaseDirectory 'RELEASES') | Where-Object { $_ -match (' ' + [regex]::Escape($publicPackageName) + ' ') })
  if ($releaseLine.Count -ne 1) { throw 'RELEASES não contém exatamente um pacote da versão atual.' }
  [IO.File]::WriteAllText((Join-Path $publishDirectory 'RELEASES'), $releaseLine[0] + "`n", [Text.UTF8Encoding]::new($false))
  $sumLines = @($publicInstallerName, $publicPackageName, 'RELEASES') | ForEach-Object { (Get-Sha256Hex (Join-Path $publishDirectory $_)).ToLowerInvariant() + '  ' + $_ }
  [IO.File]::WriteAllText((Join-Path $publishDirectory 'SHA256SUMS.txt'), ($sumLines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  $resolvedTempPackageDirectory = [System.IO.Path]::GetFullPath($temporaryPackageDirectory)
  if ($resolvedTempPackageDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTempPackageDirectory) -match '^zapdmr-build-[0-9a-f]{32}$') {
    Remove-Item -LiteralPath $resolvedTempPackageDirectory -Recurse -Force
  }
  Write-Host "Instalador criado: $installerPath"
  Write-Host "Pacote Squirrel: $fullPackagePath"
}
finally { Pop-Location }
