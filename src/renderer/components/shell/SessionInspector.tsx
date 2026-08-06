import { useEffect, useState } from 'react';
import { Button, Chip, Icon } from '@renderer/components/design-system';
import { dispatchLegacyShellCommand } from '@renderer/lib/legacy-shell-bridge';
import type {
  SessionGroupOverview,
  SessionOverviewItem,
} from '@renderer/store/session-overview-store';
import { relativeTime, shortProjectName } from '@renderer/components/shell/shell-utils';

interface SessionInspectorProps {
  groups: SessionGroupOverview[];
  session: SessionOverviewItem;
  onClose: () => void;
}

export function SessionInspector({ groups, session, onClose }: SessionInspectorProps) {
  const [sessionName, setSessionName] = useState(session.name);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [groupOverride, setGroupOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getSessionAnnotations(session.id)
      .then((annotations) => {
        if (cancelled) return;
        setNote(annotations.note || '');
        setTags(annotations.tags.join(', '));
      })
      .catch(() => {
        if (!cancelled) {
          setNote('');
          setTags('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const runAction = (command: string) =>
    dispatchLegacyShellCommand('session-action', {
      command,
      sessionId: session.id,
    });

  const save = async () => {
    setSaving(true);
    setSaved(false);
    const result = await window.api.setSessionAnnotations(session.id, {
      note,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setSaving(false);
    setSaved(result.ok);
    if (result.ok) window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <aside className="sb-session-inspector" aria-label="Session details">
      <header>
        <div>
          <span className="sb-panel-kicker">Session details</span>
          <h2>{session.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details">
          ×
        </button>
      </header>

      <div className="sb-inspector-status">
        <Chip
          tone={
            session.status === 'needs-attention'
              ? 'warning'
              : session.running
                ? 'success'
                : 'neutral'
          }
        >
          {session.statusLabel}
        </Chip>
        <Chip tone={session.health === 'healthy' ? 'neutral' : 'warning'}>
          {session.healthLabel}
        </Chip>
      </div>

      <Button
        icon={<Icon name="chevronRight" />}
        onClick={() =>
          dispatchLegacyShellCommand('open-session', {
            sessionId: session.id,
          })
        }
        variant="primary"
      >
        Back to session
      </Button>

      <section className="sb-inspector-name">
        <label htmlFor="sb-session-name">Session name</label>
        <div>
          <input
            id="sb-session-name"
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
          />
          <Button
            disabled={sessionName.trim() === session.name}
            onClick={() =>
              dispatchLegacyShellCommand('rename-session', {
                name: sessionName,
                sessionId: session.id,
              })
            }
            size="sm"
            variant="secondary"
          >
            Rename
          </Button>
        </div>
      </section>

      <dl className="sb-inspector-facts">
        <div>
          <dt>Project</dt>
          <dd title={session.projectPath}>{shortProjectName(session.projectPath)}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{session.runtime}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{relativeTime(session.modified)} ago</dd>
        </div>
        {session.groupName && (
          <div>
            <dt>Group</dt>
            <dd>{session.groupName}</dd>
          </div>
        )}
      </dl>

      {session.task && (
        <section className="sb-inspector-task">
          <span>Current task</span>
          <p>{session.task}</p>
        </section>
      )}

      <section className="sb-inspector-grouping">
        <span>Folder</span>
        <select
          aria-label="Session folder"
          value={groupOverride ?? session.groupId}
          onChange={(event) => {
            const nextGroupId = event.target.value;
            setGroupOverride(nextGroupId);
            dispatchLegacyShellCommand('assign-group', {
              groupId: nextGroupId || null,
              sessionId: session.id,
            });
          }}
        >
          <option value="">Ungrouped</option>
          {[...groups]
            .sort((left, right) => left.order - right.order)
            .map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
        </select>
        <Button
          icon={<span>+</span>}
          onClick={() =>
            dispatchLegacyShellCommand('create-group', {
              sessionId: session.id,
            })
          }
          size="sm"
          variant="secondary"
        >
          New folder
        </Button>
      </section>

      <section className="sb-inspector-actions">
        <span>Session tools</span>
        <div>
          {session.running && (
            <Button onClick={() => runAction('stop')} size="sm" variant="danger">
              Stop
            </Button>
          )}
          {session.running && (
            <Button onClick={() => runAction('queue')} size="sm" variant="secondary">
              Queue prompt
            </Button>
          )}
          <Button onClick={() => runAction('timeline')} size="sm" variant="secondary">
            Timeline
          </Button>
          <Button onClick={() => runAction('messages')} size="sm" variant="secondary">
            Messages
          </Button>
          <Button onClick={() => runAction('transfer')} size="sm" variant="secondary">
            Send context
          </Button>
          <Button onClick={() => runAction('handoff')} size="sm" variant="secondary">
            Hand off
          </Button>
          {session.type !== 'terminal' && (
            <Button onClick={() => runAction('fork')} size="sm" variant="secondary">
              Fork
            </Button>
          )}
          <Button onClick={() => runAction('pin')} size="sm" variant="ghost">
            {session.starred ? 'Unpin' : 'Pin'}
          </Button>
          <Button onClick={() => runAction('copy-id')} size="sm" variant="ghost">
            Copy ID
          </Button>
          <Button onClick={() => runAction('archive')} size="sm" variant="ghost">
            {session.archived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>
      </section>

      <section className="sb-inspector-notes">
        <label htmlFor="sb-session-note">Private notes</label>
        <textarea
          id="sb-session-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Decisions, follow-ups, review notes…"
        />
        <label htmlFor="sb-session-tags">Tags</label>
        <input
          id="sb-session-tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="review, checkout, urgent"
        />
        <Button
          disabled={saving}
          icon={saved ? <Icon name="spark" /> : undefined}
          onClick={save}
          size="sm"
          variant={saved ? 'secondary' : 'primary'}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save notes'}
        </Button>
      </section>
    </aside>
  );
}
