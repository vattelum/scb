import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { wrapSections } from './markdown';

describe('markdown pipeline', () => {
	it('escapes raw HTML and wraps heading sections', () => {
		const html = wrapSections(marked.parse('<script>alert(1)</script>\n\n## One\n\nBody', { async: false }));

		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>');
		expect(html).toContain('class="doc-section-1"');
		expect(html).toContain('<p>Body</p>');
	});
});
