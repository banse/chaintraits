#!/usr/bin/env python3
"""One resumeless census of both curator events; no wallet list is published.

Requires Python 3 and requests. Run from repository root. Endpoints are public,
checked for mainnet, and logs are requested in nonoverlapping adaptive chunks.
"""
import hashlib
import json
import subprocess
from pathlib import Path
try:
    import requests
except ImportError:  # stdlib fallback, same JSON-RPC calls
    import urllib.request

    class _Response:
        def __init__(self, body): self._body = body
        def raise_for_status(self): pass
        def json(self): return json.loads(self._body)

    class requests:  # noqa: N801
        @staticmethod
        def post(url, json=None, timeout=30):
            import json as _json
            req = urllib.request.Request(url, data=_json.dumps(json).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'sworn-census/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return _Response(r.read())

RPCS = ['https://rpc.mevblocker.io', 'https://1.rpc.thirdweb.com', 'https://ethereum-rpc.publicnode.com']
CURATOR = '0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91'
START, END, LAUNCH = 25769870, 25789604, 1786910327
SIGNATURES = ['Deposited(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
              'FirstDeposit(address,uint256,uint256)']
TOPICS = [subprocess.check_output(['cast', 'keccak', s], text=True).strip() for s in SIGNATURES]

def rpc(url, method, params):
    r = requests.post(url, json={'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}, timeout=30)
    r.raise_for_status()
    j = r.json()
    if 'error' in j:
        raise RuntimeError(str(j['error']))
    return j['result']

def main():
    urls = []
    for url in RPCS:
        try:
            if rpc(url, 'eth_chainId', []) == '0x1':
                urls.append(url)
        except Exception:
            print(f'RPC unavailable: {url}', flush=True)
    if not urls:
        raise RuntimeError('No Ethereum mainnet RPC available')
    rows = [dict(hour=h, deposits=0, firstDeposits=0, contributors=set(), wei=0) for h in range(66)]
    wallets, seen, operators, digester = set(), set(), set(), hashlib.sha256()
    start, chunk, operator = START, 1000, 0
    while start <= END:
        end = min(start + chunk - 1, END)
        try:
            logs = rpc(urls[operator], 'eth_getLogs', [{
                'address': CURATOR, 'fromBlock': hex(start), 'toBlock': hex(end), 'topics': [TOPICS]}])
            if len(logs) >= 10000:
                raise RuntimeError('Possible result cap; shrink the range')
        except Exception:
            if chunk > 125:
                chunk //= 2
                continue
            operator += 1
            if operator >= len(urls):
                raise
            chunk = 1000
            continue
        operators.add(urls[operator])
        for log in logs:
            identity = (log['transactionHash'], log['logIndex'])
            if identity in seen or log.get('removed'):
                raise RuntimeError('Duplicate or removed log')
            seen.add(identity)
            digester.update(json.dumps(log, sort_keys=True, separators=(',', ':')).encode())
            wallet = log['topics'][1][-40:].lower()
            if log['topics'][0].lower() == TOPICS[0].lower():
                h = int(log['topics'][2], 16)
                rows[h]['deposits'] += 1
                rows[h]['wei'] += int(log['data'][2:66], 16)  # Deposited.amount, the first data word
                rows[h]['contributors'].add(wallet)
                wallets.add(wallet)
            else:
                timestamp = int(log['data'], 16)
                h = (timestamp - LAUNCH) // 3600
                rows[h]['firstDeposits'] += 1
        print(f'{start:,}..{end:,}: {len(logs):,} logs', flush=True)
        start, chunk = end + 1, 1000
    closing = [rpc(u, 'eth_getBlockByNumber', [hex(END), False])['hash'] for u in urls[:2]]
    assert len(set(closing)) == 1, 'Closing block disagrees'
    for row in rows:
        row['contributors'] = len(row['contributors'])
    wei = sum(r['wei'] for r in rows)
    assert (wei + 5 * 10**17) // 10**18 == 128131, wei  # whole ETH, rounded
    for row in rows:
        row['wei'] = str(row['wei'])
    deposits = sum(r['deposits'] for r in rows)
    first = sum(r['firstDeposits'] for r in rows)
    assert (deposits, first, len(wallets)) == (28353, 19522, 19522)
    result = dict(chainId=1, curator=CURATOR, fromBlock=START, toBlock=END,
                  closingBlockHash=closing[0], launchTime=LAUNCH, hourDuration=3600,
                  method='One eth_getLogs census, OR topic0 for Deposited and FirstDeposit, disjoint chunks',
                  endpoints=sorted(operators), crossCheck=urls[:2], topics=TOPICS,
                  logsSha256=digester.hexdigest(), deposits=deposits, contributors=len(wallets),
                  firstDeposits=first, wei=str(wei), hours=rows)
    p = Path('reference/anchors/hours.json')
    p.write_text(json.dumps(result, indent=2) + '\n')
    Path('site/public/data/hours.json').write_text(p.read_text())

if __name__ == '__main__':
    main()
