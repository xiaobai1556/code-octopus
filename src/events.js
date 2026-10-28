// 把 Claude Code hook 的原始输入压缩成桌宠需要的小事件。
// 原始输入里可能有整份文件内容（tool_result），不要原样转给渲染进程。
const path = require('path');

function short(s, n = 22) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function base(p) {
  if (!p) return '';
  return path.basename(String(p).replace(/[\\/]+$/, ''));
}

function toolKind(name = '') {
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(name)) return 'edit';
  if (/^(Bash|PowerShell|BashOutput|KillShell|KillBash|Monitor)$/.test(name)) return 'shell';
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(name)) return 'read';
  if (/^(WebFetch|WebSearch)$/.test(name) || /^mcp__.*(browser|chrome|fetch|search|navigate)/i.test(name)) return 'web';
  if (/^(Task|Agent)$/.test(name)) return 'agent';
  return 'other';
}

// 气泡里的"字幕"：工具在干什么。气泡会自己折行、截断，这里只限制一个上限
function describeTool(name = '', input = {}) {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return short(input.command, 80);
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return short(base(input.file_path || input.notebook_path), 48);
    case 'Grep':
    case 'Glob':
      return short(input.pattern, 48);
    case 'WebFetch':
      try { return new URL(input.url).hostname; } catch { return ''; }
    case 'WebSearch':
      return short(input.query, 60);
    case 'Task':
    case 'Agent':
      return short(input.description || input.subagent_type, 60);
    default:
      return short(name.replace(/^mcp__.*__/, ''), 40);
  }
}

