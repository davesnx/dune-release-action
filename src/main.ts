#!/usr/bin/env node

import * as core from '@actions/core';
import * as github from '@actions/github';
import { execSync } from 'child_process';
import Fs from 'fs';
import Path from 'path';
import OS from 'os';
import { validateChangelog, extractVersionChangelog } from '../lib/changelog';

interface ReleaseConfig {
  user: string;
  remote: string;
  local: string;
}

interface OpamRepository {
  owner: string;
  repo: string;
}

interface GitHubContext {
  ref: string;
  repository: string;
  workspace: string;
  token: string;
}

interface Executor {
  exec(command: string, options?: { silent?: boolean; stdio?: 'pipe' | 'inherit' }): string;
  fileExists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string, options?: { mode?: number }): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  unlinkSync(path: string): void;
  chdir(path: string): void;
  cwd(): string;
}

const defaultExecutor: Executor = {
  exec(command: string, options: { silent?: boolean; stdio?: 'pipe' | 'inherit' } = {}): string {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: options.silent || options.stdio === 'pipe' ? 'pipe' : ['ignore', 'inherit', 'inherit']
    });
    if (result === null || result === undefined) {
      return '';
    }
    return result.toString().trim();
  },
  fileExists(path: string): boolean {
    return Fs.existsSync(path);
  },
  readFile(path: string): string {
    return Fs.readFileSync(path, 'utf-8');
  },
  writeFile(path: string, content: string, options?: { mode?: number }): void {
    Fs.writeFileSync(path, content, options);
  },
  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    Fs.mkdirSync(path, options);
  },
  unlinkSync(path: string): void {
    Fs.unlinkSync(path);
  },
  chdir(path: string): void {
    process.chdir(path);
  },
  cwd(): string {
    return process.cwd();
  }
};

class ReleaseManager {
  private context: GitHubContext;
  private verbose: boolean;
  private executor: Executor;

  constructor(context: GitHubContext, verbose: boolean = false, executor: Executor = defaultExecutor) {
    this.context = context;
    this.verbose = verbose;
    this.executor = executor;
  }

  /**
   * Conditional info logging - only logs if verbose mode is enabled
   */
  private info(message: string): void {
    if (this.verbose) {
      core.info(message);
    }
  }

  /**
   * Execute a command and return its output
   */
  private exec(command: string, options: { silent?: boolean } = {}): string {
    if (!options.silent) {
      this.info(`> ${command}`);
    }

    try {
      return this.executor.exec(command, { silent: options.silent });
    } catch (error: any) {
      const message = `Command failed: ${command}\n${error.message}`;
      core.error(message);
      throw new Error(message);
    }
  }

  /**
   * Validate that the tag is new and doesn't exist on remote
   */
  private validateNewTag(): void {
    core.startGroup('Validating tag');

    try {
      const tagName = this.context.ref.replace('refs/tags/', '');
      this.info(`Checking if tag ${tagName} already exists on remote...`);

      const remoteTags = this.exec('git ls-remote --tags origin', { silent: true });
      const tagExists = remoteTags.includes(`refs/tags/${tagName}`);

      if (tagExists) {
        core.warning(`Tag ${tagName} already exists on remote repository`);
      } else {
        this.info(`Tag ${tagName} is new, proceeding with release`);
      }
    } catch (error: any) {
      core.warning(`Could not validate tag existence: ${error.message}`);
      this.info('Proceeding anyway (validation check failed)');
    }

    core.endGroup();
  }

