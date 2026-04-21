import { createRoot } from 'react-dom/client';
import './styles/mastisk.css';
import { App } from './App';

const el = document.getElementById('root')!;
createRoot(el).render(<App />);

// When a new Service Worker takes control (vite-plugin-pwa `autoUpdate` +
// `skipWaiting`+`clientsClaim`), reload once so the open tab stops running
// stale JS. Without this, users on an already-open tab keep seeing the old
// bundle after a deploy until they manually refresh — which is how a recent
// sidebar change (adding Open Questions to SYS_VIEWS) silently failed for
// existing users.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
