# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript sources. `src/index.ts` is the public entrypoint, with lower-level API helpers in `src/raw.ts`.
- Tests live next to sources as `src/*.spec.ts`, with shared helpers in `src/test-utils.ts`.
- `dist/` is build output (minified ESM bundle + `.d.ts` files).
- `docs/` is generated HTML Typedoc output; `docs-md/` is generated Markdown docs.
- `scripts/` contains build helpers such as `scripts/build-docs-md.js`.

## Build, Test, and Development Commands
- `bun install` installs dependencies.
- `bun fmt` formats code with Biome.
- `bun lint` runs `tsc`, `biome check`, and `typedoc --emit none` (this is what CI runs).
- `bun test` runs the Bun test runner over `src/*.spec.ts`.
- `bun test --coverage` is required by `prepack` and should pass before releases.
- `bun export` builds `dist/` using `tsc -p tsconfig.build.json` and `bun build`.
- `bun doc` generates HTML docs into `docs/`.
- `bun doc:md` generates Markdown docs into `docs-md/`.

## Coding Style & Naming Conventions
- TypeScript, ESM (`"type": "module"`). Follow patterns in `src/`.
- Biome enforces spaces, LF line endings, and double quotes; run `bun fmt` before committing.
- Use `camelCase` for functions/variables and `PascalCase` for types and interfaces.
- Keep tests named `*.spec.ts` and colocated with related sources in `src/`.

## Testing Guidelines
- Tests use `bun:test` (`describe`, `test`, `expect`) and live in `src/*.spec.ts`.
- Add tests for API surface changes and edge cases (see `src/index.spec.ts`).
- Run `bun test` locally; use `bun test --coverage` for release readiness.

## Commit & Pull Request Guidelines
- Recent commits use short, imperative subjects, sometimes with Conventional Commit prefixes like `fix:` or `docs:`. Release commits use tags like `v9.0.2`.
- Follow that pattern (e.g., `fix: allow empty cache`) and keep messages scoped.
- There is no PR template in this repo; include a brief summary, tests run (e.g., `bun lint`, `bun test`), and link issues when relevant.
- If API or documentation changes, update `docs/` or `docs-md/` as appropriate.
