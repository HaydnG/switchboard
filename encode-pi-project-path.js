// Mirror Pi's session-folder naming under ~/.pi/agent/sessions/.
// Observed shape: --Users-haydngynn-Projects-foo-- for /Users/haydngynn/Projects/foo
function encodePiProjectPath(projectPath) {
  let sanitized = projectPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+/, '');
  if (sanitized.length <= 200) return `--${sanitized}--`;
  let h = 0;
  for (let i = 0; i < projectPath.length; i++) {
    h = (h << 5) - h + projectPath.charCodeAt(i) | 0;
  }
  return `--${sanitized.slice(0, 200)}-${Math.abs(h).toString(36)}--`;
}

function isPiSessionFolder(folder) {
  return typeof folder === 'string' && folder.startsWith('--') && folder.endsWith('--');
}

module.exports = { encodePiProjectPath, isPiSessionFolder };
