"""Deterministic dictionary compression of repeated approved prose (ASCII tables)."""
import re
from collections import Counter

def compress(values):
    values=list(values); dictionary=[]
    for _ in range(128):
        counts=Counter()
        for s in values:
            words=re.split(r'( )',s)
            # Phrase boundaries at spaces. A replacement token cannot be in a new phrase.
            for i in range(0,len(words),2):
                for n in (2,4,6,8,12,16,24,32,48,64,80):
                    t=''.join(words[i:i+n])
                    if len(t)>8 and '|' not in t:counts[t]+=1
        candidates=[((c-1)*len(t)-c*3-8,t) for t,c in counts.items() if c>1]
        if not candidates:break
        score,phrase=max(candidates)
        if score<8:break
        token='|'+f'{len(dictionary):02x}'
        values=[v.replace(phrase,token) for v in values];dictionary.append(phrase)
    return values,dictionary
