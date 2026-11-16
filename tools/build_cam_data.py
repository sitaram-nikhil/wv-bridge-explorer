"""Step 4: camera file for the site: cameras + bridge-to-camera matches."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
import json
W=ROOT
d=json.load(open(WORK+'cams/wv511_cams.json')); M=json.load(open(WORK+'cams/matches.json'))
excluded=set()
try: excluded={l.strip() for l in open(WORK+'cams/excluded_matches.txt') if l.strip() and not l.startswith('#')}  # "BRIDGEID CAMID" pairs removed after review
except FileNotFoundError: pass
cams={c['id']:[c['name'],c['route'],round(c['lat'],5),round(c['lon'],5),c['stream']] for c in d['cams']}
br={}
for m in M:
    if f"{m['bridge']} {m['cam']}" in excluded: continue
    br.setdefault(m['bridge'],[]).append([m['cam'],m['miles'],1 if m['tier']=='In view' else 0])
json.dump({'checked':d['checked'],'source':'WV511 (WVDOH)','camFields':['name','route','lat','lon','stream'],'cams':cams,'bridges':br},
          open(W+'data/cameras.json','w'),separators=(',',':'))
print(len(cams),'cams',len(br),'bridges with a camera')
