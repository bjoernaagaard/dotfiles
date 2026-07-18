import { describe, expect, test } from "vitest";
import {
	computeActiveTools,
	inferIntentTools,
	mergeToolLists,
	QUESTDB_BASE_TOOLS,
	reconstructSessionActivation,
	shouldInjectQuestDbGuidance,
	TOOL_DIAGNOSE,
	TOOL_DOCS,
	TOOL_EXEC,
	TOOL_HUB,
	TOOL_INGEST,
	TOOL_QUERY,
	TOOL_SCHEMA,
	type SessionBranchEntryLike,
} from "../src/intent.ts";

function hubResult(enabled: string, isError = false): SessionBranchEntryLike {
	return {
		type: "message",
		message: {
			role: "toolResult",
			toolName: TOOL_HUB,
			isError,
			details: { enabled },
		},
	};
}

describe("intent and activation", () => {
	test("does not infer unless QuestDB is explicit", () => {
		const intent = inferIntentTools("can you create a table for this data?");
		expect(intent.hasExplicitQuestDbIntent).toBe(false);
		expect(intent.forceTools.size).toBe(0);
		const explicit = inferIntentTools("run a quest db query against trades");
		expect(explicit.hasExplicitQuestDbIntent).toBe(true);
		expect(explicit.forceTools.has(TOOL_QUERY)).toBe(true);
		const contextual = inferIntentTools("create the table now", true);
		expect(contextual.hasExplicitQuestDbIntent).toBe(false);
		expect(contextual.forceTools.has(TOOL_SCHEMA)).toBe(true);
	});

	test("computeActiveTools is hub-only and preserves non-quest tools", () => {
		const current = ["bash", "ls", TOOL_QUERY, TOOL_EXEC];
		const next = computeActiveTools(current);
		expect(next).toContain(TOOL_HUB);
		expect(next).toContain("bash");
		expect(next).toContain("ls");
		// Specialists are never bulk-enabled from computeActiveTools
		expect(next).not.toContain(TOOL_QUERY);
		expect(next).not.toContain(TOOL_EXEC);
		expect(next).toEqual(Array.from(new Set(next)).sort());
	});

	test("project evidence and preferred tools do not bulk-enable specialists", () => {
		// Even if specialists were previously active, hub-only activation strips them
		const current = ["ls", TOOL_DOCS, TOOL_QUERY];
		const next = computeActiveTools(current);
		expect(next).toContain("ls");
		expect(next).toContain(TOOL_HUB);
		expect(next).not.toContain(TOOL_DOCS);
		expect(next).not.toContain(TOOL_QUERY);
		expect(next).toEqual(["ls", TOOL_HUB].sort());
	});

	test("mergeToolLists is additive (hub specialist enable path)", () => {
		const merged = mergeToolLists(["bash", "ls", TOOL_HUB], [TOOL_HUB, TOOL_QUERY]);
		expect(merged).toContain("bash");
		expect(merged).toContain("ls");
		expect(merged).toContain(TOOL_HUB);
		expect(merged).toContain(TOOL_QUERY);
		expect(merged).not.toContain(TOOL_EXEC);
		expect(merged).toEqual(["bash", "ls", TOOL_HUB, TOOL_QUERY].sort());
	});

	test("hub remains the only QuestDB tool without disabling built-ins", () => {
		const active = computeActiveTools(["read", "bash", TOOL_EXEC]);
		expect(active).toContain("read");
		expect(active).toContain("bash");
		expect(active).toContain(QUESTDB_BASE_TOOLS[0]);
		expect(active).not.toContain(TOOL_EXEC);
	});

	test("shouldInjectQuestDbGuidance is true for project evidence or explicit intent", () => {
		expect(shouldInjectQuestDbGuidance(true, false, inferIntentTools("ordinary task"))).toBe(true);
		expect(shouldInjectQuestDbGuidance(false, true, inferIntentTools("ordinary task"))).toBe(true);
		expect(shouldInjectQuestDbGuidance(false, false, inferIntentTools("questdb query"))).toBe(true);
		expect(shouldInjectQuestDbGuidance(false, false, inferIntentTools("ordinary task"))).toBe(false);
	});

	test("reconstructSessionActivation restores hub-enabled specialists additively", () => {
		const branch: SessionBranchEntryLike[] = [
			{ type: "message", message: { role: "user" } },
			hubResult(TOOL_QUERY),
			{ type: "message", message: { role: "toolResult", toolName: "bash", details: {} } },
			hubResult(TOOL_DOCS),
			hubResult(TOOL_INGEST),
		];
		const result = reconstructSessionActivation(branch, { readOnly: true });
		expect(result.hasQuestDbContext).toBe(true);
		expect(result.enabledSpecialists).toEqual([TOOL_DOCS, TOOL_INGEST, TOOL_QUERY].sort());
		// Reconstruction does not bulk-enable all specialists
		expect(result.enabledSpecialists).not.toContain(TOOL_SCHEMA);
		expect(result.enabledSpecialists).not.toContain(TOOL_DIAGNOSE);
		expect(result.enabledSpecialists).not.toContain(TOOL_EXEC);
	});

	test("reconstructSessionActivation respects readOnly for questdb_exec", () => {
		const branch = [hubResult(TOOL_EXEC), hubResult(TOOL_QUERY)];
		const readOnly = reconstructSessionActivation(branch, { readOnly: true });
		expect(readOnly.hasQuestDbContext).toBe(true);
		expect(readOnly.enabledSpecialists).toEqual([TOOL_QUERY]);
		expect(readOnly.enabledSpecialists).not.toContain(TOOL_EXEC);

		const readWrite = reconstructSessionActivation(branch, { readOnly: false });
		expect(readWrite.enabledSpecialists).toEqual([TOOL_EXEC, TOOL_QUERY].sort());
	});

	test("reconstructSessionActivation ignores errors, unknown tools, and non-hub results", () => {
		const noContext: SessionBranchEntryLike[] = [
			hubResult(TOOL_QUERY, true), // error hub result
			{ type: "message", message: { role: "toolResult", toolName: TOOL_QUERY, details: { enabled: TOOL_DOCS } } },
			{ type: "compaction" },
			{ type: "message", message: { role: "assistant" } },
			{ type: "message", message: { role: "toolResult", toolName: TOOL_HUB, details: { other: true } } },
		];
		const empty = reconstructSessionActivation(noContext, { readOnly: false });
		expect(empty.hasQuestDbContext).toBe(false);
		expect(empty.enabledSpecialists).toEqual([]);

		// Unknown enabled target still marks context (hub ran) but does not activate a specialist
		const unknown = reconstructSessionActivation([hubResult("not_a_real_tool")], { readOnly: false });
		expect(unknown.hasQuestDbContext).toBe(true);
		expect(unknown.enabledSpecialists).toEqual([]);
	});

	test("reconstructSessionActivation sets context from project evidence without specialists", () => {
		const empty = reconstructSessionActivation([], { hasProjectEvidence: true });
		expect(empty.hasQuestDbContext).toBe(true);
		expect(empty.enabledSpecialists).toEqual([]);

		const none = reconstructSessionActivation([], { hasProjectEvidence: false });
		expect(none.hasQuestDbContext).toBe(false);
	});

	test("reconstructed specialists merge additively onto hub-only base", () => {
		const hubOnly = computeActiveTools(["bash", "read", TOOL_EXEC]);
		expect(hubOnly).toEqual(["bash", "read", TOOL_HUB].sort());
		const restored = mergeToolLists(hubOnly, [TOOL_QUERY, TOOL_DOCS]);
		expect(restored).toEqual(["bash", "read", TOOL_DOCS, TOOL_HUB, TOOL_QUERY].sort());
	});
});
