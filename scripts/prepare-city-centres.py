"""Build offline GeoNames city centres. No operator data is sent to a geocoder."""
from pathlib import Path
import urllib.request,zipfile,json,io,collections
root=Path(__file__).resolve().parents[1]
base='https://download.geonames.org/export/dump/'
def get(name):
 return urllib.request.urlopen(urllib.request.Request(base+name,headers={'User-Agent':'ZapDMR/1.4.9 (https://www.zapdmr.com.br)'}),timeout=120).read()
admin={}
for line in get('admin1CodesASCII.txt').decode().splitlines():
 p=line.split('\t')
 if len(p)>=3:admin[p[0]]=p[2]
groups=collections.defaultdict(list)
with zipfile.ZipFile(io.BytesIO(get('cities500.zip'))) as z:
 for line in z.read('cities500.txt').decode().splitlines():
  p=line.split('\t')
  if len(p)<19 or len(p[8])!=2:continue
  groups[p[8].lower()].append([p[1],p[2],round(float(p[4]),5),round(float(p[5]),5),p[10],admin.get(p[8]+'.'+p[10],''),int(p[14] or 0)])
out=root/'web/cities';out.mkdir(exist_ok=True)
for country,rows in groups.items():(out/(country+'.json')).write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(out/'index.json').write_text(json.dumps(sorted(groups)),encoding='utf-8')
(out/'LICENSE.txt').write_text('City centres: GeoNames, https://www.geonames.org/\nSource: cities500.zip and admin1CodesASCII.txt, downloaded 2026-10-23.\nCreative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/\nConverted to per-country JSON with rounded coordinates. Approximate city centres, not operator GPS. No warranty of accuracy or completeness.\n',encoding='utf-8')
print('Offline city centres:',sum(map(len,groups.values())),'cities;',len(groups),'countries')
