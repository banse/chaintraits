import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifySourcePin } from '../scripts/source-pin.mjs';

const web = new URL('../', import.meta.url);
test('archive builds verify pinned bytes without a git database', () => {
  const result = verifySourcePin(web);
  assert.equal(result.chainId, 1);
  assert.equal(result.contractSource, 'c4ff3238390fc51962fb67e86affc20cf418126e');
  assert.ok(result.files >= 8);
});
test('modified deployment or ABI bytes cannot pass the build pin', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-release-pin-'));
  try {
    const pin = JSON.parse(fs.readFileSync(new URL('source-pin.json', web)));
    fs.writeFileSync(path.join(temp, 'source-pin.json'), JSON.stringify(pin));
    for (const name of Object.keys(pin.files)) {
      const target = path.join(temp, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(new URL(name, web), target);
    }
    verifySourcePin(temp);
    for (const name of ['deployment-handoff.json', 'public/abi/Registry.json']) {
      const target = path.join(temp, name), original = fs.readFileSync(target);
      fs.appendFileSync(target, '\n');
      assert.throws(() => verifySourcePin(temp), /Pinned source bytes changed/);
      fs.writeFileSync(target, original);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
