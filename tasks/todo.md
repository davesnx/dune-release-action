# Debug plan

- [x] Reproduce the `ahrefs/passage` changelog parsing case in unit tests.
- [x] Run the relevant tests to confirm whether extraction logic is correct.
- [x] Inspect the release flow to see where the full changelog could still leak through.
- [x] Inspect `ahrefs/passage` release CI / workflow behavior for tag `0.3.4`.
- [x] Summarize root cause and recommend fixes.
- [x] Fix the default changelog path to `./CHANGES.md`.
- [x] Add regression coverage and rebuild the shipped action bundle.

## Review

- Added `ahrefs/passage` fixture coverage in `lib/changelog.test.ts`.
- `npm ci && npm run test:changelog` passes; parser/extractor isolate `0.3.4` correctly.
- `ahrefs/passage` tag workflow used `davesnx/dune-release-action@v0.2.14` without a `changelog` input.
- Release body is version-only, but opam PR `ocaml/opam-repository#29589` contains the full changelog body.
- Set the action input default and runtime fallback to `./CHANGES.md`, added metadata/runtime tests, and rebuilt `dist/`.
