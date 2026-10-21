import {readFileSync} from 'node:fs';
import {configureRuntime, type Deployment} from '../src/config';
import type {Abi} from 'viem';
const config=JSON.parse(readFileSync(new URL('../public/imd-deployment.json',import.meta.url),'utf8')) as Deployment;
const abis=Object.fromEntries(config.contracts.map(c=>[c.name,JSON.parse(readFileSync(new URL(`../public/${c.abiPath}`,import.meta.url),'utf8')) as Abi]));
configureRuntime(config,abis);
