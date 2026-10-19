import addresses from '../addresses.json';
import registryJson from './abi/Registry.json';
import rendererJson from './abi/Renderer.json';
import composerJson from './abi/Composer.json';
import { parseAbi, stringToHex, type Address, type Abi } from 'viem';

export const A = addresses;
export const address = (key: keyof typeof A) => A[key] as Address;
export const registryAbi = registryJson as Abi;
export const rendererAbi = rendererJson as Abi;
export const composerAbi = composerJson as Abi;
export const curatorAbi = parseAbi([
  'function firstHourOf(address) view returns (uint256 hour,bool hasJoined)',
  'function txCountOf(address) view returns (uint256)',
  'function contributedBy(address) view returns (uint256)',
  'function pointsOf(address) view returns (uint256)',
]);
export const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export const burnAbi = parseAbi([
  'function previewBridge() view returns (uint256 amountToSend,uint256 minAmountToReceive,uint256 nativeFee)',
  'function tokenBalance() view returns (uint256)',
]);
export const SYNTHETIC = '0x000000000000000000000000000000000000c1a1' as Address;
export const CONTRIBUTORS = [
  {name:'First contributor',address:'0x200e710acaa6a93bbc77146026328c40f1d60fb1'},
  {name:'Contributor 1,000',address:'0x3730ce983bcde8a76c00e5fafea7b2f89feb10b0'},
  {name:'Last contributor',address:'0x2e96662e64ed947a9656fb586b2a3596ea8ba6c2'},
] as const;
export const REPO = 'https://github.com/identity-md-launches/launch-2147-launch-sworn-registry-symbol';
export const LAUNCH = `${REPO}/pull/1`;
export const ACTION = stringToHex('oracle.request@oracle-1',{size:32});
export const EXPLORER = 'https://etherscan.io';
