"""Reproduce specification text as parameterized Solidity constants; no network."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
FILES = ['701-still-here','T2-log-sum-composed','1201-top-32','T4-call-compare-reference','T5-community-composed','T6-operator-reference']
# Substitution letters are the positions in Composer's context array.
COMMON = [('0x000000000000000000000000000000000000c1a1','$c'),('0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91','$d')]
lines = ['// SPDX-License-Identifier: MIT','pragma solidity 0.8.24;','// Generated from the pinned question fixtures by tools/build_recipe_text.py.','library RecipeText {']
for kind,name in enumerate(FILES,1):
    obj=json.loads((ROOT/'templates/fixtures'/f'{name}.json').read_text())
    replacements=list(COMMON)
    if kind <= 3:
        start=obj['window']['fromBlock']; end=obj['window']['toBlock']
        replacements += [(hex(start),'$a'),(hex(end),'$b')]
        item=obj['question'].split('`')[1]
        replacements += [(item,'$e'),('contributor','$f')]
        if kind==2: replacements += [('amount','$h')]
        if kind==3: replacements += [('weightAdded','$h'),('topic 1','topic $k'),('32','$i')]
    if kind==4:
        replacements += [('function pointsOf(address) view returns (uint256)','$e'),('0x18984a4','$b'),('1000','$i'),('>=','$l')]
    if kind==5:
        replacements += [('0x18984a4','$b'),('25789604','$m'),('0x14','$j'),('20','$i')]
    if kind==6: replacements += [('26237654','$m')]
    def transform(t):
        for a,b in replacements: t=t.replace(a,b)
        if kind in (1,2): t=t.replace('$c. Answer','$c$g. Answer')
        if kind==5: t=t.replace("; the last block of the spec's window",'$n')
        return t
    def emit(t): return json.dumps(transform(t),ensure_ascii=True)
    lines += [f'function q{kind}() internal pure returns (string memory) {{ return {emit(obj["question"])}; }}']
    for i,(key,value) in enumerate(obj['definitions'].items()):
        lines += [f'function d{kind}_{i}() internal pure returns (string memory) {{ return {emit(value)}; }}']
# Consolidate the text into one ASCII blob and ASCII offsets to keep runtime code small.
import re
texts=[]
for line in lines:
    m=re.search(r'function (\w+)\(\).*?\{ return (.*); \}',line)
    if m: texts.append((m.group(1),json.loads(m.group(2))))
blob=''.join(t for _,t in texts); offsets=[0]
for _,t in texts: offsets.append(offsets[-1]+len(t))
# Byte-pair dictionary: tokens 128..239 deliberately exclude every forbidden opcode byte.
from collections import Counter
encoded=[list(t.encode()) for _,t in texts]
rules=[]
for token in range(128,240):
    counts=Counter()
    for part in encoded: counts.update(zip(part,part[1:]))
    pair,frequency=counts.most_common(1)[0]
    if frequency<3: break
    rules.append(pair)
    def replace(part):
        out=[]; i=0
        while i<len(part):
            if i+1<len(part) and (part[i],part[i+1])==pair: out.append(token); i+=2
            else: out.append(part[i]); i+=1
        return out
    encoded=list(map(replace,encoded))
compressed=bytes(v for part in encoded for v in part); compressed_offsets=[0]
for part in encoded: compressed_offsets.append(compressed_offsets[-1]+len(part))
lines=['// SPDX-License-Identifier: MIT','pragma solidity 0.8.24;', '// forgefmt: disable-start', 'import {Tables} from "./Tables.sol";', '// Generated from the question fixtures; see tools/build_recipe_text.py.', 'library RecipeText {',f'bytes internal constant DATA = hex"{compressed.hex()}";',f'bytes internal constant DICT = hex"{bytes(v for pair in rules for v in pair).hex()}";',f'bytes internal constant OFFSETS = "{"".join(f"{n:04x}" for n in compressed_offsets)}";',f'bytes internal constant LENGTHS = "{"".join(f"{len(t):04x}" for _,t in texts)}";']
lines += ["""function get(uint256 index) private pure returns(string memory out) {
    bytes memory data=DATA; bytes memory dict=DICT;
    uint256 a=Tables.offset(OFFSETS,index); uint256 z=Tables.offset(OFFSETS,index+1);
    uint256 len=Tables.offset(LENGTHS,index);
    out=new string(len);
    assembly {
        let dst := add(out,32)
        for { let p := a } lt(p,z) { p := add(p,1) } {
            let stack := byte(0,mload(add(add(data,32),p)))
            for {} stack {} {
                let c := and(stack,255)
                stack := shr(8,stack)
                switch lt(c,128)
                case 1 { mstore8(dst,c) dst := add(dst,1) }
                default {
                    let pair := shr(240,mload(add(add(dict,32),mul(sub(c,128),2))))
                    stack := or(shl(16,stack),or(shl(8,and(pair,255)),shr(8,pair)))
                }
            }
        }
    }
}"""]
indices={name:i for i,(name,_) in enumerate(texts)}
lines+=['function start(uint8 kind) private pure returns(uint256) { uint8[6] memory ix=['+','.join(('uint8('+str(indices['q1'])+')') if k==1 else str(indices[f'q{k}']) for k in range(1,7))+']; return ix[kind-1]; }', 'function question(uint8 kind) internal pure returns (string memory) { return get(start(kind)); }', 'function definitions(uint8 kind) internal pure returns (string[] memory keys,string[] memory vals) {', 'uint256 n=kind==1 ? 2 : kind==2 ? 3 : kind<=4 ? 1 : kind==5 ? 4 : 8;', 'keys=new string[](n); vals=new string[](n);', 'uint256 begin=start(kind)+1;', 'for(uint256 i; i<n; ++i) { vals[i]=get(begin+i);', 'if(kind<=4) keys[i]=i==0 ? "method" : i==1 && kind==2 ? "units" : "window";', 'else if(kind==5) keys[i]=i==0 ? "false" : i==1 ? "method" : i==2 ? "true" : "window";', 'else keys[i]=i==0 ? "method" : i==1 ? "seats" : i==2 ? "agent" : i==3 ? "accepted" : i==4 ? "answer" : i==5 ? "true" : i==6 ? "false" : "window";', '}', '}', '}']
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
result='\n'.join(lines)+'\n// forgefmt: disable-end\n'
path=ROOT/'src/lib/RecipeText.sol'
if args.check:
    if not path.exists() or path.read_text()!=result: raise SystemExit('RecipeText.sol drift')
else: path.write_text(result)
print('Recipe text '+('checked' if args.check else 'written'))
