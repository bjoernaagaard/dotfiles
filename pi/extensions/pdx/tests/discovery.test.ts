import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  formatMiseBootstrapPrompt,
  formatMiseBootstrapStatus,
  isMiseBootstrapConfig,
} from "../src/discovery.js";

test("detects Bootstrap tables in effective mise config files", () => {
  assert.equal(isMiseBootstrapConfig("[bootstrap.repos]\n\"~/.dotfiles\" = {}"), true);
  assert.equal(isMiseBootstrapConfig("[[bootstrap.hooks.final]]\nrun = \"echo done\""), true);
  assert.equal(isMiseBootstrapConfig("[tools]\nnode = \"lts\""), false);
});

test("formats detected Bootstrap context for the doctor and agent", () => {
  const discovery = {
    available: true,
    configured: true,
    configPaths: ["/Users/bsa/.config/mise/config.toml"],
    bootstrapConfigPaths: ["/Users/bsa/.dotfiles/config/mise/config.toml"],
    statusText: "mise bootstrap status\nrepos: 1 current\ntools: 1 installed",
  } as const;

  assert.match(formatMiseBootstrapStatus(discovery), /mise Bootstrap: detected/);
  assert.match(formatMiseBootstrapStatus(discovery), /\.dotfiles\/config\/mise\/config\.toml/);
  assert.match(formatMiseBootstrapPrompt(discovery), /pdx_mise_bootstrap/);
  assert.match(formatMiseBootstrapPrompt(discovery), /action=plan/);
});
