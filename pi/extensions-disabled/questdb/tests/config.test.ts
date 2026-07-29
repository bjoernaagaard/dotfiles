import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	clampLimit,
	DEFAULT_MAX_LIMIT,
	DEFAULT_QUESTDB_CONFIG,
	loadQuestDbConfig,
	MAX_LIMIT_CEILING,
} from "../src/config.ts";

function clearQuestEnv() {
	delete process.env.QUESTDB_BASE_URL;
	delete process.env.QUESTDB_QUERY_PATH;
	delete process.env.QUESTDB_TIMEOUT_MS;
	delete process.env.QUESTDB_QUERY_TIMEOUT_MS;
	delete process.env.QUESTDB_DEFAULT_LIMIT;
	delete process.env.QUESTDB_MAX_LIMIT;
	delete process.env.QUESTDB_READ_ONLY;
	delete process.env.QUESTDB_TOKEN;
	delete process.env.QUESTDB_API_TOKEN;
	delete process.env.QUESTDB_USERNAME;
	delete process.env.QUESTDB_PASSWORD;
	delete process.env.QUESTDB_PREFERRED_TOOLS;
}

describe("QuestDB config loading", () => {
	let originalHome: string | undefined;

	beforeEach(() => {
		originalHome = process.env.HOME;
		clearQuestEnv();
	});

	afterEach(() => {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		clearQuestEnv();
	});

	test("defaults are read-only and sane", () => {
		expect(DEFAULT_QUESTDB_CONFIG.readOnly).toBe(true);
		expect(DEFAULT_QUESTDB_CONFIG.defaultLimit).toBeGreaterThan(0);
		expect(DEFAULT_QUESTDB_CONFIG.maxLimit).toBeGreaterThanOrEqual(DEFAULT_QUESTDB_CONFIG.defaultLimit);
		expect(DEFAULT_QUESTDB_CONFIG.maxLimit).toBe(DEFAULT_MAX_LIMIT);
		expect(DEFAULT_MAX_LIMIT).toBeLessThanOrEqual(MAX_LIMIT_CEILING);
	});

	test("clampLimit defaults, floors, and respects shared ceiling", () => {
		const config = { ...DEFAULT_QUESTDB_CONFIG };
		expect(clampLimit(undefined, config)).toBe(config.defaultLimit);
		expect(clampLimit(Number.NaN, config)).toBe(config.defaultLimit);
		expect(clampLimit(12.9, config)).toBe(12);
		expect(clampLimit(0, config)).toBe(1);
		expect(clampLimit(-5, config)).toBe(1);
		// default config.maxLimit is DEFAULT_MAX_LIMIT
		expect(clampLimit(DEFAULT_MAX_LIMIT + 500, config)).toBe(DEFAULT_MAX_LIMIT);
		expect(clampLimit(999_999, { ...config, maxLimit: 50 })).toBe(50);
		// raised maxLimit works up to ceiling
		expect(clampLimit(5_000, { ...config, maxLimit: 10_000 })).toBe(5_000);
		// config.maxLimit above ceiling is still hard-capped
		expect(clampLimit(MAX_LIMIT_CEILING + 100, { ...config, maxLimit: MAX_LIMIT_CEILING + 100 })).toBe(MAX_LIMIT_CEILING);
	});

	test("env maxLimit cannot exceed MAX_LIMIT_CEILING", async () => {
		const home = mkdtempSync(join(tmpdir(), "questdb-home-"));
		try {
			process.env.HOME = home;
			process.env.QUESTDB_MAX_LIMIT = String(MAX_LIMIT_CEILING + 50_000);
			const loaded = await loadQuestDbConfig(home, false);
			expect(loaded.config.maxLimit).toBe(MAX_LIMIT_CEILING);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("env overrides are highest precedence and can set credentials", async () => {
		const home = mkdtempSync(join(tmpdir(), "questdb-home-"));
		const project = mkdtempSync(join(tmpdir(), "questdb-project-"));
		try {
			process.env.HOME = home;
			const agentDir = getAgentDir();
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(
				join(agentDir, "questdb.json"),
				JSON.stringify({
					baseUrl: "http://project-default.local",
					defaultLimit: 150,
					preferredTools: ["questdb_query", "questdb_exec", "unknown_tool"],
				}),
				"utf8",
			);
			mkdirSync(join(project, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(project, CONFIG_DIR_NAME, "questdb.json"), JSON.stringify({ defaultLimit: 250 }), "utf8");

			process.env.QUESTDB_DEFAULT_LIMIT = "500";
			process.env.QUESTDB_TOKEN = "env-token";
			process.env.QUESTDB_READ_ONLY = "false";
			process.env.QUESTDB_USERNAME = "u";
			process.env.QUESTDB_PASSWORD = "p";
			process.env.QUESTDB_PREFERRED_TOOLS = "questdb_schema,questdb_docs";

			const trusted = await loadQuestDbConfig(project, true);
			expect(trusted.config.defaultLimit).toBe(500);
			expect(trusted.config.readOnly).toBe(false);
			expect(trusted.config.authToken).toBe("env-token");
			expect(trusted.config.basicUsername).toBe("u");
			expect(trusted.config.basicPassword).toBe("p");
			expect(trusted.config.preferredTools).toEqual(["questdb_schema", "questdb_docs"]);
			expect(trusted.hasProjectConfig).toBe(true);
			expect(trusted.hasGlobalConfig).toBe(true);
			expect(trusted.config.source).toBe("env");
		} finally {
			rmSync(home, { recursive: true, force: true });
			rmSync(project, { recursive: true, force: true });
		}
	});

	test("untrusted project ignores project config", async () => {
		const home = mkdtempSync(join(tmpdir(), "questdb-home-"));
		const project = mkdtempSync(join(tmpdir(), "questdb-project-"));
		try {
			process.env.HOME = home;
			const agentDir = getAgentDir();
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(
				join(agentDir, "questdb.json"),
				JSON.stringify({ defaultLimit: 111, readOnly: false }),
				"utf8",
			);
			mkdirSync(join(project, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(project, CONFIG_DIR_NAME, "questdb.json"), JSON.stringify({ defaultLimit: 999 }), "utf8");

			const loaded = await loadQuestDbConfig(project, false);
			expect(loaded.config.defaultLimit).toBe(111);
			expect(loaded.hasProjectConfig).toBe(false);
			expect(loaded.hasGlobalConfig).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
			rmSync(project, { recursive: true, force: true });
		}
	});

	test("JSON config credentials are not loaded as auth tokens", async () => {
		const home = mkdtempSync(join(tmpdir(), "questdb-home-"));
		try {
			process.env.HOME = home;
			const agentDir = getAgentDir();
			mkdirSync(agentDir, { recursive: true });
			writeFileSync(
				join(agentDir, "questdb.json"),
				JSON.stringify({
					baseUrl: "http://localhost:9000",
					authToken: "json-token",
					basicUsername: "json-user",
				}),
				"utf8",
			);
			const loaded = await loadQuestDbConfig(home, false);
			expect(loaded.config.authToken).toBeUndefined();
			expect(loaded.config.basicUsername).toBeUndefined();
			expect(loaded.config.basicPassword).toBeUndefined();
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
