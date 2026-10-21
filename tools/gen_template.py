#!/usr/bin/env python3
"""Normative hive geometry and independent synthetic metadata goldens (standard library only)."""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
FAMILIES=['Spawned','Zero-Shot','Hopper','Bullfrog','Benchmarked','Swarmed','Uptime','Holdout','Final Token','Hotfix','PID','Top Weights','Pretrained']
SLOTS=[6,1,2,3,4,5,7,8,9,10,11,12,13]
TIERS=[1,2,3,4,3,1,1,1,1,1,1,1,1]
RARE={202,801,901,1001,1101,1102,1103,1104,1201}
DESCRIPTION='Sworn is an ownerless onchain registry of verifiable wallet feats. One card per wallet; every trait is a fact about the claimant wallet that minted the card, never about the holder. Direct-read traits are read from the settled WhitelistCurator; chain-proven, panel-attested and shared-fact traits are attested by the IMD oracle through the Intake and verified in the registry. Allowlists read hasTrait, never ownerOf. Facts about the wallet that minted it; direct traits frozen at mint; transferable.'
CLAIMANT='0x000000000000000000000000000000000000c1a1'
PREFIX='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace"><rect width="1000" height="1000" fill="#0a0a0a"/>'
OPACITIES=[['1.00'],['0.35','1.00'],['0.35','0.68','1.00'],['0.35','0.57','0.78','1.00']]

def polygon(r,cx=0,cy=0):
    return [(cx+r*math.cos(i*math.pi/3),cy+r*math.sin(i*math.pi/3)) for i in range(6)]
def fmt(v):
    return f'{v:.1f}' if abs(v)>=0.00001 else '0.0'
def point(p): return ','.join(fmt(v) for v in p)
def points(poly): return ' '.join(map(point,poly))
def clip(poly,y,below):
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        ina=(a[1]>=y) if below else (a[1]<=y)
        inb=(b[1]>=y) if below else (b[1]<=y)
        if ina: out.append(a)
        if ina != inb:
            t=(y-a[1])/(b[1]-a[1]); out.append((a[0]+t*(b[0]-a[0]),y))
    return out

def geometry():
    h=96*math.sqrt(3)
    centers=[(500,480),(500,480-h),(644,480-h/2),(644,480+h/2),(500,480+h),(356,480+h/2),(356,480-h/2),(644,480-1.5*h),(788,480),(644,480+1.5*h),(356,480+1.5*h),(212,480),(356,480-1.5*h)]
    cuts=[]
    for n in (2,3,4):
        for lv in range(1,n):
            y=77*math.sqrt(3)/2*(1-2*lv/n)
            cuts.extend([points(clip(polygon(77),y,True)),points(clip(polygon(77),y,False))])
    frame=polygon(440,500,480); order=[4,5,0,1,2,3,4]; endpoints=[]
    for step in range(65):
        length=step*6/64; edge=min(5,int(length)); t=length-edge
        a,b=frame[order[edge]],frame[order[edge+1]]
        endpoints.append(point((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]))))
    return [points(polygon(r)) for r in (89,77,62,45,28)]+[f'{fmt(x)} {fmt(y)}' for x,y in centers]+cuts+[points(frame)]+[point(frame[i]) for i in order]+endpoints

def steps(count): return 0 if count<40 else 64 if count>=8192 else min(64,(count**8).bit_length()-41)
def rings(count,slot): return sum(13*d+slot<min(count,39) for d in range(3))
def color(f): return '#00cc33' if f<=5 else '#8ff0a4' if f in (6,13) else '#dbfee6' if f==12 else '#00ff41'
def tops_for(ids):
    tops=[0]*13
    for id in ids[:25]:
        f=id//100
        if not 1<=f<=13: continue
        if f==11: tops[f-1]=id if tops[f-1]==0 else min(id,tops[f-1])
        else: tops[f-1]=max(id,tops[f-1])
    return tops

def svg(ids,count):
    t=geometry(); tops=tops_for(ids); out=PREFIX
    out+=f'<polygon points="{t[30]}" fill="none" stroke="#0c0c0c" stroke-width="3"/>'
    for slot,f in enumerate(SLOTS):
        top=tops[f-1]; n=TIERS[f-1]; lv=(1 if f==11 else top%100) if top else 0; lv=min(lv,n); k=rings(count,slot); c=color(f)
        out+=f'<g transform="translate({t[5+slot]})"><polygon points="{t[0]}" fill="none" stroke="{c if lv else "#151515"}" stroke-width="4" stroke-linejoin="round"/>'
        partial=0<lv<n
        if partial:
            ix=18+(0 if n==2 else 2 if n==3 else 6)+2*(lv-1)
            out+=f'<defs><clipPath id="h{slot}"><polygon points="{t[ix]}"/></clipPath><clipPath id="a{slot}"><polygon points="{t[ix+1]}"/></clipPath></defs>'
        if lv:
            if partial: out+=f'<g clip-path="url(#h{slot})">'
            for z in range(k+1): out+=f'<polygon points="{t[z+1]}" fill="{c}" fill-opacity="{OPACITIES[k][z]}"/>'
            if partial: out+='</g>'
        if not lv or partial:
            if partial: out+=f'<g clip-path="url(#a{slot})">'
            for z in range(k): out+=f'<polygon points="{t[z+2]}" fill="none" stroke="#05751f" stroke-width="{2 if partial else 3}"/>'
            if partial: out+='</g>'
        if top in RARE: out+='<circle cx="0.0" cy="0.0" r="11.0" fill="#ffffff"/>'
        out+='</g>'
    step=steps(count)
    if step:
        full=step*6//64; path='M'+t[31]
        for i in range(1,full+1): path+=' L'+t[31+i]
        if step*6%64: path+=' L'+t[38+step]
        out+=f'<path d="{path}" fill="none" stroke="#05751f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    return out+'</svg>'

