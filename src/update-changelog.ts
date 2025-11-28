#!/usr/bin/env node

import * as core from '@actions/core';
import * as github from '@actions/github';
import { execSync } from 'child_process';
import {
  addToUnreleased,
  promoteUnreleasedToVersion,
  isEntryInChangelog,
  CommitEntry,
  getUnreleasedContent,
  hasVersion,
  addVersionSection
} from '../lib/changelog';

interface CommitInfo {
  sha: string;
  message: string;
  author: string;         // Git author name (from git log)
  authorHandle?: string;  // GitHub username
  prNumber?: number;
}

/**
 * Execute a shell command and return the output
 */
function exec(command: string, options: { silent?: boolean } = {}): string {
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      stdio: options.silent ? 'pipe' : ['pipe', 'pipe', 'pipe']
    });
    return result.toString().trim();
  } catch (error: any) {
    if (options.silent) {
      return '';
    }
    throw error;
  }
}

/**
 * Get the most recent tag from git
 */
function getLatestTag(): string | null {
  try {
    const tag = exec('git describe --tags --abbrev=0', { silent: true });
    return tag || null;
  } catch {
    // No tags exist yet
    return null;
  }
}

/**
 * Get all tags sorted by version (oldest first)
 */
function getAllTags(): string[] {
  try {
    const output = exec('git tag --sort=version:refname', { silent: true });
    if (!output) {
      return [];
    }
    return output.split('\n').filter(tag => tag.trim());
  } catch {
    return [];
  }
}

/**
 * Get the date of a tag in YYYY-MM-DD format
 */
function getTagDate(tag: string): string {
  try {
    // Get the commit date of the tag
    const date = exec(`git log -1 --format=%ci ${tag}`, { silent: true });
    if (date) {
      // Extract YYYY-MM-DD from the date string
      return date.split(' ')[0];
    }
  } catch {
    // Fall through to default
  }
  return getCurrentDate();
}

/**
 * Get commits between two refs (exclusive of fromRef, inclusive of toRef)
 */
function getCommitsBetween(fromRef: string | null, toRef: string): CommitInfo[] {
  const format = '%H|%s|%an';
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;

  try {
    const output = exec(`git log ${range} --format="${format}"`, { silent: true });

    if (!output) {
      return [];
    }

    return output.split('\n').filter(line => line.trim()).map(line => {
      const [sha, message, author] = line.split('|');
      return {
        sha: sha.trim(),
        message: message.trim(),
        author: author.trim()
      };
    });
  } catch {
    return [];
  }
}

/**
 * Get commits since a given ref (tag or commit)
 * If no ref is provided, gets all commits
 */
function getCommitsSince(ref: string | null): CommitInfo[] {
  const format = '%H|%s|%an';
  const range = ref ? `${ref}..HEAD` : 'HEAD';

  try {
    const output = exec(`git log ${range} --format="${format}"`, { silent: true });

    if (!output) {
      return [];
    }

    return output.split('\n').filter(line => line.trim()).map(line => {
      const [sha, message, author] = line.split('|');
      return {
        sha: sha.trim(),
        message: message.trim(),
        author: author.trim()
      };
    });
  } catch {
    return [];
  }
}

/**
 * Try to find the PR number and author handle associated with a commit
 */
async function enrichCommitWithPR(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commit: CommitInfo
): Promise<CommitInfo> {
  let enriched = { ...commit };

  try {
    // Check if the commit message already has a PR reference like "(#123)"
    const prMatch = commit.message.match(/\(#(\d+)\)$/);
    if (prMatch) {
      enriched.prNumber = parseInt(prMatch[1], 10);
    }

    // Try to find associated PRs via GitHub API
    if (!enriched.prNumber) {
      const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
        owner,
        repo,
        commit_sha: commit.sha
      });

      if (prs.length > 0) {
        // Use the first (most likely the merged) PR
        enriched.prNumber = prs[0].number;
        // Get author handle from PR
        if (prs[0].user?.login) {
          enriched.authorHandle = prs[0].user.login;
        }
      }
    }

    // If we still don't have the author handle, try to get it from the commit
    if (!enriched.authorHandle) {
      try {
        const { data: commitData } = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: commit.sha
        });
        if (commitData.author?.login) {
          enriched.authorHandle = commitData.author.login;
        }
      } catch {
        // Ignore - we'll fall back to git author name
      }
    }
  } catch (error: any) {
    core.debug(`Could not enrich commit ${commit.sha}: ${error.message}`);
  }

  return enriched;
}

