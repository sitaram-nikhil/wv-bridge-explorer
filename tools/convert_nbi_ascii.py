"""Converter: FHWA NBI delimited file (Recording and Coding Guide layout, years up to 2025) -> bridge records.
Input:  tools/work/raw/WV<yy>.txt   Output: tools/work/bridges.json (see bridge_record.py)
Usage:  python3 convert_nbi_ascii.py 2025
"""
import sys, pandas as pd
import bridge_record as br

YEAR = sys.argv[1] if len(sys.argv) > 1 else '2025'
d = pd.read_csv(br.RAW + 'WV' + YEAR[-2:] + '.txt', dtype=str, quotechar="'", encoding='latin1').fillna('')
d = d.apply(lambda s: s.str.strip())

OWN = {'01': 'State highway agency', '02': 'County highway agency', '04': 'City or town', '11': 'State park or forest',
       '21': 'Other state agency', '25': 'Other local agency', '26': 'Private', '27': 'Railroad', '31': 'State toll authority',
       '64': 'U.S. Forest Service', '66': 'National Park Service', '63': 'U.S. Fish and Wildlife Service', '70': 'U.S. Army Corps of Engineers'}
MAT = {'1': 'Concrete', '2': 'Concrete (continuous)', '3': 'Steel', '4': 'Steel (continuous)', '5': 'Prestressed concrete',
       '6': 'Prestressed concrete (continuous)', '7': 'Timber', '8': 'Masonry', '9': 'Aluminum or iron', '0': 'Other'}
TYP = {'01': 'Slab', '02': 'Beam or girder', '03': 'Girder and floorbeam', '04': 'Tee beam', '05': 'Box beam (multiple)',
       '06': 'Box beam (single)', '07': 'Frame', '08': 'Orthotropic', '09': 'Truss (deck)', '10': 'Truss (through)',
       '11': 'Arch (deck)', '12': 'Arch (through)', '13': 'Suspension', '14': 'Cable-stayed', '15': 'Movable (lift)',
       '16': 'Movable (bascule)', '17': 'Movable (swing)', '18': 'Tunnel', '19': 'Culvert', '20': 'Mixed types',
       '21': 'Segmental box girder', '22': 'Channel beam', '00': 'Other'}
POSTING = {'A': 'open', 'B': 'needs_posting', 'D': 'open_shored', 'E': 'open_temp', 'G': 'not_open', 'K': 'closed',
           'P': 'posted', 'R': 'posted_other'}
SCOUR = {'0': 'closed', '1': 'closed', '2': 'unstable_seen', '3': 'critical', '4': 'exposed', '5': 'stable', '6': 'not_checked',
         '7': 'protected', '8': 'stable', '9': 'dry', 'N': 'no_water', 'T': 'tidal', 'U': 'unknown_foundation'}
PFX = {'1': 'Interstate', '2': 'US route', '3': 'WV route', '4': 'County route'}


def num(v):
    try: return int(float(v))
    except ValueError: return None


def dms(v, deg):
    v = v.zfill(deg + 6)
    try: D = int(v[:deg]); M = int(v[deg:deg + 2]); S = int(v[deg + 2:]) / 100
    except ValueError: return None
    if D == 0: return None
    return round(D + M / 60 + S / 3600, 6)


recs, codes = [], []
for _, r in d.iterrows():
    lat = dms(r.LAT_016, 2); lon = dms(r.LONG_017, 3); lon = -lon if lon is not None else None
    rc, rl = br.route_from_text(r.FACILITY_CARRIED_007)
    if rc is None: rc = PFX.get(r.ROUTE_PREFIX_005B, 'Other road')
    insp = r.DATE_OF_INSPECT_090.zfill(4)
    det_km = num(r.DETOUR_KILOS_019)
    recon = num(r.YEAR_RECONSTRUCTED_106)
    recs.append({
        'id': r.STRUCTURE_NUMBER_008, 'name': br.tidy_name(f"{r.FACILITY_CARRIED_007} over {r.FEATURES_DESC_006A}"),
        'common_name': '', 'carries': r.FACILITY_CARRIED_007, 'crosses': r.FEATURES_DESC_006A, 'location': r.LOCATION_009,
        'county': '', 'district': r.HIGHWAY_DISTRICT_002, 'lat': lat, 'lon': lon, 'loc_flag': '',
        'owner': OWN.get(r.OWNER_022, 'Other (' + r.OWNER_022 + ')'), 'wvdoh': r.OWNER_022 == '01',
        'material': MAT.get(r.STRUCTURE_KIND_043A, 'Other'), 'type': TYP.get(r.STRUCTURE_TYPE_043B.zfill(2), 'Other'),
        'route_class': rc, 'route': rl,
        'year_built': num(r.YEAR_BUILT_027), 'year_recon': recon or None,
        'adt': num(r.ADT_029), 'adt_year': num(r.YEAR_ADT_030) or None,
        'length_ft': round(float(r.STRUCTURE_LEN_MT_049 or 0) * 3.28084),
        'deck_width_ft': round(float(r.DECK_WIDTH_MT_052 or 0) * 3.28084, 1),
        'max_span_ft': round(float(r.MAX_SPAN_LEN_MT_048 or 0) * 3.28084),
        'spans': (num(r.MAIN_UNIT_SPANS_045) or 0) + (num(r.APPR_SPANS_046) or 0),
        'codes': {'deck': r.DECK_COND_058 or 'N', 'beams': r.SUPERSTRUCTURE_COND_059 or 'N',
                  'supports': r.SUBSTRUCTURE_COND_060 or 'N', 'culvert': r.CULVERT_COND_062 or 'N'},
        'overall': {'G': 'Good', 'F': 'Fair', 'P': 'Poor'}[r.BRIDGE_CONDITION],
        'scour': SCOUR[r.SCOUR_CRITICAL_113], 'scour_risk': False,
        'posting': POSTING.get(r.OPEN_CLOSED_POSTED_041, 'unknown'),
        'inspected': ('20' + insp[2:] + '-' + insp[:2]) if insp.strip('0') else '',
        'next_inspection': '', 'inspect_every': num(r.INSPECT_FREQ_MONTHS_091),
        'lanes_on': num(r.TRAFFIC_LANES_ON_028A), 'lanes_under': num(r.TRAFFIC_LANES_UND_028B),
        'detour_mi': round(det_km * 0.621371) if det_km is not None and det_km < 199 else None,
        'nhs': r.HIGHWAY_SYSTEM_104 == '1',
    })
    recs[-1]['scour_risk'] = br.SCOUR_KEYS[recs[-1]['scour']]
    codes.append(r.COUNTY_CODE_003)

br.place_and_check(recs, codes)
br.save(recs, 'FHWA National Bridge Inventory, West Virginia, ' + YEAR + ' file', YEAR)
print('converted', len(recs), 'bridges from the', YEAR, 'delimited file')
