import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { detectQuestDbProjectEvidence } from "../src/project.ts";

describe("project detection", () => {
	let projectDir: string;

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "questdb-project-"));
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	test("detects explicit project questdb.json when trusted", async () => {
		mkdirSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(projectDir, CONFIG_DIR_NAME, "questdb.json"), "{}", "utf8");
		const res = await detectQuestDbProjectEvidence(projectDir, true);
		expect(res.hasEvidence).toBe(true);
		expect(res.path).toBeTruthy();
	});

	test("does not trust when untrusted", async () => {
		mkdirSync(join(projectDir, CONFIG_DIR_NAME), { recursive: true });
		writeFileSync(join(projectDir, CONFIG_DIR_NAME, "questdb.json"), "{}", "utf8");
		const res = await detectQuestDbProjectEvidence(projectDir, false);
		expect(res.hasEvidence).toBe(false);
	});

	test("detects dependency hints", async () => {
		writeFileSync(
			join(projectDir, "package.json"),
			JSON.stringify({ dependencies: { "@questdb/client": "^1.0.0" } }),
			"utf8",
		);
		const res = await detectQuestDbProjectEvidence(projectDir, true);
		expect(res.hasEvidence).toBe(true);
	});
});
