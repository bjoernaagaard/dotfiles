import { describe, expect, test } from "vitest";
import { buildDiagnosticQuery, DIAGNOSTIC_MODES } from "../src/diagnostics.ts";

describe("diagnostics", () => {
	test("builds mode queries", () => {
		expect(buildDiagnosticQuery("tables")).toBe("SELECT * FROM tables()");
		expect(buildDiagnosticQuery("table_storage")).toBe("SELECT * FROM table_storage()");
		expect(buildDiagnosticQuery("memory_metrics")).toBe("SELECT * FROM memory_metrics()");
		expect(buildDiagnosticQuery("_query_trace")).toBe("SELECT * FROM _query_trace");
	});

	test("requires table for table-specific modes", () => {
		expect(() => buildDiagnosticQuery("table_columns")).toThrow(/required/);
		expect(() => buildDiagnosticQuery("table_partitions")).toThrow(/required/);
		expect(buildDiagnosticQuery("table_columns", "trades")).toBe("SELECT * FROM table_columns('trades')");
		expect(buildDiagnosticQuery("table_partitions", "trades")).toBe("SELECT * FROM table_partitions('trades')");
	});

	test("all diagnostic modes are valid", () => {
		for (const mode of DIAGNOSTIC_MODES) {
			if (mode !== "table_columns" && mode !== "table_partitions") {
				expect(buildDiagnosticQuery(mode)).toContain("SELECT * FROM");
			}
		}
	});
});
