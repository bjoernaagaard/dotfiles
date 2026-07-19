export type DiagnosticCode =
  | "policy-leak"
  | "generic-opener"
  | "generic-closer"
  | "large-primary-list";

export interface ResponseDiagnostic {
  code: DiagnosticCode;
  message: string;
}

export function diagnoseResponse(text: string): ResponseDiagnostic[] {
  const diagnostics: ResponseDiagnostic[] = [];
  const normalized = text.trim();

  if (/\b(?:focus rail|adhd extension|response policy)\b/i.test(normalized)) {
    diagnostics.push({ code: "policy-leak", message: "The response exposed the hidden interaction policy." });
  }
  if (/^(?:great question|sure[!,.:]|let me|i(?:'ll| will) start by|to answer your question)\b/i.test(normalized)) {
    diagnostics.push({ code: "generic-opener", message: "The response starts with a generic preamble." });
  }
  if (/(?:hope this helps|let me know if|feel free to ask|happy to clarify)[.!]?$/i.test(normalized)) {
    diagnostics.push({ code: "generic-closer", message: "The response ends with a generic closer." });
  }
  const primaryItems = normalized.match(/^\s*\d+[.)]\s+/gm) ?? [];
  if (primaryItems.length > 5) {
    diagnostics.push({ code: "large-primary-list", message: "The primary numbered list has more than five items." });
  }
  return diagnostics;
}
