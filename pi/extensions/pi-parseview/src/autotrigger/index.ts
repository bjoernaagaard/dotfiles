import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ActivationController } from "../tools/activation";

export type IntentCategory =
  | "diagram"
  | "preview"
  | "document.parse"
  | "document.query"
  | "document.screenshot"
  | "";

const DIAGRAM_ACTION =
  /\b((?:draw|render|create|make|generate|preview|show|display)\s+(?:(?:this|the|a|an)\s+)?(?:mermaid\s+(?:diagram|code)|diagram|flowchart|sequence\s+diagram|state\s+diagram|class\s+diagram|(?:er|entity[- ]relationship)\s+diagram))\b/gi;
const VISUAL_ACTION_SUBJECT =
  /\b((?:draw|visuali[sz]e|map)\s+(?:the\s+)?(?:architecture|pipeline|schema|hierarchy|timeline|relationships?|data\s+flow|service\s+relationships?)|show\s+(?:the\s+)?(?:architecture|pipeline|schema|hierarchy|timeline|relationships?|data\s+flow)\s+as\s+(?:a\s+)?(?:diagram|flowchart|chart))\b/gi;
const RENDERED_PREVIEW =
  /\b((?:render|preview)\s+(?:(?:this|the|a)\s+)?(?:markdown|latex|code|file|report|html|pdf|png|document)|open\s+(?:(?:this|the)\s+)?(?:file|report|document)\s+as\s+(?:an?\s+)?(?:html|pdf|png))\b/gi;
const DOCUMENT_SCREENSHOT =
  /\b(screenshot\s+(?:document\s+)?pages?|render\s+(?:cached\s+)?document\s+pages?|inspect\s+(?:the\s+)?(?:page|document)\s+layout)\b/gi;
const DOCUMENT_QUERY =
  /\b(query_document|(?:search|read|query|inspect)\s+(?:the\s+)?(?:cached\s+document|documentId\b))\b/gi;
const DOCUMENT_PARSE =
  /\b(parse_document|parse\s+(?:this\s+|the\s+|a\s+)?(?:document|pdf|image|file)|ocr\s+(?:this\s+|the\s+)?(?:document|pdf|image)|extract\s+text\s+from\s+(?:this\s+|the\s+)?(?:pdf|document|image))\b/gi;

const CATEGORY_TOOLS: Record<Exclude<IntentCategory, "">, string[]> = {
  diagram: ["render_diagram"],
  preview: ["preview_content"],
  "document.parse": ["parse_document"],
  "document.query": ["query_document"],
  "document.screenshot": ["screenshot_document"],
};

function matches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0].trim());
}

function stripQuotedExamples(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/“[^”]*”/g, " ");
}

export function matchKeywords(text: string): {
  matched: boolean;
  keywords: string[];
  category: IntentCategory;
} {
  const candidates: Array<[IntentCategory, RegExp[]]> = [
    ["document.screenshot", [DOCUMENT_SCREENSHOT]],
    ["document.query", [DOCUMENT_QUERY]],
    ["document.parse", [DOCUMENT_PARSE]],
    ["diagram", [DIAGRAM_ACTION, VISUAL_ACTION_SUBJECT]],
    ["preview", [RENDERED_PREVIEW]],
  ];
  const intentText = stripQuotedExamples(text);

  for (const [category, patterns] of candidates) {
    const keywords = patterns.flatMap((pattern) => matches(intentText, pattern));
    if (keywords.length > 0) return { matched: true, keywords: [...new Set(keywords)], category };
  }
  return { matched: false, keywords: [], category: "" };
}

export function buildGuidelines(_keywords: string[], category: IntentCategory): string {
  switch (category) {
    case "diagram":
      return [
        "• The prompt explicitly requests a diagram. Use `render_diagram`.",
        "  Prefer ASCII for inline display and SVG or HTML for a saved artifact.",
      ].join("\n");
    case "preview":
      return "• The prompt explicitly requests rendered output. Use `preview_content`; browser HTML needs no Chromium, while terminal PNG and PDF require Chromium, and the result reports the artifact path.";
    case "document.parse":
      return "• Parse the local regular file once with `parse_document`, choose OCR deliberately (`auto` uncertain, `on` scans, `off` born-digital), and retain its `documentId` for query/screenshot follow-up.";
    case "document.query":
      return "• Use `query_document` with the cached `documentId`: search to locate evidence, then request the smallest page/line window and follow explicit continuation or full-output recovery details.";
    case "document.screenshot":
      return "• Use `screenshot_document` only for the smallest cached page set whose visual layout is needed; start at 150 DPI and preserve its bounded path manifest.";
    default:
      return "";
  }
}

interface AutotriggerState {
  hasIntent: boolean;
  matchedKeywords: string[];
  category: IntentCategory;
  injectedThisTurn: boolean;
}

export function registerAutotrigger(pi: ExtensionAPI, activation?: ActivationController) {
  const state: AutotriggerState = {
    hasIntent: false,
    matchedKeywords: [],
    category: "",
    injectedThisTurn: false,
  };

  pi.on("input", async (event) => {
    state.hasIntent = false;
    state.matchedKeywords = [];
    state.category = "";
    state.injectedThisTurn = false;

    const result = matchKeywords(event.text);
    if (result.matched && result.category) {
      const requested = CATEGORY_TOOLS[result.category];
      const added = activation?.beginTurn(requested) ?? [];
      if (
        !activation ||
        added.length > 0 ||
        requested.some((name) => pi.getActiveTools().includes(name))
      ) {
        state.hasIntent = true;
        state.matchedKeywords = result.keywords;
        state.category = result.category;
      }
    } else {
      activation?.beginTurn([]);
    }

    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event) => {
    if (!state.hasIntent || state.injectedThisTurn) return;
    const guidelines = buildGuidelines(state.matchedKeywords, state.category);
    if (!guidelines) return;
    state.injectedThisTurn = true;
    return { systemPrompt: `${event.systemPrompt}\n\n${guidelines}` };
  });
}
