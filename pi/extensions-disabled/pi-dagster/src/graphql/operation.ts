/**
 * AST-based GraphQL operation selection and root-field extraction.
 * Used by generic query/mutation/subscription tools and mutation risk classification.
 * Never returns variables, argument values, or headers.
 */
import {
  Kind,
  parse,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type InlineFragmentNode,
  type OperationDefinitionNode,
  type SelectionNode,
} from "graphql";

export type GraphqlOperationType = "query" | "mutation" | "subscription";

export type SelectedOperation = {
  type: GraphqlOperationType;
  name?: string;
  /** Actual schema field names at the operation root (aliases resolved). */
  rootFields: string[];
};

export class GraphqlOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphqlOperationError";
  }
}

function opTypeFromNode(op: OperationDefinitionNode): GraphqlOperationType {
  return op.operation;
}

function collectFragmentMap(doc: DocumentNode): Map<string, FragmentDefinitionNode> {
  const map = new Map<string, FragmentDefinitionNode>();
  for (const def of doc.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) {
      map.set(def.name.value, def);
    }
  }
  return map;
}

/**
 * Extract root field names from a selection set, resolving top-level fragment
 * spreads and inline fragments. Aliases are ignored — FieldNode.name is used.
 */
export function extractRootFieldsFromSelection(
  selections: readonly SelectionNode[],
  fragments: Map<string, FragmentDefinitionNode>,
  visited: Set<string> = new Set(),
): string[] {
  const fields: string[] = [];
  for (const sel of selections) {
    if (sel.kind === Kind.FIELD) {
      fields.push((sel as FieldNode).name.value);
      continue;
    }
    if (sel.kind === Kind.INLINE_FRAGMENT) {
      const inline = sel as InlineFragmentNode;
      fields.push(
        ...extractRootFieldsFromSelection(inline.selectionSet.selections, fragments, visited),
      );
      continue;
    }
    if (sel.kind === Kind.FRAGMENT_SPREAD) {
      const name = sel.name.value;
      if (visited.has(name)) {
        throw new GraphqlOperationError(
          `Cyclic fragment spread detected: ${name}`,
        );
      }
      const frag = fragments.get(name);
      if (!frag) {
        throw new GraphqlOperationError(`Unknown fragment: ${name}`);
      }
      visited.add(name);
      try {
        fields.push(
          ...extractRootFieldsFromSelection(
            frag.selectionSet.selections,
            fragments,
            visited,
          ),
        );
      } finally {
        visited.delete(name);
      }
    }
  }
  return fields;
}

function selectOperationNode(
  doc: DocumentNode,
  operationName?: string,
): OperationDefinitionNode {
  const ops = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (ops.length === 0) {
    throw new GraphqlOperationError("GraphQL document contains no operation");
  }
  if (operationName) {
    const match = ops.find((o) => o.name?.value === operationName);
    if (!match) {
      throw new GraphqlOperationError(
        `Unknown operationName "${operationName}"`,
      );
    }
    return match;
  }
  if (ops.length > 1) {
    throw new GraphqlOperationError(
      "Multiple operations require operationName",
    );
  }
  return ops[0]!;
}

/**
 * Compatibility export. GraphQL supports only `#` comments, so hardened paths
 * parse the document verbatim instead of accepting non-standard block comments.
 */
export function normalizeGraphqlDocument(document: string): string {
  return document;
}

/**
 * Parse, select, and validate a GraphQL operation document.
 * Does not return variables or argument values.
 */

export function selectGraphqlOperation(input: {
  document: string;
  operationName?: string;
  expectedType?: GraphqlOperationType;
}): SelectedOperation {
  const raw = normalizeGraphqlDocument(input.document ?? "").trim();
  if (!raw) {
    throw new GraphqlOperationError("GraphQL document is empty");
  }

  let doc: DocumentNode;
  try {
    doc = parse(raw);
  } catch (err) {
    // GraphQL parser messages may echo malformed string literals. Surface only
    // structural location metadata so documents containing credentials cannot leak.
    const locations =
      err && typeof err === "object" && "locations" in err
        ? (err as { locations?: Array<{ line?: number; column?: number }> }).locations
        : undefined;
    const first = locations?.[0];
    const where =
      first?.line != null && first?.column != null
        ? ` at line ${first.line}, column ${first.column}`
        : "";
    throw new GraphqlOperationError(`Invalid GraphQL document${where}`);
  }

  const op = selectOperationNode(doc, input.operationName?.trim() || undefined);
  const type = opTypeFromNode(op);

  if (input.expectedType && type !== input.expectedType) {
    throw new GraphqlOperationError(
      `Expected ${input.expectedType} operation but selected is ${type}` +
        (op.name?.value ? ` ("${op.name.value}")` : ""),
    );
  }

  const fragments = collectFragmentMap(doc);
  const rootFields = extractRootFieldsFromSelection(
    op.selectionSet.selections,
    fragments,
  );

  if (rootFields.length === 0) {
    throw new GraphqlOperationError("Selected operation has empty root selection");
  }

  return {
    type,
    name: op.name?.value,
    rootFields,
  };
}

/** Compatibility: true when document is a query (single-op or unambiguous). */
export function isQueryDocument(document: string): boolean {
  try {
    const selected = selectGraphqlOperation({ document });
    return selected.type === "query";
  } catch {
    // Fall back to keyword heuristic for partial / bare docs
    return /^\s*query\b/i.test(document.replace(/#[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim());
  }
}

export function isMutationDocumentStrict(document: string): boolean {
  try {
    const selected = selectGraphqlOperation({ document });
    return selected.type === "mutation";
  } catch {
    const stripped = document
      .replace(/#[^\n\r]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    if (!stripped) return false;
    if (/^query\b/i.test(stripped)) return false;
    if (/^subscription\b/i.test(stripped)) return false;
    if (/^mutation\b/i.test(stripped)) return true;
    return true;
  }
}

export function isSubscriptionDocument(document: string): boolean {
  try {
    const selected = selectGraphqlOperation({ document });
    return selected.type === "subscription";
  } catch {
    return /^\s*subscription\b/i.test(
      document.replace(/#[^\n\r]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    );
  }
}
