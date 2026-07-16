const test = require("node:test");
const assert = require("node:assert/strict");

const { buildPublicationPayload, selectContent } = require("../../src/helpers/notionExporter");

test("honors the caller's content source without re-deriving staleness", () => {
  const note = { content: "raw notes", enhanced_content: "enhanced notes" };
  assert.equal(selectContent(note, "enhanced"), "enhanced notes");
  assert.equal(selectContent(note, "original"), "raw notes");
  assert.equal(selectContent({ content: "raw notes" }, "enhanced"), "raw notes");
});

test("builds a payload from the enhanced content when requested", () => {
  const note = {
    id: 5,
    client_note_id: "client-5",
    title: "Weekly sync",
    content: "raw notes",
    enhanced_content: "## Summary\n\nEnhanced notes",
    note_type: "meeting",
    transcript: null,
    participants: null,
    created_at: "2026-07-16 10:00:00",
  };
  const payload = buildPublicationPayload(note, { contentSource: "enhanced" });
  const text = payload.blocks
    .flatMap((block) => block[block.type]?.rich_text || [])
    .map((part) => part.text?.content || "")
    .join("\n");
  assert.ok(text.includes("Enhanced notes"));
  assert.ok(!text.includes("raw notes"));
});
