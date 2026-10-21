"""Local executable model of the approved T6 attribution rule, for fixture testing.
This is not an oracle, RPC collector, or substitute for an attestation. Inputs must be
complete decoded archive logs from the three named contracts for the pinned window.
"""
COLLECTION='0x0000ec93127baa929e58e97dd0095a2bfb38ec1d'
ADAPTER='0xde152afb7db5373f34876e1499fbd893a82dd336'
REPUTATION='0x8004baa17c55a88189ae136b182e5fda19de9b63'
BATCHER='0xb6d0a187b050fa5bb0b87033a203f37becf4a775'
class IncompleteEvidence(ValueError):pass

def accepted_entries(wallet, to_block, transfers, bindings, feedback, *, complete):
    if not complete:raise IncompleteEvidence('Archive logs or state are incomplete: no answer')
    wallet=wallet.lower();opened={};intervals={}
    for e in sorted(transfers,key=lambda e:(e['block'],e['logIndex'])):
        if e['contract'].lower()!=COLLECTION or e['block']>to_block:continue
        token=e['tokenId']
        if e['from'].lower()==wallet and token in opened:
            intervals.setdefault(token,[]).append((opened.pop(token),e['block']))
        if e['to'].lower()==wallet:opened[token]=e['block']
    for token,start in opened.items():intervals.setdefault(token,[]).append((start,to_block+1))
    agents={}
    for e in bindings:
        if e['contract'].lower()==ADAPTER and e['tokenContract'].lower()==COLLECTION and e['block']<=to_block:
            agents.setdefault(e['agentId'],[]).append((e['tokenId'],e['block']))
    count=0;seen=set()
    for e in feedback:
        if e['contract'].lower()!=REPUTATION or e['batcher'].lower()!=BATCHER or e['accepted']!=1 or e['block']>to_block:continue
        identity=(e['block'],e['logIndex'])
        if identity in seen:continue
        seen.add(identity)
        if any(bound<=e['block'] and any(start<=e['block']<end for start,end in intervals.get(token,[])) for token,bound in agents.get(e['agentId'],[])):
            count+=1
    return count
