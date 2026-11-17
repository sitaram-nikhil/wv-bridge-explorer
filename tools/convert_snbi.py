"""Converter: FHWA NBI JSON file (Specifications for the National Bridge Inventory, "SNBI", 2026 onward) -> bridge records.
Input:  tools/work/raw/WV<yy>.json   Output: tools/work/bridges.json (see bridge_record.py)
Usage:  python3 convert_snbi.py 2026

Codes follow the SNBI (March 2022, with errata 1 and 2) and FHWA's Detailed Coding Map, including the
temporary "-T" codes FHWA uses while states finish moving their data to the new format.
"""
import sys, json, re
import bridge_record as br

YEAR = sys.argv[1] if len(sys.argv) > 1 else '2026'
data = json.load(open(br.RAW + 'WV' + YEAR[-2:] + '.json'))

OWN = {'S01': 'State highway agency', 'L01': 'County highway agency', 'L02': 'City or town', 'L03': 'City or town',
       'S02': 'State park or forest', 'L04': 'Other local agency', 'SX': 'Other state agency', 'LX': 'Other local agency',
       'P': 'Private', 'R': 'Railroad', 'S03': 'State toll authority', 'L05': 'Other local agency', 'FL07': 'U.S. Forest Service',
       'FL05': 'National Park Service', 'FL04': 'U.S. Fish and Wildlife Service', 'FL06': 'U.S. Army Corps of Engineers'}
# Span type (B.SP.06), including temporary codes, to the app's type names.
TYPE = {'S01': 'Slab', 'S02': 'Slab', 'S-T': 'Slab',
        'G01': 'Beam or girder', 'G02': 'Beam or girder', 'G10': 'Beam or girder', 'GX': 'Beam or girder', 'GB-T': 'Beam or girder',
        'G09': 'Girder and floorbeam', 'G03': 'Tee beam', 'G04': 'Tee beam', 'G05': 'Tee beam', 'G06': 'Tee beam', 'GT-T': 'Tee beam',
        'G07': 'Channel beam', 'G08': 'Channel beam', 'GC-T': 'Channel beam',
        'B02': 'Box beam (multiple)', 'B03': 'Box beam (multiple)', 'BM-T': 'Box beam (multiple)',
        'B01': 'Box beam (single)', 'BS-T': 'Box beam (single)', 'B04': 'Segmental box girder',
        'F01': 'Frame', 'F02': 'Frame', 'F03': 'Frame', 'F04': 'Frame', 'F-T': 'Frame',
        'T01': 'Truss (deck)', 'T02': 'Truss (through)', 'T03': 'Truss (through)', 'T-T': 'Truss (through)',
        'A01': 'Arch (deck)', 'A02': 'Arch (deck)', 'A03': 'Arch (deck)', 'AD-T': 'Arch (deck)',
        'A04': 'Arch (through)', 'A05': 'Arch (through)', 'AT-T': 'Arch (through)',
        'L01': 'Suspension', 'L02': 'Cable-stayed', 'L03': 'Cable-stayed', 'L-T': 'Cable-stayed', 'LX': 'Other',
        'M01': 'Movable (lift)', 'M02': 'Movable (bascule)', 'M03': 'Movable (swing)', 'MX': 'Other',
        'P01': 'Culvert', 'P02': 'Culvert', 'C-T': 'Culvert', 'Z-T': 'Mixed types'}
# Span material (B.SP.04) to the app's material words.
def material(code, continuous):
    c = code or ''
    if c.startswith('S'): m = 'Steel'
    elif c in ('C03', 'C04', 'C05', 'CP-T'): m = 'Prestressed concrete'
    elif c.startswith('C'): m = 'Concrete'
    elif c.startswith('T'): m = 'Timber'
    elif c.startswith('M'): m = 'Masonry'
    elif c in ('A01', 'I01', 'I02', 'AI-T'): m = 'Aluminum or iron'
    else: m = 'Other'
    return m + (' (continuous)' if continuous and m in ('Steel', 'Concrete', 'Prestressed concrete') else '')
# Load posting status (B.PS.01), Table 15, plus temporary codes.
def posting(c):
    if not c: return 'unknown'
    if c == 'C': return 'closed'
    if c == 'N': return 'not_open'
    if c in ('PO', 'SO', 'TO'): return {'PO': 'open', 'SO': 'open_shored', 'TO': 'open_temp'}[c]
    if c in ('PA', 'TA', 'SA', 'PA-T'): return 'needs_posting'
    if c in ('PP', 'TP', 'SP', 'PP-T'): return 'posted'
    if c in ('PR', 'TR', 'SR', 'PR-T'): return 'posted_other'
    if c in ('PD', 'TD', 'SD'): return 'posted_reduce'
    if c in ('PM', 'TM', 'SM'): return 'posted_missing'
    return 'unknown'
