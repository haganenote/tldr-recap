// tests/url.test.ts
import { describe, expect, test } from "bun:test";
import { canonicalizeUrl, getDomain, hashUrl } from "../src/url";

describe("canonicalizeUrl", () => {
  test("strips utm params", () => {
    const url =
      "https://example.com/article?utm_source=tldrnewsletter&utm_medium=email&id=123";
    expect(canonicalizeUrl(url)).toBe("https://example.com/article?id=123");
  });

  test("strips all known tracking params", () => {
    const url =
      "https://example.com/x?ref=newsletter&mc_eid=abc&fbclid=xxx&real=keep";
    expect(canonicalizeUrl(url)).toBe("https://example.com/x?real=keep");
  });

  test("lowercases hostname", () => {
    const url = "https://Example.COM/path";
    expect(canonicalizeUrl(url)).toBe("https://example.com/path");
  });

  test("trims trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/path/")).toBe(
      "https://example.com/path",
    );
  });

  test("keeps root slash", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  test("drops fragment", () => {
    expect(canonicalizeUrl("https://example.com/path#section")).toBe(
      "https://example.com/path",
    );
  });

  test("returns input on invalid url", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });

  test("two TLDR links to same article hash identically", () => {
    const a =
      "https://openai.com/blog/announcement?utm_source=tldrnewsletter&utm_campaign=tldr_ai";
    const b =
      "https://openai.com/blog/announcement?utm_source=tldrnewsletter&utm_campaign=tldr_main";
    expect(hashUrl(canonicalizeUrl(a))).toBe(hashUrl(canonicalizeUrl(b)));
  });
});

describe("getDomain", () => {
  test("extracts domain", () => {
    expect(getDomain("https://example.com/path")).toBe("example.com");
  });
  test("strips www", () => {
    expect(getDomain("https://www.example.com/path")).toBe("example.com");
  });
  test("returns null on invalid", () => {
    expect(getDomain("not a url")).toBeNull();
  });
});
