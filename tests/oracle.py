#!/usr/bin/env python3
"""Oracle for PdfLens: structure facts from REAL pypdf, plus raw-bytes checks
(header version, %%EOF presence) done independently in plain python."""
from pypdf import PdfReader
import json, os, re

def dump(path, password=None):
    raw = open(path,'rb').read()
    out = {'file': os.path.basename(path)}
    m = re.search(rb'%PDF-(\d\.\d)', raw[:1024])
    out['version'] = m.group(1).decode() if m else None
    out['has_eof'] = b'%%EOF' in raw[-1024:]
    out['size'] = len(raw)
    if out['file'] == 'truncated.pdf':
        out['expect_warning'] = 'truncated'
        return out
    r = PdfReader(path)
    out['encrypted'] = r.is_encrypted
    if r.is_encrypted and password:
        r.decrypt(password)
    out['pages'] = len(r.pages)
    out['objects_gen0'] = len(r.xref.get(0, []))
    out['pages_root_count'] = int(r.root_object['/Pages']['/Count'])
    md = r.metadata or {}
    for k in ['/Title','/Author','/Subject','/Keywords','/Creator','/Producer']:
        if k in md and md[k] is not None:
            out[k[1:].lower()] = str(md[k])
    return out

items = []
items.append(dump('tests/corpus/simple.pdf'))
items.append(dump('tests/corpus/meta.pdf'))
items.append(dump('tests/corpus/many.pdf'))
items.append(dump('tests/corpus/encrypted.pdf', password='lock123'))
items.append(dump('tests/corpus/truncated.pdf'))
json.dump({'items': items}, open('tests/expected.json','w'), indent=1)
open('tests/expected.json','a').write('\n')
for it in items:
    print(it)
