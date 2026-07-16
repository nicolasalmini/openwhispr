const MarkdownIt = require("markdown-it");

const MAX_RICH_TEXT_LENGTH = 1900;
const MAX_BLOCKS_PER_REQUEST = 100;
// Notion caps the total number of block elements per append request — including
// nested children (e.g. a toggle's collapsed body) — at 1000.
const MAX_ELEMENTS_PER_REQUEST = 1000;
const MAX_REQUEST_BYTES = 450000;

const CODE_LANGUAGE_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "shell",
  bash: "shell",
  yml: "yaml",
  py: "python",
  rb: "ruby",
};
const CODE_LANGUAGES = new Set([
  "abap",
  "arduino",
  "bash",
  "basic",
  "c",
  "c#",
  "c++",
  "clojure",
  "coffeescript",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "elm",
  "erlang",
  "flow",
  "fortran",
  "f#",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "lua",
  "makefile",
  "markdown",
  "matlab",
  "mermaid",
  "nix",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "python",
  "r",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "solidity",
  "sql",
  "swift",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#",
]);

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

function splitText(value, maxLength = MAX_RICH_TEXT_LENGTH) {
  const text = String(value || "");
  if (!text) return [""];

  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\s+/, "");
  }
  if (remaining || chunks.length === 0) chunks.push(remaining);
  return chunks;
}

function annotationsFromState(state) {
  return {
    bold: state.bold > 0,
    italic: state.italic > 0,
    strikethrough: state.strikethrough > 0,
    underline: false,
    code: state.code > 0,
    color: "default",
  };
}

function richTextObject(content, state) {
  const link = state.links.length ? state.links[state.links.length - 1] : null;
  return {
    type: "text",
    text: {
      content,
      ...(link ? { link: { url: link.slice(0, 2000) } } : {}),
    },
    annotations: annotationsFromState(state),
  };
}

function normalizeCodeLanguage(value) {
  const requested = String(value || "plain text")
    .trim()
    .toLowerCase();
  const normalized = CODE_LANGUAGE_ALIASES[requested] || requested;
  return CODE_LANGUAGES.has(normalized) ? normalized : "plain text";
}

function inlineTokensToRichText(children = []) {
  const richText = [];
  const state = { bold: 0, italic: 0, strikethrough: 0, code: 0, links: [] };

  for (const token of children) {
    switch (token.type) {
      case "strong_open":
        state.bold += 1;
        break;
      case "strong_close":
        state.bold = Math.max(0, state.bold - 1);
        break;
      case "em_open":
        state.italic += 1;
        break;
      case "em_close":
        state.italic = Math.max(0, state.italic - 1);
        break;
      case "s_open":
        state.strikethrough += 1;
        break;
      case "s_close":
        state.strikethrough = Math.max(0, state.strikethrough - 1);
        break;
      case "link_open":
        state.links.push(token.attrGet("href") || "");
        break;
      case "link_close":
        state.links.pop();
        break;
      case "code_inline": {
        const codeState = { ...state, code: state.code + 1 };
        for (const chunk of splitText(token.content)) {
          richText.push(richTextObject(chunk, codeState));
        }
        break;
      }
      case "softbreak":
      case "hardbreak":
        richText.push(richTextObject("\n", state));
        break;
      case "text":
        for (const chunk of splitText(token.content)) {
          richText.push(richTextObject(chunk, state));
        }
        break;
      default:
        break;
    }
  }

  return richText;
}

function makeBlock(type, richText, extra = {}) {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: richText,
      color: "default",
      ...extra,
    },
  };
}

function parseInlineMarkdown(value) {
  const tokens = markdown.parseInline(String(value || ""), {});
  return inlineTokensToRichText(tokens[0]?.children || []);
}

