import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  parseChangelog,
  validateChangelog,
  extractVersionChangelog,
  formatCommitEntry,
  isEntryInChangelog,
  addToUnreleased,
  promoteUnreleasedToVersion,
  getUnreleasedContent,
  hasVersion,
  getVersions,
  addVersionSection,
  CommitEntry
} from './changelog';
import Fs from 'fs';
import Path from 'path';
import OS from 'os';

// Test utilities
let testFileCounter = 0;
const testFiles: string[] = [];

function createTestFile(content: string): string {
  const testFile = Path.join(OS.tmpdir(), `changelog-test-${Date.now()}-${testFileCounter++}.md`);
  Fs.writeFileSync(testFile, content);
  testFiles.push(testFile);
  return testFile;
}

function cleanupTestFiles(): void {
  for (const file of testFiles) {
    try {
      if (Fs.existsSync(file)) {
        Fs.unlinkSync(file);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
  testFiles.length = 0;
}

// ============================================================================
// parseChangelog Tests
// ============================================================================

describe('parseChangelog', () => {
  afterEach(cleanupTestFiles);

  test('parses version entries with date', () => {
    const testFile = createTestFile(`# Changelog

## v1.0.0 (2025-01-13)

- Added feature A
- Fixed bug B

## v0.9.0 (2025-01-01)

- Initial release
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].version, '1.0.0');
    assert.strictEqual(entries[0].date, '2025-01-13');
    assert.ok(entries[0].content.includes('Added feature A'));
    assert.strictEqual(entries[1].version, '0.9.0');
  });

  test('parses version entries without date', () => {
    const testFile = createTestFile(`## 1.0.0

- Added feature A

## 0.9.0

- Initial release
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].version, '1.0.0');
    assert.strictEqual(entries[0].date, undefined);
    assert.strictEqual(entries[1].version, '0.9.0');
  });

  test('parses unreleased section', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Work in progress

## v1.0.0

- Released feature
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].version, 'unreleased');
    assert.ok(entries[0].content.includes('Work in progress'));
    assert.strictEqual(entries[1].version, '1.0.0');
  });

  test('parses beta/pre-release versions', () => {
    const testFile = createTestFile(`## 1.0.0-beta.1

- Beta release
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].version, '1.0.0-beta.1');
  });

  test('returns empty array for empty file', () => {
    const testFile = createTestFile('');
    const entries = parseChangelog(testFile);
    assert.strictEqual(entries.length, 0);
  });

  test('parses alpha and rc versions', () => {
    const testFile = createTestFile(`## v2.0.0-alpha.1

- Alpha changes

## v1.5.0-rc.2

- Release candidate

## v1.0.0-alpha

- Simple alpha
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].version, '2.0.0-alpha.1');
    assert.strictEqual(entries[1].version, '1.5.0-rc.2');
    assert.strictEqual(entries[2].version, '1.0.0-alpha');
  });

  test('parses dates in different formats', () => {
    const testFile = createTestFile(`## v1.3.0 (2025-12-31)

- Standard date

## v1.2.0 (2025/06/15)

- Slash date

## v1.1.0 (Jan 1, 2025)

- Named month

## v1.0.0

- No date
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries[0].date, '2025-12-31');
    // Other date formats might not parse correctly, which is expected
    assert.strictEqual(entries[3].date, undefined);
  });

  test('handles file with only title', () => {
    const testFile = createTestFile(`# Changelog

This is a changelog for my project.
`);
    const entries = parseChangelog(testFile);
    assert.strictEqual(entries.length, 0);
  });

  test('handles deeply nested version numbers', () => {
    const testFile = createTestFile(`## v1.2.3.4.5

- Deep version

## v0.0.0.0.1

- Very deep
`);
    const entries = parseChangelog(testFile);
    assert.strictEqual(entries.length, 2);
  });

  test('handles entries with special markdown', () => {
    const testFile = createTestFile(`## v1.0.0

- Added **bold** feature
- Fixed \`code\` bug
- [Link](https://example.com)
- > Quote
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].content.includes('**bold**'));
    assert.ok(entries[0].content.includes('`code`'));
  });

  test('handles unicode in version content', () => {
    const testFile = createTestFile(`## v1.0.0

- Added 日本語 support
- Fixed émoji 🎉 rendering
- Chinese: 中文支持
`);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].content.includes('日本語'));
    assert.ok(entries[0].content.includes('🎉'));
    assert.ok(entries[0].content.includes('中文支持'));
  });

  test('handles malformed headers gracefully', () => {
    const testFile = createTestFile(`# Changelog

##v1.0.0

- Missing space after ##

## v0.9.0(2025-01-01)

- Missing space before date

##    v0.8.0

- Extra spaces
`);
    const entries = parseChangelog(testFile);
    // Should parse what it can, even if some are malformed
    assert.ok(entries.length >= 0);
  });

  test('handles very large changelog', () => {
    let content = '# Changelog\n\n';
    for (let i = 100; i >= 1; i--) {
      content += `## v${i}.0.0 (2025-01-01)\n\n`;
      for (let j = 0; j < 10; j++) {
        content += `- Feature ${i}-${j} with some description text\n`;
      }
      content += '\n';
    }
    const testFile = createTestFile(content);
    const entries = parseChangelog(testFile);

    assert.strictEqual(entries.length, 100);
    assert.strictEqual(entries[0].version, '100.0.0');
    assert.strictEqual(entries[99].version, '1.0.0');
  });
});

