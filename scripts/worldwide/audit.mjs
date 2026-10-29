#!/usr/bin/env node
/**
 * Board validation entrypoint. `harness` checks this worktree, the production
 * commands, and proves the checkers reject invalid documents. Other modes
 * validate later evidence and fail closed until that evidence is valid.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUDIT_MODES,
  ContractError,
  canonicalFixture,
  problem,
  runSelfTest,
  validSample,
  validateAuditDocument,
  validateWorkspace,
} from './check-contracts.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const CHECK_CONTRACTS = path.join(ROOT, 'scripts/worldwide/check-contracts.mjs');
const AUDIT = path.join(ROOT, 'scripts/worldwide/audit.mjs');
const COMPANIONS = {
  'source-inventory': [{ path: 'scripts/worldwide/discover.ts', needles: ['justicedao', 'endomorphosis', 'page'] }],
  'source-dispositions': [{ path: 'scripts/worldwide/classify.ts', needles: ['include', 'exclude', 'blocked'] }],
  catalog: [
    { path: 'scripts/worldwide/catalog.ts', needles: ['coverage', 'integrity', 'denominator'] },
    { path: 'src/lib/worldwide/data/catalog.ts', needles: ['coverage', 'integrity', 'denominator'] },
  ],
  geography: [{ path: 'scripts/worldwide/build-places.ts', needles: ['attribution', 'license'] }],
  performance: [{ path: 'scripts/worldwide/benchmark.ts', needles: ['p95', 'cancellation'] }],
};

function fail(code, message, at = '') {
  throw new ContractError([problem(code, message, at)]);
}

function safePath(rel) {
  if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) fail('unsafe_path', 'unsafe evidence path', rel || '');
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) fail('unsafe_path', 'evidence path escapes the repository', rel);
  return full;
}

function readText(rel) {
  const full = safePath(rel);
  if (!fs.existsSync(full)) fail('missing_evidence', 'required evidence is absent: ' + rel, rel);
  return fs.readFileSync(full, 'utf8');
}

function readJson(rel) {
  try {
    return JSON.parse(readText(rel));
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError([problem('invalid_json', rel + ': ' + error.message, rel)]);
  }
}

function git(args) {
  const result = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  if (result.status !== 0) fail('worktree_rejected', (result.stderr || result.stdout || 'git failed').trim(), 'git');
  return result.stdout.trim();
}

function inspectWorktree() {
  const gitDir = path.resolve(ROOT, git(['rev-parse', '--git-dir']));
  const commonDir = path.resolve(ROOT, git(['rev-parse', '--git-common-dir']));
  const listed = git(['worktree', 'list', '--porcelain'])
    .split('\n')
    .some((line) => line.startsWith('worktree ') && path.resolve(line.slice('worktree '.length)) === ROOT);
  return {
    inside: git(['rev-parse', '--is-inside-work-tree']) === 'true',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(['rev-parse', 'HEAD']),
    linked: gitDir !== commonDir,
    listed,
  };
}

function loadEvaluatedConfig(source, stubs) {
  let code = source.replace(/^\uFEFF/, '');
  code = code.replace(/import\s+type\s+[\s\S]*?;/g, '');
  code = code.replace(/import\s+\{([\s\S]*?)\}\s+from\s+['"][^'"]+['"]\s*;?/g, (_, names) => `const {${names}} = __stubs;`);
  code = code.replace(/(^|\n)(\s*(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*)\s*:\s*[^=\n]+/g, '$1$2');
  if (!/export\s+default\s+/.test(code)) fail('config_rejected', 'config has no default export', 'config');
  code = code.replace(/export\s+default\s+/, 'return ');
  try {
    return new Function('__stubs', 'process', code)(stubs, process);
  } catch (error) {
    throw new ContractError([problem('config_rejected', 'config did not evaluate: ' + error.message, 'config')]);
  }
}

function runNode(args, input) {
  return spawnSync(process.execPath, args, { cwd: ROOT, input, encoding: 'utf8', env: process.env });
}

function parsePayload(text) {
  const start = String(text || '').indexOf('{');
  if (start < 0) fail('invalid_json', 'validator emitted no JSON', 'cli');
  try {
    return JSON.parse(text.slice(start));
  } catch (error) {
    throw new ContractError([problem('invalid_json', error.message, 'cli')]);
  }
}

function requireReject(args, input, code) {
  const result = runNode(args, input);
  if (result.status === 0) fail('self_test', 'CLI accepted invalid input: ' + args.join(' '), 'cli');
  const codes = (parsePayload(result.stderr || '').errors || []).map((entry) => entry.code);
  if (!codes.includes(code)) fail('self_test', 'CLI rejected ' + codes.join(',') + ' instead of ' + code, args.join(' '));
}

function requireAccept(args, input) {
  const result = runNode(args, input);
  if (result.status !== 0) fail('self_test', 'CLI rejected valid input: ' + (result.stderr || result.stdout), args.join(' '));
  return parsePayload(result.stdout || '');
}

function assertCompanions(mode) {
  for (const companion of COMPANIONS[mode] || []) {
    const source = readText(companion.path);
    if (source.trim().length < 80 || !/\bexport\b/.test(source) || !/\b(?:function|class)\b/.test(source)) {
      fail('missing_evidence', companion.path + ' is not a production module', companion.path);
    }
    if (/\bnot implemented\b|TODO:\s*implement/i.test(source)) fail('existence_only', companion.path + ' is a stub', companion.path);
    for (const needle of companion.needles) {
      if (!source.includes(needle)) fail('missing_field', companion.path + ' does not implement ' + needle, companion.path);
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bhf_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9]{20,}\b/.test(source)) {
      fail('secret_material', companion.path + ' contains credential material', companion.path);
    }
  }
}

function loadCi() {
  const workflow = readText('.github/workflows/worldwide-checks.yml');
  const regressions = readJson('docs/worldwide/regression-selection.json');
  const files = {};
  if (regressions && Array.isArray(regressions.preserved)) {
    for (const item of regressions.preserved) {
      if (!item || typeof item.path !== 'string') continue;
      try {
        files[item.path] = readText(item.path);
      } catch (error) {
        if (error instanceof ContractError && error.errors.some((entry) => entry.code === 'missing_evidence')) files[item.path] = null;
        else throw error;
      }
    }
  }
  return { workflow, regressions, files };
}

function loadMode(mode) {
  switch (mode) {
    case 'source-inventory':
      return readJson('data/worldwide/source-inventory.json');
    case 'source-dispositions':
      return readJson('data/worldwide/source-dispositions.json');
    case 'rights':
      return readJson('data/worldwide/rights.json');
    case 'catalog':
      return readJson('data/worldwide/catalog.schema.json');
    case 'inventory-closure':
      return { ledger: readJson('data/worldwide/ingestion-ledger.json'), coverage: readJson('docs/worldwide/coverage-audit.json') };
    case 'geography':
      return readJson('data/worldwide/geography-manifest.json');
    case 'jurisdiction-fixtures':
      return readJson('tests/worldwide/fixtures/jurisdiction-cases.json');
    case 'retrieval-evaluation':
      return readJson('tests/worldwide/fixtures/retrieval-evaluation.json');
    case 'ux-contract':
      return { states: readJson('docs/worldwide/interaction-states.json'), design: readText('docs/worldwide/design.md') };
    case 'performance':
      return readJson('docs/worldwide/performance.json');
    case 'ci-contract':
      return loadCi();
    case 'product-acceptance':
      return readJson('docs/worldwide/product-acceptance.json');
    case 'maintenance':
      return { markdown: readText('docs/worldwide/maintenance.md'), source: readText('scripts/worldwide/refresh.ts') };
    case 'release-candidate':
      return { candidate: readJson('docs/worldwide/release-candidate.json'), workflow: readText('.github/workflows/deploy.yml') };
    case 'deployment':
      return readJson('docs/worldwide/deployment.json');
    case 'public-smoke':
      return readJson('docs/worldwide/public-smoke.json');
    case 'campaign-closure':
      return { closure: readJson('docs/worldwide/campaign-closure.json'), future: readJson('docs/worldwide/future-coverage.json') };
    default:
      fail('unknown_mode', 'no loader for ' + mode, mode);
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) return '';
  return args[index + 1];
}

function findManifests(phase) {
  const base = path.join(ROOT, 'artifacts/worldwide-legal-search/sources');
  if (!fs.existsSync(base)) return [];
  const found = [];
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === phase + '.manifest.json') found.push(full);
    }
  }
  return found;
}

function runSourceJob(args) {
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '--job-id' && args[index] !== '--phase') fail('unknown_mode', 'unsupported source-job argument ' + args[index], 'argv');
  }
  const jobId = option(args, '--job-id');
  const phase = option(args, '--phase');
  if (!jobId || !phase) fail('missing_field', 'source-job requires --job-id and --phase', 'argv');
  const matches = [];
  for (const full of findManifests(phase)) {
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      throw new ContractError([problem('invalid_json', path.relative(ROOT, full) + ': ' + error.message, path.relative(ROOT, full))]);
    }
    if (doc && doc.job_id === jobId) matches.push(doc);
  }
  if (matches.length === 0) fail('missing_evidence', 'no ' + phase + ' manifest contains job ' + jobId, jobId);
  if (matches.length > 1) fail('integrity', 'more than one manifest matches ' + jobId, jobId);
  const result = validateAuditDocument('source-job', matches[0], { jobId, phase });
  return { ok: true, command: 'source-job', job_id: jobId, phase, ...result };
}

function runHarness() {
  const selfTest = runSelfTest();
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const jestSource = readText('jest.config.ts');
  const playwrightSource = readText('playwright.config.ts');
  const snapshot = {
    plan: readJson('implementation_plan/worldwide_legal_search/plan.json'),
    packageJson,
    packageLock,
    jestConfig: loadEvaluatedConfig(jestSource, {}),
    playwrightConfig: loadEvaluatedConfig(playwrightSource, {
      defineConfig: (config) => config,
      devices: { 'Desktop Chrome': { viewport: { width: 1280, height: 720 } } },
    }),
    playwrightSource,
    tsconfig: readJson('tsconfig.json'),
    readme: readText('tests/worldwide/README.md'),
    worktree: inspectWorktree(),
    exists: (rel) => {
      try {
        return fs.existsSync(safePath(rel));
      } catch {
        return false;
      }
    },
  };
  validateWorkspace(snapshot);
  const cliSelf = requireAccept([CHECK_CONTRACTS, '--self-test']);
  requireReject([CHECK_CONTRACTS, '--fixture-stdin'], '{', 'invalid_json');
  requireReject([CHECK_CONTRACTS, '--fixture-stdin'], JSON.stringify({ schema: 'worldwide-legal-search.fixture@1', exists: true, path: 'tests/worldwide/fixtures/example.json' }), 'existence_only');
  requireAccept([CHECK_CONTRACTS, '--fixture-stdin'], JSON.stringify(canonicalFixture()));
  requireReject([CHECK_CONTRACTS, '--document', 'source-inventory'], JSON.stringify({ exists: true, path: 'data/worldwide/source-inventory.json' }), 'existence_only');
  requireAccept([CHECK_CONTRACTS, '--document', 'source-inventory'], JSON.stringify(validSample('source-inventory')));
  requireReject([AUDIT, 'not-a-mode'], '', 'unknown_mode');
  requireReject([AUDIT], '', 'missing_field');
  requireReject([AUDIT, 'source-inventory'], '', 'missing_evidence');
  return {
    ok: true,
    schema: 'worldwide-legal-search.harness@1',
    command: 'harness',
    self_test: { accepted: selfTest.accepted, rejected: selfTest.rejected },
    cli_self_test: { accepted: cliSelf.accepted, rejected: cliSelf.rejected },
    cli_rejections: 5,
    cli_accepts: 2,
    board_modes: AUDIT_MODES.length,
    worktree: { branch: snapshot.worktree.branch, head: snapshot.worktree.head, linked: snapshot.worktree.linked, listed: snapshot.worktree.listed },
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) fail('missing_field', 'audit mode is required', 'argv');
  const mode = args[0];
  if (!AUDIT_MODES.includes(mode)) fail('unknown_mode', 'unknown audit mode ' + mode, 'argv');
  if (mode === 'harness') return runHarness();
  if (mode === 'source-job') return runSourceJob(args.slice(1));
  const result = validateAuditDocument(mode, loadMode(mode));
  assertCompanions(mode);
  return { ok: true, command: mode, ...result };
}

try {
  process.stdout.write(JSON.stringify(main(), null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ ok: false, error_class: error.name || 'Error', error: error.message, errors: error.errors || [] }, null, 2) + '\n');
  process.exit(1);
}
