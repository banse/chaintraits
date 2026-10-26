import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyStaticRelease(root) {
  const dir = root instanceof URL ? fileURLToPath(root) : path.resolve(root);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (/(?:src|href)=["']\/(?!\/)/.test(html)) throw Error('Static entry assets must use relative paths.');
  const files = fs.readdirSync(path.join(dir, 'assets')).filter(name => /\.(?:js|css)$/.test(name));
  for (const name of files) {
    const body = fs.readFileSync(path.join(dir, 'assets', name), 'utf8');
    if (/__mock|sworn-mock|installMockBoundary|Simulation controls|Simulate speed-up/.test(body))
      throw Error(`Mock runtime remains in the mainnet export: ${name}`);
    if (/FactCheckDemo|Fact Check Demo|Replay sequence|Choose a static snapshot|sworn-demo\.eth|scripted participation/.test(body))
      throw Error(`Demo runtime remains in the mainnet export: ${name}`);
  }
  return { files: files.length, relativeAssets: true, mockTransport: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyStaticRelease(new URL('../../dist/', import.meta.url));
  console.log(`Mainnet static export verified: ${result.files} script/style assets; no fixture transport.`);
}
