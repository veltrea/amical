import { describe, it, expect } from "vitest";
import { resolveDockIntent } from "../../src/utils/dock-visibility";

describe("resolveDockIntent", () => {
  it("shows the dock when enabled but currently hidden", () => {
    expect(resolveDockIntent(true, false)).toBe("show");
  });

  it("hides the dock when disabled but currently visible", () => {
    expect(resolveDockIntent(false, true)).toBe("hide");
  });

  it("no-ops when the dock is already visible and enabled", () => {
    expect(resolveDockIntent(true, true)).toBe("noop");
  });

  it("no-ops when the dock is already hidden and disabled", () => {
    expect(resolveDockIntent(false, false)).toBe("noop");
  });
});
