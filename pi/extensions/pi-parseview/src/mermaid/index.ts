import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { runDiagramRender, type DiagramFormat } from "../diagram/render";
import { normalizeMermaidCode } from "../utils";

/** Registered only as an inactive compatibility bridge for stored tool calls. */
export function registerMermaid(pi: ExtensionAPI) {
  pi.registerTool({
    name: "mermaid",
    label: "Mermaid (Compatibility)",
    description:
      "Compatibility alias for older stored calls. Render Mermaid code to bounded ASCII, SVG, or HTML; new calls should use render_diagram.",
    parameters: Type.Object(
      {
        code: Type.String({ description: "Mermaid diagram definition" }),
        format: Type.Optional(
          StringEnum(["ascii", "svg", "html"] as const, {
            description: "Output format; defaults to ascii",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const format = (params.format ?? "ascii") as DiagramFormat;
      try {
        const { text, details } = await runDiagramRender(
          normalizeMermaidCode(params.code),
          format,
          undefined,
          ctx.cwd,
          signal,
        );
        return { content: [{ type: "text" as const, text }], details };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Diagram render failed. The diagram may have unsupported syntax: ${message}`,
        );
      }
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("mermaid ")) +
          theme.fg("muted", `chart → ${args.format ?? "ascii"}`),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const content = result.content[0];
      const display = content?.type === "text" ? content.text.slice(0, 120) : "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", display), 0, 0);
    },
  });
}
