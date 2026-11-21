import * as core from '@actions/core';
import Fs from 'fs';

export interface ChangelogEntry {
  version: string;
  date?: string;
  content: string;
}

export interface ChangelogValidation {
  valid: boolean;
  hasUnreleased: boolean;
  hasVersionEntry: boolean;
  versionContent?: string;
  warnings: string[];
  errors: string[];
}

const VERSION_PATTERN = /^#{1,3}\s+v?(\d+(?:\.\d+)*(?:-[a-zA-Z0-9.]+)?)\s*(?:\(([^)]+)\))?/;
const TITLE_PATTERN = /^#\s+(Changelog|Changes)\s*$/i;

export function parseChangelog(changelogPath: string): ChangelogEntry[] {
  try {
    const content = Fs.readFileSync(changelogPath, 'utf-8');
    const entries: ChangelogEntry[] = [];
    const lines = content.split('\n');

    let currentEntry: ChangelogEntry | null = null;
    let currentContent: string[] = [];
    let foundFirstVersion = false;
    let unreleasedContent: string[] = [];

    for (const line of lines) {
      const versionMatch = line.match(VERSION_PATTERN);

      if (versionMatch) {
        if (!foundFirstVersion && unreleasedContent.length > 0) {
          const trimmed = unreleasedContent.join('\n').trim();
          if (trimmed) {
            entries.push({ version: 'unreleased', content: trimmed });
          }
        }
        foundFirstVersion = true;

        if (currentEntry) {
          currentEntry.content = currentContent.join('\n').trim();
          entries.push(currentEntry);
        }

          currentEntry = {
            version: versionMatch[1],
            date: versionMatch[2],
            content: ''
          };
        currentContent = [];
      } else if (foundFirstVersion && currentEntry) {
        currentContent.push(line);
      } else if (!foundFirstVersion && !line.match(TITLE_PATTERN)) {
        unreleasedContent.push(line);
      }
    }

    if (currentEntry) {
      currentEntry.content = currentContent.join('\n').trim();
      entries.push(currentEntry);
    }

    return entries;
  } catch (error: any) {
    throw new Error(`Failed to parse changelog: ${error.message}`);
  }
}

function normalizeVersion(version: string): string {
  return version.replace(/^v/, '').replace(/(?:\.0)+$/, '');
}

function versionsMatch(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b);
}

export function validateChangelog(
  changelogPath: string,
  expectedVersion: string
): ChangelogValidation {
  const validation: ChangelogValidation = {
    valid: true,
    hasUnreleased: false,
    hasVersionEntry: false,
    warnings: [],
    errors: []
  };

  try {
    if (!Fs.existsSync(changelogPath)) {
      validation.valid = false;
      validation.errors.push(`Changelog file not found: ${changelogPath}`);
      return validation;
    }

    const entries = parseChangelog(changelogPath);

    if (entries.length === 0) {
      validation.valid = false;
      validation.errors.push('Changelog is empty or could not be parsed');
      return validation;
    }

    const unreleasedEntry = entries.find(e => e.version === 'unreleased');
    if (unreleasedEntry && unreleasedEntry.content.trim().length > 0) {
      validation.hasUnreleased = true;
      validation.warnings.push(
        'Changelog has content in the Unreleased section. ' +
        'Consider moving it to the version section or removing it.'
      );
    }

    const versionEntry = entries.find(e =>
      e.version !== 'unreleased' && versionsMatch(e.version, expectedVersion)
    );

    if (!versionEntry) {
      validation.valid = false;
      validation.hasVersionEntry = false;
      validation.errors.push(
        `Changelog does not contain an entry for version ${expectedVersion}. ` +
        `Found versions: ${entries.filter(e => e.version !== 'unreleased').map(e => e.version).join(', ')}`
      );
      return validation;
    }

    validation.hasVersionEntry = true;
    validation.versionContent = versionEntry.content;

    if (!versionEntry.content || versionEntry.content.trim().length === 0) {
      validation.valid = false;
      validation.errors.push(`Changelog entry for ${expectedVersion} is empty`);
    }

    if (versionEntry.content.trim().length < 20) {
      validation.warnings.push(
        `Changelog entry for ${expectedVersion} seems very short. ` +
        `Make sure to document all changes.`
      );
    }

  } catch (error: any) {
    validation.valid = false;
    validation.errors.push(`Error validating changelog: ${error.message}`);
  }

  return validation;
}

