import { marked, Marked } from 'marked';
import DOMPurify from 'dompurify';

// ──────────────── Markdown Safety (Layer 1 + Layer 2) ────────────────
//
// Layer 1: configure the global `marked` singleton to escape inline HTML
// at parse time. `<script>alert(1)</script>` in a markdown body becomes
// the literal text `&lt;script&gt;alert(1)&lt;/script&gt;` rather than
// executable HTML. Markdown formatting (links, lists, bold, code,
// headings, blockquotes, tables) is unaffected.
//
// Configured here, at module load. `+layout.svelte` side-effect imports
// this module so the config runs before any `marked.parse` call in the
// app, including those in print.ts that don't transitively import
// markdown.ts.

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

marked.use({
	renderer: {
		html(token: any) {
			const raw = typeof token === 'string' ? token : (token.text ?? token.raw ?? '');
			return escapeHtml(raw);
		}
	}
});

// Layer 2: dedicated `Marked` instance for upload-time validation. Uses
// default (HTML-passthrough) parsing so DOMPurify actually has work to do
// — the global singleton already escapes at parse time, which would make
// validation a no-op against itself.

const validatorMarked = new Marked();

export class MarkdownUnsafeError extends Error {
	constructor() {
		super(
			'Your document contains script content or unsafe URL schemes ' +
				'(javascript:, embedded <script>, on-event handlers) and cannot be ' +
				'stored. Please remove these and try again.'
		);
		this.name = 'MarkdownUnsafeError';
	}
}

/**
 * Throws `MarkdownUnsafeError` if the body contains content DOMPurify
 * would strip. Call before any Arweave upload of user-authored markdown.
 *
 * Single source of truth — every upload site (`/propose` submit,
 * `/contract` create) routes through this helper rather than rolling
 * its own validation.
 *
 * Two complementary checks:
 *
 *   1. Raw-body sanitize. Catches HTML embedded directly in the
 *      markdown source (e.g. `<script>`, `<img onerror=…>`, `<iframe>`)
 *      without depending on marked's parse path. Some marked versions
 *      silently strip or transform `<script>` blocks during parsing,
 *      which would leave DOMPurify with nothing to remove and let the
 *      payload slip through. Sanitising the raw string short-circuits
 *      that risk — DOMPurify treats any `<…>` substring in the body
 *      as HTML to inspect, regardless of markdown semantics.
 *
 *   2. Parsed-body sanitize. Catches markdown-specific attack vectors
 *      that only become HTML after parsing — most importantly
 *      dangerous URL schemes inside markdown links: `[text](javascript:…)`.
 *      Without parsing, DOMPurify just sees brackets and parens.
 *
 * Detection signal in both passes: `DOMPurify.removed` — the
 * authoritative list of nodes and attributes the sanitizer stripped on
 * the most recent `.sanitize()` call. We do NOT compare parsed-vs-
 * sanitized strings; DOMPurify normalises clean HTML (attribute
 * quoting, entity encoding, whitespace), which makes byte equality a
 * source of false positives.
 */
export async function validateMarkdownUpload(body: string): Promise<void> {
	// Check 1: raw body.
	DOMPurify.sanitize(body);
	if (DOMPurify.removed.length > 0) {
		throw new MarkdownUnsafeError();
	}
	// Check 2: marked-parsed body.
	const parsed = await validatorMarked.parse(body);
	DOMPurify.sanitize(parsed);
	if (DOMPurify.removed.length > 0) {
		throw new MarkdownUnsafeError();
	}
}

export interface Section {
	id: string;
	depth: 1 | 2 | 3;
	title: string;
	content: string;
	/** Original section number override (e.g. "1.1"). When set, the editor displays this instead of computing from position. */
	fixedNumber?: string;
}

let nextId = 0;

export function createSection(depth: 1 | 2 | 3 = 1): Section {
	return { id: `s-${++nextId}`, depth, title: '', content: '' };
}

