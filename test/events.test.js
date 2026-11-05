const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, salvage, askDetail, isTestCommand, toolKind } = require('../src/events');

const post = (command, stdout, extra = {}) =>
  summarize({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: '/work/app', tool_name: 'Bash', tool_input: { command }, tool_response: { stdout }, ...extra });

test('summarize：常见事件压缩成小事件，不认识的返回 null', () => {
  const ev = summarize({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: 'C:/code/my-app/', tool_name: 'Edit', tool_input: { file_path: 'C:/code/my-app/src/main.js' } });
  assert.equal(ev.event, 'PreToolUse');
  assert.equal(ev.project, 'my-app');
  assert.equal(ev.toolKind, 'edit');
  assert.equal(ev.detail, 'main.js');
  assert.equal(summarize({ hook_event_name: 'SomethingNew' }), null);
  assert.equal(summarize(null), null);
});

test('summarize：Claude 在问你问题、计划等你确认', () => {
  const q = summarize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '用深色还是浅色？' }] } });
  assert.equal(q.decision, 'question');
  assert.equal(q.text, '用深色还是浅色？');
  const plan = summarize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'ExitPlanMode', tool_input: { plan: '## 计划\n**第一步**' } });
  assert.equal(plan.decision, 'plan');
});

test('toolKind', () => {
  assert.equal(toolKind('Bash'), 'shell');
  assert.equal(toolKind('Grep'), 'read');
  assert.equal(toolKind('WebFetch'), 'web');
  assert.equal(toolKind('mcp__chrome__navigate'), 'web');
  assert.equal(toolKind('Agent'), 'agent');
  assert.equal(toolKind('TodoWrite'), 'other');
});

test('isTestCommand：只认每段命令开头的测试程序', () => {
  for (const cmd of [
    'npm test',
    'npm t',
    'yarn test:unit',
    'npm run test:e2e',
    'cd app && npm test 2>&1 | tail -5',
    '(cd app && npm test)',
    'CI=1 npx jest --ci',
    'pnpm exec vitest run',
    'pytest -q',
    'python -m pytest tests/',
    'python3 -m unittest',
    'go test ./...',
    'cargo test',
    'cargo nextest run',
    'node --test',
    'node --experimental-strip-types --test',
    'npx playwright test',
    './gradlew clean test',
    'vendor/bin/phpunit',
    'bundle exec rspec',
    'make test',
  ]) {
    assert.ok(isTestCommand(cmd), cmd);
  }
  for (const cmd of [
    'cat test/fixtures.json',
    'ls tests',
    'grep -rn passed tests/',
    'git commit -m "add tests; ok"',
    'echo "npm test"',
    'mkdir -p test',
    'curl -s https://example.com/test',
    '',
  ]) {
    assert.ok(!isTestCommand(cmd), cmd);
  }
});

test('测试结果：通过、失败、认不出来', () => {
  assert.equal(post('npm test', 'Tests:  3 passed, 3 total').test, 'pass');
  assert.equal(post('pytest -q', '1 failed, 10 passed in 0.5s').test, 'fail');
  assert.equal(post('python -m unittest', 'FAILED (failures=1)').test, 'fail');
  assert.equal(post('go test ./...', 'ok  \tpkg/foo\t0.01s').test, 'pass');
  assert.equal(post('node --test', '# pass 5\n# fail 0').test, 'pass');
  assert.equal(post('node --test', '# pass 4\n# fail 1').test, 'fail');
  assert.equal(post('cargo nextest run', '10 tests run: 9 passed, 1 failed').test, 'fail');
  assert.equal(post('cat test/fixtures.json', '{"status":"ok"}').test, null);
  assert.equal(post('ls tests', 'a.test.js  ok.txt').test, null);
  // 命令本身失败了
  const failed = summarize({ hook_event_name: 'PostToolUseFailure', session_id: 's', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: {} });
  assert.equal(failed.test, 'fail');
  assert.equal(failed.error, true);
});

test('askDetail：截掉了就在末尾留省略号（桌宠那边靠它不给「允许」）', () => {
  const long = 'x'.repeat(500);
  const d = askDetail('Bash', { command: long });
  assert.equal(d.length, 400);
  assert.ok(d.endsWith('…'));
  assert.equal(askDetail('Bash', { command: 'npm test' }), 'npm test');
  assert.ok(askDetail('WebFetch', { url: 'https://example.com/' + 'a'.repeat(300) }).endsWith('…'));
  assert.equal(askDetail('Write', { file_path: 'C:\\a\\b.txt' }), 'C:\\a\\b.txt');
});

test('askDetail：MCP 之类的工具把参数列出来，不只给个工具名', () => {
  assert.equal(askDetail('mcp__github__delete_file', { owner: 'me', repo: 'prod', path: 'config/secrets.yml' }), 'owner=me repo=prod path=config/secrets.yml');
  // 带空格、换行的值用 JSON 写法，换行不会被折行藏起来
  assert.equal(askDetail('mcp__db__query', { sql: 'DROP TABLE users;\n--', dry: false }), 'sql="DROP TABLE users;\\n--" dry=false');
  assert.equal(askDetail('mcp__x__ping', {}), 'ping');
  const long = askDetail('mcp__x__put', { body: 'y'.repeat(1000) });
  assert.equal(long.length, 400);
  assert.ok(long.endsWith('…'));
});

test('salvage：截断的请求体至少捞出事件名、会话和工具', () => {
  const ev = salvage('{"session_id":"abc","hook_event_name":"PreToolUse","cwd":"/x/proj","tool_name":"Bash","tool_input":{"command":"aaa');
  assert.equal(ev.event, 'PreToolUse');
  assert.equal(ev.sessionId, 'abc');
  assert.equal(ev.project, 'proj');
  assert.equal(ev.tool, 'Bash');
  assert.equal(salvage('not json at all'), null);
});

test('任务工具：TaskCreate 跑完才拿到编号，TaskUpdate 改状态', () => {
  const created = summarize({ hook_event_name: 'PostToolUse', session_id: 's', tool_name: 'TaskCreate', tool_input: { subject: '写测试' }, tool_response: { task: { id: 7 } } });
  assert.deepEqual(created.task, { op: 'create', id: '7', status: 'pending', text: '写测试' });
  const updated = summarize({ hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'TaskUpdate', tool_input: { taskId: 7, status: 'in_progress', activeForm: '在写测试' } });
  assert.equal(updated.task.op, 'update');
  assert.equal(updated.task.status, 'in_progress');
  assert.equal(updated.todo, '在写测试');
});
