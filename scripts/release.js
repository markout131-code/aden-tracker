#!/usr/bin/env node
/**
 * Aden Tracker — Auto Release Script
 * Χρήση: npm run deploy
 * Διαβάζει την τρέχουσα version από package.json,
 * κάνει patch bump (1.4.5 → 1.4.6), ενημερώνει ΟΛΑ τα αρχεία,
 * κάνει git commit + tag + push, και τρέχει electron-builder --publish always
 * Το GitHub release δημιουργείται αυτόματα ΩΣ PUBLIC (draft: false).
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ── 1. Διάβασε τρέχουσα version ──────────────────────────────────────────────
const pkgPath = path.join(ROOT, 'package.json');
const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const parts = pkg.version.split('.').map(Number);
parts[2] += 1;                          // patch bump  e.g. 1.4.5 → 1.4.6
const newVersion = parts.join('.');
console.log(`\n🔖  Bumping version  ${pkg.version}  →  ${newVersion}\n`);

// ── 2. Ενημέρωσε package.json ────────────────────────────────────────────────
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('✅  package.json updated');

// ── 3. Ενημέρωσε splash.html (version badge) ─────────────────────────────────
const splashPath = path.join(ROOT, 'splash.html');
if (fs.existsSync(splashPath)) {
    let splash = fs.readFileSync(splashPath, 'utf8');
    splash = splash.replace(
        /<div class="version"[^>]*>v[\d.]+<\/div>/,
        `<div class="version" id="ver">v${newVersion}</div>`
    );
    // Also update the hardcoded ver string just in case
    splash = splash.replace(/v\d+\.\d+\.\d+(?=<\/div>)/, `v${newVersion}`);
    fs.writeFileSync(splashPath, splash, 'utf8');
    console.log('✅  splash.html updated');
}

// ── 4. Ενημέρωσε index.html (version badge) ──────────────────────────────────
const indexPath = path.join(ROOT, 'index.html');
if (fs.existsSync(indexPath)) {
    let index = fs.readFileSync(indexPath, 'utf8');
    index = index.replace(
        /(<span[^>]*id="verBdg"[^>]*>)v[\d.]+(<\/span>)/,
        `$1v${newVersion}$2`
    );
    fs.writeFileSync(indexPath, index, 'utf8');
    console.log('✅  index.html updated');
}

// ── 5. Git commit + tag + push ────────────────────────────────────────────────
try {
    execSync('git add package.json splash.html index.html', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "Release v${newVersion}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync(`git tag v${newVersion}`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git push origin v${newVersion}`, { cwd: ROOT, stdio: 'inherit' });
    console.log(`✅  Git tag v${newVersion} pushed`);
} catch (e) {
    console.error('❌  Git error:', e.message);
    process.exit(1);
}

// ── 6. Build + publish ────────────────────────────────────────────────────────
// --publish always → δημιουργεί PUBLIC GitHub release αυτόματα
console.log('\n📦  Building and publishing...\n');
try {
    execSync('npx electron-builder --win --publish always', { cwd: ROOT, stdio: 'inherit' });
    console.log(`\n🚀  Released v${newVersion} successfully!\n`);
} catch (e) {
    console.error('❌  Build/publish error:', e.message);
    process.exit(1);
}
