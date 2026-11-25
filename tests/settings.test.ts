import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "../src/core/settings";

describe("parseSettings", () => {
  it("reads valid stored settings", () => {
    expect(parseSettings('{"size":14,"lang":"he"}')).toEqual({ size: 14, lang: "he" });
  });
  it("falls back to defaults for missing, corrupt or out-of-range values", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"size":99,"lang":"fr"}')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"lang":"off"}')).toEqual({ size: DEFAULT_SETTINGS.size, lang: "off" });
  });
});
