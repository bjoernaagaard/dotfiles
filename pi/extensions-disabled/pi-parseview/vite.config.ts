import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      enabled: false, // enable when needed
    },
  },
  lint: {
    plugins: ["typescript"],
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
  fmt: {
    indentWidth: 2,
    lineWidth: 100,
  },
});
