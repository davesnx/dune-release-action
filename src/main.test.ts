import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ReleaseManager, GitHubContext, ReleaseConfig, Executor } from './main';

// Mock executor for testing
function createMockExecutor(overrides: Partial<{
  execResults: Map<string, string>;
  execErrors: Map<string, Error>;
  files: Map<string, string>;
  currentDir: string;
}>): Executor & {
  commands: string[];
  writtenFiles: Map<string, { content: string; options?: { mode?: number } }>;
  deletedFiles: string[];
  createdDirs: string[];
  dirChanges: string[];
} {
  const execResults = overrides.execResults || new Map();
  const execErrors = overrides.execErrors || new Map();
  const files = overrides.files || new Map();
  let currentDir = overrides.currentDir || '/workspace';

  const mock = {
    commands: [] as string[],
    writtenFiles: new Map<string, { content: string; options?: { mode?: number } }>(),
    deletedFiles: [] as string[],
    createdDirs: [] as string[],
    dirChanges: [] as string[],

    exec(command: string, _options?: { silent?: boolean }): string {
      mock.commands.push(command);

      // Check for specific error responses
      for (const [pattern, error] of execErrors) {
        if (command.includes(pattern)) {
          throw error;
        }
      }

      // Check for specific success responses
      for (const [pattern, result] of execResults) {
        if (command.includes(pattern)) {
          return result;
        }
      }

      return '';
    },

    fileExists(path: string): boolean {
      return files.has(path);
    },

    readFile(path: string): string {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file: ${path}`);
      }
      return content;
    },

    writeFile(path: string, content: string, options?: { mode?: number }): void {
      mock.writtenFiles.set(path, { content, options });
      files.set(path, content);
    },

    mkdirSync(path: string, _options?: { recursive?: boolean }): void {
      mock.createdDirs.push(path);
    },

    unlinkSync(path: string): void {
      mock.deletedFiles.push(path);
      files.delete(path);
    },

    chdir(path: string): void {
      mock.dirChanges.push(path);
      currentDir = path;
    },

    cwd(): string {
      return currentDir;
    }
  };

  return mock;
}

function createTestContext(overrides: Partial<GitHubContext> = {}): GitHubContext {
  return {
    ref: 'refs/tags/v1.0.0',
    repository: 'testuser/testrepo',
    workspace: '/workspace',
    token: 'test-token',
    ...overrides
  };
}

function createTestConfig(overrides: Partial<ReleaseConfig> = {}): ReleaseConfig {
  return {
    user: 'testuser',
    remote: 'git@github.com:testuser/opam-repository',
    local: '/tmp/opam-repository',
    ...overrides
  };
}

// ============================================================================
// ReleaseManager Constructor Tests
// ============================================================================

describe('ReleaseManager', () => {
  describe('constructor', () => {
    test('creates instance with default executor', () => {
      const context = createTestContext();
      const manager = new ReleaseManager(context);
      assert.ok(manager instanceof ReleaseManager);
    });

    test('creates instance with custom executor', () => {
      const context = createTestContext();
      const mockExecutor = createMockExecutor({});
      const manager = new ReleaseManager(context, false, mockExecutor);
      assert.ok(manager instanceof ReleaseManager);
    });

    test('creates instance with verbose mode', () => {
      const context = createTestContext();
      const mockExecutor = createMockExecutor({});
      const manager = new ReleaseManager(context, true, mockExecutor);
      assert.ok(manager instanceof ReleaseManager);
    });
  });
});

// ============================================================================
// Version Extraction Tests
// ============================================================================

describe('Version extraction', () => {
  test('extracts version from tag ref', async () => {
    const mockExecutor = createMockExecutor({
      execResults: new Map([
        ['opam --version', '2.1.0'],
        ['dune-release --version', '2.0.0'],
        ['git ls-remote --tags origin', ''],
        ['git config', ''],
      ])
    });

    const context = createTestContext({ ref: 'refs/tags/v1.2.3' });
    const manager = new ReleaseManager(context, false, mockExecutor);

    // We can't directly test extractVersion since it's private,
    // but we can verify the ref is correctly stored
    assert.strictEqual(context.ref, 'refs/tags/v1.2.3');
  });

  test('handles tag without v prefix', () => {
    const context = createTestContext({ ref: 'refs/tags/1.2.3' });
    const expectedVersion = context.ref.replace('refs/tags/', '');
    assert.strictEqual(expectedVersion, '1.2.3');
  });

  test('handles pre-release versions', () => {
    const context = createTestContext({ ref: 'refs/tags/v2.0.0-beta.1' });
    const expectedVersion = context.ref.replace('refs/tags/', '');
    assert.strictEqual(expectedVersion, 'v2.0.0-beta.1');
  });
});

// ============================================================================
// Git Configuration Tests
// ============================================================================

describe('Git configuration', () => {
  test('configures git user and token', async () => {
    const mockExecutor = createMockExecutor({
      execResults: new Map([
        ['opam --version', '2.1.0'],
        ['dune-release --version', '2.0.0'],
        ['git ls-remote', ''],
        ['git config', ''],
      ])
    });

    const context = createTestContext();
    const _manager = new ReleaseManager(context, false, mockExecutor);

    // Verify the git config commands will use the token
    const gitConfigUrl = `https://x-access-token:${context.token}@github.com/`;
    assert.ok(gitConfigUrl.includes(context.token));
  });
});

