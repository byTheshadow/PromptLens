/**
 * PromptLens 掠影
 * 预设工程师的读书笔记插件
 * by Shadow — v0.1.0
 *
 * P0 骨架：悬浮球 + 浮动面板 + Extensions 面板入口 + localStorage 基础
 */

// ============================================================
// 0. 常量 & 工具
// ============================================================

const PL_STORAGE_KEY = 'PromptLens_data';
const PL_POS_KEY     = 'PromptLens_ballPos';
const PL_VERSION     = '0.1.0';

function plLoadStore() {
  try {
    const raw = localStorage.getItem(PL_STORAGE_KEY);
    if (!raw) return plDefaultStore();
    return Object.assign(plDefaultStore(), JSON.parse(raw));
  } catch (e) {
    console.warn('[PromptLens] 读取 localStorage 失败', e);
    return plDefaultStore();
  }
}

function plSaveStore(store) {
  try {
    localStorage.setItem(PL_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('[PromptLens] 写入 localStorage 失败', e);
  }
}

function plDefaultStore() {
  return {
    notes:     [],
    snapshots: [],
    settings:  { ballPos: null }
  };
}

function plUUID() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function plStorageSize() {
  try {
    const raw = localStorage.getItem(PL_STORAGE_KEY) || '';
    return (new Blob([raw]).size / 1024).toFixed(1);
  } catch {
    return '?';
  }
}

// ============================================================
// 1. DOM 构建
// ============================================================

function plCreateBall() {
  const ball = document.createElement('div');
  ball.id = 'pl-ball';
  ball.setAttribute('aria-label', 'PromptLens 掠影');
  ball.setAttribute('role', 'button');
  ball.setAttribute('tabindex', '0');
  ball.innerHTML = `
    <svg class="pl-ball-icon" viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            stroke="#c0392b" stroke-width="1.5"/>
      <path d="M8 8h8M8 12h8M8 16h5"
            stroke="#c0392b" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span class="pl-badge" id="pl-change-badge" aria-hidden="true"></span>
  `;
  document.body.appendChild(ball);
  return ball;
}

function plCreatePanel() {
  const panel = document.createElement('div');
  panel.id = 'pl-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'PromptLens 主面板');
  panel.innerHTML = `
    <div id="pl-panel-header">
      <div class="pl-panel-title">
        <span class="pl-logo-dot" aria-hidden="true"></span>
        掠影
      </div>
      <button id="pl-panel-close" aria-label="关闭面板" title="关闭">✕</button>
    </div>

    <div id="pl-tabs" role="tablist">
      <button class="pl-tab pl-tab-active" data-tab="notes"
              role="tab" aria-selected="true">
        📓 笔记
      </button>
      <button class="pl-tab" data-tab="snapshots"
              role="tab" aria-selected="false">
        📷 快照
      </button>
      <button class="pl-tab" data-tab="panel-settings"
              role="tab" aria-selected="false">
        ⚙ 设置
      </button>
    </div>

    <div id="pl-panel-body">

      <!-- 笔记面板 -->
      <div class="pl-tab-pane pl-pane-active" id="pl-pane-notes" role="tabpanel">
        <div class="pl-empty" id="pl-notes-empty">
          <div class="pl-empty-icon">📓</div>
          <div>还没有笔记</div>
          <div style="font-size:11px;color:#444;margin-top:4px;">
            选中聊天文字点击【掠影】，或手动输入
          </div>
        </div>
        <div id="pl-notes-list" style="display:none; flex-direction:column; gap:8px;"></div>
      </div>

      <!-- 快照面板 -->
      <div class="pl-tab-pane" id="pl-pane-snapshots" role="tabpanel">
        <div class="pl-empty" id="pl-snapshots-empty">
          <div class="pl-empty-icon">📷</div>
          <div>还没有快照</div>
          <div style="font-size:11px;color:#444;margin-top:4px;">
            快照功能将在 P2 版本启用
          </div>
        </div>
      </div>

      <!-- 面板内设置 -->
      <div class="pl-tab-pane" id="pl-pane-panel-settings" role="tabpanel">
        <div class="pl-card" style="display:flex;flex-direction:column;gap:10px;">
          <div style="font-size:12px;color:#666;line-height:1.7;">
            PromptLens 掠影<br>
            预设工程师的读书笔记插件<br>
            by Shadow &nbsp;·&nbsp; v${PL_VERSION}
          </div>
          <div style="border-top:1px solid #2e2e2e;padding-top:10px;">
            <div style="font-size:11px;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.8px;">数据概览</div>
            <div class="pl-stat-row">
              <span>笔记总数</span>
              <span class="pl-stat-val" id="pl-panel-stat-notes">0</span>
            </div>
            <div class="pl-stat-row">
              <span>快照总数</span>
              <span class="pl-stat-val" id="pl-panel-stat-snapshots">0</span>
            </div>
            <div class="pl-stat-row">
              <span>存储占用</span>
              <span class="pl-stat-val" id="pl-panel-stat-storage">0 KB</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);
  return panel;
}

/** 注入选中文字气泡按钮 */
function plCreateBubble() {
  const bubble = document.createElement('div');
  bubble.id = 'pl-selection-bubble';
  bubble.setAttribute('role', 'button');
  bubble.setAttribute('aria-label', '收藏选中文字到掠影');
  bubble.innerHTML = `<span aria-hidden="true">✦</span> 掠影`;
  document.body.appendChild(bubble);
  return bubble;
}

// ============================================================
// 2. 悬浮球拖拽
// ============================================================

function plInitBallDrag(ball) {
  let dragging = false;
  let startX, startY, originLeft, originTop;
  let moved = false;

  // 恢复上次位置
  try {
    const saved = JSON.parse(localStorage.getItem(PL_POS_KEY));
    if (saved) {
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
      ball.style.left = saved.left + 'px';
      ball.style.top  = saved.top  + 'px';
    }
  } catch {}

  function onPointerDown(e) {
    // 只响应主键
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    moved    = false;

    const rect = ball.getBoundingClientRect();
    startX     = e.clientX ?? e.touches[0].clientX;
    startY     = e.clientY ?? e.touches[0].clientY;
    originLeft = rect.left;
    originTop  = rect.top;

    ball.style.right  = 'auto';
    ball.style.bottom = 'auto';
    ball.style.left   = originLeft + 'px';
    ball.style.top    = originTop  + 'px';
    ball.style.transition = 'none';

    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const cx = e.clientX ?? e.touches[0].clientX;
    const cy = e.clientY ?? e.touches[0].clientY;
    const dx = cx - startX;
    const dy = cy - startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

    const newLeft = Math.max(0, Math.min(window.innerWidth  - ball.offsetWidth,  originLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - ball.offsetHeight, originTop  + dy));

    ball.style.left = newLeft + 'px';
    ball.style.top  = newTop  + 'px';
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    ball.style.transition = '';

    // 保存位置
    try {
      localStorage.setItem(PL_POS_KEY, JSON.stringify({
        left: parseFloat(ball.style.left),
        top:  parseFloat(ball.style.top)
      }));
    } catch {}

    // 没有移动 → 视为点击，交给 click 事件处理
    if (!moved) return;
  }

  ball.addEventListener('mousedown',  onPointerDown);
  ball.addEventListener('touchstart', onPointerDown, { passive: false });
  document.addEventListener('mousemove',  onPointerMove);
  document.addEventListener('touchmove',  onPointerMove, { passive: false });
  document.addEventListener('mouseup',    onPointerUp);
  document.addEventListener('touchend',   onPointerUp);
}

// ============================================================
// 3. 浮动面板拖拽（仅 PC）
// ============================================================

function plInitPanelDrag(panel) {
  const header = document.getElementById('pl-panel-header');
  if (!header) return;

  let dragging = false;
  let startX, startY, originLeft, originTop;

  header.addEventListener('mousedown', (e) => {
    // 不拦截关闭按钮
    if (e.target.closest('#pl-panel-close')) return;
    dragging = true;

    const rect = panel.getBoundingClientRect();
    startX     = e.clientX;
    startY     = e.clientY;
    originLeft = rect.left;
    originTop  = rect.top;

    panel.style.right      = 'auto';
    panel.style.bottom     = 'auto';
    panel.style.left       = originLeft + 'px';
    panel.style.top        = originTop  + 'px';
    panel.style.transition = 'opacity 0.2s ease, transform 0.2s ease';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  originLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, originTop  + dy));

    panel.style.left = newLeft + 'px';
    panel.style.top  = newTop  + 'px';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
  });
}

// ============================================================
// 4. 面板开关
// ============================================================

let plPanelOpen = false;

function plOpenPanel() {
  const panel = document.getElementById('pl-panel');
  if (!panel) return;
  plPanelOpen = true;
  panel.classList.add('pl-panel-open');
  plRefreshStats();
}

function plClosePanel() {
  const panel = document.getElementById('pl-panel');
  if (!panel) return;
  plPanelOpen = false;
  panel.classList.remove('pl-panel-open');
}

function plTogglePanel() {
  plPanelOpen ? plClosePanel() : plOpenPanel();
}

// ============================================================
// 5. 标签页切换
// ============================================================

function plInitTabs() {
  const tabs = document.querySelectorAll('.pl-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      // 更新 tab 状态
      tabs.forEach(t => {
        t.classList.remove('pl-tab-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('pl-tab-active');
      tab.setAttribute('aria-selected', 'true');

      // 更新面板显示
      document.querySelectorAll('.pl-tab-pane').forEach(pane => {
        pane.classList.remove('pl-pane-active');
      });
      const pane = document.getElementById(`pl-pane-${target}`);
      if (pane) pane.classList.add('pl-pane-active');

      // 切到设置页时刷新统计
      if (target === 'panel-settings') plRefreshStats();
    });
  });
}

// ============================================================
// 6. 选中文字气泡
// ============================================================

let plPendingText = '';

function plInitSelectionBubble(bubble) {
  document.addEventListener('mouseup', (e) => {
    // 气泡本身的点击不触发
    if (e.target.closest('#pl-selection-bubble')) return;

    setTimeout(() => {
      const sel  = window.getSelection();
      const text = sel ? sel.toString().trim() : '';

      if (!text) {
        plHideBubble(bubble);
        return;
      }

      plPendingText = text;

      // 定位到选区末尾附近
      const range = sel.getRangeAt(0);
      const rect  = range.getBoundingClientRect();

      let x = rect.left + rect.width / 2 - 36;
      let y = rect.top  - 40 + window.scrollY;

      // 防止超出视口
      x = Math.max(8, Math.min(window.innerWidth - 100, x));
      if (y < 8) y = rect.bottom + window.scrollY + 8;

      bubble.style.left = x + 'px';
      bubble.style.top  = y + 'px';
      bubble.classList.add('visible');
    }, 10);
  });

  // 点击其他地方隐藏气泡
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#pl-selection-bubble')) {
      plHideBubble(bubble);
    }
  });

  // 点击气泡 → 收藏
  bubble.addEventListener('click', () => {
    if (!plPendingText) return;
    plSaveNoteFromSelection(plPendingText);
    plHideBubble(bubble);
    plPendingText = '';
    window.getSelection()?.removeAllRanges();
  });
}

function plHideBubble(bubble) {
  bubble.classList.remove('visible');
}

// ============================================================
// 7. 笔记操作（P0 骨架，P1 完善）
// ============================================================

/**
 * 从选中文字创建笔记并存储
 * P0 阶段：直接存入，不弹编辑框
 * P1 阶段：会弹出编辑/打标签弹窗
 */
function plSaveNoteFromSelection(text) {
  const store = plLoadStore();
  const note  = {
    id:        plUUID(),
    content:   text,
    source:    'selection',   // 'selection' | 'manual'
    tags:      [],            // P1 标签
    createdAt: new Date().toISOString()
  };
  store.notes.unshift(note);
  plSaveStore(store);
  plRenderNotes();
  plRefreshStats();

  // 打开面板并切到笔记页
  plOpenPanel();
  const notesTab = document.querySelector('.pl-tab[data-tab="notes"]');
  if (notesTab) notesTab.click();

  plShowToast('已收藏到掠影 ✓');
}

// ============================================================
// 8. 笔记渲染
// ============================================================

function plRenderNotes() {
  const store    = plLoadStore();
  const list     = document.getElementById('pl-notes-list');
  const empty    = document.getElementById('pl-notes-empty');
  if (!list || !empty) return;

  if (store.notes.length === 0) {
    list.style.display  = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display  = 'flex';
  list.innerHTML      = '';

  store.notes.forEach(note => {
    const card = document.createElement('div');
    card.className = 'pl-note-card pl-card';
    card.dataset.id = note.id;
    card.innerHTML = `
      <div class="pl-note-content">${plEscape(note.content)}</div>
      <div class="pl-note-meta">
        <span class="pl-note-time">${plFormatTime(note.createdAt)}</span>
        <span class="pl-note-source">${note.source === 'selection' ? '选中收藏' : '手动输入'}</span>
        <div class="pl-note-actions">
          <button class="pl-note-btn pl-note-copy" title="复制" aria-label="复制笔记内容">⎘</button>
          <button class="pl-note-btn pl-note-delete" title="删除" aria-label="删除笔记">✕</button>
        </div>
      </div>
    `;

    // 复制
    card.querySelector('.pl-note-copy').addEventListener('click', () => {
      plCopyText(note.content, card.querySelector('.pl-note-copy'));
    });

    // 删除
    card.querySelector('.pl-note-delete').addEventListener('click', () => {
      plDeleteNote(note.id);
    });

    list.appendChild(card);
  });
}

function plDeleteNote(id) {
  const store = plLoadStore();
  store.notes = store.notes.filter(n => n.id !== id);
  plSaveStore(store);
  plRenderNotes();
  plRefreshStats();
}

// ============================================================
// 9. 复制到剪贴板
// ============================================================

function plCopyText(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnEl) {
      const orig = btnEl.textContent;
      btnEl.textContent = '✓';
      btnEl.style.color = '#2ecc71';
      setTimeout(() => {
        btnEl.textContent = orig;
        btnEl.style.color = '';
      }, 1500);
    }
    plShowToast('已复制到剪贴板 ✓');
  }).catch(() => {
    // 降级方案
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    plShowToast('已复制到剪贴板 ✓');
  });
}

// ============================================================
// 10. Toast 提示
// ============================================================

let plToastTimer = null;

function plShowToast(msg) {
  let toast = document.getElementById('pl-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pl-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('pl-toast-show');

  clearTimeout(plToastTimer);
  plToastTimer = setTimeout(() => {
    toast.classList.remove('pl-toast-show');
  }, 2000);
}

// ============================================================
// 11. 统计刷新
// ============================================================

function plRefreshStats() {
  const store = plLoadStore();
  const size  = plStorageSize();

  // 面板内统计
  const elNotes     = document.getElementById('pl-panel-stat-notes');
  const elSnapshots = document.getElementById('pl-panel-stat-snapshots');
  const elStorage   = document.getElementById('pl-panel-stat-storage');
  if (elNotes)     elNotes.textContent     = store.notes.length;
  if (elSnapshots) elSnapshots.textContent = store.snapshots.length;
  if (elStorage)   elStorage.textContent   = size + ' KB';

  // Extensions 面板统计
  const extNotes     = document.getElementById('pl-stat-notes');
  const extSnapshots = document.getElementById('pl-stat-snapshots');
  const extStorage   = document.getElementById('pl-stat-storage');
  if (extNotes)     extNotes.textContent     = store.notes.length;
  if (extSnapshots) extSnapshots.textContent = store.snapshots.length;
  if (extStorage)   extStorage.textContent   = size + ' KB';
}

// ============================================================
// 12. 工具函数
// ============================================================

/** HTML 转义，防止 XSS */
function plEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 格式化时间 */
function plFormatTime(iso) {
  try {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

// ============================================================
// 13. Extensions 面板绑定
// ============================================================

function plInitSettingsPanel() {
  // 打开主面板按钮
  const btnOpen = document.getElementById('pl-settings-open-panel');
  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      plOpenPanel();
    });
  }

  // 刷新统计
  plRefreshStats();
}

// ============================================================
// 14. 主入口
// ============================================================

(function plInit() {
  // 等待 DOM 就绪
  function onReady() {
    // 构建 DOM
    const ball   = plCreateBall();
    const panel  = plCreatePanel();
    const bubble = plCreateBubble();

    // 初始化交互
    plInitBallDrag(ball);
    plInitPanelDrag(panel);
    plInitTabs();
    plInitSelectionBubble(bubble);
    plInitSettingsPanel();

    // 悬浮球点击开关面板
    ball.addEventListener('click', (e) => {
      // 如果是拖拽结束，不触发
      if (ball._wasDragged) {
        ball._wasDragged = false;
        return;
      }
      plTogglePanel();
    });

    // 键盘支持（Enter/Space 触发悬浮球）
    ball.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        plTogglePanel();
      }
    });

    // 关闭按钮
    document.getElementById('pl-panel-close')?.addEventListener('click', plClosePanel);

    // 初始渲染笔记列表
    plRenderNotes();

    console.log(`[PromptLens] 掠影 v${PL_VERSION} 已加载`);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();

