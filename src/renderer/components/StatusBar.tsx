/** Status bar shell — legacy app.js still updates child nodes by id. */
export function StatusBar() {
  return (
    <div id="status-bar">
      <span id="status-bar-info" />
      <span id="status-bar-usage" />
      <span id="status-bar-activity" />
      <span id="status-bar-updater" />
    </div>
  );
}
