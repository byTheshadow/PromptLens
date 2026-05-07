//═══════════════════════════════════════════════════════════════
//  PromptLens · 掠影 v1.0.0
//  by Shadow —预设工程师的读书笔记插件
//  SillyTavern Extension
// ═══════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE0: 常量 & 配置                                  │
    // └─────────────────────────────────────────────────────────┘

    const PLUGIN_NAME = 'PromptLens';
    const DISPLAY_NAME = '掠影';
    const VERSION = '1.0.0';
    const STORAGE_KEY = 'PromptLens_data';
    const LOG_MAX = 200;
    const FAB_DEFAULT_POS = { right: 20, bottom: 80 };
    const DEFAULT_TAGS = ['八股文', '越狱', '人设技巧', '写作手法', '系统提示', '思维链'];
    const DRAG_THRESHOLD = 5;

    // ★ 关键：ST 插件路径，用于 fetch settings.html
    const EXTENSION_PATH = 'scripts/extensions/third-party/PromptLens';

    // 内部状态
    let pluginEnabled = true;
    let panelVisible = false;
    let currentTab = 'notes';
    let currentFilterTag = null;
    let currentSearchKeyword = '';
    let diffSelectingId = null;    // ★ 快照对比：第一个选中的快照 ID，null=未在选择模式
    


    // 快照引擎追踪状态
    let _currentModel = '';
    let _currentSource = '';
    let _currentPresetName = '';
    let _currentPreset = null;

    // DOM 引用缓存
    let fabEl = null;
    let panelEl = null;
    let logContainerEl = null;

    // ═══ MODULE 0 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 1: 日志系统 Logger│
    // └─────────────────────────────────────────────────────────┘

    const Logger = {
        _logs: [],

        /** 格式化当前时间为HH:MM:SS */
        _formatTime() {
            const d = new Date();
            return [
                String(d.getHours()).padStart(2, '0'),
                String(d.getMinutes()).padStart(2, '0'),
                String(d.getSeconds()).padStart(2, '0'),
            ].join(':');
        },

        /** 获取日志级别对应的图标 */
        _levelIcon(level) {
            const map = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌' };
            return map[level] || 'ℹ️';
        },

        /** 内部推送日志条目 */
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

        /** 渲染单条日志到settings面板的日志容器 */
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

        /** 重新渲染所有日志（用于面板注入后回放） */
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

        /** HTML 转义 */
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

        /** 清空所有日志 */
        clear() {
            this._logs = [];
            logContainerEl = document.querySelector('#promptlens-log-container');
            if (logContainerEl) {
                logContainerEl.innerHTML = '<div class="promptlens-log-empty">暂无日志</div>';
            }
        },

        /** 复制所有日志到剪贴板 */
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

    // ═══ MODULE 1 Logger 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 2: 存储层 Storage                               │
    // └─────────────────────────────────────────────────────────┘

    const Storage = {
        _data: null,

        /** 返回默认数据结构 */
        _defaultData() {
    return {
        notes: [],
        snapshots: [],
        tags: [...DEFAULT_TAGS],
        settings: {
            enabled: true,
            fabVisible: true,
            fabPos: { ...FAB_DEFAULT_POS },
            panelPos: null,
            settingsCollapsed: false,
            thinkingTagOpen: '<thinking>',   // ★ 思维链开始标签
            thinkingTagClose: '</thinking>',  // ★ 思维链结束标签
        },
        _version: VERSION,
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

        // ★ 修复：深合并，避免 notes/snapshots 被空数组覆盖
        // ★ 修复：深合并，避免 notes/snapshots 被空数组覆盖
        const defaults = this._defaultData();
        this._data = {
            notes:     Array.isArray(parsed.notes)     ? parsed.notes     : defaults.notes,
            snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : defaults.snapshots,
            tags:      Array.isArray(parsed.tags)      ? parsed.tags      : defaults.tags,
            settings: {
    ...defaults.settings,
    ...(parsed.settings || {}),
    fabPos:   { ...defaults.settings.fabPos,  ...(parsed.settings?.fabPos  || {}) },
    panelPos: parsed.settings?.panelPos ?? defaults.settings.panelPos,
    thinkingTagOpen:  parsed.settings?.thinkingTagOpen  ?? defaults.settings.thinkingTagOpen,
    thinkingTagClose: parsed.settings?.thinkingTagClose ?? defaults.settings.thinkingTagClose,
},


        // 补充缺失的默认标签
        DEFAULT_TAGS.forEach(tag => {
            if (!this._data.tags.includes(tag)) {
                this._data.tags.push(tag);
            }
        });

        const noteCount = this._data.notes.length;
        const snapCount = this._data.snapshots.length;
        const tagCount  = this._data.tags.length;
        Logger.success(`数据加载完成 — 笔记: ${noteCount}条, 快照: ${snapCount}条, 标签: ${tagCount}个`);

        return this._data;
    } catch (err) {
        Logger.error('数据加载失败，已重置为默认值', err);
        this._data = this._defaultData();
        this.save();
        return this._data;
    }
},

        /** 保存数据到 localStorage */
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

        /** 获取全部数据 */
        getAll() {
            if (!this._data) this.load();
            return this._data;
        },

        getNotes() { return this.getAll().notes; },
        getSnapshots() { return this.getAll().snapshots; },
        getTags() { return this.getAll().tags; },
        getSettings() { return this.getAll().settings; },

        /** 更新 settings 子字段 */
        updateSettings(partial) {
            Object.assign(this._data.settings, partial);
            this.save();
        },

        /** 导出为 JSON 文件 */
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

        /** 导出笔记为Markdown 文件 */
        exportMarkdown() {
            try {
                let md = `# 📓 PromptLens · 掠影 — 笔记导出\n\n`;
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

        /** 导入JSON 文件（合并模式） */
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

        /** 清空所有数据 */
        clearAll() {
            this._data = this._defaultData();
            this.save();
            Logger.warn('所有数据已清空');
        },
    };

    // ═══ MODULE 2 Storage 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 3: 笔记管理 NoteManager                         │
    // └─────────────────────────────────────────────────────────┘

    const NoteManager = {
        /** 生成唯一 ID */
        _generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        },

        /** 新建笔记 */
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

        /** 删除笔记 */
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

        /** 更新笔记字段 */
        update(id, fields) {
            const data = Storage.getAll();
            const note = data.notes.find(n => n.id === id);
            if (!note) {
                Logger.warn(`更新笔记失败 — 未找到 ID: ${id}`);
                return false;
            }
            Object.assign(note, fields, { updatedAt: new Date().toISOString() });
            Storage.save();
            Logger.info(`更新笔记 — ID: ${id}, 字段: ${Object.keys(fields).join(', ')}`);
            FloatingPanel.refreshNotes();
            return true;
        },

        /** 获取所有笔记 */
        getAll() {
            return Storage.getNotes();
        },

        /** 按关键词和标签筛选笔记 */
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

        /** 复制笔记内容到剪贴板 */
        copyToClipboard(id) {
            const note = this.getAll().find(n => n.id === id);
            if (!note) return;

            navigator.clipboard.writeText(note.content).then(() => {
                Logger.info(`复制笔记内容到剪贴板 — ID: ${id}`);}).catch(err => {
                Logger.error('复制到剪贴板失败', err);
            });
        },
    };

    // ═══ MODULE 3 NoteManager 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 4: 快照引擎 SnapshotEngine                      │
    // └─────────────────────────────────────────────────────────┘

    const SnapshotEngine = {
        /** 生成快照 ID */
        _generateId() {
            return 'snap_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        },

        /** 捕获当前环境快照 */
        capture(manualNote = '') {
            //★ 捕获前先刷新一次当前状态，确保拿到最新值
            EventBridge._readCurrentState();

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
            Logger.info(`快照捕获 — 预设: ${snapshot.presetName}, 模型: ${snapshot.model}, API: ${snapshot.apiSource}, 条目: ${entryCount}个`);

            FloatingPanel.refreshSnapshots();
            FloatingBall.setChanged(false);

            return snapshot;
        },
                /** 提取当前预设中已启用的条目名称列表 */
        _getEnabledEntries() {
            try {
                // ★ 路径1: SillyTavern.getContext().chatCompletionSettings（最可靠）
                // prompts 是条目定义表（identifier→name），prompt_order 是每个角色的启用状态
                const ctx = (typeof SillyTavern !== 'undefined') ? SillyTavern.getContext() : null;
                const settings = ctx?.chatCompletionSettings;

                if (settings?.prompts && settings?.prompt_order) {
                    // 建立 identifier → name 映射表
                    const nameMap = {};
                    settings.prompts.forEach(p => {
                        if (p.identifier && p.name) {
                            nameMap[p.identifier] = p.name;
                        }
                    });

                    // prompt_order 有多个 character_id，取最后一个非 100000 的
                    // （100000 是全局默认，实际对话用的是角色专属的那个）
                    let order = null;
                    const orders = settings.prompt_order;
                    if (orders.length === 1) {
                        order = orders[0].order;
                    } else {
                        // 优先取非全局的角色专属 order
                        const charOrder = orders.find(o => o.character_id !== 100000);
                        order = charOrder ? charOrder.order : orders[orders.length - 1].order;
                    }

                    if (order && order.length > 0) {
                        const entries = order
                            .filter(item => item.enabled === true)
                            .map(item => nameMap[item.identifier] || item.identifier)
                            .filter(name => name); // 过滤空值

                        if (entries.length > 0) {
                            Logger.info(`条目来源: chatCompletionSettings (${entries.length}个已启用)`);
                            return entries;
                        }
                    }
                }

                // ★ 路径2: DOM 读取（备用）
                const domEntries = this._getEntriesFromDOM();
                if (domEntries.length > 0) {
                    Logger.info(`条目来源: DOM prompt-manager (${domEntries.length}个)`);
                    return domEntries;
                }

                Logger.warn('快照捕获时未能获取 enabledEntries');
                return [];
            } catch (err) {
                Logger.error('提取 enabledEntries 失败', err);
                return [];
            }
        },

        /** 从 DOM 的 prompt manager 列表中提取已启用条目（备用路径） */
        _getEntriesFromDOM() {
            try {
                const entries = [];
                const items = document.querySelectorAll(
                    '#completion_prompt_manager_list li.completion_prompt_manager_prompt'
                );

                items.forEach(item => {
                    // ★ ST 用 fa-toggle-on/off 表示开关状态，没有 checkbox
                    const toggle = item.querySelector('.prompt-manager-toggle-action');
                    if (!toggle) return; // marker 类条目没有 toggle，跳过

                    const isEnabled = toggle.classList.contains('fa-toggle-on');
                    if (!isEnabled) return;

                    // ★ 从 data-pm-name 读取名称（最干净，不含图标文字）
                    const nameEl = item.querySelector('[data-pm-name]');
                    if (!nameEl) return;

                    // data-pm-name 可能含 HTML 实体（&nbsp; 等），需要解码
                    const raw = nameEl.dataset.pmName || '';
                    const decoded = raw
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .trim();

                    if (decoded) {
                        entries.push(decoded);
                    }
                });

                return entries;
            } catch (err) {
                Logger.error('DOM 条目读取失败', err);
                return [];
            }
        },

        /** 获取所有快照 */
        getAll() {
            return Storage.getSnapshots();
        },

        /** 删除快照 */
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

        /** 更新快照备注 */
        updateNote(id, note) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.note = note;
            Storage.save();
            Logger.info(`快照备注更新 — ID: ${id}`);
            return true;
        },

        /** 更新快照评分 */
        updateRating(id, stars) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.rating = stars;
            Storage.save();
            Logger.info(`快照评分更新 — ID: ${id}, 评分: ${stars}星`);
            return true;
        },

        /** 更新快照评价文字 */
        updateRatingNote(id, ratingNote) {
            const snap = Storage.getSnapshots().find(s => s.id === id);
            if (!snap) return false;
            snap.ratingNote = ratingNote;
            Storage.save();
            return true;
        },

        /** 对比两个快照的差异 */
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

        /** 检测当前环境是否相对上次快照有变化 */
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

    // ═══ MODULE 4 SnapshotEngine 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 5: 事件桥接EventBridge                         │
    // └─────────────────────────────────────────────────────────┘

    const EventBridge = {
        _handlers: [],

        /** 初始化事件监听 + 主动读取当前状态 */
        init() {
            try {
                // ★★★ 核心修复：启动时主动读取当前环境状态 ★★★
                this._readCurrentState();

                const eventSource = window.eventSource || (typeof SillyTavern !== 'undefined' && SillyTavern.eventSource);
                const eventTypes = window.event_types || (typeof SillyTavern !== 'undefined' && SillyTavern.event_types);

                if (!eventSource || !eventTypes) {
                    Logger.warn('未找到 SillyTavern 事件系统，快照功能将仅依赖 DOM 读取');
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

                //监听预设切换
                listen('PRESET_CHANGED', (data) => {
                    if (data && data.name) {
                        _currentPresetName = data.name;
                        Logger.info(`事件触发: PRESET_CHANGED → { name: "${data.name}" }`);
                        this._checkChanged();
                    }
                });

                // 监听 OAI 预设切换（含预设对象）
                listen('OAI_PRESET_CHANGED_BEFORE', (result) => {
                    if (result) {
                        _currentPresetName = result.presetName || _currentPresetName;
                        _currentPreset = result.preset || null;
                        const entryCount = _currentPreset?.prompts?.length || '未知';
                        Logger.info(`事件触发: OAI_PRESET_CHANGED_BEFORE → 预设含${entryCount}个条目`);
                        this._checkChanged();
                    }
                });

                // 监听模型切换
                listen('CHATCOMPLETION_MODEL_CHANGED', (model) => {
                    if (model) {
                        _currentModel = model;
                        Logger.info(`事件触发: CHATCOMPLETION_MODEL_CHANGED → "${model}"`);
                        this._checkChanged();
                    }
                });

                // 监听 API 源切换
                listen('CHATCOMPLETION_SOURCE_CHANGED', (source) => {
                    if (source) {
                        _currentSource = source;
                        Logger.info(`事件触发: CHATCOMPLETION_SOURCE_CHANGED → "${source}"`);
                }
                });

                // 监听角色消息渲染
                listen('CHARACTER_MESSAGE_RENDERED', (msgId) => {
                    Logger.info(`事件触发: CHARACTER_MESSAGE_RENDERED → 消息 #${msgId}`);
                });

                // 监听设置加载完成
                listen('SETTINGS_LOADED_AFTER', () => {
                    Logger.info('事件触发: SETTINGS_LOADED_AFTER →酒馆设置已加载');
                    //★ 设置加载后再次读取，因为此时 ST 全局变量已完全就绪
                    setTimeout(() => this._readCurrentState(), 500);
                });

                const registeredCount = this._handlers.length;
                Logger.success(`事件监听器已注册 (${registeredCount}个)`);
            } catch (err) {
                Logger.error('事件桥接初始化失败', err);
            }
        },

        /**
         * ★★★ 核心新增：主动从 ST DOM / 全局变量读取当前环境状态 ★★★
         *解决：插件启动时事件尚未触发，_currentModel 等全为空的问题
         */
            _readCurrentState() {
            try {
                let readCount = 0;

                // ══════════════════════════════════════
                // 第一步：确定 API 源（最重要，决定后续读哪个模型）
                // ══════════════════════════════════════

                let mainApi = '';
                let chatCompletionSource = '';

                // 读取主 API 类型（openai / kobold / novel 等）
                if (window.main_api && typeof window.main_api === 'string') {
                    mainApi = window.main_api;
                } else {
                    const mainApiEl = document.querySelector('#main_api');
                    if (mainApiEl) {
                        mainApi = String(mainApiEl.value || '');
                    }
                }

                // 读取 Chat Completion 子源（openai / claude / openrouter / custom 等）
                const chatSourceEl = document.querySelector('#chat_completion_source');
                if (chatSourceEl) {
                    chatCompletionSource = String(chatSourceEl.value || '');
                }

                // 组合出最终 API 源显示名
                if (mainApi === 'openai' && chatCompletionSource) {
                    // main_api 是 "openai" 只代表用的是 Chat Completion 大类
                    // 真正的源要看 chat_completion_source
                    _currentSource = chatCompletionSource;
                    readCount++;
                } else if (mainApi) {
                    _currentSource = mainApi;
                    readCount++;
                }

                Logger.info(`API 源读取 — main_api: "${mainApi}", chat_completion_source: "${chatCompletionSource}", 最终: "${_currentSource}"`);

                // ══════════════════════════════════════
                // 第二步：根据 API 源读取对应的模型
                // ══════════════════════════════════════

                let modelFound = '';

                // 根据不同的 chat_completion_source 读取对应的模型选择器
                const sourceModelMap = {
                    'openai':       ['#model_openai_select'],
                    'claude':       ['#model_claude_select'],
                    'google':       ['#model_google_select'],
                    'openrouter':   ['#openrouter_model'],
                    'mistralai':    ['#model_mistral_select'],
                    'custom':       ['#model_custom_select'],
                    'cohere':       ['#model_cohere_select'],
                    'perplexity':   ['#model_perplexity_select'],
                    'groq':         ['#model_groq_select'],
                    'zerooneai':    ['#model_01ai_select'],
                    'blockentropy': ['#model_blockentropy_select'],
                };

                const activeSource = chatCompletionSource || _currentSource || '';

                // 优先：按当前源精确匹配模型选择器
                if (activeSource && sourceModelMap[activeSource]) {
                    for (const selector of sourceModelMap[activeSource]) {
                        const el = document.querySelector(selector);
                        if (el && el.value) {
                            modelFound = String(el.value);
                            break;
                        }
                    }
                }

                // 降级：精确匹配没找到时，遍历所有选择器，只读可见的
                if (!modelFound) {
                    const fallbackSelectors = [
                        '#model_claude_select',
                        '#model_google_select',
                        '#openrouter_model',
                        '#model_mistral_select',
                        '#model_custom_select',
                        '#model_cohere_select',
                        '#model_perplexity_select',
                        '#model_groq_select',
                        '#model_01ai_select',
                        '#model_openai_select', // OpenAI 放最后兜底
                    ];
                    for (const sel of fallbackSelectors) {
                        const el = document.querySelector(sel);
                        // 只有元素可见时才认为是当前活跃的模型选择器
                        if (el && el.value && el.offsetParent !== null) {
                            modelFound = String(el.value);
                            Logger.info(`模型降级读取 — 从 ${sel} 获取: "${modelFound}"`);
                            break;
                        }
                    }
                }

                // 再降级：从 ST 全局变量读取，按源区分
                if (!modelFound && window.oai_settings) {
                    if (activeSource === 'claude' && window.oai_settings.claude_model) {
                        modelFound = window.oai_settings.claude_model;
                    } else if (activeSource === 'openai' && window.oai_settings.openai_model) {
                        modelFound = window.oai_settings.openai_model;
                    } else if (activeSource === 'openrouter' && window.oai_settings.openrouter_model) {
                        modelFound = window.oai_settings.openrouter_model;
                    }
                }

                if (modelFound) {
                    _currentModel = modelFound;
                    readCount++;
                }

                Logger.info(`模型读取 — 源: "${activeSource}", 模型: "${modelFound || '未获取'}"`);

                // ══════════════════════════════════════
                // 第三步：读取预设名
                // ══════════════════════════════════════

                const presetSelectors = [
                    '#settings_preset_openai',
                    '#settings_preset',
                ];
                for (const sel of presetSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.selectedIndex >= 0) {
                        const selectedOption = el.options[el.selectedIndex];
                        if (selectedOption) {
                            const presetName = selectedOption.textContent.trim();
                            if (presetName && presetName !== '-- Select a preset --' && presetName !== 'None') {
                                _currentPresetName = presetName;
                                readCount++;
                                break;
                            }
                        }
                    }
                }

                // 降级：从 ST 全局变量读取
                if (!_currentPresetName && window.oai_settings && window.oai_settings.preset_settings_openai) {
                    _currentPresetName = String(window.oai_settings.preset_settings_openai);
                    readCount++;
                }

                // ══════════════════════════════════════
                // 第四步：尝试获取预设对象
                // ══════════════════════════════════════

                if (!_currentPreset && window.oai_settings) {
                    if (window.oai_settings.prompts && Array.isArray(window.oai_settings.prompts)) {
                        _currentPreset = { prompts: window.oai_settings.prompts };
                    } else if (window.oai_settings.prompt_order) {
                        _currentPreset = { prompt_order: window.oai_settings.prompt_order };
                    }
                }

                Logger.info(`环境状态读取完成 — 模型: "${_currentModel || '未获取'}", API: "${_currentSource || '未获取'}", 预设: "${_currentPresetName || '未获取'}" (${readCount}项成功)`);
            } catch (err) {
                Logger.error('读取当前环境状态失败', err);
            }
        },

        /** 检查环境是否变更，驱动悬浮球角标 */
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

        /** 销毁所有事件监听 */
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


    // ═══ MODULE 5 EventBridge 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 6: UI —悬浮球 FloatingBall                     │
    // └─────────────────────────────────────────────────────────┘

    const FloatingBall = {
        _isDragging: false,
        _startX: 0,
        _startY: 0,
        _startRight: 0,
        _startBottom: 0,
        _moved: false,

        /** 创建悬浮球 DOM */
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

            document.body.appendChild(fabEl);Logger.success(`悬浮球已创建，位置: right=${pos.right}, bottom=${pos.bottom}`);
        },

        /** 销毁悬浮球 */
        destroy() {
            if (fabEl) {
                fabEl.remove();
                fabEl = null;
                Logger.info('悬浮球已移除');
            }
        },

        /** 设置环境变更角标 */
        setChanged(bool) {
            if (!fabEl) return;
            const badge = fabEl.querySelector('.promptlens-fab-badge');
            if (badge) {
                badge.classList.toggle('active', bool);
            }
        },

        /** 拖拽开始 */
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

    // ═══ MODULE 6 FloatingBall 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  MODULE 7: UI — 浮动面板 FloatingPanel                  │
    // └─────────────────────────────────────────────────────────┘

    const FloatingPanel = {
        _isDragging: false,
        _startX: 0,
        _startY: 0,
        _startLeft: 0,
        _startTop: 0,
        _moved: false,

        /** 创建浮动面板 DOM */
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

            this._applyPosition();

            document.body.appendChild(panelEl);

            this._bindEvents();
            this._renderTagBar();
            this._updateStatusBar();

            Logger.success('浮动面板已创建');
        },

        /** 判断是否为移动端 */
        _isMobile() {
            return window.innerWidth <= 768;
        },

        /** 智能定位：移动端居中，桌面端恢复记忆位置 */
        _applyPosition() {
            if (!panelEl) return;

            if (this._isMobile()) {
                panelEl.style.left = '8px';
                panelEl.style.top = '50px';
                panelEl.style.right ='auto';
                panelEl.style.bottom = 'auto';
                return;
            }

            const savedPos = Storage.getSettings().panelPos;
            if (savedPos) {
                const safeLeft = Math.max(0, Math.min(savedPos.left, window.innerWidth - 200));
                const safeTop = Math.max(0, Math.min(savedPos.top, window.innerHeight - 100));
                panelEl.style.left = safeLeft + 'px';
                panelEl.style.top = safeTop + 'px';
            } else {
                panelEl.style.left = Math.max(10, window.innerWidth - 440) + 'px';
                panelEl.style.top = '100px';
            }
            panelEl.style.right = 'auto';
            panelEl.style.bottom = 'auto';
        },

        /** 绑定面板内部事件 */
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

        /** 显示面板 */
        show() {
            if (!panelEl) return;
            this._applyPosition();
            panelEl.classList.add('visible');
            panelVisible = true;
            this._renderContent();
            this._updateStatusBar();
        },

        /** 隐藏面板 */
        hide() {
            if (!panelEl) return;
            panelEl.classList.remove('visible');
            panelVisible = false;
        },

        /** 切换面板显隐 */
        toggle() {
            if (panelVisible) {
                this.hide();
            } else {
                this.show();
            }
        },

        /** 销毁面板 */
        destroy() {
            if (panelEl) {
                panelEl.remove();
                panelEl = null;
                panelVisible = false;
                Logger.info('浮动面板已移除');
            }
        },

        /** 切换标签页 */
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

            //★ 切换标签时，笔记标签栏只在笔记页显示
            const tagBar = panelEl.querySelector('#promptlens-tag-bar');
            if (tagBar) {
                tagBar.style.display = tabName === 'notes' ? '' : 'none';
            }

            this._renderContent();
        },

        /** 刷新笔记列表 */
        refreshNotes() {
            if (currentTab === 'notes') this._renderContent();
            this._updateStatusBar();
        },

        /** 刷新快照列表 */
        refreshSnapshots() {
            if (currentTab === 'snapshots') this._renderContent();
            this._updateStatusBar();
        },

        /** 渲染当前标签页内容 */
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

        /** 渲染笔记列表 */
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
                `;
                return;
            }

            container.innerHTML = notes.map(note => this._renderNoteCard(note)).join('');

            // 绑定笔记卡片事件
            container.querySelectorAll('.promptlens-note-card').forEach(card => {
                const noteId = card.dataset.id;

                //★ 点击卡片内容区展开/折叠
                const contentEl = card.querySelector('.promptlens-card-content');
                if (contentEl) {
                    contentEl.addEventListener('click', () => {
                        contentEl.classList.toggle('expanded');});
                    contentEl.style.cursor = 'pointer';
                }

                // 复制按钮
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

                // ★ 编辑按钮
                card.querySelector('.promptlens-card-edit')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._showNoteEditForm(noteId, card);
                });

                // 删除按钮
                card.querySelector('.promptlens-card-delete')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这条笔记？')) {
                        NoteManager.delete(noteId);
                }
                });
                                // ★ 楼层跳转
                card.querySelectorAll('.promptlens-card-floor-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const floor = link.dataset.floor;
                        if (!floor) return;

                        const targetEl = document.querySelector(`.mes[mesid="${floor}"]`);
                        if (!targetEl) {
                            Logger.warn(`楼层跳转失败 — 未找到楼层 #${floor}，可能已被清除`);
                            return;
                        }

                        // 滚动到目标楼层
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

                        // ★ 短暂高亮：加 class → 1.5s 后移除
                        targetEl.classList.add('promptlens-floor-highlight');
                        setTimeout(() => {
                            targetEl.classList.remove('promptlens-floor-highlight');
                        }, 1500);

                        Logger.info(`楼层跳转 — 跳转到楼层 #${floor}`);
                    });
                });

            });
        },

        /** 渲染单个笔记卡片 HTML */
