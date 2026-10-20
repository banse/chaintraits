#!/usr/bin/env bash
set -euo pipefail

cast call 0xdd0017e40f1a5fe514d15d108ce01eb52f2a5edb \
  'hasTrait(address,uint16)(bool)' \
  0x000000000000000000000000000000000000c1a1 701 \
  --rpc-url https://ethereum-rpc.publicnode.com

cast call 0xdd0017e40f1a5fe514d15d108ce01eb52f2a5edb \
  'tokenOf(address)(uint256)' \
  0x000000000000000000000000000000000000c1a1 \
  --rpc-url https://ethereum-rpc.publicnode.com
