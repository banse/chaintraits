"""Compile approved recipe text into compact ASCII tables. No previous product code is used."""
import json
from pathlib import Path
from compress_questions import compress
ROOT=Path(__file__).resolve().parents[1]
A='0x000000000000000000000000000000000000c1a1'; C='0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91'
FILES=['701-still-here','T2-log-sum-composed','1201-top-32','T4-call-compare-reference','1301-not-born-yesterday','T6-operator-reference','T5-community-composed']
def patterns():
    recipes=[]
    for i,file in enumerate(FILES,1):
        obj=json.loads((ROOT/'templates/fixtures'/f'{file}.json').read_text()); replacements=[(A,'~A'),(C,'~B')]
        if i in (1,2,3):
            start=obj['question'].index('`')+1;end=obj['question'].index('`',start)
            replacements += [(obj['question'][start:end],'~C'),('0x1895395','~G'),('0x189378e','~G'),('0x18984a4','~H')]
            if i==2:replacements += [('sum the amount argument','sum the ~E argument')]
            if i==3:replacements += [('weightAdded','~E'),('topic 1','topic ~M'),('32','~F')]
            replacements += [('contributor','~D')]
        elif i==4:replacements += [('function pointsOf(address) view returns (uint256)','~C'),('0x18984a4','~H'),('1000','~F'),('>=','~J')]
        elif i in (5,7):
            replacements += [('25769870' if i==5 else '25789604','~K'),('0x189378e' if i==5 else '0x18984a4','~H'),('0x14','~L'),('20','~F')]
            replacements=[r for r in replacements if r[0]!=C]
        elif i==6:replacements += [('26237654','~K')]
        def subst(s):
            for a,b in replacements:s=s.replace(a,b)
            if i in (1,2) and 'Answer' in s:s=s.replace('. Answer','~I. Answer')
            return s
        recipes.append((subst(obj['question']),[(k,subst(v)) for k,v in obj['definitions'].items()]))
    return recipes

def output():
    texts=[]
    def index(t):
        if t not in texts:texts.append(t)
        return texts.index(t)
    qs=[]; defs=[]
    for q,kv in patterns():qs.append(index(q));defs.append([(index(k),index(v)) for k,v in kv])
    # Only unique strings are considered for compression, so savings reflect actual bytecode.
    packed,dictionary=compress(texts)
    blob=''.join(packed); offsets=[0]
    for t in packed:offsets.append(offsets[-1]+len(t))
    db=''.join(dictionary); do=[0]
    for t in dictionary:do.append(do[-1]+len(t))
    ds=[]; dp=[0]
    for row in defs:
        for k,v in row:ds.extend([k,v])
        dp.append(len(ds))
    const=lambda n,v:f'bytes constant {n} = {json.dumps(v)};\n'
    source='// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n// Generated from approved fixtures by tools/gen_questions.py.\nimport {Text} from "./Text.sol";\nlibrary Questions {\n'
    source+=const('BLOB',blob)+const('OFFSETS',''.join(f'{v:04x}' for v in offsets))
    source+=const('DICT',db)+const('DOFFSETS',''.join(f'{v:04x}' for v in do))
    source+=const('QS',''.join(f'{v:04x}' for v in qs))+const('DEFS',''.join(f'{v:04x}' for v in ds))+const('DP',''.join(f'{v:04x}' for v in dp))
    source+=r'''function nibble(bytes1 c) private pure returns(uint256) {uint8 x=uint8(c);return x<=57?x-48:x-87;}
    function at(bytes memory o,uint256 n) private pure returns(uint256 v){for(uint256 i;i<4;++i){v=v*16+nibble(o[n*4+i]);}}
    function textAt(uint256 n) private pure returns(string memory){
        bytes memory blob=BLOB;bytes memory offsets=OFFSETS;uint256 a=at(offsets,n);uint256 end=at(offsets,n+1);
        Text.Buffer memory b=Text.buffer(6000);bytes memory d=DICT;bytes memory offs=DOFFSETS;uint256 start=a;
        for(uint256 i=a;i<end;++i){if(blob[i]=="|"){
            Text.slice(b,blob,start,i-start);uint256 t=nibble(blob[i+1])*16+nibble(blob[i+2]);uint256 k=at(offs,t);
            Text.slice(b,d,k,at(offs,t+1)-k);i+=2;start=i+1;
        }}
        Text.slice(b,blob,start,end-start);return Text.finish(b);
    }
    function question(uint256 kind) internal pure returns(string memory){return textAt(at(QS,kind-1));}
    function definitions(uint256 kind) internal pure returns(string[] memory keys,string[] memory vals){
        uint256 start=at(DP,kind-1);uint256 count=(at(DP,kind)-start)/2;bytes memory defs=DEFS;
        keys=new string[](count);vals=new string[](count);
        for(uint256 i;i<count;++i){keys[i]=textAt(at(defs,start+i*2));vals[i]=textAt(at(defs,start+i*2+1));}
    }
}
'''
    return source

def generate(check=False):
    path=ROOT/'src/Questions.sol';data=output()
    if check:
        from gen_template import normalize_sol
        if normalize_sol(path.read_text())!=normalize_sol(data):raise SystemExit('Question table drift')
    else:path.write_text(data)
if __name__=='__main__':
    import sys
    generate('--check' in sys.argv)
