"""Step 4: match WV511 cameras to bridges.
Rule (proposed, user reviews):
  'In view'  = within 0.15 mi of the camera, or within 0.30 mi and the bridge is on or over the camera's road.
  'Nearby'   = within 0.50 mi and the bridge is on or over the camera's road.
Each bridge keeps its closest qualifying camera (and a second one if it also qualifies)."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
import json, re, numpy as np
W=ROOT
B=json.load(open(WORK+'bridges.json'))['bridges']
C=json.load(open(WORK+'cams/wv511_cams.json'))['cams']
def norm_route(r):
    r=r.upper().replace('US','US ').replace('WV','WV ').replace('I-','I ').replace('-',' ')
    m=re.match(r'^(I|US|WV)\s*(\d+)',r.strip()); return (m.group(1),m.group(2)) if m else None
def routes_in(text):
    t=text.upper().replace('.','')
    out=set()
    for m in re.finditer(r'\b(I|INTERSTATE|US|U S|WV|W V|SR)\s*-?\s*(?:ROUTE|RT)?\s*(\d{1,3})\b',t):
        k={'INTERSTATE':'I','U S':'US','W V':'WV','SR':'WV'}.get(m.group(1),m.group(1)); out.add((k,str(int(m.group(2)))))
    return out
def hav(lat1,lon1,lat2,lon2):
    p=np.radians; d1=p(lat2-lat1); d2=p(lon2-lon1)
    a=np.sin(d1/2)**2+np.cos(p(lat1))*np.cos(p(lat2))*np.sin(d2/2)**2; return 2*3958.8*np.arcsin(np.sqrt(a))
clat=np.array([c['lat'] for c in C]); clon=np.array([c['lon'] for c in C])
croute=[norm_route(c['route']) for c in C]
for c in C:  # some names carry a second road ("I-77/I-64", "WV-705/Mileground US-119")
    c['_routes']={r for r in [norm_route(c['route'])] if r}|routes_in(c['name'])
matches=[]
for b in B:
    if b['lat'] is None: continue
    d=hav(b['lat'],b['lon'],clat,clon)
    on=routes_in(b['carries']); over=routes_in(b['crosses'])
    cand=[]
    for j in np.where(d<=0.5)[0]:
        rel='on' if on & C[j]['_routes'] else 'over' if over & C[j]['_routes'] else ''
        tier='In view' if d[j]<=0.15 or (d[j]<=0.30 and rel) else 'Nearby' if rel else None
        if tier: cand.append((0 if tier=='In view' else 1, d[j], j, tier, rel))
    cand.sort()
    for rank,(_,dist,j,tier,rel) in enumerate(cand[:2]):
        matches.append({'bridge':b['id'],'bridge_name':b['name'],'county':b['county'],'overall':b['overall'],'adt':b['adt'],
          'cam':C[j]['id'],'cam_name':C[j]['name'],'cam_route':C[j]['route'],'live_now':C[j]['live_now'],
          'miles':round(float(dist),2),'tier':tier,'relation':{'on':'Bridge carries the camera road','over':'Bridge crosses over the camera road','':'Close by only'}[rel],
          'rank':rank+1})
json.dump(matches,open(WORK+'cams/matches.json','w'),indent=0)
import collections
p=[m for m in matches if m['rank']==1]
print('bridges with a camera',len(p),collections.Counter(m['tier'] for m in p),collections.Counter(m['relation'] for m in p))
print('with 2nd camera',sum(m['rank']==2 for m in matches),'cams used',len({m['cam'] for m in matches}),'primary cam live now',sum(m['live_now'] for m in p))
print('by condition',collections.Counter(m['overall'] for m in p))