// 需要用户做决定的工具：Claude 在问你问题，或者计划写好了等你确认
function decisionOf(name, input = {}) {
  if (name === 'AskUserQuestion') {
    const q = Array.isArray(input.questions) && input.questions[0];
    return { decision: 'question', text: short((q && (q.question || q.header)) || input.question, 120) };
  }
  if (name === 'ExitPlanMode') return { decision: 'plan', text: short(String(input.plan || '').replace(/[#*`>]/g, ''), 120) };
  return null;
}

// 待办工具里"正在做"的那一项
function currentTodo(name, input = {}) {
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    const t = input.todos.find((x) => x && x.status === 'in_progress');
    return t ? short(t.activeForm || t.content, 80) : '';
  }
  if ((name === 'TaskUpdate' || name === 'TaskCreate') && input.status === 'in_progress') {
    return short(input.activeForm || input.subject || input.description, 80);
  }
  return '';
}

// 进度卡片用的整份待办清单：TodoWrite 每次给全量；任务工具（TaskCreate / TaskUpdate）一条一条改
function todoList(name, input = {}) {
  if (name !== 'TodoWrite' || !Array.isArray(input.todos)) return null;
  return input.todos.slice(0, 30).map((t) => ({ text: short(t && (t.status === 'in_progress' ? t.activeForm || t.content : t.content), 60), status: (t && t.status) || 'pending' }));
}

function taskChange(e, name, input = {}, response) {
  if (name === 'TaskUpdate' && e === 'PreToolUse' && input.taskId != null) {
    return { op: 'update', id: String(input.taskId), status: input.status || '', text: input.subject ? short(input.subject, 60) : '' };
  }
  // 新任务的编号要等创建完才知道
  if (name === 'TaskCreate' && e === 'PostToolUse') {
    const r = response || {};
    const id = (r.task && r.task.id) || r.taskId || r.id || (toText(r).match(/#\s*(\d+)/) || [])[1];
    if (id != null) return { op: 'create', id: String(id), status: 'pending', text: short(input.subject || input.description, 60) };
  }
  return null;
}

// 在桌宠上批准时显示的内容：命令尽量完整
function askDetail(name = '', input = {}) {
  if (name === 'Bash' || name === 'PowerShell') return String(input.command || '').slice(0, 400);
  if (input.file_path || input.notebook_path) return String(input.file_path || input.notebook_path);
  if (input.url) return String(input.url).slice(0, 200);
  return describeTool(name, input);
}

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 50000);
  if (typeof v === 'object') {
    const parts = [v.stdout, v.stderr, v.output, v.error, typeof v.content === 'string' ? v.content : ''];
    const joined = parts.filter(Boolean).join('\n');
    return (joined || JSON.stringify(v)).slice(0, 50000);
  }
  return String(v);
}

const TEST_CMD = /\b(test|tests|jest|vitest|pytest|mocha|ava|go test|cargo test|ctest|phpunit|rspec)\b/i;

function testOutcome(ev, failed) {
  const cmd = ev.tool_input && ev.tool_input.command;
  if (!cmd || !TEST_CMD.test(cmd)) return null;
  if (failed) return 'fail';
  const text = toText(ev.tool_result ?? ev.tool_response);
  if (/\b[1-9]\d*\s+(failed|failing|failures?)\b/i.test(text) || /^\s*FAIL\b/m.test(text)) return 'fail';
  if (/\b(passed|passing)\b|\bok\b|✓/i.test(text)) return 'pass';
  return null;
}

function notifyKind(ev) {
  const type = ev.notification_type || '';
  const msg = ev.message || '';
  if (type === 'permission_prompt' || (!type && /permission/i.test(msg))) return 'permission';
  if (type === 'idle_prompt' || (!type && /waiting for your input/i.test(msg))) return 'idle';
  if (/^(elicitation_dialog|elicitation_url_dialog|agent_needs_input)$/.test(type)) return 'input';
  return 'info';
}

/** 原始 hook 输入 → 桌宠事件；不认识的事件返回 null */
function summarize(ev) {
  if (!ev || typeof ev !== 'object' || !ev.hook_event_name) return null;
  const e = ev.hook_event_name;
  const out = { event: e, sessionId: ev.session_id || 'default', project: base(ev.cwd) };

  switch (e) {
    case 'SessionStart':
      out.source = ev.source || 'startup';
      out.model = short(ev.model, 40);
      break;
    case 'SessionEnd':
      out.reason = ev.reason || '';
      break;
    case 'PreToolUse':
    case 'PermissionRequest': {
      const input = ev.tool_input || {};
      out.tool = ev.tool_name || '';
      out.toolKind = toolKind(out.tool);
      out.detail = describeTool(out.tool, input);
      out.todo = currentTodo(out.tool, input);
      out.todos = todoList(out.tool, input);
      out.task = taskChange(e, out.tool, input);
      Object.assign(out, decisionOf(out.tool, input));
      break;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const failed = e === 'PostToolUseFailure' || !!(ev.tool_response && ev.tool_response.is_error);
      out.tool = ev.tool_name || '';
      out.toolKind = toolKind(out.tool);
      out.detail = describeTool(out.tool, ev.tool_input || {}); // 和 PermissionRequest 的对得上：等批准的那个工具跑完了
      out.error = failed;
      out.test = testOutcome(ev, failed);
      out.task = failed ? null : taskChange(e, out.tool, ev.tool_input || {}, ev.tool_response);
      break;
    }
    case 'Notification':
      out.notify = notifyKind(ev);
      out.message = short(ev.message, 40);
      break;
    case 'SubagentStart':
    case 'SubagentStop':
      out.agentId = ev.agent_id || ev.subagent_id || '';
      out.agentType = short(ev.agent_type || ev.subagent_type, 30);
      break;
    // 字幕：你说的话、Claude 做完后的总结
    case 'UserPromptSubmit':
      out.text = short(ev.prompt, 120);
      break;
    case 'Stop':
      out.text = short(String(ev.last_assistant_message || '').replace(/[#*`>|]/g, ''), 160);
      break;
    case 'StopFailure':
      out.text = short(ev.error && typeof ev.error === 'object' ? ev.error.message : ev.error || ev.error_message || ev.reason, 80);
      break;
    case 'PreCompact':
    case 'PostCompact':
      break;
    default:
      return null;
  }
  return out;
}

// 超大的请求体被截断时，至少把事件名、会话和工具名捞出来
function salvage(text) {
  const pick = (k) => {
    const m = text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : undefined;
  };
  const name = pick('hook_event_name');
  if (!name) return null;
  return summarize({ hook_event_name: name, session_id: pick('session_id'), cwd: pick('cwd'), tool_name: pick('tool_name') });
}

module.exports = { summarize, salvage, toolKind, askDetail };
