"""Sworn's independent geometric source, constant tables, and synthetic golden renderer.
Python 3 standard library only. Coordinates are computed here, never by the EVM.
"""
import argparse, base64, hashlib, json, math
from pathlib import Path
import gen_questions, gen_base64
ROOT=Path(__file__).resolve().parents[1]
FAMILIES=['Spawned','Zero-Shot','Hopper','Bullfrog','Benchmarked','Swarmed','Uptime','Holdout','Final Token','Hotfix','PID','Top Weights','Pretrained']
SLOTS=[6,1,2,3,4,5,7,8,9,10,11,12,13]
H=96*math.sqrt(3)
CENTERS=[(500,480),(500,480-H),(644,480-H/2),(644,480+H/2),(500,480+H),(356,480+H/2),(356,480-H/2),(644,480-1.5*H),(788,480),(644,480+1.5*H),(356,480+1.5*H),(212,480),(356,480-1.5*H)]
TIERS=[1,2,3,4,3,1,1,1,1,1,1,1,1]
IDS=[101,201,202,301,302,303,401,402,403,404,501,502,503,601,701,801,901,1001,1101,1102,1103,1104,1105,1201,1301]
RARE={202,801,901,1001,1101,1102,1103,1104,1201}
DESCRIPTION='Sworn is an ownerless onchain registry of verifiable wallet feats. One card per wallet; every trait is a fact about the claimant wallet that minted the card, never about the holder. Direct-read traits are read from the settled WhitelistCurator; chain-proven, panel-attested and shared-fact traits are attested by the IMD oracle through the Intake and verified in the registry. Allowlists read hasTrait, never ownerOf. Facts about the wallet that minted it; direct traits frozen at mint; transferable.'
PREFIX='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace"><rect width="1000" height="1000" fill="#0a0a0a"/>'
def fmt(x):
    if abs(x)<0.05:x=0
    return f'{x:.1f}'
def points(poly):return ' '.join(f'{fmt(x)},{fmt(y)}' for x,y in poly)
def hexagon(r,cx=0,cy=0):return [(cx+r*math.cos(i*math.pi/3),cy+r*math.sin(i*math.pi/3)) for i in range(6)]
def clipped(poly,y,below):
    result=[]
    for i,a in enumerate(poly):
        b=poly[(i+1)%len(poly)];ai=a[1]>=y if below else a[1]<=y;bi=b[1]>=y if below else b[1]<=y
        if ai:result.append(a)
        if ai!=bi:
            t=(y-a[1])/(b[1]-a[1]);result.append((a[0]+t*(b[0]-a[0]),y))
    return result
def path(step):
    p=hexagon(440,500,480);order=[4,5,0,1,2,3,4];v=[p[4]];remaining=step*6
    for i in range(6):
        if remaining>=64:v.append(p[order[i+1]]);remaining-=64
        else:
            if remaining:
                a,b=p[order[i]],p[order[i+1]];v.append((a[0]+(b[0]-a[0])*remaining/64,a[1]+(b[1]-a[1])*remaining/64))
            break
    return 'M'+points(v[:1])+' '+' '.join('L'+points([x]) for x in v[1:])
def tables():
    rows=[PREFIX,'']+[points(hexagon(r)) for r in [89,77,62,45,28]]
    rows += [f'{fmt(x)} {fmt(y)}' for x,y in CENTERS]
    # Nine honey shapes: denominator 2,3,4; numerators 1..denominator-1. Reuse denominator 3.
    for n in [2,3,4]:
        for lv in range(1,n):
            y=77*math.sqrt(3)/2*(1-2*lv/n)
            rows += [points(clipped(hexagon(77),y,True)),points(clipped(hexagon(77),y,False))]
    rows += [points(hexagon(440,500,480))]+[path(i) for i in range(65)]
    return rows