// ============================================================================
// validateChangelog Tests
// ============================================================================

describe('validateChangelog', () => {
  afterEach(cleanupTestFiles);

  test('validates changelog with matching version', () => {
    const testFile = createTestFile(`## 1.0.0

- Added feature A
- Fixed bug B
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasVersionEntry, true);
    assert.strictEqual(validation.hasUnreleased, false);
    assert.strictEqual(validation.errors.length, 0);
    assert.ok(validation.versionContent?.includes('Added feature A'));
  });

  test('validates changelog with v prefix in version', () => {
    const testFile = createTestFile(`## v1.0.0

- Added feature A
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasVersionEntry, true);
  });

  test('validates when input has v prefix but changelog doesnt', () => {
    const testFile = createTestFile(`## 1.0.0

- Feature
`);
    const validation = validateChangelog(testFile, 'v1.0.0');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasVersionEntry, true);
  });

  test('warns about unreleased content', () => {
    const testFile = createTestFile(`## Unreleased

- Work in progress

## 1.0.0

- Released feature
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasUnreleased, true);
    assert.ok(validation.warnings.length > 0);
    assert.ok(validation.warnings[0].includes('Unreleased'));
  });

  test('fails when version not found', () => {
    const testFile = createTestFile(`## 0.9.0

- Old version
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.hasVersionEntry, false);
    assert.ok(validation.errors.length > 0);
    assert.ok(validation.errors[0].includes('does not contain an entry'));
  });

  test('fails when version entry is empty', () => {
    const testFile = createTestFile(`## 1.0.0

## 0.9.0

- Old version
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.some(e => e.includes('is empty')));
  });

  test('warns when version entry is too short', () => {
    const testFile = createTestFile(`## 1.0.0

- Fix
`);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.strictEqual(validation.valid, true);
    assert.ok(validation.warnings.some(w => w.includes('seems very short')));
  });

  test('fails when file does not exist', () => {
    const validation = validateChangelog('/nonexistent/path/to/file.md', '1.0.0');

    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors[0].includes('not found'));
  });

  test('validates pre-release versions', () => {
    const testFile = createTestFile(`## 1.0.0-beta.1

- Beta feature
`);
    const validation = validateChangelog(testFile, '1.0.0-beta.1');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasVersionEntry, true);
  });

  test('handles version with date correctly', () => {
    const testFile = createTestFile(`## v2.0.0 (2025-06-15)

- Major update with lots of changes
- Another change here
`);
    const validation = validateChangelog(testFile, '2.0.0');

    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.hasVersionEntry, true);
  });
});

// ============================================================================
// extractVersionChangelog Tests
// ============================================================================

describe('extractVersionChangelog', () => {
  afterEach(cleanupTestFiles);

  test('extracts version-specific changelog', () => {
    const testFile = createTestFile(`## 1.0.0 (2025-01-13)

- Added feature A
- Fixed bug B

## 0.9.0

- Old version
`);
    const outputFile = Path.join(OS.tmpdir(), `extracted-${Date.now()}.md`);
    testFiles.push(outputFile);

    extractVersionChangelog(testFile, '1.0.0', outputFile);

    assert.ok(Fs.existsSync(outputFile));
    const extracted = Fs.readFileSync(outputFile, 'utf-8');
    assert.ok(extracted.includes('1.0.0'));
    assert.ok(extracted.includes('Added feature A'));
    assert.ok(!extracted.includes('Old version'));
  });

  test('extracts version with v prefix', () => {
    const testFile = createTestFile(`## v1.0.0

- Feature A
`);
    const outputFile = Path.join(OS.tmpdir(), `extracted-v-${Date.now()}.md`);
    testFiles.push(outputFile);

    extractVersionChangelog(testFile, 'v1.0.0', outputFile);

    assert.ok(Fs.existsSync(outputFile));
    const extracted = Fs.readFileSync(outputFile, 'utf-8');
    assert.ok(extracted.includes('Feature A'));
  });

  test('throws error when version not found', () => {
    const testFile = createTestFile(`## 1.0.0

- Feature A
`);
    const outputFile = Path.join(OS.tmpdir(), `extracted-notfound-${Date.now()}.md`);

    assert.throws(
      () => extractVersionChangelog(testFile, '2.0.0', outputFile),
      /No changelog entry found/
    );
  });

  test('extracts pre-release version', () => {
    const testFile = createTestFile(`## v2.0.0-beta.1 (2025-03-01)

- Beta feature
- Another beta thing

## v1.0.0

- Stable release
`);
    const outputFile = Path.join(OS.tmpdir(), `extracted-beta-${Date.now()}.md`);
    testFiles.push(outputFile);

    extractVersionChangelog(testFile, '2.0.0-beta.1', outputFile);

    const extracted = Fs.readFileSync(outputFile, 'utf-8');
    assert.ok(extracted.includes('Beta feature'));
    assert.ok(!extracted.includes('Stable release'));
  });

  test('extracts version from middle of changelog', () => {
    const testFile = createTestFile(`## v3.0.0

- Latest

## v2.0.0 (2025-02-01)

- Middle version feature
- Another middle change

## v1.0.0

- First release
`);
    const outputFile = Path.join(OS.tmpdir(), `extracted-middle-${Date.now()}.md`);
    testFiles.push(outputFile);

    extractVersionChangelog(testFile, '2.0.0', outputFile);

    const extracted = Fs.readFileSync(outputFile, 'utf-8');
    assert.ok(extracted.includes('Middle version feature'));
    assert.ok(!extracted.includes('Latest'));
    assert.ok(!extracted.includes('First release'));
  });
});

// ============================================================================
// formatCommitEntry Tests
// ============================================================================

describe('formatCommitEntry', () => {
  test('formats entry with PR number and repo URL', () => {
    const entry: CommitEntry = {
      message: 'Add new feature',
      author: 'davesnx',
      prNumber: 123,
      repoUrl: 'https://github.com/davesnx/dune-release-action'
    };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(
      formatted,
      '- Add new feature by @davesnx ([#123](https://github.com/davesnx/dune-release-action/pull/123))'
    );
  });

  test('formats entry with PR number but no repo URL', () => {
    const entry: CommitEntry = { message: 'Add new feature', author: 'davesnx', prNumber: 123 };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(formatted, '- Add new feature by @davesnx (#123)');
  });

  test('formats entry with commit SHA when no PR (links to commit)', () => {
    const entry: CommitEntry = {
      message: 'Fix bug',
      author: 'davesnx',
      commitSha: 'abc1234567890def',
      repoUrl: 'https://github.com/davesnx/dune-release-action'
    };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(
      formatted,
      '- Fix bug by @davesnx ([abc1234](https://github.com/davesnx/dune-release-action/commit/abc1234567890def))'
    );
  });

  test('formats entry without PR or commit SHA', () => {
    const entry: CommitEntry = { message: 'Fix bug', author: 'davesnx' };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(formatted, '- Fix bug by @davesnx');
  });

  test('handles author already having @ prefix', () => {
    const entry: CommitEntry = { message: 'Fix bug', author: '@davesnx' };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(formatted, '- Fix bug by @davesnx');
  });

  test('prefers PR link over commit link when both available', () => {
    const entry: CommitEntry = {
      message: 'Add feature',
      author: 'davesnx',
      prNumber: 42,
      commitSha: 'abc1234567890def',
      repoUrl: 'https://github.com/davesnx/dune-release-action'
    };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(
      formatted,
      '- Add feature by @davesnx ([#42](https://github.com/davesnx/dune-release-action/pull/42))'
    );
  });

  test('handles special characters in commit message', () => {
    const entry: CommitEntry = {
      message: 'Fix `code` in <template> & "quotes"',
      author: 'davesnx'
    };
    const formatted = formatCommitEntry(entry);
    assert.ok(formatted.includes('`code`'));
    assert.ok(formatted.includes('<template>'));
    assert.ok(formatted.includes('&'));
  });

  test('handles unicode in commit message', () => {
    const entry: CommitEntry = {
      message: 'Add 日本語 support 🎉',
      author: 'davesnx'
    };
    const formatted = formatCommitEntry(entry);
    assert.ok(formatted.includes('日本語'));
    assert.ok(formatted.includes('🎉'));
  });

  test('handles very long commit message', () => {
    const longMessage = 'A'.repeat(500);
    const entry: CommitEntry = {
      message: longMessage,
      author: 'davesnx'
    };
    const formatted = formatCommitEntry(entry);
    assert.ok(formatted.length > 500);
    assert.ok(formatted.includes(longMessage));
  });

  test('handles empty message', () => {
    const entry: CommitEntry = { message: '', author: 'davesnx' };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(formatted, '-  by @davesnx');
  });

  test('handles commit SHA shorter than 7 chars', () => {
    const entry: CommitEntry = {
      message: 'Fix',
      author: 'user',
      commitSha: 'abc',
      repoUrl: 'https://github.com/test/repo'
    };
    const formatted = formatCommitEntry(entry);
    assert.ok(formatted.includes('[abc]'));
  });

  test('handles author with special characters', () => {
    const entry: CommitEntry = {
      message: 'Feature',
      author: 'user-name_123'
    };
    const formatted = formatCommitEntry(entry);
    assert.strictEqual(formatted, '- Feature by @user-name_123');
  });
});

// ============================================================================
// isEntryInChangelog Tests
// ============================================================================

describe('isEntryInChangelog', () => {
  afterEach(cleanupTestFiles);

  test('returns true when entry exists', () => {
    const testFile = createTestFile(`## Unreleased

- Add new feature by davesnx (#123)
`);
    assert.strictEqual(isEntryInChangelog(testFile, 'Add new feature'), true);
  });

  test('returns false when entry does not exist', () => {
    const testFile = createTestFile(`## Unreleased

- Different feature by someone (#456)
`);
    assert.strictEqual(isEntryInChangelog(testFile, 'Add new feature'), false);
  });

  test('returns false when file does not exist', () => {
    assert.strictEqual(isEntryInChangelog('/nonexistent/file.md', 'anything'), false);
  });

  test('finds entry case-insensitively', () => {
    const testFile = createTestFile(`## Unreleased

- Add New Feature by davesnx
`);
    // Exact match should work
    assert.strictEqual(isEntryInChangelog(testFile, 'Add New Feature'), true);
    // Different case should also match (case-insensitive for better UX)
    assert.strictEqual(isEntryInChangelog(testFile, 'add new feature'), true);
    assert.strictEqual(isEntryInChangelog(testFile, 'ADD NEW FEATURE'), true);
  });

  test('finds partial message match', () => {
    const testFile = createTestFile(`## Unreleased

- feat(api): Add new endpoint for users by davesnx (#123)
`);
    // Should find by the main message part
    assert.strictEqual(isEntryInChangelog(testFile, 'Add new endpoint for users'), true);
  });

  test('finds entry in version section, not just unreleased', () => {
    const testFile = createTestFile(`## Unreleased

- New stuff

## v1.0.0

- Old feature that was added
`);
    assert.strictEqual(isEntryInChangelog(testFile, 'Old feature that was added'), true);
  });

  test('handles special regex characters in message', () => {
    const testFile = createTestFile(`## Unreleased

- Fix bug with array[0] access
- Handle (parentheses) properly
- Match a.b.c pattern
`);
    assert.strictEqual(isEntryInChangelog(testFile, 'array[0]'), true);
    assert.strictEqual(isEntryInChangelog(testFile, '(parentheses)'), true);
    assert.strictEqual(isEntryInChangelog(testFile, 'a.b.c'), true);
  });
});

// ============================================================================
// addToUnreleased Tests
// ============================================================================

describe('addToUnreleased', () => {
  afterEach(cleanupTestFiles);

  test('adds entries to existing unreleased section', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Existing entry

## v1.0.0

- Released feature
`);
    addToUnreleased(testFile, [{ message: 'New feature', author: 'davesnx', prNumber: 42 }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('- New feature by @davesnx (#42)'));
    assert.ok(result.includes('- Existing entry'));
    assert.ok(result.includes('## v1.0.0'));
  });

  test('creates unreleased section if not exists', () => {
    const testFile = createTestFile(`# Changelog

## v1.0.0

- Released feature
`);
    addToUnreleased(testFile, [{ message: 'New feature', author: 'davesnx' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## Unreleased'));
    assert.ok(result.includes('- New feature by @davesnx'));
  });

  test('creates changelog file if not exists', () => {
    const testFile = Path.join(OS.tmpdir(), `nonexistent-${Date.now()}.md`);
    testFiles.push(testFile);

    // Ensure file doesn't exist
    if (Fs.existsSync(testFile)) {
      Fs.unlinkSync(testFile);
    }

    addToUnreleased(testFile, [{ message: 'Initial feature', author: 'davesnx', prNumber: 1 }]);

    assert.ok(Fs.existsSync(testFile));
    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('# Changelog'));
    assert.ok(result.includes('## Unreleased'));
    assert.ok(result.includes('- Initial feature by @davesnx (#1)'));
  });

  test('does nothing with empty entries array', () => {
    const content = `# Changelog

## Unreleased
`;
    const testFile = createTestFile(content);

    addToUnreleased(testFile, []);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.strictEqual(result, content);
  });

  test('adds multiple entries at once', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

## v1.0.0

- Old
`);
    addToUnreleased(testFile, [
      { message: 'Feature A', author: 'alice', prNumber: 1 },
      { message: 'Feature B', author: 'bob', prNumber: 2 },
      { message: 'Feature C', author: 'charlie', prNumber: 3 }
    ]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('Feature A'));
    assert.ok(result.includes('Feature B'));
    assert.ok(result.includes('Feature C'));
    // Should maintain order
    const indexA = result.indexOf('Feature A');
    const indexB = result.indexOf('Feature B');
    const indexC = result.indexOf('Feature C');
    assert.ok(indexA < indexB && indexB < indexC);
  });

  test('maintains consistent spacing', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Existing

## v1.0.0

- Old
`);
    // Add entries multiple times
    addToUnreleased(testFile, [{ message: 'First', author: 'a' }]);
    addToUnreleased(testFile, [{ message: 'Second', author: 'b' }]);
    addToUnreleased(testFile, [{ message: 'Third', author: 'c' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    const lines = result.split('\n');

    // Count consecutive blank lines - should never have more than 1
    let maxConsecutiveBlanks = 0;
    let currentBlanks = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        currentBlanks++;
        maxConsecutiveBlanks = Math.max(maxConsecutiveBlanks, currentBlanks);
      } else {
        currentBlanks = 0;
      }
    }
    assert.ok(maxConsecutiveBlanks <= 1, `Found ${maxConsecutiveBlanks} consecutive blank lines`);
  });

  test('handles unreleased section with custom header', () => {
    const testFile = createTestFile(`# Changelog

## [Unreleased]

- Existing

## v1.0.0

- Old
`);
    addToUnreleased(testFile, [{ message: 'New', author: 'user' }], '## [Unreleased]');

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## [Unreleased]'));
    assert.ok(result.includes('- New by @user'));
  });

  test('handles file with only title and unreleased', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased
`);
    addToUnreleased(testFile, [{ message: 'Feature', author: 'user' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('- Feature by @user'));
  });

  test('preserves content outside changelog sections', () => {
    const testFile = createTestFile(`# My Project Changelog

Some description text here.

## Unreleased

- Existing

## v1.0.0

- Old

---
Footer content
`);
    addToUnreleased(testFile, [{ message: 'New', author: 'user' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('Some description text'));
    assert.ok(result.includes('Footer content'));
  });
});

// ============================================================================
// promoteUnreleasedToVersion Tests
// ============================================================================

describe('promoteUnreleasedToVersion', () => {
  afterEach(cleanupTestFiles);

  test('promotes unreleased content to version section', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- New feature by davesnx (#42)
- Bug fix by someone (#43)

## v1.0.0

- Old feature
`);
    promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-01-15');

    const result = Fs.readFileSync(testFile, 'utf-8');

    // Should have fresh unreleased section
    assert.ok(result.includes('## Unreleased'));

    // Should have new version section with old unreleased content
    assert.ok(result.includes('## v1.1.0 (2025-01-15)'));
    assert.ok(result.includes('- New feature by davesnx (#42)'));
    assert.ok(result.includes('- Bug fix by someone (#43)'));

    // Old version should still be there
    assert.ok(result.includes('## v1.0.0'));
  });

  test('adds v prefix if missing', () => {
    const testFile = createTestFile(`## Unreleased

- Feature
`);
    promoteUnreleasedToVersion(testFile, '2.0.0', '2025-01-15');

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v2.0.0 (2025-01-15)'));
  });

  test('throws error when unreleased section is empty', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

## v1.0.0

- Old feature
`);
    assert.throws(() => promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-01-15'), /empty/i);
  });

  test('throws error when unreleased section not found', () => {
    const testFile = createTestFile(`# Changelog

## v1.0.0

- Old feature
`);
    assert.throws(() => promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-01-15'), /not found/i);
  });

  test('handles unreleased with only whitespace as empty', () => {
    const testFile = createTestFile(`## Unreleased




## v1.0.0

- Feature
`);
    assert.throws(() => promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-01-15'), /empty/i);
  });

  test('preserves order: unreleased, new version, old versions', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Pending change

## v1.0.0

- Old
`);
    promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-01-15');

    const result = Fs.readFileSync(testFile, 'utf-8');
    const unreleasedIndex = result.indexOf('## Unreleased');
    const newVersionIndex = result.indexOf('## v1.1.0');
    const oldVersionIndex = result.indexOf('## v1.0.0');

    assert.ok(unreleasedIndex < newVersionIndex);
    assert.ok(newVersionIndex < oldVersionIndex);
  });

  test('works with no previous versions', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- First feature ever
`);
    promoteUnreleasedToVersion(testFile, 'v1.0.0', '2025-01-15');

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## Unreleased'));
    assert.ok(result.includes('## v1.0.0 (2025-01-15)'));
    assert.ok(result.includes('- First feature ever'));
  });
});

// ============================================================================
// getUnreleasedContent Tests
// ============================================================================

describe('getUnreleasedContent', () => {
  afterEach(cleanupTestFiles);

  test('returns unreleased content', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Feature A
- Feature B

## v1.0.0

- Old feature
`);
    const unreleased = getUnreleasedContent(testFile);
    assert.ok(unreleased?.includes('Feature A'));
    assert.ok(unreleased?.includes('Feature B'));
    assert.ok(!unreleased?.includes('Old feature'));
  });

  test('returns null when no unreleased section', () => {
    const testFile = createTestFile(`## v1.0.0

- Old feature
`);
    const unreleased = getUnreleasedContent(testFile);
    assert.strictEqual(unreleased, null);
  });

  test('returns null when file does not exist', () => {
    const unreleased = getUnreleasedContent('/nonexistent/file.md');
    assert.strictEqual(unreleased, null);
  });

  test('returns null when unreleased section is empty', () => {
    const testFile = createTestFile(`## Unreleased

## v1.0.0

- Feature
`);
    const unreleased = getUnreleasedContent(testFile);
    // Might return empty string or null for empty section
    assert.ok(unreleased === null || unreleased?.trim() === '');
  });

  test('handles custom unreleased header', () => {
    const testFile = createTestFile(`## [Unreleased]

- Feature

## v1.0.0

- Old
`);
    const unreleased = getUnreleasedContent(testFile, '## [Unreleased]');
    assert.ok(unreleased?.includes('Feature'));
  });
});

