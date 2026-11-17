"""Per-bridge details for the bridge panel (loaded when a bridge is first opened). Reads only tools/work/bridges.json."""
import json, os
import bridge_record as br
OUT = br.ROOT + 'data/bridges-detail.json'
B = br.load()['bridges']
fields = ['carries', 'crosses', 'material', 'yearRecon', 'lengthFt', 'widthFt', 'maxSpanFt', 'spans', 'cDeck', 'cBeams', 'cSupports',
          'cCulvert', 'scour', 'inspected', 'inspectEvery', 'posting', 'adtYear', 'lanesOn', 'lanesUnder', 'detourMi', 'nhs', 'district',
          'nextInspection', 'commonName']
out = {}
for b in B:
    out[b['id']] = [b['carries'], b['crosses'], b['material'], b['year_recon'], b['length_ft'], b['deck_width_ft'], b['max_span_ft'],
                    b['spans'], b['codes']['deck'], b['codes']['beams'], b['codes']['supports'], b['codes']['culvert'], b['scour'],
                    b['inspected'], b['inspect_every'], b['posting'], b['adt_year'], b['lanes_on'], b['lanes_under'], b['detour_mi'],
                    1 if b['nhs'] else 0, b['district'], b['next_inspection'], b['common_name']]
json.dump({'fields': fields, 'rows': out}, open(OUT, 'w'), separators=(',', ':'))
print('detail:', len(out), 'bridges |', os.path.getsize(OUT) // 1024, 'KB')