def step(count):return 0 if count<40 else 64 if count>=8192 else min(64,(count**8).bit_length()-41)
def ring_count(count,slot):return sum(13*d+slot<min(count,39) for d in range(3))
def svg(ids,count):
    top=[0]*13
    for i in ids[:25]:
        f=i//100
        if 1<=f<=13 and (not top[f-1] or (i<top[f-1] if f==11 else i>top[f-1])):top[f-1]=i
    rows=tables();out=PREFIX
    for slot,f in enumerate(SLOTS):
        t=top[f-1];lv=(1 if f==11 else t%100) if t else 0;n=TIERS[f-1];lv=min(lv,n);k=ring_count(count,slot)
        c='#00cc33' if f<=5 else '#8ff0a4' if f in (6,13) else '#dbfee6' if f==12 else '#00ff41'
        out+=f'<g transform="translate({rows[7+slot]})"><polygon points="{rows[2]}" fill="none" stroke="{c if lv else "#151515"}" stroke-width="4" stroke-linejoin="round"/>'
        partial=0<lv<n
        if partial:
            ix=20+(0 if n==2 else 2 if n==3 else 6)+2*(lv-1)
            out+=f'<defs><clipPath id="h{f}"><polygon points="{rows[ix]}"/></clipPath><clipPath id="a{f}"><polygon points="{rows[ix+1]}"/></clipPath></defs>'
        if lv:
            if partial:out+=f'<g clip-path="url(#h{f})">'
            op=[['1.00'],['0.35','1.00'],['0.35','0.68','1.00'],['0.35','0.57','0.78','1.00']][k]
            for zone in range(k+1):out+=f'<polygon points="{rows[3+zone]}" fill="{c}" fill-opacity="{op[zone]}"/>'
            if partial:out+='</g>'
        if not lv or partial:
            if partial:out+=f'<g clip-path="url(#a{f})">'
            for ring in range(k):out+=f'<polygon points="{rows[4+ring]}" fill="none" stroke="#05751f" stroke-width="{2 if partial else 3}"/>'
            if partial:out+='</g>'
        if t in RARE:out+='<circle cx="0" cy="0" r="11.0" fill="#ffffff"/>'
        out+='</g>'
    out+=f'<polygon points="{rows[32]}" fill="none" stroke="#0c0c0c" stroke-width="3"/>'
    st=step(count)
    if st:out+=f'<path d="{rows[33+st]}" fill="none" stroke="#05751f" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
    return out+'</svg>'
def percent(s):
    return ''.join(f'%{c:02X}' if c in b'%#"& <>?' or c>=128 else chr(c) for c in s.encode())
def cases():
    out=[('empty',[],0),('one',[101],0),('full',IDS,0),('pid-first-thousand',[1105],0)]
    for f,n in enumerate(TIERS,1):
        for lv in range(1,n):out.append((f'tier-{f}-{lv}',[f*100+i for i in range(1,lv+1)],0))
    for i in sorted(RARE):out.append((f'rare-{i}',[i],0))
    out += [(f'rings-{n}',[101,201,301,401,501,601],n) for n in [1,13,14,26,27,39,40,70,5000,8192]]
    return out

def spec_data(i,hostile=False):
    kind=1;target='0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91';a=25769870;b=25789604
    names={601:'Swarmed',701:'Uptime',801:'Holdout',901:'Final Token',1001:'Hotfix',1101:'PID #1',1102:'PID #1000',1103:'PID #10000',1104:'PID #19522',1105:'First thousand',1201:'Top Weights',1301:'Pretrained'}
    name=names.get(i,'Community')
    if i==601:kind=6;target='0x0000ec93127baa929e58e97dd0095a2bfb38ec1d';a=25090085;b=26237654
    elif i==701:a=25777045
    elif i==1105:b=25770897
    elif i==1201:kind=3
    elif i==1301:kind=5;target='0x'+'0'*40;b=a
    elif i>=10001:
        target='0x000000000000000000000000000000000000c1a2'
        if hostile:name="A'\"\\<>&\x01"*4;a=2**64-1-7199;b=2**64-1
    return kind,target,a,b,name