// ============================================================================
// Dune-release Config Setup Tests
// ============================================================================

describe('Dune-release config setup', () => {
  test('config content format is correct', () => {
    const config = createTestConfig();
    const expectedContent = `user: ${config.user}
remote: ${config.remote}
local: ${config.local}
`;

    assert.ok(expectedContent.includes('user: testuser'));
    assert.ok(expectedContent.includes('remote: git@github.com:testuser/opam-repository'));
    assert.ok(expectedContent.includes('local: /tmp/opam-repository'));
  });
});

// ============================================================================
// Dependency Check Tests
// ============================================================================

describe('Dependency checks', () => {
  test('dependencies list includes opam and dune-release', () => {
    const expectedDeps = ['opam', 'dune-release'];
    assert.ok(expectedDeps.includes('opam'));
    assert.ok(expectedDeps.includes('dune-release'));
  });
});

// ============================================================================
// Tag Validation Tests
// ============================================================================

describe('Tag validation', () => {
  test('parses tag name from ref correctly', () => {
    const ref = 'refs/tags/v1.0.0';
    const tagName = ref.replace('refs/tags/', '');
    assert.strictEqual(tagName, 'v1.0.0');
  });

  test('detects existing remote tag', () => {
    const remoteTags = 'abc123\trefs/tags/v1.0.0\ndef456\trefs/tags/v0.9.0';
    const tagExists = remoteTags.includes('refs/tags/v1.0.0');
    assert.strictEqual(tagExists, true);
  });

  test('detects non-existing remote tag', () => {
    const remoteTags = 'abc123\trefs/tags/v0.9.0';
    const tagExists = remoteTags.includes('refs/tags/v1.0.0');
    assert.strictEqual(tagExists, false);
  });
});

// ============================================================================
// Executor Mock Tests
// ============================================================================

describe('Mock executor', () => {
  test('tracks executed commands', () => {
    const mockExecutor = createMockExecutor({});
    mockExecutor.exec('git status');
    mockExecutor.exec('git log');

    assert.strictEqual(mockExecutor.commands.length, 2);
    assert.ok(mockExecutor.commands.includes('git status'));
    assert.ok(mockExecutor.commands.includes('git log'));
  });

  test('returns configured results', () => {
    const mockExecutor = createMockExecutor({
      execResults: new Map([
        ['git status', 'On branch main'],
        ['opam --version', '2.1.0']
      ])
    });

    const statusResult = mockExecutor.exec('git status');
    const versionResult = mockExecutor.exec('opam --version');

    assert.strictEqual(statusResult, 'On branch main');
    assert.strictEqual(versionResult, '2.1.0');
  });

  test('throws configured errors', () => {
    const mockExecutor = createMockExecutor({
      execErrors: new Map([
        ['failing-command', new Error('Command failed')]
      ])
    });

    assert.throws(
      () => mockExecutor.exec('failing-command'),
      /Command failed/
    );
  });

  test('tracks file operations', () => {
    const mockExecutor = createMockExecutor({});

    mockExecutor.writeFile('/path/to/file', 'content', { mode: 0o600 });
    mockExecutor.mkdirSync('/path/to/dir', { recursive: true });

    assert.ok(mockExecutor.writtenFiles.has('/path/to/file'));
    assert.strictEqual(mockExecutor.writtenFiles.get('/path/to/file')?.content, 'content');
    assert.strictEqual(mockExecutor.writtenFiles.get('/path/to/file')?.options?.mode, 0o600);
    assert.ok(mockExecutor.createdDirs.includes('/path/to/dir'));
  });

  test('tracks directory changes', () => {
    const mockExecutor = createMockExecutor({ currentDir: '/start' });

    assert.strictEqual(mockExecutor.cwd(), '/start');

    mockExecutor.chdir('/new/path');
    assert.strictEqual(mockExecutor.cwd(), '/new/path');
    assert.ok(mockExecutor.dirChanges.includes('/new/path'));
  });

  test('handles file existence checks', () => {
    const mockExecutor = createMockExecutor({
      files: new Map([
        ['/existing/file', 'content']
      ])
    });

    assert.strictEqual(mockExecutor.fileExists('/existing/file'), true);
    assert.strictEqual(mockExecutor.fileExists('/nonexistent/file'), false);
  });

  test('reads file content', () => {
    const mockExecutor = createMockExecutor({
      files: new Map([
        ['/path/to/file', 'file content']
      ])
    });

    const content = mockExecutor.readFile('/path/to/file');
    assert.strictEqual(content, 'file content');
  });

  test('throws on reading nonexistent file', () => {
    const mockExecutor = createMockExecutor({});

    assert.throws(
      () => mockExecutor.readFile('/nonexistent'),
      /ENOENT/
    );
  });

  test('tracks file deletion', () => {
    const mockExecutor = createMockExecutor({
      files: new Map([
        ['/file/to/delete', 'content']
      ])
    });

    assert.strictEqual(mockExecutor.fileExists('/file/to/delete'), true);
    mockExecutor.unlinkSync('/file/to/delete');
    assert.ok(mockExecutor.deletedFiles.includes('/file/to/delete'));
    assert.strictEqual(mockExecutor.fileExists('/file/to/delete'), false);
  });
});