# Flood erosion: observed scour (B.C.11) first, then scour vulnerability (B.AP.03).
def scour(bc11, ap03, over_water):
    """Flood erosion risk = FHWA's own "scour critical" codes in B.AP.03 (C or D, or the changeover code CD-T).
    B.C.11 (scour seen by inspectors) only refines the wording; a rating of 4 without a scour-critical code
    gets an information note, not the risk flag."""
    if ap03 in ('C', 'D', 'CD-T'):
        if bc11 in ('0', '1'): return 'closed'
        if bc11 in ('2', '3', 'MA-T'): return 'unstable_seen'
        return 'critical_temp' if ap03 == 'C' else 'critical'
    if bc11 in ('0', '1'): return 'closed'                     # none in the 2026 file; kept as a risk if it ever appears
    if bc11 in ('2', '3', 'MA-T'): return 'unstable_seen'      # none in the 2026 file without a scour-critical code
    if bc11 == '4': return 'scour_seen'
    if ap03 == 'E': return 'not_checked_temp'
    if ap03 == '0': return 'not_checked'
    if ap03 == 'U': return 'unknown_foundation'
    if ap03 == 'B': return 'protected'
    if ap03 == 'BCE-T': return 'protected_unclear'
    if ap03 in ('A', 'AB-T'): return 'stable'
    return 'no_water' if not over_water else 'not_checked'
MAJOR_WORK = {'BR1', 'IP1', 'IP2', 'IP3', 'IP4', 'IP5', 'DK1', 'SP1', 'SB1', 'DK2', 'SP2', 'SB2', 'CU2'}
RCLASS = {'1': 'Interstate', '2': 'US route', '3': 'WV route', '4': 'County route'}


def common_name(v):
    parts = [p.strip() for p in str(v or '').split('|') if p.strip()]
    parts = [p.title() if p.isupper() else p for p in parts]
    return '; '.join(dict.fromkeys(parts))


def short_crosses(under):
    """Name for the bridge title: the main feature crossed (water first, then a highway), plus a count of the rest."""
    order = {'W': 0, 'H': 1, 'R': 2}
    fs = sorted([f for f in under if f.get('BF03')], key=lambda f: order.get(str(f.get('BF01', ''))[:1], 3))
    names = list(dict.fromkeys(str(f['BF03']).split('|')[0].strip() for f in fs))
    if len(names) <= 2: return ' and '.join(names)
    return names[0] + ' and ' + str(len(names) - 1) + ' more'


def ym(d):
    d = str(d or '')
    return d[:4] + '-' + d[4:6] if re.fullmatch(r'\d{8}', d) else ''


def intval(v):
    try: return int(round(float(v)))
    except (TypeError, ValueError): return None