export function computeSectionNumber(sections: Section[], index: number): string {
	let top = 0;
	let sub = 0;
	let subsub = 0;

	for (let i = 0; i <= index; i++) {
		const d = sections[i].depth;
		if (d === 1) {
			top++;
			sub = 0;
			subsub = 0;
		} else if (d === 2) {
			sub++;
			subsub = 0;
		} else {
			subsub++;
		}
	}

	const d = sections[index].depth;
	if (d === 1) return `§${top}`;
	if (d === 2) return `§${top}.${sub}`;
	return `§${top}.${sub}.${String.fromCharCode(64 + subsub)}`;
}

export function sectionsToMarkdown(sections: Section[]): string {
	return sections
		.map((s, i) => {
			const num = s.fixedNumber ? `§${s.fixedNumber}` : computeSectionNumber(sections, i);
			const hashes = '#'.repeat(s.depth + 1);
			const heading = `${hashes} ${num} ${s.title}`;
			return s.content ? `${heading}\n\n${s.content}` : heading;
		})
		.join('\n\n');
}

export function markdownToSections(markdown: string): Section[] {
	const lines = markdown.split('\n');
	const sections: Section[] = [];
	let current: Section | null = null;
	let contentLines: string[] = [];

	for (const line of lines) {
		const match = line.match(/^(#{2,4})\s+§([\d.A-Z]+)\s+(.*)/);
		if (match) {
			if (current) {
				current.content = contentLines.join('\n').trim();
				sections.push(current);
			}
			current = createSection((match[1].length - 1) as 1 | 2 | 3);
			current.fixedNumber = match[2];
			current.title = match[3];
			contentLines = [];
		} else if (current) {
			contentLines.push(line);
		}
	}

	if (current) {
		current.content = contentLines.join('\n').trim();
		sections.push(current);
	}

	return sections;
}

function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
	return Object.entries(frontmatter)
		.map(([k, v]) => {
			if (Array.isArray(v)) {
				const items = v.map((item) => `  - "${item}"`).join('\n');
				return `${k}:\n${items}`;
			}
			if (typeof v === 'string') return `${k}: "${v}"`;
			return `${k}: ${v}`;
		})
		.join('\n');
}

/**
 * Wrap a pre-rendered markdown body with YAML frontmatter.
 * Single source of truth for the `---\n<yaml>\n---\n\n<body>\n` envelope;
 * both `buildDocument()` and any ad-hoc body (e.g. Repeal notices that don't
 * carry Section[]) route through here so the envelope format stays uniform.
 */
export function wrapWithFrontmatter(
	frontmatter: Record<string, unknown>,
	body: string,
	rawYamlBlocks?: string
): string {
	const yaml = serializeFrontmatter(frontmatter);
	const allYaml = rawYamlBlocks ? `${yaml}\n${rawYamlBlocks}` : yaml;
	return `---\n${allYaml}\n---\n\n${body}\n`;
}

export function buildDocument(frontmatter: Record<string, unknown>, sections: Section[], rawYamlBlocks?: string): string {
	return wrapWithFrontmatter(frontmatter, sectionsToMarkdown(sections), rawYamlBlocks);
}

export function parseDocument(text: string): {
	frontmatter: Record<string, string>;
	sections: Section[];
	rawYamlBlocks?: string;
	rawRoles?: string;
} {
	const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!fmMatch) return { frontmatter: {}, sections: markdownToSections(text) };

	const rawYaml = fmMatch[1];
	const frontmatter: Record<string, string> = {};
	const lines = rawYaml.split('\n');

	// Extract a top-level list block (e.g. variables: / roles:) —
	// lines from "<key>:" until the next non-indented line.
	const extractListBlock = (key: string): { block: string | undefined; start: number; end: number } => {
		const start = lines.findIndex((l) => l.match(new RegExp(`^${key}:\\s*$`)));
		if (start < 0) return { block: undefined, start: -1, end: -1 };
		let end = lines.length;
		for (let i = start + 1; i < lines.length; i++) {
			if (lines[i].match(/^\S/) && !lines[i].startsWith(`${key}:`)) {
				end = i;
				break;
			}
		}
		return { block: lines.slice(start, end).join('\n'), start, end };
	};

	const vars = extractListBlock('variables');
	const roles = extractListBlock('roles');

	// Rebuild simpleLines excluding any extracted list blocks.
	const skip = new Set<number>();
	for (const b of [vars, roles]) {
		if (b.start < 0) continue;
		for (let i = b.start; i < b.end; i++) skip.add(i);
	}
	const simpleLines = lines.filter((_, i) => !skip.has(i));
	for (const line of simpleLines) {
		const kv = line.match(/^(\w+):\s*"?([^"]*)"?$/);
		if (kv) frontmatter[kv[1]] = kv[2];
	}

	return {
		frontmatter,
		sections: markdownToSections(fmMatch[2]),
		rawYamlBlocks: vars.block,
		rawRoles: roles.block
	};
}