_renderNoteCard(note) {
    const time = new Date(note.createdAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
    const tags = (note.tags || []).map(t =>
        `<span class="promptlens-card-tag">${this._escapeHtml(t)}</span>`
    ).join('');

    // ★ 楼层跳转：改为可点击的 span，data-floor 存楼层号
    const floor = note.sourceFloor != null
        ? `<span class="promptlens-card-floor-link" data-floor="${note.sourceFloor}" title="点击跳转到楼层 #${note.sourceFloor}">📍楼层 #${note.sourceFloor}</span> · `
        : '';

    return `
        <div class="promptlens-note-card" data-id="${note.id}">
            <div class="promptlens-card-content">${this._escapeHtml(note.content)}</div>
            <div class="promptlens-card-meta">
                <span class="promptlens-card-source">${floor}${time}</span>
            </div>
            ${tags ? `<div class="promptlens-card-tags">${tags}</div>` : ''}
            <div class="promptlens-card-actions">
                <button class="promptlens-card-copy" title="复制内容">📋</button>
                <button class="promptlens-card-edit" title="编辑">✏️</button>
                <button class="promptlens-card-delete" title="删除">🗑️</button>
            </div>
        </div>
    `;
},

        /** ★ 在卡片内显示笔记编辑表单 */
        _showNoteEditForm(noteId, cardEl) {
            const note = NoteManager.getAll().find(n => n.id === noteId);
            if (!note) return;

            // 替换卡片内容为编辑表单
            const allTags = Storage.getTags();
            const noteTags = note.tags || [];

            const tagCheckboxes = allTags.map(tag => {
                const checked = noteTags.includes(tag) ? 'checked' : '';
                return `<label class="promptlens-edit-tag-label">
                    <input type="checkbox" value="${this._escapeHtml(tag)}" ${checked} />
                    <span>${this._escapeHtml(tag)}</span>
                </label>`;
            }).join('');

            cardEl.innerHTML = `
                <div class="promptlens-edit-form">
                    <textarea class="promptlens-edit-textarea" rows="4">${this._escapeHtml(note.content)}</textarea><div class="promptlens-edit-tags-section">
                        <div class="promptlens-edit-tags-title">标签</div>
                        <div class="promptlens-edit-tags-list">${tagCheckboxes}</div>
                    </div><div class="promptlens-edit-actions">
                        <button class="promptlens-edit-save">保存</button>
                        <button class="promptlens-edit-cancel">取消</button>
                    </div>
                </div>
            `;

            cardEl.classList.add('editing');

            // 保存
            cardEl.querySelector('.promptlens-edit-save').addEventListener('click', () => {
                const newContent = cardEl.querySelector('.promptlens-edit-textarea').value.trim();
                if (!newContent) {
                    Logger.warn('笔记内容不能为空');
                    return;
                }
                const selectedTags = [];
                cardEl.querySelectorAll('.promptlens-edit-tags-list input[type="checkbox"]:checked').forEach(cb => {
                    selectedTags.push(cb.value);
                });
                NoteManager.update(noteId, { content: newContent, tags: selectedTags });
            });

            // 取消
            cardEl.querySelector('.promptlens-edit-cancel').addEventListener('click', () => {
                this._renderContent();
            });

            // 自动聚焦
            const textarea = cardEl.querySelector('.promptlens-edit-textarea');
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            }
        },

        /** 渲染快照列表 */
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
                            还没有快照<br/><span style="color:#666;font-size:12px;">点击"📸 快照"按钮捕获当前预设状态</span>
                        </div>
                    </div>
                `;
                return;
            }

            // ★ 对比选择模式提示条
            let diffBar = '';
            if (diffSelectingId) {
                const selectedSnap = SnapshotEngine.getAll().find(s => s.id === diffSelectingId);
                const selectedName = selectedSnap ? selectedSnap.presetName : '未知';
                diffBar = `
                    <div class="promptlens-diff-bar">
                        <span class="promptlens-diff-bar-text">⚖️ 已选中「${this._escapeHtml(selectedName)}」，请点击另一个快照的 ⚖️ 按钮进行对比</span>
                <button class="promptlens-diff-bar-cancel" id="promptlens-diff-cancel">取消</button>
                    </div>
                `;
            }

            // ★ 当前环境信息摘要
            let envSummary = '';
            if (_currentModel || _currentPresetName || _currentSource) {
                envSummary = `
                    <div class="promptlens-env-summary">
                        <span class="promptlens-env-label">当前环境</span>
                        ${_currentModel ? `<span class="promptlens-env-item">🤖 ${this._escapeHtml(_currentModel)}</span>` : ''}
                        ${_currentPresetName ? `<span class="promptlens-env-item">📋 ${this._escapeHtml(_currentPresetName)}</span>` : ''}
                        ${_currentSource ? `<span class="promptlens-env-item">🔌 ${this._escapeHtml(_currentSource)}</span>` : ''}
                    </div>
                `;
            }

            container.innerHTML = diffBar + envSummary + snapshots.map(snap => this._renderSnapshotCard(snap)).join('');

            // ★ 对比取消按钮
            container.querySelector('#promptlens-diff-cancel')?.addEventListener('click', () => {
                diffSelectingId = null;
                this._renderContent();
            });

            // ★ 高亮当前选中的对比快照
            if (diffSelectingId) {
                const selectedCard = container.querySelector(`.promptlens-snapshot-card[data-id="${diffSelectingId}"]`);
                if (selectedCard) {
                    selectedCard.classList.add('diff-selected');
                }
            }

            // 绑定快照卡片事件
            container.querySelectorAll('.promptlens-snapshot-card').forEach(card => {
                const snapId = card.dataset.id;

                // ★ 对比按钮
                card.querySelector('.promptlens-snap-diff-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!diffSelectingId) {
                        //第一次点击：进入选择模式
                        diffSelectingId = snapId;
                        Logger.info(`快照对比：已选中第一个快照 — ID: ${snapId}`);
                        this._renderContent();
                    } else if (diffSelectingId === snapId) {
                        // 点击了同一个：取消选择
                        diffSelectingId = null;
                        this._renderContent();
                    } else {
                        // 第二次点击：执行对比
                        const idA = diffSelectingId;
                        const idB = snapId;
                        diffSelectingId = null;
                        Logger.info(`快照对比：开始对比 — A: ${idA}, B: ${idB}`);
                        this._showDiffView(idA, idB);
                    }
                });

                // 删除
                card.querySelector('.promptlens-card-delete')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('确定删除这个快照？')) {
                        SnapshotEngine.delete(snapId);
                    }
                });

                // 星级评分
                card.querySelectorAll('.promptlens-star').forEach(star => {
                    star.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const rating = parseInt(star.dataset.rating);
                        SnapshotEngine.updateRating(snapId, rating);this._renderContent();
                    });
                });

                // 快照备注编辑
                card.querySelector('.promptlens-snap-note-edit')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._showSnapNoteEditForm(snapId, card);
                });

                // 点击条目区展开/折叠
                const entriesEl = card.querySelector('.promptlens-snap-entries');
                if (entriesEl) {
                    entriesEl.addEventListener('click', () => {
                        entriesEl.classList.toggle('expanded');
                    });
                    entriesEl.style.cursor = 'pointer';
                }
            });
        },

       /** 渲染单个快照卡片 HTML */
        _renderSnapshotCard(snap) {
            const time = new Date(snap.timestamp).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });

            const entries = snap.enabledEntries || [];
            const entryDisplay = entries.length > 3
                ? entries.slice(0, 3).join(', ') + ` +${entries.length - 3}`
                : entries.join(', ') || '无记录';

            //★ 完整条目列表（展开时显示）
            const fullEntryDisplay = entries.join(', ') || '无记录';

            const stars = [1, 2, 3, 4, 5].map(i =>
                `<span class="promptlens-star ${i <= (snap.rating || 0) ? 'filled' : ''}" data-rating="${i}">★</span>`
            ).join('');

            const noteDisplay = snap.note
                ? `<span class="promptlens-snap-note">"${this._escapeHtml(snap.note)}"</span>`
                : `<span class="promptlens-snap-note promptlens-snap-note-placeholder">点击添加备注</span>`;

            return `
                <div class="promptlens-snapshot-card" data-id="${snap.id}">
                    <div class="promptlens-snap-header">
                        <span class="promptlens-snap-icon">📸</span>
                        <span class="promptlens-snap-preset">${this._escapeHtml(snap.presetName)}</span></div>
                    <div class="promptlens-snap-info">
                        模型: ${this._escapeHtml(snap.model)} · API: ${this._escapeHtml(snap.apiSource)}
                    </div>
                    <div class="promptlens-snap-entries" title="点击展开全部条目"
                         data-short="${this._escapeHtml(entryDisplay)}"
                         data-full="${this._escapeHtml(fullEntryDisplay)}">
                        条目: ${this._escapeHtml(entryDisplay)}
                    </div>
                    <div class="promptlens-snap-rating">
                        <span class="promptlens-stars">${stars}</span>
                        <span class="promptlens-snap-note-edit">${noteDisplay}</span>
                    </div>
                    <div class="promptlens-card-meta">
                        <span class="promptlens-card-source">${time}</span>
                    </div>
                    <div class="promptlens-card-actions">
                    <button class="promptlens-snap-diff-btn" title="对比">⚖️</button>
                        <button class="promptlens-card-delete" title="删除">🗑️</button>
                        </div>
                </div>
            `;
        },

        /** ★ 在快照卡片内显示备注编辑 */
        _showSnapNoteEditForm(snapId, cardEl) {
            const snap = SnapshotEngine.getAll().find(s => s.id === snapId);
            if (!snap) return;

            const noteEditEl = cardEl.querySelector('.promptlens-snap-note-edit');
            if (!noteEditEl) return;

            // 替换为输入框
            const currentNote = snap.note || '';
            noteEditEl.innerHTML = `
                <input type="text" class="promptlens-snap-note-input" value="${this._escapeHtml(currentNote)}" placeholder="输入备注..." />
            `;
            noteEditEl.classList.add('editing');

            const input = noteEditEl.querySelector('.promptlens-snap-note-input');
            input.focus();

            // 回车或失焦保存
            const saveNote = () => {
                const newNote = input.value.trim();SnapshotEngine.updateNote(snapId, newNote);
                this._renderContent();};

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveNote();
                }
                if (e.key === 'Escape') {
                    this._renderContent();
                }
            });

            input.addEventListener('blur', () => {
                saveNote();
            });
        },
                /** ★ 渲染快照 Diff 对比视图 */
        _showDiffView(idA, idB) {
            if (!panelEl) return;
            const container = panelEl.querySelector('#promptlens-content');
            if (!container) return;

            const result = SnapshotEngine.diff(idA, idB);
            if (!result) {
                Logger.warn('快照对比失败 — 未找到指定快照');
                return;
            }

            const { snapA, snapB, modelChanged, sourceChanged, presetChanged, entries } = result;

            const timeA = new Date(snapA.timestamp).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            const timeB = new Date(snapB.timestamp).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            });

            // ★ 构建字段对比行
            const fieldRow = (label, valA, valB, changed) => {
                if (changed) {
                    return `
                        <div class="promptlens-diff-field changed">
                            <span class="promptlens-diff-field-label">${label}</span>
                            <span class="promptlens-diff-field-val old">${this._escapeHtml(valA)}</span>
                            <span class="promptlens-diff-field-arrow">→</span>
                            <span class="promptlens-diff-field-val new">${this._escapeHtml(valB)}</span>
                        </div>
                    `;
                }
                return `
                    <div class="promptlens-diff-field same">
                        <span class="promptlens-diff-field-label">${label}</span>
                        <span class="promptlens-diff-field-val">${this._escapeHtml(valA)}</span>
                    </div>
                `;
            };

            // ★ 构建条目差异列表
            let entriesHtml = '';
            if (entries.removed.length > 0) {
                entriesHtml += entries.removed.map(e =>
                    `<div class="promptlens-diff-entry removed"><span class="promptlens-diff-entry-icon">−</span>${this._escapeHtml(e)}</div>`
                ).join('');
            }
            if (entries.added.length > 0) {
                entriesHtml += entries.added.map(e =>
                    `<div class="promptlens-diff-entry added"><span class="promptlens-diff-entry-icon">+</span>${this._escapeHtml(e)}</div>`
                ).join('');
            }
            if (entries.unchanged.length > 0) {
                entriesHtml += entries.unchanged.map(e =>
                    `<div class="promptlens-diff-entry unchanged"><span class="promptlens-diff-entry-icon">·</span>${this._escapeHtml(e)}</div>`
                ).join('');
            }

            if (!entriesHtml) {
                entriesHtml = '<div class="promptlens-diff-entry unchanged" style="color:#666;">无条目记录</div>';
            }

            // ★ 总结变更数量
            const totalChanges = (modelChanged ? 1 : 0) + (sourceChanged ? 1 : 0) + (presetChanged ? 1 : 0) + entries.added.length + entries.removed.length;
            const summaryText = totalChanges === 0
                ? '两个快照完全相同'
                : `发现${totalChanges} 处差异`;

            // ★ 评分对比
            const ratingA = snapA.rating || 0;
            const ratingB = snapB.rating || 0;
            const ratingStars = (r) => '★'.repeat(r) + '☆'.repeat(5 - r);
            let ratingHtml = '';
            if (ratingA || ratingB) {
                ratingHtml = `
                    <div class="promptlens-diff-section">
                        <div class="promptlens-diff-section-title">评分</div>
                        <div class="promptlens-diff-rating-row">
                            <span class="promptlens-diff-rating-label">A</span>
                            <span class="promptlens-diff-rating-stars ${ratingA ? '' : 'none'}">${ratingA ? ratingStars(ratingA) : '未评分'}</span>
                            <span class="promptlens-diff-rating-label">B</span>
                            <span class="promptlens-diff-rating-stars ${ratingB ? '' : 'none'}">${ratingB ? ratingStars(ratingB) : '未评分'}</span>
                        </div>
                    </div>
                `;
            }

            container.innerHTML = `
                <div class="promptlens-diff-view">
                    <div class="promptlens-diff-header">
                        <div class="promptlens-diff-title">⚖️ 快照对比</div>
                        <button class="promptlens-diff-close" id="promptlens-diff-close">✕ 关闭</button>
                    </div>

                    <div class="promptlens-diff-summary ${totalChanges === 0 ? 'identical' : 'different'}">
                        ${summaryText}
                    </div>

                    <div class="promptlens-diff-columns">
                        <div class="promptlens-diff-col-header">
                            <div class="promptlens-diff-col a">
                                <span class="promptlens-diff-col-label">A</span>
                                <span class="promptlens-diff-col-name">${this._escapeHtml(snapA.presetName)}</span>
                                <span class="promptlens-diff-col-time">${timeA}</span>
                            </div>
                            <div class="promptlens-diff-col b">
                                <span class="promptlens-diff-col-label">B</span>
                                <span class="promptlens-diff-col-name">${this._escapeHtml(snapB.presetName)}</span>
                                <span class="promptlens-diff-col-time">${timeB}</span>
                            </div>
                        </div></div>

                    <div class="promptlens-diff-section">
                        <div class="promptlens-diff-section-title">环境配置</div>
                        ${fieldRow('模型', snapA.model, snapB.model, modelChanged)}
                        ${fieldRow('API', snapA.apiSource, snapB.apiSource, sourceChanged)}
                        ${fieldRow('预设', snapA.presetName, snapB.presetName, presetChanged)}
                    </div>

                    <div class="promptlens-diff-section">
                        <div class="promptlens-diff-section-title">
                            预设条目
                            <span class="promptlens-diff-entry-count">
                                ${entries.added.length > 0 ? `<span class="added">+${entries.added.length}</span>` : ''}
                                ${entries.removed.length > 0 ? `<span class="removed">-${entries.removed.length}</span>` : ''}
                                ${entries.unchanged.length > 0 ? `<span class="unchanged">${entries.unchanged.length} 不变</span>` : ''}
                            </span>
                        </div>
                        <div class="promptlens-diff-entries">
                            ${entriesHtml}
                        </div>
                    </div>

                    ${ratingHtml}
                </div>
            `;

            // 关闭按钮
            container.querySelector('#promptlens-diff-close')?.addEventListener('click', () => {
                this._renderContent();
            });

            Logger.success(`快照对比完成 — ${summaryText}`);
        },


        /** 渲染标签筛选栏 */
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

        /** ★ 新建笔记 / 快照 — 使用内嵌表单替代 prompt() */
        showNewNoteForm() {
            if (!panelEl) return;
            const container = panelEl.querySelector('#promptlens-content');
            if (!container) return;

            if (currentTab === 'snapshots') {
                //★ 快照捕获内嵌表单
                this._showCaptureForm(container);
                return;
            }

            // ★ 笔记新建内嵌表单
            const allTags = Storage.getTags();
            const tagCheckboxes = allTags.map(tag => {
                return `<label class="promptlens-edit-tag-label">
                    <input type="checkbox" value="${this._escapeHtml(tag)}" />
                    <span>${this._escapeHtml(tag)}</span>
                </label>`;
            }).join('');

            const formHtml = `
                <div class="promptlens-new-note-form">
                    <div class="promptlens-form-title">📝 新建笔记</div>
                    <textarea class="promptlens-edit-textarea" rows="5" placeholder="输入笔记内容..." id="promptlens-new-note-content"></textarea>
                    <div class="promptlens-edit-tags-section">
                        <div class="promptlens-edit-tags-title">选择标签</div>
                        <div class="promptlens-edit-tags-list">${tagCheckboxes}</div>
                    </div>
                    <div class="promptlens-edit-actions">
                        <button class="promptlens-edit-save" id="promptlens-new-note-save">保存笔记</button>
                        <button class="promptlens-edit-cancel" id="promptlens-new-note-cancel">取消</button>
                    </div>
                </div>
            `;

            //在内容区顶部插入表单
            const formWrapper = document.createElement('div');
            formWrapper.className = 'promptlens-form-wrapper';
            formWrapper.innerHTML = formHtml;
            container.insertBefore(formWrapper, container.firstChild);

            // 聚焦
            const textarea = container.querySelector('#promptlens-new-note-content');
            if (textarea) textarea.focus();

            // 保存
            container.querySelector('#promptlens-new-note-save')?.addEventListener('click', () => {
                const content = container.querySelector('#promptlens-new-note-content')?.value?.trim();
                if (!content) {
                    Logger.warn('笔记内容不能为空');
                    return;
                }
                const selectedTags = [];
                formWrapper.querySelectorAll('.promptlens-edit-tags-list input[type="checkbox"]:checked').forEach(cb => {
                    selectedTags.push(cb.value);
                });
                NoteManager.add({ content, tags: selectedTags });});

            // 取消
            container.querySelector('#promptlens-new-note-cancel')?.addEventListener('click', () => {
                formWrapper.remove();
            });
        },

        /** ★ 快照捕获内嵌表单 */
        _showCaptureForm(container) {
            // 先刷新环境状态
            EventBridge._readCurrentState();

            const formHtml = `
                <div class="promptlens-new-note-form promptlens-capture-form">
                    <div class="promptlens-form-title">📸 捕获环境快照</div>
                    <div class="promptlens-capture-preview">
                        <div class="promptlens-capture-row">
                            <span class="promptlens-capture-label">模型</span>
                            <span class="promptlens-capture-value">${this._escapeHtml(_currentModel || '未获取')}</span>
                        </div>
                        <div class="promptlens-capture-row">
                            <span class="promptlens-capture-label">API</span>
                            <span class="promptlens-capture-value">${this._escapeHtml(_currentSource || '未获取')}</span>
                        </div>
                        <div class="promptlens-capture-row">
                            <span class="promptlens-capture-label">预设</span>
                            <span class="promptlens-capture-value">${this._escapeHtml(_currentPresetName || '未获取')}</span>
                        </div></div>
                    <input type="text" class="promptlens-capture-note-input" placeholder="为这个快照添加备注（可选）..." id="promptlens-capture-note" />
                    <div class="promptlens-edit-actions">
                        <button class="promptlens-edit-save" id="promptlens-capture-save">📸 捕获快照</button>
                        <button class="promptlens-edit-cancel" id="promptlens-capture-cancel">取消</button>
                    </div>
                </div>
            `;

            const formWrapper = document.createElement('div');
            formWrapper.className = 'promptlens-form-wrapper';
            formWrapper.innerHTML = formHtml;
            container.insertBefore(formWrapper, container.firstChild);

            const noteInput = container.querySelector('#promptlens-capture-note');
            if (noteInput) noteInput.focus();

            container.querySelector('#promptlens-capture-save')?.addEventListener('click', () => {
                const note = container.querySelector('#promptlens-capture-note')?.value?.trim() || '';
                SnapshotEngine.capture(note);
                formWrapper.remove();
            });

            container.querySelector('#promptlens-capture-cancel')?.addEventListener('click', () => {
                formWrapper.remove();
            });
        },

        /** 更新底部状态栏 */
        _updateStatusBar() {
            if (!panelEl) return;
            const countEl = panelEl.querySelector('#promptlens-statusbar-count');
            if (countEl) {
                const noteCount = Storage.getNotes().length;
                const snapCount = Storage.getSnapshots().length;
                countEl.textContent = `共 ${noteCount} 条笔记 · ${snapCount} 个快照`;
            }

            //★ 更新状态文字，显示当前环境
            const statusText = panelEl.querySelector('#promptlens-statusbar-text');
            if (statusText) {
                if (_currentModel || _currentPresetName) {
                    statusText.textContent = `${_currentModel || '?'} · ${_currentPresetName || '?'}`;
                } else {
                    statusText.textContent = '就绪';
                }
            }
        },

        /** 面板拖拽开始 */
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
                    panelEl.style.top = newTop + 'px';
                    panelEl.style.right = 'auto';
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
                            top: parseInt(panelEl.style.top),},
                    });
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        },

        /** HTML 转义 */
        _escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        },
    };

    // ═══ MODULE7FloatingPanel 结束 ═══

    //┌─────────────────────────────────────────────────────────┐
    // │  MODULE 8: UI — 选中收藏气泡 SaveBubble                │
    // └─────────────────────────────────────────────────────────┘

    const SaveBubble = {
        _bubbleEl: null,
        _hideTimer: null,

        /** 初始化全局 mouseup 监听 */
        init() {
            document.addEventListener('mouseup', (e) => {
                if (!pluginEnabled) return;
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

        /** 提取选中文字所在的楼层信息 */
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
                }
                return null;
            } catch (e) {
                return null;
            }
        },

        /** 显示收藏气泡 */
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
            this._bubbleEl.innerHTML = '📓 收藏到掠影';

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

        /** 隐藏收藏气泡 */
        hide() {
            clearTimeout(this._hideTimer);
            if (this._bubbleEl) {
                this._bubbleEl.remove();
                this._bubbleEl = null;
            }
        },
    };

    // ═══ MODULE 8 SaveBubble 结束 ═══
    // ┌─────────────────────────────────────────────────────────┐
// │  MODULE 8b: 思维链捕获 ThinkingCapture                  │
// └─────────────────────────────────────────────────────────┘

const ThinkingCapture = {

    /**
     * 从楼层 DOM 中提取思维链内容
     * @param {string|number} mesId - 楼层 mesid
     * @returns {string|null} 提取到的思维链文本，未找到返回 null
     */
    extractFromFloor(mesId) {
        try {
            const mesEl = document.querySelector(`.mes[mesid="${mesId}"]`);
            if (!mesEl) {
                Logger.warn(`思维链提取失败 — 未找到楼层 #${mesId}`);
                return null;
            }

            // ★ 从消息文本容器取原始文本（包含标签）
            // ST 的消息内容在 .mes_text 里，但已经过 HTML 渲染
            // 需要从 mesEl 的 dataset 或原始文本里取
            const mesTextEl = mesEl.querySelector('.mes_text');
            if (!mesTextEl) {
                Logger.warn(`思维链提取失败 — 楼层 #${mesId} 未找到 .mes_text`);
                return null;
            }

            // 取 innerText（保留换行，去掉 HTML 标签）
            const rawText = mesTextEl.innerText || mesTextEl.textContent || '';

            const settings = Storage.getSettings();
            const tagOpen  = (settings.thinkingTagOpen  || '<thinking>').trim();
            const tagClose = (settings.thinkingTagClose || '</thinking>').trim();

            return this._extractBetweenTags(rawText, tagOpen, tagClose, mesId);
        } catch (err) {
            Logger.error(`思维链提取异常 — 楼层 #${mesId}`, err);
            return null;
        }
    },

    /**
     * 在文本中提取所有 tagOpen…tagClose 之间的内容
     * 支持多段（一条消息里有多个思维链块）
     * @param {string} text
     * @param {string} tagOpen
     * @param {string} tagClose
     * @param {string|number} mesId - 仅用于日志
     * @returns {string|null}
     */
    _extractBetweenTags(text, tagOpen, tagClose, mesId) {
        const results = [];
        let searchFrom = 0;

        while (true) {
            const startIdx = text.indexOf(tagOpen, searchFrom);
            if (startIdx === -1) break;

            const contentStart = startIdx + tagOpen.length;
            const endIdx = text.indexOf(tagClose, contentStart);

            if (endIdx === -1) {
                // 有开始标签但没有结束标签，取到末尾
                const content = text.slice(contentStart).trim();
                if (content) results.push(content);
                break;
            }

            const content = text.slice(contentStart, endIdx).trim();
            if (content) results.push(content);
            searchFrom = endIdx + tagClose.length;
        }

        if (results.length === 0) {
            Logger.warn(`思维链提取 — 楼层 #${mesId} 未找到标签 "${tagOpen}...${tagClose}"`);
            return null;
        }

        const combined = results.join('\n\n---\n\n');
        Logger.info(`思维链提取成功 — 楼层 #${mesId}，共 ${results.length} 段，${combined.length} 字符`);
        return combined;
    },

    /**
     * 提取并保存为笔记
     * @param {string|number} mesId
     */
    captureAndSave(mesId) {
        const content = this.extractFromFloor(mesId);
        if (!content) {
            // 给用户一个视觉反馈
            this._flashButton(mesId, '❌', '#e74c3c');
            return;
        }

        NoteManager.add({
            content,
            tags: ['思维链'],
            sourceFloor: parseInt(mesId),
            sourceMessageId: String(mesId),
        });

        this._flashButton(mesId, '✓', '#27ae60');
        Logger.success(`思维链已保存为笔记 — 楼层 #${mesId}`);
    },

    /**
     * 按钮点击反馈：短暂改变图标和颜色
     * @param {string|number} mesId
     * @param {string} icon
     * @param {string} color
     */
    _flashButton(mesId, icon, color) {
        const btn = document.querySelector(
            `.mes[mesid="${mesId}"] .promptlens-thinking-btn`
        );
        if (!btn) return;
        const original = btn.innerHTML;
        btn.innerHTML = icon;
        btn.style.color = color;
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.color = '';
        }, 1500);
    },

    /**
     * 向指定楼层注入「收藏思维链」按钮
     * 幂等：已存在则跳过
     * @param {string|number} mesId
     */
    injectButton(mesId) {
        try {
            const mesEl = document.querySelector(`.mes[mesid="${mesId}"]`);
            if (!mesEl) return;

            // ★ 只给 AI 消息注入（is_user 属性为 false 的楼层）
            if (mesEl.getAttribute('is_user') === 'true') return;

            const extraBtns = mesEl.querySelector('.extraMesButtons');
            if (!extraBtns) return;

            // 幂等检查
            if (extraBtns.querySelector('.promptlens-thinking-btn')) return;

            const btn = document.createElement('div');
            btn.className = 'mes_button promptlens-thinking-btn';
            btn.title = '收藏思维链到掠影';
            btn.innerHTML = '🧠';

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                ThinkingCapture.captureAndSave(mesId);
            });

            // ★ 插到 extraMesButtons 的第一个位置
            extraBtns.insertBefore(btn, extraBtns.firstChild);

            Logger.info(`思维链按钮已注入 — 楼层 #${mesId}`);
        } catch (err) {
            Logger.error(`思维链按钮注入失败 — 楼层 #${mesId}`, err);
        }
    },

    /**
     * 初始化：监听消息渲染事件 + 补注入已有楼层
     */
    init() {
        try {
            const eventSource = window.eventSource ||
                (typeof SillyTavern !== 'undefined' && SillyTavern.eventSource);
            const eventTypes = window.event_types ||
                (typeof SillyTavern !== 'undefined' && SillyTavern.event_types);

            if (eventSource && eventTypes?.CHARACTER_MESSAGE_RENDERED !== undefined) {
                eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (mesId) => {
                    if (!pluginEnabled) return;
                    // ST 传来的 mesId 可能是数字或字符串，统一处理
                    this.injectButton(String(mesId));
                });
                Logger.success('思维链按钮监听已启用 (CHARACTER_MESSAGE_RENDERED)');
            } else {
                Logger.warn('思维链：未找到 ST 事件系统，按钮将不会自动注入');
            }

            // ★ 补注入：对当前页面已有的所有 AI 楼层注入按钮
            this._injectAll();
        } catch (err) {
            Logger.error('ThinkingCapture 初始化失败', err);
        }
    },

    /**
     * 遍历当前页面所有 AI 楼层，补注入按钮
     */
    _injectAll() {
        const allMes = document.querySelectorAll('.mes[mesid]');
        let count = 0;
        allMes.forEach(el => {
            if (el.getAttribute('is_user') === 'true') return;
            const mesId = el.getAttribute('mesid');
            if (mesId) {
                this.injectButton(mesId);
                count++;
            }
        });
        if (count > 0) {
            Logger.info(`思维链按钮补注入完成 — 共处理 ${count} 条 AI 消息`);
        }
    },
};