recs, codes, temp = [], [], {'span type': 0, 'posting': 0, 'scour': 0}
for r in data:
    feats = r.get('Features', [])
    on = [f for f in feats if f.get('BF02') == 'C']
    on_hwy = [f for f in on if str(f.get('BF01', '')).startswith('H')]
    under = [f for f in feats if f.get('BF02') == 'B']
    under_hwy = [f for f in under if str(f.get('BF01', '')).startswith('H')]
    names = lambda fs: [str(f.get('BF03') or '').split('|')[0].strip() for f in fs if f.get('BF03')]
    carries = ' and '.join(dict.fromkeys(names(on_hwy) or names(on)))
    crosses = ' and '.join(dict.fromkeys(names(under)))
    # Route: mainline route on the bridge, if any.
    routes = [ro for f in on_hwy for ro in f.get('Routes', [])]
    routes.sort(key=lambda ro: (ro.get('BRT05') != '1', ro.get('BRT04') or 'Z'))
    rc, rl = None, ''
    if routes:
        ro = routes[0]; rc = RCLASS.get(ro.get('BRT04'))
        n = re.match(r'\d+', str(ro.get('BRT02') or ''))
        if rc in br.ROUTE_LABEL and n: rl = br.ROUTE_LABEL[rc].format(int(n.group()))
    if rc is None:
        rc2, rl2 = br.route_from_text(carries)
        rc, rl = (rc2, rl2) if rc2 else ('Other road', '')
    # Spans: the main span set describes the type; all sets add up to the span count.
    sets = r.get('SpanSets', [])
    main = next((s for s in sets if str(s.get('BSP01', '')).startswith('M')), sets[0] if sets else {})
    is_culvert = str(main.get('BSP01', ''))[:1] in ('C', 'V') or (r.get('BC04') not in (None, 'N'))
    t = 'Culvert' if is_culvert else TYPE.get(main.get('BSP06'), 'Other')
    if str(main.get('BSP06', '')).endswith('-T'): temp['span type'] += 1
    spans = sum(intval(s.get('BSP02')) or 0 for s in sets)
    # Inspections: latest initial or routine inspection.
    ins = [x for x in r.get('Inspections', []) if x.get('BIE01') in ('1', '2') and x.get('BIE02')]
    last = max(ins, key=lambda x: x['BIE02']) if ins else {}
    # Posting: latest status record.
    ps = [p for p in r.get('PostingStatuses', []) if p.get('BPS01')]
    ps_code = max(ps, key=lambda p: p.get('BPS02') or '')['BPS01'] if ps else None
    if ps_code and ps_code.endswith('-T'): temp['posting'] += 1
    over_water = any(str(f.get('BF01', '')).startswith('W') for f in under)
    sc = scour(r.get('BC11'), r.get('BAP03'), over_water)
    if str(r.get('BC11', '')).endswith('-T') or str(r.get('BAP03', '')).endswith('-T'): temp['scour'] += 1
    yb = intval(r.get('BW01'))
    recon = [intval(w.get('BW02')) for w in r.get('Works', [])
             if set(str(w.get('BW03', '')).split('|')) & MAJOR_WORK and intval(w.get('BW02')) not in (None, yb)]
    adts = [f.get('BH09') for f in on_hwy if f.get('BH09') is not None]
    det = [intval(f.get('BH17')) for f in on_hwy if f.get('BH17') is not None]
    lanes_on = [intval(f.get('BH08')) for f in on_hwy if f.get('BH08') is not None]
    lanes_un = [intval(f.get('BH08')) for f in under_hwy if f.get('BH08') is not None]
    width = r.get('BG05') if r.get('BG05') is not None else r.get('BG06')
    dist = str(r.get('BL04') or '')
    rec = {
        'id': r['BID01'], 'name': br.tidy_name(f"{carries or 'Unnamed road'} over {short_crosses(under) or 'unnamed feature'}"),
        'common_name': common_name(r.get('BID02')), 'carries': carries, 'crosses': crosses,
        'location': (r.get('BL11') or '').strip(), 'county': '', 'district': dist.zfill(2) if dist.isdigit() else dist,
        'lat': r.get('BL05'), 'lon': r.get('BL06'), 'loc_flag': '',
        'owner': OWN.get(r.get('BCL01'), 'Other (' + str(r.get('BCL01')) + ')'), 'wvdoh': r.get('BCL01') == 'S01',
        'material': material(main.get('BSP04'), str(main.get('BSP05', '')) in ('2', '3', 'C-T')), 'type': t,
        'route_class': rc, 'route': rl,
        'year_built': yb, 'year_recon': max(recon) if recon else None,
        'adt': intval(sum(adts)) if adts else None,
        'adt_year': max(intval(f.get('BH11')) for f in on_hwy if f.get('BH11')) if any(f.get('BH11') for f in on_hwy) else None,
        'length_ft': intval(r.get('BG02')) or 0, 'deck_width_ft': round(float(width or 0), 1),
        'max_span_ft': intval(r.get('BG03')) or 0, 'spans': spans,
        'codes': {'deck': r.get('BC01') or 'N', 'beams': r.get('BC02') or 'N', 'supports': r.get('BC03') or 'N',
                  'culvert': r.get('BC04') or 'N'},
        'overall': {'G': 'Good', 'F': 'Fair', 'P': 'Poor'}[r['BC12']],
        'scour': sc, 'scour_risk': br.SCOUR_KEYS[sc], 'posting': posting(ps_code),
        'inspected': ym(last.get('BIE02')), 'next_inspection': ym(last.get('BIE06')),
        'inspect_every': intval(last.get('BIE05')) or None,
        'lanes_on': sum(lanes_on) if lanes_on else None, 'lanes_under': sum(lanes_un) if lanes_un else None,
        'detour_mi': min(det) if det and min(det) < 999 else None,
        'nhs': any(f.get('BH03') == 'Y' for f in on_hwy),
    }
    if rec['lat'] is not None and not (37 < rec['lat'] < 41 and -83 < rec['lon'] < -77): rec['lat'] = rec['lon'] = None
    recs.append(rec)
    codes.append(str(r['BL02']).zfill(3) if r.get('BL02') is not None else '')

filled = br.place_and_check(recs, codes)
br.save(recs, 'FHWA National Bridge Inventory, West Virginia, ' + YEAR + ' file', YEAR)
print('converted', len(recs), 'bridges from the', YEAR, 'SNBI file;', filled, 'counties filled from coordinates;',
      'temporary changeover codes:', temp)
