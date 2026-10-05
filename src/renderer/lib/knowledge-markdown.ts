import DOMPurify from 'dompurify';
import { marked } from 'marked';

export interface KbFrontmatterField {
  key: string;
  value: string;
}

export interface RenderedKbNote {
  html: string;
  frontmatter: KbFrontmatterField[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function splitFrontmatter(content: string): { block: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  return match
    ? { block: match[1], body: content.slice(match[0].length) }
    : { block: '', body: content };
}

/** Top-level `key: value` pairs, with dash-list items folded into their key. */
export function parseFrontmatterFields(block: string): KbFrontmatterField[] {
  const fields: KbFrontmatterField[] = [];
  for (const line of block.split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      fields.push({ key: pair[1], value: pair[2].trim() });
      continue;
    }
    const item = /^\s*-\s*(.+)$/.exec(line);
    const last = fields.at(-1);
    if (item && last) last.value = last.value ? `${last.value}, ${item[1].trim()}` : item[1].trim();
  }
  return fields;
}

/**
 * `[[target|alias]]` → an anchor carrying the raw target, outside fenced and
 * inline code. Embeds (`![[file]]`) become a muted label.
 */
export function linkifyWikilinks(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(
                /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
                (_match, bang: string, target: string, heading = '', alias?: string) => {
                  const label = escapeHtml((alias || `${target}${heading}`).trim());
                  if (bang) return `<span class="kb-embed">${label}</span>`;
                  return `<a href="#" class="kb-wikilink" data-kb-raw="${escapeHtml(target.trim())}">${label}</a>`;
                },
              ),
        )
        .join('');
    })
    .join('\n');
}

export function renderKbNote(content: string): RenderedKbNote {
  const { block, body } = splitFrontmatter(content);
  const html = marked.parse(linkifyWikilinks(body), { async: false, gfm: true }) as string;
  return {
    frontmatter: parseFrontmatterFields(block),
    html: DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'svg', 'math', 'img'],
      FORBID_ATTR: ['style'],
    }),
  };
}
