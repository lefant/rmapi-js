# rmapi-js Document Content Validation Issue

**Date:** 2026-02-03
**Related Sentry Issue:** ALTEGO-APP-14
**Beads Issue:** alt-949

## Summary

The `getContent()` method in `src/raw.ts` fails to validate certain epub documents returned by the reMarkable Cloud API. The API returns document content that doesn't match the strict schema.

## Error Message

```
Error: invalid content: Couldn't validate as collection because:
Validation errors:
.dummyDocument: 'dummyDocument' is not a valid property and additional properties are not allowed
.extraMetadata: 'extraMetadata' is not a valid property and additional properties are not allowed
.fileType: 'fileType' is not a valid property and additional properties are not allowed
... (more properties)

Couldn't validate as document because:
Validation errors:
.: required key 'coverPageNumber' is missing
.: required key 'documentMetadata' is missing
.orientation:  is not one of portrait, landscape
.: required key 'sizeInBytes' is missing
.: required key 'textAlignment' is missing
.pageTags: null is not an array
.redirectionPageMap: null is not an array
```

## Problematic API Response

The reMarkable Cloud API returns this document content:

```json
{
  "dummyDocument": false,
  "extraMetadata": {
    "LastBrushColor": "",
    "LastBrushThicknessScale": "",
    "LastColor": "",
    "LastEraserThicknessScale": "",
    "LastEraserTool": "",
    "LastPen": "Finelinerv2",
    "LastPenColor": "",
    "LastPenThicknessScale": "",
    "LastPencil": "",
    "LastPencilColor": "",
    "LastPencilThicknessScale": "",
    "LastTool": "Finelinerv2",
    "ThicknessScale": "",
    "LastFinelinerv2Size": "1"
  },
  "fileType": "epub",
  "fontName": "",
  "lastOpenedPage": 0,
  "lineHeight": -1,
  "margins": 180,
  "orientation": "",
  "pageCount": 0,
  "pages": null,
  "pageTags": null,
  "redirectionPageMap": null,
  "textScale": 1,
  "transform": {
    "m11": 1,
    "m12": 0,
    "m13": 0,
    "m21": 0,
    "m22": 1,
    "m23": 0,
    "m31": 0,
    "m32": 0,
    "m33": 1
  }
}
```

## Schema Issues

### 1. Missing Required Fields

The `documentContent` schema requires these fields, but the API doesn't always provide them:

| Field | Schema | API Response |
|-------|--------|--------------|
| `coverPageNumber` | required `int32()` | MISSING |
| `documentMetadata` | required object | MISSING |
| `sizeInBytes` | required `string()` | MISSING |
| `textAlignment` | required enum | MISSING |

**Fix:** Move these fields from required to optional properties.

### 2. Empty String Not Allowed for `orientation`

```typescript
// Current (line 463):
orientation: enumeration("portrait", "landscape"),

// Fix: Add empty string to enum
orientation: enumeration("", "portrait", "landscape"),
```

The API returns `"orientation": ""` but the schema only accepts `"portrait"` or `"landscape"`.

### 3. `null` vs Array for Optional Fields

```typescript
// Current (lines 491-492):
pageTags: elements(pageTag),
redirectionPageMap: elements(int32()),

// Fix: Make nullable
pageTags: nullable(elements(pageTag)),
redirectionPageMap: nullable(elements(int32())),
```

The API returns `"pageTags": null` and `"redirectionPageMap": null`, but the schema expects arrays (or undefined).

## Proposed Fix

In `src/raw.ts`, modify the `documentContent` schema:

```typescript
const documentContent = properties(
  {
    // Move these to optional:
    // coverPageNumber: int32(),
    // documentMetadata,
    // sizeInBytes: string(),
    // textAlignment: enumeration("", "justify", "left"),

    // Keep these required:
    extraMetadata: values(string()),
    fileType: enumeration("epub", "notebook", "pdf"),
    fontName: string(),
    lineHeight: int32(),
    orientation: enumeration("", "portrait", "landscape"),  // Add ""
    pageCount: uint32(),
    textScale: float64(),
  },
  {
    // Move from required to optional:
    coverPageNumber: int32(),
    documentMetadata,
    sizeInBytes: string(),
    textAlignment: enumeration("", "justify", "left"),

    // Existing optional fields...
    cPages,
    customZoomCenterX: float64(),
    // ...

    // Make nullable instead of just optional array:
    pageTags: nullable(elements(pageTag)),
    redirectionPageMap: nullable(elements(int32())),
    // ...
  },
  true,
);
```

## TypeScript Interface Updates

The `DocumentContent` interface also needs updating to reflect optional fields:

```typescript
export interface DocumentContent {
  // These should be optional:
  coverPageNumber?: number;
  documentMetadata?: DocumentMetadata;
  sizeInBytes?: string;
  textAlignment?: TextAlignment;

  // orientation enum should include empty string:
  orientation: "" | Orientation;

  // These can be null:
  pageTags?: PageTag[] | null;
  redirectionPageMap?: number[] | null;

  // ... rest unchanged
}
```

## Testing

To reproduce:
1. This occurs with real reMarkable Cloud data for certain epub files
2. The exact document causing the issue has these characteristics:
   - `fileType: "epub"`
   - Missing `coverPageNumber`, `documentMetadata`, `sizeInBytes`, `textAlignment`
   - `orientation: ""` (empty string)
   - `pageTags: null` and `redirectionPageMap: null`

## Related Issues

This is similar to previously patched issues:
- Version field validation (uint8 → uint32)
- Empty transform object validation
- Legacy tags format (string array → object array)

See: `vendor/rmapi-js-build/README.md` in altego-app for previous patch documentation.