export function extractVersionChangelog(
  changelogPath: string,
  version: string,
  outputPath: string
): void {
  try {
    const entries = parseChangelog(changelogPath);
    const normalizedVersion = version.replace(/^v/, '');

    const versionEntry = entries.find(e =>
      e.version === normalizedVersion ||
      e.version === `v${normalizedVersion}`
    );

    if (!versionEntry) {
      throw new Error(`No changelog entry found for version ${version}`);
    }

    const content = `## ${version}${versionEntry.date ? ` (${versionEntry.date})` : ''}\n\n${versionEntry.content}\n`;
    Fs.writeFileSync(outputPath, content, 'utf-8');

    core.info(`Created version-specific changelog at: ${outputPath}`);
  } catch (error: any) {
    throw new Error(`Failed to extract version changelog: ${error.message}`);
  }
}

export interface CommitEntry {
  message: string;
  author: string;
  prNumber?: number;
  commitSha?: string;
  repoUrl?: string;
}

export function formatCommitEntry(entry: CommitEntry): string {
  const authorDisplay = entry.author.startsWith('@') ? entry.author : `@${entry.author}`;

  let linkSuffix = '';
  if (entry.prNumber && entry.repoUrl) {
    linkSuffix = ` ([#${entry.prNumber}](${entry.repoUrl}/pull/${entry.prNumber}))`;
  } else if (entry.prNumber) {
    linkSuffix = ` (#${entry.prNumber})`;
  } else if (entry.commitSha && entry.repoUrl) {
    const shortSha = entry.commitSha.substring(0, 7);
    linkSuffix = ` ([${shortSha}](${entry.repoUrl}/commit/${entry.commitSha}))`;
  }

  return `- ${entry.message} by ${authorDisplay}${linkSuffix}`;
}

export function isEntryInChangelog(changelogPath: string, message: string): boolean {
  try {
    if (!Fs.existsSync(changelogPath)) {
      return false;
    }
    const content = Fs.readFileSync(changelogPath, 'utf-8');
    const normalizedMessage = message.trim().toLowerCase();
    const normalizedContent = content.toLowerCase();
    return normalizedContent.includes(normalizedMessage);
  } catch {
    return false;
  }
}

function readChangelogContent(changelogPath: string): string {
  if (!Fs.existsSync(changelogPath)) {
    return '';
  }
  return Fs.readFileSync(changelogPath, 'utf-8');
}

