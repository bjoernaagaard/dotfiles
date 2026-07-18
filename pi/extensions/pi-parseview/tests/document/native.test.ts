import { describe, it, expect } from "vite-plus/test";
import { createNativeLoader, probeLiteparsePackageVersion } from "../../src/document/native";

describe("native LiteParse loader", () => {
  it("loads LiteParse 2.6.0 lazily and reuses the cached adapter", async () => {
    expect(await probeLiteparsePackageVersion()).toBe("2.6.0");
    const loader = createNativeLoader();
    const first = await loader.load();
    const second = await loader.load();
    expect(second).toBe(first);
    expect(first.version).toBe("2.6.0");
    expect(typeof first.create).toBe("function");
    expect(typeof first.searchItems).toBe("function");
  });
});
