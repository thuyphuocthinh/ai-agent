// Trang playground: 1 file HTML, CSS và JS inline, không script bên thứ ba. Mọi dữ
// liệu từ stream chỉ được chèn bằng textContent (không innerHTML) nên không có XSS.
export const PLAYGROUND_HTML = /* html */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Playground</title>
<style>
  :root { --bg:#0f1115; --panel:#181b22; --line:#2a2f3a; --text:#e6e8ee; --muted:#8b93a7; --accent:#6aa9ff; --ok:#4cc38a; --err:#ff6b6b; --warn:#f5b84c; }
  @media (prefers-color-scheme: light) { :root { --bg:#f5f6f8; --panel:#fff; --line:#dde1e8; --text:#1c2230; --muted:#667085; --accent:#2563eb; --ok:#15803d; --err:#dc2626; --warn:#b45309; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, sans-serif; display:flex; flex-direction:column; height:100vh; }
  header { padding:10px 16px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  header b { font-size:15px; } header span { color:var(--muted); font-size:12px; }
  #log { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:12px; }
  .msg { max-width:860px; width:100%; margin:0 auto; }
  .user { background:var(--accent); color:#fff; padding:8px 12px; border-radius:10px; align-self:flex-end; white-space:pre-wrap; }
  .bot { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:8px; }
  .text, .final { white-space:pre-wrap; word-break:break-word; }
  .final { border-top:1px dashed var(--line); padding-top:8px; }
  .persona { border-left:3px solid var(--accent); background:rgba(106,169,255,.08); padding:6px 10px; border-radius:6px; font-size:13px; }
  .persona small { color:var(--muted); display:block; }
  details.tool { border:1px solid var(--line); border-radius:8px; padding:6px 10px; font-size:13px; }
  details.tool summary { cursor:pointer; } details.tool.error { border-color:var(--err); } details.tool.error summary { color:var(--err); }
  details.tool.done summary::after { content:" ✓"; color:var(--ok); }
  pre { margin:6px 0 0; padding:8px; background:rgba(127,127,127,.12); border-radius:6px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:12px; }
  .label { color:var(--muted); font-size:11px; margin-top:6px; }
  .approval { border:1px solid var(--warn); border-radius:8px; padding:8px 10px; background:rgba(245,184,76,.08); }
  .approval button { margin-right:8px; margin-top:6px; }
  .error { color:var(--err); } .hint { color:var(--muted); font-size:12px; text-align:center; }
  form { border-top:1px solid var(--line); padding:12px 16px; display:flex; gap:8px; max-width:892px; width:100%; margin:0 auto; }
  textarea { flex:1; resize:none; background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
  button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:8px 16px; font:inherit; cursor:pointer; }
  button.reject { background:var(--err); } button:disabled { opacity:.5; cursor:default; }
</style>
</head>
<body>
<header><b>Agent Playground</b><span id="status">phiên mới</span></header>
<div id="log"><div class="hint">Gõ câu hỏi bên dưới. Thử: "liệt kê sản phẩm", "tổng doanh thu đơn đã thanh toán", "giảm giá sản phẩm 1 còn 1đ" (cần duyệt).</div></div>
<form id="form"><textarea id="prompt" rows="2" placeholder="Nhập câu hỏi... (Enter để gửi, Shift+Enter xuống dòng)"></textarea><button id="send">Gửi</button></form>
<script>
(function () {
  var log = document.getElementById('log');
  var promptBox = document.getElementById('prompt');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  var sessionId = null;
  var busy = false;

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
  function setBusy(value) { busy = value; sendBtn.disabled = value; promptBox.disabled = value; if (!value) promptBox.focus(); }

  // Mỗi lượt trả lời của bot là 1 "bubble"; render từng chunk của UI Message Stream.
  function createBubble() {
    var box = el('div', 'msg bot');
    log.appendChild(box);
    return { box: box, texts: {}, tools: {}, reply: null, replyEl: null };
  }

  function streamedText(bubble) {
    return Object.keys(bubble.texts).map(function (id) { return bubble.texts[id].textContent; }).join('');
  }

  function showReply(bubble) {
    if (bubble.reply === null) return;
    if (streamedText(bubble).trim() === bubble.reply.trim()) return;
    if (!bubble.replyEl) { bubble.replyEl = el('div', 'final'); bubble.box.appendChild(bubble.replyEl); }
    bubble.replyEl.textContent = bubble.reply;
  }

  function render(bubble, chunk) {
    switch (chunk.type) {
      case 'text-start': bubble.texts[chunk.id] = el('div', 'text'); bubble.box.appendChild(bubble.texts[chunk.id]); break;
      case 'text-delta': if (bubble.texts[chunk.id]) bubble.texts[chunk.id].textContent += chunk.delta; break;
      case 'data-persona': {
        var p = chunk.data || {};
        var card = el('div', 'persona', '🎭 ' + (p.role || '') + ' — ' + (p.goal || ''));
        if (p.constraints && p.constraints.length) card.appendChild(el('small', '', 'Ràng buộc: ' + p.constraints.join('; ')));
        if (p.tone) card.appendChild(el('small', '', 'Giọng: ' + p.tone));
        bubble.box.appendChild(card);
        break;
      }
      case 'tool-input-available': {
        var d = el('details', 'tool');
        d.appendChild(el('summary', '', '🔧 ' + chunk.toolName));
        d.appendChild(el('div', 'label', 'Input'));
        d.appendChild(el('pre', '', pretty(chunk.input && chunk.input.preview !== undefined ? chunk.input.preview : chunk.input)));
        var out = el('div');
        out.appendChild(el('div', 'label', 'Output'));
        var outPre = el('pre', '', 'đang chạy...');
        out.appendChild(outPre);
        d.appendChild(out);
        bubble.box.appendChild(d);
        bubble.tools[chunk.toolCallId] = { details: d, pre: outPre };
        break;
      }
      case 'tool-output-available': {
        var t = bubble.tools[chunk.toolCallId];
        if (t) { t.pre.textContent = pretty(chunk.output); t.details.classList.add('done'); }
        break;
      }
      case 'tool-output-error': {
        var te = bubble.tools[chunk.toolCallId];
        if (te) { te.pre.textContent = chunk.errorText; te.details.classList.add('error'); te.details.open = true; }
        break;
      }
      case 'data-resync':
        // Engine sửa lại nội dung đã stream: lấy bản chuẩn làm câu trả lời cuối.
        bubble.reply = (chunk.data && chunk.data.text) || bubble.reply;
        break;
      case 'data-reply':
        bubble.reply = chunk.data && chunk.data.text;
        break;
      case 'data-approval': renderApproval(bubble, chunk.data || {}); break;
      case 'error': bubble.box.appendChild(el('div', 'error', '⚠️ ' + chunk.errorText)); break;
      case 'finish': showReply(bubble); break;
    }
    scroll();
  }

  function renderApproval(bubble, data) {
    var tool = data.tool || {};
    var box = el('div', 'approval');
    box.appendChild(el('div', '', '⚠️ Cần duyệt: ' + (tool.provider || '') + '.' + (tool.name || '')));
    box.appendChild(el('pre', '', pretty(tool.args || {})));
    if (data.preview) box.appendChild(el('div', 'label', typeof data.preview === 'string' ? data.preview : JSON.stringify(data.preview)));
    var approve = el('button', '', 'Duyệt');
    var reject = el('button', 'reject', 'Từ chối');
    function decide(action) {
      approve.disabled = true; reject.disabled = true;
      box.appendChild(el('div', 'label', action === 'approve' ? 'Đã duyệt, đang chạy...' : 'Đã từ chối'));
      run('/api/approve', { sessionId: sessionId, messageId: data.messageId, action: action });
    }
    approve.onclick = function () { decide('approve'); };
    reject.onclick = function () { decide('reject'); };
    box.appendChild(approve); box.appendChild(reject);
    bubble.box.appendChild(box);
  }

  // Đọc SSE bằng fetch: tách theo dòng trống, mỗi sự kiện là các dòng "data: ...".
  async function run(url, body) {
    setBusy(true);
    var bubble = createBubble();
    try {
      var response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var session = response.headers.get('x-playground-session');
      if (session) { sessionId = session; statusEl.textContent = 'phiên ' + session.slice(0, 8); }
      if (!response.ok || !response.body) {
        var info = '';
        try { var j = await response.json(); info = j.error || j.message || JSON.stringify(j); } catch (e) { info = response.statusText; }
        bubble.box.appendChild(el('div', 'error', '⚠️ ' + response.status + ': ' + info));
        return;
      }
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });
        var events = buffer.split('\\n\\n');
        buffer = events.pop();
        events.forEach(function (raw) {
          var line = raw.split('\\n').filter(function (l) { return l.indexOf('data:') === 0; }).map(function (l) { return l.slice(5).trim(); }).join('');
          if (!line || line === '[DONE]') return;
          try { render(bubble, JSON.parse(line)); } catch (e) { /* bỏ qua dòng không phải JSON */ }
        });
      }
      showReply(bubble);
    } catch (error) {
      bubble.box.appendChild(el('div', 'error', '⚠️ Lỗi kết nối: ' + error.message));
    } finally {
      setBusy(false);
      scroll();
    }
  }

  function submit() {
    var text = promptBox.value.trim();
    if (!text || busy) return;
    promptBox.value = '';
    log.appendChild(el('div', 'msg user', text));
    run('/api/chat', { prompt: text, sessionId: sessionId || undefined });
  }
  document.getElementById('form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  promptBox.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
})();
</script>
</body>
</html>`;
