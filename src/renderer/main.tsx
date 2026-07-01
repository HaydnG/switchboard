import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '@renderer/lib/control-ui-bridge';
import { App } from './App';

const mountNode = document.getElementById('react-root');
if (!mountNode) {
  console.error('[SwitchboardUI] #react-root not found — React shell not mounted');
} else {
  const root = createRoot(mountNode);
  // Synchronous mount so legacy scripts (app.js) can query status-bar nodes.
  flushSync(() => {
    root.render(<App />);
  });
}
