import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorShift, visibleShare } from '../src/fact-check/hive-anchor.mjs';

const rect = (top, height) => ({ top, bottom: top + height, height });

test('visible share counts only the part inside the viewport', () => {
  assert.equal(visibleShare(rect(100, 300), { top: 0, bottom: 852 }), 1);
  assert.equal(visibleShare(rect(-150, 300), { top: 0, bottom: 852 }), 0.5);
  assert.equal(visibleShare(rect(900, 300), { top: 0, bottom: 852 }), 0);
  assert.equal(visibleShare(rect(100, 0), { top: 0, bottom: 852 }), 0);
});

test('copy added above the hive is scrolled away, the reader’s own scrolling is kept', () => {
  const anchor = { top: 285, position: 1066 };
  assert.equal(anchorShift(anchor, 697, 1066), 412);
  assert.equal(anchorShift(anchor, 185, 1166), 0);
  assert.equal(anchorShift(anchor, 597, 1166), 412);
  assert.equal(anchorShift(anchor, 199, 1066), -86);
});
