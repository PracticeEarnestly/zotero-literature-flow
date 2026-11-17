#!/usr/bin/env python3
"""Archive tracked source, excluding binary dist assets and private local snapshots."""
from pathlib import Path
import json,subprocess,zipfile,hashlib
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text())['version']
paths=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
target=root/'dist'/f'zotero-literature-flow-{version}-source.zip'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in sorted(paths):
        if not name or name.startswith('dist/') or not (root/name).is_file():continue
        info=zipfile.ZipInfo(name,(2026,10,22,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100644<<16
        z.writestr(info,(root/name).read_bytes(),compresslevel=9)
target.with_suffix('.zip.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest()+'  '+target.name+'\n')
print(target)