def metadata(ids,count,hostile=False,token=1):
    top=[0]*13
    for i in ids[:25]:
        f=i//100
        if 1<=f<=13 and (not top[f-1] or (i<top[f-1] if f==11 else i>top[f-1])):top[f-1]=i
    community=list(range(10001,10001+min(count,32)))
    attrs=[{'trait_type':'Claimant','value':'0x000000000000000000000000000000000000c1a1'}]
    attrs += [{'trait_type':name,'value':str(top[f]) if top[f] else 'none'} for f,name in enumerate(FAMILIES)]
    attrs += [{'trait_type':'community_count','value':count}]
    attrs += [{'trait_type':f'Community {i}','value':spec_data(i,hostile)[4]} for i in community]
    oracle=[]
    for i in ids[:25]+community:
        if i<10001 and i not in [601,701,801,901,1001,1101,1102,1103,1104,1105,1201,1301]:continue
        k,t,a,b,name=spec_data(i,hostile);panel=k in (3,5,6)
        oracle.append(dict(traitId=i,template=f'T{k}',evidence='panel' if k>=5 else 'chain',fromBlock=a,toBlock=b,minPanelSize=11 if panel else 5,minQuorum=7 if panel else 3,requestId=f'0x{i:064x}',oracleRequestId=f'0x{i+100000:064x}',target=t,name=name))
    obj=dict(name=f'Sworn #{token}',description=DESCRIPTION,image='data:image/svg+xml,'+percent(svg(ids,count)),attributes=attrs,traits=ids[:25],community=community,oracle=oracle)
    text=json.dumps(obj,separators=(',',':'),ensure_ascii=True)
    for c,esc in [('<',r'\u003c'),('>',r'\u003e'),('&',r'\u0026'),("'",r'\u0027')]:text=text.replace(c,esc)
    return text

def generated():
    rows=tables();offsets=[0]
    for r in rows:offsets.append(offsets[-1]+len(r))
    blob=''.join(rows)
    sol='// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n// Generated by tools/gen_template.py; all geometry is precomputed.\nimport {Text} from "./Text.sol";\nlibrary HiveData {\n'
    sol+='bytes constant DATA = '+json.dumps(blob)+';\nbytes constant OFFSETS = "'+''.join(f'{n:04x}' for n in offsets)+'";\n'
    envelope=['{\"name\":\"Sworn #','\",\"description\":\"'+DESCRIPTION+'\",\"image\":\"data:image/svg+xml,','\",\"attributes\":',',\"traits\":',',\"community\":',',\"oracle\":[',']}']
    eo=[0]
    for text in envelope:eo.append(eo[-1]+len(text))
    sol+='bytes constant ENVELOPE = '+json.dumps(''.join(envelope))+';\nbytes constant ENVELOPE_OFFSETS = \"'+''.join(f'{n:04x}' for n in eo)+'\";\n'
    sol+='''function offset(bytes memory o,uint256 n) private pure returns(uint256 v) { for(uint256 i;i<4;++i){uint8 c=uint8(o[n*4+i]);v=v*16+(c<=57?c-48:c-87);} }
    function envelope(uint256 n) internal pure returns(string memory){Table memory t=Table(ENVELOPE,ENVELOPE_OFFSETS);return get(t,n);}
    struct Table { bytes data; bytes offsets; }
    function load() internal pure returns(Table memory t){t.data=DATA;t.offsets=OFFSETS;}
    function get(Table memory t,uint256 n) internal pure returns(string memory){bytes memory data=t.data;bytes memory o=t.offsets;uint256 start=offset(o,n);Text.Buffer memory b=Text.buffer(offset(o,n+1)-start);Text.slice(b,data,start,b.data.length);return Text.finish(b);}
}\n'''
    files={'src/HiveData.sol':sol}
    for name,ids,count in cases():
        files[f'test/fixtures/{name}.svg']=svg(ids,count)
        files[f'test/fixtures/{name}.json']=metadata(ids,count)
    files['test/fixtures/widest.json']=metadata(IDS,32,True,2**256-1)
    files['test/fixtures/hive-cases.json']=json.dumps([{'name':n,'ids':ids,'count':c} for n,ids,c in cases()],indent=2)+'\n'
    files['test/fixtures/table-layout.json']=json.dumps({'offsets':offsets,'size':len(blob)},indent=2)+'\n'
    return files

def normalize_sol(s):
    # Foundry owns layout. Preserve every token and every byte of each literal.
    import re
    return re.findall(r'"(?:[^"\\]|\\.)*"|\S',s)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    files=generated();files['src/Questions.sol']=gen_questions.output();files['src/Base64Fast.sol']=gen_base64.output()
    for name,data in files.items():
        path=ROOT/name
        if args.check:
            old=path.read_text() if path.exists() else ''
            same=normalize_sol(old)==normalize_sol(data) if name.endswith('.sol') else old==data
            if not same:raise SystemExit('Generated drift: '+name)
        else:path.parent.mkdir(parents=True,exist_ok=True);path.write_text(data)
    print(f'{len(files)} generated files '+('checked' if args.check else 'written'))
if __name__=='__main__':main()
