import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  serializeDictionaryFile,
  serializeIndex,
  parseBlankLineGroups,
  upsertIndexEntry,
  removeIndexEntry,
  setEntryCount,
  addEntry,
  updateEntry,
  removeEntry,
} from "../../src/services/dictionary-library/serialize";
import type {
  BundledDictionary,
  BundledDictionaryIndex,
  DictionaryEntry,
  DictionaryFile,
} from "../../src/services/dictionary-library/catalog";

const here = path.dirname(fileURLToPath(import.meta.url));
const DICT_DIR = path.join(here, "../../assets/dictionaries");

function read(file: string): string {
  return readFileSync(path.join(DICT_DIR, file), "utf8");
}

describe("serialize round-trip (formatting preservation)", () => {
  const allJson = readdirSync(DICT_DIR).filter((f) => f.endsWith(".json"));
  const dictFiles = allJson.filter((f) => f !== "index.json");

  // Guard: prove the asset path resolved (otherwise the loop below is empty
  // and silently passes). The bundle ships dozens of dictionaries.
  it("finds the bundled dictionary assets", () => {
    expect(dictFiles.length).toBeGreaterThan(50);
  });

  // Exact byte round-trip, hand-authored blank-line group separators included:
  // recover the separators from the raw text and feed them back in. This pins
  // every formatting detail (indent, one entry per line, trailing-comma
  // placement, group separators, EOF newline) so a GUI edit is a minimal diff.
  for (const f of dictFiles) {
    it(`round-trips ${f} exactly`, () => {
      const raw = read(f);
      const parsed = JSON.parse(raw) as DictionaryFile;
      const blankAfter = parseBlankLineGroups(raw);
      expect(serializeDictionaryFile(parsed, blankAfter)).toBe(raw);
    });
  }

  it("round-trips index.json exactly", () => {
    const raw = read("index.json");
    const parsed = JSON.parse(raw) as BundledDictionaryIndex;
    expect(serializeIndex(parsed)).toBe(raw);
  });
});

describe("blank-line group separators", () => {
  it("parses the word before each blank line", () => {
    const raw = [
      "{",
      `  "version": 1,`,
      `  "entries": [`,
      `    { "word": "a", "replacementWord": null, "isReplacement": false },`,
      ``,
      `    { "word": "b", "replacementWord": null, "isReplacement": false },`,
      `    { "word": "c", "replacementWord": null, "isReplacement": false }`,
      `  ]`,
      "}",
      "",
    ].join("\n");
    expect(parseBlankLineGroups(raw)).toEqual(["a"]);
  });

  it("re-emits a separator after the marked word but never before `]`", () => {
    const file: DictionaryFile = {
      version: 1,
      entries: [
        { word: "a", replacementWord: null, isReplacement: false },
        { word: "b", replacementWord: null, isReplacement: false },
      ],
    };
    // Separator after "a" is reproduced; one requested after the last entry
    // "b" is dropped (it would land right before the closing bracket).
    expect(serializeDictionaryFile(file, ["a", "b"])).toBe(
      `{\n  "version": 1,\n  "entries": [\n` +
        `    { "word": "a", "replacementWord": null, "isReplacement": false },\n` +
        `\n` +
        `    { "word": "b", "replacementWord": null, "isReplacement": false }\n` +
        `  ]\n}\n`,
    );
  });

  it("emits no separators when blankAfter is omitted", () => {
    const file: DictionaryFile = {
      version: 1,
      entries: [
        { word: "a", replacementWord: null, isReplacement: false },
        { word: "b", replacementWord: null, isReplacement: false },
      ],
    };
    expect(serializeDictionaryFile(file)).not.toContain("\n\n");
  });

  it("round-trips a parsed separator set back through the serializer", () => {
    const raw =
      `{\n  "version": 1,\n  "entries": [\n` +
      `    { "word": "x", "replacementWord": null, "isReplacement": false },\n` +
      `\n` +
      `    { "word": "y", "replacementWord": null, "isReplacement": false }\n` +
      `  ]\n}\n`;
    const parsed = JSON.parse(raw) as DictionaryFile;
    expect(serializeDictionaryFile(parsed, parseBlankLineGroups(raw))).toBe(raw);
  });
});

