import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type {
  ArtifactFileInfo,
  ArtifactSet,
  CacheManifest,
  CacheStatus,
  CacheStore,
  DocumentCacheEntry,
  PageArtifact,
  TextItemPageArtifact,
} from "./tool-types";
import { SCHEMA_VERSION } from "./config";

const MANIFEST_NAME = "manifest.json";
const DOCUMENT_TEXT_NAME = "document.txt";
const DOCUMENT_MARKDOWN_NAME = "document.md";
const DOCUMENT_JSON_NAME = "document.json";
const PAGES_NAME = "pages.json.gz";
const TEXTITEMS_NAME = "textitems.json.gz";
const IMAGE_DIR = "images";
const SCREENSHOT_DIR = "screenshots";
const DOCUMENT_ID_RE = /^[0-9a-f]{24,64}$/;

interface Quotas {
  maxDocumentCacheBytes: number;
  maxTotalCacheBytes: number;
}

export function createFilesystemCacheStore(root: string, quotas: Quotas): CacheStore {
  return new FilesystemCacheStore(root, quotas);
}

class FilesystemCacheStore implements CacheStore {
  private ready?: Promise<void>;

  constructor(
    private readonly root: string,
    private readonly quotas: Quotas,
  ) {
    if (!path.isAbsolute(root)) throw new Error("Cache root must be absolute");
    if (!Number.isInteger(quotas.maxDocumentCacheBytes) || quotas.maxDocumentCacheBytes <= 0) {
      throw new Error("maxDocumentCacheBytes must be a positive integer");
    }
    if (!Number.isInteger(quotas.maxTotalCacheBytes) || quotas.maxTotalCacheBytes <= 0) {
      throw new Error("maxTotalCacheBytes must be a positive integer");
    }
    if (quotas.maxDocumentCacheBytes > quotas.maxTotalCacheBytes) {
      throw new Error("maxDocumentCacheBytes must be <= maxTotalCacheBytes");
    }
  }

  async get(documentId: string): Promise<DocumentCacheEntry | undefined> {
    await this.init();
    assertDocumentId(documentId);
    const dir = this.documentDir(documentId);
    try {
      const manifest = await this.readManifest(dir, documentId);
      const entry = await this.readCompleteEntry(dir, manifest);
      await this.touch(documentId, manifest).catch(() => undefined);
      return entry;
    } catch {
      await this.safeDelete(dir).catch(() => undefined);
      return undefined;
    }
  }

