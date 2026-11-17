"""Pick the right converter for the FHWA file in tools/work/raw/ and write tools/work/bridges.json.
NBI_YEAR=2026 -> WV26.json (SNBI layout, 2026 onward) or WV26.txt (older delimited layout)."""
import os, sys, subprocess
import bridge_record as br
year = os.environ.get('NBI_YEAR', '2026'); yy = year[-2:]
here = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(br.RAW + 'WV' + yy + '.json'): script = 'convert_snbi.py'
elif os.path.exists(br.RAW + 'WV' + yy + '.txt'): script = 'convert_nbi_ascii.py'
else: sys.exit('No FHWA file for ' + year + ': save WV' + yy + '.json (2026 onward) or WV' + yy + '.txt in tools/work/raw/')
subprocess.run([sys.executable, os.path.join(here, script), year], check=True, cwd=here)
B = br.load()['bridges']
from collections import Counter
print('bridges', len(B), dict(Counter(b['overall'] for b in B)), '| flood erosion risk', sum(b['scour_risk'] for b in B),
      '| culverts', sum(b['codes']['culvert'] != 'N' for b in B), '| location flags', dict(Counter(b['loc_flag'] for b in B if b['loc_flag'])))
