import json,zipfile,unittest,subprocess,base64,hashlib
from pathlib import Path
class Packages(unittest.TestCase):
 def test_assets_identity_permissions(self):
  original=json.loads(subprocess.check_output(['git','show','HEAD:manifest.json']))
  for package in Path('dist').glob('*.zip'):
   with zipfile.ZipFile(package) as z:
    self.assertIsNone(z.testzip());m=json.loads(z.read('manifest.json'));self.assertEqual(m['permissions'],original['permissions']);self.assertNotIn('externally_connectable',m)
    if 'replacement' in package.name:
     digest=hashlib.sha256(base64.b64decode(m['key'],validate=True)).hexdigest()[:32]
     self.assertEqual(''.join(chr(97+int(c,16)) for c in digest),'dgagkdkdaliokkoahnfaonddgdejfbod')
     self.assertEqual(m['version_name'],'4.1.1 replacement candidate')
    else:self.assertNotIn('key',m)
    for r in [m['background']['service_worker'],m['action']['default_popup'],*m['icons'].values()]:self.assertIn(r,z.namelist())
    self.assertFalse(any(x.startswith('.git') or x.endswith(('.pem','.key','.p12')) for x in z.namelist()))
 def test_dev_label_and_passive_guard(self):
  m=json.loads(Path('dist/dev/manifest.json').read_text());self.assertEqual(m['version'],'4.1.1.1');self.assertTrue(m['version_name'].endswith(' manual development'));self.assertIn('automatic zoom and learning are paused',Path('dist/dev/popup.html').read_text())
if __name__=='__main__':unittest.main()
