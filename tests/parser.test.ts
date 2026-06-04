// tests/parser.test.ts
import { describe, expect, test } from "bun:test";
import { parseTldrEmail } from "../src/parser";

const SAMPLE_TLDR_HTML = `
<html>
<body>
<table>
<tr><td>
<p>TLDR Newsletter — April 25, 2026</p>

<p><strong>TOGETHER WITH SOMECOMPANY</strong></p>
<p><a href="https://somecompany.com/promo?utm_source=tldrnewsletter">Try our amazing API for free (Sponsor)</a></p>
<p>SomeCompany lets you build APIs faster than ever. Sign up today for a free trial of our enterprise plan.</p>

<h2>BIG TECH &amp; STARTUPS</h2>

<p><a href="https://example.com/openai-news?utm_source=tldrnewsletter&utm_campaign=tldr_main">OpenAI announces new model (4 minute read)</a></p>
<p>OpenAI has announced a new frontier model called GPT-X with improved reasoning capabilities and a 10M token context window. The model is available via API starting today, with pricing comparable to GPT-4 Turbo.</p>

<p><a href="https://example.com/apple-news">Apple unveils new chip (3 minute read)</a></p>
<p>Apple has unveiled the M5 chip, which the company claims offers 30% better single-core performance than the M4. The chip will ship in MacBook Pros next month.</p>

<h2>SCIENCE &amp; FUTURISTIC TECHNOLOGY</h2>

<p><a href="https://example.com/biology-paper">Researchers achieve protein folding milestone (5 minute read)</a></p>
<p>A team at MIT has developed a new method for predicting protein structures that outperforms AlphaFold on a benchmark of 200 novel proteins.</p>

<p>Some footer text</p>
<p><a href="https://tldrnewsletter.com/unsubscribe?id=xyz">Unsubscribe</a></p>

</td></tr>
</table>
</body>
</html>
`;

describe("parseTldrEmail", () => {
  const parsed = parseTldrEmail("TLDR 2026-04-25", SAMPLE_TLDR_HTML);

  test("extracts edition from subject", () => {
    expect(parsed.edition).toBe("TLDR");
  });

  test("finds main items", () => {
    const headlines = parsed.items.map((i) => i.headline);
    expect(headlines).toContain("OpenAI announces new model");
    expect(headlines).toContain("Apple unveils new chip");
    expect(headlines).toContain(
      "Researchers achieve protein folding milestone",
    );
  });

  test("strips read-time annotation from headline", () => {
    const item = parsed.items.find((i) =>
      i.headline.startsWith("OpenAI announces"),
    );
    expect(item?.headline).toBe("OpenAI announces new model");
    expect(item?.readTime).toBe("4 minute read");
  });

  test("flags sponsor section as sponsor", () => {
    const sponsorItem = parsed.items.find((i) =>
      i.headline.toLowerCase().includes("api"),
    );
    expect(sponsorItem?.isSponsor).toBe(true);
  });

  test("attaches summary text to item", () => {
    const item = parsed.items.find((i) =>
      i.headline.startsWith("Apple unveils"),
    );
    expect(item?.summary).toContain("M5 chip");
  });

  test("captures section assignment", () => {
    const apple = parsed.items.find((i) =>
      i.headline.startsWith("Apple unveils"),
    );
    expect(apple?.section).toMatch(/big tech/i);
  });

  test("excludes unsubscribe footer link", () => {
    const headlines = parsed.items.map((i) => i.headline);
    expect(headlines).not.toContain("Unsubscribe");
  });

  test("extracts at least 4 items", () => {
    expect(parsed.items.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parseTldrEmail edition extraction", () => {
  test("plain TLDR", () => {
    expect(parseTldrEmail("TLDR 2026-04-25", "<html></html>").edition).toBe(
      "TLDR",
    );
  });

  test("TLDR AI", () => {
    expect(parseTldrEmail("TLDR AI 2026-04-25", "<html></html>").edition).toBe(
      "TLDR AI",
    );
  });

  test("TLDR Web Dev", () => {
    expect(
      parseTldrEmail("TLDR Web Dev 04-25-2026", "<html></html>").edition,
    ).toBe("TLDR Web Dev");
  });
});
