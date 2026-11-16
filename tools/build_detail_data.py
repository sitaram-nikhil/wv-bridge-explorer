"""Step 3: per-bridge details for the bridge panel (loaded when a bridge is first opened)."""
import os as _os
ROOT=_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))+'/'   # the site folder
WORK=ROOT+'tools/work/'   # downloaded and in-between files (not published)
NBI_YEAR=_os.environ.get('NBI_YEAR','2025')   # year of the FHWA file; its file is tools/work/raw/WV<yy>.txt
NBI_FILE='WV'+NBI_YEAR[-2:]+'.txt'
import json, pandas as pd
W=ROOT
B=json.load(open(WORK+'bridges.json'))
d=pd.read_csv(WORK+'raw/'+NBI_FILE,dtype=str,quotechar="'",encoding='latin1').fillna('').apply(lambda s:s.str.strip())
assert list(d.STRUCTURE_NUMBER_008)==[b['id'] for b in B]
num=lambda v:(int(float(v)) if v not in ('',) else None)
out={}
for b,(_,r) in zip(B,d.iterrows()):
    det_km=num(r.DETOUR_KILOS_019)
    out[b['id']]=[b['carries'],b['crosses'],b['material'],b['year_recon'] or None,b['length_ft'],b['deck_width_ft'],b['max_span_ft'],b['spans'],
      b['codes']['deck'],b['codes']['beams'],b['codes']['supports'],b['codes']['culvert'],b['scour_code'],b['inspected'].zfill(4),
      num(r.INSPECT_FREQ_MONTHS_091),r.OPEN_CLOSED_POSTED_041,num(r.YEAR_ADT_030) or None,num(r.TRAFFIC_LANES_ON_028A),num(r.TRAFFIC_LANES_UND_028B),
      round(det_km*0.621371) if det_km and det_km<199 else (0 if det_km==0 else None),1 if r.HIGHWAY_SYSTEM_104=='1' else 0,b['district']]
fields=['carries','crosses','material','yearRecon','lengthFt','widthFt','maxSpanFt','spans','cDeck','cBeams','cSupports','cCulvert','scourCode','inspected',
        'inspectEvery','posting','adtYear','lanesOn','lanesUnder','detourMi','nhs','district']
json.dump({'fields':fields,'rows':out},open(W+'data/bridges-detail.json','w'),separators=(',',':'))
import os, collections
print(len(out), os.path.getsize(W+'data/bridges-detail.json')//1024,'KB')
print(collections.Counter(v[19] for v in out.values()).most_common(6), sorted(set(r.DETOUR_KILOS_019 for _,r in d.iterrows()),key=lambda x:-int(x))[:5])
