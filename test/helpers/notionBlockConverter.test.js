const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_ELEMENTS_PER_REQUEST,
  batchBlocks,
  countBlockElements,
  markdownToBlocks,
  normalizeCodeLanguage,
  splitText,
  toggleBlocks,
} = require("../../src/helpers/notionBlockConverter");

test("converts supported Markdown constructs to Notion blocks", () => {
  const blocks = markdownToBlocks(`# Heading

Paragraph with **bold**, *italic*, \`code\`, and [a link](https://example.com).

- Bullet
- [x] Done
- [ ] Pending

1. First

> Quoted

---

\`\`\`js
const ok = true;
\`\`\``);

  assert.deepEqual(
    blocks.map((block) => block.type),
    [
      "heading_1",
      "paragraph",
      "bulleted_list_item",
      "to_do",
      "to_do",
      "numbered_list_item",
      "quote",
      "divider",
      "code",
    ]
  );
  assert.equal(blocks[3].to_do.checked, true);
  assert.equal(blocks[4].to_do.checked, false);
  const paragraph = blocks[1].paragraph.rich_text;
  assert.ok(paragraph.some((item) => item.annotations.bold));
  assert.ok(paragraph.some((item) => item.annotations.italic));
  assert.ok(paragraph.some((item) => item.annotations.code));
  assert.ok(paragraph.some((item) => item.text.link?.url === "https://example.com"));
  assert.equal("plain_text" in paragraph[0], false);
  assert.equal(normalizeCodeLanguage("js"), "javascript");
  assert.equal(normalizeCodeLanguage("not-a-real-language"), "plain text");
});

test("splits rich text under the Notion 2,000-character limit", () => {
  const input = `${"word ".repeat(900)}tail`;
  const chunks = splitText(input);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1900));
  assert.equal(chunks.join(" ").replace(/\s+/g, " ").trim(), input.replace(/\s+/g, " ").trim());
});

test("transcript toggles and append batches never exceed 100 children", () => {
  const transcript = Array.from({ length: 235 }, (_, index) => `Line ${index + 1}`).join("\n\n");
  const toggles = toggleBlocks("Transcript", transcript);
  assert.equal(toggles.length, 3);
  assert.ok(toggles.every((toggle) => toggle.toggle.children.length <= 100));

  const blocks = markdownToBlocks(transcript);
  const batches = batchBlocks(blocks);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 100, 35]
  );
});

test("append batching also stays under the request byte budget", () => {
  const blocks = markdownToBlocks(Array.from({ length: 100 }, () => "x".repeat(1800)).join("\n\n"));
  const batches = batchBlocks(blocks, 100, 20_000);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => Buffer.byteLength(JSON.stringify(batch), "utf8") < 21_000));
});

test("counts a toggle's nested children toward the element total", () => {
  const transcript = Array.from({ length: 99 }, (_, index) => `Line ${index + 1}`).join("\n\n");
  const [toggle] = toggleBlocks("Transcript", transcript);
  assert.equal(toggle.toggle.children.length, 99);
  assert.equal(countBlockElements(toggle), 100);
});

test("splits batches so nested children stay under the per-request element cap", () => {
  // Each toggle carries 100 children -> 101 elements; 20 of them would be 2020
  // elements in one request without nested accounting.
  const transcript = Array.from({ length: 100 }, (_, index) => `Line ${index + 1}`).join("\n\n");
  const toggles = Array.from({ length: 20 }, () => toggleBlocks("Transcript", transcript)[0]);

  const batches = batchBlocks(toggles);
  assert.ok(batches.length > 1);
  for (const batch of batches) {
    const elements = batch.reduce((total, block) => total + countBlockElements(block), 0);
    assert.ok(elements <= MAX_ELEMENTS_PER_REQUEST);
  }
  assert.equal(
    batches.reduce((total, batch) => total + batch.length, 0),
    toggles.length
  );
});
