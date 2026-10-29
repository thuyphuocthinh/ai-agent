// Trang playground: 1 file HTML, CSS và JS inline, không script bên thứ ba.
// Tuân thủ thiết kế tối giản chuẩn Vercel AI Elements / shadcn/ui.
export const PLAYGROUND_HTML = /* html */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Playground</title>
<style>
  :root {
    --bg: #09090b;
    --panel: #121214;
    --surface: #18181b;
    --line: #27272a;
    --line-subtle: #1f1f23;
    --text: #ededed;
    --text-muted: #71717a;
    --text-dim: #a1a1aa;
    --accent: #ffffff;
    --accent-text: #09090b;
    --ok: #10b981;
    --err: #ef4444;
    --warn: #f59e0b;
    --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --panel: #fcfcfc;
      --surface: #f4f4f5;
      --line: #e4e4e7;
      --line-subtle: #f4f4f5;
      --text: #09090b;
      --text-muted: #71717a;
      --text-dim: #52525b;
      --accent: #09090b;
      --accent-text: #ffffff;
      --ok: #059669;
      --err: #dc2626;
      --warn: #d97706;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    height: 48px;
    border-bottom: 1px solid var(--line);
    padding: 0 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg);
    flex-shrink: 0;
  }
  .brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
  .brand-tag { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); }
  .header-status { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); background: var(--surface); border: 1px solid var(--line); padding: 2px 8px; border-radius: 4px; }
  
  #log {
    flex: 1;
    overflow-y: auto;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
  }
  .msg { width: 100%; }
  .user {
    max-width: 80%;
    margin-left: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 10px 14px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .bot {
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  
  /* Status Indicator */
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 2px 0;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: pulse-subtle 1.8s infinite ease-in-out;
  }
  @keyframes pulse-subtle { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

  /* Sequential Agents Flow (Chạy tuần tự từng bước) */
  .agents-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }

  /* Workflow Progress Bar (Cố định ngay trên phần nhập câu hỏi) */
  .workflow-progress {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 800px;
    width: 100%;
    margin: 0 auto 10px;
    box-sizing: border-box;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .progress-title {
    font-weight: 600;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .progress-percent {
    color: var(--ok);
    font-weight: 700;
  }
  .progress-count {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--line-subtle);
    padding: 2px 8px;
    border-radius: 4px;
  }
  .progress-track {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--surface);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    width: 0%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.4s ease-out, background-color 0.3s ease;
  }
  .progress-fill.done {
    background: var(--ok);
  }
  .progress-desc {
    font-size: 11px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Agent Card Container (Phân biệt rõ ràng từng Agent) */
  .agent-card {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--line-subtle);
    padding-bottom: 10px;
    gap: 8px;
  }
  .agent-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .agent-badge {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: var(--surface);
    border: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .agent-titles { display: flex; flex-direction: column; gap: 2px; }
  .agent-role { font-size: 13px; font-weight: 600; color: var(--text); }
  .agent-goal { font-size: 11px; color: var(--text-muted); }
  .agent-status {
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text-muted);
  }
  .agent-status.done {
    color: var(--ok);
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.08);
  }
  .agent-status.waiting {
    color: var(--warn);
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.08);
  }
  .agent-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Reasoning Accordion (Chỉ xuất hiện khi THẬT SỰ có text) */
  details.reasoning {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }
  summary.reasoning-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 500;
    user-select: none;
    font-family: var(--font-mono);
  }
  summary.reasoning-summary:hover { color: var(--text); }
  .chevron { transition: transform 0.15s ease; flex-shrink: 0; }
  details[open] > summary .chevron { transform: rotate(90deg); }
  .reasoning-content {
    padding: 8px 10px 10px;
    border-top: 1px solid var(--line-subtle);
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--text-dim);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Tool execution item */
  details.tool {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
  }
  summary.tool-summary {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text);
    user-select: none;
    gap: 6px;
  }
  summary.tool-summary:hover { background: var(--panel); }
  .tool-title { font-weight: 500; }
  .tool-provider-badge { font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 1px 6px; border-radius: 4px; margin-right: 6px; letter-spacing: 0.5px; }
  .tool-name-tag { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: auto; padding-left: 8px; }
  details.tool.done .tool-title::after { content: " • done"; color: var(--ok); font-family: var(--font-mono); font-size: 11px; font-weight: normal; }
  details.tool.error { border-color: var(--err); }
  details.tool.error .tool-title::after { content: " • error"; color: var(--err); font-family: var(--font-mono); font-size: 11px; font-weight: normal; }
  
  .tool-body {
    padding: 10px 12px;
    border-top: 1px solid var(--line-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  /* Technical details collapsible */
  details.technical-details {
    font-size: 11px;
    font-family: var(--font-mono);
  }
  summary.technical-summary {
    cursor: pointer;
    color: var(--text-muted);
    user-select: none;
  }
  summary.technical-summary:hover { color: var(--text); }
  .code-box {
    margin: 6px 0 0;
    padding: 8px;
    background: var(--bg);
    border: 1px solid var(--line-subtle);
    border-radius: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Approval request box */
  .approval {
    border: 1px solid var(--line);
    background: var(--bg);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .approval-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .approval-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .approval-badge {
    font-size: 10px;
    text-transform: uppercase;
    font-family: var(--font-mono);
    color: var(--text-muted);
    border: 1px solid var(--line);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .approval-preview {
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
  }
  .approval-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .btn-approve {
    background: var(--accent);
    color: var(--accent-text);
    border: 0;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-approve:hover { opacity: 0.9; }
  .btn-reject {
    background: transparent;
    color: var(--text-dim);
    border: 1px solid var(--line);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-reject:hover { background: var(--surface); color: var(--text); }
  .btn-approve:disabled, .btn-reject:disabled { opacity: 0.4; cursor: default; }
  .approval-status { font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); margin-top: 4px; }

  /* Clarification HITL Card */
  .clarification-card {
    background: var(--surface-dim, #1a1e24);
    border: 1px solid var(--accent, #6366f1);
    border-radius: 8px;
    padding: 14px 16px;
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .clarification-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .clarification-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text, #ffffff);
  }
  .clarification-badge {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent, #6366f1);
    border: 1px solid rgba(99, 102, 241, 0.3);
    font-size: 10px;
    font-family: var(--font-mono);
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .clarification-question {
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-dim, #cbd5e1);
  }
  .candidate-btn-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 6px;
  }
  .btn-candidate {
    background: var(--surface, #232832);
    color: var(--text, #ffffff);
    border: 1px solid var(--line, #334155);
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  .btn-candidate:hover:not(:disabled) {
    background: var(--accent, #6366f1);
    color: #ffffff;
    border-color: var(--accent, #6366f1);
    transform: translateY(-1px);
  }
  .btn-candidate:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-candidate-desc {
    font-size: 10px;
    opacity: 0.75;
  }

  /* Final Answer Section (Tôn lên trang trọng, không bị che) */
  .final-wrapper {
    border-top: 1px solid var(--line);
    padding-top: 18px;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .final-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .final-dot { color: var(--accent); font-size: 8px; }
  .final-body {
    color: var(--text);
    font-size: 14px;
    line-height: 1.6;
    word-break: break-word;
  }
  .md-h1 { font-size: 18px; font-weight: 600; margin: 16px 0 8px; color: var(--text); }
  .md-h2 { font-size: 16px; font-weight: 600; margin: 14px 0 6px; color: var(--text); }
  .md-h3 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; color: var(--text); }
  .md-p { margin: 6px 0; }
  .table-wrap {
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .md-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
  }
  .md-table th {
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 500;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  .md-table td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-subtle);
    color: var(--text);
  }
  .md-table tr:last-child td { border-bottom: 0; }
  .md-table tr:hover td { background: var(--panel); }
  .code-block {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    overflow-x: auto;
    margin: 10px 0;
  }
  .code-lang { font-size: 10px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; font-family: var(--font-mono); }
  .md-inline-code {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text);
  }
  .md-quote {
    border-left: 2px solid var(--line);
    margin: 8px 0;
    padding-left: 10px;
    color: var(--text-muted);
  }
  .md-ul, .md-ol { margin: 6px 0; padding-left: 20px; font-size: 13px; }
  
  .error-msg { color: var(--err); font-size: 12px; }
  .hint-empty { color: var(--text-muted); font-size: 12px; text-align: center; margin-top: 40px; }

  /* Input Footer Area */
  footer {
    border-top: 1px solid var(--line);
    padding: 14px 16px;
    background: var(--bg);
    flex-shrink: 0;
  }
  #form {
    max-width: 800px;
    width: 100%;
    margin: 0 auto;
    display: flex;
    align-items: flex-end;
    position: relative;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 4px 6px;
    transition: border-color 0.15s;
  }
  #form:focus-within { border-color: var(--text-muted); }
  textarea {
    flex: 1;
    border: 0;
    background: transparent;
    padding: 9px 10px 7px;
    font: inherit;
    font-size: 14px;
    color: var(--text);
    resize: none;
    outline: none;
    height: 38px;
    min-height: 38px;
    max-height: 160px;
    overflow-y: hidden;
    line-height: 20px;
    box-sizing: border-box;
  }
  textarea::placeholder { color: var(--text-muted); }
  #send {
    background: var(--accent);
    color: var(--accent-text);
    border: 0;
    border-radius: 8px;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-bottom: 4px;
    margin-right: 2px;
  }
  #send:disabled { opacity: 0.3; cursor: default; }
  .form-hint {
    max-width: 800px;
    width: 100%;
    margin: 6px auto 0;
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    padding: 0 4px;
  }

  /* Layout: App Body & Sidebar */
  .app-body {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }
  .sidebar {
    width: 260px;
    background: var(--panel);
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    transition: width 0.2s ease, transform 0.2s ease;
    overflow: hidden;
  }
  .sidebar.collapsed {
    width: 0;
    border-right: none;
  }
  .sidebar-header {
    padding: 12px;
    border-bottom: 1px solid var(--line-subtle);
  }
  .new-chat-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .new-chat-btn:hover {
    background: var(--accent);
    color: var(--accent-text);
  }
  .sidebar-section-title {
    padding: 12px 14px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .conversations-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .conv-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    border: 1px solid transparent;
  }
  .conv-item:hover {
    background: var(--surface);
    color: var(--text);
  }
  .conv-item.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 500;
    border-color: var(--line);
  }
  .conv-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .conv-item.active .conv-icon {
    color: var(--accent);
  }
  .conv-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-empty {
    font-size: 12px;
    color: var(--text-muted);
    padding: 24px 12px;
    text-align: center;
    font-family: var(--font-mono);
  }
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    width: 100%;
  }
  .badge-db {
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--ok);
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.2);
    padding: 2px 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .db-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }
  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--surface);
    border-color: var(--line);
  }
  @media (max-width: 768px) {
    .sidebar {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 50;
      box-shadow: 4px 0 24px rgba(0,0,0,0.5);
    }
    .sidebar.collapsed {
      transform: translateX(-100%);
      width: 260px;
    }
  }
  /* Integrations Drawer & Modal Styling */
  .header-action-btn {
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  .header-action-btn:hover {
    background: var(--panel);
    border-color: var(--text-muted);
  }
  .badge-count {
    background: var(--ok);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 10px;
    min-width: 16px;
    text-align: center;
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .modal-backdrop.open {
    opacity: 1;
    pointer-events: auto;
  }
  .modal-card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    width: 90%;
    max-width: 820px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }
  .modal-header {
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--bg);
  }
  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }
  .integrations-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 16px;
  }
  .subtle-btn {
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text-dim);
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .subtle-btn:hover {
    color: var(--text);
    border-color: var(--text-muted);
  }
  .primary-btn {
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }
  .primary-btn:hover {
    opacity: 0.9;
  }
  .danger-btn {
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.4);
    color: var(--err);
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .danger-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--err);
  }
  .integrations-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 16px;
  }
  .integration-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 14px;
    transition: border-color 0.15s ease;
  }
  .integration-card:hover {
    border-color: var(--line-subtle);
  }
  .integration-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .integration-badge {
    font-size: 11px;
    font-family: var(--font-mono);
    padding: 2px 8px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .badge-connected {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: var(--ok);
  }
  .badge-disconnected {
    background: var(--panel);
    border: 1px solid var(--line);
    color: var(--text-muted);
  }
  .badge-type {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--line-subtle);
    color: var(--text-dim);
  }
  .form-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
    margin-bottom: 4px;
    display: block;
  }
  .form-input {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--line);
    color: var(--text);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }
  .form-input:focus {
    border-color: var(--text-muted);
  }
