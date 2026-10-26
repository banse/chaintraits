// Compile the current source offline and copy its built frontend into an isolated test runtime.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import solc from 'solc';
import { keccak256 } from 'viem';

const here = import.meta.dirname;
const { values } = parseArgs({ options: { root: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('node simulation/build.mjs [--root simulation/.runtime]\nCompile pinned contracts and copy the current frontend into a local simulation runtime.');
  process.exit(0);
}
const project = path.resolve(here, '../..');
const dist = path.join(project, 'dist');
const root = path.resolve(values.root ?? path.join(here, '.runtime'));
const chainDir = path.join(root, 'mock/chain');
const siteDir = path.join(root, 'mock/site');
const sources = Object.fromEntries(fs.readdirSync(path.join(project, 'src')).filter(f => f.endsWith('.sol'))
  .map(f => [`src/${f}`, { content: fs.readFileSync(path.join(project, 'src', f), 'utf8') }]));
sources['Mocks.sol'] = { content: fs.readFileSync(path.join(here, 'sol/src/Mocks.sol'), 'utf8') };
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: {
  optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun',
  metadata: { bytecodeHash: 'none', appendCBOR: false },
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
} }), { import: file => {
  try { return { contents: fs.readFileSync(path.join(here, 'vendor', file), 'utf8') }; }
  catch { return { error: `Missing vendored source ${file}` }; }
} }));
const errors = output.errors?.filter(e => e.severity === 'error');
if (errors?.length) throw Error(errors.map(e => e.formattedMessage).join('\n'));
fs.mkdirSync(chainDir, { recursive: true });
fs.mkdirSync(siteDir, { recursive: true });
const preview = JSON.parse(fs.readFileSync(path.join(dist, 'data/renderer-preview.json')));
const contracts = { sourceCommit: preview.sourceCommit, compiler: solc.version() };
for (const name of ['Registry', 'Composer', 'Renderer']) {
  const c = output.contracts[`src/${name}.sol`][name];
  const runtime = `0x${c.evm.deployedBytecode.object}`;
  const runtimeHash = keccak256(runtime);
  if (runtimeHash !== preview.contracts[name].runtimeHash) throw Error(`${name}: compiled runtime differs from current frontend pin`);
  contracts[name] = { creation: `0x${c.evm.bytecode.object}`, runtime, runtimeHash };
}
fs.writeFileSync(path.join(chainDir, 'contracts.json'), JSON.stringify(contracts));
for (const [name, c] of Object.entries(output.contracts['Mocks.sol']))
  fs.writeFileSync(path.join(chainDir, `${name}.json`), JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` }));
fs.cpSync(dist, siteDir, { recursive: true });
fs.copyFileSync(path.join(here, 'shim.js'), path.join(root, 'mock/shim.js'));
const index = path.join(siteDir, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(/<head[^>]*>/i, h => `${h}\n<script src="/__mock__/shim.js"></script>`));
console.log(JSON.stringify({ root, sourceCommit: contracts.sourceCommit, compiler: contracts.compiler,
  verifiedRuntimeHashes: Object.fromEntries(['Registry', 'Composer', 'Renderer'].map(n => [n, contracts[n].runtimeHash])) }, null, 2));
