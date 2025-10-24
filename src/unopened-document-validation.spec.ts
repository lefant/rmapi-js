import { describe, it, expect } from "bun:test";
import { remarkable, type DocumentContent } from ".";
import {
  emptyResponse,
  jsonResponse,
  mockFetch,
  textResponse,
} from "./test-utils";

function repHash(hash: string): string {
  const mult = 64 / hash.length;
  return new Array(mult).fill(hash).join("");
}

describe("Unopened document validation", () => {
  /**
   * Minimal unopened document structure that affects ALL file types
   * (EPUB, PDF, notebook) on both V3 and V4 accounts.
   */
  const minimalUnopenedDocument = {
    coverPageNumber: -1,
    documentMetadata: {},
    extraMetadata: {},
    fileType: "pdf", // Any file type exhibits this pattern
    fontName: "",
    lineHeight: -1,
    orientation: "portrait",
    pageCount: 0,
    sizeInBytes: "",
    textAlignment: "", // ❌ PROBLEM 1: empty string not in enum("justify", "left")
    textScale: 1,
    pages: null, // ❌ PROBLEM 2: null not accepted (expects array or undefined)
  };

  it("should accept unopened document with empty textAlignment and null pages", async () => {
    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;

    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(minimalUnopenedDocument),
    );

    const api = await remarkable("");

    // After fix: This should succeed
    const content = await api.getContent(repHash("0")) as DocumentContent;
    expect(content.fileType).toBe("pdf");
    expect(content.pageCount).toBe(0);
  });

  it("should handle textAlignment empty string by normalizing to justify", async () => {
    const docWithEmptyTextAlignment = {
      ...minimalUnopenedDocument,
      pages: [], // Valid array to isolate textAlignment issue
    };

    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;

    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(docWithEmptyTextAlignment),
    );

    const api = await remarkable("");

    const content = await api.getContent(repHash("0")) as DocumentContent;
    // Empty textAlignment normalized to "justify"
    expect(content.textAlignment).toBe("justify");
  });

  it("should handle null pages by normalizing to empty array", async () => {
    const docWithNullPages = {
      ...minimalUnopenedDocument,
      textAlignment: "justify", // Valid value to isolate pages issue
    };

    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;

    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(docWithNullPages),
    );

    const api = await remarkable("");

    const content = await api.getContent(repHash("0")) as DocumentContent;
    // null pages normalized to empty array
    expect(content.pages).toEqual([]);
  });

  it("should use fileType discriminator to avoid misleading collection errors", async () => {
    const realHash = repHash("1");
    const file = `3
${realHash}:0:doc.content:0:1
hash:0:doc.metadata:0:1
hash:0:doc.pdf:0:1
`;

    mockFetch(
      emptyResponse(),
      textResponse(file),
      jsonResponse(minimalUnopenedDocument),
    );

    const api = await remarkable("");

    // After fix: Should validate as document (not try collection first)
    // Error messages should be clear about document validation only
    const content = await api.getContent(repHash("0")) as DocumentContent;
    expect(content.fileType).toBe("pdf");
  });
});
