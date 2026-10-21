"""Export the three application ABIs from the pinned Foundry build."""
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    for name in ['Renderer','Composer','Registry']:
        abi=json.loads((ROOT/f'out/{name}.sol/{name}.json').read_text())['abi']
        data=json.dumps(abi,indent=2)+'\n';path=ROOT/f'docs/abi/{name}.json'
        if args.check:
            if not path.exists() or path.read_text()!=data:raise SystemExit('ABI drift: '+name)
        else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(data)
    print('Three ABIs '+('checked' if args.check else 'exported'))
if __name__=='__main__':main()
