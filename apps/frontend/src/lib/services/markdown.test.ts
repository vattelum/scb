import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { amendmentTargets, createSection, malformedSectionHeadings, markdownToSections, sectionsToMarkdown, wrapSections } from './markdown';

describe('markdown pipeline', () => {
	it('escapes raw HTML and wraps heading sections', () => {
		const html = wrapSections(marked.parse('<script>alert(1)</script>\n\n## One\n\nBody', { async: false }));

		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>');
		expect(html).toContain('class="doc-section-1"');
		expect(html).toContain('<p>Body</p>');
	});
});

describe('sections', () => {
	it('parses §3 headings into editor sections with fixed numbers', () => {
		const sections = markdownToSections('Preamble.\n\n## §1 One\n\nA.\n\n### §1.1 Sub\n\nB.');
		expect(sections.map((s) => [s.fixedNumber, s.depth, s.title, s.content])).toEqual([
			['1', 1, 'One', 'A.'],
			['1.1', 2, 'Sub', 'B.']
		]);
		expect(new Set(sections.map((s) => s.id)).size).toBe(2);
	});

	it('reads a heading outside the §3 grammar as body text', () => {
		const sections = markdownToSections('## §1 One\n\n## §2. Bad\n\nText.');
		expect(sections).toHaveLength(1);
		expect(sections[0].content).toBe('## §2. Bad\n\nText.');
	});

	it('numbers new editor sections by position and keeps fixed numbers', () => {
		const a = { ...createSection(1), title: 'A', content: 'x' };
		const b = { ...createSection(2), title: 'B', content: '' };
		const c = { ...createSection(1), title: 'C', content: 'z', fixedNumber: '7' };
		expect(sectionsToMarkdown([a, b, c])).toBe('## §1 A\n\nx\n\n### §1.1 B\n\n## §7 C\n\nz');
	});
});

describe('propose-time checks', () => {
	it('finds § headings outside the §3 grammar', () => {
		const md = '## §1 Good\n\n## §2. Bad\n\n### §3 Wrong depth\n\nText with § in it.\n\n#### §1.1.A Fine';
		expect(malformedSectionHeadings(md)).toEqual(['## §2. Bad', '### §3 Wrong depth']);
		expect(malformedSectionHeadings('## §1 A\n\n### §1.1 B')).toEqual([]);
	});

	const md = (text: string) => markdownToSections(text);

	it('adds sections the text holds outside its targets', () => {
		const out = amendmentTargets(md('### §8.1 A\n\nx\n\n### §8.2 B\n\ny\n\n#### §8.2.A C\n\nz'), ['8.1']);
		expect(out).toEqual({ targets: ['8.1', '8.2'], added: ['8.2'], removed: [] });
	});

	it('reports targets with no text, which will be removed', () => {
		const out = amendmentTargets(md('### §8.1 A\n\nAll three.'), ['8.1', '8.2', '8.3']);
		expect(out).toEqual({ targets: ['8.1', '8.2', '8.3'], added: [], removed: ['8.2', '8.3'] });
	});

	it('leaves an amendment without targets to name its own', () => {
		expect(amendmentTargets(md('## §9 New\n\nx'), [])).toEqual({ targets: [], added: [], removed: [] });
	});
});
