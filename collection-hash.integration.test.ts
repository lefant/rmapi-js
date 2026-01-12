import { beforeAll, afterAll, describe, test } from "bun:test";
import {
  auth,
  session,
  type RemarkableApi,
  type RemarkableOptions,
} from "./src/index";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isUserTokenValid, parseUserTokenExpiration } from "./cloud/jwt-utils";

interface IntegrationConfig {
  deviceToken?: string;
  sessionToken?: string;
  sessionTokenExpiresAt?: string;
}

interface RootSnapshot {
  hash: string;
  generation: number;
  schemaVersion: number;
}

type TokenSource = "env" | "config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;
const defaultConfigPath = path.join(repoRoot, ".rmapi-js-integration.json");
const configPath = process.env["RM_SMOKE_CONFIG"]
  ? path.resolve(process.env["RM_SMOKE_CONFIG"] as string)
  : defaultConfigPath;

let configLoadError: string | undefined;
const cachedConfig = await (async (): Promise<IntegrationConfig | undefined> => {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw) as IntegrationConfig;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      configLoadError = err.message;
    }
  }
  return undefined;
})();

const cachedConfigToken = cachedConfig?.deviceToken?.trim();
const cachedSessionToken = cachedConfig?.sessionToken?.trim();
const cachedSessionTokenExpiresAt =
  cachedConfig?.sessionTokenExpiresAt?.trim();

const envDeviceToken = process.env["RM_DEVICE_TOKEN"]?.trim();
const deviceTokenCandidate = envDeviceToken ?? cachedConfigToken;
const tokenSource: TokenSource | undefined = envDeviceToken
  ? "env"
  : cachedConfigToken
    ? "config"
    : undefined;
const shouldRun = Boolean(deviceTokenCandidate);
const runDestructive =
  shouldRun && process.env["RM_RUN_DESTRUCTIVE"] === "1" ? true : false;

if (!shouldRun) {
  console.warn(
    "[collection-hash] Skipping live integration tests. Set RM_DEVICE_TOKEN or create",
    configPath,
    "with a deviceToken field.",
  );
  if (configLoadError) {
    console.warn("[collection-hash] Config load error:", configLoadError);
  }
}

const describeIf = shouldRun ? describe : describe.skip;
const destructiveTest = runDestructive ? test : test.skip;

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : "";
}

class LiveContext {
  readonly logPath: string;
  readonly deviceToken: string;
  readonly tokenSource: TokenSource;
  readonly configPath: string;
  readonly opts: RemarkableOptions;
  readonly destructive: boolean;
  readonly cachedSessionToken?: string;
  readonly cachedSessionTokenExpiresAt?: string;
  api!: RemarkableApi;
  rootInitial!: RootSnapshot;
  rootCurrent!: RootSnapshot;
  private logInitialized = false;

  constructor(params: {
    deviceToken: string;
    tokenSource: TokenSource;
    configPath: string;
    opts: RemarkableOptions;
    logPath: string;
    destructive: boolean;
    cachedSessionToken?: string;
    cachedSessionTokenExpiresAt?: string;
  }) {
    this.deviceToken = params.deviceToken;
    this.tokenSource = params.tokenSource;
    this.configPath = params.configPath;
    this.opts = params.opts;
    this.logPath = params.logPath;
    this.destructive = params.destructive;
    this.cachedSessionToken = params.cachedSessionToken;
    this.cachedSessionTokenExpiresAt = params.cachedSessionTokenExpiresAt;
  }

  async init(): Promise<void> {
    await this.#ensureLogFile();
    await this.log("init.context", {
      tokenSource: this.tokenSource,
      configPath: this.configPath,
      logPath: this.logPath,
      destructive: this.destructive,
    });
    await this.log("init.remarkable.start");
    const sessionToken = await this.#resolveSessionToken();
    this.api = session(sessionToken, this.opts);
    await this.log("init.remarkable.ok");
    const snapshot = await this.#loadRootSnapshot();
    this.rootInitial = snapshot;
    this.rootCurrent = snapshot;
    await this.log("rootHash.fetch.ok", {
      rootHash: snapshot.hash,
      generation: snapshot.generation,
      schemaVersion: snapshot.schemaVersion,
    });
  }

