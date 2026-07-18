import { Type, type Static } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export const QUESTDB_DOCS_INDEX = "https://questdb.com/docs/llms.txt";
export const QUESTDB_DOCS_ORIGIN = "https://questdb.com/docs/";

const MD_URL_RE = /\bhttps:\/\/questdb\.com\/docs\/[\w./-]+\.md(?:#[^\s)]*)?/gi;
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

export const DocsToolSchema = Type.Object({
	action: StringEnum(["search", "fetch"] as const, {
		description: "Search references or fetch a docs page URL/path",
	}),
	query: Type.Optional(Type.String({ description: "Search phrase for llms.txt references." })),
	path: Type.Optional(Type.String({ description: "Optional full URL under https://questdb.com/docs/ or relative path." })),
	maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
});

export type DocsToolParams = Static<typeof DocsToolSchema>;

function enforceDocsOrigin(url: string): URL {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:") {
		throw new Error("Only https://questdb.com/docs/ URLs are allowed.");
	}
	if (!parsed.href.startsWith(QUESTDB_DOCS_ORIGIN)) {
		throw new Error("Only URLs under https://questdb.com/docs/ are allowed.");
	}
	return parsed;
}

type DocMatch = {
	url: string;
	text: string;
};

export function parseDocsReferences(llmsText: string): DocMatch[] {
	const matches: DocMatch[] = [];
	const seen = new Set<string>();

	for (const line of llmsText.split(/\r?\n/)) {
		const plain = line.trim();
		if (!plain) continue;

		const urls = plain.match(MD_URL_RE);
		if (urls?.length) {
			for (const raw of urls) {
				const normalized = raw.trim();
				if (seen.has(normalized)) continue;
				seen.add(normalized);
				matches.push({ url: normalized, text: plain });
			}
			continue;
		}

		let match: RegExpExecArray | null;
		MD_LINK_RE.lastIndex = 0;
		while ((match = MD_LINK_RE.exec(plain)) !== null) {
			const raw = match[1]?.trim();
			if (!raw) continue;
			if (!/\.md(\?|#|$)/.test(raw.toLowerCase())) continue;
			if (!raw.toLowerCase().startsWith("https://questdb.com/docs/")) continue;
			if (seen.has(raw)) continue;
			seen.add(raw);
			matches.push({ url: raw, text: plain });
		}
	}

	return matches;
}

export function resolveDocsRequest(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error("Doc path is empty.");
	}
	if (trimmed.includes("..")) {
		throw new Error("Doc path cannot contain '..'.");
	}

	if (/^https?:\/\//i.test(trimmed)) {
		const parsed = enforceDocsOrigin(trimmed);
		if (parsed.pathname.endsWith("/") || !/\.md(\?|#|$)/i.test(parsed.pathname)) {
			const noHash = parsed.pathname.endsWith("/") ? `${parsed.pathname}index.md` : `${parsed.pathname}.md`;
			return `${parsed.origin}${noHash}${parsed.search}${parsed.hash}`;
		}
		return parsed.toString();
	}

	const normalized = trimmed.replace(/^\/+/, "");
	const docPath = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
	const originUrl = `${QUESTDB_DOCS_ORIGIN}${docPath}`;
	return enforceDocsOrigin(originUrl).toString();
}

export function filterDocReferences(matches: DocMatch[], query: string, maxResults: number): DocMatch[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return matches.slice(0, maxResults);
	}
	return matches
		.filter((match) => match.url.toLowerCase().includes(normalized) || match.text.toLowerCase().includes(normalized))
		.slice(0, maxResults);
}
