# dune-release-action

Release OCaml packages to opam with `dune-release`, or run opam linting only via `dune-release-action/lint`.

There are two public actions:

- `davesnx/dune-release-action@v0.5.0` for tag-driven releases
- `davesnx/dune-release-action/lint@v0.5.0` for branch and pull request linting

**New to automatic releasing?** Check out the [GUIDE.md](./GUIDE.md) for best practices on when to release, how to maintain your changelog, and a handy release script.

## Requirements

### GitHub Setup For Releases

1. **Fork opam-repository**: You need a fork of [ocaml/opam-repository](https://github.com/ocaml/opam-repository) in your GitHub account
   - Go to https://github.com/ocaml/opam-repository/fork
   - Create a fork (use default settings)

2. **GitHub Token**: Create a [Personal Access Token (classic)](https://github.com/settings/tokens) with these scopes:
   - ✅ `repo` - Full control of repositories
   - ✅ `workflow` - Update GitHub Action workflows
   - Add it to your repository secrets as `GH_TOKEN`

### Build Tools

Both actions expect these tools to be available in your GitHub Actions environment:
- `opam` - OCaml package manager
- `dune-release` - Release automation tool

The actions validate that these tools are available, but they do not install them for you. That stays in your workflow so you keep control over the OCaml switch, caching, and setup policy.

Install with:
```yaml
- uses: ocaml/setup-ocaml@v3
  with:
    ocaml-compiler: 5.3.0

- run: opam install dune-release -y
```

## Usage

### Lint only in CI

Use the `/lint` sub-action for pull requests and branch pushes:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  opam-lint:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: ocaml/setup-ocaml@v3
        with:
          ocaml-compiler: 5.3.0

      - run: opam install . --deps-only -y
      - run: opam install dune-release -y

      - uses: davesnx/dune-release-action/lint@v0.5.0
        with:
          packages: 'your-package'
```

### Release on tags

```yaml
name: Release

on:
  push:
    # Trigger this workflow when a tag is pushed
    tags:
      - '*' # any tag push (e.g., v1.0.0, 0.0.6)

permissions:
  contents: write        # Required to create GitHub releases and push commits
  pull-requests: write   # Required to create PRs to opam-repository

jobs:
  release:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # This is your current workflow
      - uses: ocaml/setup-ocaml@v3
        with:
          ocaml-compiler: 5.3.0
      - run: opam install . --deps-only
      - run: opam install dune-release -y

      # Add the dune-release-action
      - uses: davesnx/dune-release-action@v0.5.0
        with:
          packages: 'your-package'
          github-token: ${{ secrets.GH_TOKEN }}
```

### Advanced release example (all options)

```yaml
- uses: davesnx/dune-release-action@v0.5.0
  with:
    packages: |                           # (required) You can pass multiple packages
      package-one
      package-two
      package-three
    github-token: ${{ secrets.GH_TOKEN }} # (required) Personal token (classic) with `repo` and `workflow` scopes
    changelog: './CHANGES.md'             # (optional) Filename to extract PR descriptions and validate tag
    verbose: true                         # Show detailed logs
    to-opam-repository: true              # Submit PR to opam-repository
    to-github-releases: true              # Create GitHub release
    include-submodules: true              # Include git submodules in the tarball
    pr-preamble-message: 'cc @my-org/release-team' # Text prepended to the opam PR description
    draft: false                          # Create the GitHub release as a draft (skips the opam PR)
```

## Inputs

The following inputs apply to the root release action: `davesnx/dune-release-action@v0.5.0`.

### Required

| Input | Description | Example |
|-------|-------------|---------|
| `packages` | Package name(s) to release. Single package as string or multiple as array | `html_of_jsx` or `["pkg1", "pkg2"]` |
| `github-token` | GitHub token for release publication and opam submission | `${{ secrets.GH_TOKEN }}` |

Your `github-token` secret must have these scopes:
- ✅ `repo` - Full control of private repositories
- ✅ `workflow` - Update GitHub Action workflows (required for opam-repository PRs)

**To create or update your token:**

1. Go to https://github.com/settings/tokens
2. Create a new token (classic) or edit existing
3. Enable `repo` and `workflow` scopes
4. Add it to your repository secrets as `GH_TOKEN`

### Optional

| Input | Description | Default |
|-------|-------------|---------|
| `changelog` | Path to changelog file | `./CHANGES.md` |
| `verbose` | If true, shows detailed logging output | `false` |
| `to-opam-repository` | If true, submits a PR to opam-repository | `true` |
| `to-github-releases` | If true, creates a GitHub release | `true` |
| `include-submodules` | If true, includes git submodules in the distribution tarball | `false` |
| `pr-preamble-message` | Text prepended to the opam-repository PR description, before the changelog content | (none) |
| `publish-message` | Custom message for the GitHub release publication | (changelog content) |
| `draft` | If true, creates the GitHub release as a draft and skips the opam-repository PR. See [Draft releases](#draft-releases) | `false` |
| `dry-run` | Validate setup without publishing: runs lint, changelog validation, and distrib, but skips the GitHub release and opam submission | `false` |

### Draft releases

Set `draft: true` to inspect the release tarball before anyone can install it:

```yaml
- uses: davesnx/dune-release-action@v0.5.0
  with:
    packages: 'your-package'
    github-token: ${{ secrets.GH_TOKEN }}
    draft: true
```

The action runs `dune-release publish --draft`, so the GitHub release is created as a draft with the tarball attached. Drafts are only visible to maintainers, on the repository's releases page. Review the tarball there and press **Publish release** when you are happy with it.

Draft mode never opens the opam-repository PR, even if `to-opam-repository` is `true` (the action warns about it). A draft's tarball URL is temporary and changes when the release is published, so an opam PR opened at that point would break. Submit to opam once the release is published, for example with `dune-release opam pkg && dune-release opam submit` locally.

## Lint Action Inputs

The lint-only action `davesnx/dune-release-action/lint@v0.5.0` accepts:

| Input | Description | Example |
|-------|-------------|---------|
| `packages` | Package name(s) to lint. Single package, YAML list, JSON array, or comma-separated string | `html_of_jsx` or `pkg1,pkg2` |

The lint action does not require a GitHub token and does not require a tag ref.

### Changelog Format

Your `CHANGES.md` should follow this format:

```markdown
# Unreleased

(Optional - will trigger a warning if not empty)

## 0.0.6 (2025-10-13)

- Added new feature X
- Fixed bug in Y
- Improved performance of Z

## 0.0.5 (2025-10-01)

- Previous version changes
```

#### Supported Formats

- `## v1.0.0` - With 'v' prefix
- `## 1.0.0` - Without prefix
- `## 1.0.0 (2025-10-13)` - With date
- `## 1.0.0-beta.1` - Pre-release versions

## Outputs

Release action outputs for `davesnx/dune-release-action@v0.5.0`:

| Output | Description |
|--------|-------------|
| `version` | Extracted version from git tag |
| `release-status` | Status of the release (`success` or `failed`) |
| `github-release-url` | URL of the created GitHub release. With `draft: true` this is the repository releases page, where drafts are listed |
| `opam-pr-url` | URL of the opam-repository pull request |

Lint action outputs for `davesnx/dune-release-action/lint@v0.5.0`:

| Output | Description |
|--------|-------------|
| `lint-status` | Status of the lint run (`success` or `failed`) |

## License

MIT License - See [LICENSE](./LICENSE)
