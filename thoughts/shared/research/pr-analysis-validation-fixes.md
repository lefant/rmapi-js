# PR Analysis: reMarkable API Validation Schema Fixes

This document provides comprehensive information about six pull requests that fix validation schema issues in rmapi-js when handling edge cases from the reMarkable Cloud API.

---

## PR #43: Handle legacy tags in content

**Status:** OPEN
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/43
**Author:** @lefant (Fabian Linzberger)
**Created:** 2026-01-31
**Branch:** string-tags → main

### Bug Description

The reMarkable API returns tags in different formats depending on the document age or state. Newer documents use the structured format with `name` and `timestamp` fields, while legacy documents use a simple string array format.

**Error:**
```
Validation error: tags array contains strings instead of objects with {name, timestamp}
```

### API Response (Legacy Format)

```json
{
  "tags": ["Remarcal", "calendar"]
}
```

**Expected Format:**
```json
{
  "tags": [
    { "name": "Remarcal", "timestamp": 0 },
    { "name": "calendar", "timestamp": 0 }
  ]
}
```

### Test Added

**File:** `src/index.spec.ts` (lines +297 to +318)

```typescript
test("CollectionType legacy tags", async () => {
  const realHash = repHash("1");
  const file = `3
${realHash}:0:col.content:0:1
`;
  const content = {
    tags: ["Remarcal", "calendar"],
  };
  const expected = {
    tags: [
      { name: "Remarcal", timestamp: 0 },
      { name: "calendar", timestamp: 0 },
    ],
  };

  mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

  const api = await remarkable("");
  const cont = await api.getContent(repHash("0"));
  expect(cont).toEqual(expected);
});
```

### Code Fix

**File:** `src/raw.ts` (lines +929 to +1091)

```typescript
const LEGACY_TAG_TIMESTAMP = 0;

function normalizeLegacyTags(loaded: unknown): void {
  if (loaded === null || typeof loaded !== "object") return;
  const record = loaded as { tags?: unknown };
  const tags = record.tags;
  if (!Array.isArray(tags)) return;
  if (!tags.some((tag) => typeof tag === "string")) return;
  record.tags = tags.map((tag) =>
    typeof tag === "string"
      ? { name: tag, timestamp: LEGACY_TAG_TIMESTAMP }
      : tag,
  );
}

// Called in getContent() before validation:
async getContent(hash: string): Promise<Content> {
  const raw = await this.getText(hash);
  const loaded = JSON.parse(raw) as unknown;
  normalizeLegacyTags(loaded);
  // ... continue with validation
}
```

### Maintainer Comments

**@erikbrinkman** (Review - CHANGES_REQUESTED, 2026-02-01):

> if I'm reading this correctly, there are some documents where instead of tags being an object, it's an array of strings?
>
> Similar to the other commit, I'm more in favor of making the parsing lenient, rather than trying to transform to a standard type. The point of this api is not to guide how things should look, but rather present them, especially for the raw api. Adding something like a normalize command to the higher level api seems more reasonable, but not at load time.
>
> Unfortunately, if is what it looks like, then jtd is not really set up to parse `string[] | tag[]` or `(string | tag)[]`, but I surmise it's the first? The "best" way is to do what this library does for documents, that is try a number of parsers, and if any passes, we're good, if none pass then we have an issue. I think this is the best approach, although it does make things a little awkward as the types will have to be something like `DocumentContent | LegacyDocumentContent`. I think you could probably take the approach of
> ```ts
> type AbstractDocumentContent<T> = { ..., tags?: T[] }
> type DocumentContent = AbstractDocumentContent<string> | AbstractDocumentContent<Tag>
> ```
> it's still a little finicky, but should work? I'm open to pushback always, but this is how I'm thinking about it.

---

## PR #42: Accept empty transform object

**Status:** OPEN
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/42
**Author:** @lefant (Fabian Linzberger)
**Created:** 2026-01-26
**Branch:** fix/empty-transform → main

### Bug Description

The reMarkable API returns an empty transform object `{}` for some documents, but the schema requires all 9 matrix properties (m11-m33) when the transform field is present.

