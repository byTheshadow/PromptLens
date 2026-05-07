// ═══════════════════════════════════════════════════════════════
//PromptLens · 掠影 v1.0.0
//  by Shadow — 预设工程师的读书笔记插件
//  SillyTavern Extension
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE0: 常量& 配置                                   │
    // └─────────────────────────────────────────────────────────┘

    const PLUGIN_NAME = 'PromptLens';
    const DISPLAY_NAME = '掠影';
    const VERSION = '1.0.0';
    const STORAGE_KEY = 'PromptLens_data';
    const LOG_MAX = 200;
    const FAB_DEFAULT_POS = { right: 20, bottom: 80 };
    const DEFAULT_TAGS = ['八股文', '越狱', '人设技巧', '写作手法', '系统提示'];
    const DRAG_THRESHOLD = 5;

    // ★ 关键：ST 插件路径，用于 fetch settings.html
    const EXTENSION_PATH = 'scripts/extensions/third-party/PromptLens';

    // 内部状态
    let pluginEnabled = true;
    let panelVisible = false;
    let currentTab = 'notes';
    let currentFilterTag = null;
    let currentSearchKeyword = '';

    // 快照引擎追踪状态
    let _currentModel = '';
    let _currentSource = '';
    let _currentPresetName = '';
    let _currentPreset = null;

    // DOM 引用缓存
    let fabEl = null;
    let panelEl = null;
    let logContainerEl = null;

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 1: 日志系统 Logger│
    // └─────────────────────────────────────────────────────────┘

    const Logger = {
        _logs: [],

        _formatTime() {
            const d = new Date();
            return [
                String(d.getHours()).padStart(2, '0'),
                String(d.getMinutes()).padStart(2, '0'),
                String(d.getSeconds()).padStart(2, '0'),
            ].join(':');
        },

        _levelIcon(level) {
            const map = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
            return map[level] || 'ℹ️';
        },

        _push(level, message, errorObj) {
            const entry = {
                time: this._formatTime(),
                level,
                message,
                stack: null,
            };

            if (errorObj instanceof Error) {
                entry.stack = errorObj.stack || String(errorObj);
            } else if (errorObj) {
                entry.stack = String(errorObj);
            }

            this._logs.push(entry);

            if (this._logs.length > LOG_MAX) {
                this._logs = this._logs.slice(-LOG_MAX);
            }

            this._renderEntry(entry);

            const consoleFn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
            console[consoleFn](`[${PLUGIN_NAME}] ${this._levelIcon(level)} ${message}`, errorObj || '');
        },

        _renderEntry(entry) {
            //★ 每次渲染时重新获取容器引用，因为 settings.html 可能后加载
            if (!logContainerEl) {
                logContainerEl = document.querySelector('#promptlens-log-container');
            }
            if (!logContainerEl) return;

            const empty = logContainerEl.querySelector('.promptlens-log-empty');
            if (empty) empty.remove();

            const div = document.createElement('div');
            div.className = 'promptlens-log-entry';
            div.dataset.level = entry.level;

            let html = `<span class="promptlens-log-time">[${entry.time}]</span>`;
            html += `<span class="promptlens-log-msg">${this._levelIcon(entry.level)} ${this._escapeHtml(entry.message)}</span>`;
            div.innerHTML = html;

            if (entry.stack) {
                const stackDiv = document.createElement('div');
                stackDiv.className = 'promptlens-log-stack';
                stackDiv.textContent = '↳ ' + entry.stack.split('\n').slice(0, 3).join('\n  ↳ ');
                div.appendChild(stackDiv);
            }

            logContainerEl.appendChild(div);
            logContainerEl.scrollTop = logContainerEl.scrollHeight;
        },

        _renderAll() {
            logContainerEl = document.querySelector('#promptlens-log-container');
            if (!logContainerEl) return;
            logContainerEl.innerHTML = '';
            if (this._logs.length === 0) {
                logContainerEl.innerHTML = '<div class="promptlens-log-empty">暂无日志</div>';
                return;
            }
            this._logs.forEach(entry => this._renderEntry(entry));
        },

        _escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },

        info(msg) { this._push('info', msg); },
        success(msg) { this._push('success', msg); },
        warn(msg, err) { this._push('warn', msg, err); },
        error(msg, err) { this._push('error', msg, err); },

        getLogs() { return [...this._logs]; },

        clear() {
            this._logs = [];
            logContainerEl = document.querySelector('#promptlens-log-container');
            if (logContainerEl) {
                logContainerEl.innerHTML = '<div class="promptlens-log-empty">暂无日志</div>';
            }
        },

        copyAll() {
            const text = this._logs.map(e => {
                let line = `[${e.time}] ${this._levelIcon(e.level)} ${e.message}`;
                if (e.stack) line += `\n  ↳ ${e.stack}`;
                return line;
            }).join('\n');

            navigator.clipboard.writeText(text).then(() => {
                Logger.success('日志已复制到剪贴板');
            }).catch(err => {
                Logger.error('复制日志失败', err);
            });
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 2: 存储层 Storage                                 │
    // └─────────────────────────────────────────────────────────┘

    const Storage = {
        _data: null,

        _defaultData() {
            return {
                notes: [],
                snapshots: [],
                tags: [...DEFAULT_TAGS],
                settings: {
                    enabled: true,
                    fabPos: { ...FAB_DEFAULT_POS },
                    panelPos: null,
                },_version: VERSION,
            };
        },

        load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) {
                    this._data = this._defaultData();
                    Logger.info('首次运行，已创建默认数据');
                    this.save();
                    return this._data;
                }

                const parsed = JSON.parse(raw);

                if (!parsed._version) {
                    Logger.warn('数据格式异常（缺少 _version），已重置为默认值');
                    this._data = this._defaultData();
                    this.save();
                    return this._data;
                }

                this._data = Object.assign(this._defaultData(), parsed);
                DEFAULT_TAGS.forEach(tag => {
                    if (!this._data.tags.includes(tag)) {
                        this._data.tags.push(tag);
                    }
                });

                const noteCount = this._data.notes.length;
                const snapCount = this._data.snapshots.length;
                const tagCount = this._data.tags.length;
                Logger.success(`数据加载完成 —笔记: ${noteCount}条, 快照: ${snapCount}条, 标签: ${tagCount}个`);

                return this._data;
            } catch (err) {
                Logger.error('数据加载失败，已重置为默认值', err);
                this._data = this._defaultData();
                this.save();
                return this._data;
            }
        },

        save() {
            try {
                const json = JSON.stringify(this._data);
                localStorage.setItem(STORAGE_KEY, json);

                const sizeKB = (new Blob([json]).size / 1024).toFixed(1);
                Logger.info(`数据已保存 — 总大小: ${sizeKB} KB`);

                updateSettingsStats();return true;
            } catch (err) {
                if (err.name === 'QuotaExceededError') {
                    const sizeKB = (new Blob([JSON.stringify(this._data)]).size / 1024).toFixed(1);
                    Logger.error(`localStorage 写入失败: QuotaExceededError — 当前数据大小: ${sizeKB} KB`, err);
                } else {
                    Logger.error('数据保存失败', err);
                }
                return false;
            }
        },

        getAll() {
            if (!this._data) this.load();
            return this._data;
        },

        getNotes() { return this.getAll().notes; },
        getSnapshots() { return this.getAll().snapshots; },
        getTags() { return this.getAll().tags; },
        getSettings() { return this.getAll().settings; },

        updateSettings(partial) {
            Object.assign(this._data.settings, partial);
            this.save();
        },

        exportJSON() {
            try {
                const json = JSON.stringify(this._data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const date = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = `PromptLens_backup_${date}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                const sizeKB = (blob.size / 1024).toFixed(1);
                Logger.success(`数据导出成功 — PromptLens_backup_${date}.json (${sizeKB} KB)`);
            } catch (err) {
                Logger.error('数据导出失败', err);
            }
        },

        exportMarkdown() {
            try {
                let md = `# 📓 PromptLens · 掠影 —笔记导出\n\n`;
                md += `> 导出时间: ${new Date().toLocaleString()}\n\n`;
                md += `---\n\n`;

                const notes = this._data.notes;
                if (notes.length === 0) {
                    md += `_暂无笔记_\n`;
                } else {
                    notes.forEach((note, i) => {
                        md += `## 笔记 #${i + 1}\n\n`;
                        md += `${note.content}\n\n`;
                        if (note.tags && note.tags.length > 0) {
                            md += `**标签:** ${note.tags.map(t => '`' + t + '`').join(' ')}\n\n`;
                        }
                        if (note.sourceFloor != null) {
                            md += `**来源:** 楼层 #${note.sourceFloor}\n\n`;
                        }
                        md += `**时间:** ${new Date(note.createdAt).toLocaleString()}\n\n`;
                        md += `---\n\n`;
                    });
                }

                const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                const date = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = `PromptLens_notes_${date}.md`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                const sizeKB = (blob.size / 1024).toFixed(1);
                Logger.success(`Markdown 导出成功 — PromptLens_notes_${date}.md (${sizeKB} KB)`);
            } catch (err) {
                Logger.error('Markdown 导出失败', err);
            }
        },

        importJSON(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const imported = JSON.parse(e.target.result);

                        if (!imported._version) {
                            Logger.error('导入失败: 文件格式不正确 — 缺少 _version字段');
                            reject(new Error('Invalid format'));
                            return;
                        }

                        if (imported._version !== VERSION) {
                            Logger.warn(`导入数据版本不匹配 — 文件: ${imported._version}, 当前: ${VERSION}, 已尝试兼容处理`);
                        }

                        let newNotes = 0, newSnaps = 0, newTags = 0;

                        if (imported.notes && Array.isArray(imported.notes)) {
                            const existingIds = new Set(this._data.notes.map(n => n.id));
                            imported.notes.forEach(note => {
                                if (!existingIds.has(note.id)) {
                                    this._data.notes.push(note);
                                    newNotes++;
                                }
                            });
                        }

                        if (imported.snapshots && Array.isArray(imported.snapshots)) {
                            const existingIds = new Set(this._data.snapshots.map(s => s.id));
                            imported.snapshots.forEach(snap => {
                                if (!existingIds.has(snap.id)) {
                                    this._data.snapshots.push(snap);
                                    newSnaps++;
                                }
                            });
                        }

                        if (imported.tags && Array.isArray(imported.tags)) {
                            imported.tags.forEach(tag => {
                                if (!this._data.tags.includes(tag)) {
                                    this._data.tags.push(tag);
                                    newTags++;
                                }
                            });
                        }

                        this.save();
                        Logger.success(`数据导入成功 — 新增笔记: ${newNotes}条, 新增快照: ${newSnaps}条, 合并标签: ${newTags}个`);
                        resolve({ newNotes, newSnaps, newTags });
                    } catch (err) {
                        Logger.error('导入失败: JSON 解析错误', err);
                        reject(err);
                    }
                };
                reader.onerror = (err) => {
                    Logger.error('导入失败: 文件读取错误', err);
                    reject(err);
                };
                reader.readAsText(file);
            });
        },

        clearAll() {
            this._data = this._defaultData();
            this.save();
            Logger.warn('所有数据已清空');
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 3: 笔记管理 NoteManager                           │
    // └─────────────────────────────────────────────────────────┘

    const NoteManager = {
        _generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        },

        add({ content, tags = [], sourceFloor = null, sourceMessageId = null }) {
            if (!content || !content.trim()) {
                Logger.warn('笔记内容为空，已忽略');
                return null;
            }

            const note = {
                id: this._generateId(),
                content: content.trim(),
                tags,
                sourceFloor,
                sourceMessageId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            Storage.getAll().notes.unshift(note);
            Storage.save();

            Logger.info(`新建笔记 — ID: ${note.id}, 来源: ${sourceFloor != null ? '楼层#' + sourceFloor : '手动输入'}, 标签: [${tags.join(', ')}]`);

            FloatingPanel.refreshNotes();
            return note;
        },

        delete(id) {
            const data = Storage.getAll();
            const idx = data.notes.findIndex(n => n.id === id);
            if (idx === -1) {
                Logger.warn(`删除笔记失败 — 未找到 ID: ${id}`);
                return false;
            }
            data.notes.splice(idx, 1);
            Storage.save();
            Logger.info(`删除笔记 — ID: ${id}`);
            FloatingPanel.refreshNotes();
            return true;
        },

        update(id, fields) {
            const data = Storage.getAll();
            const note = data.notes.find(n => n.id === id);
            if (!note) {
                Logger.warn(`更新笔记失败 — 未找到 ID: ${id}`);
                return false;
            }
            Object.assign(note, fields, { updatedAt: new Date().toISOString() });
            Storage.save();
            FloatingPanel.refreshNotes();
            return true;
        },

        getAll() {
            return Storage.getNotes();
        },

        filter({ keyword = '', tag = null } = {}) {
            let notes = this.getAll();

            if (tag) {
                notes = notes.filter(n => n.tags && n.tags.includes(tag));
            }

            if (keyword.trim()) {
                const kw = keyword.trim().toLowerCase();
                notes = notes.filter(n => n.content.toLowerCase().includes(kw));
            }

            return notes;
        },

        copyToClipboard(id) {
            const note = this.getAll().find(n => n.id === id);
            if (!note) return;

            navigator.clipboard.writeText(note.content).then(() => {
                Logger.info(`复制笔记内容到剪贴板 — ID: ${id}`);}).catch(err => {
                Logger.error('复制到剪贴板失败', err);
            });
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 4: 快照引擎 SnapshotEngine                        │
    // └─────────────────────────────────────────────────────────┘

    const SnapshotEngine = {
        _generateId() {
            return 'snap_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        },

        capture(manualNote = '') {
            const snapshot = {
                id: this._generateId(),
                timestamp: new Date().toISOString(),
                model: _currentModel || '未知',
                apiSource: _currentSource || '未知',
                presetName: _currentPresetName || '未知',
                enabledEntries: this._getEnabledEntries(),
                worldInfoEntries: [],
                note: manualNote,
                rating: 0,
                ratingNote: '',};

            Storage.getAll().snapshots.unshift(snapshot);
            Storage.save();

            const entryCount = snapshot.enabledEntries.length;
            Logger.info(`快照捕获 — 预设: ${snapshot.presetName}, 模型: ${snapshot.model}, 条目: ${entryCount}个`);

            FloatingPanel.refreshSnapshots();
            FloatingBall.setChanged(false);

            return snapshot;
        },

        _getEnabledEntries() {
            if (!_currentPreset) {
                Logger.warn('快照捕获时preset 对象为 null，已跳过 enabledEntries 记录');
                return [];
            }

            try {
                if (_currentPreset.prompts && Array.isArray(_currentPreset.prompts)) {
                    return _currentPreset.prompts
                        .filter(p => p.enabled !== false)
                        .map(p => p.name || p.identifier || '未命名条目');
                }

                if (_currentPreset.prompt_order && Array.isArray(_currentPreset.prompt_order)) {
                    return _currentPreset.prompt_order
                        .filter(p => p.enabled !== false)
                        .map(p => p.identifier || '未命名条目');
                }

                return [];
            } catch (err) {
                Logger.error('提取 enabledEntries 失败', err);
                return [];
            }
        },

        getAll() {
            return Storage.getSnapshots();
        },

        delete(id) {
            const data = Storage.getAll();
            const idx = data.snapshots.findIndex(s => s.id === id);
            if (idx === -1) return false;
            data.snapshots.splice(idx, 1);
            Storage.save();
            Logger.info(`删除快照 — ID: ${id}`);
            FloatingPanel.refreshSnapshots();
            return true;
        },

        updateNote(id, note) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.note = note;
            Storage.save();
            return true;
        },

        updateRating(id, stars) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.rating = stars;
            Storage.save();
            Logger.info(`快照评分更新 — ID: ${id}, 评分: ${stars}星`);
            return true;
        },

        updateRatingNote(id, ratingNote) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.ratingNote = ratingNote;
            Storage.save();
            return true;
        },

        diff(idA, idB) {
            const snapA = Storage.getSnapshots().find(s => s.id === idA);
            const snapB = Storage.getSnapshots().find(s => s.id === idB);
            if (!snapA || !snapB) return null;

            const entriesA = new Set(snapA.enabledEntries);
            const entriesB = new Set(snapB.enabledEntries);

            const added = [...entriesB].filter(e => !entriesA.has(e));
            const removed = [...entriesA].filter(e => !entriesB.has(e));
            const unchanged = [...entriesA].filter(e => entriesB.has(e));

            return {
                snapA,
                snapB,
                modelChanged: snapA.model !== snapB.model,
                sourceChanged: snapA.apiSource !== snapB.apiSource,
                presetChanged: snapA.presetName !== snapB.presetName,
                entries: { added, removed, unchanged },
            };
        },

        hasChanged() {
            const snaps = Storage.getSnapshots();
            if (snaps.length === 0) return false;

            const last = snaps[0];
            return (
                (_currentPresetName && _currentPresetName !== last.presetName) ||
                (_currentModel && _currentModel !== last.model)
            );
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 5: 事件桥接EventBridge                           │
    // └─────────────────────────────────────────────────────────┘

    const EventBridge = {
        _handlers: [],

        init() {
            try {
                const eventSource = window.eventSource || (typeof SillyTavern !== 'undefined' && SillyTavern.eventSource);
                const eventTypes = window.event_types || (typeof SillyTavern !== 'undefined' && SillyTavern.event_types);

                if (!eventSource || !eventTypes) {
                    Logger.warn('未找到 SillyTavern 事件系统，快照功能将不可用');
                    return;
                }

                const listen = (eventName, handler) => {
                    if (eventTypes[eventName] !== undefined) {
                        eventSource.on(eventTypes[eventName], handler);
                this._handlers.push({ event: eventTypes[eventName], handler, source: eventSource });
                    } else {
                        Logger.warn(`事件 ${eventName} 未在 event_types 中找到`);
                    }
                };

                listen('PRESET_CHANGED', (data) => {
                    if (data && data.name) {
                        _currentPresetName = data.name;
                        Logger.info(`事件触发: PRESET_CHANGED → { name: "${data.name}" }`);this._checkChanged();
                    }
                });

                listen('OAI_PRESET_CHANGED_BEFORE', (result) => {
                    if (result) {
                        _currentPresetName = result.presetName || _currentPresetName;
                        _currentPreset = result.preset || null;
                        const entryCount = _currentPreset?.prompts?.length || '未知';
                        Logger.info(`事件触发: OAI_PRESET_CHANGED_BEFORE → 预设含${entryCount}个条目`);
                        this._checkChanged();
                    }
                });

                listen('CHATCOMPLETION_MODEL_CHANGED', (model) => {
                    if (model) {
                        _currentModel = model;
                        Logger.info(`事件触发: CHATCOMPLETION_MODEL_CHANGED → "${model}"`);
                        this._checkChanged();
                    }
                });

                listen('CHATCOMPLETION_SOURCE_CHANGED', (source) => {
                    if (source) {
                        _currentSource = source;
                        Logger.info(`事件触发: CHATCOMPLETION_SOURCE_CHANGED → "${source}"`);
                }
                });

                listen('CHARACTER_MESSAGE_RENDERED', (msgId) => {
                    Logger.info(`事件触发: CHARACTER_MESSAGE_RENDERED → 消息 #${msgId}`);
                });

                listen('SETTINGS_LOADED_AFTER', () => {
                    Logger.info('事件触发: SETTINGS_LOADED_AFTER →酒馆设置已加载');
                });

                const registeredCount = this._handlers.length;
                Logger.success(`事件监听器已注册 (${registeredCount}个)`);
            } catch (err) {
                Logger.error('事件桥接初始化失败', err);
            }
        },

        _checkChanged() {
            const changed = SnapshotEngine.hasChanged();
            FloatingBall.setChanged(changed);
            if (changed) {
                const snaps = Storage.getSnapshots();
                const last = snaps[0];
                const parts = [];
                if (_currentPresetName && _currentPresetName !== last.presetName) {
                    parts.push(`预设: ${last.presetName}→${_currentPresetName}`);
                }
                if (_currentModel && _currentModel !== last.model) {
                    parts.push(`模型: ${last.model}→${_currentModel}`);
                }
                Logger.info(`环境变更检测 — ${parts.join(', ') || '已变更'}`);
            }
        },

        destroy() {
            this._handlers.forEach(({ event, handler, source }) => {
                try {
                    source.off(event, handler);
                } catch (e) { /* ignore */ }
            });
            this._handlers = [];
            Logger.info('事件监听器已全部移除');
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 6: UI —悬浮球 FloatingBall                       │
    // └─────────────────────────────────────────────────────────┘

    const FloatingBall = {
        _isDragging: false,
        _startX: 0,
        _startY: 0,
        _startRight: 0,
        _startBottom: 0,
        _moved: false,

        create() {
            if (fabEl) return;

            fabEl = document.createElement('div');
            fabEl.id = 'promptlens-fab';

            fabEl.innerHTML = `
                <span class="promptlens-fab-icon">📓</span>
                <span class="promptlens-fab-badge"></span>
            `;

            const pos = Storage.getSettings().fabPos || FAB_DEFAULT_POS;
            fabEl.style.right = pos.right + 'px';
            fabEl.style.bottom = pos.bottom + 'px';

            fabEl.addEventListener('mousedown', (e) => this._onDragStart(e));
            fabEl.addEventListener('touchstart', (e) => this._onDragStart(e), { passive: false });

            document.body.appendChild(fabEl);
            Logger.success(`悬浮球已创建，位置: right=${pos.right}, bottom=${pos.bottom}`);
        },

        destroy() {
            if (fabEl) {
                fabEl.remove();
                fabEl = null;
                Logger.info('悬浮球已移除');
            }
        },

        setChanged(bool) {
            if (!fabEl) return;
            const badge = fabEl.querySelector('.promptlens-fab-badge');
            if (badge) {
                badge.classList.toggle('active', bool);
            }
        },

        _onDragStart(e) {
            e.preventDefault();
            this._isDragging = true;
            this._moved = false;

            const touch = e.touches ? e.touches[0] : e;
            this._startX = touch.clientX;
            this._startY = touch.clientY;

            const rect = fabEl.getBoundingClientRect();
            this._startRight = window.innerWidth - rect.right;
            this._startBottom = window.innerHeight - rect.bottom;

            const onMove = (ev) => {
                const t = ev.touches ? ev.touches[0] : ev;
                const dx = t.clientX - this._startX;
                const dy = t.clientY - this._startY;

                if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                    this._moved = true;
                }

                if (this._moved) {
                    let newRight = this._startRight - dx;
                    let newBottom = this._startBottom + dy;

                    newRight = Math.max(0, Math.min(window.innerWidth - 48, newRight));
                    newBottom = Math.max(0, Math.min(window.innerHeight - 48, newBottom));

                    fabEl.style.right = newRight + 'px';
                    fabEl.style.bottom = newBottom + 'px';fabEl.style.left = 'auto';
                    fabEl.style.top = 'auto';
                }
            };

            const onEnd = () => {
                this._isDragging = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);

                if (this._moved) {
                    const newPos = {
                        right: parseInt(fabEl.style.right),
                        bottom: parseInt(fabEl.style.bottom),
                    };
                    Storage.updateSettings({ fabPos: newPos });
                } else {
                    FloatingPanel.toggle();
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 7: UI — 浮动面板 FloatingPanel                    │
    // └─────────────────────────────────────────────────────────┘

    const FloatingPanel = {
        _isDragging: false,
        _startX: 0,
        _startY: 0,
        _startLeft: 0,
        _startTop: 0,
        _moved: false,

        create() {
            if (panelEl) return;

            panelEl = document.createElement('div');
            panelEl.id = 'promptlens-panel';

            panelEl.innerHTML = `
                <div class="promptlens-panel-titlebar" id="promptlens-panel-titlebar">
                    <div class="promptlens-panel-title">
                        <span class="promptlens-panel-title-dot"></span>
                        <span>${DISPLAY_NAME}</span>
                    </div>
                    <div class="promptlens-panel-tabs">
                        <button class="promptlens-panel-tab active" data-tab="notes">笔记</button>
                        <button class="promptlens-panel-tab" data-tab="snapshots">快照</button></div>
                    <div class="promptlens-panel-controls">
                        <button class="promptlens-panel-ctrl-btn minimize" title="最小化">─</button>
                        <button class="promptlens-panel-ctrl-btn close" title="关闭">✕</button>
                    </div>
                </div>

                <div class="promptlens-panel-toolbar">
                    <div class="promptlens-search-wrap">
                        <span class="promptlens-search-icon">🔍</span>
                        <input type="text" class="promptlens-search-input" placeholder="搜索笔记..." />
                    </div>
                    <button class="promptlens-toolbar-btn" id="promptlens-add-note">+ 新建</button>
                </div>

                <div class="promptlens-panel-tags" id="promptlens-tag-bar"></div>

                <div class="promptlens-panel-content" id="promptlens-content">
                    <div class="promptlens-empty-state">
                        <div class="promptlens-empty-state-icon">📓</div>
                        <div class="promptlens-empty-state-text">
                            还没有笔记<br/><span style="color:#666;font-size:12px;">选中聊天文字即可收藏，或点击"+ 新建"手动添加</span>
                        </div>
                    </div>
                </div>

                <div class="promptlens-panel-statusbar">
                    <div class="promptlens-panel-statusbar-left">
                        <span class="promptlens-panel-statusbar-dot"></span>
                        <span id="promptlens-statusbar-text">就绪</span>
                    </div>
                    <span id="promptlens-statusbar-count">共 0 条笔记 · 0 个快照</span>
                </div>
            `;

            const savedPos = Storage.getSettings().panelPos;
            if (savedPos) {
                panelEl.style.left = savedPos.left + 'px';
                panelEl.style.top = savedPos.top + 'px';
            } else {
                panelEl.style.left = (window.innerWidth - 440) + 'px';
                panelEl.style.top = '100px';
            }

            document.body.appendChild(panelEl);

            this._bindEvents();
            this._renderTagBar();
            this._updateStatusBar();

            Logger.success('浮动面板已创建');
        },

        _bindEvents() {
            if (!panelEl) return;

            const titlebar = panelEl.querySelector('#promptlens-panel-titlebar');
            titlebar.addEventListener('mousedown', (e) => this._onDragStart(e));
            titlebar.addEventListener('touchstart', (e) => this._onDragStart(e), { passive: false });

            panelEl.querySelectorAll('.promptlens-panel-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    this.switchTab(tab.dataset.tab);
                });
            });

            panelEl.querySelector('.minimize').addEventListener('click', () => {
                this.hide();
            });

            panelEl.querySelector('.close').addEventListener('click', () => {
                this.hide();
            });

            const searchInput = panelEl.querySelector('.promptlens-search-input');
            let searchTimer = null;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => {
                    currentSearchKeyword = searchInput.value;
                    this._renderContent();
                }, 200);
            });

            panelEl.querySelector('#promptlens-add-note').addEventListener('click', () => {
                this.showNewNoteForm();
            });
        },

        show() {
            if (!panelEl) return;
            panelEl.classList.add('visible');
            panelVisible = true;
            this._renderContent();
            this._updateStatusBar();
        },

        hide() {
            if (!panelEl) return;
            panelEl.classList.remove('visible');
            panelVisible = false;
        },

        toggle() {
            if (panelVisible) {
                this.hide();
            } else {
                this.show();
            }
        },

        destroy() {
            if (panelEl) {
                panelEl.remove();
                panelEl = null;
                panelVisible = false;
                Logger.info('浮动面板已移除');
            }
        },

        switchTab(tabName) {
            currentTab = tabName;
            if (!panelEl) return;

            panelEl.querySelectorAll('.promptlens-panel-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.tab === tabName);
            });

            const searchInput = panelEl.querySelector('.promptlens-search-input');
            searchInput.placeholder = tabName === 'notes' ? '搜索笔记...' : '搜索快照...';

            const addBtn = panelEl.querySelector('#promptlens-add-note');
            if (tabName === 'notes') {
                addBtn.textContent = '+ 新建';
            } else {
                addBtn.textContent = '📸 快照';
            }

            this._renderContent();
        },

        refreshNotes() {
            if (currentTab === 'notes') this._renderContent();
            this._updateStatusBar();
        },

        refreshSnapshots() {
            if (currentTab === 'snapshots') this._renderContent();
            this._updateStatusBar();
        },

        _renderContent() {
            if (!panelEl) return;
            const container = panelEl.querySelector('#promptlens-content');
            if (!container) return;

            if (currentTab === 'notes') {
                this._renderNotesList(container);
            } else {
                this._renderSnapshotsList(container);
            }
        },

        _renderNotesList(container) {
            const notes = NoteManager.filter({
                keyword: currentSearchKeyword,
                tag: currentFilterTag,
            });

            if (notes.length === 0) {
                const isFiltered = currentSearchKeyword || currentFilterTag;
                container.innerHTML = `
                    <div class="promptlens-empty-state">
                        <div class="promptlens-empty-state-icon">${isFiltered ? '🔍' : '📓'}</div>
                        <div class="promptlens-empty-state-text">
                            ${isFiltered ? '没有找到匹配的笔记' : '还没有笔记'}<br/>
                            <span style="color:#666;font-size:12px;">
                                ${isFiltered ? '试试其他关键词或标签' : '选中聊天文字即可收藏，或点击"+ 新建"手动添加'}
                            </span>
                        </div>
                    </div>
                `;return;
            }

            container.innerHTML = notes.map(note => this._renderNoteCard(note)).join('');

            container.querySelectorAll('.promptlens-note-card').forEach(card => {
                const noteId = card.dataset.id;

                card.querySelector('.promptlens-card-copy')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    NoteManager.copyToClipboard(noteId);
                    const btn = e.currentTarget;
                    btn.textContent = '✓';
                    btn.style.color = '#27ae60';
                    setTimeout(() => {
                        btn.textContent = '📋';
                        btn.style.color = '';
                    }, 1200);
                });

                card.querySelector('.promptlens-card-delete')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这条笔记？')) {
                        NoteManager.delete(noteId);
                }
                });
            });
        },

        _renderNoteCard(note) {
            const time = new Date(note.createdAt).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });
            const tags = (note.tags || []).map(t =>
                `<span class="promptlens-card-tag">${this._escapeHtml(t)}</span>`
            ).join('');
            const floor = note.sourceFloor != null ? `📍楼层 #${note.sourceFloor} · ` : '';

            return `
                <div class="promptlens-note-card" data-id="${note.id}">
                    <div class="promptlens-card-content">${this._escapeHtml(note.content)}</div>
                    <div class="promptlens-card-meta">
                        <span class="promptlens-card-source">${floor}${time}</span>
                    </div>
                    ${tags ? `<div class="promptlens-card-tags">${tags}</div>` : ''}
                <div class="promptlens-card-actions">
                        <button class="promptlens-card-copy" title="复制内容">📋</button>
                        <button class="promptlens-card-delete" title="删除">🗑️</button>
                    </div>
                </div>
            `;
        },

        _renderSnapshotsList(container) {
            let snapshots = SnapshotEngine.getAll();

            if (currentSearchKeyword) {
                const kw = currentSearchKeyword.toLowerCase();
                snapshots = snapshots.filter(s =>
                    s.presetName.toLowerCase().includes(kw) ||
                    s.model.toLowerCase().includes(kw) ||
                    (s.note && s.note.toLowerCase().includes(kw))
                );
            }

            if (snapshots.length === 0) {
                container.innerHTML = `
                    <div class="promptlens-empty-state">
                        <div class="promptlens-empty-state-icon">📸</div>
                        <div class="promptlens-empty-state-text">
                            还没有快照<br/>
                            <span style="color:#666;font-size:12px;">点击"📸 快照"按钮捕获当前预设状态</span>
                        </div>
                    </div>
                `;
                return;
            }

            container.innerHTML = snapshots.map(snap => this._renderSnapshotCard(snap)).join('');

            container.querySelectorAll('.promptlens-snapshot-card').forEach(card => {
                const snapId = card.dataset.id;

                card.querySelector('.promptlens-card-delete')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这个快照？')) {
                        SnapshotEngine.delete(snapId);
                    }
                });

                card.querySelectorAll('.promptlens-star').forEach(star => {
                    star.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const rating = parseInt(star.dataset.rating);
                        SnapshotEngine.updateRating(snapId, rating);this._renderContent();
                    });
                });
            });
        },

        _renderSnapshotCard(snap) {
            const time = new Date(snap.timestamp).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });

            const entries = snap.enabledEntries || [];
            const entryDisplay = entries.length > 3
                ? entries.slice(0, 3).join(', ') + ` +${entries.length - 3}`
                : entries.join(',') || '无记录';

            const stars = [1, 2, 3, 4, 5].map(i =>
                `<span class="promptlens-star ${i <= (snap.rating || 0) ? 'filled' : ''}" data-rating="${i}">★</span>`
            ).join('');

            return `
                <div class="promptlens-snapshot-card" data-id="${snap.id}">
                    <div class="promptlens-snap-header">
                        <span class="promptlens-snap-icon">📸</span>
                        <span class="promptlens-snap-preset">${this._escapeHtml(snap.presetName)}</span></div>
                    <div class="promptlens-snap-info">
                        模型: ${this._escapeHtml(snap.model)} · API: ${this._escapeHtml(snap.apiSource)}
                    </div>
                    <div class="promptlens-snap-entries">
                        条目: ${this._escapeHtml(entryDisplay)}
                    </div>
                    <div class="promptlens-snap-rating">
                        <span class="promptlens-stars">${stars}</span>
                ${snap.note ? `<span class="promptlens-snap-note">"${this._escapeHtml(snap.note)}"</span>` : ''}
                    </div>
                    <div class="promptlens-card-meta">
                        <span class="promptlens-card-source">${time}</span>
                    </div>
                    <div class="promptlens-card-actions">
                        <button class="promptlens-card-delete" title="删除">🗑️</button>
                    </div>
                </div>
            `;
        },

        _renderTagBar() {
            if (!panelEl) return;
            const tagBar = panelEl.querySelector('#promptlens-tag-bar');
            if (!tagBar) return;

            const tags = Storage.getTags();

            let html = `<span class="promptlens-tag-chip ${!currentFilterTag ? 'active' : ''}" data-tag="">全部</span>`;
            tags.forEach(tag => {
                html += `<span class="promptlens-tag-chip ${currentFilterTag === tag ? 'active' : ''}" data-tag="${this._escapeHtml(tag)}">${this._escapeHtml(tag)}</span>`;
            });
            html += `<span class="promptlens-tag-chip add-tag" id="promptlens-add-tag">+ 标签</span>`;

            tagBar.innerHTML = html;

            tagBar.querySelectorAll('.promptlens-tag-chip:not(.add-tag)').forEach(chip => {
                chip.addEventListener('click', () => {
                    const tag = chip.dataset.tag;
                    currentFilterTag = tag || null;
                    this._renderTagBar();
                    this._renderContent();
                });
            });

            tagBar.querySelector('#promptlens-add-tag')?.addEventListener('click', () => {
                const name = prompt('输入新标签名称:');
                if (name && name.trim()) {
                    const trimmed = name.trim();
                    const data = Storage.getAll();
                    if (!data.tags.includes(trimmed)) {
                        data.tags.push(trimmed);
                        Storage.save();
                        Logger.info(`新增标签: ${trimmed}`);
                        this._renderTagBar();
                }
                }
            });
        },

        showNewNoteForm() {
            if (currentTab === 'snapshots') {
                const note = prompt('为这个快照添加备注（可留空）:');
                if (note !== null) {
                    SnapshotEngine.capture(note);
                }
                return;
            }

            const content = prompt('输入笔记内容:');
            if (content && content.trim()) {
                NoteManager.add({ content: content.trim() });
            }
        },

        _updateStatusBar() {
            if (!panelEl) return;
            const countEl = panelEl.querySelector('#promptlens-statusbar-count');
            if (countEl) {
                const noteCount = Storage.getNotes().length;
                const snapCount = Storage.getSnapshots().length;
                countEl.textContent = `共 ${noteCount} 条笔记 · ${snapCount} 个快照`;
            }
        },

        _onDragStart(e) {
            if (e.target.closest('button') || e.target.closest('input')) return;

            e.preventDefault();
            this._isDragging = true;
            this._moved = false;

            const touch = e.touches ? e.touches[0] : e;
            this._startX = touch.clientX;
            this._startY = touch.clientY;
            this._startLeft = panelEl.offsetLeft;
            this._startTop = panelEl.offsetTop;

            const onMove = (ev) => {
                const t = ev.touches ? ev.touches[0] : ev;
                const dx = t.clientX - this._startX;
                const dy = t.clientY - this._startY;

                if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                    this._moved = true;
                }

                if (this._moved) {
                    let newLeft = this._startLeft + dx;
                    let newTop = this._startTop + dy;

                    newLeft = Math.max(0, Math.min(window.innerWidth - 100, newLeft));
                    newTop = Math.max(0, Math.min(window.innerHeight - 50, newTop));

                    panelEl.style.left = newLeft + 'px';
                    panelEl.style.top = newTop + 'px';panelEl.style.right = 'auto';
                    panelEl.style.bottom = 'auto';
                }
            };

            const onEnd = () => {
                this._isDragging = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);

                if (this._moved) {
                    Storage.updateSettings({
                        panelPos: {
                            left: parseInt(panelEl.style.left),
                            top: parseInt(panelEl.style.top),
                        },
                    });
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        },

        _escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE8: UI — 选中收藏气泡 SaveBubble                │
    // └─────────────────────────────────────────────────────────┘

    const SaveBubble = {
        _bubbleEl: null,
        _hideTimer: null,

        init() {
            document.addEventListener('mouseup', (e) => {
                if (panelEl && panelEl.contains(e.target)) return;
                if (fabEl && fabEl.contains(e.target)) return;
                if (this._bubbleEl && this._bubbleEl.contains(e.target)) return;

                setTimeout(() => {
                    const selection = window.getSelection();
                    const text = selection ? selection.toString().trim() : '';

                    if (text && text.length > 1) {
                        const floorInfo = this._getFloorInfo(selection);
                        this.show(text, e.clientX, e.clientY, floorInfo);
                    } else {
                        this.hide();
                    }
                }, 10);
            });

            Logger.success('选中收藏监听已启用');
        },

        _getFloorInfo(selection) {
            try {
                if (!selection || !selection.anchorNode) return null;

                let node = selection.anchorNode;
                if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;

                const msgEl = node.closest('.mes[mesid]');
                if (msgEl) {
                    const mesId = msgEl.getAttribute('mesid');
                    return {
                        floor: parseInt(mesId),
                        messageId: mesId,
                    };
                }return null;
            } catch (e) {
                return null;
            }
        },

        show(text, x, y, floorInfo) {
            this.hide();

            this._bubbleEl = document.createElement('div');
            this._bubbleEl.id = 'promptlens-save-bubble';
            this._bubbleEl.style.cssText = `
                position: fixed;
                z-index: 10002;
                left: ${Math.min(x, window.innerWidth - 160)}px;
                top: ${Math.max(y - 40, 10)}px;
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 14px;
                background: #1a1a1a;
                border: 1px solid rgba(192, 57, 43, 0.5);
                border-radius: 8px;
                color: #e74c3c;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                animation: promptlens-bubble-in 0.15s ease;
                user-select: none;
                white-space: nowrap;
            `;
            this._bubbleEl.innerHTML = '📓收藏到掠影';

            this._bubbleEl.addEventListener('click', () => {
                NoteManager.add({
                    content: text,
                    sourceFloor: floorInfo ? floorInfo.floor : null,
                    sourceMessageId: floorInfo ? floorInfo.messageId : null,
                });

                this._bubbleEl.innerHTML = '✓ 已收藏';
                this._bubbleEl.style.color = '#27ae60';
                this._bubbleEl.style.borderColor = 'rgba(39, 174, 96, 0.5)';
                this._bubbleEl.style.cursor = 'default';

                setTimeout(() => this.hide(), 1000);
            });

            document.body.appendChild(this._bubbleEl);

            clearTimeout(this._hideTimer);
            this._hideTimer = setTimeout(() => this.hide(), 3000);
        },

        hide() {
            clearTimeout(this._hideTimer);
            if (this._bubbleEl) {
                this._bubbleEl.remove();
                this._bubbleEl = null;
            }
        },
    };

    // ┌─────────────────────────────────────────────────────────┐
    // │  辅助函数                                                │
    // └─────────────────────────────────────────────────────────┘

    function updateSettingsStats() {
        const noteStatEl = document.querySelector('#promptlens-stat-notes');
        const snapStatEl = document.querySelector('#promptlens-stat-snapshots');

        if (noteStatEl) {
            noteStatEl.innerHTML = `笔记:<strong>${Storage.getNotes().length}</strong> 条`;
        }
        if (snapStatEl) {
            snapStatEl.innerHTML = `快照: <strong>${Storage.getSnapshots().length}</strong> 条`;
        }
    }

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 9: 配置面板注入+ 主入口                          │
    // └─────────────────────────────────────────────────────────┘

    //★★★ 核心修复：手动 fetch settings.html 并注入到 Extensions 面板 ★★★
    async function loadSettingsPanel() {
        try {
            //★ 加载 settings.html
            const response = await fetch(`/${EXTENSION_PATH}/settings.html`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const html = await response.text();

            // ★ 加载 settings.css
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = `/${EXTENSION_PATH}/settings.css`;
            document.head.appendChild(cssLink);

            // ★ 找到 ST的 Extensions 设置容器并注入
            // ST 1.15的容器选择器，按优先级尝试多个
            const containerSelectors = [
                '#extensions_settings',          // 标准容器
                '#extensions_settings2',         // 备选
                '.extensions_block',// 另一种布局
            ];

            let container = null;
            for (const selector of containerSelectors) {
                container = document.querySelector(selector);
                if (container) break;
            }

            if (!container) {
                // ★ 如果找不到标准容器，等待 ST 加载完成后重试
                Logger.warn('Extensions 面板容器未找到，将在 2 秒后重试...');
                await new Promise(resolve => setTimeout(resolve, 2000));

                for (const selector of containerSelectors) {
                    container = document.querySelector(selector);
                    if (container) break;
                }
            }

            if (!container) {
                Logger.error('Extensions 面板容器始终未找到，配置面板无法注入');
                return false;
            }

            // ★ 创建插件专属容器并注入
            const wrapper = document.createElement('div');
            wrapper.id = 'promptlens-extension-block';
            wrapper.classList.add('extension_container');  // ST 标准 class
            wrapper.innerHTML = html;
            container.appendChild(wrapper);

            Logger.success('配置面板已注入到 Extensions 设置区域');
            return true;

        } catch (err) {
            Logger.error('配置面板加载失败', err);

            // ★ 降级方案：直接用 JS 创建一个最小化的设置面板
            Logger.info('尝试使用内联降级方案创建配置面板...');
            createFallbackSettingsPanel();
            return false;
        }
    }

    // ★ 降级方案：如果 fetch 失败，用纯 JS 创建面板
    function createFallbackSettingsPanel() {
        const containerSelectors = [
            '#extensions_settings',
            '#extensions_settings2',
            '.extensions_block',
        ];

        let container = null;
        for (const selector of containerSelectors) {
            container = document.querySelector(selector);
            if (container) break;
        }

        if (!container) {
            Logger.error('降级方案也无法找到容器，配置面板不可用');
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'promptlens-extension-block';
        wrapper.classList.add('extension_container');
        wrapper.innerHTML = `
            <div id="promptlens-settings-wrap" class="promptlens-settings" style="padding:12px 4px;color:#ccc;">
                <div style="margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:600;">
                        <span style="font-size:18px;">📓</span>
                        <span style="color:#e74c3c;">PromptLens ·掠影</span>
                        <span style="font-size:11px;color:#888;background:rgba(255,255,255,0.06);padding:1px 7px;border-radius:8px;">v${VERSION}</span>
                    </div>
                    <div style="font-size:12px;color:#777;margin-top:3px;font-style:italic;">by Shadow — 预设工程师的读书笔记插件</div>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;">
                    <label style="font-size:13px;font-weight:500;">启用插件</label>
                    <label style="position:relative;display:inline-block;width:42px;height:22px;cursor:pointer;">
                        <input type="checkbox" id="promptlens-toggle" checked style="opacity:0;width:0;height:0;" />
                        <span style="position:absolute;inset:0;background:#333;border-radius:22px;transition:background 0.25s;"></span>
                    </label>
                </div>
                                <!-- ★ 悬浮球开关 -->
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;">
                    <label style="font-size:13px;font-weight:500;">显示悬浮球</label>
                    <label style="position:relative;display:inline-block;width:42px;height:22px;cursor:pointer;">
                        <input type="checkbox" id="promptlens-fab-toggle" checked style="opacity:0;width:0;height:0;" />
                        <span style="position:absolute;inset:0;background:#333;border-radius:22px;transition:background 0.25s;"></span>
                    </label>
                </div>

                <div style="padding:8px 0;">
                    <button id="promptlens-open-panel" style="width:100%;padding:9px 0;border:none;border-radius:8px;background:#c0392b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
                        🔴 打开掠影面板
                    </button>
                </div>

                <div style="height:1px;background:rgba(255,255,255,0.06);margin:12px 0;"></div>

                <div>
                    <div style="font-size:12px;font-weight:600;color:#999;margin-bottom:8px;">运行日志</div>
                    <div id="promptlens-log-container" style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;max-height:220px;min-height:80px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.7;"><div class="promptlens-log-empty" style="color:#555;text-align:center;padding:16px 0;font-style:italic;">暂无日志</div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        <button id="promptlens-log-clear" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">清空日志</button>
                        <button id="promptlens-log-copy" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">复制日志</button>
                    </div>
                </div>

                <div style="height:1px;background:rgba(255,255,255,0.06);margin:12px 0;"></div>

                <div>
                    <div style="font-size:12px;font-weight:600;color:#999;margin-bottom:8px;">数据管理</div>
                    <div style="font-size:13px;color:#999;margin-bottom:10px;">
                        <span id="promptlens-stat-notes">笔记: <strong style="color:#e74c3c;">0</strong> 条</span>
                        <span style="margin:0 8px;color:#444;">·</span>
                        <span id="promptlens-stat-snapshots">快照: <strong style="color:#e74c3c;">0</strong> 条</span>
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <button id="promptlens-export" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">导出数据</button>
                        <button id="promptlens-import" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">导入数据</button>
                <button id="promptlens-clear-all" style="padding:5px 12px;border:1px solid rgba(231,76,60,0.25);border-radius:6px;background:rgba(255,255,255,0.04);color:#e74c3c;font-size:12px;cursor:pointer;">⚠ 清空所有数据</button>
                        <input type="file" id="promptlens-import-file" accept=".json" style="display:none;" />
                    </div>
                </div>
            </div>
        `;

        container.appendChild(wrapper);
        Logger.success('配置面板已通过降级方案创建');
    }

        function bindSettingsEvents() {
        // ★ 折叠/展开功能
        const collapseToggle = document.querySelector('#promptlens-collapse-toggle');
        const collapseBody = document.querySelector('#promptlens-settings-body');
        const collapseArrow = document.querySelector('#promptlens-collapse-arrow');

        if (collapseToggle && collapseBody && collapseArrow) {
            // 读取折叠状态
            const isCollapsed = Storage.getSettings().settingsCollapsed === true;
            if (isCollapsed) {
                collapseBody.classList.add('collapsed');
                collapseArrow.classList.add('collapsed');
            }

            collapseToggle.addEventListener('click', () => {
                const nowCollapsed = collapseBody.classList.toggle('collapsed');
                collapseArrow.classList.toggle('collapsed', nowCollapsed);
                Storage.updateSettings({ settingsCollapsed: nowCollapsed });
            });
        }

        // 启用开关
        const toggle = document.querySelector('#promptlens-toggle');
        if (toggle) {
            toggle.checked = Storage.getSettings().enabled !== false;
            toggle.addEventListener('change', () => {
                const enabled = toggle.checked;
                Storage.updateSettings({ enabled });if (enabled) {
                    pluginEnabled = true;
                    init();
                    Logger.success('插件已重新启用');
                } else {
                    pluginEnabled = false;
                    shutdown();
                }
            });
        }

        // ★ 悬浮球开关
        const fabToggle = document.querySelector('#promptlens-fab-toggle');
        if (fabToggle) {
            fabToggle.checked = Storage.getSettings().fabVisible !== false;
            fabToggle.addEventListener('change', () => {
                const visible = fabToggle.checked;
                Storage.updateSettings({ fabVisible: visible });
                if (visible) {
                    FloatingBall.create();
                    Logger.info('悬浮球已显示');
                } else {
                    FloatingBall.destroy();
                    Logger.info('悬浮球已隐藏');
                }
            });
        }

        // 打开面板按钮
        const openBtn = document.querySelector('#promptlens-open-panel');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                if (!pluginEnabled) {
                    Logger.warn('插件未启用，请先打开启用开关');
                    return;
                }
                FloatingPanel.show();
            });
        }

        // 日志清空
        const logClear = document.querySelector('#promptlens-log-clear');
        if (logClear) {
            logClear.addEventListener('click', () => Logger.clear());
        }

        // 日志复制
        const logCopy = document.querySelector('#promptlens-log-copy');
        if (logCopy) {
            logCopy.addEventListener('click', () => Logger.copyAll());
        }

        // 导出
        const exportBtn = document.querySelector('#promptlens-export');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => Storage.exportJSON());
        }

        // 导入
        const importBtn = document.querySelector('#promptlens-import');
        const importFile = document.querySelector('#promptlens-import-file');
        if (importBtn && importFile) {
            importBtn.addEventListener('click', () => importFile.click());
            importFile.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    Storage.importJSON(file).then(() => {
                        FloatingPanel.refreshNotes();
                        FloatingPanel.refreshSnapshots();
                        FloatingPanel._renderTagBar();
                    }).catch(() => {});importFile.value = '';
                }
            });
        }

        // 清空所有数据
        const clearBtn = document.querySelector('#promptlens-clear-all');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('⚠ 确定要清空所有 PromptLens 数据吗？\n此操作不可撤销！')) {
                    if (confirm('再次确认：真的要删除所有笔记和快照吗？')) {
                        Storage.clearAll();
                        FloatingPanel.refreshNotes();
                        FloatingPanel.refreshSnapshots();
                        FloatingPanel._renderTagBar();
                    }
                }
            });
        }

        // 更新统计
        updateSettingsStats();

        // 把之前缓冲的日志重新渲染到刚注入的容器里
        logContainerEl = document.querySelector('#promptlens-log-container');
        Logger._renderAll();
    }
    // ═══ bindSettingsEvents 结束 ═══

    // ★ 主初始化
       function init() {
        const startTime = performance.now();
        Logger.info(`${PLUGIN_NAME} v${VERSION} 初始化开始...`);

        Storage.load();

        const settings = Storage.getSettings();
        pluginEnabled = settings.enabled !== false;

        if (!pluginEnabled) {
            Logger.info('插件已禁用，跳过初始化');
            return;
        }

        EventBridge.init();

        //★ 根据设置决定是否显示悬浮球
        if (settings.fabVisible !== false) {
            FloatingBall.create();
        } else {
            Logger.info('悬浮球已设置为隐藏');
        }

        FloatingPanel.create();
        SaveBubble.init();

        if (SnapshotEngine.hasChanged()) {
            FloatingBall.setChanged(true);
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        Logger.success(`插件初始化完成，耗时 ${elapsed}ms`);
    }
    // ═══ init 结束 ═══

    
    // ┌─────────────────────────────────────────────────────────┐
    // │  启动                │
    // └─────────────────────────────────────────────────────────┘

    // ★★★ 修复后的启动流程 ★★★
    if (typeof jQuery !== 'undefined') {
        jQuery(async () => {
            //1. 先注入配置面板到 Extensions 区域
            await loadSettingsPanel();

            // 2. 绑定配置面板事件（此时 DOM 已存在）
            bindSettingsEvents();

            // 3. 初始化插件主体
            init();
        });
    } else {
        document.addEventListener('DOMContentLoaded', async () => {
            await loadSettingsPanel();
            bindSettingsEvents();
            init();
        });
    }

})();




