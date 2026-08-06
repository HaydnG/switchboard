import { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Icon } from '@renderer/components/design-system';
import { dispatchLegacyShellCommand } from '@renderer/lib/legacy-shell-bridge';
import type { ScheduleRun, ScheduleSummary } from '@renderer/types/api';
import type { SessionOverviewSnapshot } from '@renderer/store/session-overview-store';
import { relativeTime, shortProjectName } from '@renderer/components/shell/shell-utils';

interface ScheduleWithRun extends ScheduleSummary {
  latestRun?: ScheduleRun;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function ProductivityDashboard({ overview }: { overview: SessionOverviewSnapshot }) {
  const [schedules, setSchedules] = useState<ScheduleWithRun[]>([]);
  const attention = useMemo(
    () =>
      overview.sessions
        .filter((session) => ['needs-attention', 'response-ready'].includes(session.status))
        .slice(0, 5),
    [overview.sessions],
  );
  const active = useMemo(
    () => overview.sessions.filter((session) => session.running).slice(0, 6),
    [overview.sessions],
  );
  const recent = useMemo(
    () =>
      [...overview.sessions]
        .sort(
          (left, right) => new Date(right.modified).getTime() - new Date(left.modified).getTime(),
        )
        .slice(0, 6),
    [overview.sessions],
  );

  useEffect(() => {
    let cancelled = false;
    window.api
      .getSchedules()
      .then(async (items) => {
        const enriched = await Promise.all(
          items.slice(0, 4).map(async (schedule) => ({
            ...schedule,
            latestRun: (await window.api.listScheduleRuns(schedule.id, 1))[0],
          })),
        );
        if (!cancelled) setSchedules(enriched);
      })
      .catch(() => {
        if (!cancelled) setSchedules([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="sb-dashboard" aria-label="Productivity dashboard">
      <section className="sb-dashboard-hero">
        <div>
          <span className="sb-dashboard-eyebrow">Your local agent workspace</span>
          <h1>{greeting()}</h1>
          <p>
            {overview.attention > 0
              ? `${overview.attention} session${overview.attention === 1 ? '' : 's'} waiting for you.`
              : 'Everything is moving. Start something new or pick up recent work.'}
          </p>
        </div>
        <div className="sb-dashboard-hero__actions">
          <Button
            icon={<Icon name="search" />}
            onClick={() => dispatchLegacyShellCommand('open-command-palette')}
            variant="primary"
          >
            Search everything
          </Button>
          <Button
            icon={<span>+</span>}
            onClick={() => dispatchLegacyShellCommand('add-project')}
            variant="secondary"
          >
            Add project
          </Button>
        </div>
      </section>

      <section className="sb-dashboard-metrics" aria-label="Workspace summary">
        <article>
          <span>Needs you</span>
          <strong>{overview.attention}</strong>
          <small>blocked or ready</small>
        </article>
        <article>
          <span>Running now</span>
          <strong>{overview.running}</strong>
          <small>active agents</small>
        </article>
        <article>
          <span>Ready</span>
          <strong>{overview.ready}</strong>
          <small>results to review</small>
        </article>
        <article>
          <span>Indexed</span>
          <strong>{overview.total}</strong>
          <small>local sessions</small>
        </article>
      </section>

      <div className="sb-dashboard-grid">
        <section className="sb-dashboard-panel sb-dashboard-panel--attention">
          <header>
            <div>
              <span className="sb-panel-kicker">Priority queue</span>
              <h2>Needs your attention</h2>
            </div>
            {attention.length > 0 && (
              <Button
                onClick={() => dispatchLegacyShellCommand('focus-next-attention')}
                size="sm"
                variant="ghost"
              >
                Focus next
              </Button>
            )}
          </header>
          <div className="sb-dashboard-list">
            {attention.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  dispatchLegacyShellCommand('open-session', { sessionId: session.id })
                }
              >
                <span className={`sb-dashboard-status is-${session.status}`} />
                <span>
                  <strong>{session.name}</strong>
                  <small>
                    {shortProjectName(session.projectPath)} · {session.task || session.statusLabel}
                  </small>
                </span>
                <Chip tone={session.status === 'needs-attention' ? 'warning' : 'info'}>
                  {session.statusLabel}
                </Chip>
              </button>
            ))}
            {attention.length === 0 && (
              <div className="sb-dashboard-empty">
                <Icon name="spark" size={22} />
                <strong>Queue clear</strong>
                <span>No agents are waiting on you.</span>
              </div>
            )}
          </div>
        </section>

        <section className="sb-dashboard-panel">
          <header>
            <div>
              <span className="sb-panel-kicker">Live work</span>
              <h2>Agents in motion</h2>
            </div>
            <Button
              onClick={() => dispatchLegacyShellCommand('toggle-grid')}
              size="sm"
              variant="ghost"
            >
              Open overview
            </Button>
          </header>
          <div className="sb-agent-grid">
            {active.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  dispatchLegacyShellCommand('open-session', { sessionId: session.id })
                }
              >
                <span className="sb-agent-avatar">{session.runtime.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{session.name}</strong>
                  <small>{session.task || shortProjectName(session.projectPath)}</small>
                </span>
                <span className="sb-agent-live-dot" />
              </button>
            ))}
            {active.length === 0 && (
              <div className="sb-dashboard-empty is-compact">
                <strong>No active agents</strong>
                <span>Launch a session from any project in the sidebar.</span>
              </div>
            )}
          </div>
        </section>

        <section className="sb-dashboard-panel">
          <header>
            <div>
              <span className="sb-panel-kicker">Continue</span>
              <h2>Recent sessions</h2>
            </div>
          </header>
          <div className="sb-recent-list">
            {recent.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  dispatchLegacyShellCommand('open-session', { sessionId: session.id })
                }
              >
                <span>
                  <strong>{session.name}</strong>
                  <small>{shortProjectName(session.projectPath)}</small>
                </span>
                <time>{relativeTime(session.modified)}</time>
              </button>
            ))}
          </div>
        </section>

        <section className="sb-dashboard-panel">
          <header>
            <div>
              <span className="sb-panel-kicker">Automation</span>
              <h2>Scheduled work</h2>
            </div>
            <Button
              onClick={() =>
                dispatchLegacyShellCommand('open-view', {
                  view: 'memory',
                })
              }
              size="sm"
              variant="ghost"
            >
              Manage
            </Button>
          </header>
          <div className="sb-schedule-list">
            {schedules.map((schedule) => (
              <article key={schedule.id}>
                <span
                  className={`sb-schedule-state is-${schedule.latestRun?.status || 'scheduled'}`}
                />
                <span>
                  <strong>{schedule.name}</strong>
                  <small>
                    {shortProjectName(schedule.projectPath)} · {schedule.cron}
                  </small>
                </span>
                <Chip
                  tone={
                    schedule.latestRun?.status === 'failed'
                      ? 'danger'
                      : schedule.latestRun?.status === 'running'
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {schedule.latestRun?.status || 'scheduled'}
                </Chip>
              </article>
            ))}
            {schedules.length === 0 && (
              <div className="sb-dashboard-empty is-compact">
                <strong>No scheduled work</strong>
                <span>Create schedules from a project’s plus menu.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
