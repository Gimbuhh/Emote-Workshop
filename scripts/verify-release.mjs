import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const requireTag = args.includes('--require-tag');
const version = args.find((arg) => !arg.startsWith('--'));

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Usage: npm run release:verify -- <major.minor.patch> [--require-tag]');
}

const [major, minor, patch] = version.split('.');
const displayVersion = patch === '0' ? `${major}.${minor}` : version;
const tag = `v${displayVersion}`;
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
assert(pkg.version === version, `package.json is ${pkg.version}; expected ${version}.`);
assert(lock.version === version, `package-lock.json is ${lock.version}; expected ${version}.`);
assert(
  lock.packages?.['']?.version === version,
  `package-lock.json root package is ${lock.packages?.['']?.version}; expected ${version}.`,
);

const notesPath = `release-notes/${displayVersion}.md`;
assert(existsSync(resolve(root, notesPath)), `${notesPath} is missing.`);

const changelog = read('CHANGELOG.md');
assert(
  new RegExp(`^## ${displayVersion.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(
    changelog,
  ),
  `CHANGELOG.md has no dated ${displayVersion} entry.`,
);
assert(
  changelog.includes(`Package version: \`${version}\`; Git tag: \`${tag}\`.`),
  `CHANGELOG.md does not bind ${version} to ${tag}.`,
);

for (const path of ['dist/index.html', 'Emote Workshop.html']) {
  const content = read(path);
  const escapedVersion = displayVersion.replaceAll('.', '\\.');
  assert(
    new RegExp(`>v${escapedVersion}</a\\s*>`).test(content),
    `${path} does not display v${displayVersion}.`,
  );
  assert(
    content.includes(`https://github.com/Gimbuhh/Emote-Workshop/releases/tag/${tag}`),
    `${path} does not link to the immutable ${tag} release.`,
  );
}

const buildCheck = spawnSync(process.execPath, ['build-offline.mjs', '--check'], {
  cwd: root,
  encoding: 'utf8',
});
if (buildCheck.status !== 0) {
  process.stderr.write(buildCheck.stdout || '');
  process.stderr.write(buildCheck.stderr || '');
  throw new Error('The committed standalone artifact is stale.');
}

if (requireTag) {
  let tagCommit;
  try {
    tagCommit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Required tag ${tag} does not exist.`);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert(tagCommit === head, `${tag} points to ${tagCommit}, not HEAD ${head}.`);
}

console.log(`Release ${version} verified${requireTag ? ` at ${tag}` : ''}.`);
