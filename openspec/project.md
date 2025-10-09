# Project Context

## Purpose
`rmapi-js` is a TypeScript library that reverse-engineers the reMarkable cloud API to let JavaScript/Bun/Node runtimes register devices, list cloud items, upload documents, and manipulate metadata without relying on the official desktop apps. The goal is to offer a well-typed, higher-level interface layered on top of the raw HTTP endpoints while keeping parity with the device behavior.

## Tech Stack
- TypeScript (ESM modules compiled with `tsc`, targeting Bun/Node runtimes)
- Bun toolchain for testing, linting, and bundling (`bun test`, `bun lint`, `bun export`)
- Typed schema validation via `jtd-ts`; bundling/minification via `bun build`; documentation via TypeDoc

## Project Conventions

### Code Style
- Enforce ESLint (`typescript-eslint` + `eslint-config-prettier`) and Prettier with organize-imports; `bun lint` must pass.
- Follow TSDoc comment conventions (`tsdoc/syntax` rule on) for public APIs and keep names descriptive, typed, and camelCased.
- Avoid `FIXME`/`TODO` comments (`no-warning-comments`), and prefer explicit type annotations only when inference is unclear.
- Source files live in `src/` as `.ts`; tests sit alongside implementation as `*.spec.ts`.

### Architecture Patterns
- High-level API (`remarkable`, `register`, convenience helpers) in `src/index.ts` delegates to a lower-level `RawRemarkableApi` defined in `src/raw.ts`.
- HTTP serialization, hashing, and JSON validation are centralized in `raw.ts`, with `LruCache` providing memoization for expensive lookups.
- Errors are modeled explicitly (`ValidationError`, `HashNotFoundError`) to distinguish data-integrity issues from transport problems.

### Testing Strategy
- Use `bun test --coverage` with colocated `*.spec.ts` files (e.g., `index.spec.ts`, `lru.spec.ts`) targeting both high-level flows and caching utilities.
- Prefer deterministic unit-style tests; add integration-style tests sparingly because hitting live reMarkable services requires user credentials.
- Keep tests fast and self-contained so `bun test` can run in CI and during `prepack`.

### Git Workflow
- Mainline development happens on the default branch; open feature branches for non-trivial work and land via PR review.
- Maintain `CHANGELOG.md` using Keep a Changelog format and Semantic Versioning; update the changelog for user-visible behavior shifts.
- Align releases with npm publishing (`prepack` runs lint/tests/build before packaging) and bump versions accordingly.

## Domain Context
- reMarkable stores every document/folder as content-addressed blobs (sha256 hashes) plus UUID identifiers; many operations require supplying the previous hash.
- The API offers both high-level helpers and raw low-level endpoints; misuse of raw methods can corrupt user data, so validation and hash bookkeeping matter.
- Upload workflows differ for EPUB/PDF versus notebooks, and templates use distinct metadata; understanding these distinctions avoids accidental data loss.

## Important Constraints
- Preserve compatibility with the official reMarkable cloud hosts (`AUTH_HOST`, `RAW_HOST`, `UPLOAD_HOST`) and their authentication flows.
- Treat validation errors seriously—do not disable schema checks unless the caller intentionally opts into raw access.
- Avoid breaking API signatures unless introducing a major release and documenting the change in the changelog.
- Keep the bundle ESM-compatible and tree-shakeable; avoid Node-specific globals unless polyfilled.

## External Dependencies
- reMarkable cloud endpoints (authentication, raw storage, upload) and optional `rmfakecloud` instances for self-hosted testing.
- Third-party libraries: `jszip` for archive handling, `jtd-ts` for JSON typing, `uuid` for identifier generation, `base64-js`/`crc-32` for encoding and checksums.
- Bun runtime tooling for lint/test/build pipelines; TypeDoc for API documentation.
