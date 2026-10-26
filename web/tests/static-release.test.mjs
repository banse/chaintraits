import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyStaticRelease } from '../scripts/static-release.mjs';

test('the publish gate refuses mock runtime transports and absolute local asset paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sworn-static-release-'));
  fs.mkdirSync(path.join(temp, 'assets'));
  try {
    fs.writeFileSync(path.join(temp, 'index.html'), '<script src="./assets/app.js"></script>');
    fs.writeFileSync(path.join(temp, 'assets/app.js'), 'fetch("https://api.imd.fun/oracle/requests")');
    assert.doesNotThrow(() => verifyStaticRelease(temp));
    for (const code of ['fetch("/__mock/rpc")', 'const x="sworn-mock"', 'installMockBoundary()']) {
      fs.writeFileSync(path.join(temp, 'assets/app.js'), code);
      assert.throws(() => verifyStaticRelease(temp), /Mock runtime/);
    }
    for (const label of ['Fact Check Demo', 'Replay sequence', 'Choose a static snapshot', 'sworn-demo.eth', 'scripted participation']) {
      fs.writeFileSync(path.join(temp, 'assets/app.js'), JSON.stringify(label));
      assert.throws(() => verifyStaticRelease(temp), /Demo runtime/);
    }
    fs.writeFileSync(path.join(temp, 'assets/app.js'), 'console.log("public runtime")');
    fs.writeFileSync(path.join(temp, 'index.html'), '<script src="/assets/app.js"></script>');
    assert.throws(() => verifyStaticRelease(temp), /relative/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
