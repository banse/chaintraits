import { formatUnits, type Hex } from 'viem';
import { parse } from 'lossless-json';

export const number = (v:bigint|number|string) => typeof v==='string' ? BigInt(v).toLocaleString('en-US') : v.toLocaleString('en-US');
export function units(value:bigint, decimals=18) {
 const raw = formatUnits(value,decimals);
 const [whole,fraction] = raw.split('.');
 return BigInt(whole).toLocaleString('en-US') + (fraction ? '.'+fraction : '');
}
export function attestationUrl(id:Hex|string) {
 if (!/^0x[0-9a-fA-F]{64}$/.test(id) || /^0x0+$/.test(id)) return undefined;
 const h=id.slice(2,34);
 const uuid=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
 return `https://api.imd.fun/oracle/requests/${uuid}/attestation`;
}
export type Metadata = {image:string; name:string; oracle?: Record<string,unknown>[]; [key:string]:unknown};
export function decodeMetadata(uri:string):{metadata:Metadata;raw:string} {
 if (!uri.startsWith('data:application/json;base64,')) throw new Error('Unsupported onchain metadata encoding');
 const raw=new TextDecoder().decode(Uint8Array.from(atob(uri.split(',')[1]),c=>c.charCodeAt(0)));
 // Every bare JSON number is retained as its decimal lexeme. Never JSON.parse this payload.
 const metadata=parse(raw,undefined,(value:string)=>value) as Metadata;
 if (!metadata || typeof metadata.image!=='string' || !/^data:image\/svg\+xml(?:;base64)?,/.test(metadata.image)) throw new Error('Invalid Renderer image');
 return {metadata,raw};
}
