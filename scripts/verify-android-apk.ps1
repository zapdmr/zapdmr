param([string]$Path = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release\ZapDMR-Android-1.3.0.apk'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk=[IO.Compression.ZipFile]::OpenRead($Path)
try {
    $hashes=@{
        'assets/firmware/D002.032.bin'='c0351f250a834660641bca3b06be931c80cc1ed0ef808356c550b99cd0f4c632'
        'assets/firmware/d02032-core.img'='d40398183e9aa8db6288a62d9a0e0c233cb143ef5633680abd829cc03c719f66'
    }
    foreach($name in $hashes.Keys){
        $entry=$apk.GetEntry($name)
        if($null -eq $entry){throw "Recurso ausente: $name"}
        $inputStream=$entry.Open()
        $sha=[Security.Cryptography.SHA256]::Create()
        try{$hash=([BitConverter]::ToString($sha.ComputeHash($inputStream))).Replace('-','').ToLowerInvariant()}
        finally{$sha.Dispose();$inputStream.Dispose()}
        if($hash -ne $hashes[$name]){throw "Hash incorreto no APK: $name"}
        Write-Output "PASS: $name ($($entry.Length) bytes; SHA-256 verificado)"
    }
    foreach($name in @('assets/public/catalog-store.js','lib/arm64-v8a/libqso_dmr_vocoder_helper.so','lib/armeabi-v7a/libqso_dmr_vocoder_helper.so')){
        if($null -eq $apk.GetEntry($name)){throw "Recurso ausente: $name"}
    }
    if($apk.Entries.FullName -match '\.jks$|/release\.json$'){throw 'Chave de assinatura encontrada no APK'}
    Write-Output 'PASS: catálogo e ambos os helpers ARM presentes; nenhuma chave privada incluída.'
} finally {$apk.Dispose()}
