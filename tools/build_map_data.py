"""Step 2: slim map file + WV/county outlines for the static site."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
NBI_YEAR=_os.environ.get('NBI_YEAR','2025')   # year of the FHWA file; its file is tools/work/raw/WV<yy>.txt
NBI_FILE='WV'+NBI_YEAR[-2:]+'.txt'
import json, re, pandas as pd, geopandas as gpd
W=ROOT; RAW=WORK+'raw/'; OUT=W+'data/'
B=json.load(open(WORK+'bridges.json'))
d=pd.read_csv(RAW+NBI_FILE,dtype=str,quotechar="'",encoding='latin1').fillna('').apply(lambda s:s.str.strip())
assert len(d)==len(B) and all(d.STRUCTURE_NUMBER_008==[b['id'] for b in B])
PFX={'1':'Interstate','2':'US route','3':'WV route','4':'County route'}
def route(carries,pfx):
    t=carries.upper().replace('.','')
    m=re.match(r'^(?:I|INTERSTATE)\s*-?\s*(\d+)',t)
    if m: return 'Interstate','I-'+str(int(m.group(1)))
    m=re.match(r'^(?:US|U S)\s*(?:ROUTE|RT)?\s*(\d+)',t)
    if m: return 'US route','US '+str(int(m.group(1)))
    m=re.match(r'^(?:WV|W V|WEST VIRGINIA|WEST VA)\s*(?:STATE)?\s*(?:ROUTE|RT)?\s*(\d+)',t)
    if m: return 'WV route','WV '+str(int(m.group(1)))
    return PFX.get(pfx,'Other road'),''
def tgroup(t):
    for k in ('Culvert','Slab','Arch','Truss'):
        if t.startswith(k): return k
    if 'Box' in t: return 'Box beam'
    if t in ('Beam or girder','Girder and floorbeam','Tee beam','Channel beam'): return 'Beam or girder'
    return 'Other'
TYPES=['Beam or girder','Box beam','Slab','Arch','Truss','Culvert','Other']
rows=[]
for b,(_,r) in zip(B,d.iterrows()):
    rc,rl=route(b['carries'],r.ROUTE_PREFIX_005B)
    rows.append([b['id'],re.sub(r'\b(Wv|Us|Cr|Sr)(?=\d)',lambda m:m.group(1).upper(),b['name']),b['county'],rl,['Interstate','US route','WV route','County route','Other road'].index(rc),
      b['lat'],b['lon'],'GFP'.index(b['overall'][0]),TYPES.index(tgroup(b['type'])),
      1 if b['owner']=='State highway agency' else 0,b['owner'],b['year_built'],b['adt'],1 if b['scour_risk'] else 0,
      {'':0,'Not in listed county':1,'No location':2,'Outside WV':1}[b['loc_flag']],
      1 if (b['adt'] or 0)>200000 else 0,b['type'],b['location']])  # WV's busiest bridges carry ~135k/day; above 200k is a data-entry error
meta={'source':'FHWA National Bridge Inventory, West Virginia, '+NBI_YEAR+' file','built':pd.Timestamp.today().strftime('%Y-%m-%d'),
 'fields':['id','name','county','route','routeClass','lat','lon','cond','type','wvdoh','owner','year','adt','scour','locFlag','adtOdd','typeName','place'],
 'routeClasses':['Interstate','US route','WV route','County route','Other road'],'conditions':['Good','Fair','Poor'],'types':TYPES}
json.dump({'meta':meta,'rows':rows},open(OUT+'bridges-map.json','w'),separators=(',',':'))
c=gpd.read_file('zip://'+RAW+'counties.zip'); c=c[c.STATEFP=='54'][['NAME','geometry']].to_crs(4326)
st=c.dissolve().boundary.simplify(0.002).to_frame('geometry')  # outline from full-detail counties, so no slivers
c['geometry']=c.geometry.simplify(0.003,preserve_topology=True)
c.to_file(OUT+'counties.geojson',driver='GeoJSON',COORDINATE_PRECISION=4); st.to_file(OUT+'wv-outline.geojson',driver='GeoJSON',COORDINATE_PRECISION=4)
R=pd.DataFrame(rows,columns=meta['fields'])
print(len(R), R.cond.value_counts().sort_index().to_dict(), R.routeClass.value_counts().sort_index().to_dict(), R.type.value_counts().sort_index().to_dict())
print('routes parsed', (R.route!='').sum(), R[R.route!=''].route.nunique())
import os; [print(f,os.path.getsize(OUT+f)//1024,'KB') for f in os.listdir(OUT)]
