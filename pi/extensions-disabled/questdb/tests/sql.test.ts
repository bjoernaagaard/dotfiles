import { describe, expect, test } from "vitest";
import {
	classifyStatement,
	generateIngestScript,
	generateSchemaDdl,
	splitSingleStatement,
} from "../src/sql.ts";

describe("sql helpers", () => {
	test("classifies read/write statements", () => {
		expect(classifyStatement("SELECT * FROM price")).toBe("read");
		expect(classifyStatement("WITH cte AS (SELECT * FROM x) SELECT * FROM cte")).toBe("read");
		expect(classifyStatement("INSERT INTO t VALUES (1)")).toBe("write");
		expect(classifyStatement("CREATE TABLE x(a int)")).toBe("write");
		expect(classifyStatement("SELECT \"weird\" = 'a; b' from x")).toBe("read");
		expect(() => classifyStatement("SELECT * FROM x; SELECT * FROM y")).toThrow();
	});

	test("split single statement", () => {
		expect(splitSingleStatement("SELECT * FROM x")).toBe("SELECT * FROM x");
		expect(splitSingleStatement("SELECT 'a; b' FROM x;\n")).toBe("SELECT 'a; b' FROM x");
		expect(() => splitSingleStatement("SELECT * FROM x; UPDATE x SET a=1")).toThrow();
	});

	test("generates deterministic CREATE TABLE DDL", () => {
		const ddl = generateSchemaDdl({
			tableName: "trades",
			timestampColumn: "ts",
			columns: [
				{ name: "ts", type: "TIMESTAMP" },
				{ name: "sym", type: "SYMBOL" },
				{ name: "price", type: "DOUBLE" },
			],
			symbolColumns: ["sym"],
			partitionBy: "DAY",
			wal: true,
			dedup: true,
			dedupKeys: ["ts", "sym"],
		});

		expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "trades"');
		expect(ddl).toContain('DEDUP UPSERT KEYS("ts", "sym")');
		expect(ddl).toContain("WAL");
		expect(ddl).toContain('TIMESTAMP("ts") PARTITION BY DAY');
		expect(ddl.endsWith(";")).toBe(true);
	});

	test("requires DEDUP to include timestamp key", () => {
		expect(() =>
			generateSchemaDdl({
				tableName: "t",
				timestampColumn: "ts",
				columns: [
					{ name: "ts", type: "TIMESTAMP" },
					{ name: "sym", type: "SYMBOL" },
				],
				dedup: true,
				dedupKeys: ["sym"],
				wal: true,
			}),
		).toThrow(/timestamp/i);
	});

	test("builds ILP script for TCP with protocol v2 defaults and typed arrays", () => {
		const script = generateIngestScript({
			tableName: "trades",
			timestampColumn: "ts",
			columns: [
				{ name: "ts", type: "TIMESTAMP" },
				{ name: "sym", type: "SYMBOL" },
				{ name: "price", type: "DOUBLE[]" },
				{ name: "size", type: "DOUBLE" },
			],
			transport: "tcp",
		});

		expect(script).toContain("import certifi");
		expect(script).toContain("Sender.from_conf");
		expect(script).toContain("protocol_version=2");
		expect(script).toContain('np.asarray(row["price"], dtype=np.float64)');
		expect(script).toContain('TimestampNanos(int(row["ts"]))');
	});

	test("supports zero symbol columns", () => {
		const script = generateIngestScript({
			tableName: "events",
			timestampColumn: "ts",
			columns: [
				{ name: "ts", type: "TIMESTAMP" },
				{ name: "value", type: "DOUBLE" },
			],
			transport: "tcp",
		});
		expect(script).toContain('symbols={');
		expect(script).toContain('at=TimestampNanos(int(row["ts"]))');
	});
});
