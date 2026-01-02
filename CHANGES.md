# Changelog

## v0.2.14

- Fix "Resource not accessible by integration" error by falling back to repository owner when GITHUB_TOKEN lacks user scope [@davesnx](https://github.com/davesnx)

## v0.2.13

- Don't run the validation when changelog isn't set

## v0.2.12

- Add logging in auth

## v0.2.11

- Make changelog optional - release succeeds even if changelog file is missing [@davesnx](https://github.com/davesnx)

## v0.2.10

- Use effective user from token [#2](https://github.com/davesnx/dune-release-action/pull/2) [@andreypopp](https://github.com/andreypopp)

## v0.2.9

- Clone upstream opam-repository instead of fork (simpler, always latest) [@davesnx](https://github.com/davesnx)
- Support flexible changelog formats: `#`/`##`/`###` headers, two-segment versions (`0.11`), date-based versions [@davesnx](https://github.com/davesnx)

## v0.2.6

- Add `dry-run` mode for validating setup without publishing [@davesnx](https://github.com/davesnx)
- Add `github-release-url` and `opam-pr-url` outputs [@davesnx](https://github.com/davesnx)
- Make `ReleaseManager` testable via dependency injection [@davesnx](https://github.com/davesnx)

## v0.2.5

- Support `packages` as YAML list or JSON array format [@davesnx](https://github.com/davesnx)

## v0.2.4

- Add `opam-repository` option to target custom opam repositories (default: `ocaml/opam-repository`) [@davesnx](https://github.com/davesnx)
- Add `build-dir` option to specify custom build directory for dune-release [@davesnx](https://github.com/davesnx)
- Add `publish-message` option for custom GitHub release messages [@davesnx](https://github.com/davesnx)

## v0.2.3

- Add `include-submodules` option to include git submodules in the distribution tarball [@davesnx](https://github.com/davesnx)
- Push GUIDE.md [@davesnx](https://github.com/davesnx)([fc734f3](https://github.com/davesnx/dune-release-action/commit/fc734f3496201d49682c4670272af11f66b7004e))

## v0.2.2 (2025-11-12)

- Ensure opam-repository exists [@davesnx](https://github.com/davenx)

## v0.2.1 (2025-11-12)

- Ensure http and git urls work [@davesnx](https://github.com/davenx)

## v0.2.0 (2025-11-12)

- Support packages with multiple packages [@davesnx](https://github.com/davenx)
- Publish with p [@davesnx](https://github.com/davenx)
- Fix build and package [@davesnx](https://github.com/davenx)
- Push dist into repo [@davesnx](https://github.com/davenx)
- Skip build on distrib [@davesnx](https://github.com/davenx)

## v0.1.0 (2025-10-14)

- Push dist [@davesnx](https://github.com/davenx)
- Extract action from html_of_jsx [@davesnx](https://github.com/davenx)
