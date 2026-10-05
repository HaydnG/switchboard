import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { KnowledgeBaseState } from '@renderer/hooks/useKnowledgeBase';
import { connections, LINK_KIND_LABELS } from '@renderer/lib/knowledge-model';
import { renderKbNote } from '@renderer/lib/knowledge-markdown';
import type { KbEntryContent, KbLinkKind, KbResolvedLink } from '@renderer/types/knowledge';
import {
  entryName,
  formatCount,
  layerLabel,
  LINK_KIND_COLORS,
  rootColor,
  rootLabel,
  timeAgo,
} from '@renderer/components/knowledge/kb-ui';

interface KnowledgeReaderProps {
  kb: KnowledgeBaseState;
  entryId: string | null;
  onNavigate: (id: string) => void;
  onShowInGraph: (id: string) => void;
}

const EXTERNAL_URL = /^(https?:|mailto:)/i;

function KindBadge({ kind }: { kind: KbLinkKind }) {
  return (
    <span className="kb-kind" style={{ color: LINK_KIND_COLORS[kind] }}>
      {LINK_KIND_LABELS[kind]}
    </span>
  );
}

function ConnectionNode({
  kb,
  id,
  kind,
  direction,
  ancestors,
  onNavigate,
}: {
  kb: KnowledgeBaseState;
  id: string;
  kind: KbLinkKind;
  direction: 'out' | 'in';
  ancestors: string[];
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const entry = kb.entriesById.get(id);
  const cycle = ancestors.includes(id);
  const children = useMemo(
    () =>
      open
        ? connections(kb.adjacency, id, direction, (other) =>
            entryName(kb.entriesById.get(other), other),
          )
        : [],
    [direction, id, kb.adjacency, kb.entriesById, open],
  );
  const childCount =
    (direction === 'out' ? kb.adjacency.out : kb.adjacency.in).get(id)?.length ?? 0;

  return (
    <li className="kb-conn">
      <div className="kb-conn-row">
        <button
          type="button"
          className={`kb-conn-toggle${open ? ' is-open' : ''}`}
          disabled={cycle || childCount === 0}
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen((value) => !value)}
        >
          {childCount === 0 || cycle ? '·' : '▸'}
        </button>
        <span
          className="kb-tree-swatch"
          style={{
            background: rootColor(entry?.rootId ?? 'other', kb.overview?.config.roots ?? []),
          }}
        />
        <button type="button" className="kb-conn-name" title={id} onClick={() => onNavigate(id)}>
          {entryName(entry, id)}
        </button>
        <KindBadge kind={kind} />
        {cycle && <span className="kb-muted">cycle</span>}
        {!cycle && childCount > 0 && <span className="kb-muted">{childCount}</span>}
      </div>
      {open && !cycle && (
        <ul className="kb-conn-list">
          {children.map((child) => (
            <ConnectionNode
              key={`${child.id}:${child.kind}`}
              kb={kb}
              id={child.id}
              kind={child.kind}
              direction={direction}
              ancestors={[...ancestors, id]}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ConnectionTree({
  kb,
  id,
  direction,
  onNavigate,
}: {
  kb: KnowledgeBaseState;
  id: string;
  direction: 'out' | 'in';
  onNavigate: (id: string) => void;
}) {
  const items = connections(kb.adjacency, id, direction, (other) =>
    entryName(kb.entriesById.get(other), other),
  );
  return (
    <section className="kb-reader-section">
      <h4>
        {direction === 'out' ? 'Links to' : 'Linked from'}{' '}
        <span className="kb-muted">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="kb-muted">{direction === 'out' ? 'No outgoing links.' : 'No backlinks.'}</p>
      ) : (
        <ul className="kb-conn-list is-top">
          {items.map((item) => (
            <ConnectionNode
              key={`${item.id}:${item.kind}`}
              kb={kb}
              id={item.id}
              kind={item.kind}
              direction={direction}
              ancestors={[id]}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function findLinkTarget(links: KbResolvedLink[], anchor: HTMLAnchorElement): string | null {
  const raw = anchor.dataset.kbRaw;
  if (raw !== undefined) {
    return links.find((link) => link.kind === 'wikilink' && link.raw === raw)?.target ?? null;
  }
  const href = anchor.getAttribute('href') ?? '';
  let decoded = href;
  try {
    decoded = decodeURI(href);
  } catch {
    // keep the raw href
  }
  const bare = (value: string) => value.split('#')[0];
  return (
    links.find((link) => link.kind === 'link' && (link.raw === href || link.raw === decoded))
      ?.target ??
    links.find((link) => link.kind === 'link' && bare(link.raw) === bare(decoded))?.target ??
    null
  );
}

export function KnowledgeReader({ kb, entryId, onNavigate, onShowInGraph }: KnowledgeReaderProps) {
  const [loaded, setLoaded] = useState<{ id: string; content: KbEntryContent } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const entry = entryId ? kb.entriesById.get(entryId) : undefined;
  const roots = kb.overview?.config.roots ?? [];
  const content = loaded && loaded.id === entryId ? loaded.content : null;
  const loading = !!entryId && !content;

  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    if (mainRef.current) mainRef.current.scrollTop = 0;
    window.api
      .kbReadEntry(entryId)
      .catch((error: unknown): KbEntryContent => ({ ok: false, error: String(error) }))
      .then((next) => {
        if (!cancelled) setLoaded({ id: entryId, content: next });
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const rendered = useMemo(
    () => (content?.ok && content.content !== undefined ? renderKbNote(content.content) : null),
    [content],
  );
  const unresolved = useMemo(
    () => (content?.links ?? []).filter((link) => !link.target && link.kind !== 'cite'),
    [content],
  );

  if (!entryId || !entry) {
    return (
      <div className="kb-empty">
        <h3>Pick an entry</h3>
        <p>
          Choose a note from the tree on the left, a hub on the Overview, or a node in the Graph.
        </p>
      </div>
    );
  }

  const onBodyClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (EXTERNAL_URL.test(href)) {
      void window.api.openExternal(href);
      return;
    }
    if (href.startsWith('#') && anchor.dataset.kbRaw === undefined) return;
    const target = findLinkTarget(content?.links ?? [], anchor);
    if (target && kb.entriesById.has(target)) onNavigate(target);
    else
      kb.setNotice({ tone: 'warning', text: `“${anchor.textContent}” points outside the index` });
  };

  const layer = layerLabel(entry);

  return (
    <div className="kb-reader">
      <article className="kb-reader-main" ref={mainRef}>
        <header className="kb-reader-head">
          <div className="kb-reader-crumbs">
            <span
              className="kb-tree-swatch"
              style={{ background: rootColor(entry.rootId, roots) }}
            />
            <span>{rootLabel(entry.rootId, roots)}</span>
            <span className="kb-muted">/ {entry.relPath}</span>
          </div>
          <h2>{entryName(entry, entry.id)}</h2>
          <div className="kb-reader-meta">
            {layer && <span className={`kb-pill layer-${entry.layer}`}>{layer}</span>}
            <span>{formatCount(entry.chunks)} chunks</span>
            <span>{(entry.size / 1024).toFixed(1)} KB</span>
            <span>updated {timeAgo(entry.mtimeMs)}</span>
            {entry.boost !== 1 && <span>boost ×{entry.boost}</span>}
          </div>
          <div className="kb-actions">
            <button
              type="button"
              className="btn"
              onClick={() => void window.api.kbOpenEntry(entry.id, 'open')}
            >
              Open
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => void window.api.kbOpenEntry(entry.id, 'reveal')}
            >
              Reveal in Finder
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void window.api.writeClipboard(entry.absPath);
                kb.setNotice({ tone: 'success', text: 'Path copied' });
              }}
            >
              Copy path
            </button>
            <button type="button" className="btn" onClick={() => onShowInGraph(entry.id)}>
              Show in graph
            </button>
          </div>
        </header>
        {loading && !rendered && <p className="kb-muted">Loading…</p>}
        {content && !content.ok && (
          <p className="kb-error">{content.error || 'Could not read this entry.'}</p>
        )}
        {rendered && rendered.frontmatter.length > 0 && (
          <dl className="kb-props">
            {rendered.frontmatter.map((field) => (
              <div key={field.key}>
                <dt>{field.key}</dt>
                <dd>{field.value || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        {rendered && (
          <div
            className="markdown-preview kb-markdown"
            onClick={onBodyClick}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        )}
      </article>
      <aside className="kb-reader-side">
        {!kb.graph && (
          <p className="kb-muted">
            {kb.graphLoading
              ? `Building link graph${kb.graphProgress ? ` · ${kb.graphProgress.done}/${kb.graphProgress.total}` : '…'}`
              : 'Link graph not loaded.'}
          </p>
        )}
        <ConnectionTree kb={kb} id={entry.id} direction="out" onNavigate={onNavigate} />
        <ConnectionTree kb={kb} id={entry.id} direction="in" onNavigate={onNavigate} />
        {unresolved.length > 0 && (
          <section className="kb-reader-section">
            <h4>
              Outside the index <span className="kb-muted">{unresolved.length}</span>
            </h4>
            <ul className="kb-plain-list">
              {unresolved.map((link) => (
                <li key={`${link.kind}:${link.raw}`} title={LINK_KIND_LABELS[link.kind]}>
                  <KindBadge kind={link.kind} /> <code>{link.raw}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
