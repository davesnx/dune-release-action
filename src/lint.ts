#!/usr/bin/env node

import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHubContext, ReleaseManager, parsePackagesInput } from './core';

type Input = {
  packages: string;
}

const parseInput = (): Input => ({
  packages: parsePackagesInput(core.getInput('packages', { required: true }))
});

async function main() {
  try {
    const { packages } = parseInput();
    const context: GitHubContext = {
      ref: process.env.GITHUB_REF || github.context.ref,
      repository: process.env.GITHUB_REPOSITORY || `${github.context.repo.owner}/${github.context.repo.repo}`,
      workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
      token: ''
    };

    const releaseManager = new ReleaseManager(context, false);
    releaseManager.runLint(packages);

    core.setOutput('lint-status', 'success');
  } catch (error: any) {
    core.setFailed(error.message);
    core.setOutput('lint-status', 'failed');
    process.exit(1);
  }
}

const isTest = process.env.NODE_TEST_CONTEXT !== undefined || process.argv.some(arg => arg.includes('--test'));
if (!isTest) {
  main();
}

export default main;
