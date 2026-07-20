import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadConfig } from "../config";
import { normalizeMermaidCode } from "../utils";
import { runDiagramRender } from "./render";

export function registerDiagram(pi: ExtensionAPI) {
  pi.registerTool({
    name: "render_diagram",
    label: "Render Diagram",
    description:
      "Render the supported Mermaid subset to bounded terminal art or an SVG/HTML file: flowcharts, stateDiagram(-v2), sequenceDiagram, classDiagram, erDiagram, and xychart(-beta). Unsupported diagram headers fail clearly. Prefer terminal art inline and SVG/HTML for saved artifacts; an explicit outputPath is resolved from the working directory and safely serialized with other file mutations.",
    parameters: Type.Object(
      {
        code: Type.String({
          description:
            "Mermaid diagram definition. Use newlines as separators (for example, 'graph TD\\nA-->B'); semicolon separators are normalized while quoted label/message semicolons are preserved.",
        }),
        format: Type.Optional(
          StringEnum(["ascii", "svg", "html"] as const, {
            description:
              "Output format: ascii (terminal), svg (file), or html (browser file); defaults to configured diagramDefaultFormat",
          }),
        ),
        outputPath: Type.Optional(
          Type.String({ description: "Optional output file path for SVG/HTML or ASCII fallback" }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const code = normalizeMermaidCode(params.code);
      const format = params.format ?? loadConfig().diagramDefaultFormat;
      try {
        const { text, details } = await runDiagramRender(
          code,
          format,
          params.outputPath,
          ctx.cwd,
          signal,
          ctx.ui?.theme?.name ?? loadConfig().diagramTheme,
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
      const format = args.format ?? loadConfig().diagramDefaultFormat;
      return new Text(
        theme.fg("toolTitle", theme.bold("diagram ")) + theme.fg("muted", `diagram → ${format}`),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        const entry = result.content.find((candidate: any) => candidate.type === "text");
        const message = entry?.type === "text" ? entry.text : undefined;
        return new Text(
          theme.fg("error", `diagram error: ${message || "Tool execution failed"}`),
          0,
          0,
        );
      }
      const content = result.content[0];
      const display = content?.type === "text" ? content.text.slice(0, 120) : "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", display), 0, 0);
    },
  });

  pi.registerCommand("diagram", {
    description:
      "Render Mermaid diagram code. Usage: /diagram <code>, /diagram --svg <code>, /diagram --html <code>",
    handler: async (args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) return;
      if (!args) {
        ctx.ui.notify(
          "Usage: /diagram <mermaid code>  [/diagram --svg]  [/diagram --html]",
          "warning",
        );
        return;
      }

      const useSvg = args.includes("--svg");
      const useHtml = args.includes("--html");
      const code = normalizeMermaidCode(
        args
          .replace(/ --svg/g, "")
          .replace(/ --html/g, "")
          .trim(),
      );
      const format = useHtml ? "html" : useSvg ? "svg" : loadConfig().diagramDefaultFormat;
      try {
        const { text } = await runDiagramRender(
          code,
          format,
          undefined,
          ctx.cwd,
          ctx.signal,
          ctx.ui?.theme?.name ?? loadConfig().diagramTheme,
        );
        ctx.ui.notify(text, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Diagram failed: ${message}`, "error");
      }
    },
  });
}

export { runDiagramRender } from "./render";
