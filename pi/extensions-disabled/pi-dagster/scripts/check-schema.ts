#!/usr/bin/env node
/**
 * Offline schema drift check CLI.
 * Exit 0 on match; nonzero on drift.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatSchemaCheckReport,
  runSchemaCheck,
} from "../src/schema/check.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = runSchemaCheck(packageRoot);
const text = formatSchemaCheckReport(report);
// eslint-disable-next-line no-console
console.log(text);
process.exit(report.ok ? 0 : 1);
