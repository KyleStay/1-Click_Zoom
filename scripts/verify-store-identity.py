"""Verify a public Chrome Web Store CRX3 signature and derive its extension ID."""
import struct,hashlib,base64,io,zipfile,json,subprocess,tempfile
from pathlib import Path
p=Path('evidence/store-production.crx');data=p.read_bytes()
assert data[:4]==b'Cr24' and struct.unpack('<I',data[4:8])[0]==3
length=struct.unpack('<I',data[8:12])[0];header=data[12:12+length];payload=data[12+length:]
def fields(data):
 def varint(i):
  x=0;n=0
  while True:
   b=data[i];i+=1;x|=(b&127)<<n;n+=7
   if b<128:return x,i
 i=0;result=[]
 while i<len(data):
  key,i=varint(i);assert key&7==2
  size,i=varint(i);result.append((key>>3,data[i:i+size]));i+=size
 return result
values=fields(header);signed=next(v for k,v in values if k==10000)
message=b'CRX3 SignedData\x00'+struct.pack('<I',len(signed))+signed+payload
expected='dgagkdkdaliokkoahnfaonddgdejfbod';verified=False
for kind,proof in values:
 if kind!=2:continue
 f=dict(fields(proof));der=f[1];digest=hashlib.sha256(der).hexdigest()[:32];identity=''.join(chr(97+int(c,16)) for c in digest)
 if identity!=expected:continue
 with tempfile.TemporaryDirectory(prefix='zoom-public-verification-') as tmp:
  r=Path(tmp);(r/'public.der').write_bytes(der);(r/'signature').write_bytes(f[2]);(r/'signed').write_bytes(message)
  subprocess.run(['openssl','pkey','-pubin','-inform','DER','-in',str(r/'public.der'),'-out',str(r/'public.pem')],check=True,capture_output=True)
  subprocess.run(['openssl','dgst','-sha256','-verify',str(r/'public.pem'),'-signature',str(r/'signature'),str(r/'signed')],check=True,capture_output=True)
 assert dict(fields(signed))[1].hex()==hashlib.sha256(der).hexdigest()[:32]
 Path('evidence/production-public-key.txt').write_text(base64.b64encode(der).decode()+'\n');verified=True
assert verified,'No verified proof for expected identity'
with zipfile.ZipFile(io.BytesIO(payload)) as z:m=json.loads(z.read('manifest.json'))
record={'storeUrl':'https://chromewebstore.google.com/detail/1-click-zoom/'+expected,'sourceUrl':'https://github.com/KyleStay/1-Click_Zoom','extensionId':expected,'storeVersion':m['version'],'crxSha256':hashlib.sha256(data).hexdigest(),'signatureVerification':'CRX3 RSA SHA-256 verified with matching public key and signed extension ID','publicKeyFile':'evidence/production-public-key.txt','privateKeysReadOrCreated':False}
Path('evidence/production-identity.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))
