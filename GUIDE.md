# Release Guide

A practical guide to releasing OCaml packages with `dune-release-action`.

## Requisites: the workflow

The release workflow (for example: `.github/workflow/ci.yml`) should trigger on:

- **Tag push** — release whenever you push a tag
- **Manually** — useful for testing or re-running failed releases

If you have a separate CI workflow for builds/tests, you can also wait for it to complete before releasing.

```yaml
on:
  push:
    tags:
      - '*' # Triggers on any tag (e.g., 1.0.0, v2.1.0)
  workflow_dispatch: # Allow manual trigger
    inputs:
      tag:
        description: 'Tag to release'
        required: true
        type: string
      dry_run:
        description: 'Dry run (no GitHub release or opam submission)'
        type: boolean
        default: false
```

If you have a separate workflow, you can wait for it to complete before releasing:

```yaml
  # Trigger when another workflow completes on a tag
  workflow_run:
    workflows: ["CI"] # ← that's the name of your workflow (the `name:` field in your xxx.yml)
    types:
      - completed
```

## Step 1: update CHANGES.md

As you work, add changes under `# Unreleased`. Before releasing, create a new header with the version and move all items there.

The version header can be `## 1.0.0`, `## 1.0.0 (date)`, or `## 1.0.0-beta.1`. See [html_of_jsx/CHANGES.md](https://github.com/davesnx/html_of_jsx/blob/main/CHANGES.md) for a real example.

```markdown
# Unreleased

(Keep this section for work-in-progress changes)

## 1.2.0 (2025-11-28)

- Added feature X
- Fixed bug in Y

## 1.1.0 (2025-10-15)

- Previous changes...
```

## Step 2: Push a new GitHub tag

Create an annotated tag and push it:

```bash
git tag -a "1.2.0" -m "Release version 1.2.0"
git push origin 1.2.0
```

This triggers the release workflow since you pushed a new tag.
