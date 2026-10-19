#!/usr/bin/env bash
set -euo pipefail

cast call 0x39bec7648259d5a128c29b24951eabcd4d1f95a6 \
  'hasTrait(address,uint16)(bool)' \
  0x000000000000000000000000000000000000c1a1 701 \
  --rpc-url https://ethereum-rpc.publicnode.com

cast call 0x39bec7648259d5a128c29b24951eabcd4d1f95a6 \
  'tokenOf(address)(uint256)' \
  0x000000000000000000000000000000000000c1a1 \
  --rpc-url https://ethereum-rpc.publicnode.com