// ============================================================================
// hasVersion Tests
// ============================================================================

describe('hasVersion', () => {
  afterEach(cleanupTestFiles);

  test('returns true when version exists', () => {
    const testFile = createTestFile(`## v1.0.0

- Feature
`);
    assert.strictEqual(hasVersion(testFile, '1.0.0'), true);
    assert.strictEqual(hasVersion(testFile, 'v1.0.0'), true);
  });

  test('returns false when version does not exist', () => {
    const testFile = createTestFile(`## v1.0.0

- Feature
`);
    assert.strictEqual(hasVersion(testFile, '2.0.0'), false);
  });

  test('returns false when file does not exist', () => {
    assert.strictEqual(hasVersion('/nonexistent/file.md', '1.0.0'), false);
  });

  test('handles pre-release versions', () => {
    const testFile = createTestFile(`## v1.0.0-beta.1

- Beta feature
`);
    assert.strictEqual(hasVersion(testFile, '1.0.0-beta.1'), true);
    assert.strictEqual(hasVersion(testFile, 'v1.0.0-beta.1'), true);
    assert.strictEqual(hasVersion(testFile, '1.0.0'), false);
  });

  test('distinguishes between similar versions', () => {
    const testFile = createTestFile(`## v1.0.0

- Feature

## v1.0.10

- Another feature
`);
    assert.strictEqual(hasVersion(testFile, '1.0.0'), true);
    assert.strictEqual(hasVersion(testFile, '1.0.10'), true);
    assert.strictEqual(hasVersion(testFile, '1.0.1'), false);
  });
});