// ═══ MODULE 8b ThinkingCapture 结束 ═══

    // ┌─────────────────────────────────────────────────────────┐
    // │  辅助函数                │
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

    //┌─────────────────────────────────────────────────────────┐
    // │  MODULE 9: 配置面板注入 + 主入口                        │
    // └─────────────────────────────────────────────────────────┘

    /**★ 手动 fetch settings.html 并注入到 Extensions 面板 */
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
                Logger.warn('Extensions 面板容器未找到，将在2 秒后重试...');
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

            const wrapper = document.createElement('div');
            wrapper.id = 'promptlens-extension-block';
            wrapper.classList.add('extension_container');
            wrapper.innerHTML = html;
            container.appendChild(wrapper);

            Logger.success('配置面板已注入到 Extensions 设置区域');
            return true;

        } catch (err) {
            Logger.error('配置面板加载失败', err);
            Logger.info('尝试使用内联降级方案创建配置面板...');
            createFallbackSettingsPanel();
            return false;
        }
    }

    /** ★ 降级方案：如果 fetch 失败，用纯 JS 创建面板 */
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
                    <div id="promptlens-log-container" style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;max-height:220px;min-height:80px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.7;">
                        <div class="promptlens-log-empty" style="color:#555;text-align:center;padding:16px 0;font-style:italic;">暂无日志</div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px;">
                        <button id="promptlens-log-clear" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">清空日志</button>
                        <button id="promptlens-log-copy" style="padding:5px 12px;border:1px solid rgba(255,255,255,0.1);border-radius:6px;background:rgba(255,255,255,0.04);color:#bbb;font-size:12px;cursor:pointer;">复制日志</button>
                    </div>
                </div>

                <div style="height:1px;background:rgba(255,255,255,0.06);margin:12px 0;"></div>
                                <div style="height:1px;background:rgba(255,255,255,0.06);margin:12px 0;"></div>

                <div>
                    <div style="font-size:12px;font-weight:600;color:#999;margin-bottom:8px;">思维链设置</div>
                    <div style="font-size:12px;color:#666;margin-bottom:10px;">设置思维链的包裹标签，点击楼层的 🧠 按钮可自动提取并收藏</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
                        <label style="font-size:12px;color:#999;white-space:nowrap;width:52px;">开始标签</label>
                        <input type="text" id="promptlens-thinking-open"
                            placeholder="<thinking>"
                            style="flex:1;padding:5px 10px;background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#ccc;font-size:12px;font-family:monospace;" />
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <label style="font-size:12px;color:#999;white-space:nowrap;width:52px;">结束标签</label>
                        <input type="text" id="promptlens-thinking-close"
                            placeholder="</thinking>"
                            style="flex:1;padding:5px 10px;background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#ccc;font-size:12px;font-family:monospace;" />
                    </div>
                </div>


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

    /**绑定 settings 面板中的所有事件 */
    function bindSettingsEvents() {
        // ★ 折叠/展开功能
        const collapseToggle = document.querySelector('#promptlens-collapse-toggle');
        const collapseBody = document.querySelector('#promptlens-settings-body');
        const collapseArrow = document.querySelector('#promptlens-collapse-arrow');

        if (collapseToggle && collapseBody && collapseArrow) {
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
           // ★ 用 setAttribute 而不是直接赋值，避免触发 change 事件
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

        
                // ★ 思维链标签设置
        const thinkingOpenInput  = document.querySelector('#promptlens-thinking-open');
        const thinkingCloseInput = document.querySelector('#promptlens-thinking-close');

        if (thinkingOpenInput) {
            thinkingOpenInput.value = Storage.getSettings().thinkingTagOpen || '<thinking>';
            thinkingOpenInput.addEventListener('change', () => {
                const val = thinkingOpenInput.value.trim();
                if (val) {
                    Storage.updateSettings({ thinkingTagOpen: val });
                    Logger.info(`思维链开始标签已更新: ${val}`);
                }
            });
        }
        if (thinkingCloseInput) {
            thinkingCloseInput.value = Storage.getSettings().thinkingTagClose || '</thinking>';
            thinkingCloseInput.addEventListener('change', () => {
                const val = thinkingCloseInput.value.trim();
                if (val) {
                    Storage.updateSettings({ thinkingTagClose: val });
                    Logger.info(`思维链结束标签已更新: ${val}`);
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

    /**★ 主初始化 */
    function init() {
       // ★ 防止重复初始化导致状态混乱
    if (fabEl || panelEl) {
        shutdown();
    }
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

        // ★ 根据设置决定是否显示悬浮球
        if (settings.fabVisible !== false) {
            FloatingBall.create();
        } else {
            Logger.info('悬浮球已设置为隐藏');
        }

        FloatingPanel.create();
        SaveBubble.init();
        ThinkingCapture.init();

        if (SnapshotEngine.hasChanged()) {
            FloatingBall.setChanged(true);
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        Logger.success(`插件初始化完成，耗时 ${elapsed}ms`);
    }
    // ═══ init 结束 ═══

    /** 关闭插件 */
    function shutdown() {
        EventBridge.destroy();
        FloatingBall.destroy();
        FloatingPanel.destroy();
        Logger.info('插件已关闭');
    }
    // ═══ shutdown 结束 ═══

    //┌─────────────────────────────────────────────────────────┐
    // │  启动                                                   │
    // └─────────────────────────────────────────────────────────┘

    if (typeof jQuery !== 'undefined') {
        jQuery(async () => {
            //1. 先注入配置面板到 Extensions 区域
            await loadSettingsPanel();

            // 2. 绑定配置面板事件（此时 DOM 已存在）
            bindSettingsEvents();

            // 3. 初始化插件主体
            init();

            // ★ 4. 延迟再次读取环境状态（等ST 完全加载）
            setTimeout(() => {
                if (pluginEnabled) {
                    EventBridge._readCurrentState();
                    FloatingPanel._updateStatusBar();
                    Logger.info('延迟环境状态刷新完成');
                }
            }, 3000);
        });
    } else {
        document.addEventListener('DOMContentLoaded', async () => {
            await loadSettingsPanel();
            bindSettingsEvents();
            init();setTimeout(() => {
                if (pluginEnabled) {
                    EventBridge._readCurrentState();
                    FloatingPanel._updateStatusBar();
                }
            }, 3000);
        });
    }

    // ═══ MODULE 9 主入口 结束 ═══

})();