</style>
</head>
<body>
<header>
  <div style="display:flex;align-items:center;gap:10px;">
    <button id="toggle-sidebar" class="icon-btn" title="Đóng/Mở lịch sử" type="button">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
      </svg>
    </button>
    <div class="brand">
      <span>Agent Playground</span>
      <span class="brand-tag">/ multi-agent</span>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:12px;">
    <button id="open-integrations-btn" class="header-action-btn" title="Quản lý kết nối công cụ và cơ sở dữ liệu" type="button">
      <span>🔌 Integrations</span>
      <span id="integrations-connected-count" class="badge-count" style="display:none;">0</span>
    </button>
    <div class="badge-db" title="Dữ liệu phiên và tin nhắn được lưu vĩnh viễn trong PostgreSQL">
      <span class="db-dot"></span> PostgreSQL Synced
    </div>
    <select id="workflow-select" style="background:#1e1e24;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;outline:none;">
      <option value="">Chế độ: Auto (Dynamic Supervisor)</option>
    </select>
    <div class="header-status" id="status">phiên mới</div>
  </div>
</header>

<div class="app-body">
  <aside id="sidebar" class="sidebar">
    <div class="sidebar-header">
      <button id="new-chat-btn" class="new-chat-btn" type="button">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Cuộc trò chuyện mới</span>
      </button>
    </div>
    <div class="sidebar-section-title">Lịch sử trò chuyện</div>
    <div id="conversations-list" class="conversations-list">
      <div class="conv-empty">Đang tải lịch sử...</div>
    </div>
  </aside>

  <main class="chat-main">
    <div id="log">
      <div class="hint-empty">Gõ câu hỏi bên dưới để bắt đầu hội thoại với Agent.</div>
    </div>

    <footer>
      <div id="workflow-progress" class="workflow-progress" style="display: none;">
        <div class="progress-header">
          <div class="progress-title">
            <span class="status-dot"></span> Tiến độ: <span class="progress-percent" id="global-progress-percent">0%</span>
          </div>
          <span class="progress-count" id="global-progress-count">Sẵn sàng</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" id="global-progress-fill"></div>
        </div>
        <div class="progress-desc" id="global-progress-desc">Đang chuẩn bị...</div>
      </div>
      <form id="form">
        <textarea id="prompt" rows="1" placeholder="Nhập câu hỏi... (Enter để gửi, Shift+Enter xuống dòng)"></textarea>
        <button id="send" type="button" aria-label="Gửi">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        </button>
      </form>
      <div class="form-hint">
        <span>Enter to send, Shift+Enter for new line</span>
        <span>Multi-Agent Engine</span>
      </div>
    </footer>
  </main>
</div>

<!-- Integrations Backdrop & Modal -->
<div id="integrations-modal-backdrop" class="modal-backdrop">
  <div class="modal-card">
    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">🔌</span>
        <div>
          <div style="font-weight:600;font-size:15px;color:var(--text);">Tool Integrations & Credentials</div>
          <div style="font-size:12px;color:var(--text-muted);">Kết nối SaaS (OAuth2) và Cơ sở dữ liệu doanh nghiệp (Form Credentials)</div>
        </div>
      </div>
      <button id="close-integrations-btn" class="icon-btn" title="Đóng" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="modal-body">
      <div id="integrations-summary-bar" class="integrations-summary">
        <div style="display:flex;gap:16px;">
          <span id="integrations-stat-total">Tổng: 0 công cụ</span>
          <span id="integrations-stat-connected" style="color:var(--ok);font-weight:600;">Đã kết nối: 0</span>
        </div>
        <button id="refresh-integrations-btn" class="subtle-btn" type="button">🔄 Làm mới</button>
      </div>
      <div id="integrations-grid" class="integrations-grid">
        <div style="color:var(--text-muted);font-size:13px;padding:24px;text-align:center;grid-column:1/-1;">Đang tải danh sách kết nối...</div>
      </div>
    </div>
  </div>
</div>

<!-- Database Credential Configure Form Modal -->
<div id="credential-form-backdrop" class="modal-backdrop" style="z-index:110;">
  <div class="modal-card" style="max-width:480px;">
    <div class="modal-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">🔑</span>
        <div id="credential-form-title" style="font-weight:600;font-size:14px;color:var(--text);">Cấu hình kết nối</div>
      </div>
      <button id="close-credential-form-btn" class="icon-btn" title="Đóng" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <form id="credential-form" class="modal-body" style="display:flex;flex-direction:column;gap:14px;">
      <input type="hidden" id="credential-provider-input" value="">
      <div id="credential-fields-container" style="display:flex;flex-direction:column;gap:12px;"></div>
      <div id="credential-form-msg" style="font-size:12px;display:none;"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px;">
        <button id="cancel-credential-btn" type="button" class="subtle-btn">Hủy</button>
        <button id="save-credential-btn" type="submit" class="primary-btn">Lưu & Kết Nối</button>
      </div>
    </form>
  </div>
</div>

