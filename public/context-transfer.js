// Pure helpers for moving concise, reviewable context between local sessions.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MAX_PACKET_LENGTH = 24_000;

  function clean(value) {
    return String(value || '').trim();
  }

  function sessionLabel(session) {
    if (!session) return 'Unknown session';
    return (
      clean(session.name) ||
      clean(session.aiTitle) ||
      clean(session.summary) ||
      clean(session.sessionId).slice(0, 8) ||
      'Untitled session'
    );
  }

  function projectLabel(session) {
    const parts = clean(session && session.projectPath)
      .split(/[\\/]/)
      .filter(Boolean);
    return parts.slice(-2).join('/') || 'Unknown project';
  }

  function buildContextTransferPacket(session, content, options = {}) {
    const source = sessionLabel(session);
    const project = projectLabel(session);
    const body = clean(content) || 'No generated summary was available. Review the source session.';
    const clipped =
      body.length > MAX_PACKET_LENGTH
        ? `${body.slice(0, MAX_PACKET_LENGTH)}\n\n[Packet truncated by Switchboard]`
        : body;
    const intent = clean(options.intent) || 'Continue this work without repeating completed steps.';

    return [
      '# Switchboard Context Transfer',
      '',
      `Source session: ${source}`,
      `Source project: ${project}`,
      `Created: ${options.createdAt || new Date().toISOString()}`,
      '',
      '## Goal',
      intent,
      '',
      '## Context',
      clipped,
      '',
      '## Start by',
      '1. Verify the current repository state and existing changes.',
      '2. Preserve completed work and unresolved decisions.',
      '3. State any missing context before making destructive changes.',
    ].join('\n');
  }

  function getTransferTargets(sessions, sourceSessionId) {
    if (!Array.isArray(sessions)) return [];
    return sessions
      .filter(
        session =>
          session &&
          session.sessionId &&
          session.sessionId !== sourceSessionId &&
          session.isRunning !== false,
      )
      .map(session => ({
        id: session.sessionId,
        label: sessionLabel(session),
        project: projectLabel(session),
        runtime: session.runtime || 'claude',
      }))
      .sort((left, right) => {
        const projectOrder = left.project.localeCompare(right.project);
        return projectOrder || left.label.localeCompare(right.label);
      });
  }

  return {
    MAX_PACKET_LENGTH,
    buildContextTransferPacket,
    getTransferTargets,
    projectLabel,
    sessionLabel,
  };
});
