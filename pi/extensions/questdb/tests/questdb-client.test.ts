import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { executeQuestDbQuery, toRequestUrl } from "../src/questdb-client.ts";

describe("questdb-client", () => {
	const config = {
		baseUrl: "http://localhost:9000",
		queryPath: "/exec",
		timeoutMs: 10_000,
		defaultLimit: 100,
		maxLimit: 1_000,
		readOnly: true,
		preferredTools: [],
		source: "default" as const,
	};

	const mockFetch = vi.spyOn(globalThis, "fetch");

	beforeEach(() => {
		mockFetch.mockReset();
	});

	test("builds GET /exec with query and limit params", async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ columns: ["ts", "price"], dataset: [] }), { status: 200 }));
		await executeQuestDbQuery("SELECT * FROM x", config as any, undefined, 200);
		const [url, init] = mockFetch.mock.calls[0]!;
		const requestUrl = String(url);
		expect(requestUrl).toContain("/exec?");
		expect(requestUrl).toContain("query=SELECT+*+FROM+x");
		expect(requestUrl).toContain("limit=200");
		const method = (init?.method ?? "").toString().toUpperCase();
		expect(method).toBe("GET");
	});

	test("preserves auth header precedence", async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ ddl: "OK", updated: 0 }), { status: 200 }));
		await executeQuestDbQuery("SELECT * FROM x", {
			...config,
			basicUsername: "user",
			basicPassword: "secret",
			authToken: "token",
		} as any, undefined);
		const init = mockFetch.mock.calls[0]![1] as RequestInit;
		expect(init.headers).toBeDefined();
		const headers = init.headers as Record<string, string>;
		expect((headers as Record<string, string>).Authorization).toMatch(/^Basic /);
		expect((headers as Record<string, string>).Authorization).not.toContain("Bearer");
	});

	test("normalizes simple select payload", async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ columns: ["a", "b"], dataset: [[1, 2]] }), { status: 200 }));
		const result = await executeQuestDbQuery("SELECT a,b FROM t", config as any, undefined, 50);
		expect(result.kind).toBe("select");
		if (result.kind === "select") {
			expect(result.columns).toEqual([
				{ name: "a", type: "STRING" },
				{ name: "b", type: "STRING" },
			]);
			expect(result.dataset).toHaveLength(1);
		}
	});

	test("uses toRequestUrl utility", () => {
		const url = toRequestUrl(config as any, "show tables", 10);
		expect(url).toContain("http://");
		expect(url).toContain("query=show+tables");
		expect(url).toContain("limit=10");
	});

	test("detects API errors", async () => {
		mockFetch.mockResolvedValue(new Response(JSON.stringify({ status: "error", error: "boom" }), { status: 400, statusText: "Bad" }));
		await expect(executeQuestDbQuery("bad", config as any, undefined, 1)).rejects.toThrow(/QuestDB HTTP 400/);
	});
});
