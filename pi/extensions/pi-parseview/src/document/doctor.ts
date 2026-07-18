import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import type { CacheStore, ResolvedConfig, NativeLoader } from "./tool-types";
import { probeLiteparsePackageVersion } from "./native";
import { truncateUtf8WithEllipsis } from "./utils";

export interface DoctorDeps {
  config: ResolvedConfig;
  cache: CacheStore;
  nativeLoader: NativeLoader;
}

export interface DoctorReport {
  lines: string[];
}

export async function gatherDoctorReport(deps: DoctorDeps): Promise<DoctorReport> {
  const lines: string[] = [];
  lines.push(`parseview document system doctor`);
  lines.push(`platform: ${process.platform}/${process.arch}`);
  lines.push(
    `packageVersion: ${deps.nativeLoader.getLastVersion() ?? (await probeLiteparsePackageVersion())}`,
  );
  lines.push(`nativeLoad: ${await probeNativeLoad(deps.nativeLoader)}`);
  lines.push(`cacheRoot: ${await cacheRootStatus(deps.config.cacheDir)}`);
  const usage = await deps.cache.status();
  lines.push(
    `cacheUsage: ${usage.entryCount} entr${usage.entryCount === 1 ? "y" : "ies"}, ${usage.bytes} bytes`,
  );
  lines.push(
    `soffice: ${await execStatus("soffice", ["--version"])} / libreoffice: ${await execStatus("libreoffice", ["--version"])} `,
  );
  lines.push(`ImageMagick convert: ${await validatedConvertStatus()}`);
  lines.push(`magick: ${await execStatus("magick", ["--version"])} `);
  lines.push(`gs: ${await execStatus("gs", ["--version"])} `);
  lines.push(`TESSDATA: ${await tessdataStatus(deps.config)}`);
  lines.push(`ocrServerUrl: ${deps.config.ocrServerUrl ? "configured" : "not configured"}`);
  lines.push(
    `ocrHeaders: ${deps.config.ocrServerHeadersEnv ? "configured via env" : "not configured"}`,
  );
  return { lines };
}

export function formatDoctorReport(report: DoctorReport): string {
  return truncateUtf8WithEllipsis(report.lines.join("\n"), 12000).text;
}

async function probeNativeLoad(loader: NativeLoader): Promise<string> {
  try {
    await loader.load();
    return "ok";
  } catch (error) {
    return `failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function cacheRootStatus(cacheDir: string): Promise<string> {
  try {
    await access(cacheDir, constants.W_OK);
    return "writable";
  } catch {
    return "missing or not writable";
  }
}

async function tessdataStatus(config: ResolvedConfig): Promise<string> {
  const path = config.tessdataPath ?? process.env.TESSDATA_PREFIX;
  if (!path) return "not configured";
  try {
    const st = await stat(path);
    return st.isDirectory() ? `present: ${path}` : `not a directory: ${path}`;
  } catch {
    return `missing: ${path}`;
  }
}

async function execStatus(cmd: string, args: string[]): Promise<string> {
  const res = spawnSync(cmd, args, { encoding: "utf8", timeout: 1000 });
  if (res.error) return "missing";
  if (res.status !== 0 && !res.stdout && !res.stderr) return "unavailable";
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return output ? `ok (${truncateUtf8WithEllipsis(output.split(/\r?\n/)[0], 80).text})` : "ok";
}

async function validatedConvertStatus(): Promise<string> {
  for (const cmd of ["magick", "convert"]) {
    const res = spawnSync(cmd, ["-version"], {
      encoding: "utf8",
      timeout: 1000,
    });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    if (res.error) continue;
    if (/ImageMagick/i.test(output)) {
      return `ok (${cmd})`;
    }
  }
  return "missing or not ImageMagick";
}
