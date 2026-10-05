// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  linkifyWikilinks,
  parseFrontmatterFields,
  renderKbNote,
} from '@renderer/lib/knowledge-markdown';

describe('knowledge markdown', () => {
  it('turns wikilinks into anchors but leaves code alone', () => {
    const out = linkifyWikilinks(
      [
        'See [[Gateway auth|auth]] and [[deploy#rollback]].',
        '`[[inline]]`',
        '```',
        '[[fenced]]',
        '```',
      ].join('\n'),
    );
    expect(out).toContain('<a href="#" class="kb-wikilink" data-kb-raw="Gateway auth">auth</a>');
    expect(out).toContain('data-kb-raw="deploy">deploy#rollback</a>');
    expect(out).toContain('`[[inline]]`');
    expect(out).toContain('\n[[fenced]]\n');
  });

  it('reads frontmatter fields including dash lists', () => {
    expect(
      parseFrontmatterFields(['date: 2026-09-30', 'sources:', '  - a.md', '  - b.md'].join('\n')),
    ).toEqual([
      { key: 'date', value: '2026-09-30' },
      { key: 'sources', value: 'a.md, b.md' },
    ]);
  });

  it('renders sanitized html without the frontmatter block', () => {
    const rendered = renderKbNote(
      '---\ndate: 2026-09-30\n---\n# Title\n\n<script>alert(1)</script>[[peer]] <img src="x.png">',
    );
    expect(rendered.frontmatter).toEqual([{ key: 'date', value: '2026-09-30' }]);
    expect(rendered.html).toContain('<h1');
    expect(rendered.html).toContain('data-kb-raw="peer"');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).not.toContain('date: 2026');
  });
});
