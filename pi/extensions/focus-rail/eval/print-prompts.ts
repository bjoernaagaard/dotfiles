import { SCENARIOS } from "./scenarios.js";

for (const scenario of SCENARIOS) {
  console.log(`## ${scenario.id}`);
  console.log(`Purpose: ${scenario.purpose}`);
  console.log(`Prompt: ${scenario.prompt}`);
  console.log(`Look for: ${scenario.expected.join("; ")}`);
  console.log();
}
