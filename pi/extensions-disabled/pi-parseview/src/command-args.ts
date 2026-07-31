/**
 * Parse the small shell-like argument surface used by ParseView commands.
 *
 * This is intentionally not a shell parser: it only handles quoting and
 * escaping needed to keep paths with spaces together, without executing or
 * expanding anything.
 */
export function parseCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let tokenStarted = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
        tokenStarted = true;
        continue;
      }
      if (char === "\\" && index + 1 < input.length) {
        const next = input[index + 1];
        if (next === quote || next === "\\") {
          token += next;
          tokenStarted = true;
          index += 1;
          continue;
        }
      }
      token += char;
      tokenStarted = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (char === "\\" && index + 1 < input.length) {
      const next = input[index + 1];
      if (next === '"' || next === "'" || next === "\\" || /\s/.test(next)) {
        token += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += char;
    tokenStarted = true;
  }

  if (quote) throw new Error("Unterminated quote in command arguments");
  if (tokenStarted) tokens.push(token);
  return tokens;
}

/** Normalize exactly one leading @, matching Pi's path-tool convention. */
export function stripLeadingAt(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}