<script>
(function () {
  var CHUNK_TYPES = {
    DATA_STATUS: 'data-status',
    DATA_PERSONA: 'data-persona',
    DATA_RESYNC: 'data-resync',
    DATA_APPROVAL: 'data-approval',
    DATA_CLARIFICATION: 'data-clarification',
    DATA_REPLY: 'data-reply',
    START_STEP: 'start-step',
    FINISH_STEP: 'finish-step',
    TEXT_START: 'text-start',
    TEXT_DELTA: 'text-delta',
    TOOL_INPUT: 'tool-input-available',
    TOOL_OUTPUT: 'tool-output-available',
    TOOL_ERROR: 'tool-output-error',
    ERROR: 'error',
    FINISH: 'finish',
  };
  var STEP_KINDS = {
    PLANNING: 'planning',
    SYNTHESIZE: 'synthesize',
  };
  // Khớp EExecutionEngineMode / ETurnLogStatus ở backend (routing.mode, metadata.status).
  var ROUTING_MODES = {
    SINGLE_AGENT: 'single_agent',
    WORKFLOW: 'workflow',
  };
  var TURN_STATUS = {
    ACTIVE: 'active',
  };

  var log = document.getElementById('log');
  var promptBox = document.getElementById('prompt');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  var workflowSelect = document.getElementById('workflow-select');
  if (workflowSelect) {
    fetch('/api/workflows')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var list = Array.isArray(res) ? res : (res && res.data) ? res.data : [];
        list.forEach(function (wf) {
          var opt = document.createElement('option');
          opt.value = wf.id;
          opt.textContent = 'Workflow: ' + wf.name;
          opt.title = wf.description || '';
          workflowSelect.appendChild(opt);
        });
      })
      .catch(function () {});
  }
  var progressWrap = document.getElementById('workflow-progress');
  var progressPercent = document.getElementById('global-progress-percent');
  var progressFill = document.getElementById('global-progress-fill');
  var progressDesc = document.getElementById('global-progress-desc');
  var progressCount = document.getElementById('global-progress-count');
  var progressTimer = null;
  var sessionId = null;
  try {
    sessionId = localStorage.getItem('agent_playground_session_id') || null;
  } catch (e) {}
  var busy = false;
  var LF = String.fromCharCode(10);
  var CRLF = String.fromCharCode(13, 10);
  var BT = String.fromCharCode(96);
  var BT3 = String.fromCharCode(96, 96, 96);

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function scroll() { log.scrollTop = log.scrollHeight; }
  function pretty(value) {
    if (typeof value !== 'string') return JSON.stringify(value, null, 2);
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch (e) { return value; }
  }
  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    promptBox.disabled = value;
    if (!value) promptBox.focus();
  }

  function autoResize() {
    promptBox.style.height = 'auto';
    var nextH = Math.min(Math.max(promptBox.scrollHeight, 38), 160);
    promptBox.style.height = nextH + 'px';
    promptBox.style.overflowY = promptBox.scrollHeight > 160 ? 'auto' : 'hidden';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(str) {
    var s = escapeHtml(str);
    s = s.replace(new RegExp(BT + '([^' + BT + ']+)' + BT, 'g'), '<code class="md-inline-code">$1</code>');
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    s = s.replace(/(?:^|[^*])\\*([^*]+)\\*/g, ' <em>$1</em>');
    return s;
  }

  function renderMarkdown(raw) {
    if (!raw) return '';
    var text = String(raw).split(CRLF).join(LF);

    var codeBlocks = [];
    var codeRegex = new RegExp(BT3 + '([a-zA-Z0-9_-]*)' + LF + '([\\\\s\\\\S]*?)' + BT3, 'g');
    text = text.replace(codeRegex, function (match, lang, code) {
      var placeholder = '@@CODEBLOCK_' + codeBlocks.length + '@@';
      codeBlocks.push(
        '<pre class="code-block"><div class="code-lang">' + escapeHtml(lang || 'code') + '</div><code>' +
        escapeHtml(code.trim()) +
        '</code></pre>'
      );
      return placeholder;
    });

    var lines = text.split(LF);
    var out = [];
    var inList = false;
    var listType = null;
    var inTable = false;
    var tableRows = [];

    function flushList() {
      if (inList) {
        out.push('</' + listType + '>');
        inList = false;
        listType = null;
      }
    }

    function flushTable() {
      if (inTable && tableRows.length > 0) {
        var html = '<div class="table-wrap"><table class="md-table">';
        var hasSep = tableRows.length > 1 && /^\\|(?:\s*:?-+:?\s*\\|)+$/.test(tableRows[1]);
        if (hasSep) {
          html += '<thead><tr>' + tableRows[0].split('|').slice(1, -1).map(function (c) {
            return '<th>' + renderInline(c.trim()) + '</th>';
          }).join('') + '</tr></thead><tbody>';
          for (var r = 2; r < tableRows.length; r++) {
            html += '<tr>' + tableRows[r].split('|').slice(1, -1).map(function (c) {
              return '<td>' + renderInline(c.trim()) + '</td>';
            }).join('') + '</tr>';
          }
          html += '</tbody>';
        } else {
          html += '<tbody>';
          for (var r = 0; r < tableRows.length; r++) {
            html += '<tr>' + tableRows[r].split('|').slice(1, -1).map(function (c) {
              return '<td>' + renderInline(c.trim()) + '</td>';
            }).join('') + '</tr>';
          }
          html += '</tbody>';
        }
        html += '</table></div>';
        out.push(html);
        inTable = false;
        tableRows = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      if (/^\\|.+\\|$/.test(line.trim())) {
        flushList();
        inTable = true;
        tableRows.push(line.trim());
        continue;
      } else {
        flushTable();
      }

      if (/^@@CODEBLOCK_\\d+@@$/.test(line.trim())) {
        flushList();
        out.push(line);
        continue;
      }

      if (/^###\\s+(.*)/.test(line)) {
        flushList();
        out.push('<h3 class="md-h3">' + renderInline(line.replace(/^###\\s+/, '')) + '</h3>');
        continue;
      }
      if (/^##\\s+(.*)/.test(line)) {
        flushList();
        out.push('<h2 class="md-h2">' + renderInline(line.replace(/^##\\s+/, '')) + '</h2>');
        continue;
      }
      if (/^#\\s+(.*)/.test(line)) {
        flushList();
        out.push('<h1 class="md-h1">' + renderInline(line.replace(/^#\\s+/, '')) + '</h1>');
        continue;
      }

      if (/^>\\s?(.*)/.test(line)) {
        flushList();
        out.push('<blockquote class="md-quote">' + renderInline(line.replace(/^>\\s?/, '')) + '</blockquote>');
        continue;
      }

      if (/^[\\*\\-]\\s+(.*)/.test(line)) {
        if (!inList || listType !== 'ul') {
          flushList();
          out.push('<ul class="md-ul">');
          inList = true;
          listType = 'ul';
        }
        out.push('<li>' + renderInline(line.replace(/^[\\*\\-]\\s+/, '')) + '</li>');
        continue;
      }

      if (/^\\d+\\.\\s+(.*)/.test(line)) {
        if (!inList || listType !== 'ol') {
          flushList();
          out.push('<ol class="md-ol">');
          inList = true;
          listType = 'ol';
        }
        out.push('<li>' + renderInline(line.replace(/^\\d+\\.\\s+/, '')) + '</li>');
        continue;
      }

      if (!line.trim()) {
        flushList();
        continue;
      }

      flushList();
      out.push('<p class="md-p">' + renderInline(line) + '</p>');
    }
    flushList();
    flushTable();

    var result = out.join('');
    result = result.replace(/@@CODEBLOCK_(\\d+)@@/g, function (m, idx) {
      return codeBlocks[Number(idx)] || '';
    });
    return result;
  }

  function clearStatus(bubble) {
    if (bubble.statusEl) {
      bubble.statusEl.remove();
      bubble.statusEl = null;
    }
  }

  function showGlobalProgress(percent, desc, countText) {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    if (!progressWrap) return;
    progressWrap.style.display = 'flex';
    var p = Math.min(100, Math.max(0, percent));
    if (progressPercent) progressPercent.textContent = p + '%';
    if (progressFill) {
      progressFill.style.width = p + '%';
      if (p >= 100) {
        progressFill.classList.add('done');
      } else {
        progressFill.classList.remove('done');
      }
    }
    if (desc && progressDesc) progressDesc.textContent = desc;
    if (countText && progressCount) progressCount.textContent = countText;

    if (p >= 100) {
      progressTimer = setTimeout(function () {
        if (progressWrap) progressWrap.style.display = 'none';
      }, 3000);
    }
  }

  function setProgress(bubble, percent, desc, countText) {
    showGlobalProgress(percent, desc, countText);
  }

  function recalcProgress(bubble, stageHint) {
    var agentKeys = Object.keys(bubble.agents);
    var total = agentKeys.length;
    if (total === 0) return;
    var completed = 0;
    agentKeys.forEach(function (k) {
      var a = bubble.agents[k];
      if (a && a.statusTag && a.statusTag.classList.contains('done')) {
        completed++;
      }
    });
    if (completed === total) {
      setProgress(bubble, 90, stageHint || 'Tất cả Agent đã xong, đang tổng hợp câu trả lời cuối...', total + '/' + total + ' hoàn tất');
    } else {
      var pct = 20 + Math.round((completed / total) * 65);
      setProgress(bubble, pct, 'Đang thực thi các Agent song song...', completed + '/' + total + ' hoàn tất');
    }
  }

  var SUPERVISOR_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"/></svg>';

  // Card Supervisor của turn ĐÃ KẾT THÚC (reload / mở lại cuộc trò chuyện), dựng lại từ
  // metadata.routing. Lúc đang stream thì card do createBubble() + các chunk live dựng.
  function createSupervisorHistoryCard(routing) {
    var mode = routing && routing.mode;
    var skipped = mode === ROUTING_MODES.SINGLE_AGENT;
    var isWorkflow = mode === ROUTING_MODES.WORKFLOW;
    var roleText = isWorkflow && routing.label ? routing.label : 'Bộ điều phối (Supervisor)';
    var goalText = skipped
      ? 'Đã định tuyến trực tiếp vào Multi-Provider Single Agent (bỏ qua 4 bước Supervisor)'
      : (isWorkflow ? 'Hoàn tất thực thi workflow' : 'Đã phân chia nhiệm vụ cho các Agent');

    var card = el('div', 'agent-card supervisor-card');
    var header = el('div', 'agent-header');
    var left = el('div', 'agent-info');
    var badge = el('span', 'agent-badge supervisor-badge');
    badge.innerHTML = SUPERVISOR_ICON_SVG;
    left.appendChild(badge);
    var titles = el('div', 'agent-titles');
    titles.appendChild(el('div', 'agent-role', roleText));
    titles.appendChild(el('div', 'agent-goal', goalText));
    left.appendChild(titles);
    header.appendChild(left);
    header.appendChild(el('span', 'agent-status done', skipped ? 'Bỏ qua' : 'Hoàn thành'));
    card.appendChild(header);
    return card;
  }

  function createBubble() {
    var box = el('div', 'msg bot');

    // Thẻ Supervisor (Bộ điều phối) - Cách B
    var supCard = el('div', 'agent-card supervisor-card');
    var supHeader = el('div', 'agent-header');
    var supLeft = el('div', 'agent-info');

    var supBadge = el('span', 'agent-badge supervisor-badge');
    supBadge.innerHTML = SUPERVISOR_ICON_SVG;
    supLeft.appendChild(supBadge);

    var supTitles = el('div', 'agent-titles');
    var isWorkflow = Boolean(workflowSelect && workflowSelect.value);
    var workflowLabel = isWorkflow && workflowSelect.selectedIndex >= 0
      ? workflowSelect.options[workflowSelect.selectedIndex].text
      : 'Bộ điều phối (Supervisor)';
    supTitles.appendChild(el('div', 'agent-role', workflowLabel));
    var supGoal = el('div', 'agent-goal', isWorkflow ? 'Đang thực thi kịch bản định sẵn...' : 'Đang phân tích yêu cầu và lập kế hoạch...');
    supTitles.appendChild(supGoal);
    supLeft.appendChild(supTitles);
    supHeader.appendChild(supLeft);

    var supStatus = el('span', 'agent-status', 'Đang chạy');
    supHeader.appendChild(supStatus);
    supCard.appendChild(supHeader);
    box.appendChild(supCard);

    log.appendChild(box);
    var b = {
      box: box,
      isWorkflow: isWorkflow,
      texts: {},
      tools: {},
      reply: null,
      replyEl: null,
      step: null,
      stepBody: null,
      currentAgentHeader: null,
      stepText: null,
      statusEl: null,
      agents: {},
      gridEl: null,
      lastAgent: null,
      supervisor: {
        card: supCard,
        goal: supGoal,
        status: supStatus,
        done: false
      },
      hasApproval: false
    };

    setProgress(b, 15, 'Supervisor đang phân tích yêu cầu và lập kế hoạch...', 'Lập kế hoạch');
    return b;
  }

  function getOrCreateAgent(bubble, streamKey, persona) {
    var key = streamKey || 'default';
    if (!bubble.agents[key]) {
      if (!bubble.gridEl) {
        bubble.gridEl = el('div', 'agents-grid');
        bubble.box.appendChild(bubble.gridEl);
      }
      var p = persona || {};
      var card = el('div', 'agent-card');
      var header = el('div', 'agent-header');
      var left = el('div', 'agent-info');

      var badge = el('span', 'agent-badge');
      badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M9 13v2M15 13v2"/></svg>';
      left.appendChild(badge);

      var titles = el('div', 'agent-titles');
      var roleEl = el('div', 'agent-role', p.role || 'Agent');
      var goalEl = el('div', 'agent-goal', p.goal || '');
      titles.appendChild(roleEl);
      if (p.goal) titles.appendChild(goalEl);
      left.appendChild(titles);
      header.appendChild(left);

      var statusTag = el('span', 'agent-status', 'Đang chạy');
      header.appendChild(statusTag);
      card.appendChild(header);

      var body = el('div', 'agent-body');
      card.appendChild(body);
      bubble.gridEl.appendChild(card);

      var agentObj = {
        streamKey: key,
        card: card,
        body: body,
        role: roleEl,
        goal: goalEl,
        statusTag: statusTag,
        stepText: null
      };
      bubble.agents[key] = agentObj;
      bubble.lastAgent = agentObj;

      bubble.step = card;
      bubble.stepBody = body;
      bubble.currentAgentHeader = { header: header, statusTag: statusTag };
      bubble.stepText = null;
    } else if (persona) {
      if (persona.role) bubble.agents[key].role.textContent = persona.role;
      if (persona.goal) {
        bubble.agents[key].goal.textContent = persona.goal;
        if (!bubble.agents[key].goal.parentNode) {
          bubble.agents[key].role.parentNode.appendChild(bubble.agents[key].goal);
        }
      }
    }
    return bubble.agents[key];
  }

  function agentTextHost(agent) {
    if (!agent.stepText) {
      agent.stepText = el('details', 'reasoning');
      var sum = el('summary', 'reasoning-summary');
      sum.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg><span>Reasoning</span>';
      agent.stepText.appendChild(sum);
      var content = el('div', 'reasoning-content');
      agent.stepText.appendChild(content);
      agent.body.appendChild(agent.stepText);
    }
    return agent.stepText.querySelector('.reasoning-content') || agent.stepText;
  }

  function stepHost(bubble, streamKey) {
    if (streamKey && bubble.agents[streamKey]) {
      return bubble.agents[streamKey].body;
    }
    if (bubble.lastAgent) {
      return bubble.lastAgent.body;
    }
    if (!bubble.step) {
      bubble.step = el('div', 'agent-card single-agent-card');
      var header = el('div', 'agent-header');
      var left = el('div', 'agent-info');
      var badge = el('span', 'agent-badge');
      badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M9 13v2M15 13v2"/></svg>';
      left.appendChild(badge);

      var titles = el('div', 'agent-titles');
      titles.appendChild(el('div', 'agent-role', 'Multi-Provider Single Agent'));
      titles.appendChild(el('div', 'agent-goal', 'Thực thi trực tiếp trong 1 phiên hội thoại đa công cụ'));
      left.appendChild(titles);
      header.appendChild(left);

      var statusTag = el('span', 'agent-status', 'Đang thực thi');
      header.appendChild(statusTag);
      bubble.step.appendChild(header);

      bubble.stepBody = el('div', 'agent-body');
      bubble.step.appendChild(bubble.stepBody);
      bubble.box.appendChild(bubble.step);
      bubble.singleAgentStatusTag = statusTag;

      if (bubble.supervisor && !bubble.supervisor.done) {
        bubble.supervisor.done = true;
        bubble.supervisor.status.textContent = 'Bỏ qua';
        bubble.supervisor.status.classList.add('done');
        bubble.supervisor.goal.textContent = 'Đã định tuyến trực tiếp vào Multi-Provider Single Agent (bỏ qua 4 bước Supervisor)';
      }
    }
    return bubble.stepBody || bubble.box;
  }

  // Khối Reasoning chỉ sinh ra khi CÓ nội dung thực sự
  function textHost(bubble, streamKey) {
    var agent = (streamKey && bubble.agents[streamKey]) || bubble.lastAgent;
    if (agent) {
      return agentTextHost(agent);
    }
    var host = stepHost(bubble);
    if (!bubble.stepText) {
      bubble.stepText = el('details', 'reasoning');
      var sum = el('summary', 'reasoning-summary');
      sum.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg><span>Reasoning</span>';
      bubble.stepText.appendChild(sum);
      var content = el('div', 'reasoning-content');
      bubble.stepText.appendChild(content);
      host.appendChild(bubble.stepText);
    }
    return bubble.stepText.querySelector('.reasoning-content') || bubble.stepText;
  }

  function ensureReplyEl(bubble) {
    if (!bubble.replyEl) {
      var wrap = el('div', 'final-wrapper');
      var head = el('div', 'final-header');
      head.innerHTML = '<span class="final-dot">●</span><span>CÂU TRẢ LỜI</span>';
      wrap.appendChild(head);

      bubble.replyEl = el('div', 'final-body');
      wrap.appendChild(bubble.replyEl);
      bubble.box.appendChild(wrap);
    }
    return bubble.replyEl;
  }

  // Câu trả lời cuối cùng (Final Answer) được hiển thị trang trọng ở cuối
  function showReply(bubble) {
    clearStatus(bubble);
    if (bubble.supervisor && !bubble.supervisor.done) {
      bubble.supervisor.done = true;
      bubble.supervisor.status.textContent = 'Hoàn thành';
      bubble.supervisor.status.classList.add('done');
      bubble.supervisor.goal.textContent = bubble.isWorkflow ? 'Hoàn tất thực thi workflow' : 'Đã phân chia nhiệm vụ cho các Agent';
    }
    Object.keys(bubble.agents).forEach(function (k) {
      var a = bubble.agents[k];
      if (a && a.statusTag) {
        a.statusTag.textContent = 'Hoàn thành';
        a.statusTag.classList.add('done');
      }
    });
    if (bubble.hasApproval) {
      if (progressWrap) progressWrap.style.display = 'none';
      if (bubble.replyEl && bubble.replyEl.parentNode) {
        bubble.replyEl.parentNode.remove();
        bubble.replyEl = null;
      }
      return;
    }
    setProgress(bubble, 100, 'Hoàn tất câu trả lời', 'Hoàn thành 100%');
    if (bubble.reply === null) {
      Array.prototype.forEach.call(bubble.box.querySelectorAll('details.reasoning'), function (d) { d.open = true; });
      return;
    }
    ensureReplyEl(bubble);
    bubble.replyEl.innerHTML = renderMarkdown(bubble.reply);
    scroll();
  }

  function render(bubble, chunk) {
    switch (chunk.type) {
      case 'resync':
      case CHUNK_TYPES.DATA_RESYNC: {
        clearStatus(bubble);
        var resyncSteps = chunk.steps || (chunk.data && chunk.data.steps) || [];
        var resyncToolCalls = chunk.toolCalls || (chunk.data && chunk.data.toolCalls) || [];
        var resyncText = chunk.partialText || (chunk.data && (chunk.data.partialText || chunk.data.text)) || '';
        if (Array.isArray(resyncToolCalls) && resyncToolCalls.length > 0) {
          var defaultAgent = getOrCreateAgent(bubble, 'agent', { role: 'Agent' });
          resyncToolCalls.forEach(function (tc, idx) {
            var toolId = tc.toolCallId || tc.id || ('tool-' + (tc.tool || 'call') + '-' + idx);
            if (toolId && !bubble.tools[toolId]) {
              var d = createHistoryToolElement(tc);
              defaultAgent.body.appendChild(d);
              bubble.tools[toolId] = { details: d, pre: d.querySelector('.tool-output pre') || d.querySelector('pre') };
            }
          });
        }
        if (Array.isArray(resyncSteps)) {
          resyncSteps.forEach(function (step) {
            var agentKey = (step.persona && step.persona.role) || step.agent || 'default';
            var agent = getOrCreateAgent(bubble, agentKey, step.persona);
            if (Array.isArray(step.toolCalls)) {
              step.toolCalls.forEach(function (tc, idx) {
                var toolId = tc.toolCallId || tc.id || (agentKey + '-' + (tc.tool || 'tool') + '-' + idx);
                if (toolId && !bubble.tools[toolId]) {
                  var d = createHistoryToolElement(tc);
                  agent.body.appendChild(d);
                  bubble.tools[toolId] = { details: d, pre: d.querySelector('.tool-output pre') || d.querySelector('pre') };
                }
              });
            }
          });
        }
        if (resyncText) {
          bubble.reply = resyncText;
          ensureReplyEl(bubble);
          bubble.replyEl.innerHTML = renderMarkdown(bubble.reply);
        }
        break;
      }
      case CHUNK_TYPES.DATA_STATUS:
        if (chunk.data && chunk.data.label) {
          if (chunk.data.kind === STEP_KINDS.PLANNING || chunk.id === STEP_KINDS.PLANNING) {
            if (bubble.supervisor && !bubble.supervisor.done) {
              bubble.supervisor.goal.textContent = chunk.data.label;
            }
            setProgress(bubble, 15, chunk.data.label, 'Lập kế hoạch');
          } else if (chunk.data.kind === STEP_KINDS.SYNTHESIZE || chunk.id === STEP_KINDS.SYNTHESIZE) {
            if (bubble.supervisor) {
              bubble.supervisor.status.textContent = 'Đang tổng hợp';
              bubble.supervisor.status.classList.remove('done');
              bubble.supervisor.goal.textContent = 'Đang tổng hợp dữ liệu thành câu trả lời cuối...';
            }
            setProgress(bubble, 90, 'Tất cả Agent đã xong, đang tổng hợp câu trả lời cuối...', Object.keys(bubble.agents).length + '/' + Object.keys(bubble.agents).length + ' hoàn tất');
          } else if (bubble.agents[chunk.id]) {
            bubble.agents[chunk.id].goal.textContent = chunk.data.label;
            if (!bubble.agents[chunk.id].goal.parentNode) {
              bubble.agents[chunk.id].role.parentNode.appendChild(bubble.agents[chunk.id].goal);
            }
          }
        }
        break;

      case CHUNK_TYPES.START_STEP:
        clearStatus(bubble);
        bubble.gridEl = null;
        bubble.step = null;
        bubble.stepBody = null;
        bubble.currentAgentHeader = null;
        bubble.stepText = null;
        break;

      case CHUNK_TYPES.FINISH_STEP:
        Object.keys(bubble.agents).forEach(function (k) {
          var a = bubble.agents[k];
          if (a && a.statusTag) {
            a.statusTag.textContent = 'Hoàn thành';
            a.statusTag.classList.add('done');
          }
          if (a && a.stepText) a.stepText.open = false;
        });
        if (bubble.currentAgentHeader && bubble.currentAgentHeader.statusTag) {
          bubble.currentAgentHeader.statusTag.textContent = 'Hoàn thành';
          bubble.currentAgentHeader.statusTag.classList.add('done');
        }
        if (bubble.stepText) bubble.stepText.open = false;
        if (bubble.step && bubble.stepBody && bubble.stepBody.children.length === 0 && !bubble.step.querySelector('.agent-header')) {
          bubble.step.remove();
        }
        bubble.gridEl = null;
        bubble.step = null;
        bubble.stepBody = null;
        bubble.currentAgentHeader = null;
        if (bubble.singleAgentStatusTag) {
          bubble.singleAgentStatusTag.textContent = 'Hoàn thành';
          bubble.singleAgentStatusTag.classList.add('done');
        }
        bubble.stepText = null;
        recalcProgress(bubble, 'Tất cả Agent đã xong, đang tổng hợp câu trả lời cuối...');
        break;

      case CHUNK_TYPES.TEXT_START:
        clearStatus(bubble);
        bubble.texts[chunk.id] = '';
        break;

      case CHUNK_TYPES.TEXT_DELTA:
        if (chunk.delta) {
          if (bubble.texts[chunk.id] === undefined) bubble.texts[chunk.id] = '';
          bubble.texts[chunk.id] += chunk.delta;

          var streamKey = null;
          if (chunk.id && chunk.id.indexOf('__') !== -1) {
            streamKey = chunk.id.split('__')[0];
          }

          var targetAgent = (streamKey && bubble.agents[streamKey]) || (Object.keys(bubble.agents).length > 0 && !streamKey ? bubble.lastAgent : null);

          if (targetAgent) {
            var container = agentTextHost(targetAgent);
            var elId = 'text-part-' + chunk.id;
            var partEl = container.querySelector('#' + elId);
            if (!partEl) {
              partEl = el('div', 'reasoning-text');
              partEl.id = elId;
              container.appendChild(partEl);
            }
            partEl.textContent = bubble.texts[chunk.id];
          } else {
            // Nếu không trong Agent nào, đây là text của CÂU TRẢ LỜI cuối cùng đang stream
            if (!bubble.hasApproval) {
              bubble.reply = (bubble.reply || '') + chunk.delta;
              ensureReplyEl(bubble);
              bubble.replyEl.innerHTML = renderMarkdown(bubble.reply);
            }
          }
        }
        break;

      case CHUNK_TYPES.DATA_PERSONA: {
        clearStatus(bubble);
        if (bubble.supervisor && !bubble.supervisor.done) {
          bubble.supervisor.done = true;
          bubble.supervisor.status.textContent = 'Hoàn thành';
          bubble.supervisor.status.classList.add('done');
          bubble.supervisor.goal.textContent = bubble.isWorkflow ? 'Hoàn tất thực thi workflow' : 'Đã phân chia nhiệm vụ cho các Agent';
        }

        getOrCreateAgent(bubble, chunk.id, chunk.data);
        recalcProgress(bubble);
        break;
      }

      case CHUNK_TYPES.TOOL_INPUT: {
        clearStatus(bubble);
        var d = el('details', 'tool');
        var summaryText = chunk.title || (chunk.toolMetadata && chunk.toolMetadata.friendlySummary) || chunk.toolName;
        var sum = el('summary', 'tool-summary');
        var dotIdx = (chunk.toolName || '').indexOf('.');
        var provider = dotIdx !== -1 ? chunk.toolName.slice(0, dotIdx) : '';
        var providerBadge = provider ? '<span class="tool-provider-badge">' + escapeHtml(provider) + '</span>' : '';
        sum.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>' + providerBadge + '<span class="tool-title">' + escapeHtml(summaryText) + '</span><span class="tool-name-tag">' + escapeHtml(chunk.toolName) + '</span>';
        d.appendChild(sum);

        var body = el('div', 'tool-body');
        var tech = el('details', 'technical-details');
        tech.appendChild(el('summary', 'technical-summary', '› View raw statement'));
        tech.appendChild(el('pre', 'code-box', pretty(chunk.input && chunk.input.preview !== undefined ? chunk.input.preview : chunk.input)));
        body.appendChild(tech);

        var out = el('div', 'tool-output');
        var outPre = el('pre', 'code-box', 'running...');
        out.appendChild(outPre);
        body.appendChild(out);

        d.appendChild(body);

        var toolStreamKey = (chunk.toolMetadata && chunk.toolMetadata.streamKey) || null;
        var host = stepHost(bubble, toolStreamKey);
        host.appendChild(d);
        bubble.tools[chunk.toolCallId] = { details: d, pre: outPre };
        break;
      }

      case CHUNK_TYPES.TOOL_OUTPUT: {
        var t = bubble.tools[chunk.toolCallId];
        if (t) {
          t.pre.textContent = pretty(chunk.output && chunk.output.preview !== undefined ? chunk.output.preview : chunk.output);
          t.details.classList.add('done');
        }
        break;
      }

      case CHUNK_TYPES.TOOL_ERROR: {
        var te = bubble.tools[chunk.toolCallId];
        if (te) {
          te.pre.textContent = chunk.errorText;
          te.details.classList.add('error');
          te.details.open = true;
        }
        break;
      }

      case CHUNK_TYPES.DATA_REPLY: {
        clearStatus(bubble);
        var replyText = chunk.data && chunk.data.text;
        if (replyText && (
          replyText.indexOf('⏸️') === 0 ||
          replyText.indexOf('Cần bạn duyệt') !== -1 ||
          replyText.indexOf('Cần bạn làm rõ') !== -1
        )) {
          bubble.hasApproval = true;
          bubble.reply = null;
        } else {
          bubble.reply = replyText;
        }
        break;
      }

      case CHUNK_TYPES.DATA_APPROVAL:
      case CHUNK_TYPES.DATA_CLARIFICATION:
        clearStatus(bubble);
        bubble.hasApproval = true;
        renderApproval(bubble, chunk.data || {});
        break;

      case CHUNK_TYPES.ERROR:
        clearStatus(bubble);
        bubble.box.appendChild(el('div', 'error-msg', 'Error: ' + chunk.errorText));
        break;

      case CHUNK_TYPES.FINISH:
        showReply(bubble);
        break;
    }
    scroll();
  }

  function renderClarification(bubble, data, targetContainer) {
    clearStatus(bubble);
    if (progressWrap) progressWrap.style.display = 'none';
    if (data.messageId && bubble.box.querySelector('.clarification-card[data-msg-id="' + data.messageId + '"]')) {
      return;
    }
    var box = el('div', 'clarification-card');
    if (data.messageId) box.setAttribute('data-msg-id', data.messageId);

    if (bubble.currentAgentHeader && bubble.currentAgentHeader.statusTag) {
      bubble.currentAgentHeader.statusTag.textContent = 'Cần làm rõ';
      bubble.currentAgentHeader.statusTag.classList.add('waiting');
    }

    var header = el('div', 'clarification-header');
    header.appendChild(el('div', 'clarification-title', 'Yêu cầu làm rõ thông tin'));
    header.appendChild(el('span', 'clarification-badge', 'Clarification'));
    box.appendChild(header);

    var questionText = data.friendlySummary || data.preview || 'Vui lòng chọn một trong các phương án bên dưới để tiếp tục:';
    box.appendChild(el('div', 'clarification-question', questionText));

    var candidates = data.candidates || [];
    var btnGroup = el('div', 'candidate-btn-group');

    function selectCandidate(candidate) {
      var allBtns = btnGroup.querySelectorAll('.btn-candidate');
      for (var i = 0; i < allBtns.length; i++) {
        allBtns[i].disabled = true;
      }
      box.appendChild(el('div', 'approval-status', 'Đã chọn: ' + (candidate.label || candidate.provider || candidate.id) + ', đang tiếp tục...'));
      bubble.hasApproval = false;
      var selectedId = candidate.id || candidate.provider;
      run('/api/approve', {
        sessionId: sessionId,
        messageId: data.messageId,
        action: 'clarify',
        selectedProvider: selectedId,
        selectedCandidateId: selectedId
      }, bubble);
    }

    if (candidates.length > 0) {
      candidates.forEach(function (c) {
        var btn = el('button', 'btn-candidate');
        btn.appendChild(el('span', 'btn-candidate-label', c.label || c.provider || c.id));
        if (c.description) {
          btn.appendChild(el('span', 'btn-candidate-desc', c.description));
        }
        btn.onclick = function () { selectCandidate(c); };
        btnGroup.appendChild(btn);
      });
      box.appendChild(btnGroup);
    } else {
      var fallbackBtn = el('button', 'btn-approve', 'Tiếp tục thực thi');
      fallbackBtn.onclick = function () {
        fallbackBtn.disabled = true;
        bubble.hasApproval = false;
        run('/api/approve', { sessionId: sessionId, messageId: data.messageId, action: 'approve' }, bubble);
      };
      box.appendChild(fallbackBtn);
    }

    if (targetContainer) {
      targetContainer.appendChild(box);
    } else {
      bubble.box.appendChild(box);
    }
  }

  function renderApproval(bubble, data, targetContainer) {
    if (data.kind === 'clarification' || (data.candidates && data.candidates.length > 0)) {
      renderClarification(bubble, data, targetContainer);
      return;
    }
    clearStatus(bubble);
    if (progressWrap) progressWrap.style.display = 'none';
    if (data.messageId && bubble.box.querySelector('.approval[data-msg-id="' + data.messageId + '"]')) {
      return;
    }
    var tool = data.tool || {};
    var box = el('div', 'approval');
    if (data.messageId) box.setAttribute('data-msg-id', data.messageId);

    if (bubble.currentAgentHeader && bubble.currentAgentHeader.statusTag) {
      bubble.currentAgentHeader.statusTag.textContent = 'Chờ phê duyệt';
      bubble.currentAgentHeader.statusTag.classList.add('waiting');
    }

    var header = el('div', 'approval-header');
    var title = data.friendlySummary || ('Action requires confirmation: ' + (tool.provider || '') + '.' + (tool.name || ''));
    header.appendChild(el('div', 'approval-title', title));
    header.appendChild(el('span', 'approval-badge', 'Write Guard'));
    box.appendChild(header);

    if (data.preview) {
      box.appendChild(el('div', 'approval-preview', typeof data.preview === 'string' ? data.preview : JSON.stringify(data.preview)));
    }

    var tech = el('details', 'technical-details');
    tech.appendChild(el('summary', 'technical-summary', '› View raw statement'));
    tech.appendChild(el('pre', 'code-box', pretty(tool.args || {})));
    box.appendChild(tech);

    var actions = el('div', 'approval-actions');
    var approve = el('button', 'btn-approve', 'Approve & Continue');
    var reject = el('button', 'btn-reject', 'Reject');

    function decide(action) {
      approve.disabled = true;
      reject.disabled = true;
      box.appendChild(el('div', 'approval-status', action === 'approve' ? 'Approved, continuing execution...' : 'Rejected'));
      bubble.hasApproval = false;
      run('/api/approve', { sessionId: sessionId, messageId: data.messageId, action: action }, bubble);
    }

    approve.onclick = function () { decide('approve'); };
    reject.onclick = function () { decide('reject'); };
    actions.appendChild(approve);
    actions.appendChild(reject);
    box.appendChild(actions);

    if (targetContainer) {
      targetContainer.appendChild(box);
    } else {
      bubble.box.appendChild(box);
    }
  }

  function updateSessionFromHeader(response) {
    var session = response.headers.get('x-playground-session');
    if (!session) return;
    var isNewSession = !sessionId || sessionId !== session;
    sessionId = session;
    try { localStorage.setItem('agent_playground_session_id', session); } catch (e) {}
    statusEl.textContent = 'session: ' + session.slice(0, 8);
    if (isNewSession) loadConversations();
  }

  async function handleStreamResponseError(response, bubble) {
    if (response.ok && response.body) return true;
    if (progressTimer) clearTimeout(progressTimer);
    if (progressWrap) progressWrap.style.display = 'none';
    var info = '';
    try { var j = await response.json(); info = j.error || j.message || JSON.stringify(j); } catch (e) { info = response.statusText; }
    bubble.box.appendChild(el('div', 'error-msg', 'HTTP ' + response.status + ': ' + info));
    return false;
  }

  function handleStreamError(error, bubble) {
    if (progressTimer) clearTimeout(progressTimer);
    if (progressWrap) progressWrap.style.display = 'none';
    bubble.box.appendChild(el('div', 'error-msg', 'Connection error: ' + error.message));
  }

  async function readSseStream(response, bubble) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    for (;;) {
      var step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      var events = buffer.split(LF + LF);
      buffer = events.pop();
      events.forEach(function (raw) {
        var line = raw.split(LF).filter(function (l) { return l.indexOf('data:') === 0; }).map(function (l) { return l.slice(5).trim(); }).join('');
        if (!line || line === '[DONE]') return;
        try { render(bubble, JSON.parse(line)); } catch (e) { /* skip non-json */ }
      });
    }
    showReply(bubble);
  }

  async function run(url, body, targetBubble) {
    setBusy(true);
    var bubble = targetBubble || createBubble();
    try {
      var response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      updateSessionFromHeader(response);
      var isOk = await handleStreamResponseError(response, bubble);
      if (!isOk) return;
      await readSseStream(response, bubble);
    } catch (error) {
      handleStreamError(error, bubble);
    } finally {
      setBusy(false);
      scroll();
      loadConversations();
    }
  }

  var reconnectFallbackMessageId = null;

  async function reconnectActiveStream(sid, messageId, targetBubble) {
    setBusy(true);
    var bubble = targetBubble || createBubble();
    try {
      showGlobalProgress(50, 'Đang khôi phục dòng phản hồi...', 'Kết nối lại');
      var url = '/api/stream?sessionId=' + encodeURIComponent(sid) + '&messageId=' + encodeURIComponent(messageId);
      var response = await fetch(url, { method: 'GET' });
      updateSessionFromHeader(response);
      if (response.status === 400) {
        if (progressTimer) clearTimeout(progressTimer);
        if (progressWrap) progressWrap.style.display = 'none';
        // Turn đã kết thúc giữa lúc lấy history và gọi reconnect: câu trả lời cuối
        // đã nằm trong DB, tải lại history (mỗi messageId chỉ thử 1 lần để không lặp).
        if (reconnectFallbackMessageId !== messageId) {
          reconnectFallbackMessageId = messageId;
          loadHistory(sid);
          return;
        }
        showReply(bubble);
        return;
      }
      var isOk = await handleStreamResponseError(response, bubble);
      if (!isOk) return;
      await readSseStream(response, bubble);
    } catch (error) {
      handleStreamError(error, bubble);
    } finally {
      setBusy(false);
      scroll();
      loadConversations();
    }
  }

  function submit() {
    var text = promptBox.value.trim();
    if (!text || busy) return;
    promptBox.value = '';
    promptBox.style.height = '38px';
    promptBox.style.overflowY = 'hidden';

    var hint = log.querySelector('.hint-empty');
    if (hint) hint.remove();

    log.appendChild(el('div', 'msg user', text));
    showGlobalProgress(10, 'Đang gửi yêu cầu và khởi tạo bộ điều phối...', 'Khởi tạo');
    var selectedWf = (workflowSelect && workflowSelect.value) ? workflowSelect.value : undefined;
    run('/api/chat', { prompt: text, sessionId: sessionId || undefined, workflowId: selectedWf });
  }

  promptBox.addEventListener('input', autoResize);

  promptBox.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if ((e.key === 'Enter' || e.keyCode === 13) && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  var formEl = document.getElementById('form');
  if (formEl) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      submit();
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', function (e) {
      e.preventDefault();
      submit();
    });
  }

  function highlightActiveConversation(id) {
    var items = document.querySelectorAll('.conv-item');
    Array.prototype.forEach.call(items, function (it) {
      if (it.getAttribute('data-id') === id) {
        it.classList.add('active');
      } else {
        it.classList.remove('active');
      }
    });
  }

  function renderConversations(list) {
    var container = document.getElementById('conversations-list');
    if (!container) return;
    container.innerHTML = '';
    if (!list || list.length === 0) {
      container.appendChild(el('div', 'conv-empty', 'Chưa có cuộc trò chuyện nào'));
      return;
    }
    list.forEach(function (conv) {
      var item = el('div', 'conv-item' + (conv.id === sessionId ? ' active' : ''));
      item.setAttribute('data-id', conv.id);
      item.title = conv.title || 'Cuộc trò chuyện mới';

      var titleText = conv.title || 'Cuộc trò chuyện mới';
      item.innerHTML = '<svg class="conv-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><span class="conv-title"></span>';
      var titleSpan = item.querySelector('.conv-title');
      if (titleSpan) titleSpan.textContent = titleText;

      item.onclick = function () {
        switchConversation(conv.id);
      };
      container.appendChild(item);
    });
  }

  function loadConversations() {
    fetch('/api/conversations?limit=30')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var list = (res && res.data) || [];
        renderConversations(list);
      })
      .catch(function (e) {
        console.warn('Lỗi lấy danh sách cuộc trò chuyện:', e);
      });
  }

  function startNewChat() {
    if (busy) return;
    sessionId = null;
    try { localStorage.removeItem('agent_playground_session_id'); } catch (e) {}
    statusEl.textContent = 'phiên mới';
    log.innerHTML = '';
    log.appendChild(el('div', 'hint-empty', 'Gõ câu hỏi bên dưới để bắt đầu hội thoại với Agent.'));
    highlightActiveConversation(null);
    promptBox.value = '';
    promptBox.focus();
  }

  function switchConversation(id) {
    if (busy || id === sessionId) return;
    sessionId = id;
    try { localStorage.setItem('agent_playground_session_id', id); } catch (e) {}
    statusEl.textContent = 'session: ' + id.slice(0, 8);
    highlightActiveConversation(id);
    loadHistory(id);
  }

  function createHistoryToolElement(tc) {
    var isError = tc.status === 'error' || tc.status === 'failed';
    var isRunning = tc.status === 'running';
    var statusClass = isError ? 'error' : (isRunning ? '' : 'done');
    var d = el('details', 'tool ' + statusClass);
    var sum = el('summary', 'tool-summary');
    var dotIdx = (tc.tool || '').indexOf('.');
    var provider = dotIdx !== -1 ? tc.tool.slice(0, dotIdx) : '';
    var providerBadge = provider ? '<span class="tool-provider-badge">' + escapeHtml(provider) + '</span>' : '';
    sum.innerHTML = '<svg class="chevron" viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>' + providerBadge + '<span class="tool-title">' + escapeHtml(tc.tool) + '</span><span class="tool-name-tag">' + escapeHtml(tc.status || 'success') + '</span>';
    d.appendChild(sum);

    var b = el('div', 'tool-body');
    if (tc.argsPreview) {
      var tech = el('details', 'technical-details');
      tech.appendChild(el('summary', 'technical-summary', '› View raw statement'));
      tech.appendChild(el('pre', 'code-box', pretty(tc.argsPreview)));
      b.appendChild(tech);
    }
    var out = el('div', 'tool-output');
    var outPre = el('pre', 'code-box', tc.resultPreview ? pretty(tc.resultPreview) : (isRunning ? 'running...' : ''));
    out.appendChild(outPre);
    b.appendChild(out);
    d.appendChild(b);
    return d;
  }

  function groupToolsByProvider(toolCalls, personas) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
    var providerMap = {};
    var providerOrder = [];
    toolCalls.forEach(function (tc) {
      var dotIdx = tc.tool ? tc.tool.indexOf('.') : -1;
      var provider = dotIdx !== -1 ? tc.tool.slice(0, dotIdx) : 'general';
      if (!providerMap[provider]) {
        providerMap[provider] = [];
        providerOrder.push(provider);
      }
      providerMap[provider].push(tc);
    });

    var personaList = Array.isArray(personas) ? personas.slice() : [];
    if (personaList.length > 1) {
      return providerOrder.map(function (prov, idx) {
        var p = personaList[idx] || null;
        var friendlyRole = p && p.role ? p.role : (prov.charAt(0).toUpperCase() + prov.slice(1).replace(/_/g, ' ') + ' Agent');
        var friendlyGoal = p && p.goal ? p.goal : ('Xử lý các tác vụ liên quan đến ' + prov);
        return {
          agent: prov,
          task: friendlyGoal,
          persona: { role: friendlyRole, goal: friendlyGoal },
          toolCalls: providerMap[prov]
        };
      });
    }

    var p0 = personaList[0];
    var singleRole = p0 && p0.role ? p0.role : 'Multi-Provider Single Agent';
    var singleGoal = p0 && p0.goal ? p0.goal : ('Thực thi trực tiếp đa công cụ (' + providerOrder.join(', ') + ')');
    return [{
      agent: 'single_agent',
      task: singleGoal,
      persona: { role: singleRole, goal: singleGoal },
      toolCalls: toolCalls
    }];
  }

  function loadHistory(sid) {
    if (!sid) return;
    setBusy(true);
    fetch('/api/history?sessionId=' + encodeURIComponent(sid))
      .then(function (r) {
        if (!r.ok) throw new Error('Không thể tải lịch sử phiên');
        return r.json();
      })
      .then(function (res) {
        var turns = [];
        if (res) {
          if (Array.isArray(res)) turns = res;
          else if (Array.isArray(res.turns)) turns = res.turns;
          else if (res.data) {
            if (Array.isArray(res.data.turns)) turns = res.data.turns;
            else if (Array.isArray(res.data)) turns = res.data;
          }
        }
        turns = turns.filter(function (turn) {
          if (turn.role === 'model' && turn.text && (
            turn.text.indexOf('⏸️') === 0 ||
            turn.text.indexOf('Cần bạn duyệt') !== -1 ||
            turn.text.indexOf('Cần bạn làm rõ') !== -1
          )) {
            return false;
          }
          return true;
        });

        log.innerHTML = '';
        if (turns.length === 0) {
          log.appendChild(el('div', 'hint-empty', 'Cuộc trò chuyện chưa có tin nhắn. Gõ câu hỏi bên dưới để bắt đầu.'));
          return;
        }

        var inFlightTurn = null;
        var lastTurn = turns[turns.length - 1];
        if (lastTurn && lastTurn.role === 'model' && lastTurn.metadata && lastTurn.metadata.inFlight && lastTurn.metadata.status === TURN_STATUS.ACTIVE && !lastTurn.metadata.approval) {
          inFlightTurn = lastTurn;
        }

        var historyTurns = inFlightTurn ? turns.slice(0, turns.length - 1) : turns;

        historyTurns.forEach(function (turn, idx) {
          if (turn.role === 'user') {
            log.appendChild(el('div', 'msg user', turn.text));
          } else {
            var msgWrap = el('div', 'msg');
            var botBox = el('div', 'bot');
            var meta = turn.metadata || {};

            // 0. Card Supervisor (quyết định định tuyến đã lưu trong metadata)
            if (meta.routing) {
              botBox.appendChild(createSupervisorHistoryCard(meta.routing));
            }

            // 1. Phục dựng các execution steps (mỗi Persona Card bọc các tool calls của riêng nó)
            var steps = meta.steps;
            if ((!Array.isArray(steps) || steps.length === 0) && Array.isArray(meta.toolCalls) && meta.toolCalls.length > 0) {
              steps = groupToolsByProvider(meta.toolCalls, meta.personas || (meta.persona ? [meta.persona] : []));
            }
            // Message approval/clarification mang bản sao toolCalls của reply ngay trước nó
            // (turn bị pause): reply đã vẽ card rồi, không vẽ lặp.
            var prevTurn = idx > 0 ? historyTurns[idx - 1] : null;
            var prevMeta = prevTurn && prevTurn.role === 'model' ? (prevTurn.metadata || {}) : null;
            var prevHasGrid = !!prevMeta && (
              (Array.isArray(prevMeta.steps) && prevMeta.steps.length > 0) ||
              (Array.isArray(prevMeta.toolCalls) && prevMeta.toolCalls.length > 0)
            );
            if (meta.approval && prevHasGrid) steps = [];

            if (Array.isArray(steps) && steps.length > 0) {
              var gridEl = el('div', 'agents-grid');
              steps.forEach(function (step) {
                var card = el('div', 'agent-card');
                var header = el('div', 'agent-header');
                var left = el('div', 'agent-info');
                var badge = el('span', 'agent-badge');
                badge.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M9 13v2M15 13v2"/></svg>';
                left.appendChild(badge);

                var p = step.persona || {};
                var titles = el('div', 'agent-titles');
                titles.appendChild(el('div', 'agent-role', p.role || step.agent || 'Agent'));
                var goalText = p.goal || step.task || '';
                if (goalText) titles.appendChild(el('div', 'agent-goal', goalText));
                left.appendChild(titles);
                header.appendChild(left);

                var statusTag = el('span', 'agent-status done', 'Hoàn thành');
                header.appendChild(statusTag);
                card.appendChild(header);

                // Body của Card chứa trực tiếp các Tool calls thuộc về Agent/Persona này!
                var cardBody = el('div', 'agent-body');
                if (Array.isArray(step.toolCalls) && step.toolCalls.length > 0) {
                  step.toolCalls.forEach(function (tc, idx) {
                    cardBody.appendChild(createHistoryToolElement(tc));
                  });
                }
                card.appendChild(cardBody);
                gridEl.appendChild(card);
              });
              botBox.appendChild(gridEl);
            }

            var approvalData = meta.approval || (idx === historyTurns.length - 1 ? res.pendingApproval : null);
            if (approvalData) {
              var bubble = {
                box: botBox,
                isWorkflow: false,
                texts: {},
                tools: {},
                reply: null,
                replyEl: null,
                step: null,
                stepBody: null,
                currentAgentHeader: null,
                stepText: null,
                statusEl: null,
                agents: {},
                gridEl: botBox.querySelector('.agents-grid'),
                lastAgent: null,
                supervisor: null,
                hasApproval: true
              };
              renderApproval(bubble, approvalData, botBox);
            } else if (turn.text && turn.text.trim()) {
              var wrap = el('div', 'final-wrapper');
            var head = el('div', 'final-header');
            head.appendChild(el('span', 'final-title', '✨ Câu trả lời'));
            wrap.appendChild(head);
            var body = el('div', 'final-body');
            body.innerHTML = renderMarkdown(turn.text);
            wrap.appendChild(body);
            botBox.appendChild(wrap);
            }
            msgWrap.appendChild(botBox);
            log.appendChild(msgWrap);
          }
        });
        if (inFlightTurn) {
          var targetBubble = createBubble();
          // Nội dung dở dang KHÔNG nằm trong history: phát lại stream của turn từ đầu
          // vào bubble trống (cùng đường vẽ với stream live nên không mất/lặp gì).
          var activeMsgId = (inFlightTurn.metadata && inFlightTurn.metadata.messageId) || inFlightTurn.id;
          reconnectActiveStream(sid, activeMsgId, targetBubble);
        }
        scroll();
      })
      .catch(function (e) {
        console.warn('Lỗi khôi phục lịch sử:', e);
        startNewChat();
      })
      .finally(function () {
        setBusy(false);
      });
  }

  var toggleSidebarBtn = document.getElementById('toggle-sidebar');
  var sidebarEl = document.getElementById('sidebar');
  if (toggleSidebarBtn && sidebarEl) {
    toggleSidebarBtn.onclick = function () {
      sidebarEl.classList.toggle('collapsed');
    };
  }

  var newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) {
    newChatBtn.onclick = startNewChat;
  }

  // ==================== Integrations UI Management ====================
  var openIntegrationsBtn = document.getElementById('open-integrations-btn');
  var closeIntegrationsBtn = document.getElementById('close-integrations-btn');
  var integrationsModal = document.getElementById('integrations-modal-backdrop');
  var refreshIntegrationsBtn = document.getElementById('refresh-integrations-btn');
  var integrationsGrid = document.getElementById('integrations-grid');
  var integrationsCountBadge = document.getElementById('integrations-connected-count');
  var statTotalEl = document.getElementById('integrations-stat-total');
  var statConnectedEl = document.getElementById('integrations-stat-connected');

  var credentialModal = document.getElementById('credential-form-backdrop');
  var closeCredentialBtn = document.getElementById('close-credential-form-btn');
  var cancelCredentialBtn = document.getElementById('cancel-credential-btn');
  var credentialForm = document.getElementById('credential-form');
  var credentialFieldsContainer = document.getElementById('credential-fields-container');
  var credentialProviderInput = document.getElementById('credential-provider-input');
  var credentialFormTitle = document.getElementById('credential-form-title');
  var credentialFormMsg = document.getElementById('credential-form-msg');

  function openIntegrations() {
    if (integrationsModal) integrationsModal.classList.add('open');
    loadIntegrationsStatus();
  }

  function closeIntegrations() {
    if (integrationsModal) integrationsModal.classList.remove('open');
  }

  function closeCredentialForm() {
    if (credentialModal) credentialModal.classList.remove('open');
  }

  if (openIntegrationsBtn) openIntegrationsBtn.onclick = openIntegrations;
  if (closeIntegrationsBtn) closeIntegrationsBtn.onclick = closeIntegrations;
  if (refreshIntegrationsBtn) refreshIntegrationsBtn.onclick = loadIntegrationsStatus;

  if (closeCredentialBtn) closeCredentialBtn.onclick = closeCredentialForm;
  if (cancelCredentialBtn) cancelCredentialBtn.onclick = closeCredentialForm;

  if (integrationsModal) {
    integrationsModal.onclick = function (e) {
      if (e.target === integrationsModal) closeIntegrations();
    };
  }
  if (credentialModal) {
    credentialModal.onclick = function (e) {
      if (e.target === credentialModal) closeCredentialForm();
    };
  }

  window.addEventListener('message', function (e) {
    if (e.data && (e.data === 'oauth_success' || e.data.type === 'oauth_success')) {
      loadIntegrationsStatus();
    }
  });

  function loadIntegrationsStatus() {
    if (!integrationsGrid) return;
    fetch('/api/integrations/status')
      .then(function (res) { return res.json(); })
      .then(function (items) {
        if (!Array.isArray(items)) {
          integrationsGrid.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;grid-column:1/-1;">Không tải được dữ liệu tích hợp</div>';
          return;
        }

        var total = items.length;
        var connected = items.filter(function (i) { return i.isConnected; }).length;

        if (statTotalEl) statTotalEl.textContent = 'Tổng: ' + total + ' công cụ';
        if (statConnectedEl) statConnectedEl.textContent = 'Đã kết nối: ' + connected;

        if (integrationsCountBadge) {
          integrationsCountBadge.textContent = connected;
          integrationsCountBadge.style.display = connected > 0 ? 'inline-block' : 'none';
        }

        if (items.length === 0) {
          integrationsGrid.innerHTML = '<div style="color:var(--text-muted);padding:16px;text-align:center;grid-column:1/-1;">Chưa có công cụ nào</div>';
          return;
        }

        integrationsGrid.innerHTML = items.map(function (item) {
          var typeLabel = item.type === 'oauth2' ? 'OAuth2' : item.type === 'form' ? 'Database/Form' : 'Built-in Native';
          var badgeHtml = item.isConnected
            ? '<span class="integration-badge badge-connected"><span class="db-dot"></span> Đã kết nối</span>'
            : '<span class="integration-badge badge-disconnected">⚪ Chưa kết nối</span>';

          var actionHtml = '';
          if (item.type === 'native') {
            actionHtml = '<button class="subtle-btn" disabled style="opacity:0.6;cursor:default;">Tích hợp sẵn</button>';
          } else if (item.isConnected) {
            actionHtml = '<button class="danger-btn" data-integration-action="disconnect" data-provider="' + escapeHtml(item.providerId) + '">Ngắt kết nối</button>';
          } else if (item.type === 'oauth2') {
            actionHtml = '<button class="primary-btn" data-integration-action="oauth" data-provider="' + escapeHtml(item.providerId) + '">Kết nối OAuth</button>';
          } else {
            actionHtml = '<button class="primary-btn" data-integration-action="configure" data-provider="' + escapeHtml(item.providerId) + '">Cấu hình DB</button>';
          }

          return '<div class="integration-card">' +
            '<div class="integration-card-header">' +
              '<div>' +
                '<div style="font-weight:600;font-size:14px;color:var(--text);margin-bottom:2px;">' + escapeHtml(item.name || item.providerId) + '</div>' +
                '<span class="badge-type">' + typeLabel + '</span>' +
              '</div>' +
              badgeHtml +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);line-height:1.4;">' + escapeHtml(item.description) + '</div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:6px;">' + actionHtml + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function (err) {
        console.warn('loadIntegrationsStatus error:', err);
        integrationsGrid.innerHTML = '<div style="color:var(--err);padding:16px;text-align:center;grid-column:1/-1;">Lỗi kết nối tới Integrations API</div>';
      });
  }

  window.__playgroundConnectOAuth = function (provider) {
    fetch('/api/integrations/initiate?provider=' + encodeURIComponent(provider))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.authUrl) {
          alert('Không lấy được URL ủy quyền OAuth từ mcp_auth');
          return;
        }
        var popup = window.open(data.authUrl, 'oauth_connect_' + provider, 'width=600,height=700,status=no,toolbar=no');
        var timer = setInterval(function () {
          if (!popup || popup.closed) {
            clearInterval(timer);
            loadIntegrationsStatus();
          }
        }, 1000);
      })
      .catch(function (e) {
        alert('Lỗi khởi tạo kết nối OAuth: ' + e.message);
      });
  };

  window.__playgroundConfigureForm = function (provider) {
    fetch('/api/integrations/initiate?provider=' + encodeURIComponent(provider))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.fields) return;
        if (credentialProviderInput) credentialProviderInput.value = provider;
        if (credentialFormTitle) credentialFormTitle.textContent = 'Cấu hình kết nối ' + provider.toUpperCase();
        if (credentialFormMsg) {
          credentialFormMsg.style.display = 'none';
          credentialFormMsg.textContent = '';
        }

        if (credentialFieldsContainer) {
          credentialFieldsContainer.innerHTML = data.fields.map(function (f) {
            return '<div>' +
              '<label class="form-label">' + f.label + (f.required ? ' *' : '') + '</label>' +
              '<input class="form-input" name="' + f.name + '" type="' + (f.type || 'text') + '" placeholder="' + (f.placeholder || '') + '" ' + (f.required ? 'required' : '') + ' />' +
            '</div>';
          }).join('');
        }

        if (credentialModal) credentialModal.classList.add('open');
      })
      .catch(function (e) {
        alert('Lỗi lấy thông tin form: ' + e.message);
      });
  };

  window.__playgroundDisconnect = function (provider) {
    if (!confirm('Bạn có chắc muốn ngắt kết nối với "' + provider + '"?')) return;
    fetch('/api/integrations/' + encodeURIComponent(provider), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function () {
        loadIntegrationsStatus();
      })
      .catch(function (e) {
        alert('Lỗi ngắt kết nối: ' + e.message);
      });
  };

  var integrationActionHandlers = {
    disconnect: window.__playgroundDisconnect,
    oauth: window.__playgroundConnectOAuth,
    configure: window.__playgroundConfigureForm,
  };

  if (integrationsGrid) {
    integrationsGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-integration-action]');
      if (!btn || !integrationsGrid.contains(btn)) return;
      var handler = integrationActionHandlers[btn.dataset.integrationAction];
      if (handler) handler(btn.dataset.provider);
    });
  }

  if (credentialForm) {
    credentialForm.onsubmit = function (e) {
      e.preventDefault();
      var provider = credentialProviderInput ? credentialProviderInput.value : '';
      if (!provider) return;

      var formData = new FormData(credentialForm);
      var credentials = {};
      formData.forEach(function (value, key) {
        if (key && key !== 'provider') {
          credentials[key] = value;
        }
      });

      var saveBtn = document.getElementById('save-credential-btn');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Đang lưu...';
      }

      fetch('/api/integrations/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider, credentials: credentials }),
      })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.error) {
            throw new Error(res.message || 'Lưu thất bại');
          }
          closeCredentialForm();
          loadIntegrationsStatus();
        })
        .catch(function (err) {
          if (credentialFormMsg) {
            credentialFormMsg.style.display = 'block';
            credentialFormMsg.style.color = 'var(--err)';
            credentialFormMsg.textContent = 'Lỗi: ' + (err.message || 'Không thể lưu credentials');
          }
        })
        .finally(function () {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Lưu & Kết Nối';
          }
        });
    };
  }

  loadIntegrationsStatus();

  loadConversations();
  if (sessionId) {
    statusEl.textContent = 'session: ' + sessionId.slice(0, 8);
    loadHistory(sessionId);
  }
})();
</script>
</body>
</html>`;
