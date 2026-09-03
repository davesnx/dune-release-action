import * as core from '@actions/core';
import { execSync } from 'child_process';
import Fs from 'fs';
import Path from 'path';
import OS from 'os';
import { validateChangelog, extractVersionChangelog } from '../lib/changelog';

export interface ReleaseConfig {
  user: string;
  remote: string;
  local: string;
}

export interface OpamRepository {
  owner: string;
  repo: string;
}

export interface GitHubContext {
  ref: string;
  repository: string;
  workspace: string;
  token: string;
}

export interface Executor {
  exec(command: string, options?: { silent?: boolean; stdio?: 'pipe' | 'inherit' }): string;
  fileExists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string, options?: { mode?: number }): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  unlinkSync(path: string): void;
  chdir(path: string): void;
  cwd(): string;
}

export const defaultExecutor: Executor = {
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

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function composeOpamPrMessage(preamble: string, changelog: string | null): string {
  const changes = changelog?.trim();
  return changes ? `${preamble.trim()}\n\n${changes}` : preamble.trim();
}

export function parsePackagesInput(packagesInput: string): string {
  const normalizedInput = packagesInput.trim();
  let packagesArray: string[];

  if (normalizedInput.startsWith('[') && normalizedInput.endsWith(']')) {
    packagesArray = JSON.parse(normalizedInput);
  } else if (normalizedInput.includes('\n')) {
    packagesArray = normalizedInput.split('\n');
  } else if (normalizedInput.includes(',')) {
    packagesArray = normalizedInput.split(',');
  } else {
    packagesArray = [normalizedInput];
  }

  const packages = packagesArray.map(pkg => pkg.trim()).filter(pkg => pkg.length > 0).join(',');
  if (!packages) {
    throw new Error('No valid packages were provided');
  }

  return packages;
}

export class ReleaseManager {
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

      const configContent = `user: ${config.user}\nremote: ${config.remote}\nlocal: ${config.local}\n`;

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
   * Clone opam-repository from upstream (always latest state)
   * dune-release will push to the fork URL from config
   */
  private cloneOpamRepository(localPath: string, opamRepository: OpamRepository): void {
    core.startGroup('Cloning opam-repository');

    const upstreamUrl = `https://github.com/${opamRepository.owner}/${opamRepository.repo}.git`;

    // Create directory structure
    const gitDir = Path.dirname(localPath);
    try {
      this.executor.mkdirSync(gitDir, { recursive: true });
    } catch (error: any) {
      // Directory might already exist, that's fine
    }

    // Clone upstream - always has the latest state
    this.exec(`git clone --depth 1 ${upstreamUrl} ${localPath}`);
    this.info(`Cloned ${upstreamUrl} to ${localPath}`);

    core.endGroup();
  }

  /**
   * Run dune-release commands
   */
  private runDuneRelease(command: string, args: string[] = []): void {
    const fullCommand = `opam exec -- dune-release ${command} ${args.join(' ')}`;
    this.exec(fullCommand);
  }

  private lintPackages(packages: string): void {
    core.startGroup('Linting opam files');
    this.runDuneRelease('lint', ['-p', packages]);
    core.endGroup();
  }

  public runLint(packages: string): void {
    this.checkDependencies();
    this.lintPackages(packages);
  }

  private deleteTag(): never {
    const tagName = this.context.ref.replace('refs/tags/', '');
    this.info(`Attempting to delete tag ${tagName}`);

    // Configure git with token for both HTTPS and SSH URLs
    const gitConfig = `https://x-access-token:${this.context.token}@github.com/`;
    this.exec(`git config --global url."${gitConfig}".insteadOf "https://github.com/"`, { silent: true });
    this.exec(`git config --global url."${gitConfig}".insteadOf "git@github.com:"`, { silent: true });

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
    changelogPath: string | null,
    duneConfig: ReleaseConfig,
    toGithubReleases: boolean,
    toOpamRepository: boolean,
    includeSubmodules: boolean = false,
    opamRepository: OpamRepository = { owner: 'ocaml', repo: 'opam-repository' },
    buildDir?: string,
    publishMessage?: string,
    preamble?: string,
    dryRun: boolean = false,
    draft: boolean = false
  ): Promise<void> {
    let versionChangelogPath: string | null = null;

    try {
      this.checkDependencies();
      this.validateNewTag();
      this.configureGit();
      const version = this.extractVersion();

      if (draft && toOpamRepository) {
        core.warning('Draft mode: the opam-repository PR will not be opened. Publish the draft GitHub release first, then submit to opam.');
        toOpamRepository = false;
      }

      if (dryRun) {
        core.notice('DRY RUN MODE - No releases will be published, no PRs submitted');
      } else if (!toGithubReleases && !toOpamRepository) {
        core.warning('Both GitHub releases and opam submission are disabled - running validation only');
      } else {
        if (!toGithubReleases) {
          core.warning('GitHub releases disabled - will not publish to GitHub');
        }
        if (!toOpamRepository && !draft) {
          core.warning('opam submission disabled - will not submit to opam-repository');
        }
      }

      this.info(`Starting release for version ${version}`);

      if (changelogPath) {
        core.startGroup('Validating changelog');
        if (!this.executor.fileExists(changelogPath)) {
          core.warning(`Changelog file not found: ${changelogPath}`);
          core.warning('Proceeding without changelog - release will succeed but no changelog will be included');
          changelogPath = null;
        } else {
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

          changelogPath = versionChangelogPath;
        }
        core.endGroup();
      } else {
        core.info('No changelog specified - skipping changelog validation and processing');
      }

      this.lintPackages(packages);

      this.setupDuneReleaseConfig(duneConfig);

      this.cloneOpamRepository(duneConfig.local, opamRepository);

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

      const tagName = this.context.ref.replace('refs/tags/', '');
      const githubReleaseUrl = draft
        ? `https://github.com/${this.context.repository}/releases`
        : `https://github.com/${this.context.repository}/releases/tag/${tagName}`;

      if (dryRun) {
        core.startGroup('Publishing to GitHub (dry-run)');
        core.info('DRY RUN: Would publish to GitHub');
        core.info(`DRY RUN: Release URL would be: ${githubReleaseUrl}`);
        core.endGroup();
      } else if (toGithubReleases) {
        core.startGroup('Publishing to GitHub');
        try {
          process.env.DUNE_RELEASE_DELEGATE = 'github-dune-release';
          process.env.GITHUB_TOKEN = this.context.token;
          this.info('Setting GITHUB_TOKEN environment variable for dune-release');
          const publishArgs = ['--yes'];
          if (changelogPath) {
            publishArgs.push(`--change-log=${changelogPath}`);
          }
          if (buildDir) {
            publishArgs.push(`--build-dir=${buildDir}`);
          }
          if (publishMessage) {
            publishArgs.push(`--message=${shellQuote(publishMessage)}`);
          }
          if (draft) {
            publishArgs.push('--draft');
          }
          this.info(`Running: dune-release publish ${publishArgs.join(' ')}`);
          this.runDuneRelease('publish', publishArgs);
          core.setOutput('github-release-url', githubReleaseUrl);
        } catch (error: any) {
          const message = error.message || error.toString();
          core.error(`Failed to publish GitHub release: ${message}`);
          core.error('This error occurred while running: dune-release publish');
          handleAuthError(error, 'dune-release publish');
        }
        core.endGroup();
      } else {
        core.startGroup('Publishing to GitHub (skipped)');
        core.warning('Skipping GitHub release publication');
        core.endGroup();
      }

      core.startGroup(`Packaging opam release for ${packages}`);
      const opamPkgArgs = ['pkg', '-p', packages, '--yes'];
      if (changelogPath) {
        opamPkgArgs.push(`--change-log=${changelogPath}`);
      }
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
        try {
          process.env.DUNE_RELEASE_DELEGATE = 'github-dune-release';
          process.env.GITHUB_TOKEN = this.context.token;
          this.info('Setting GITHUB_TOKEN environment variable for dune-release');
          this.executor.chdir(this.context.workspace);
          const opamSubmitArgs = ['submit', '-p', packages, '--yes'];
          if (changelogPath) {
            opamSubmitArgs.push(`--change-log=${changelogPath}`);
          }
          if (buildDir) {
            opamSubmitArgs.push(`--build-dir=${buildDir}`);
          }
          if (preamble) {
            let changelogContent: string | null = null;
            if (changelogPath) {
              try {
                changelogContent = this.executor.readFile(changelogPath);
              } catch (error: any) {
                core.warning(`Could not read changelog for opam PR message, using preamble only: ${error.message}`);
              }
            }
            opamSubmitArgs.push(`--message=${shellQuote(composeOpamPrMessage(preamble, changelogContent))}`);
          }
          opamSubmitArgs.push(`--opam-repo=${opamRepository.owner}/${opamRepository.repo}`);
          opamSubmitArgs.push(`--remote-repo=git@github.com:${effectiveUser}/opam-repository`);
          this.info(`Running: dune-release opam ${opamSubmitArgs.join(' ')}`);
          this.runDuneRelease('opam', opamSubmitArgs);
          core.setOutput('opam-pr-url', opamPrUrl);
        } catch (error: any) {
          const message = error.message || error.toString();
          core.error(`Failed to submit to opam repository: ${message}`);
          core.error('This error occurred while running: dune-release opam submit');
          handleAuthError(error, 'dune-release opam submit');
        }
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
          core.notice(draft ? `Draft GitHub release created, review and publish it from: ${githubReleaseUrl}` : `GitHub release: ${githubReleaseUrl}`);
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

/**
 * Check if an error is a GitHub authentication error and throw a helpful message
 */
function handleAuthError(error: any, context: string = ''): never {
  const message = error.message || error.toString();
  const status = error.status || error.statusCode;
  const isAuthError =
    status === 401 ||
    status === 403 ||
    message.includes('Bad credentials') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('authentication failed') ||
    message.includes('Invalid username or token');

  if (isAuthError) {
    const contextMsg = context ? ` (${context})` : '';
    throw new Error(
      `GitHub authentication failed${contextMsg}: ${message}\n\n` +
      `This usually means:\n` +
      `  - The token is invalid or expired\n` +
      `  - The token doesn't have the required permissions\n\n` +
      `Required permissions for this action:\n` +
      `  - contents: write (for creating releases)\n` +
      `  - pull-requests: write (for submitting to opam-repository)\n\n` +
      `If using GITHUB_TOKEN, ensure your workflow has:\n` +
      `  permissions:\n` +
      `    contents: write\n` +
      `    pull-requests: write\n\n` +
      `If using a PAT, ensure it has 'repo' scope.`
    );
  }
  throw error;
}
