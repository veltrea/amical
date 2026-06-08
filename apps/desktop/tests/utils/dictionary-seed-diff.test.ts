import { describe, it, expect } from "vitest";
import {
  computeDictionariesToAdd,
  mergeNewDictionaries,
} from "../../src/services/dictionary-library/seed-diff";
import type {
  BundledDictionary,
  BundledDictionaryIndex,
} from "../../src/services/dictionary-library/catalog";

function dict(
  id: string,
  over: Partial<BundledDictionary> = {},
): BundledDictionary {
  return {
    id,
    name: id.toUpperCase(),
    description: "d",
    category: "general",
    language: "ja",
    tags: [],
    entryCount: 0,
    file: `${id}.json`,
    ...over,
  };
}

function index(version: number, ids: string[]): BundledDictionaryIndex {
  return { version, dictionaries: ids.map((id) => dict(id)) };
}

describe("computeDictionariesToAdd", () => {
  it("returns dictionaries shipped but not yet present", () => {
    const out = computeDictionariesToAdd(
      index(1, ["a", "b", "c"]),
      index(1, ["a"]),
    );
    expect(out.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("returns nothing when every shipped id already exists", () => {
    expect(
      computeDictionariesToAdd(index(1, ["a", "b"]), index(1, ["a", "b"])),
    ).toEqual([]);
  });

  it("returns all shipped dictionaries when the store is empty (first run)", () => {
    const out = computeDictionariesToAdd(index(1, ["a", "b"]), index(1, []));
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("never returns ids dropped from the bundle (does not delete user dictionaries)", () => {
    // "user-made" exists in the store but not the bundle; "a" is in both.
    expect(
      computeDictionariesToAdd(index(1, ["a"]), index(1, ["a", "user-made"])),
    ).toEqual([]);
  });

  it("collapses duplicate ids in the bundle to the first occurrence", () => {
    const bundled: BundledDictionaryIndex = {
      version: 1,
      dictionaries: [
        dict("a", { name: "first" }),
        dict("a", { name: "second" }),
      ],
    };
    const out = computeDictionariesToAdd(bundled, index(1, []));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("first");
  });

  it("does not mutate its inputs", () => {
    const bundled = index(1, ["a", "b"]);
    const current = index(1, ["a"]);
    computeDictionariesToAdd(bundled, current);
    expect(bundled.dictionaries).toHaveLength(2);
    expect(current.dictionaries).toHaveLength(1);
  });
});

describe("mergeNewDictionaries", () => {
  it("appends new dictionaries after existing ones, preserving order", () => {
    const next = mergeNewDictionaries(index(1, ["a", "b"]), 1, [
      dict("c"),
      dict("d"),
    ]);
    expect(next.dictionaries.map((d) => d.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("advances the version to the higher of current and bundled", () => {
    expect(mergeNewDictionaries(index(1, []), 3, []).version).toBe(3);
    expect(mergeNewDictionaries(index(5, []), 2, []).version).toBe(5);
  });

  it("returns an equivalent catalog when nothing is added", () => {
    const next = mergeNewDictionaries(index(2, ["a"]), 2, []);
    expect(next.dictionaries.map((d) => d.id)).toEqual(["a"]);
  });

  it("does not mutate the input catalog", () => {
    const current = index(1, ["a"]);
    mergeNewDictionaries(current, 1, [dict("b")]);
    expect(current.dictionaries).toHaveLength(1);
  });
});
