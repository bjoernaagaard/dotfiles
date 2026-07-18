import { describe, expect, test } from "vitest";
import {
	formatActiveQuestDbTools,
	formatEndpoint,
	formatQuestDbStatus,
	formatQuestDbStatusFromConfig,
} from "../src/status.ts";

describe("formatEndpoint", () => {
	test("strips protocol and joins host:port with queryPath", () => {
		expect(formatEndpoint("http://localhost:9000", "/exec")).toBe("localhost:9000/exec");
		expect(formatEndpoint("https://qd.example.com", "exec")).toBe("qd.example.com/exec");
		expect(formatEndpoint("http://127.0.0.1:9000/", "/q")).toBe("127.0.0.1:9000/q");
	});

	test("falls back for non-URL baseUrl", () => {
		expect(formatEndpoint("localhost:9000", "/exec")).toBe("localhost:9000/exec");
	});
});

describe("formatActiveQuestDbTools", () => {
	test("filters non-QuestDB tools and shortens labels in stable order", () => {
		expect(
			formatActiveQuestDbTools(["bash", "questdb_docs", "questdb", "questdb_query", "read"]),
		).toBe("hub,query,docs");
	});

	test("returns empty string when none active", () => {
		expect(formatActiveQuestDbTools(["bash", "read"])).toBe("");
	});
});

describe("formatQuestDbStatus", () => {
	test("compact one-line status for hub-only read-only", () => {
		expect(
			formatQuestDbStatus({
				baseUrl: "http://localhost:9000",
				queryPath: "/exec",
				readOnly: true,
				activeTools: ["bash", "questdb"],
			}),
		).toBe("QD localhost:9000/exec ro [hub]");
	});

	test("includes specialists and rw mode", () => {
		expect(
			formatQuestDbStatus({
				baseUrl: "http://db.local:9000",
				queryPath: "/exec",
				readOnly: false,
				activeTools: ["questdb", "questdb_query", "questdb_exec", "questdb_schema"],
			}),
		).toBe("QD db.local:9000/exec rw [hub,query,exec,schema]");
	});

	test("formatQuestDbStatusFromConfig mirrors config fields", () => {
		expect(
			formatQuestDbStatusFromConfig(
				{ baseUrl: "http://localhost:9000", queryPath: "/exec", readOnly: true },
				["questdb", "questdb_diagnose"],
			),
		).toBe("QD localhost:9000/exec ro [hub,diagnose]");
	});
});