describe("serializeDictionaryFile edge cases", () => {
  it("renders an empty entries array inline", () => {
    const file: DictionaryFile = { version: 1, entries: [] };
    expect(serializeDictionaryFile(file)).toBe(
      `{\n  "version": 1,\n  "entries": []\n}\n`,
    );
  });

  it("omits exportedAt when absent", () => {
    const file: DictionaryFile = {
      version: 1,
      entries: [{ word: "a", replacementWord: null, isReplacement: false }],
    };
    expect(serializeDictionaryFile(file)).toBe(
      `{\n  "version": 1,\n  "entries": [\n    { "word": "a", "replacementWord": null, "isReplacement": false }\n  ]\n}\n`,
    );
  });

  it("includes exportedAt when present", () => {
    const file: DictionaryFile = {
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      entries: [],
    };
    expect(serializeDictionaryFile(file)).toContain(
      `"exportedAt": "2026-01-01T00:00:00.000Z"`,
    );
  });

  it("renders a replacement entry with a string replacementWord", () => {
    const file: DictionaryFile = {
      version: 1,
      entries: [
        { word: "ついったー", replacementWord: "Twitter", isReplacement: true },
      ],
    };
    expect(serializeDictionaryFile(file)).toContain(
      `    { "word": "ついったー", "replacementWord": "Twitter", "isReplacement": true }`,
    );
  });
});

describe("serializeIndex edge cases", () => {
  it("omits name_ja / description_ja when absent and renders tags inline", () => {
    const index: BundledDictionaryIndex = {
      version: 1,
      dictionaries: [
        {
          id: "x",
          name: "X",
          description: "d",
          category: "general",
          language: "ja",
          tags: ["a", "b"],
          entryCount: 0,
          file: "x.json",
        },
      ],
    };
    const out = serializeIndex(index);
    expect(out).toContain(`"tags": ["a", "b"],`);
    expect(out).not.toContain("name_ja");
    expect(out).not.toContain("description_ja");
  });
});

describe("index transforms", () => {
  const base: BundledDictionaryIndex = {
    version: 1,
    dictionaries: [
      {
        id: "a",
        name: "A",
        description: "d",
        category: "general",
        language: "ja",
        tags: ["x"],
        entryCount: 1,
        file: "a.json",
      },
    ],
  };

  it("upsert adds a new dictionary and leaves the source untouched", () => {
    const meta: BundledDictionary = {
      id: "b",
      name: "B",
      description: "d",
      category: "general",
      language: "ja",
      tags: [],
      entryCount: 0,
      file: "b.json",
    };
    const next = upsertIndexEntry(base, meta);
    expect(next.dictionaries).toHaveLength(2);
    expect(next.dictionaries[1].id).toBe("b");
    expect(base.dictionaries).toHaveLength(1);
  });

  it("upsert replaces an existing dictionary by id", () => {
    const meta: BundledDictionary = { ...base.dictionaries[0], name: "A2" };
    const next = upsertIndexEntry(base, meta);
    expect(next.dictionaries).toHaveLength(1);
    expect(next.dictionaries[0].name).toBe("A2");
  });

  it("remove drops a dictionary by id", () => {
    expect(removeIndexEntry(base, "a").dictionaries).toHaveLength(0);
  });

  it("setEntryCount updates only the matching dictionary", () => {
    const next = setEntryCount(base, "a", 42);
    expect(next.dictionaries[0].entryCount).toBe(42);
    expect(base.dictionaries[0].entryCount).toBe(1);
  });
});

describe("entry transforms", () => {
  const entries: DictionaryEntry[] = [
    { word: "a", replacementWord: null, isReplacement: false },
    { word: "b", replacementWord: "B", isReplacement: true },
  ];

  it("addEntry appends and is immutable", () => {
    const next = addEntry(entries, {
      word: "c",
      replacementWord: null,
      isReplacement: false,
    });
    expect(next).toHaveLength(3);
    expect(entries).toHaveLength(2);
  });

  it("addEntry rejects a duplicate word", () => {
    expect(() =>
      addEntry(entries, {
        word: "a",
        replacementWord: null,
        isReplacement: false,
      }),
    ).toThrow();
  });

  it("updateEntry replaces by original word", () => {
    const next = updateEntry(entries, "a", {
      word: "a",
      replacementWord: "X",
      isReplacement: true,
    });
    expect(next[0].replacementWord).toBe("X");
  });

  it("updateEntry can rename a word", () => {
    const next = updateEntry(entries, "a", {
      word: "z",
      replacementWord: null,
      isReplacement: false,
    });
    expect(next.find((e) => e.word === "z")).toBeTruthy();
    expect(next.find((e) => e.word === "a")).toBeFalsy();
  });

  it("updateEntry rejects renaming onto an existing word", () => {
    expect(() =>
      updateEntry(entries, "a", {
        word: "b",
        replacementWord: null,
        isReplacement: false,
      }),
    ).toThrow();
  });

  it("updateEntry throws when the original word is missing", () => {
    expect(() =>
      updateEntry(entries, "missing", {
        word: "q",
        replacementWord: null,
        isReplacement: false,
      }),
    ).toThrow();
  });

  it("removeEntry drops by word", () => {
    expect(removeEntry(entries, "a")).toHaveLength(1);
  });

  it("removeEntry throws when missing", () => {
    expect(() => removeEntry(entries, "missing")).toThrow();
  });
});
