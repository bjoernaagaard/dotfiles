import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ParseViewConfig {
  defaultFormat: "browser" | "terminal" | "pdf";
  fontSize: number;
  puppeteerExecutablePath?: string;
  ocrEnabled: boolean;
  diagramDefaultFormat: "ascii" | "svg" | "html";
  diagramTheme?: string;
}

const DEFAULTS: ParseViewConfig = {
  defaultFormat: "browser",
  fontSize: 16,
  puppeteerExecutablePath: undefined,
  ocrEnabled: false,
  diagramDefaultFormat: "ascii",
  diagramTheme: undefined,
};

const VALID_FORMATS = new Set(["browser", "terminal", "pdf"]);
const VALID_DIAGRAM_FORMATS = new Set(["ascii", "svg", "html"]);

let cached: ParseViewConfig | null = null;

function readSettingsFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validate(config: Record<string, unknown>): Partial<ParseViewConfig> {
  const result: Partial<ParseViewConfig> = {};

  if (typeof config.defaultFormat === "string" && VALID_FORMATS.has(config.defaultFormat)) {
    result.defaultFormat = config.defaultFormat as ParseViewConfig["defaultFormat"];
  }
  if (
    typeof config.diagramDefaultFormat === "string" &&
    VALID_DIAGRAM_FORMATS.has(config.diagramDefaultFormat)
  ) {
    result.diagramDefaultFormat =
      config.diagramDefaultFormat as ParseViewConfig["diagramDefaultFormat"];
  }
  if (typeof config.diagramTheme === "string" && config.diagramTheme.trim().length > 0) {
    result.diagramTheme = config.diagramTheme.trim();
  }
  if (typeof config.fontSize === "number") {
    result.fontSize = Math.max(10, Math.min(24, Math.round(config.fontSize)));
  }
  if (typeof config.ocrEnabled === "boolean") {
    result.ocrEnabled = config.ocrEnabled;
  }
  if (typeof config.puppeteerExecutablePath === "string") {
    result.puppeteerExecutablePath = config.puppeteerExecutablePath;
  }

  return result;
}

export function initConfig(cwd: string, agentDir: string): void {
  const globalRaw = readSettingsFile(join(agentDir, "settings.json"));
  const projectRaw = readSettingsFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));

  const globalSettings = globalRaw?.["pi-parseview"] as Record<string, unknown> | undefined;
  const projectSettings = projectRaw?.["pi-parseview"] as Record<string, unknown> | undefined;

  const globalValid = globalSettings ? validate(globalSettings) : {};
  const projectValid = projectSettings ? validate(projectSettings) : {};

  cached = { ...DEFAULTS, ...globalValid, ...projectValid };
}

export function loadConfig(): ParseViewConfig {
  if (cached) return cached;
  cached = { ...DEFAULTS };
  return cached;
}

export function resetConfig(): void {
  cached = null;
}
