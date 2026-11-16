"""Step 1: clean the WV NBI file into bridges.json + summary."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
NBI_YEAR=_os.environ.get('NBI_YEAR','2025')   # year of the FHWA file; its file is tools/work/raw/WV<yy>.txt
NBI_FILE='WV'+NBI_YEAR[-2:]+'.txt'
import pandas as pd, geopandas as gpd, json, sys
from shapely.geometry import Point
RAW=WORK+'raw/'; OUT=WORK
d=pd.read_csv(RAW+NBI_FILE,dtype=str,quotechar="'",encoding='latin1').fillna('')
d=d.apply(lambda s:s.str.strip())
def dms(v,deg):
    v=v.zfill(deg+6)
    try: D=int(v[:deg]);M=int(v[deg:deg+2]);S=int(v[deg+2:])/100
    except: return None
    if D==0: return None
    return round(D+M/60+S/3600,6)
d['lat']=d.LAT_016.map(lambda v:dms(v,2)); d['lon']=d.LONG_017.map(lambda v:dms(v,3)); d['lon']=-d['lon']
cty=gpd.read_file('zip://'+RAW+'counties.zip'); cty=cty[cty.STATEFP=='54'][['COUNTYFP','NAME','geometry']].to_crs(4326)
names=dict(zip(cty.COUNTYFP,cty.NAME))
d['county']=d.COUNTY_CODE_003.str.zfill(3).map(names).fillna('Unknown')
pts=gpd.GeoDataFrame(d,geometry=[Point(x,y) if pd.notna(x) and pd.notna(y) else None for x,y in zip(d.lon,d.lat)],crs=4326)
j=gpd.sjoin(pts[pts.geometry.notna()],cty[['COUNTYFP','geometry']],how='left',predicate='within')
j=j[~j.index.duplicated()]
d['pt_county']=j.COUNTYFP.reindex(d.index)
# distance (mi) from listed county when outside it
cty_m=cty.set_index('COUNTYFP').to_crs(5070); pts_m=pts.to_crs(5070)
def dist(i):
    c=d.COUNTY_CODE_003[i].zfill(3)
    if pts.geometry[i] is None or c not in cty_m.index: return None
    return round(pts_m.geometry[i].distance(cty_m.geometry[c])/1609.34,2)
d['off_mi']=[dist(i) if d.pt_county[i]!=d.COUNTY_CODE_003[i].zfill(3) else 0.0 for i in d.index]
def flag(i):
    if pd.isna(d.lat[i]) or pd.isna(d.lon[i]): return 'No location'
    if pd.isna(d.pt_county[i]) and (d.off_mi[i] or 0)>1: return 'Outside WV'
    if (d.off_mi[i] or 0)>1: return 'Not in listed county'
    return ''
d['loc_flag']=[flag(i) for i in d.index]
def word(c):
    if c in ('N',''): return None
    c=int(c); return 'Good' if c>=7 else 'Fair' if c>=5 else 'Poor'
OWN={'01':'State highway agency','02':'County highway agency','04':'City or town','11':'State park or forest','21':'Other state agency','25':'Other local agency','26':'Private','27':'Railroad','31':'State toll authority','64':'U.S. Forest Service','66':'National Park Service','63':'U.S. Fish and Wildlife Service','70':'U.S. Army Corps of Engineers'}
MAT={'1':'Concrete','2':'Concrete (continuous)','3':'Steel','4':'Steel (continuous)','5':'Prestressed concrete','6':'Prestressed concrete (continuous)','7':'Timber','8':'Masonry','9':'Aluminum or iron','0':'Other'}
TYP={'01':'Slab','02':'Beam or girder','03':'Girder and floorbeam','04':'Tee beam','05':'Box beam (multiple)','06':'Box beam (single)','07':'Frame','08':'Orthotropic','09':'Truss (deck)','10':'Truss (through)','11':'Arch (deck)','12':'Arch (through)','13':'Suspension','14':'Cable-stayed','15':'Movable (lift)','16':'Movable (bascule)','17':'Movable (swing)','18':'Tunnel','19':'Culvert','20':'Mixed types','21':'Segmental box girder','22':'Channel beam','00':'Other'}
num=lambda s:pd.to_numeric(s,errors='coerce')
import re
def fix(t):
    t=t.title().replace(' Over ',' over ')
    return re.sub(r"\b(Us|Wv|Cr|Fr|Sr|I|Ii|Iii|Unt|Rr|Csx|Ns)\b",lambda m:m.group(1).upper(),t)
rec=[]
for i,r in d.iterrows():
    rec.append({'id':r.STRUCTURE_NUMBER_008,'name':fix(f"{r.FACILITY_CARRIED_007} over {r.FEATURES_DESC_006A}"),
     'carries':r.FACILITY_CARRIED_007,'crosses':r.FEATURES_DESC_006A,'location':r.LOCATION_009,'county':r.county,'district':r.HIGHWAY_DISTRICT_002,
     'lat':r.lat,'lon':r.lon,'loc_flag':r.loc_flag,'owner':OWN.get(r.OWNER_022,'Other ('+r.OWNER_022+')'),
     'material':MAT.get(r.STRUCTURE_KIND_043A,'Other'),'type':TYP.get(r.STRUCTURE_TYPE_043B.zfill(2),'Other'),
     'year_built':num(pd.Series([r.YEAR_BUILT_027]))[0],'year_recon':num(pd.Series([r.YEAR_RECONSTRUCTED_106]))[0],
     'adt':num(pd.Series([r.ADT_029]))[0],'length_ft':round(float(r.STRUCTURE_LEN_MT_049 or 0)*3.28084),
     'deck_width_ft':round(float(r.DECK_WIDTH_MT_052 or 0)*3.28084,1),'max_span_ft':round(float(r.MAX_SPAN_LEN_MT_048 or 0)*3.28084),
     'spans':int(num(pd.Series([r.MAIN_UNIT_SPANS_045]))[0] or 0)+int(num(pd.Series([r.APPR_SPANS_046]))[0] or 0),
     'deck':word(r.DECK_COND_058),'beams':word(r.SUPERSTRUCTURE_COND_059),'supports':word(r.SUBSTRUCTURE_COND_060),'culvert':word(r.CULVERT_COND_062),
     'codes':{'deck':r.DECK_COND_058,'beams':r.SUPERSTRUCTURE_COND_059,'supports':r.SUBSTRUCTURE_COND_060,'culvert':r.CULVERT_COND_062},
     'overall':{'G':'Good','F':'Fair','P':'Poor'}.get(r.BRIDGE_CONDITION,''),'scour_code':r.SCOUR_CRITICAL_113,
     'scour_risk':r.SCOUR_CRITICAL_113 in ('0','1','2','3'),'inspected':r.DATE_OF_INSPECT_090})
rec=[{k:(None if isinstance(v,float) and pd.isna(v) else v) for k,v in x.items()} for x in rec]
for x in rec:
    for k in ('year_built','year_recon','adt'):
        if x[k] is not None: x[k]=int(x[k])
json.dump(rec,open(OUT+'bridges.json','w'),separators=(',',':'))
d[d.loc_flag!=''][['STRUCTURE_NUMBER_008','FACILITY_CARRIED_007','FEATURES_DESC_006A','county','lat','lon','loc_flag','off_mi']].to_csv(OUT+'location_flags.csv',index=False)
R=pd.DataFrame(rec)
print('total',len(R)); print(R.overall.value_counts().to_dict())
print('state-owned',(R.owner=='State highway agency').sum(), R[R.owner=='State highway agency'].overall.value_counts().to_dict())
print(R.owner.value_counts().to_dict())
print('flags',R.loc_flag.value_counts().to_dict())
print('scour risk',R.scour_risk.sum(), 'scour codes',d.SCOUR_CRITICAL_113.value_counts().to_dict())
print('culverts',R.culvert.notna().sum())
print('type',R.type.value_counts().head(10).to_dict())
print('missing county',(R.county=='Unknown').sum(),'counties',R.county.nunique())
print('adt missing',R.adt.isna().sum(),'yb',R.year_built.min(),R.year_built.max(), 'median yb',R.year_built.median())
ins=d.DATE_OF_INSPECT_090.str.zfill(4); yrs=('20'+ins.str[2:]); print('inspect years',yrs.value_counts().sort_index().to_dict())
print('poor+adt>10000',((R.overall=='Poor')&(R.adt>10000)).sum())
import os;print('json KB',os.path.getsize(OUT+'bridges.json')//1024)
