from pathlib import Path
import zipfile, hashlib
root=Path(__file__).resolve().parents[2]
apk=root/'release/ZapDMR-Android-1.4.6.apk'
with zipfile.ZipFile(apk) as z:
    checked=0
    for file in (root/'web').iterdir():
        if file.is_file():
            assert z.read('assets/public/'+file.name)==file.read_bytes(),f'APK source mismatch: {file.name}'
            checked+=1
    assert not any(any(s in name.lower() for s in ('.dpapi','google-services.json','creds.json','.keystore','.jks','.env')) for name in z.namelist()),'Private configuration in APK'
print(f'PASS: {checked} APK web assets match final sources; no private configuration filenames.')
print('Android SHA256',hashlib.sha256(apk.read_bytes()).hexdigest())