  async put(entry: DocumentCacheEntry): Promise<DocumentCacheEntry> {
    await this.init();
    const documentId = entry.manifest.documentId;
    assertDocumentId(documentId);
    const tempDir = path.join(
      this.root,
      `.${documentId}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    const finalDir = this.documentDir(documentId);
    const backupDir = `${finalDir}.backup-${process.pid}-${randomUUID().slice(0, 8)}`;

    await mkdir(tempDir, { recursive: false, mode: 0o700 });
    try {
      const stored = await this.writeEntry(tempDir, entry, finalDir);
      const actualBytes = await stabilizeManifestSize(tempDir, stored.manifest);
      if (actualBytes > this.quotas.maxDocumentCacheBytes) {
        throw new Error(
          `Document cache quota exceeded (${actualBytes} > ${this.quotas.maxDocumentCacheBytes})`,
        );
      }

      const finalExists = await pathExists(finalDir);
      if (finalExists) await rename(finalDir, backupDir);
      try {
        await rename(tempDir, finalDir);
      } catch (error) {
        if (finalExists) await rename(backupDir, finalDir).catch(() => undefined);
        throw error;
      }
      if (finalExists) await this.safeDelete(backupDir).catch(() => undefined);

      await this.evictIfNeeded(documentId);
      const persisted = await this.get(documentId);
      if (!persisted) throw new Error("Cache entry failed validation after write");
      return persisted;
    } catch (error) {
      await this.safeDelete(tempDir).catch(() => undefined);
      throw error;
    }
  }

  async touch(documentId: string, _manifest: CacheManifest): Promise<void> {
    await this.init();
    assertDocumentId(documentId);
    const current = await this.readManifest(this.documentDir(documentId), documentId);
    const updated: CacheManifest = {
      ...current,
      lastAccessedAt: new Date().toISOString(),
    };
    await writeJsonAtomic(path.join(this.documentDir(documentId), MANIFEST_NAME), updated);
  }

  async delete(documentId: string): Promise<void> {
    await this.init();
    assertDocumentId(documentId);
    await this.safeDelete(this.documentDir(documentId));
  }

  async status(): Promise<CacheStatus> {
    await this.init();
    const summaries = await this.scanManifests(true);
    return {
      entryCount: summaries.length,
      bytes: summaries.reduce((sum, item) => sum + item.bytes, 0),
    };
  }

  async clear(): Promise<void> {
    await this.init();
    for (const item of await readdir(this.root, { withFileTypes: true })) {
      await this.safeDelete(path.join(this.root, item.name));
    }
  }

  private async init(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const existing = await lstat(this.root).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        });
        if (existing?.isSymbolicLink()) throw new Error("Cache root must not be a symlink");
        if (existing && !existing.isDirectory()) throw new Error("Cache root is not a directory");
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        await chmod(this.root, 0o700);
      })();
    }
    await this.ready;
  }

  private documentDir(documentId: string): string {
    assertDocumentId(documentId);
    return path.join(this.root, documentId);
  }

  private async writeEntry(
    dir: string,
    entry: DocumentCacheEntry,
    previousDir: string,
  ): Promise<DocumentCacheEntry> {
    const documentText = await writeTextArtifact(dir, DOCUMENT_TEXT_NAME, entry.documentText);
    const pages = await writeGzipArtifact(dir, PAGES_NAME, entry.pages);
    const textItems = await writeGzipArtifact(dir, TEXTITEMS_NAME, entry.textItems);
    const artifacts: ArtifactSet = {
      documentText,
      pages,
      textItems,
      images: {},
      screenshots: {},
    };

    if (entry.documentMarkdown !== undefined) {
      artifacts.documentMarkdown = await writeTextArtifact(
        dir,
        DOCUMENT_MARKDOWN_NAME,
        entry.documentMarkdown,
      );
    }
    if (entry.documentJson !== undefined) {
      artifacts.documentJson = await writeTextArtifact(dir, DOCUMENT_JSON_NAME, entry.documentJson);
    }

    if (entry.imageBuffers) {
      for (const [id, image] of Object.entries(entry.imageBuffers)) {
        if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid extracted image id: ${id}`);
        if (!/^[A-Za-z0-9]+$/.test(image.format))
          throw new Error(`Invalid extracted image format: ${image.format}`);
        const relativePath = path.posix.join(
          IMAGE_DIR,
          `image_${id}.${image.format.toLowerCase()}`,
        );
        artifacts.images[id] = await writeBufferArtifact(dir, relativePath, image.buffer);
      }
    }

    await preserveArtifacts(previousDir, dir, entry.manifest.artifacts.images, artifacts.images);

    if (entry.screenshotBuffers) {
      for (const [key, buffer] of Object.entries(entry.screenshotBuffers)) {
        if (!/^page-\d+-\d+$/.test(key)) throw new Error(`Invalid screenshot key: ${key}`);
        const relativePath = path.posix.join(SCREENSHOT_DIR, `${key}.png`);
        artifacts.screenshots[key] = await writeBufferArtifact(dir, relativePath, buffer);
      }
    }
    await preserveArtifacts(
      previousDir,
      dir,
      entry.manifest.artifacts.screenshots,
      artifacts.screenshots,
    );

    const now = new Date().toISOString();
    const manifest: CacheManifest = {
      ...entry.manifest,
      schemaVersion: SCHEMA_VERSION,
      artifacts,
      cacheBytes: sumArtifactBytes(artifacts),
      createdAt: entry.manifest.createdAt || now,
      lastAccessedAt: now,
    };
    await writeJsonAtomic(path.join(dir, MANIFEST_NAME), manifest);
    return { ...entry, manifest };
  }

  private async readManifest(dir: string, documentId: string): Promise<CacheManifest> {
    const manifestPath = path.join(dir, MANIFEST_NAME);
    const manifestStat = await lstat(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink())
      throw new Error("Invalid manifest file");
    if (manifestStat.size > 256 * 1024) throw new Error("Manifest is too large");
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isValidManifest(parsed, documentId)) throw new Error("Invalid cache manifest");
    return parsed;
  }

  private async readCompleteEntry(
    dir: string,
    manifest: CacheManifest,
  ): Promise<DocumentCacheEntry> {
    const documentText = await readTextArtifact(dir, manifest.artifacts.documentText);
    const documentMarkdown = manifest.artifacts.documentMarkdown
      ? await readTextArtifact(dir, manifest.artifacts.documentMarkdown)
      : undefined;
    const documentJson = manifest.artifacts.documentJson
      ? await readTextArtifact(dir, manifest.artifacts.documentJson)
      : undefined;
    const pages = await readGzipArtifact<PageArtifact[]>(
      dir,
      manifest.artifacts.pages,
      this.quotas.maxDocumentCacheBytes,
    );
    const textItems = await readGzipArtifact<TextItemPageArtifact[]>(
      dir,
      manifest.artifacts.textItems,
      this.quotas.maxDocumentCacheBytes,
    );
    for (const image of Object.values(manifest.artifacts.images)) {
      await validateArtifact(dir, image);
    }
    for (const screenshot of Object.values(manifest.artifacts.screenshots)) {
      await validateArtifact(dir, screenshot);
    }
    return { manifest, documentText, documentMarkdown, documentJson, pages, textItems };
  }

  private async scanManifests(
    purgeInvalid: boolean,
  ): Promise<Array<{ id: string; bytes: number; at: number }>> {
    const items: Array<{ id: string; bytes: number; at: number }> = [];
    for (const dirent of await readdir(this.root, { withFileTypes: true })) {
      const full = path.join(this.root, dirent.name);
      if (!DOCUMENT_ID_RE.test(dirent.name) || !dirent.isDirectory() || dirent.isSymbolicLink()) {
        if (purgeInvalid) await this.safeDelete(full).catch(() => undefined);
        continue;
      }
      try {
        const manifest = await this.readManifest(full, dirent.name);
        items.push({
          id: dirent.name,
          bytes: await directoryBytes(full),
          at: Date.parse(manifest.lastAccessedAt) || 0,
        });
      } catch {
        if (purgeInvalid) await this.safeDelete(full).catch(() => undefined);
      }
    }
    return items;
  }

  private async evictIfNeeded(keepDocumentId: string): Promise<void> {
    const entries = await this.scanManifests(true);
    let total = entries.reduce((sum, item) => sum + item.bytes, 0);
    if (total <= this.quotas.maxTotalCacheBytes) return;
    for (const victim of entries
      .filter((item) => item.id !== keepDocumentId)
      .sort((a, b) => a.at - b.at)) {
      if (total <= this.quotas.maxTotalCacheBytes) break;
      await this.delete(victim.id);
      total -= victim.bytes;
    }
    if (total > this.quotas.maxTotalCacheBytes) {
      await this.delete(keepDocumentId);
      throw new Error("Total cache quota cannot retain the new document");
    }
  }

  private async safeDelete(target: string): Promise<void> {
    const relative = path.relative(this.root, path.resolve(target));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Refusing to delete outside cache root: ${target}`);
    }
    await removeTreeNoFollow(path.resolve(target));
  }
}

async function preserveArtifacts(
  previousDir: string,
  nextDir: string,
  previous: Record<string, ArtifactFileInfo>,
  next: Record<string, ArtifactFileInfo>,
): Promise<void> {
  if (!(await pathExists(previousDir))) return;
  for (const [key, info] of Object.entries(previous)) {
    if (next[key]) continue;
    const bytes = await validateArtifact(previousDir, info);
    next[key] = await writeBufferArtifact(nextDir, info.path, bytes);
  }
}

async function stabilizeManifestSize(dir: string, manifest: CacheManifest): Promise<number> {
  let previous = -1;
  let actual = await directoryBytes(dir);
  for (let attempt = 0; attempt < 4 && actual !== previous; attempt += 1) {
    previous = actual;
    manifest.cacheBytes = actual;
    await writeJsonAtomic(path.join(dir, MANIFEST_NAME), manifest);
    actual = await directoryBytes(dir);
  }
  manifest.cacheBytes = actual;
  await writeJsonAtomic(path.join(dir, MANIFEST_NAME), manifest);
  return directoryBytes(dir);
}

function assertDocumentId(documentId: string): void {
  if (!DOCUMENT_ID_RE.test(documentId)) throw new Error("Invalid documentId");
}

function isValidManifest(value: unknown, documentId: string): value is CacheManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as CacheManifest;
  const validKinds = new Set([
    "plain-text",
    "pdf",
    "office",
    "presentation",
    "spreadsheet",
    "image",
  ]);
  const redactedConfig = manifest.redactedConfig;
  return (
    manifest.schemaVersion === SCHEMA_VERSION &&
    manifest.documentId === documentId &&
    typeof manifest.cacheKey === "string" &&
    /^[0-9a-f]{64}$/.test(manifest.cacheKeyHash) &&
    typeof manifest.source?.inputPath === "string" &&
    typeof manifest.source?.resolvedPath === "string" &&
    typeof manifest.source?.realPath === "string" &&
    typeof manifest.source?.ext === "string" &&
    validKinds.has(manifest.source?.kind) &&
    typeof manifest.source?.plainText === "boolean" &&
    /^[0-9a-f]{64}$/.test(manifest.source?.sha256 ?? "") &&
    Number.isInteger(manifest.source?.size) &&
    manifest.sourceHash === manifest.source.sha256 &&
    typeof manifest.createdAt === "string" &&
    Number.isFinite(Date.parse(manifest.createdAt)) &&
    typeof manifest.lastAccessedAt === "string" &&
    Number.isFinite(Date.parse(manifest.lastAccessedAt)) &&
    typeof manifest.packageVersion === "string" &&
    manifest.packageVersion.length > 0 &&
    Number.isInteger(manifest.pageCount) &&
    manifest.pageCount > 0 &&
    Number.isInteger(manifest.cacheBytes) &&
    manifest.cacheBytes >= 0 &&
    isRecord(redactedConfig) &&
    (redactedConfig.format === "text" ||
      redactedConfig.format === "markdown" ||
      redactedConfig.format === "json") &&
    (redactedConfig.ocrModeResolved === "on" || redactedConfig.ocrModeResolved === "off") &&
    isArtifactInfo(manifest.artifacts?.documentText) &&
    (manifest.artifacts?.documentMarkdown === undefined ||
      isArtifactInfo(manifest.artifacts.documentMarkdown)) &&
    (manifest.artifacts?.documentJson === undefined ||
      isArtifactInfo(manifest.artifacts.documentJson)) &&
    isArtifactInfo(manifest.artifacts?.pages) &&
    isArtifactInfo(manifest.artifacts?.textItems) &&
    isRecord(manifest.artifacts?.images) &&
    Object.values(manifest.artifacts.images).every(isArtifactInfo) &&
    isRecord(manifest.artifacts?.screenshots) &&
    Object.values(manifest.artifacts.screenshots).every(isArtifactInfo)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArtifactInfo(value: unknown): value is ArtifactFileInfo {
  if (!value || typeof value !== "object") return false;
  const info = value as ArtifactFileInfo;
  return (
    typeof info.path === "string" &&
    isSafeRelativeArtifactPath(info.path) &&
    Number.isInteger(info.bytes) &&
    info.bytes >= 0 &&
    typeof info.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(info.sha256)
  );
}

function isSafeRelativeArtifactPath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !path.isAbsolute(relativePath) &&
    !relativePath.split(/[\\/]/).includes("..")
  );
}

async function writeTextArtifact(
  dir: string,
  relativePath: string,
  text: string,
): Promise<ArtifactFileInfo> {
  return writeBufferArtifact(dir, relativePath, Buffer.from(text, "utf8"));
}

async function writeGzipArtifact(
  dir: string,
  relativePath: string,
  value: unknown,
): Promise<ArtifactFileInfo> {
  return writeBufferArtifact(
    dir,
    relativePath,
    gzipSync(Buffer.from(JSON.stringify(value), "utf8")),
  );
}

async function writeBufferArtifact(
  dir: string,
  relativePath: string,
  buffer: Buffer,
): Promise<ArtifactFileInfo> {
  if (!isSafeRelativeArtifactPath(relativePath)) throw new Error("Unsafe artifact path");
  const filePath = path.join(dir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFileAtomic(filePath, buffer);
  return { path: relativePath, bytes: buffer.length, sha256: sha256(buffer) };
}

async function writeFileAtomic(filePath: string, data: string | Buffer): Promise<void> {
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let renamed = false;
  try {
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, filePath);
    renamed = true;
  } finally {
    if (!renamed) await unlink(temp).catch(() => undefined);
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value));
}

async function validateArtifact(dir: string, info: ArtifactFileInfo): Promise<Buffer> {
  if (!isArtifactInfo(info)) throw new Error("Invalid artifact metadata");
  const filePath = path.join(dir, info.path);
  const item = await lstat(filePath);
  if (!item.isFile() || item.isSymbolicLink()) throw new Error(`Invalid artifact: ${info.path}`);
  if (item.size !== info.bytes) throw new Error(`Artifact size mismatch: ${info.path}`);
  const buffer = await readFile(filePath);
  if (sha256(buffer) !== info.sha256) throw new Error(`Artifact hash mismatch: ${info.path}`);
  return buffer;
}

async function readTextArtifact(dir: string, info: ArtifactFileInfo): Promise<string> {
  return (await validateArtifact(dir, info)).toString("utf8");
}

async function readGzipArtifact<T>(
  dir: string,
  info: ArtifactFileInfo,
  maxOutputLength: number,
): Promise<T> {
  const buffer = await validateArtifact(dir, info);
  return JSON.parse(gunzipSync(buffer, { maxOutputLength }).toString("utf8")) as T;
}

function sumArtifactBytes(artifacts: ArtifactSet): number {
  return [
    artifacts.documentText,
    artifacts.documentMarkdown,
    artifacts.documentJson,
    artifacts.pages,
    artifacts.textItems,
    ...Object.values(artifacts.images),
    ...Object.values(artifacts.screenshots),
  ].reduce((sum, item) => sum + (item?.bytes ?? 0), 0);
}

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

async function pathExists(target: string): Promise<boolean> {
  return lstat(target)
    .then(() => true)
    .catch(() => false);
}

async function directoryBytes(dir: string): Promise<number> {
  const item = await lstat(dir);
  if (item.isSymbolicLink()) return item.size;
  if (item.isFile()) return item.size;
  let total = 0;
  for (const child of await readdir(dir, { withFileTypes: true })) {
    total += await directoryBytes(path.join(dir, child.name));
  }
  return total;
}

async function removeTreeNoFollow(target: string): Promise<void> {
  const item = await lstat(target).catch(() => undefined);
  if (!item) return;
  if (item.isSymbolicLink() || !item.isDirectory()) {
    await unlink(target);
    return;
  }
  for (const child of await readdir(target, { withFileTypes: true })) {
    await removeTreeNoFollow(path.join(target, child.name));
  }
  await rmdir(target);
}