def pct(s):
    return ''.join(f'%{c:02X}' if c>=128 or chr(c) in '%#"& <>?' else chr(c) for c in s.encode())
def quoted(s):
    out='"'
    for ch in s:
        c=ord(ch)
        if ch in ('"','\\'): out+='\\'+ch
        elif c<32 or ch in "<>&'": out+=f'\\u{c:04x}'
        else: out+=ch
    return out+'"'

def metadata(ids,count,token=1,hostile=False):
    top=tops_for(ids); capped=min(count,32)
    attrs=[{'trait_type':'Claimant','value':CLAIMANT}]+[{'trait_type':f,'value':str(i) if i else 'none'} for f,i in zip(FAMILIES,top)]
    attrs+=[{'trait_type':'community_count','value':count}]
    name="Hostile '\"<>&\\\n".ljust(32,"X") if hostile else 'Synthetic fact'
    attrs += [{'trait_type':f'Community {10001+i}','value':name} for i in range(capped)]
    def dump(x):
        if isinstance(x,str): return quoted(x)
        if isinstance(x,dict): return '{'+','.join(quoted(k)+':'+dump(v) for k,v in x.items())+'}'
        if isinstance(x,list): return '['+','.join(dump(v) for v in x)+']'
        return str(x)
    oracle=[]
    # Golden mock exposes no verified record for catalog cells: rendering tests can light arbitrary cells.
    for i in range(capped):
        oracle.append(dict(traitId=10001+i,template='T2',evidence='chain',fromBlock=2**64-1,toBlock=2**64-1,minPanelSize=5,minQuorum=3,requestId='0x'+'11'*32,oracleRequestId='0x'+'22'*32,target='0x000000000000000000000000000000000000c0de',name=name))
    doc={'name':f'Sworn #{token}','description':DESCRIPTION,'image':'data:image/svg+xml,'+pct(svg(ids,count)),'attributes':attrs,'traits':ids[:25],'community':list(range(10001,10001+capped)),'oracle':oracle}
    return 'data:application/json;base64,'+base64.b64encode(dump(doc).encode()).decode()

CASES=[('empty',[],0,1,False),('single',[101],0,1,False),('partials1',[201,301,401,501],13,1,False),('partials2',[302,402,502],26,1,False),('partials3',[403],39,1,False),('rare',[202,801,901,1001,1101,1201],0,1,False),('ordinal1000',[1102],0,1,False),('ordinal10000',[1103],0,1,False),('ordinal19522',[1104],0,1,False),('first1000',[1105],0,1,False),('short_path',[],40,1,False),('six_segments',[],8192,1,False),('wide',[101,201,202,301,302,303,401,402,403,404,501,502,503,601,701,801,901,1001,1101,1102,1103,1104,1105,1201,1301],32,2**256-1,True),('escaping',[],1,1,True)]

def generated():
    vals=geometry(); blob=''.join(vals); offsets=[0]
    for v in vals: offsets.append(offsets[-1]+len(v))
    envelope=['{"name":','Sworn #',',"description":'+quoted(DESCRIPTION)+',"image":',',"attributes":',',"traits":',',"community":',',"oracle":','}']
    env=''.join(envelope); eo=[0]
    for v in envelope: eo.append(eo[-1]+len(v))
    code='// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n// forgefmt: disable-start\nimport {Tables} from "./Tables.sol";\n// Generated by tools/gen_template.py; ASCII-only data.\nlibrary HiveTables {\n'
    for name,data,off in [('POINTS',blob,offsets),('ENVELOPE',env,eo)]:
        code+=f'bytes internal constant {name} = {json.dumps(data)};\nbytes internal constant {name}_OFFSETS = "'+''.join(f'{v:04x}' for v in off)+'";\n'
    code+='function point(uint256 i) internal pure returns (string memory) { return Tables.at(POINTS,POINTS_OFFSETS,i); }\nfunction envelope(uint256 i) internal pure returns (string memory) { return Tables.at(ENVELOPE,ENVELOPE_OFFSETS,i); }\n}\n// forgefmt: disable-end\n'
    files={'src/lib/HiveTables.sol':code}
    for name,ids,count,token,hostile in CASES:
        files[f'test/fixtures/{name}.svg']=svg(ids,count)
        files[f'test/fixtures/{name}.uri']=metadata(ids,count,token,hostile)
    files['test/fixtures/cases.json']=json.dumps([dict(name=n,ids=i,count=c,token=str(t),hostile=h) for n,i,c,t,h in CASES],indent=2)+'\n'
    return files

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--check',action='store_true'); args=parser.parse_args()
    files=generated(); bad=[]
    for name,value in files.items():
        p=ROOT/name
        if args.check:
            if not p.exists() or p.read_text()!=value: bad.append(name)
        else: p.parent.mkdir(parents=True,exist_ok=True); p.write_text(value)
    if bad: raise SystemExit('Generated drift: '+', '.join(bad))
    print(f'{len(files)} generated files '+('checked' if args.check else 'written'))
if __name__=='__main__': main()