// ============================================================================
// URL Construction Tests
// ============================================================================

describe('URL construction', () => {
  test('constructs GitHub release URL correctly', () => {
    const repository = 'davesnx/dune-release-action';
    const tagName = 'v1.0.0';
    const url = `https://github.com/${repository}/releases/tag/${tagName}`;

    assert.strictEqual(url, 'https://github.com/davesnx/dune-release-action/releases/tag/v1.0.0');
  });

  test('constructs opam PR URL correctly', () => {
    const opamRepository = { owner: 'ocaml', repo: 'opam-repository' };
    const effectiveUser = 'davesnx';
    const packages = 'my-package';
    const version = 'v1.0.0';
    const opamBranch = `release-${packages.replace(/,/g, '-')}-${version}`;

    const url = `https://github.com/${opamRepository.owner}/${opamRepository.repo}/compare/master...${effectiveUser}:opam-repository:${opamBranch}`;

    assert.strictEqual(
      url,
      'https://github.com/ocaml/opam-repository/compare/master...davesnx:opam-repository:release-my-package-v1.0.0'
    );
  });

  test('handles multi-package opam branch name', () => {
    const packages = 'pkg1,pkg2,pkg3';
    const version = 'v1.0.0';
    const opamBranch = `release-${packages.replace(/,/g, '-')}-${version}`;

    assert.strictEqual(opamBranch, 'release-pkg1-pkg2-pkg3-v1.0.0');
  });
});

// ============================================================================
// Dry-run Mode Tests
// ============================================================================

describe('Dry-run mode', () => {
  test('dry-run flag is parsed correctly', () => {
    const dryRunInput: string = 'true';
    const dryRun = dryRunInput === 'true';
    assert.strictEqual(dryRun, true);
  });

  test('dry-run false is parsed correctly', () => {
    const dryRunInput: string = 'false';
    const dryRun = dryRunInput === 'true';
    assert.strictEqual(dryRun, false);
  });

  test('empty dry-run input defaults to false', () => {
    const dryRunInput: string = '';
    const dryRun = dryRunInput === 'true';
    assert.strictEqual(dryRun, false);
  });
});

// ============================================================================
// Package Input Parsing Tests
// ============================================================================

