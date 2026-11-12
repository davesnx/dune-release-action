import { test, describe } from 'node:test';
import assert from 'node:assert';
import { dropLeadingV, versionFromTag } from './version';

describe('dropLeadingV', () => {
  test('drops a leading v before a digit', () => {
    assert.strictEqual(dropLeadingV('v1.2.0'), '1.2.0');
  });

  test('drops a leading V before a digit', () => {
    assert.strictEqual(dropLeadingV('V2.0'), '2.0');
  });

  test('keeps a leading v when not followed by a digit', () => {
    assert.strictEqual(dropLeadingV('vendor-1.0'), 'vendor-1.0');
  });

  test('keeps a lone v', () => {
    assert.strictEqual(dropLeadingV('v'), 'v');
  });
});

describe('versionFromTag', () => {
  test('accepts a plain numeric version', () => {
    assert.strictEqual(versionFromTag('1.2.0'), '1.2.0');
  });

  test('accepts a v-prefixed version and drops the v', () => {
    assert.strictEqual(versionFromTag('v1.2.0'), '1.2.0');
  });

  test('accepts a V-prefixed version and drops the V', () => {
    assert.strictEqual(versionFromTag('V2.0'), '2.0');
  });

  test('accepts vendor-prefixed tags unchanged', () => {
    assert.strictEqual(versionFromTag('vendor-1.0'), 'vendor-1.0');
  });

  test('accepts a monorepo package-prefixed tag unchanged', () => {
    assert.strictEqual(versionFromTag('jsonkit.1.2.0'), 'jsonkit.1.2.0');
  });

  test('accepts an opam prerelease marker', () => {
    assert.strictEqual(versionFromTag('1.0~beta1'), '1.0~beta1');
  });

  test('accepts a date-like version', () => {
    assert.strictEqual(versionFromTag('2024.09.22'), '2024.09.22');
  });

  test('accepts a build suffix with underscore and plus', () => {
    assert.strictEqual(versionFromTag('1.0+build_3'), '1.0+build_3');
  });

  test('accepts a lone v (not followed by a digit, so not dropped)', () => {
    assert.strictEqual(versionFromTag('v'), 'v');
  });

  test('rejects an empty tag', () => {
    assert.throws(() => versionFromTag(''), /Package version can't be empty/);
  });

  test('rejects a tag with a slash', () => {
    assert.throws(() => versionFromTag('release/1.0'), /Invalid character '\/' in package version "release\/1\.0"/);
  });

  test('rejects a tag with an @', () => {
    assert.throws(() => versionFromTag('1.0@2'), /Invalid character '@' in package version "1\.0@2"/);
  });

  test('rejects a tag with a #', () => {
    assert.throws(() => versionFromTag('1.0.0#1'), /Invalid character '#' in package version "1\.0\.0#1"/);
  });

  test('rejects a tag with a space', () => {
    assert.throws(() => versionFromTag('1.0 beta'), /Invalid character ' ' in package version "1\.0 beta"/);
  });
});