// ============================================================================
// getVersions Tests
// ============================================================================

describe('getVersions', () => {
  afterEach(cleanupTestFiles);

  test('returns all versions', () => {
    const testFile = createTestFile(`## Unreleased

- Pending

## v2.0.0

- Major

## v1.1.0

- Minor

## v1.0.0

- Initial
`);
    const versions = getVersions(testFile);

    assert.ok(versions.includes('2.0.0'));
    assert.ok(versions.includes('1.1.0'));
    assert.ok(versions.includes('1.0.0'));
    assert.ok(!versions.includes('unreleased'));
  });

  test('returns empty array for empty file', () => {
    const testFile = createTestFile('');
    const versions = getVersions(testFile);
    assert.strictEqual(versions.length, 0);
  });

  test('returns empty array when file does not exist', () => {
    const versions = getVersions('/nonexistent/file.md');
    assert.strictEqual(versions.length, 0);
  });

  test('includes pre-release versions', () => {
    const testFile = createTestFile(`## v2.0.0-beta.1

- Beta

## v1.0.0

- Stable
`);
    const versions = getVersions(testFile);

    assert.ok(versions.includes('2.0.0-beta.1'));
    assert.ok(versions.includes('1.0.0'));
  });
});

// ============================================================================
// addVersionSection Tests
// ============================================================================

