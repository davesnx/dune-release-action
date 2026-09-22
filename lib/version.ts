// opam's Version.of_string rule (ocaml/opam src/format/opamPackage.ml).
export const OPAM_VERSION_CHARS = /^[A-Za-z0-9_+.~-]+$/;
const INVALID_CHAR = /[^A-Za-z0-9_+.~-]/;

// dune-release drops a leading v/V unconditionally; this action only drops it when a
// digit follows, so tags like "vendor-1.0" keep their v. The result is passed with
// --pkg-version, so dune-release's own rule never runs.
export function dropLeadingV(tag: string): string {
  return /^[vV]\d/.test(tag) ? tag.slice(1) : tag;
}

export function versionFromTag(tag: string): string {
  const version = dropLeadingV(tag);
  if (version.length === 0) {
    throw new Error(`Package version can't be empty`);
  }
  if (!OPAM_VERSION_CHARS.test(version)) {
    const badChar = version.match(INVALID_CHAR)![0];
    throw new Error(
      `Invalid character '${badChar}' in package version "${version}". ` +
      'Allowed characters are letters, digits, and _ + . ~ -'
    );
  }
  return version;
}
