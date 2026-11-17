"""The fixed bridge-record format the site is built from, and the steps every converter shares.

Each converter (convert_nbi_ascii.py for FHWA files up to 2025, convert_snbi.py for 2026 onward)
turns one FHWA file into a list of records with exactly the fields in FIELDS, using the plain values
below. build_map_data.py and build_detail_data.py read only these records, so a new FHWA layout
needs a new converter and nothing else.
"""
import os, re, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) + '/'   # the site folder
WORK = ROOT + 'tools/work/'   # downloaded and in-between files (not published)
RAW = WORK + 'raw/'

# Field: meaning (allowed values)
FIELDS = {
    'id': 'FHWA structure number',
    'name': '"<carries> over <crosses>", tidied',
    'common_name': 'local name of the bridge, when the file gives one (2026 onward), else ""',
    'carries': 'road on the bridge, as written in the file',
    'crosses': 'what the bridge crosses, as written in the file',
    'location': 'location note from the file',
    'county': 'county name; from the county code, or from the coordinates when the code is missing',
    'district': 'WVDOH district',
    'lat': 'latitude (decimal degrees) or None', 'lon': 'longitude (decimal degrees) or None',
    'loc_flag': '"" | "Not in listed county" | "No location" | "Outside WV"',
    'owner': 'owner in plain words', 'wvdoh': 'True when the owner is the state DOT',
    'material': 'main span material in plain words', 'type': 'one of TYPE_NAMES',
    'route_class': 'one of ROUTE_CLASSES', 'route': '"I-64" | "US 50" | "WV 2" | ""',
    'year_built': 'int or None', 'year_recon': 'year of the latest replacement or major rehabilitation, or None',
    'adt': 'vehicles a day or None', 'adt_year': 'year of the count or None',
    'length_ft': 'int', 'deck_width_ft': 'float', 'max_span_ft': 'int', 'spans': 'int',
    'codes': '{deck, beams, supports, culvert}: "0".."9" or "N" (not rated separately)',
    'overall': '"Good" | "Fair" | "Poor"',
    'scour': 'one of SCOUR_KEYS', 'scour_risk': 'True when SCOUR_KEYS[scour] is a risk',
    'posting': 'one of POSTING_KEYS',
    'inspected': '"YYYY-MM" of the latest routine inspection, or ""',
    'next_inspection': '"YYYY-MM" when the file gives it (2026 onward), else ""',
    'inspect_every': 'months or None',
    'lanes_on': 'int or None', 'lanes_under': 'int or None', 'detour_mi': 'int or None (no detour listed)',
    'nhs': 'True when on the National Highway System',
}

TYPE_NAMES = ['Slab', 'Beam or girder', 'Girder and floorbeam', 'Tee beam', 'Box beam (multiple)', 'Box beam (single)',
              'Frame', 'Orthotropic', 'Truss (deck)', 'Truss (through)', 'Arch (deck)', 'Arch (through)', 'Suspension',
              'Cable-stayed', 'Movable (lift)', 'Movable (bascule)', 'Movable (swing)', 'Tunnel', 'Culvert', 'Mixed types',
              'Segmental box girder', 'Channel beam', 'Other']
ROUTE_CLASSES = ['Interstate', 'US route', 'WV route', 'County route', 'Other road']

# Flood erosion (scour). True = shown as a flood erosion risk in the app.
SCOUR_KEYS = {
    'closed': True,            # closed, or should be, because of scour
    'unstable_seen': True,     # scour found that affects strength or stability
    'critical': True,          # appraised as unstable for scour (scour critical)
    'critical_temp': True,     # scour critical, with temporary (not designed) protection
    'scour_seen': False,       # scour found that affects the supports, but not coded scour critical (2026 onward)
    'exposed': False,          # stable, but exposed foundations need protection (2025 code 4)
    'protected': False,        # stable because of erosion protection
    'protected_unclear': False,  # protection installed; the 2026 changeover code does not say whether designed
    'stable': False,
    'dry': False,              # foundations above flood water (2025 code 9)
    'not_checked': False,      # scour appraisal not done
    'not_checked_temp': False, # not done, temporary protection installed
    'unknown_foundation': False,
    'no_water': False,
    'tidal': False,
}
POSTING_KEYS = {  # key: status group shown in the app
    'open': 'open', 'open_temp': 'open', 'open_shored': 'open',
    'needs_posting': 'posted', 'posted': 'posted', 'posted_reduce': 'posted', 'posted_missing': 'posted',
    'posted_other': 'posted', 'not_open': 'closed', 'closed': 'closed', 'unknown': 'open',
}