  async teardown(): Promise<void> {
    if (process.env["RM_SKIP_RESTORE"] !== "1") {
      await this.restoreToBackup();
    }
    await this.log("teardown.complete");
  }

  async log(step: string, details?: Record<string, unknown>): Promise<void> {
    const entry = details
      ? { time: new Date().toISOString(), step, ...details }
      : { time: new Date().toISOString(), step };
    const line = JSON.stringify(entry);
    console.log(line);
    await fs.appendFile(this.logPath, `${line}\n`, "utf8");
  }

  async captureRoot(): Promise<RootSnapshot> {
    const snapshot = await this.#loadRootSnapshot();
    this.rootCurrent = snapshot;
    await this.log("rootHash.refresh", {
      rootHash: snapshot.hash,
      generation: snapshot.generation,
      schemaVersion: snapshot.schemaVersion,
    });
    return snapshot;
  }

  async restoreToBackup(): Promise<void> {
    if (!this.api || !this.rootInitial) return;
    const current = await this.#loadRootSnapshot();
    if (current.hash === this.rootInitial.hash) {
      return;
    }
    await this.log("rootHash.restore.start", {
      from: shortHash(current.hash),
      to: shortHash(this.rootInitial.hash),
      currentGeneration: current.generation,
    });
    const [, restoredGen] = await this.api.raw.putRootHash(
      this.rootInitial.hash,
      current.generation,
    );
    this.rootCurrent = {
      hash: this.rootInitial.hash,
      generation: restoredGen,
      schemaVersion: current.schemaVersion,
    };
    await this.log("rootHash.restore.ok", {
      generation: restoredGen,
      schemaVersion: current.schemaVersion,
    });
  }

  async #loadRootSnapshot(): Promise<RootSnapshot> {
    const tuple = (await this.api.raw.getRootHash()) as
      | readonly [string, number]
      | readonly [string, number, number];
    const [hash, generation] = tuple;
    const schemaVersion = tuple.length > 2 ? tuple[2]! : 3;
    return { hash, generation, schemaVersion };
  }

  async #ensureLogFile(): Promise<void> {
    if (this.logInitialized) return;
    await fs.writeFile(this.logPath, "", { flag: "a" });
    this.logInitialized = true;
  }

  async #resolveSessionToken(): Promise<string> {
    const cachedToken = this.cachedSessionToken;
    const cachedExpiresAt = this.cachedSessionTokenExpiresAt;
    if (cachedToken && isUserTokenValid(cachedToken, 30)) {
      await this.log("sessionToken.cache.hit", {
        tokenSource: this.tokenSource,
        expiresAt: cachedExpiresAt,
      });
      return cachedToken;
    }

    await this.log("sessionToken.cache.miss");
    const freshToken = await auth(this.deviceToken, this.opts);
    const expiresAt = parseUserTokenExpiration(freshToken);
    await persistSessionToken(this.configPath, freshToken, expiresAt);
    await this.log("sessionToken.cache.store", {
      expiresAt: expiresAt?.toISOString(),
    });
    return freshToken;
  }
}

const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(
  repoRoot,
  `collection-hash-integration-${logTimestamp}.jsonl`,
);

