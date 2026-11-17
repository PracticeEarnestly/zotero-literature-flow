#!/usr/bin/env python3
"""Deterministic, dependency-free XPI builder. Never installs or touches a Zotero profile."""
from pathlib import Path
import hashlib, json, zipfile
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'addon/manifest.json').read_text())
version=manifest['version']
out=ROOT/'dist';out.mkdir(exist_ok=True)
target=out/f'zotero-literature-flow-{version}.xpi'
files=[p for p in (ROOT/'addon').rglob('*') if p.is_file() and not any(x in p.parts for x in ['vendor','icons','defaults'])]
entries={str(p.relative_to(ROOT/'addon')):p.read_bytes() for p in files}
entries['LICENSE']=(ROOT/'LICENSE').read_bytes()
entries['NOTICE.md']=(ROOT/'NOTICE.md').read_bytes()
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,data in sorted(entries.items()):
        info=zipfile.ZipInfo(name,(2026,10,22,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        info.create_system=3;info.external_attr=0o100644<<16
        z.writestr(info,data,compresslevel=9)
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert set(z.namelist())==set(entries)
    assert 'bootstrap.js' in z.namelist()
digest=hashlib.sha256(target.read_bytes()).hexdigest()
(target.with_suffix('.xpi.sha256')).write_text(f'{digest}  {target.name}\n')
print(json.dumps({'file':str(target),'version':version,'files':len(entries),'sha256':digest},indent=2))