function findUnreleasedSection(content: string, unreleasedHeader: string): {
  headerStart: number;
  headerEnd: number;
  contentStart: number;
  contentEnd: number;
} | null {
  const headerRegex = new RegExp(`^${escapeRegex(unreleasedHeader)}\\s*$`, 'mi');
  const headerMatch = content.match(headerRegex);

  if (!headerMatch || headerMatch.index === undefined) {
    return null;
  }

  const headerStart = headerMatch.index;
  const headerEnd = headerStart + headerMatch[0].length;

  const nextHeaderRegex = /^##\s+/m;
  const afterHeader = content.slice(headerEnd);
  const nextHeaderMatch = afterHeader.match(nextHeaderRegex);

  const contentEnd = nextHeaderMatch && nextHeaderMatch.index !== undefined
    ? headerEnd + nextHeaderMatch.index
    : content.length;

  return {
    headerStart,
    headerEnd,
    contentStart: headerEnd,
    contentEnd
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function addToUnreleased(
  changelogPath: string,
  entries: CommitEntry[],
  unreleasedHeader: string = '## Unreleased'
): void {
  if (entries.length === 0) {
    return;
  }

  let content = readChangelogContent(changelogPath);
  const formattedEntries = entries.map(formatCommitEntry).join('\n');

  const unreleasedSection = findUnreleasedSection(content, unreleasedHeader);

  if (unreleasedSection) {
    const beforeHeader = content.slice(0, unreleasedSection.headerStart).trimEnd();

    const existingContent = content.slice(unreleasedSection.contentStart, unreleasedSection.contentEnd).trim();

    const afterContent = content.slice(unreleasedSection.contentEnd).trim();

    const entriesBlock = existingContent
      ? `${formattedEntries}\n${existingContent}`
      : formattedEntries;

    const parts = [beforeHeader, '', unreleasedHeader, '', entriesBlock];
    if (afterContent) {
      parts.push('', afterContent);
    }
    content = parts.join('\n') + '\n';
  } else {
    const titleMatch = content.match(/^#\s+[^\n]+\n/);

    if (titleMatch) {
      const afterTitle = titleMatch[0].length;
      const newSection = `\n${unreleasedHeader}\n\n${formattedEntries}\n`;
      content = content.slice(0, afterTitle) + newSection + content.slice(afterTitle);
    } else if (content.trim() === '') {
      content = `# Changelog\n\n${unreleasedHeader}\n\n${formattedEntries}\n`;
    } else {
      content = `${unreleasedHeader}\n\n${formattedEntries}\n\n${content}`;
    }
  }

  Fs.writeFileSync(changelogPath, content, 'utf-8');
}

export function promoteUnreleasedToVersion(
  changelogPath: string,
  version: string,
  date: string,
  unreleasedHeader: string = '## Unreleased'
): void {
  let content = readChangelogContent(changelogPath);

  if (!content.trim()) {
    throw new Error('Changelog file is empty or does not exist');
  }

  const unreleasedSection = findUnreleasedSection(content, unreleasedHeader);

  if (!unreleasedSection) {
    throw new Error(`Unreleased section not found in changelog (looking for "${unreleasedHeader}")`);
  }

  const unreleasedContent = content
    .slice(unreleasedSection.contentStart, unreleasedSection.contentEnd)
    .trim();

  if (!unreleasedContent) {
    throw new Error('Unreleased section is empty - nothing to promote');
  }

  const normalizedVersion = version.startsWith('v') ? version : `v${version}`;
  const versionHeader = `## ${normalizedVersion} (${date})`;

  const beforeUnreleased = content.slice(0, unreleasedSection.headerStart);
  const afterUnreleased = content.slice(unreleasedSection.contentEnd);

  const parts = [
    beforeUnreleased.trimEnd(),
    '',
    unreleasedHeader,
    '',
    versionHeader,
    '',
    unreleasedContent
  ];

  const trimmedAfter = afterUnreleased.trimStart();
  if (trimmedAfter) {
    parts.push('');
    parts.push(trimmedAfter);
  } else {
    parts.push('');
  }

  const newContent = parts.join('\n');
  Fs.writeFileSync(changelogPath, newContent, 'utf-8');
}

export function getUnreleasedContent(
  changelogPath: string,
  unreleasedHeader: string = '## Unreleased'
): string | null {
  const content = readChangelogContent(changelogPath);

  if (!content) {
    return null;
  }

  const unreleasedSection = findUnreleasedSection(content, unreleasedHeader);

  if (!unreleasedSection) {
    return null;
  }

  return content.slice(unreleasedSection.contentStart, unreleasedSection.contentEnd).trim();
}

export function hasVersion(changelogPath: string, version: string): boolean {
  try {
    const entries = parseChangelog(changelogPath);
    const normalizedVersion = version.replace(/^v/, '');
    return entries.some(e =>
      e.version === normalizedVersion ||
      e.version === `v${normalizedVersion}` ||
      e.version === version
    );
  } catch {
    return false;
  }
}

export function getVersions(changelogPath: string): string[] {
  try {
    const entries = parseChangelog(changelogPath);
    return entries
      .filter(e => e.version !== 'unreleased')
      .map(e => e.version);
  } catch {
    return [];
  }
}

export function addVersionSection(
  changelogPath: string,
  version: string,
  date: string,
  entries: CommitEntry[],
  unreleasedHeader: string = '## Unreleased'
): void {
  let content = readChangelogContent(changelogPath);

  const normalizedVersion = version.startsWith('v') ? version : `v${version}`;
  const versionHeader = `## ${normalizedVersion} (${date})`;
  const formattedEntries = entries.length > 0
    ? entries.map(formatCommitEntry).join('\n')
    : '- Initial release';

  const versionSection = `${versionHeader}\n\n${formattedEntries}`;

  if (!content.trim()) {
    content = `# Changelog\n\n${unreleasedHeader}\n\n${versionSection}\n`;
    Fs.writeFileSync(changelogPath, content, 'utf-8');
    return;
  }

  const unreleasedSection = findUnreleasedSection(content, unreleasedHeader);

  if (unreleasedSection) {
    const beforeHeader = content.slice(0, unreleasedSection.headerStart).trimEnd();

    const unreleasedContent = content.slice(unreleasedSection.contentStart, unreleasedSection.contentEnd).trim();

    const afterUnreleased = content.slice(unreleasedSection.contentEnd).trim();

    const parts = [beforeHeader, '', unreleasedHeader];

    if (unreleasedContent) {
      parts.push('', unreleasedContent);
    }

    parts.push('', versionSection);

    if (afterUnreleased) {
      parts.push('', afterUnreleased);
    }

    const newContent = parts.join('\n') + '\n';
    Fs.writeFileSync(changelogPath, newContent, 'utf-8');
  } else {
    const titleMatch = content.match(/^#\s+[^\n]+\n/);

    if (titleMatch) {
      const afterTitle = titleMatch[0].length;
      const newContent = content.slice(0, afterTitle) + '\n' + unreleasedHeader + '\n\n' + versionSection + '\n\n' + content.slice(afterTitle);
      Fs.writeFileSync(changelogPath, newContent, 'utf-8');
    } else {
      content = `# Changelog\n\n${unreleasedHeader}\n\n${versionSection}\n\n${content}`;
      Fs.writeFileSync(changelogPath, content, 'utf-8');
    }
  }
}