describeIf("collection hash integration", () => {
  let ctx: LiveContext;

  beforeAll(async () => {
    if (!deviceTokenCandidate || !tokenSource) {
      throw new Error("integration tests misconfigured: missing device token");
    }
    ctx = new LiveContext({
      deviceToken: deviceTokenCandidate,
      tokenSource,
      configPath,
      opts: {
        authHost: process.env["RM_AUTH_HOST"] || undefined,
        rawHost: process.env["RM_RAW_HOST"] || undefined,
        uploadHost: process.env["RM_UPLOAD_HOST"] || undefined,
      },
      logPath,
      destructive: runDestructive,
      cachedSessionToken,
      cachedSessionTokenExpiresAt,
    });
    await ctx.init();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  destructiveTest(
    "collection hash changes for nested documents",
    { timeout: 60000 },
    async () => {
      const rootDirName = "RmapiDevelopment";
      const parentName = "collection_1";
      const childName = "collection_2";
      const docName = "document_1";
      const subDocName = "document_2";
      const pdfBytes = new TextEncoder().encode(
        "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj<<>>endobj\n2 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
      );

    let parent: { id: string; hash: string } | undefined;
    let child: { id: string; hash: string } | undefined;
    let doc: { id: string; hash: string } | undefined;
    let subDoc: { id: string; hash: string } | undefined;
    let rootDir: { id: string; hash: string } | undefined;

    const snapshots: Array<{
      step: string;
      rootHash: string;
      hashes: Record<string, string | null>;
    }> = [];

    const capture = async (
      step: string,
      ids: Array<{ label: string; id: string | undefined }>,
    ): Promise<void> => {
      const root = await ctx.captureRoot();
      const items = await ctx.api.listItems(true);
      const hashes: Record<string, string | null> = {};
      for (const { label, id } of ids) {
        if (!id) {
          hashes[label] = null;
          continue;
        }
        const entry = items.find((item) => item.id === id);
        hashes[label] = entry?.hash ?? null;
      }
      snapshots.push({ step, rootHash: root.hash, hashes });
      await ctx.log(step, {
        rootHash: shortHash(root.hash),
        entries: Object.fromEntries(
          Object.entries(hashes).map(([label, hash]) => [
            label,
            hash ? shortHash(hash) : null,
          ]),
        ),
      });
    };

    try {
      rootDir = await ensureRootDirectory(ctx.api, rootDirName, ctx);
      parent = await ctx.api.putFolder(parentName, { parent: rootDir.id });
      await capture("collection-hash.parent.created", [
        { label: "rootDir", id: rootDir.id },
        { label: "parent", id: parent.id },
      ]);

      doc = await ctx.api.putPdf(docName, pdfBytes, { parent: parent.id });
      await capture("collection-hash.doc.added", [
        { label: "rootDir", id: rootDir.id },
        { label: "parent", id: parent.id },
        { label: "doc", id: doc.id },
      ]);

      const renamed = await ctx.api.rename(
        doc.hash,
        `${docName} (renamed)`,
      );
      doc = { ...doc, hash: renamed.hash };
      await capture("collection-hash.doc.updated", [
        { label: "rootDir", id: rootDir.id },
        { label: "parent", id: parent.id },
        { label: "doc", id: doc.id },
      ]);

      child = await ctx.api.putFolder(childName, { parent: parent.id });
      subDoc = await ctx.api.putPdf(subDocName, pdfBytes, {
        parent: child.id,
      });
      await capture("collection-hash.subdoc.added", [
        { label: "rootDir", id: rootDir.id },
        { label: "parent", id: parent.id },
        { label: "child", id: child.id },
        { label: "subDoc", id: subDoc.id },
      ]);

      const subRenamed = await ctx.api.rename(
        subDoc.hash,
        `${subDocName} (renamed)`,
      );
      subDoc = { ...subDoc, hash: subRenamed.hash };
      await capture("collection-hash.subdoc.updated", [
        { label: "rootDir", id: rootDir.id },
        { label: "parent", id: parent.id },
        { label: "child", id: child.id },
        { label: "subDoc", id: subDoc.id },
      ]);
      emitMarkdownReport(snapshots);
    } finally {
      if (process.env["RM_SKIP_RESTORE"] !== "1") {
        await ctx.restoreToBackup();
      }
    }
  },
  );
});

function emitMarkdownReport(
  snapshots: Array<{
    step: string;
    rootHash: string;
    hashes: Record<string, string | null>;
  }>,
): void {
  if (snapshots.length === 0) return;
  const rows: string[] = [];
  rows.push("| Step | Root | Root dir | Parent dir | Child dir |");
  rows.push("| --- | --- | --- | --- | --- |");
  for (let i = 0; i < snapshots.length; i += 1) {
    const current = snapshots[i]!;
    const prev = snapshots[i - 1];
    const rootChanged = prev ? prev.rootHash !== current.rootHash : null;
    const rootDirChanged =
      prev?.hashes["rootDir"] !== undefined
        ? prev.hashes["rootDir"] !== current.hashes["rootDir"]
        : null;
    const parentChanged =
      prev?.hashes["parent"] !== undefined
        ? prev.hashes["parent"] !== current.hashes["parent"]
        : null;
    const childChanged =
      prev?.hashes["child"] !== undefined
        ? prev.hashes["child"] !== current.hashes["child"]
        : null;
    rows.push(
      `| ${current.step} | ${formatChange(rootChanged)} | ${formatChange(
        rootDirChanged,
      )} | ${formatChange(parentChanged)} | ${formatChange(childChanged)} |`,
    );
  }

  const markdown = [
    "",
    "Collection Hash Change Report",
    "",
    ...rows,
    "",
  ].join("\n");
  console.log(markdown);
}

function formatChange(changed: boolean | null): string {
  if (changed === null) return "n/a";
  return changed ? "changed" : "unchanged";
}

async function ensureRootDirectory(
  api: RemarkableApi,
  name: string,
  ctx: LiveContext,
): Promise<{ id: string; hash: string }> {
  await ctx.log("rootDir.lookup.start", { name });
  const items = await withTimeout(
    "rootDir.lookup.listItems",
    30000,
    withRetry(
      "rootDir.lookup.listItems",
      () => api.listItems(true),
      ctx,
    ),
    ctx,
  );
  await ctx.log("rootDir.lookup.items", { count: items.length });
  const existing = items.find(
    (item) =>
      item.type === "CollectionType" &&
      item.parent === "" &&
      item.visibleName === name,
  );
  if (existing) {
    await ctx.log("rootDir.reuse", {
      id: existing.id,
      hash: shortHash(existing.hash),
      name,
    });
    return { id: existing.id, hash: existing.hash };
  }

  await ctx.log("rootDir.create.start", { name });
  const created = await withTimeout(
    "rootDir.create.putFolder",
    30000,
    withRetry(
      "rootDir.create.putFolder",
      () => api.putFolder(name),
      ctx,
    ),
    ctx,
  );
  await ctx.log("rootDir.create", {
    id: created.id,
    hash: shortHash(created.hash),
    name,
  });
  return created;
}

async function withTimeout<T>(
  step: string,
  timeoutMs: number,
  promise: Promise<T>,
  ctx: LiveContext,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${step} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    await ctx.log("timeout.error", {
      step,
      error: (error as Error).message,
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(
  step: string,
  fn: () => Promise<T>,
  ctx: LiveContext,
  attempts: number = 3,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) {
        await ctx.log("retry.attempt", { step, attempt });
      }
      return await fn();
    } catch (error) {
      const err = error as Error;
      lastError = err;
      const message = err.message || "";
      const isTransient =
        message.includes("socket connection was closed unexpectedly") ||
        message.includes("ECONNRESET");
      await ctx.log("retry.error", {
        step,
        attempt,
        error: message,
        transient: isTransient,
      });
      if (!isTransient || attempt === attempts) {
        break;
      }
      const delay = baseDelayMs * attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError ?? new Error(`${step} failed after ${attempts} attempts`);
}

async function persistSessionToken(
  configPath: string,
  sessionToken: string,
  expiresAt: Date | null,
): Promise<void> {
  let config: IntegrationConfig = {};
  try {
    const raw = await fs.readFile(configPath, "utf8");
    config = JSON.parse(raw) as IntegrationConfig;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      console.warn(
        "[collection-hash] Failed to read config before persisting:",
        err,
      );
    }
  }

  config.sessionToken = sessionToken;
  config.sessionTokenExpiresAt = expiresAt?.toISOString();
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
