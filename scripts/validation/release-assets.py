from pathlib import Path
import zipfile,hashlib,json
root=Path(__file__).resolve().parents[2]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
apk=root/f'release/ZapDMR-Android-{version}.apk'
with zipfile.ZipFile(apk) as z:
    checked=0
    for file in (root/'web').rglob('*'):
        if file.is_file():
            assert z.read('assets/public/'+file.relative_to(root/'web').as_posix())==file.read_bytes(),f'APK source mismatch: {file.name}'
            checked+=1
    assert not any(any(s in name.lower() for s in ('.dpapi','google-services.json','creds.json','.keystore','.jks','.env')) for name in z.namelist()),'Private configuration in APK'
    dex=b''.join(z.read(name) for name in z.namelist() if name.endswith('.dex'))
    for marker in (b'radioProfiles',b'profileBusy',b'xlxModule',b'hbpOptions',b'selectedGroup'):
        assert marker in dex,f'Missing native implementation: {marker!r}'
    for abi in ('arm64-v8a','armeabi-v7a'):
        assert f'lib/{abi}/libqso_dmr_vocoder_helper.so' in z.namelist()
print(f'PASS: {checked} final APK web assets, native XLX/profile methods, ARM64/ARMv7 vocoders, no private configuration filenames.')
print('Android SHA256',hashlib.sha256(apk.read_bytes()).hexdigest())