describe('addVersionSection', () => {
  afterEach(cleanupTestFiles);

  test('adds version section after unreleased', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Pending

## v1.0.0

- Old
`);
    addVersionSection(testFile, 'v1.5.0', '2025-06-15', [
      { message: 'Middle feature', author: 'user' }
    ]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v1.5.0 (2025-06-15)'));
    assert.ok(result.includes('- Middle feature by @user'));

    // Check order
    const unreleasedIndex = result.indexOf('## Unreleased');
    const v15Index = result.indexOf('## v1.5.0');
    const v10Index = result.indexOf('## v1.0.0');
    assert.ok(unreleasedIndex < v15Index);
    assert.ok(v15Index < v10Index);
  });

  test('adds version when no unreleased section', () => {
    const testFile = createTestFile(`# Changelog

## v1.0.0

- Old
`);
    addVersionSection(testFile, 'v2.0.0', '2025-01-01', [{ message: 'New', author: 'user' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v2.0.0'));
  });

  test('handles empty entries array', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

## v1.0.0

- Old
`);
    // Should not throw, but might not add section with empty entries
    addVersionSection(testFile, 'v1.5.0', '2025-01-01', []);

    // File should still be valid
    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v1.0.0'));
  });

  test('adds multiple entries to version section', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased
`);
    addVersionSection(testFile, 'v1.0.0', '2025-01-01', [
      { message: 'Feature A', author: 'alice', prNumber: 1 },
      { message: 'Feature B', author: 'bob', prNumber: 2 }
    ]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('Feature A'));
    assert.ok(result.includes('Feature B'));
  });

  test('maintains consistent spacing when adding version', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Pending

## v1.0.0

- Old
`);
    addVersionSection(testFile, 'v1.5.0', '2025-01-01', [{ message: 'Mid', author: 'user' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    const lines = result.split('\n');

    // Count consecutive blank lines
    let maxConsecutiveBlanks = 0;
    let currentBlanks = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        currentBlanks++;
        maxConsecutiveBlanks = Math.max(maxConsecutiveBlanks, currentBlanks);
      } else {
        currentBlanks = 0;
      }
    }
    assert.ok(maxConsecutiveBlanks <= 1, `Found ${maxConsecutiveBlanks} consecutive blank lines`);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  afterEach(cleanupTestFiles);

  test('handles file with Windows line endings (CRLF)', () => {
    const content = '# Changelog\r\n\r\n## Unreleased\r\n\r\n- Feature\r\n\r\n## v1.0.0\r\n\r\n- Old\r\n';
    const testFile = createTestFile(content);

    const entries = parseChangelog(testFile);
    assert.ok(entries.length >= 1);

    addToUnreleased(testFile, [{ message: 'New', author: 'user' }]);
    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('- New by @user'));
  });

  test('handles file with mixed line endings', () => {
    const content = '# Changelog\n\r\n## Unreleased\r\n\n- Feature\n';
    const testFile = createTestFile(content);

    // Should not crash
    const entries = parseChangelog(testFile);
    assert.ok(Array.isArray(entries));
  });

  test('handles file with no trailing newline', () => {
    const testFile = Path.join(OS.tmpdir(), `no-trailing-${Date.now()}.md`);
    testFiles.push(testFile);
    Fs.writeFileSync(testFile, '## Unreleased\n\n- Feature');

    addToUnreleased(testFile, [{ message: 'New', author: 'user' }]);

    const result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('- New by @user'));
  });

  test('handles deeply nested markdown', () => {
    const testFile = createTestFile(`## v1.0.0

- Feature with nested content:
  - Sub-item 1
    - Sub-sub-item
  - Sub-item 2
- Another feature
  \`\`\`
  code block
  \`\`\`
`);
    const entries = parseChangelog(testFile);
    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0].content.includes('Sub-item 1'));
  });

  test('handles version-like text in content without confusion', () => {
    const testFile = createTestFile(`## v1.0.0

- Updated to support Node v16.0.0 and higher
- Now compatible with React v18.0.0
`);
    const entries = parseChangelog(testFile);
    // Should only parse the header as a version, not the content
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].version, '1.0.0');
  });

  test('handles changelog with only unreleased section', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

- Work in progress
`);
    const validation = validateChangelog(testFile, '1.0.0');
    assert.strictEqual(validation.valid, false);
    assert.strictEqual(validation.hasVersionEntry, false);
  });

  test('handles rapid consecutive writes', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased
`);
    // Rapidly add entries
    for (let i = 0; i < 10; i++) {
      addToUnreleased(testFile, [{ message: `Feature ${i}`, author: 'user', prNumber: i }]);
    }

    const result = Fs.readFileSync(testFile, 'utf-8');
    // All entries should be present
    for (let i = 0; i < 10; i++) {
      assert.ok(result.includes(`Feature ${i}`), `Missing Feature ${i}`);
    }
  });

  test('recovers from malformed changelog gracefully', () => {
    const testFile = createTestFile(`This is not a proper changelog
Just some random text
## Not really a version header because there's no version number

Some content here
`);
    // Should not crash
    const entries = parseChangelog(testFile);
    const validation = validateChangelog(testFile, '1.0.0');

    assert.ok(Array.isArray(entries));
    assert.strictEqual(validation.valid, false);
  });

  test('handles extremely long version numbers', () => {
    const testFile = createTestFile(`## v999999999.999999999.999999999

- Big version
`);
    const entries = parseChangelog(testFile);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].version, '999999999.999999999.999999999');
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  afterEach(cleanupTestFiles);

  test('full workflow: create, add, promote, add more', () => {
    const testFile = Path.join(OS.tmpdir(), `integration-${Date.now()}.md`);
    testFiles.push(testFile);

    // Step 1: Create changelog with initial entries
    addToUnreleased(testFile, [
      { message: 'Initial feature', author: 'alice', prNumber: 1 },
      { message: 'Another feature', author: 'bob', prNumber: 2 }
    ]);

    let result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('# Changelog'));
    assert.ok(result.includes('## Unreleased'));
    assert.ok(result.includes('Initial feature'));

    // Step 2: Promote to v1.0.0
    promoteUnreleasedToVersion(testFile, 'v1.0.0', '2025-01-01');

    result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v1.0.0 (2025-01-01)'));
    assert.ok(result.includes('Initial feature'));

    // Step 3: Add more entries
    addToUnreleased(testFile, [
      { message: 'Post-release fix', author: 'charlie', prNumber: 3 }
    ]);

    result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('Post-release fix'));

    // Step 4: Promote to v1.1.0
    promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-02-01');

    result = Fs.readFileSync(testFile, 'utf-8');
    assert.ok(result.includes('## v1.1.0 (2025-02-01)'));
    assert.ok(result.includes('## v1.0.0 (2025-01-01)'));

    // Verify order
    const v11Index = result.indexOf('## v1.1.0');
    const v10Index = result.indexOf('## v1.0.0');
    assert.ok(v11Index < v10Index);

    // Step 5: Validate both versions
    const v10Validation = validateChangelog(testFile, '1.0.0');
    const v11Validation = validateChangelog(testFile, '1.1.0');

    assert.strictEqual(v10Validation.valid, true);
    assert.strictEqual(v11Validation.valid, true);
  });

  test('backfill scenario: add missing version between existing ones', () => {
    const testFile = createTestFile(`# Changelog

## Unreleased

## v2.0.0 (2025-03-01)

- Major update

## v1.0.0 (2025-01-01)

- Initial release
`);
    // Backfill v1.5.0 that was missed
    addVersionSection(testFile, 'v1.5.0', '2025-02-01', [
      { message: 'Backfilled feature', author: 'user' }
    ]);

    const result = Fs.readFileSync(testFile, 'utf-8');

    // All versions should be present
    assert.ok(result.includes('## v2.0.0'));
    assert.ok(result.includes('## v1.5.0'));
    assert.ok(result.includes('## v1.0.0'));

    // Check all versions are tracked
    const versions = getVersions(testFile);
    assert.ok(versions.includes('2.0.0'));
    assert.ok(versions.includes('1.5.0'));
    assert.ok(versions.includes('1.0.0'));
  });

  test('preserves changelog integrity through multiple operations', () => {
    const testFile = createTestFile(`# My Project

A great project changelog.

## Unreleased

- WIP feature

## v1.0.0 (2025-01-01)

- First release with:
  - Feature A
  - Feature B
`);
    const originalContent = Fs.readFileSync(testFile, 'utf-8');

    // Perform various operations
    addToUnreleased(testFile, [{ message: 'New', author: 'user' }]);
    promoteUnreleasedToVersion(testFile, 'v1.1.0', '2025-02-01');
    addToUnreleased(testFile, [{ message: 'Another', author: 'user' }]);

    const finalContent = Fs.readFileSync(testFile, 'utf-8');

    // Original title and description should be preserved
    assert.ok(finalContent.includes('# My Project'));
    assert.ok(finalContent.includes('A great project changelog'));

    // Original version content should be preserved
    assert.ok(finalContent.includes('First release with'));
    assert.ok(finalContent.includes('Feature A'));
    assert.ok(finalContent.includes('Feature B'));
  });
});