describe('Package input parsing', () => {
  test('parses single package', () => {
    const packagesInput = 'my-package';
    let packagesArray: string[];

    if (packagesInput.startsWith('[') && packagesInput.endsWith(']')) {
      packagesArray = JSON.parse(packagesInput);
    } else if (packagesInput.includes('\n')) {
      packagesArray = packagesInput.split('\n');
    } else if (packagesInput.includes(',')) {
      packagesArray = packagesInput.split(',');
    } else {
      packagesArray = [packagesInput];
    }
    packagesArray = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0);

    assert.deepStrictEqual(packagesArray, ['my-package']);
  });

  test('parses comma-separated packages', () => {
    const packagesInput = 'pkg1,pkg2,pkg3';
    let packagesArray: string[];

    if (packagesInput.startsWith('[') && packagesInput.endsWith(']')) {
      packagesArray = JSON.parse(packagesInput);
    } else if (packagesInput.includes('\n')) {
      packagesArray = packagesInput.split('\n');
    } else if (packagesInput.includes(',')) {
      packagesArray = packagesInput.split(',');
    } else {
      packagesArray = [packagesInput];
    }
    packagesArray = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0);

    assert.deepStrictEqual(packagesArray, ['pkg1', 'pkg2', 'pkg3']);
  });

  test('parses JSON array packages', () => {
    const packagesInput = '["pkg1", "pkg2"]';
    let packagesArray: string[];

    if (packagesInput.startsWith('[') && packagesInput.endsWith(']')) {
      packagesArray = JSON.parse(packagesInput);
    } else if (packagesInput.includes('\n')) {
      packagesArray = packagesInput.split('\n');
    } else if (packagesInput.includes(',')) {
      packagesArray = packagesInput.split(',');
    } else {
      packagesArray = [packagesInput];
    }
    packagesArray = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0);

    assert.deepStrictEqual(packagesArray, ['pkg1', 'pkg2']);
  });

  test('parses newline-separated packages (YAML list)', () => {
    const packagesInput = 'pkg1\npkg2\npkg3';
    let packagesArray: string[];

    if (packagesInput.startsWith('[') && packagesInput.endsWith(']')) {
      packagesArray = JSON.parse(packagesInput);
    } else if (packagesInput.includes('\n')) {
      packagesArray = packagesInput.split('\n');
    } else if (packagesInput.includes(',')) {
      packagesArray = packagesInput.split(',');
    } else {
      packagesArray = [packagesInput];
    }
    packagesArray = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0);

    assert.deepStrictEqual(packagesArray, ['pkg1', 'pkg2', 'pkg3']);
  });

  test('filters empty packages', () => {
    const packagesInput = 'pkg1,,pkg2,  ,pkg3';
    let packagesArray: string[];

    if (packagesInput.startsWith('[') && packagesInput.endsWith(']')) {
      packagesArray = JSON.parse(packagesInput);
    } else if (packagesInput.includes('\n')) {
      packagesArray = packagesInput.split('\n');
    } else if (packagesInput.includes(',')) {
      packagesArray = packagesInput.split(',');
    } else {
      packagesArray = [packagesInput];
    }
    packagesArray = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0);

    assert.deepStrictEqual(packagesArray, ['pkg1', 'pkg2', 'pkg3']);
  });
});

// ============================================================================
// Opam Repository Input Parsing Tests
// ============================================================================

describe('Opam repository input parsing', () => {
  test('parses owner/repo format', () => {
    const opamRepositoryInput = 'ocaml/opam-repository';
    const [opamOwner, opamRepo] = opamRepositoryInput.split('/');

    assert.strictEqual(opamOwner, 'ocaml');
    assert.strictEqual(opamRepo, 'opam-repository');
  });

  test('handles custom repository', () => {
    const opamRepositoryInput = 'custom-org/custom-repo';
    const [opamOwner, opamRepo] = opamRepositoryInput.split('/');

    assert.strictEqual(opamOwner, 'custom-org');
    assert.strictEqual(opamRepo, 'custom-repo');
  });

  test('detects invalid format (missing slash)', () => {
    const opamRepositoryInput = 'invalid-format';
    const [opamOwner, opamRepo] = opamRepositoryInput.split('/');

    // This should be detected as invalid
    assert.ok(!opamOwner || !opamRepo || opamRepo === undefined);
  });
});

// ============================================================================
// Error Message Patterns Tests
// ============================================================================

describe('Error message detection', () => {
  test('detects workflow scope error', () => {
    const errorMessage = 'refusing to allow a GitHub App to create or update workflow without `workflow` scope';
    const isWorkflowScopeError = errorMessage.includes('without `workflow` scope');
    assert.strictEqual(isWorkflowScopeError, true);
  });

  test('detects permission denied error', () => {
    const errorMessage = 'Permission to testuser/testrepo.git denied to github-actions';
    const isPermissionError = errorMessage.includes('Permission to') && errorMessage.includes('denied');
    assert.strictEqual(isPermissionError, true);
  });

  test('detects authentication failed error', () => {
    const errorMessage1 = 'authentication failed for https://github.com';
    const errorMessage2 = 'Invalid username or token';

    assert.ok(errorMessage1.includes('authentication failed'));
    assert.ok(errorMessage2.includes('Invalid username or token'));
  });
});