function markdownToBlocks(source) {
  const tokens = markdown.parse(String(source || ""), {});
  const blocks = [];
  const listStack = [];
  let quoteDepth = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "bullet_list_open") {
      listStack.push("bulleted_list_item");
      continue;
    }
    if (token.type === "ordered_list_open") {
      listStack.push("numbered_list_item");
      continue;
    }
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
      listStack.pop();
      continue;
    }
    if (token.type === "blockquote_open") {
      quoteDepth += 1;
      continue;
    }
    if (token.type === "blockquote_close") {
      quoteDepth = Math.max(0, quoteDepth - 1);
      continue;
    }
    if (token.type === "hr") {
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }
    if (token.type === "fence" || token.type === "code_block") {
      const language = normalizeCodeLanguage(
        (token.info || "plain text").trim().split(/\s+/)[0] || "plain text"
      );
      for (const chunk of splitText(token.content)) {
        blocks.push(
          makeBlock(
            "code",
            [richTextObject(chunk, { bold: 0, italic: 0, strikethrough: 0, code: 0, links: [] })],
            {
              language,
            }
          )
        );
      }
      continue;
    }
    if (token.type !== "inline") continue;

    const parent = tokens[index - 1];
    const listType = listStack[listStack.length - 1];
    let type = "paragraph";
    let extra = {};
    let children = token.children || [];

    if (parent?.type === "heading_open") {
      const level = Math.min(3, Math.max(1, Number(parent.tag.slice(1)) || 1));
      type = `heading_${level}`;
    } else if (listType) {
      const checkbox = token.content.match(/^\[([ xX])\]\s*/);
      if (checkbox) {
        type = "to_do";
        extra = { checked: checkbox[1].toLowerCase() === "x" };
        const withoutCheckbox = token.content.slice(checkbox[0].length);
        children = markdown.parseInline(withoutCheckbox, {})[0]?.children || [];
      } else {
        type = listType;
      }
    } else if (quoteDepth > 0) {
      type = "quote";
    }

    const richText = inlineTokensToRichText(children);
    const resolvedRichText = richText.length ? richText : parseInlineMarkdown(token.content);
    for (let offset = 0; offset < resolvedRichText.length; offset += 100) {
      blocks.push(makeBlock(type, resolvedRichText.slice(offset, offset + 100), extra));
    }
  }

  return blocks;
}

function paragraphBlock(value) {
  return makeBlock("paragraph", parseInlineMarkdown(value));
}

function headingBlock(value, level = 2) {
  const safeLevel = Math.min(3, Math.max(1, level));
  return makeBlock(`heading_${safeLevel}`, parseInlineMarkdown(value));
}

function toggleBlocks(title, content) {
  const children = markdownToBlocks(content);
  if (children.length === 0) return [];

  const groups = [];
  for (let index = 0; index < children.length; index += MAX_BLOCKS_PER_REQUEST) {
    groups.push(children.slice(index, index + MAX_BLOCKS_PER_REQUEST));
  }

  return groups.map((group, index) => ({
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: parseInlineMarkdown(index === 0 ? title : `${title} (continued)`),
      color: "default",
      children: group,
    },
  }));
}

// A block counts as itself plus every descendant it nests (Notion tallies these
// toward the per-request element limit), so a toggle carrying a 100-block body
// is 101 elements, not one.
function countBlockElements(block) {
  const children = block?.[block.type]?.children;
  if (!Array.isArray(children)) return 1;
  return children.reduce((total, child) => total + countBlockElements(child), 1);
}

function batchBlocks(blocks, size = MAX_BLOCKS_PER_REQUEST, maxBytes = MAX_REQUEST_BYTES) {
  if (!Array.isArray(blocks)) throw new TypeError("blocks must be an array");
  if (!Number.isInteger(size) || size < 1 || size > MAX_BLOCKS_PER_REQUEST) {
    throw new RangeError(`batch size must be between 1 and ${MAX_BLOCKS_PER_REQUEST}`);
  }
  const batches = [];
  let batch = [];
  let bytes = 0;
  let elements = 0;
  for (const block of blocks) {
    const blockBytes = Buffer.byteLength(JSON.stringify(block), "utf8");
    if (blockBytes > maxBytes)
      throw new RangeError("A Notion block exceeds the request size limit");
    const blockElements = countBlockElements(block);
    if (
      batch.length &&
      (batch.length >= size ||
        bytes + blockBytes > maxBytes ||
        elements + blockElements > MAX_ELEMENTS_PER_REQUEST)
    ) {
      batches.push(batch);
      batch = [];
      bytes = 0;
      elements = 0;
    }
    batch.push(block);
    bytes += blockBytes;
    elements += blockElements;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

module.exports = {
  MAX_BLOCKS_PER_REQUEST,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_REQUEST_BYTES,
  MAX_RICH_TEXT_LENGTH,
  batchBlocks,
  countBlockElements,
  headingBlock,
  markdownToBlocks,
  normalizeCodeLanguage,
  paragraphBlock,
  parseInlineMarkdown,
  splitText,
  toggleBlocks,
};
