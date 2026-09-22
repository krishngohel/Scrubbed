// Copies the static client surface (everything netlify.toml serves as
// public) into www/ so Capacitor has a self-contained webDir. Server code
// (server.js, db.js, routes/, middleware/, netlify/) stays out of the bundle.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'www');

const files = [
  'index.html',
  'vault.html',
  'dashboard.html',
  'secondaries.html',
  'landing.html',
  'privacy.html',
  'reset-password.html',
  'auth-callback.html',
  'app.js',
  'account-menu.js',
  'navbar.js',
  'theme.js',
  'native.js',
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const f of files) {
  fs.copyFileSync(path.join(root, f), path.join(outDir, f));
}

console.log(`Copied ${files.length} files to www/`);
