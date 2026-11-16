"""Step 4: WV511 camera list with locations + live-stream check.
Source: https://wv511.org/wsvc/gmap.asmx/buildCamerasJSONjs (the feed WV511's own traffic map uses).
Stream: read per camera from wv511.org/flowplayeri.aspx?CAMID=<id> (vtc1/vtc2/vtc3.roadsummary.com)."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
import re, json, html, requests, concurrent.futures as cf, datetime
OUT=WORK+'cams/'
S=requests.Session(); S.headers['User-Agent']='Mozilla/5.0'
js=S.get('https://wv511.org/wsvc/gmap.asmx/buildCamerasJSONjs',timeout=60).text
start=js.index('camera_data = ')+len('camera_data = ')
obj,_=json.JSONDecoder().raw_decode(js[start:])
cams=[]
for c in obj['cams']:
    desc=re.sub('<[^>]+>','|',c['description'])
    m=re.search(r'\[([A-Z]{3})\]([^|]+)',desc)
    cams.append({'id':c['md5'],'route':c['title'].strip(),'county_code':m.group(1) if m else '','name':(m.group(2).strip() if m else c['title']),
                 'lat':float(c['start_lat']),'lon':float(c['start_lng']),'streaming':'STREAMING:1' in c['description'],'source':'WV511'})
def check(c):
    # Each camera streams from one of several servers; read the address from WV511's own player page.
    try:
        t=S.get('https://wv511.org/flowplayeri.aspx?CAMID='+c['id'],timeout=30).text
        m=re.findall(r"https?://[^'\" ]+\.m3u8",t)
        u=m[0] if m else f"https://vtc2.roadsummary.com/rtplive/{c['id']}/playlist.m3u8"
    except Exception: u=f"https://vtc2.roadsummary.com/rtplive/{c['id']}/playlist.m3u8"
    try:
        r=S.get(u,timeout=15); ok=r.status_code==200 and '#EXTM3U' in r.text
        if ok:  # follow to the media playlist and make sure it has video segments
            sub=[l for l in r.text.splitlines() if l and not l.startswith('#')]
            if sub:
                r2=S.get(u.rsplit('/',1)[0]+'/'+sub[0],timeout=15); ok=r2.status_code==200 and '#EXTINF' in r2.text
        return u, ok
    except Exception: return u, False
with cf.ThreadPoolExecutor(12) as ex:
    for c,(u,ok) in zip(cams,ex.map(check,cams)): c['stream']=u; c['live_now']=ok
json.dump({'checked':datetime.datetime.now().isoformat(timespec='minutes'),'count':len(cams),'cams':cams},open(OUT+'wv511_cams.json','w'),indent=1)
import collections
print(len(cams),'live now',sum(c['live_now'] for c in cams),'streaming flag',sum(c['streaming'] for c in cams))
print(collections.Counter(c['route'] for c in cams).most_common(30))
print(collections.Counter(c['county_code'] for c in cams).most_common(40))
