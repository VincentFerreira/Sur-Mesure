// Single source of truth for the ports playwright.config.ts spawns its own client+API
// pair on for e2e — deliberately different from the app's normal dev ports (3000
// Vite / 3001 Express) so `npm run test:e2e` never collides with, and never requires
// stopping, an already-running `npm start` session. Imported both by
// playwright.config.ts (to configure the servers it spawns) and by every spec/helper
// that talks to the API directly (via `request.post(...)`) rather than through the
// app's own UI.
export const E2E_CLIENT_PORT = 3100;
export const E2E_API_PORT = 3101;
export const API_URL = `http://localhost:${E2E_API_PORT}`;
