/**
 * Clean dist before publish/build so stale artifacts (including accidental logs) are not bundled into the npm package.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('[clean-dist] removed dist/');
} else {
  console.log('[clean-dist] dist/ already absent');
}
