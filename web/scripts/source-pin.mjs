import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Verify an archive's public inputs without requiring another checkout's Git history.
export function verifySourcePin(root) {
  const dir = root instanceof URL ? fileURLToPath(root) : path.resolve(root);
  const pin = JSON.parse(fs.readFileSync(path.join(dir, 'source-pin.json')));
  if (pin.chainId !== 1 || pin.contractSource !== 'c4ff3238390fc51962fb67e86affc20cf418126e')
    throw Error('Unexpected mainnet source binding.');
  for (const [name, expected] of Object.entries(pin.files)) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) throw Error('Unsafe source pin path.');
    const hash = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    if (hash !== expected) throw Error(`Pinned source bytes changed: ${name}`);
  }
  const handoff = JSON.parse(fs.readFileSync(path.join(dir, 'deployment-handoff.json')));
  if (handoff.sourceCommit !== pin.contractSource || handoff.chainId !== 1)
    throw Error('Deployment does not match the mainnet source pin.');
  return { chainId: pin.chainId, contractSource: pin.contractSource, files: Object.keys(pin.files).length };
}
