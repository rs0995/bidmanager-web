// Builds the Windows installer, bumping the version first.
//
// Version rule: the patch digit climbs 0..9, then rolls into the minor and
// resets — 0.1.0 -> 0.1.1 -> ... -> 0.1.9 -> 0.2.0 -> ... -> 0.9.9 -> 1.0.0.
// Each digit stays a single digit, so the version always reads x.y.z.
//
// The bump happens BEFORE packaging so electron-builder names the installer
// for the new version (artifactName uses ${version}). If the build then fails
// the bump is undone, so a failed run never burns a version number — same
// behaviour as Server UI/build_admin_electron_setup.bat.
//
// Run through `npm run desktop:dist`. Plain `npm run build` does NOT bump:
// that one runs constantly during development, and the version only means
// something on a shipped installer.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const outDir = path.join(root, 'dist-electron');
const archiveDir = path.join(root, 'Archived Installers');

function readPackage() {
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
}

function writeVersion(version) {
  // Re-read rather than reuse a cached object, so nothing else written to
  // package.json in the meantime is clobbered.
  const pkg = readPackage();
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function nextVersion(current) {
  const parts = String(current).split('.');
  if (parts.length !== 3) throw new Error(`Version "${current}" is not x.y.z.`);
  const [major, minor, patch] = parts.map((part) => Number(part));
  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Version "${current}" is not three numbers.`);
  }
  let nextPatch = patch + 1;
  let nextMinor = minor;
  let nextMajor = major;
  if (nextPatch > 9) { nextPatch = 0; nextMinor += 1; }
  if (nextMinor > 9) { nextMinor = 0; nextMajor += 1; }
  return `${nextMajor}.${nextMinor}.${nextPatch}`;
}

function run(command, args) {
  // shell: true so npm/npx resolve from PATH on Windows.
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true });
  return result.status === 0;
}

// Keep the previous version's artifacts instead of leaving every build piled
// up in dist-electron. The folder is git-ignored.
function archivePrevious(version) {
  if (!fs.existsSync(outDir)) return;
  const stale = fs.readdirSync(outDir).filter((name) => name.includes(version) && fs.statSync(path.join(outDir, name)).isFile());
  if (!stale.length) return;
  const target = path.join(archiveDir, version);
  fs.mkdirSync(target, { recursive: true });
  for (const name of stale) {
    try { fs.renameSync(path.join(outDir, name), path.join(target, name)); } catch { /* leave it */ }
  }
  console.log(`Archived ${stale.length} file(s) from ${version} to Archived Installers/${version}/`);
}

const previousVersion = readPackage().version;
const version = nextVersion(previousVersion);
console.log(`Version: ${previousVersion} -> ${version}`);
writeVersion(version);

if (!run('npm', ['run', 'build']) || !run('npx', ['electron-builder', '--win', 'nsis'])) {
  writeVersion(previousVersion);
  console.error(`\nBuild failed — version restored to ${previousVersion}.`);
  process.exit(1);
}

const installer = path.join(outDir, `BidManager-Client-Setup-${version}.exe`);
if (!fs.existsSync(installer)) {
  writeVersion(previousVersion);
  console.error(`\nExpected ${path.basename(installer)} but it wasn't produced — version restored to ${previousVersion}.`);
  process.exit(1);
}

archivePrevious(previousVersion);
console.log(`\nBuilt ${path.basename(installer)}`);