ROUTE_LABEL = {'Interstate': 'I-{}', 'US route': 'US {}', 'WV route': 'WV {}'}


def tidy_name(t):
    t = t.title().replace(' Over ', ' over ')
    return re.sub(r"\b(Us|Wv|Cr|Fr|Sr|I|Ii|Iii|Unt|Rr|Csx|Ns)\b", lambda m: m.group(1).upper(), t)


def route_from_text(carries):
    """Route class and label parsed from the 'carries' text (used when the file has no route number)."""
    t = carries.upper().replace('.', '')
    m = re.match(r'^(?:I|INTERSTATE)\s*-?\s*(\d+)', t)
    if m: return 'Interstate', 'I-' + str(int(m.group(1)))
    m = re.match(r'^(?:US|U S)\s*(?:ROUTE|RT)?\s*(\d+)', t)
    if m: return 'US route', 'US ' + str(int(m.group(1)))
    m = re.match(r'^(?:WV|W V|WEST VIRGINIA|WEST VA)\s*(?:STATE)?\s*(?:ROUTE|RT)?\s*(\d+)', t)
    if m: return 'WV route', 'WV ' + str(int(m.group(1)))
    return None, ''


def place_and_check(recs, county_codes):
    """Fill county names, fill a missing county from the coordinates, and flag doubtful locations.
    county_codes: list of 3-digit county FIPS strings (or '') in the same order as recs."""
    import geopandas as gpd, pandas as pd
    from shapely.geometry import Point
    cty = gpd.read_file('zip://' + RAW + 'counties.zip')
    cty = cty[cty.STATEFP == '54'][['COUNTYFP', 'NAME', 'geometry']].to_crs(4326)
    names = dict(zip(cty.COUNTYFP, cty.NAME))
    pts = gpd.GeoDataFrame({'i': range(len(recs))},
                           geometry=[Point(r['lon'], r['lat']) if r['lat'] is not None else None for r in recs], crs=4326)
    j = gpd.sjoin(pts[pts.geometry.notna()], cty[['COUNTYFP', 'geometry']], how='left', predicate='within')
    j = j[~j.index.duplicated()]
    inside = j.COUNTYFP.reindex(pts.index)
    cty_m = cty.set_index('COUNTYFP').to_crs(5070); pts_m = pts.to_crs(5070)
    filled = 0
    for i, r in enumerate(recs):
        code = (county_codes[i] or '').zfill(3) if county_codes[i] else ''
        here = inside[i] if isinstance(inside[i], str) else None
        if code not in names:
            # No usable county code: take it from the coordinates.
            r['county'] = names.get(here, 'Unknown'); filled += 1 if here else 0
            r['loc_flag'] = 'No location' if r['lat'] is None else ('' if here else 'Outside WV')
            continue
        r['county'] = names[code]
        if r['lat'] is None: r['loc_flag'] = 'No location'; continue
        if here == code: r['loc_flag'] = ''; continue
        miles = pts_m.geometry[i].distance(cty_m.geometry[code]) / 1609.34
        if here is None and miles > 1: r['loc_flag'] = 'Outside WV'
        elif miles > 1: r['loc_flag'] = 'Not in listed county'
        else: r['loc_flag'] = ''
    return filled


def check(recs):
    """Every record has every field, with allowed values. Raises on the first problem."""
    for r in recs:
        missing = set(FIELDS) - set(r); extra = set(r) - set(FIELDS)
        assert not missing and not extra, (r.get('id'), missing, extra)
        assert r['type'] in TYPE_NAMES, (r['id'], r['type'])
        assert r['route_class'] in ROUTE_CLASSES, (r['id'], r['route_class'])
        assert r['scour'] in SCOUR_KEYS, (r['id'], r['scour'])
        assert r['scour_risk'] == SCOUR_KEYS[r['scour']], r['id']
        assert r['posting'] in POSTING_KEYS, (r['id'], r['posting'])
        assert r['overall'] in ('Good', 'Fair', 'Poor'), (r['id'], r['overall'])
        for k, v in r['codes'].items():
            assert v in list('0123456789N'), (r['id'], k, v)
        assert re.fullmatch(r'(\d{4}-\d{2})?', r['inspected']), (r['id'], r['inspected'])
    ids = [r['id'] for r in recs]
    assert len(ids) == len(set(ids)), 'duplicate bridge IDs'


def save(recs, source, edition):
    check(recs)
    out = {'source': source, 'edition': edition, 'fields': list(FIELDS), 'bridges': recs}
    json.dump(out, open(WORK + 'bridges.json', 'w'), separators=(',', ':'))


def load():
    return json.load(open(WORK + 'bridges.json'))