// ──────────────── Amendment Mode Numbering ────────────────

/**
 * Collect all section numbers from both the original document and the current editor.
 * Used to compute next available numbers when adding sections in amendment mode.
 */
export function collectAllNumbers(editorSections: Section[], originalNumbers: string[]): string[] {
	const fromEditor = editorSections.map(s => s.fixedNumber).filter(Boolean) as string[];
	return [...new Set([...originalNumbers, ...fromEditor])];
}

/**
 * Compute the next available child number under a parent section.
 * e.g. parent "1" with existing children "1.1"–"1.4" → "1.5"
 * e.g. parent "1.1" with no children → "1.1.A"
 */
export function nextChildNumber(
	parentNumber: string,
	parentDepth: 1 | 2 | 3,
	allNumbers: string[]
): { number: string; depth: 1 | 2 | 3 } | null {
	if (parentDepth >= 3) return null; // depth 3 sections can't have children

	if (parentDepth === 1) {
		// Children are "X.N"
		const prefix = parentNumber + '.';
		const childNums = allNumbers
			.filter(n => n.startsWith(prefix) && !n.substring(prefix.length).includes('.'))
			.map(n => parseInt(n.substring(prefix.length)))
			.filter(n => !isNaN(n));
		const next = childNums.length > 0 ? Math.max(...childNums) + 1 : 1;
		return { number: `${parentNumber}.${next}`, depth: 2 };
	} else {
		// parentDepth === 2, children are "X.Y.L" where L is a letter
		const prefix = parentNumber + '.';
		const childLetters = allNumbers
			.filter(n => n.startsWith(prefix))
			.map(n => n.substring(prefix.length))
			.filter(l => l.length === 1 && l >= 'A' && l <= 'Z')
			.map(l => l.charCodeAt(0) - 64); // A=1, B=2
		const next = childLetters.length > 0 ? Math.max(...childLetters) + 1 : 1;
		return { number: `${parentNumber}.${String.fromCharCode(64 + next)}`, depth: 3 };
	}
}

/**
 * Compute the next available sibling number after a given section.
 * e.g. current "1" with siblings "1","2" → "3"
 * e.g. current "1.3" with siblings "1.1"–"1.4" → "1.5"
 */
