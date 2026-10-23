import json,zipfile,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
manifest=json.loads((ROOT/'manifest.json').read_text())
records=[]
for channel in ['production','dev']:
 out=ROOT/'dist'/channel
 if out.exists():shutil.rmtree(out)
 out.mkdir(parents=True)
 for name in ['background.js','popup.html','popup.js','sites.html','sites.js']:
  shutil.copyfile(ROOT/name,out/name)
 shutil.copytree(ROOT/'images',out/'images')
 m=json.loads(json.dumps(manifest))
 if channel=='dev':
  m['name']+=' Dev'
  m['version']+='.'+'1'
  m['version_name']=manifest['version']+' manual development'
  for name in ['popup.html','sites.html']:
   p=out/name;s=p.read_text().replace('1-Click Zoom','1-Click Zoom Dev').replace('<body>','<body>\n<p>Manual dev mode: automatic zoom and learning are paused. Manual controls still affect browser tabs.</p>');p.write_text(s)
 (out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 archive=ROOT/'dist'/f"one-click-zoom-{channel}-{m['version']}.zip"
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in sorted(out.rglob('*')):
   if p.is_file():
    i=zipfile.ZipInfo(p.relative_to(out).as_posix(),(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16;z.writestr(i,p.read_bytes())
 records.append({'path':str(archive),'version':m['version'],'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()})
(ROOT/'dist'/'packages.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records,indent=2))
