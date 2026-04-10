#!/usr/bin/env node

import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHubContext, OpamRepository, ReleaseConfig, ReleaseManager, parsePackagesInput } from './core';

export const DEFAULT_CHANGELOG_PATH = './CHANGES.md';

type Input = {
  packages: string;
  changelogPath: string | null;
  token: string;
  verbose: boolean;
  toOpamRepository: boolean;
  toGithubReleases: boolean;
  includeSubmodules: boolean;
  opamRepository: OpamRepository;
  buildDir: string | undefined;
  publishMessage: string | undefined;
  dryRun: boolean;
}

const parseInput = (): Input => {
  const packages = parsePackagesInput(core.getInput('packages', { required: true }));

  const changelogInput = core.getInput('changelog').trim();
  const changelogPath = changelogInput || DEFAULT_CHANGELOG_PATH;

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

  return { packages, verbose, changelogPath, token, toOpamRepository, toGithubReleases, includeSubmodules, opamRepository, buildDir, publishMessage, dryRun };
}

async function main() {
  try {
    const { packages, verbose, changelogPath, token, toOpamRepository, toGithubReleases, includeSubmodules, opamRepository, buildDir, publishMessage, dryRun } = parseInput();

    const testRefOverride = process.env.TEST_OVERRIDE_GITHUB_REF || '';
    const ref = testRefOverride || process.env.GITHUB_REF || github.context.ref;
    if (!ref.startsWith('refs/tags/')) {
      throw new Error(`This action must be run on a git tag. Current ref: ${ref}\nFor branch and pull request validation, use davesnx/dune-release-action/lint.`);
    }

    if (testRefOverride && verbose) {
      core.warning(`Using TEST_OVERRIDE_GITHUB_REF: ${testRefOverride}`);
    }

    const octokit = github.getOctokit(token);
    let effectiveUser: string;
    try {
      const { data: authenticatedUser } = await octokit.rest.users.getAuthenticated();
      effectiveUser = authenticatedUser.login;
    } catch (authError: any) {
      const repoOwner = github.context.repo.owner;
      if (repoOwner) {
        core.warning(`Could not get authenticated user (this is normal with GITHUB_TOKEN). Using repository owner: ${repoOwner}`);
        effectiveUser = repoOwner;
      } else {
        throw authError;
      }
    }
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

export { ReleaseManager, ReleaseConfig, GitHubContext, Executor, defaultExecutor, OpamRepository, parsePackagesInput } from './core';
export default main;
