const path = require('path');
const fs = require('fs');
const { getRuntime, getAgentRuntimes } = require('./agent-runtimes');
const { readSessionHeader } = require('./agent-runtimes/timestamped-jsonl');

let activeSessions, getMainWindow, log, rekeyMcpServer;

function init(ctx) {
  activeSessions = ctx.activeSessions;
  getMainWindow = ctx.getMainWindow;
  log = ctx.log;
  rekeyMcpServer = ctx.rekeyMcpServer;
}

function readNewSessionSignals(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(524288);
    const bytesRead = fs.readSync(fd, buf, 0, 524288, 0);
    fs.closeSync(fd);
    const head = buf.toString('utf8', 0, bytesRead);
    const lines = head.split('\n').filter(Boolean);
    let forkedFrom = null;
    let planContent = false;
    let slug = null;
    let parentSessionId = null;
    let hasSnapshots = false;
    for (const line of lines) {
      const entry = JSON.parse(line);
      if (entry.type === 'file-history-snapshot') { hasSnapshots = true; continue; }
      if (entry.forkedFrom) forkedFrom = entry.forkedFrom.sessionId;
      if (entry.planContent) planContent = true;
      if (entry.slug && !slug) slug = entry.slug;
      if (entry.sessionId && !parentSessionId) parentSessionId = entry.sessionId;
      if (entry.type === 'user' || entry.type === 'assistant') break;
    }
    return { forkedFrom, planContent, slug, parentSessionId, hasSnapshots };
  } catch {
    return { forkedFrom: null, planContent: false, slug: null, parentSessionId: null, hasSnapshots: false };
  }
}

function readOldSessionTail(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const readSize = Math.min(size, 8192);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, size - readSize);
    fs.closeSync(fd);
    const tail = buf.toString('utf8');
    const hasExitPlanMode = tail.includes('ExitPlanMode');
    let slug = null;
    const slugMatches = tail.match(/"slug"\s*:\s*"([^"]+)"/g);
    if (slugMatches) {
      const last = slugMatches[slugMatches.length - 1].match(/"slug"\s*:\s*"([^"]+)"/);
      if (last) slug = last[1];
    }
    return { hasExitPlanMode, slug };
  } catch {
    return { hasExitPlanMode: false, slug: null };
  }
}

function detectClaudeTransitions(runtime, folder) {
  const folderPath = path.join(runtime.sessionsDir, folder);
  let currentFiles;
  try {
    currentFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  } catch { return; }

  for (const [sessionId, session] of [...activeSessions]) {
    if (session.exited || session.isPlainTerminal || session.runtime !== runtime.id || !session.knownJsonlFiles || session.projectFolder !== folder) {
      continue;
    }

    const newFiles = currentFiles.filter(f => !session.knownJsonlFiles.has(f));
    if (newFiles.length === 0) continue;

    const emptyFiles = new Set();

    for (const newFile of newFiles) {
      const newFilePath = path.join(folderPath, newFile);
      const newId = path.basename(newFile, '.jsonl');
      const signals = readNewSessionSignals(newFilePath);

      if (!signals.forkedFrom && !signals.parentSessionId && !signals.slug && !signals.planContent) {
        if (signals.hasSnapshots && session.forkFrom && !session.realSessionId) {
          log.info(`[detect] session=${sessionId} matching snapshot-only fork file=${newId}`);
        } else {
          let stale = false;
          try {
            const mtime = fs.statSync(path.join(folderPath, newFile)).mtimeMs;
            if (Date.now() - mtime > 3600000) stale = true;
          } catch {}
          if (!stale) {
            emptyFiles.add(newFile);
            continue;
          }
        }
      }

      let matched = false;
      if (signals.forkedFrom === sessionId || (session.forkFrom && signals.forkedFrom === session.forkFrom)) {
        matched = true;
      }
      if (!matched && session.forkFrom && signals.parentSessionId === session.forkFrom && newId !== session.forkFrom) {
        matched = true;
      }
      if (!matched && signals.hasSnapshots && session.forkFrom && !session.realSessionId) {
        matched = true;
      }

      if (!matched && signals.planContent && signals.slug) {
        const oldFilePath = path.join(folderPath, sessionId + '.jsonl');
        const oldTail = readOldSessionTail(oldFilePath);
        if (oldTail.hasExitPlanMode && oldTail.slug === signals.slug) {
          try {
            const oldMtime = fs.statSync(oldFilePath).mtimeMs;
            const newMtime = fs.statSync(newFilePath).mtimeMs;
            if (Math.abs(newMtime - oldMtime) < 30000) matched = true;
          } catch {}
        }
      }

      if (matched) {
        log.info(`[session-transition] ${sessionId} → ${newId} (${signals.forkedFrom || session.forkFrom ? 'fork' : 'plan-accept'})`);
        session.knownJsonlFiles = new Set(currentFiles);
        session.realSessionId = newId;
        if (signals.slug) session.sessionSlug = signals.slug;
        activeSessions.delete(sessionId);
        activeSessions.set(newId, session);
        rekeyMcpServer(sessionId, newId);
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('session-forked', sessionId, newId);
        }
        break;
      }
    }

    const updated = new Set(currentFiles);
    for (const f of emptyFiles) updated.delete(f);
    session.knownJsonlFiles = updated;
  }
}

function detectPiLikeTransitions(runtime, folder) {
  const folderPath = path.join(runtime.sessionsDir, folder);
  let currentFiles;
  try {
    currentFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  } catch { return; }

  for (const [sessionId, session] of [...activeSessions]) {
    if (session.exited || session.isPlainTerminal || session.runtime !== runtime.id || !session.knownJsonlFiles || session.projectFolder !== folder) {
      continue;
    }

    const newFiles = currentFiles.filter(f => !session.knownJsonlFiles.has(f));
    for (const newFile of newFiles) {
      const newFilePath = path.join(folderPath, newFile);
      const { sessionId: newId } = readSessionHeader(newFilePath);
      if (!newId) continue;
      if (newId === sessionId || newId === session.forkFrom) continue;

      const needsTransition = session.forkFrom || session._awaitingSessionFile;
      if (!needsTransition) continue;

      log.info(`[${runtime.id}-session-transition] ${sessionId} → ${newId}`);
      session.knownJsonlFiles = new Set(currentFiles);
      session.realSessionId = newId;
      delete session._awaitingSessionFile;
      activeSessions.delete(sessionId);
      activeSessions.set(newId, session);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session-forked', sessionId, newId);
      }
      break;
    }

    session.knownJsonlFiles = new Set(currentFiles);
  }
}

function detectTransitionsForRuntime(runtime, folder) {
  if (runtime.transitionKind === 'claude') {
    detectClaudeTransitions(runtime, folder);
  } else if (runtime.transitionKind === 'pi-like') {
    detectPiLikeTransitions(runtime, folder);
  }
}

/** Back-compat for Claude watcher wiring. */
function detectSessionTransitions(folder) {
  detectClaudeTransitions(getRuntime('claude'), folder);
}

module.exports = {
  init,
  detectSessionTransitions,
  detectTransitionsForRuntime,
  detectPiLikeTransitions,
};
