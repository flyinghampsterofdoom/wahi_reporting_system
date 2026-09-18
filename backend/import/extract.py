"""Read-only OOXML extraction. Preserves numeric lexemes, formulas and cached values."""
import zipfile,xml.etree.ElementTree as E,json,sys,pathlib,hashlib,posixpath
N={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def extract(path):
 with zipfile.ZipFile(path) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',N)]
  wb=E.fromstring(z.read('xl/workbook.xml'));rels={r.attrib['Id']:r.attrib['Target'] for r in E.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
  sheets=[]
  for sh in wb.findall('s:sheets/s:sheet',N):
   target=rels[sh.attrib['{'+N['r']+'}id']];p=target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/'+target)
   root=E.fromstring(z.read(p));rows=[]
   for row in root.findall('s:sheetData/s:row',N):
    cells={}
    for c in row.findall('s:c',N):
     v=c.find('s:v',N);f=c.find('s:f',N);typ=c.attrib.get('t','n');val=v.text if v is not None else None
     if typ=='s' and val is not None:val=strings[int(val)]
     if typ=='inlineStr':val=''.join(c.find('s:is',N).itertext())
     if val is not None or f is not None:cells[c.attrib['r']]={'value':val,'type':typ,**({'formula':f.text,'formulaAttributes':f.attrib} if f is not None else {})}
    if cells:rows.append({'row':int(row.attrib['r']),'cells':cells})
   sheets.append({'name':sh.attrib['name'],'state':sh.attrib.get('state','visible'),'dimension':root.find('s:dimension',N).attrib if root.find('s:dimension',N) is not None else {},'rows':rows})
  tables=[{'path':n,'attributes':E.fromstring(z.read(n)).attrib} for n in z.namelist() if n.startswith('xl/tables/') and n.endswith('.xml')]
  return {'file':str(pathlib.Path(path).resolve()),'sha256':hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest(),'sheets':sheets,'tables':tables,'definedNames':[{'attributes':x.attrib,'value':x.text} for x in wb.findall('s:definedNames/s:definedName',N)]}
if __name__=='__main__':
 data=extract(sys.argv[1]);pathlib.Path(sys.argv[2]).write_text(json.dumps(data,indent=2));print(json.dumps({'sha256':data['sha256'],'sheets':[{'name':s['name'],'rows':len(s['rows']),'dimension':s['dimension']} for s in data['sheets']],'tables':data['tables']},indent=2))