export function nextSiblingNumber(
	currentNumber: string,
	currentDepth: 1 | 2 | 3,
	allNumbers: string[]
): { number: string; depth: 1 | 2 | 3 } {
	if (currentDepth === 1) {
		const topNums = allNumbers
			.filter(n => !n.includes('.'))
			.map(n => parseInt(n))
			.filter(n => !isNaN(n));
		const next = topNums.length > 0 ? Math.max(...topNums) + 1 : 1;
		return { number: String(next), depth: 1 };
	} else if (currentDepth === 2) {
		const parts = currentNumber.split('.');
		const parent = parts[0];
		const prefix = parent + '.';
		const siblingNums = allNumbers
			.filter(n => n.startsWith(prefix) && !n.substring(prefix.length).includes('.'))
			.map(n => parseInt(n.substring(prefix.length)))
			.filter(n => !isNaN(n));
		const next = siblingNums.length > 0 ? Math.max(...siblingNums) + 1 : 1;
		return { number: `${parent}.${next}`, depth: 2 };
	} else {
		const parts = currentNumber.split('.');
		const parent = `${parts[0]}.${parts[1]}`;
		const prefix = parent + '.';
		const siblingLetters = allNumbers
			.filter(n => n.startsWith(prefix))
			.map(n => n.substring(prefix.length))
			.filter(l => l.length === 1 && l >= 'A' && l <= 'Z')
			.map(l => l.charCodeAt(0) - 64);
		const next = siblingLetters.length > 0 ? Math.max(...siblingLetters) + 1 : 1;
		return { number: `${parent}.${String.fromCharCode(64 + next)}`, depth: 3 };
	}
}

/**
 * Sort sections by their fixedNumber in document order.
 * "1" < "1.1" < "1.1.A" < "1.2" < "2"
 */
export function sortByFixedNumber(sections: Section[]): Section[] {
	return [...sections].sort((a, b) => {
		const an = a.fixedNumber ?? '';
		const bn = b.fixedNumber ?? '';
		return compareSectionNumbers(an, bn);
	});
}

export function compareSectionNumbers(a: string, b: string): number {
	const partsA = parseSectionNumber(a);
	const partsB = parseSectionNumber(b);
	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const pa = partsA[i] ?? -1;
		const pb = partsB[i] ?? -1;
		if (pa !== pb) return pa - pb;
	}
	return 0;
}

function parseSectionNumber(num: string): number[] {
	if (!num) return [];
	return num.split('.').map(part => {
		const n = parseInt(part);
		if (!isNaN(n)) return n;
		// Letter: A=1, B=2, etc.
		return part.charCodeAt(0) - 64;
	});
}

/**
 * Render a markdown string through marked → wrapSections → DOMPurify.
 * Single pipeline used by /propose review modal, /vote proposal body, and the
 * registry document viewer on /. Collapses what was three identical inline
 * expressions into one call site.
 *
 * Optional `key` (e.g. on-chain contentHash) enables an in-memory tab-lifetime
 * cache keyed by an immutable identifier. Re-expanding the same document on
 * /vote or / skips the marked.parse + DOMPurify.sanitize pipeline entirely.
 */
const renderCache = new Map<string, string>();
const RENDER_CACHE_MAX = 200;

export async function renderSectionedMarkdown(md: string, key?: string): Promise<string> {
	if (key && renderCache.has(key)) return renderCache.get(key)!;

	const html = DOMPurify.sanitize(wrapSections(await marked.parse(md)));

	if (key) {
		renderCache.set(key, html);
		if (renderCache.size > RENDER_CACHE_MAX) {
			const firstKey = renderCache.keys().next().value;
			if (firstKey) renderCache.delete(firstKey);
		}
	}
	return html;
}

/**
 * Post-process rendered HTML to wrap content between headings in
 * indented divs. h2 → depth 1, h3 → depth 2, h4 → depth 3.
 * Each heading and its following content until the next heading
 * get wrapped in a <div class="doc-section-N">.
 */
export function wrapSections(html: string): string {
	// Split on heading tags while keeping them
	const parts = html.split(/(?=<h[234][ >])/);
	return parts.map(part => {
		const match = part.match(/^<h([234])[ >]/);
		if (!match) return part; // content before first heading
		const level = Number(match[1]) - 1; // h2→1, h3→2, h4→3
		return `<div class="doc-section-${level}">${part}</div>`;
	}).join('');
}
