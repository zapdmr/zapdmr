$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$jdkRoot=if($env:JAVA_HOME){$env:JAVA_HOME}else{'C:\Users\User\.jdks\jbr-21.0.11'}
$cmake=Join-Path $env:LOCALAPPDATA 'Android\Sdk\cmake\3.22.1\bin\cmake.exe'
Push-Location $projectRoot
try {
 & $cmake -S scripts/validation/vox-host -B work/vad-host-repro -G 'Visual Studio 17 2022' -A x64 "-DJAVA_HOME=$jdkRoot"
 if($LASTEXITCODE -ne 0){throw 'Falha ao preparar teste nativo'}
 & $cmake --build work/vad-host-repro --config Release
 if($LASTEXITCODE -ne 0){throw 'Falha ao compilar teste nativo'}
 & .\work\vad-host-repro\vadcore\Release\carvad_check.exe android/app/src/test/resources/webrtc-test-audio.raw
 if($LASTEXITCODE -ne 0){throw 'VAD nativo falhou'}
 & (Join-Path $jdkRoot 'bin\javac.exe') -d work/vad-java-repro android/app/src/main/java/br/radio/zapdmr/WebRtcVad.java android/app/src/main/java/br/radio/zapdmr/CarVoxGate.java scripts/validation/VoxJniCheck.java
 if($LASTEXITCODE -ne 0){throw 'Falha ao compilar teste JNI'}
 & (Join-Path $jdkRoot 'bin\java.exe') '-Djava.library.path=work/vad-host-repro/Release' -cp work/vad-java-repro br.radio.zapdmr.VoxJniCheck android/app/src/test/resources/webrtc-test-audio.raw
 if($LASTEXITCODE -ne 0){throw 'Integração JNI/VAD falhou'}
}finally{Pop-Location}
