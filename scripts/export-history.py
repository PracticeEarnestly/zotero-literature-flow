#!/usr/bin/env python3
"""Read a CLOSED Zotero database or consistent backup; output is PRIVATE."""
import argparse, collections, datetime, hashlib, json, pathlib, sqlite3

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('database', type=pathlib.Path)
p.add_argument('output', type=pathlib.Path)
a = p.parse_args()
c = sqlite3.connect(a.database.resolve().as_uri() + '?mode=ro', uri=True)
c.row_factory = sqlite3.Row
c.execute('BEGIN')
uid = c.execute("SELECT value FROM settings WHERE setting='account' AND key='userID'").fetchone()
assert uid, 'A stable user scope is required'
lib = c.execute("SELECT libraryID FROM libraries WHERE type='user'").fetchone()[0]
tags = collections.defaultdict(list)
for r in c.execute('SELECT itemID,name FROM itemTags JOIN tags USING(tagID)'):
    tags[r['itemID']].append(r['name'])
fields = collections.defaultdict(dict)
for r in c.execute("SELECT itemID,fieldName,value FROM itemData JOIN fields USING(fieldID) JOIN itemDataValues USING(valueID) WHERE fieldName IN ('title','extra')"):
    fields[r['itemID']][r['fieldName']] = r['value']
notes = collections.defaultdict(list)
for r in c.execute('SELECT itemID,parentItemID,key,note FROM itemNotes JOIN items USING(itemID) WHERE itemID NOT IN (SELECT itemID FROM deletedItems)'):
    notes[r['parentItemID']].append({'id':r['itemID'],'key':r['key'],'html':r['note'],'tags':tags[r['itemID']]})
items = []
for r in c.execute("SELECT i.* FROM items i JOIN itemTypes t USING(itemTypeID) WHERE libraryID=? AND t.typeName NOT IN ('note','attachment','annotation') AND itemID NOT IN (SELECT itemID FROM deletedItems)", (lib,)):
    n = r['itemID']
    items.append({'id':n,'key':r['key'],'scope':'user:'+str(uid[0]),'libraryID':lib,'title':fields[n].get('title',''),'extra':fields[n].get('extra',''),'tags':tags[n],'notes':notes[n], 'dateAdded':int(datetime.datetime.fromisoformat(r['dateAdded']).replace(tzinfo=datetime.timezone.utc).timestamp()*1000),'writable':True,'deleted':False})
all_notes = [{'id':r[0], 'key':r[1], 'sha256':hashlib.sha256(r[2].encode()).hexdigest()} for r in c.execute('SELECT itemID,key,note FROM itemNotes JOIN items USING(itemID) ORDER BY itemID')]
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.write_text(json.dumps({'items':items,'allNoteHashes':all_notes},ensure_ascii=False))
a.output.chmod(0o600)
print(json.dumps({'regularItems':len(items),'allNotes':len(all_notes),'outputPrivate':str(a.output)}))
