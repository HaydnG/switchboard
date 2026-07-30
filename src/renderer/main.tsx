import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '@renderer/lib/control-ui-bridge';
import '@renderer/styles/foundation.css';
import { App } from './App';

document.body.classList.add('sb-shell-active');

const mountNode = document.getElementById('react-root');
if (!mountNode) {
  console.error('[SwitchboardUI] #react-root not found — React shell not mounted');
  const bootMessage = document.querySelector('#sb-shell-boot-screen strong');
  if (bootMessage) bootMessage.textContent = 'Switchboard could not start';
} else {
  const root = createRoot(mountNode);
  // Synchronous mount so legacy scripts (app.js) can query status-bar nodes.
  flushSync(() => {
    root.render(<App />);
  });
  requestAnimationFrame(() => {
    document.body.classList.remove('sb-shell-booting');
  });
}
