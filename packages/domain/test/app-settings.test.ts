import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  appSettingsUpdateSchema,
  defaultAppSettings,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["bb/", "", "sawyer/wt-", "team/bb/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " bb/",
      "bb //",
      "-bb/",
      "/bb/",
      "bb//",
      "bb../",
      "bb:",
      "bb~",
      "bb\\",
      "bb@{",
      ".bb/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the bb namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("bb/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});

describe("enterInsertsNewline setting", () => {
  it("rejects a non-boolean persisted value", () => {
    const parsed = appSettingsSchema.safeParse({
      ...defaultAppSettings,
      enterInsertsNewline: "true",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("appSettingsUpdateSchema", () => {
  const {
    enterInsertsNewline: _omittedNewline,
    showDiagnosticEvents: _omittedDiagnostic,
    ...legacySettings
  } = defaultAppSettings;

  describe.each([
    {
      name: "current diagnostic field",
      payload: { ...legacySettings, showDiagnosticEvents: false },
    },
    {
      name: "legacy diagnostic field",
      payload: { ...legacySettings, showUnhandledProviderEvents: false },
    },
  ])("$name", ({ payload }) => {
    it.each([true, false])(
      "accepts an explicit enterInsertsNewline value of %s",
      (enterInsertsNewline) => {
        expect(
          appSettingsUpdateSchema.parse({ ...payload, enterInsertsNewline }),
        ).toMatchObject({ enterInsertsNewline });
      },
    );

    it("preserves optional-field absence for an older client", () => {
      expect(appSettingsUpdateSchema.parse(payload)).not.toHaveProperty(
        "enterInsertsNewline",
      );
    });

    it("rejects a non-boolean enterInsertsNewline value", () => {
      expect(
        appSettingsUpdateSchema.safeParse({
          ...payload,
          enterInsertsNewline: "on",
        }).success,
      ).toBe(false);
    });
  });

  it("still rejects a payload missing required legacy fields", () => {
    const { enterInsertsNewline: _omitted, ...legacy } = defaultAppSettings;
    const { showKeyboardHints: _required, ...partial } = legacy;
    expect(appSettingsUpdateSchema.safeParse(partial).success).toBe(false);
  });
});