**Rationale from PR description:**
> A 3×3 transform matrix is only meaningful when all 9 entries are present; missing any entries makes the transform undefined (you can't reliably scale/rotate/translate or invert it). There's no code or schema defaults here that define how to interpret missing keys, so partial matrices would introduce ambiguous/invalid states. An empty object, by contrast, clearly means "no transform," which is equivalent to the field being absent.

**Error:**
```
Validation error: transform object is missing required matrix properties
```

### API Response

```json
{
  "fileType": "pdf",
  "transform": {}
}
```

### Test Added

**File:** `src/index.spec.ts` (lines +325 to +352)

```typescript
test("handles empty transform object", async () => {
  const realHash = repHash("1");
  const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;
  const content = {
    fileType: "pdf",
    coverPageNumber: -1,
    documentMetadata: {},
    extraMetadata: {},
    fontName: "",
    lineHeight: -1,
    orientation: "portrait",
    pageCount: 1,
    sizeInBytes: "1",
    textAlignment: "left",
    textScale: 1,
    transform: {},
  } as unknown as DocumentContent;
  mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

  const api = await remarkable("");
  const cont = (await api.getContent(repHash("0"))) as DocumentContent;
  expect(cont.fileType).toBe("pdf");
  expect(cont.transform ?? {}).toEqual({});
});
```

### Code Fix

**File:** `src/raw.ts` (lines +1076 to +1099)

```typescript
async getContent(hash: string): Promise<Content> {
  const raw = await this.getText(hash);
  const loaded = JSON.parse(raw) as unknown;

  // Normalize empty transform object before validation
  // reMarkable API returns transform: {} for some documents, but schema requires
  // all matrix properties (m11-m33) when transform is present
  if (
    loaded &&
    typeof loaded === "object" &&
    "fileType" in loaded &&
    "transform" in loaded
  ) {
    const doc = loaded as { transform?: unknown };
    const transform = doc.transform;
    if (
      transform &&
      typeof transform === "object" &&
      !Array.isArray(transform)
    ) {
      const proto = Object.getPrototypeOf(transform);
      if (
        (proto === Object.prototype || proto === null) &&
        Object.keys(transform).length === 0
      ) {
        delete doc.transform;
      }
    }
  }

  // ... continue with validation
}
```

### Maintainer Comments

**@erikbrinkman** (Review - CHANGES_REQUESTED, 2026-02-01):

> So, I think this change is _reasonable_, but I don't love it. In general, my goal for the api is to reflect what is there, not some idealized api. Instead of normalizing, I'd prefer to just have this be the union of both, e.g. `Record<m11, number> | {}`. However, typescript types don't always behave the way you might expect, and a better way to type the empty object in this case might be `Record<\`m${"1" | "2" | "3"}${"1" | "2" | "3"}\`, never>`, e.g. those keys will never have a value, and we make no claims about anything else. The problem with doing it this way is two-fold. 1. that's a pretty weird type, and 2. that type isn't really representable in jtd, so automatic checking isn't that great.
>
> With that said, my preferred type might be to just change the transform type to be one of these:
> ```ts
> type TransformKeys = `m${1 | 2 | 3}${1 | 2 | 3}`;
> type Transform1 = Partial<Record<TransformKeys, number>>;
> type Transform2 = {[K in TransformKeys]?: number};
> ```
> This isn't technically accurate, per your statement that it's actually all or none, but since typescript doesn't have a great way to represent that, I think this is sufficient, and then only requires a modest change to the jtd type rather than manipulating the server result.
>
> Additionally, while it's true that the object will be all or nothing, there's no good way to guard against that in typescript, so it representing it accurately doesn't really save much time.

---

## PR #41: Accept larger metadata version field

**Status:** MERGED (2026-01-24)
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/41
**Author:** @lefant (Fabian Linzberger)
**Branch:** fix/metadata-version-uint32 → main
**Released:** v9.0.2

### Bug Description (Issue #40)

The validation schema restricted the metadata `version` field to `uint8` (0-255), but the reMarkable API returns larger values for frequently modified documents.

**Error:**
```
Validation errors:
.version: 979 is greater than 255
```

### API Response

```json
{
  "createdTime": "0",
  "deleted": false,
  "lastModified": "1768854191996",
  "lastOpened": "1768853776749",
  "lastOpenedPage": 1,
  "metadatamodified": true,
  "modified": true,
  "new": false,
  "parent": "",
  "pinned": true,
  "source": "",
  "synced": true,
  "type": "DocumentType",
  "version": 979,
  "visibleName": "Notebook"
}
```

### Test Added

No explicit test was added for this fix (it's a simple type change).

### Code Fix

**File:** `src/raw.ts` (line 641)

**Before:**
```typescript
const metadata = properties(
  {
    // ...
    version: uint8(),  // 0-255
  },
  // ...
);
```

**After:**
```typescript
const metadata = properties(
  {
    // ...
    version: uint32(),  // 0-4,294,967,295
  },
  // ...
);
```

### Maintainer Comments

**@erikbrinkman** (2026-01-24):
> patched in 9.0.2

---

## PR #39: Nullable cPages.uuid

**Status:** MERGED (2026-01-10)
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/39
**Author:** @lefant (Fabian Linzberger)
**Branch:** cpages-uuids-null → main
**Released:** v9.0.1

### Bug Description (Issue #38)

The validation schema expected `cPages.uuids` to always be an array, but the reMarkable API returns `null` for this field in older notebooks or certain document states.

**Error:**
```
invalid content: Couldn't validate as document because:
  Validation errors: .cPages.uuids: null is not an array
```

### API Response

```json
{
  "fileType": "notebook",
  "cPages": {
    "lastOpened": { "value": "2024-06-28T12:07:33.000Z" },
    "original": { "value": 1 },
    "pages": [
      { "id": "page-uuid", "idx": { "value": "aa" } }
    ],
    "uuids": null
  }
}
```

### Test Added

No explicit test was added (schema change only).

### Code Fix

**File:** `src/raw.ts` (lines 279, 301-310)

**TypeScript Interface Change:**
```typescript
export interface CPages {
  /** [speculative] information about individual pages */
  pages: CPagePage[];
  /** [unknown] */
  uuids: CPageUUID[] | null;  // Added "| null"
}
```

**Schema Change:**
```typescript
const cPages = properties(
  {
    // ...
    uuids: nullable(  // Wrapped in nullable()
      elements(
        properties(
          {
            first: string(),
            second: uint32(),
          },
          undefined,
          true,
        ),
      ),
    ),
  },
  // ...
);
```

### Maintainer Comments

**@erikbrinkman** (2026-01-11):
> this is now released in v9.0.1

---

## PR #36: More validation schema fixes - pages null, textAlignment ""

**Status:** MERGED (2025-10-29)
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/36
**Author:** @lefant (Fabian Linzberger)
**Branch:** unopened-validation → main

### Bug Description

Documents uploaded but never opened (e.g., from the reMarkable browser extension) return unexpected values:
- `pages`: null instead of array
- `textAlignment`: empty string "" instead of "justify" or "left"

**Context from PR:**
> ran into some of those when listing files for a remarkable account which had a bunch of read it later documents from the remarkable browser extension.
>
> first error message was saying that the item had extra fields unexpected for a collection

**Error:**
```
Validation errors:
.pages: null is not an array
.textAlignment: "" is not one of ["justify", "left"]
```

### API Response

```json
{
  "fileType": "pdf",
  "coverPageNumber": -1,
  "documentMetadata": {},
  "extraMetadata": {},
  "fontName": "",
  "lineHeight": -1,
  "orientation": "portrait",
  "pageCount": 0,
  "pages": null,
  "sizeInBytes": "",
  "textAlignment": "",
  "textScale": 1
}
```

### Test Added

**File:** `src/index.spec.ts` (lines +257 to +283)

```typescript
test("handles empty textAlignment and null pages", async () => {
  const realHash = repHash("1");
  const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;
  const content: DocumentContent = {
    fileType: "pdf",
    coverPageNumber: -1,
    documentMetadata: {},
    extraMetadata: {},
    fontName: "",
    lineHeight: -1,
    orientation: "portrait",
    pageCount: 0,
    pages: null,
    sizeInBytes: "",
    textAlignment: "",
    textScale: 1,
  };
  mockFetch(emptyResponse(), textResponse(file), jsonResponse(content));

  const api = await remarkable("");
  const cont = (await api.getContent(repHash("0"))) as DocumentContent;
  expect(cont).toEqual(content);
});
```

### Code Fix

**File:** `src/raw.ts` (multiple changes)

**1. TextAlignment type and enum:**

```typescript
// Line 123
export type TextAlignment = "" | "justify" | "left";  // Added ""

// Line 462
textAlignment: enumeration("", "justify", "left"),  // Added ""
```

**2. Pages field made nullable:**

```typescript
// Line 385 (interface)
export interface DocumentContent {
  // ...
  /** a list of the ids of each page in the document, or null when never opened */
  pages?: string[] | null;  // Added "| null"
  // ...
}

// Line 486 (schema)
pages: nullable(elements(string())),  // Wrapped in nullable()
```

### Maintainer Comments

**@erikbrinkman** (2025-10-24):

On normalization approach:
> instead of trying to normalize here, I'd rather just change the definition to indicate that pages can be null, and textAlignment can be the empty string

On comments in code:
> I'd remove these comments as they reference the current state of the code, but not the desired outcome.

On test file structure:
> I don't think this is specific to unopened documents, but just a quirk of different writing. As a result, can you just make this one more test in the general test suite rather than make it it's own file.

On test name:
> I would make this more descriptive, something like: handles empty textAlignment and null pages.

On discriminated unions approach (contributor wanted to check fileType first):
> the error should have printed all the validation failures, collection was probably at the top because of the order. You don't need to test for the template, because document still requires fileType to be present, the original code will still work, and I prefer explicitly validating against their schemas, rather than having an additional adhoc check.

---

## PR #32: lastOpenedPage validation should allow -1

**Status:** MERGED (2025-10-20)
**URL:** https://github.com/erikbrinkman/rmapi-js/pull/32
**Author:** @lefant (Fabian Linzberger)
**Branch:** lastOpenedPage-validation → main

### Bug Description (Issue #31)

The `lastOpenedPage` field was validated as `uint32` (0 or greater), but the reMarkable API returns `-1` as a sentinel value for documents that haven't been opened yet or documents in trash.

**Error:**
```
Validation errors:
.lastOpenedPage: -1 is less than 0
```

### API Response

```json
{
  "createdTime": "1758719190892",
  "lastModified": "1758835617276",
  "lastOpened": "1758822988306",
  "lastOpenedPage": -1,
  "new": false,
  "parent": "b037f741-b214-4d42-bda4-e4c92f14f2bf",
  "pinned": false,
  "source": "",
  "type": "DocumentType",
  "visibleName": "Film"
}
```

**Context from Issue #31:**
> This affects:
> - `api.listItems()` - fails when any item has `lastOpenedPage: -1`
> - `api.getMetadata(hash)` - fails when the specific item has `lastOpenedPage: -1`
>
> Documents in the trash folder seem particularly prone to having `lastOpenedPage: -1`.
>
> This validation error makes it impossible to list or access metadata for any reMarkable account that has documents with `lastOpenedPage: -1`, which appears to be a common occurrence in normal usage.

### Test Added

**File:** `src/index.spec.ts` (lines +176 to +197)

```typescript
test("#getMetadata() accepts lastOpenedPage -1", async () => {
  const realHash = repHash("1");
  const file = `3
hash:0:doc.content:0:1
${realHash}:0:doc.metadata:0:1
hash:0:doc.epub:0:1
hash:0:doc.pdf:0:1
`;
  const metadata: Metadata = {
    lastModified: "0",
    visibleName: "name",
    parent: "",
    type: "DocumentType",
    pinned: false,
    lastOpenedPage: -1,
  };
  mockFetch(emptyResponse(), textResponse(file), jsonResponse(metadata));

  const api = await remarkable("");
  const meta = await api.getMetadata(repHash("0"));
  expect(meta).toEqual(metadata);
});
```

### Code Fix

**File:** `src/raw.ts` (lines 482, 630)

Changed two locations where `lastOpenedPage` was validated:

**1. DocumentContent schema:**
```typescript
const documentContent = properties(
  {
    // ...
    lastOpenedPage: int32(),  // Changed from uint32()
    // ...
  },
  // ...
);
```

**2. Metadata schema:**
```typescript
const metadata = properties(
  {
    // ...
  },
  {
    lastOpened: string(),
    lastOpenedPage: int32(),  // Changed from uint32()
    // ...
  },
  // ...
);
```

### Maintainer Comments

**@erikbrinkman** (2025-10-09) - Code review:

On test additions to existing test:
> these lines are meant to be minimal, so I wouldn't add the test here

On inline comments explaining the -1 sentinel:
> this comment is unnecessary
> as is this comment

On comment in test:
> this comment is specified in the test title, so it's also unnecessary

**@lefant** (2025-10-20):
> sorry for being a bit slow about the simple requests (first i missed the notifications and last week i was sick). all should be fixed now.

**@erikbrinkman** (2025-10-20):
> Great! Thanks for the fix! Is this blocking you, i.e. do you want me to release a patch to npm, or will working of this be sufficient until there are more changes?

**@lefant** (2025-10-20):
> @erikbrinkman i have a little vendor copy of my own changes in my repo already, so no rush.

---

## Summary Pattern Analysis

### Common Theme

All six PRs address **validation schema mismatches** between:
- The **actual reMarkable Cloud API responses** (which vary based on document age, state, and user actions)
- The **rmapi-js validation schemas** (which were initially too strict)

### Root Causes

1. **Legacy format support needed**: The API evolved over time but still returns old formats (e.g., string tags vs. object tags)
2. **Sentinel values**: The API uses special values like `-1`, `null`, `""` to indicate "not set" or "default" states
3. **Optional/incomplete data**: Documents in certain states (never opened, trash, browser extension uploads) have incomplete or null fields
4. **Schema assumptions**: Initial schemas assumed consistent format, but real-world API responses vary

### Fix Patterns

1. **Type relaxation**: `uint8()` → `uint32()`, `uint32()` → `int32()`
2. **Nullable wrappers**: `field: type` → `field: nullable(type)`
3. **Enum expansion**: `enumeration("a", "b")` → `enumeration("", "a", "b")`
4. **Runtime normalization**: Transform legacy formats to current format before validation

### Maintainer Preferences (from reviews)

1. **Reflect the API as-is, don't normalize** - The maintainer's goal is to reflect what the API returns, not an idealized version. Normalization should happen in higher-level APIs, not at load time.
2. **Use union types for variant formats** - When the API returns different formats (e.g., `string[] | Tag[]`), prefer representing both types rather than transforming to one
3. **Try multiple parsers pattern** - For variant types that JTD can't handle, try each parser and accept if any passes
4. **Prefer schema changes over runtime manipulation** - Adjust the JTD schema/types rather than manipulating server results
5. **Minimal comments** - only add if truly clarifying
6. **Test names should be descriptive** - avoid generic names
7. **Tests should be minimal** - only test the specific edge case
8. **No redundant tests** - don't add edge cases to existing "happy path" tests
9. **Trust existing validation approach** - avoid adding ad-hoc discrimination logic

### Testing Pattern

All PRs follow a consistent test pattern:
1. Mock the API response with the problematic format
2. Call the relevant API method
3. Assert the result matches expected (normalized) format

### Impact

These fixes enable rmapi-js to handle real-world reMarkable accounts with:
- Long-lived notebooks (high version numbers)
- Legacy documents with old tag formats
- Unopened/never-viewed documents
- Documents in trash
- Browser extension uploads
- Old notebooks with incomplete metadata
