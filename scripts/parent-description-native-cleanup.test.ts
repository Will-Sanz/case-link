import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { it } from 'vitest';
import { fileURLToPath } from 'node:url';
it('restores native fixture controls, health and memberships after each independent cleanup failure', async () => {
const file = fileURLToPath(new URL('./test-parent-auth.ts', import.meta.url));
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const stages: ts.TryStatement[] = [], stops: ts.FunctionDeclaration[] = [];
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.tryBlock.statements[0]?.getText(source).startsWith('const original = descriptionMemberships.filter')) stages.push(node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'descriptionStop') stops.push(node);
  ts.forEachChild(node, visit);
}
visit(source); const stage = stages[0], stop = stops[0]; assert.equal(stages.length, 1); assert.equal(stops.length, 1); assert.ok(stage?.finallyBlock && stop, 'Extract exact owned native cleanup and existing cancellation verifier');
const names = ['descriptionWorkers', 'descriptionRequests', 'descriptionColumns', 'descriptionControls', 'descriptionHealth', 'descriptionMembershipChange', 'descriptionMemberships', 'foodIdentifier', 'foodOperator', 'foodMemberships', 'descriptionHttp', 'db', 'check', 'assert', 'process'];
const text = `(async function(env){const {${names.join(',')}}=env;const descriptionErrors=[];${stop.getText(source)};try{if(env.primary)throw env.primary;} ${stage.catchClause?.getText(source) ?? ''} finally ${stage.finallyBlock.getText(source)}})`;
const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const execute = vm.runInNewContext(js, { AggregateError });
const cases: { name: string; primary?: boolean; failures?: string[]; noHealth?: boolean; newMembership?: boolean }[] = [
  { name: 'success' },
  { name: 'original-only', primary: true },
  ...['request-read:first', 'request-cancel:first', 'controls-write', 'controls-equality', 'health-write', 'health-equality', 'membership-write', 'membership-equality', 'worker-rollback:0', 'worker-close:0'].map(failure => ({ name: failure, failures: [failure] })),
  { name: 'absent-health-delete', noHealth: true, failures: ['health-delete'] },
  { name: 'revoke-new-membership', newMembership: true },
  { name: 'combined-original-and-cleanup', primary: true, failures: ['worker-close:0', 'request-read:first', 'controls-equality', 'health-equality', 'membership-write'] },
];
for (const scenario of cases) {
  const events: string[] = [], reported: string[] = [], injected = new Map<string, Error>(), failures = new Set(scenario.failures ?? []);
  const primary = scenario.primary ? new Error('private-original-error-canary') : undefined;
  function step(name: string) { events.push(name); if (failures.has(name)) { const error = new Error(`private-error-canary:${name}`); injected.set(name, error); throw error; } }
  const controls = { singleton: true, enabled: false }, health = scenario.noHealth ? undefined : { singleton: true, seen_at: '2026-11-18T00:00:00Z' }, memberships = [{ role_name: 'parent_worker', set_option: false }];
  const env = {
    primary, assert, process: { stderr: { write: (line: string) => reported.push(line) } },
    descriptionWorkers: [0, 1].map(id => ({ query: async () => step(`worker-rollback:${id}`), end: async () => step(`worker-close:${id}`) })),
    descriptionRequests: ['first', 'second'].map(id => ({ page: {}, id })),
    descriptionColumns: ['enabled'], descriptionControls: controls, descriptionHealth: health,
    descriptionMembershipChange: { existed: !scenario.newMembership, set: false }, descriptionMemberships: memberships,
    foodOperator: 'synthetic_operator', foodIdentifier: (value: string) => `"${value}"`,
    foodMemberships: async () => { events.push('membership-equality'); return failures.has('membership-equality') ? [] : memberships; },
    descriptionHttp: async (_page: unknown, method: string, url: string) => {
      assert.equal(method, 'POST'); const id = url.split('/').at(-1); events.push(`request-cancel:${id}`);
      return { status: () => failures.has(`request-cancel:${id}`) ? 503 : 200, json: async () => ({ request: { status: 'cancelled' } }) };
    },
    check: (condition: unknown, label: string) => assert.ok(condition, label),
    db: { query: async (sql: string) => {
      if (sql.startsWith('select status')) { step(`request-read:${events.filter(item => item.startsWith('request-read')).length ? 'second' : 'first'}`); return { rows: [{ status: 'active' }] }; }
      if (sql.startsWith('update parent_private.processing_controls')) { step('controls-write'); return {}; }
      if (sql.startsWith('select to_jsonb(c)')) { events.push('controls-equality'); return { rows: [{ value: failures.has('controls-equality') ? {} : controls }] }; }
      if (sql.startsWith('update parent_private.worker_health')) { step('health-write'); return {}; }
      if (sql.startsWith('select to_jsonb(h)')) { events.push('health-equality'); return { rows: [{ value: failures.has('health-equality') ? {} : health }] }; }
      if (sql.startsWith('delete from parent_private.worker_health')) { step('health-delete'); return {}; }
      assert.match(sql, scenario.newMembership ? /^revoke parent_worker/ : /^grant parent_worker/); step('membership-write'); return {};
    } },
  };
  let error;
  try { await execute(env); } catch (value) { error = value; }
  for (const event of ['worker-rollback:0', 'worker-close:0', 'worker-rollback:1', 'worker-close:1', 'request-read:first', 'request-read:second', 'request-cancel:second', 'controls-write', scenario.noHealth ? 'health-delete' : 'health-write', 'membership-write'])
    assert.ok(events.includes(event), `${scenario.name}: still attempted ${event}`);
  if (!failures.size) {
    assert.equal(error, primary, `${scenario.name}: original error identity preserved`); assert.deepEqual(reported, []);
  } else {
    assert.ok(error instanceof AggregateError, `${scenario.name}: cleanup failure remains a failed run`);
    assert.equal(error.errors.length, failures.size + (primary ? 1 : 0), `${scenario.name}: no failures lost`);
    if (primary) assert.equal(error.errors[0], primary);
    for (const injectedError of injected.values()) assert.ok(error.errors.includes(injectedError));
    assert.ok(reported.length === 1 && reported[0].includes('cleanup failed during'));
    assert.ok(!reported.join('').includes('private-'), 'No raw error/credential values logged');
  }

}
});