  /**
   * Check if required tools are installed
   */
  private checkDependencies(): void {
    core.startGroup('Checking dependencies');

    const dependencies = [
      { name: 'opam', command: 'opam --version' },
      { name: 'dune-release', command: 'opam exec -- dune-release --version' }
    ];

    const missing: string[] = [];

    for (const dep of dependencies) {
      try {
        const version = this.exec(dep.command, { silent: true });
        this.info(`✓ ${dep.name} is installed: ${version}`);
      } catch (error: any) {
        core.error(`✗ ${dep.name} is not installed or not accessible`);
        missing.push(dep.name);
      }
    }

    core.endGroup();

    if (missing.length > 0) {
      const errorMessage = `Missing required dependencies: ${missing.join(', ')}`;
      core.error(errorMessage);
      core.error('');
      core.error('To fix this:');

      if (missing.includes('opam')) {
        core.error('Install opam: https://opam.ocaml.org/doc/Install.html');
      }

      if (missing.includes('dune-release')) {
        core.error('Install dune-release: opam install dune-release');
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * Extract version from git tag
   */
  private extractVersion(): string {
    try {
      const tag = this.context.ref.replace('refs/tags/', '');
      if (!tag || tag === this.context.ref) {
        throw new Error('No valid git tag found in ref');
      }
      core.setOutput('version', tag);
      this.info(`Extracted version: ${tag}`);
      return tag;
    } catch (error: any) {
      core.error(`Failed to extract version from ref ${this.context.ref}: ${error.message}`);
      throw new Error(`Could not extract version: ${error.message}`);
    }
  }

  /**
   * Configure Git for release operations
   */
  private configureGit(): void {
    core.startGroup('Configuring Git for release');

    try {
      this.exec('git config --global user.name "GitHub Actions"');
      this.exec('git config --global user.email "actions@github.com"');

      // Configure git to use token for both HTTPS and SSH URLs
      const gitConfig = `https://x-access-token:${this.context.token}@github.com/`;
      this.exec(`git config --global url."${gitConfig}".insteadOf "https://github.com/"`);
      this.exec(`git config --global url."${gitConfig}".insteadOf "git@github.com:"`);

      this.info('Git configuration completed');
    } catch (error: any) {
      core.error(`Failed to configure git: ${error.message}`);
      throw new Error(`Could not configure git: ${error.message}`);
    }

    core.endGroup();
  }

  /**
   * Setup dune-release configuration
   */
  private setupDuneReleaseConfig(config: ReleaseConfig): void {
    core.startGroup('Setting up dune-release configuration');

    try {
      const configDir = Path.join(OS.homedir(), '.config', 'dune');
      this.executor.mkdirSync(configDir, { recursive: true });

      const configContent = `user: ${config.user}
remote: ${config.remote}
local: ${config.local}
`;

      this.executor.writeFile(Path.join(configDir, 'release.yml'), configContent);

      // Create GitHub token file with secure permissions
      const tokenPath = Path.join(configDir, 'github.token');
      this.executor.writeFile(tokenPath, this.context.token, { mode: 0o600 });
      this.info(`GitHub token file created at ${tokenPath}`);

      this.info('dune-release configuration created');
    } catch (error: any) {
      core.error(`Failed to setup dune-release configuration: ${error.message}`);
      throw new Error(`Could not setup dune-release configuration: ${error.message}`);
    }

    core.endGroup();
  }

  /**
   * Check if a GitHub repository exists and is accessible
   */
  private async checkRepositoryExists(owner: string, repo: string): Promise<boolean> {
    try {
      const octokit = github.getOctokit(this.context.token);
      await octokit.rest.repos.get({
        owner,
        repo
      });
      return true;
    } catch (error: any) {
      if (error.status === 404) {
        return false;
      }
      // For other errors (like auth issues), we'll let them surface later
      core.warning(`Could not check repository ${owner}/${repo}: ${error.message}`);
      return false;
    }
  }

  /**
   * Clone opam-repository fork and sync with upstream
   */
  private async cloneOpamRepository(forkUrl: string, localPath: string, forkOwner: string, opamRepository: OpamRepository): Promise<void> {
    core.startGroup('Cloning opam-repository fork');

    // Check if the fork exists
    const forkExists = await this.checkRepositoryExists(forkOwner, 'opam-repository');
    if (!forkExists) {
      core.error(`Fork ${forkOwner}/opam-repository does not exist or is not accessible.`);
      core.error('');
      core.error('To fix this:');
      core.error(`1. Create a fork of ${opamRepository.owner}/${opamRepository.repo} at: https://github.com/${opamRepository.owner}/${opamRepository.repo}/fork`);
      core.error(`2. Make sure your GH_TOKEN has access to the fork`);
      core.error('3. Verify your token has the "repo" scope enabled');
      throw new Error(`Repository ${forkOwner}/opam-repository not found or not accessible`);
    }

    this.info(`Fork ${forkOwner}/opam-repository exists and is accessible`);

    // Create directory structure
    const gitDir = Path.dirname(localPath);
    try {
      this.executor.mkdirSync(gitDir, { recursive: true });
      this.info(`Created directory: ${gitDir}`);
    } catch (error: any) {
      core.warning(`Could not create directory ${gitDir}: ${error.message}`);
      // Try to proceed anyway, git clone might handle it
    }

    // Clone fork - dune-release handles fetching from upstream itself
    try {
      this.exec(`git clone ${forkUrl} ${localPath}`);
      this.info(`Cloned ${forkUrl} to ${localPath}`);
    } catch (error: any) {
      core.error(`Failed to clone ${forkUrl}`);
      core.error('');
      core.error('Possible causes:');
      core.error('1. Your GH_TOKEN might not have the "repo" scope');
      core.error('2. The token might not have access to the fork');
      core.error('3. The fork might be private (it should be public)');
      throw error;
    }

    core.endGroup();
  }

  /**
   * Run dune-release commands
   */
  private runDuneRelease(command: string, args: string[] = []): void {
    const fullCommand = `opam exec -- dune-release ${command} ${args.join(' ')}`;
    this.exec(fullCommand);
  }

  private deleteTag(): never {
    const tagName = this.context.ref.replace('refs/tags/', '');
    this.info(`Attempting to delete tag ${tagName}`);

    // Configure git with token for both HTTPS and SSH URLs
    const gitConfig = `https://x-access-token:${this.context.token}@github.com/`;
    this.exec(`git config --global url."${gitConfig}".insteadOf "https://github.com/"`, { silent: true });
    this.exec(`git config --global url."${gitConfig}".insteadOf "git@github.com:"`, { silent: true });

    // Check if remote tag exists before deleting
    try {
      const remoteTags = this.exec('git ls-remote --tags origin', { silent: true });
      const remoteTagExists = remoteTags.includes(`refs/tags/${tagName}`);

      if (remoteTagExists) {
        this.exec(`git push origin --delete ${tagName}`);
        this.info(`Remote tag ${tagName} deleted`);
      } else {
        this.info(`Remote tag ${tagName} does not exist, skipping deletion`);
      }
    } catch (error: any) {
      core.warning(`Could not delete remote tag ${tagName}: ${error.message}`);
    }

    // Check if local tag exists before deleting
    try {
      const localTags = this.exec('git tag -l', { silent: true });
      const localTagExists = localTags.split('\n').includes(tagName);

      if (localTagExists) {
        this.exec(`git tag -d ${tagName}`, { silent: true });
        this.info(`Local tag ${tagName} deleted`);
      } else {
        this.info(`Local tag ${tagName} does not exist, skipping deletion`);
      }
    } catch (error: any) {
      core.warning(`Could not delete local tag ${tagName}: ${error.message}`);
    }

    throw new Error(`Release failed - tag ${tagName} has been deleted. Please fix the issues and create a new tag.`);
  }

  /**
   * Run the full release pipeline
   */
  async runRelease(
    packages: string,
    changelogPath: string,
    duneConfig: ReleaseConfig,
    toGithubReleases: boolean,
    toOpamRepository: boolean,
    includeSubmodules: boolean = false,
    opamRepository: OpamRepository = { owner: 'ocaml', repo: 'opam-repository' },
    buildDir?: string,
    publishMessage?: string,
    dryRun: boolean = false
  ): Promise<void> {
    let versionChangelogPath: string | null = null;

    try {
      // Check dependencies first
      this.checkDependencies();

      // Validate the tag is new
      this.validateNewTag();

      // Setup
      this.configureGit();
      const version = this.extractVersion();

      if (dryRun) {
        core.notice('DRY RUN MODE - No releases will be published, no PRs submitted');
      } else if (!toGithubReleases && !toOpamRepository) {
        core.warning('Both GitHub releases and opam submission are disabled - running validation only');
      } else {
        if (!toGithubReleases) {
          core.warning('GitHub releases disabled - will not publish to GitHub');
        }
        if (!toOpamRepository) {
          core.warning('opam submission disabled - will not submit to opam-repository');
        }
      }

      this.info(`Starting release for version ${version}`);

      // Validate and extract changelog
      core.startGroup('Validating changelog');
      const validation = validateChangelog(changelogPath, version);

      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => core.warning(warning));
      }

      if (!validation.valid) {
        validation.errors.forEach(error => core.error(error));
        throw new Error('Changelog validation failed. Please fix the issues and try again.');
      }

      const changelogFilename = Path.basename(changelogPath, Path.extname(changelogPath));
      const absoluteChangelogPath = Path.resolve(changelogPath);
      versionChangelogPath = Path.join(
        Path.dirname(absoluteChangelogPath),
        `${changelogFilename}-${version}${Path.extname(changelogPath)}`
      );

      extractVersionChangelog(absoluteChangelogPath, version, versionChangelogPath);

      try {
        const extractedContent = this.executor.readFile(versionChangelogPath);
        core.info(`Created version-specific changelog at: ${versionChangelogPath}`);
        core.info(`Changelog content (${extractedContent.length} chars):`);
        this.info(extractedContent.substring(0, 200) + (extractedContent.length > 200 ? '...' : ''));
      } catch (error: any) {
        core.warning(`Could not read version-specific changelog: ${error.message}`);
      }

      // Update changelogPath to use the version-specific file (absolute path)
      changelogPath = versionChangelogPath;

      core.endGroup();

      // Lint opam files
      core.startGroup('Linting opam files');
      this.runDuneRelease('lint', ['-p', packages]);
      core.endGroup();

      // Setup dune-release config
      this.setupDuneReleaseConfig(duneConfig);

      // Clone opam repository (even in dry-run to validate the setup)
      await this.cloneOpamRepository(duneConfig.remote, duneConfig.local, duneConfig.user, opamRepository);

      // Distribute release archive
      core.startGroup('Distributing release archive');
      const distribArgs = ['-p', packages, '--skip-tests', '--skip-lint'];
      if (includeSubmodules) {
        distribArgs.push('--include-submodules');
      }
      if (buildDir) {
        distribArgs.push(`--build-dir=${buildDir}`);
      }
      this.runDuneRelease('distrib', distribArgs);
      core.endGroup();

      // Publish to GitHub (conditional)
      const tagName = this.context.ref.replace('refs/tags/', '');
      const githubReleaseUrl = `https://github.com/${this.context.repository}/releases/tag/${tagName}`;

      if (dryRun) {
        core.startGroup('Publishing to GitHub (dry-run)');
        core.info('DRY RUN: Would publish to GitHub');
        core.info(`DRY RUN: Release URL would be: ${githubReleaseUrl}`);
        core.endGroup();
      } else if (toGithubReleases) {
        core.startGroup('Publishing to GitHub');
        process.env.DUNE_RELEASE_DELEGATE = 'github-dune-release';
        process.env.GITHUB_TOKEN = this.context.token;
        this.info(`Publishing with changelog: ${changelogPath}`);
        const publishArgs = ['--yes', `--change-log=${changelogPath}`];
        if (buildDir) {
          publishArgs.push(`--build-dir=${buildDir}`);
        }
        if (publishMessage) {
          publishArgs.push(`--msg=${publishMessage}`);
        }
        this.runDuneRelease('publish', publishArgs);
        core.setOutput('github-release-url', githubReleaseUrl);
        core.endGroup();
      } else {
        core.startGroup('Publishing to GitHub (skipped)');
        core.warning('Skipping GitHub release publication');
        core.endGroup();
      }

      core.startGroup(`Packaging opam release for ${packages}`);
      const opamPkgArgs = ['pkg', '-p', packages, '--yes', `--change-log=${changelogPath}`];
      if (buildDir) {
        opamPkgArgs.push(`--build-dir=${buildDir}`);
      }
      this.runDuneRelease('opam', opamPkgArgs);
      core.endGroup();

      const opamBranch = `release-${packages.replace(/,/g, '-')}-${version}`;
      const effectiveUser = duneConfig.user;
      const opamPrUrl = `https://github.com/${opamRepository.owner}/${opamRepository.repo}/compare/master...${effectiveUser}:opam-repository:${opamBranch}`;

      if (dryRun) {
        core.startGroup('Submitting to opam repository (dry-run)');
        core.info('DRY RUN: Would submit to opam repository');
        core.info(`DRY RUN: PR URL would be: ${opamPrUrl}`);
        core.endGroup();
      } else if (toOpamRepository) {
        core.startGroup('Submitting to opam repository');
        process.env.DUNE_RELEASE_DELEGATE = 'github-dune-release';
        process.env.GITHUB_TOKEN = this.context.token;
        this.executor.chdir(this.context.workspace);
        const opamSubmitArgs = ['submit', '-p', packages, '--yes', `--change-log=${changelogPath}`];
        if (buildDir) {
          opamSubmitArgs.push(`--build-dir=${buildDir}`);
        }
        opamSubmitArgs.push(`--opam-repo=${opamRepository.owner}/${opamRepository.repo}`);
        this.runDuneRelease('opam', opamSubmitArgs);
        core.setOutput('opam-pr-url', opamPrUrl);
        core.endGroup();
      } else {
        core.startGroup('Submitting to opam repository (skipped)');
        core.warning('Skipping submission to opam-repository');
        core.endGroup();
      }

      if (dryRun) {
        core.notice(`DRY RUN completed for ${tagName} - validation passed!`);
        core.notice(`GitHub release URL (if published): ${githubReleaseUrl}`);
        core.notice(`Opam PR URL (if submitted): ${opamPrUrl}`);
      } else {
        core.notice(`Release ${tagName} completed successfully!`);

        if (toGithubReleases) {
          core.notice(`GitHub release: ${githubReleaseUrl}`);
        }

        if (toOpamRepository) {
          core.notice(`Opam PR: ${opamPrUrl}`);

          // Create a commit with the release information
          try {
            core.startGroup('Creating release tracking commit');

            let commitMessage = `release ${version}\n\n`;
            if (toOpamRepository) {
              commitMessage += `opam pr: ${opamPrUrl}\n`;
            }
            if (toGithubReleases) {
              commitMessage += `github release: ${githubReleaseUrl}\n`;
            }

            // Check if we're on a branch (not detached HEAD)
            const currentBranch = this.exec('git rev-parse --abbrev-ref HEAD', { silent: true });

            if (currentBranch === 'HEAD') {
              this.info('Running on detached HEAD (tag), skipping commit creation');
            } else {
              // Allow empty commit in case there are no changes
              this.exec(`git commit --allow-empty -m "${commitMessage.trim()}"`);
              this.info('Created commit with release information');

              // Push the commit to the repository
              this.exec(`git push origin ${currentBranch}`);
              this.info(`Pushed release tracking commit to ${currentBranch}`);
            }

            core.endGroup();
          } catch (error: any) {
            core.warning(`Could not create or push release tracking commit: ${error.message}`);
            // Non-fatal, continue
          }
        }
      }

    } catch (error: any) {
      const errorMessage = error.message || error.toString();

      // Check for specific error patterns and provide helpful messages
      if (errorMessage.includes('without `workflow` scope')) {
        core.error('GitHub token is missing the "workflow" scope');
      } else if (errorMessage.includes('Permission to') && errorMessage.includes('denied')) {
        core.error('GitHub token does not have permission to push to the repository');
        core.error('Make sure your token has the "repo" scope and you have push access');
      } else if (errorMessage.includes('authentication failed') || errorMessage.includes('Invalid username or token')) {
        core.error('GitHub token authentication failed');
        core.error('Please check that your GH_TOKEN secret is valid and not expired');
      }

      core.error(`Release failed: ${errorMessage}`);

      if (dryRun) {
        core.warning('DRY RUN: Skipping tag deletion on failure');
      } else if (toGithubReleases || toOpamRepository) {
        this.deleteTag();
      } else {
        core.warning('Validation mode: Skipping tag deletion on failure');
      }
      throw error;
    } finally {
      if (versionChangelogPath && this.executor.fileExists(versionChangelogPath)) {
        try {
          this.executor.unlinkSync(versionChangelogPath);
          this.info(`Cleaned up temporary changelog: ${versionChangelogPath}`);
        } catch (error: any) {
          core.warning(`Could not clean up temporary changelog: ${error.message}`);
        }
      }
    }
  }
}

async function main() {
  try {
    const packagesInput = core.getInput('packages', { required: true }).trim();
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

    const packages = packagesArray.join(',');

    const changelogPath = core.getInput('changelog') || './CHANGES.md';
    const token = core.getInput('github-token', { required: true });
    const toOpamRepository = core.getInput('to-opam-repository') !== 'false';
    const toGithubReleases = core.getInput('to-github-releases') !== 'false';
    const verbose = core.getInput('verbose') === 'true';
    const includeSubmodules = core.getInput('include-submodules') === 'true';
    const opamRepositoryInput = core.getInput('opam-repository') || 'ocaml/opam-repository';
    const buildDir = core.getInput('build-dir') || undefined;
    const publishMessage = core.getInput('publish-message') || undefined;
    const dryRun = core.getInput('dry-run') === 'true';

    const [opamOwner, opamRepo] = opamRepositoryInput.split('/');
    if (!opamOwner || !opamRepo) {
      throw new Error(`Invalid opam-repository format: ${opamRepositoryInput}. Expected: owner/repo`);
    }
    const opamRepository: OpamRepository = { owner: opamOwner, repo: opamRepo };

    const testRefOverride = process.env.TEST_OVERRIDE_GITHUB_REF || '';
    const ref = testRefOverride || process.env.GITHUB_REF || github.context.ref;
    if (!ref.startsWith('refs/tags/')) {
      throw new Error(`This action must be run on a git tag. Current ref: ${ref}`);
    }

    if (testRefOverride && verbose) {
      core.warning(`Using TEST_OVERRIDE_GITHUB_REF: ${testRefOverride}`);
    }

    const effectiveUser = process.env.GITHUB_ACTOR || 'github-actions';
    const opamRepoFork = `${effectiveUser}/opam-repository`;
    const defaultOpamPath = process.env.RUNNER_TEMP ? '/home/runner/git/opam-repository' : '/tmp/opam-repository-test';
    const opamRepoLocal = core.getInput('opam-repo-local') || defaultOpamPath;

    const context: GitHubContext = {
      ref,
      repository: process.env.GITHUB_REPOSITORY || `${github.context.repo.owner}/${github.context.repo.repo}`,
      workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
      token
    };

    const duneConfig: ReleaseConfig = {
      user: effectiveUser,
      remote: `git@github.com:${opamRepoFork}`,
      local: opamRepoLocal
    };

    if (verbose) {
      core.info('=== OCaml Dune Release Action ===');
      core.info(`Packages: ${packages}`);
      core.info(`Changelog: ${changelogPath}`);
      core.info(`User: ${effectiveUser}`);
      core.info(`Opam fork: ${opamRepoFork}`);
      core.info(`Opam repository: ${opamRepository.owner}/${opamRepository.repo}`);
      core.info(`Publish to GitHub: ${toGithubReleases}`);
      core.info(`Submit to opam: ${toOpamRepository}`);
      core.info(`Include submodules: ${includeSubmodules}`);
      core.info(`Dry run: ${dryRun}`);
      if (buildDir) core.info(`Build directory: ${buildDir}`);
      if (publishMessage) core.info(`Publish message: ${publishMessage}`);
      core.info('================================');
    }
    const releaseManager = new ReleaseManager(context, verbose);
    await releaseManager.runRelease(packages, changelogPath, duneConfig, toGithubReleases, toOpamRepository, includeSubmodules, opamRepository, buildDir, publishMessage, dryRun);

    core.setOutput('release-status', 'success');
  } catch (error: any) {
    core.setFailed(error.message);
    core.setOutput('release-status', 'failed');
    process.exit(1);
  }
}

const isTest = process.env.NODE_TEST_CONTEXT !== undefined || process.argv.some(arg => arg.includes('--test'));
if (!isTest) {
  main();
}

export { ReleaseManager, ReleaseConfig, GitHubContext, Executor, defaultExecutor, OpamRepository };
export default main;

