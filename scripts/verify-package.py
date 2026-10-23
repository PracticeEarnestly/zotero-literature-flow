#!/usr/bin/env python3
"""Check XPI structure, prompt digests, text assets and accidental secrets/private addresses."""
import hashlib,json,re,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1]
v=json.loads((root/'package.json').read_text())['version'];p=root/'dist'/f'zotero-literature-flow-{v}.xpi'
with zipfile.ZipFile(p) as z:
    assert z.testzip() is None
    m=json.loads(z.read('manifest.json'));assert m['version']==v
    assert m['applications']['zotero']['id']=='literatureflow@zotero.local'
    assert m['applications']['zotero']['update_url'].endswith('/updates.json')
    ET.fromstring(z.read('content/panel.xhtml'))
    pack=json.loads(z.read('content/contracts/legacy.json'))
    for stage in pack['stages'].values():assert hashlib.sha256(stage['rawPrompt'].encode()).hexdigest()==stage['rawSha256']
    patterns=[r'gh[pousr]_[A-Za-z0-9]{20,}',r'sk-[A-Za-z0-9_-]{20,}',r'http[s]?://(?:10\.[\d.]+|192\.168\.[\d.]+|172\.(?:1[6-9]|2\d|3[01])\.[\d.]+)',r'BEGIN (?:OPENSSH |RSA )?PRIVATE KEY']
    for name in z.namelist():
        data=z.read(name).decode('utf-8')
        for pattern in patterns:assert not re.search(pattern,data),f'private material in {name}'
        assert not name.startswith(('.local/','tests/'))
print('PASS: ZIP, manifest, XHTML, frozen prompt hashes, no private endpoint/key patterns')