/**
 * Filter commits to exclude merge commits and already-added entries
 */
function filterCommits(commits: CommitInfo[], changelogPath: string): CommitInfo[] {
  return commits.filter(commit => {
    // Skip merge commits
    if (commit.message.startsWith('Merge ')) {
      core.debug(`Skipping merge commit: ${commit.message}`);
      return false;
    }

    // Skip if already in changelog
    if (isEntryInChangelog(changelogPath, commit.message)) {
      core.debug(`Skipping already-tracked commit: ${commit.message}`);
      return false;
    }

    return true;
  });
}

/**
 * Convert CommitInfo to CommitEntry for the changelog
 */
function toCommitEntry(commit: CommitInfo, repoUrl: string): CommitEntry {
  // Clean up the message - remove PR reference if present (we'll add it back formatted)
  const cleanMessage = commit.message.replace(/\s*\(#\d+\)$/, '').trim();

  return {
    message: cleanMessage,
    author: commit.authorHandle || commit.author,  // Prefer GitHub handle
    prNumber: commit.prNumber,
    repoUrl
  };
}

/**
 * Get the current date in YYYY-MM-DD format
 */
function getCurrentDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if the current event is a tag push
 */
function isTagPush(): boolean {
  const ref = process.env.GITHUB_REF || '';
  return ref.startsWith('refs/tags/');
}

/**
 * Extract tag name from GITHUB_REF
 */
function getTagName(): string | null {
  const ref = process.env.GITHUB_REF || '';
  if (!ref.startsWith('refs/tags/')) {
    return null;
  }
  return ref.replace('refs/tags/', '');
}

/**
 * Configure git for committing
 */
function configureGit(token: string): void {
  exec('git config --local user.name "github-actions[bot]"');
  exec('git config --local user.email "github-actions[bot]@users.noreply.github.com"');

  // Set up authentication
  const origin = exec('git remote get-url origin', { silent: true });
  if (origin.startsWith('https://')) {
    const authedUrl = origin.replace('https://', `https://x-access-token:${token}@`);
    exec(`git remote set-url origin ${authedUrl}`, { silent: true });
  }
}

/**
 * Commit and push changes
 */
function commitAndPush(changelogPath: string, message: string): void {
  exec(`git add ${changelogPath}`);

  // Check if there are changes to commit
  const status = exec('git status --porcelain', { silent: true });
  if (!status) {
    core.info('No changes to commit');
    return;
  }

  exec(`git commit -m "${message}"`);

  // Push to the current branch
  const branch = exec('git rev-parse --abbrev-ref HEAD', { silent: true });
  exec(`git push origin ${branch}`);

  core.info(`Committed and pushed changes to ${branch}`);
}

/**
 * Backfill changelog with entries for tags that don't have version sections
 */
async function backfillChangelog(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  changelogPath: string,
  unreleasedHeader: string
): Promise<number> {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const allTags = getAllTags();

  if (allTags.length === 0) {
    core.info('No tags found - nothing to backfill');
    return 0;
  }

  core.info(`Found ${allTags.length} tags: ${allTags.join(', ')}`);

  // Find tags without changelog entries
  const missingTags = allTags.filter(tag => !hasVersion(changelogPath, tag));

  if (missingTags.length === 0) {
    core.info('All tags have changelog entries - no backfill needed');
    return 0;
  }

  core.info(`Backfilling ${missingTags.length} missing tags: ${missingTags.join(', ')}`);

  // Process tags in order (oldest first) so they appear correctly in changelog
  for (let i = 0; i < missingTags.length; i++) {
    const tag = missingTags[i];
    const tagIndex = allTags.indexOf(tag);
    const previousTag = tagIndex > 0 ? allTags[tagIndex - 1] : null;

    core.info(`\nProcessing ${tag} (previous: ${previousTag || 'none'})`);

    // Get commits for this tag
    const commits = getCommitsBetween(previousTag, tag);
    core.info(`  Found ${commits.length} commits`);

    // Filter merge commits
    const filteredCommits = commits.filter(c => !c.message.startsWith('Merge '));

    // Enrich with PR numbers and author handles
    const enrichedCommits = await Promise.all(
      filteredCommits.map(commit => enrichCommitWithPR(octokit, owner, repo, commit))
    );

    // Convert to entries with repo URL for PR links
    const entries = enrichedCommits.map(c => toCommitEntry(c, repoUrl));

    // Get the tag date
    const date = getTagDate(tag);

    // Add version section
    addVersionSection(changelogPath, tag, date, entries, unreleasedHeader);
    core.info(`  Added ${tag} (${date}) with ${entries.length} entries`);
  }

  return missingTags.length;
}

/**
 * Handle push to main branch - add new commits to Unreleased section
 */
async function handleMainPush(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  changelogPath: string,
  unreleasedHeader: string
): Promise<void> {
  core.info('Handling push to main branch');

  // First, check if we need to backfill missing tags
  const backfilledCount = await backfillChangelog(octokit, owner, repo, changelogPath, unreleasedHeader);
  if (backfilledCount > 0) {
    core.info(`\nBackfilled ${backfilledCount} version(s)`);
  }

  // Get the latest tag
  const latestTag = getLatestTag();
  core.info(latestTag ? `Latest tag: ${latestTag}` : 'No existing tags found');

  // Get commits since the last tag
  const commits = getCommitsSince(latestTag);
  core.info(`Found ${commits.length} commits since ${latestTag || 'beginning'}`);

  if (commits.length === 0) {
    core.info('No new commits to process');
    return;
  }

  // Filter out merge commits and already-tracked entries
  const newCommits = filterCommits(commits, changelogPath);
  core.info(`${newCommits.length} commits after filtering`);

  if (newCommits.length === 0) {
    core.info('All commits are already in the changelog');
    return;
  }

  // Enrich commits with PR numbers and author handles
  core.info('Looking up PR numbers for commits...');
  const enrichedCommits = await Promise.all(
    newCommits.map(commit => enrichCommitWithPR(octokit, owner, repo, commit))
  );

  // Convert to changelog entries with repo URL for PR links
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const entries = enrichedCommits.map(c => toCommitEntry(c, repoUrl));

  // Log what we're adding
  core.info(`Adding ${entries.length} entries to changelog:`);
  entries.forEach(entry => {
    const prSuffix = entry.prNumber ? ` (#${entry.prNumber})` : '';
    core.info(`  - ${entry.message} by @${entry.author}${prSuffix}`);
  });

  // Add to changelog
  addToUnreleased(changelogPath, entries, unreleasedHeader);
  core.info(`Updated ${changelogPath}`);
}

/**
 * Handle tag push - promote Unreleased to version section
 */
function handleTagPush(
  changelogPath: string,
  unreleasedHeader: string
): void {
  const tagName = getTagName();
  if (!tagName) {
    throw new Error('Could not extract tag name from GITHUB_REF');
  }

  core.info(`Handling tag push: ${tagName}`);

  // Check if there's content in unreleased
  const unreleasedContent = getUnreleasedContent(changelogPath, unreleasedHeader);
  if (!unreleasedContent) {
    core.warning('Unreleased section is empty - nothing to promote');
    return;
  }

  // Promote unreleased to version
  const date = getCurrentDate();
  promoteUnreleasedToVersion(changelogPath, tagName, date, unreleasedHeader);

  core.info(`Promoted Unreleased section to ${tagName} (${date})`);
}

async function main(): Promise<void> {
  try {
    // Get inputs
    const changelogPath = core.getInput('changelog') || './CHANGES.md';
    const unreleasedHeader = core.getInput('unreleased-header') || '## Unreleased';
    const token = core.getInput('github-token', { required: true });

    // Get repository info
    const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
    if (!owner || !repo) {
      throw new Error('Could not determine repository from GITHUB_REPOSITORY');
    }

    // Create Octokit instance
    const octokit = github.getOctokit(token);

    // Configure git for pushing
    configureGit(token);

    // Determine what type of event we're handling
    if (isTagPush()) {
      // Tag push - promote Unreleased to version
      handleTagPush(changelogPath, unreleasedHeader);

      // Commit and push the changes
      const tagName = getTagName();
      commitAndPush(changelogPath, `chore: release ${tagName}`);
    } else {
      // Branch push - add commits to Unreleased
      await handleMainPush(octokit, owner, repo, changelogPath, unreleasedHeader);

      // Commit and push the changes
      commitAndPush(changelogPath, 'chore: update changelog');
    }

    core.info('Changelog update complete!');
  } catch (error: any) {
    core.setFailed(`Failed to update changelog: ${error.message}`);
    process.exit(1);
  }
}

main();

export {
  getLatestTag,
  getAllTags,
  getCommitsSince,
  getCommitsBetween,
  filterCommits,
  toCommitEntry,
  isTagPush,
  getTagName,
  backfillChangelog
};

