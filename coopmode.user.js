// ==UserScript==
// @name         AMQ Answer Bridge
// @namespace    https://github.com/<your-username>/amq-answer-bridge
// @version      1.7
// @description  Плавающая панель: Send Answer + Auto Send + Copy All Messages. Без префикса "Answer:". Собственные сообщения не дублируются в поле ответа.
// @author       <your-username>
// @license      MIT
// @match        https://animemusicquiz.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /* ============ Конфиг ============ */

    const ANSWER_INPUT_SELECTORS = [
        '#qpAnswerInput',
        '#answerInput',
        '.awesomplete input',
        'input.awesomplete',
        '.awesomplete'
    ];

    const GC_INPUT     = '#gcInput';
    const GC_MESSAGE   = '.gcMessage';
    const PANEL_ID     = 'amq-bridge-panel';
    const STORAGE_POS  = 'amq-bridge-panel-pos';
    const STORAGE_AUTO = 'amq-bridge-auto-send';
    const STORAGE_COPY = 'amq-bridge-copy-all';

    const DRAG_THRESHOLD       = 4;
    const COPY_ALL_DEBOUNCE_MS = 250;
    const AUTOCOMPLETE_WAIT_MS = 100;
    const ECHO_WINDOW_MS       = 3000; // сколько помним свои отправленные тексты

    /* ============ Утилиты ============ */

    function findAnswerInput() {
        for (const sel of ANSWER_INPUT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) {
                if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                    const inner = el.querySelector('input, textarea');
                    if (inner) return inner;
                }
                return el;
            }
        }
        return null;
    }

    function pressEnter(el) {
        const opts = {
            key: 'Enter', code: 'Enter',
            keyCode: 13, which: 13,
            bubbles: true, cancelable: true, composed: true
        };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keypress', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    function isAutoSendEnabled() {
        const cb = document.getElementById('amq-bridge-auto-send');
        return cb ? cb.checked : false;
    }

    function isCopyAllEnabled() {
        const cb = document.getElementById('amq-bridge-copy-all');
        return cb ? cb.checked : false;
    }

    /* ============ Анти-эхо для собственных сообщений ============ */

    const recentlySent = new Map(); // text -> timestamp

    function markSent(text) {
        const t = (text || '').trim();
        if (!t) return;
        recentlySent.set(t, Date.now());
        // подчищаем старые записи
        const now = Date.now();
        for (const [k, ts] of recentlySent) {
            if (now - ts > ECHO_WINDOW_MS) recentlySent.delete(k);
        }
    }

    function wasRecentlySent(text) {
        const t = (text || '').trim();
        const ts = recentlySent.get(t);
        if (!ts) return false;
        if (Date.now() - ts < ECHO_WINDOW_MS) return true;
        recentlySent.delete(t);
        return false;
    }

    /**
     * Определяем, является ли сообщение "своим".
     * AMQ помечает свои сообщения одним из классов, но на разных версиях бывает по-разному,
     * поэтому пробуем несколько вариантов + fallback на сравнение имени отправителя.
     */
    function isOwnMessage(msgEl) {
        if (!msgEl) return false;
        const ownClasses = ['self', 'own', 'gcMessageSelf', 'selfMessage', 'myMessage'];

        if (ownClasses.some(c => msgEl.classList.contains(c))) return true;
        if (msgEl.parentElement &&
            ownClasses.some(c => msgEl.parentElement.classList.contains(c))) return true;

        // Fallback: сравнить имя отправителя с собственным
        try {
            const ownName = quiz?.ownName || window.quiz?.ownName;
            if (ownName) {
                const nameEl = msgEl.querySelector(
                    '.gcMessageName, .chatMessageName, .gcMessageSender, .gcMessageAuthor'
                );
                if (nameEl && nameEl.textContent.trim() === ownName) return true;
            }
        } catch (_) {}

        return false;
    }

    /* ============ Отправка в чат ============ */

    function sendAnswerToChat(text) {
        const raw = (text || '').trim();
        if (!raw) return;
        const gcInput = document.querySelector(GC_INPUT);
        if (!gcInput) { console.warn('[AMQ Bridge] #gcInput не найден'); return; }

        gcInput.focus();
        gcInput.value = raw; // без префикса
        gcInput.dispatchEvent(new Event('input',  { bubbles: true }));
        gcInput.dispatchEvent(new Event('change', { bubbles: true }));

        markSent(raw);
        setTimeout(() => pressEnter(gcInput), 30);
    }

    /* ============ Single Enter (из приложенного скрипта) ============ */

    function getFirstSuggestionSync() {
        try {
            const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;
            return instance?.suggestions?.[0]?.value || '';
        } catch (_) { return ''; }
    }

    function waitForSuggestion(maxTimeout = AUTOCOMPLETE_WAIT_MS) {
        return new Promise(resolve => {
            const ul = document.querySelector('#qpAnswerInputContainer .awesomplete ul');
            if (!ul) { resolve(getFirstSuggestionSync()); return; }

            const getFirst = () =>
                ul.querySelector('li')?.textContent.trim() || getFirstSuggestionSync();

            if (!ul.hasAttribute('hidden')) { resolve(getFirst()); return; }

            const observer = new MutationObserver(() => {
                if (!ul.hasAttribute('hidden')) finish(getFirst());
            });

            const finish = (val) => {
                clearTimeout(timeout);
                observer.disconnect();
                resolve(val);
            };

            const timeout = setTimeout(() => finish(getFirst()), maxTimeout);
            observer.observe(ul, { attributes: true, attributeFilter: ['hidden'] });
        });
    }

    async function submitWithSingleEnter(fallbackText) {
        const ansInput = findAnswerInput();
        if (!ansInput) return;

        let finalAnswer = (fallbackText || ansInput.value || '').trim();
        if (!finalAnswer) return;

        try {
            const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;

            let highlighted = '';
            if (instance?.$ul) {
                highlighted = instance.$ul
                    .children('li')
                    .filter('[aria-selected="true"]')
                    .text()
                    .trim();
            }

            let suggestion = highlighted;
            if (!suggestion) suggestion = await waitForSuggestion(AUTOCOMPLETE_WAIT_MS);
            if (suggestion) finalAnswer = suggestion;
        } catch (err) {
            console.warn('[AMQ Bridge] suggestion lookup failed:', err);
        }

        ansInput.value = finalAnswer;
        ansInput.dispatchEvent(new Event('input', { bubbles: true }));

        try {
            if (quiz?.answerInput?.submitAnswer) quiz.answerInput.submitAnswer(true);
            const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;
            if (instance?.close) instance.close();
        } catch (err) {
            console.warn('[AMQ Bridge] submit failed:', err);
        }
    }

    /* ============ Плавающая панель ============ */

    let panelMoved = false;

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        Object.assign(panel.style, {
            position: 'fixed',
            left: '20px',
            top: '20px',
            zIndex: '999999',
            display: 'inline-flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px 10px',
            background: '#000000',
            border: '1px solid #ffffff',
            borderRadius: '6px',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            fontSize: '12px',
            color: '#ffffff',
            userSelect: 'none',
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
            colorScheme: 'dark',
            cursor: 'grab',
        });

        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_POS) || 'null');
            if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
                panel.style.left = saved.x + 'px';
                panel.style.top  = saved.y + 'px';
            }
        } catch (_) {}

        const btn = document.createElement('button');
        btn.id = 'amq-bridge-btn';
        btn.type = 'button';
        btn.textContent = 'Send Answer';
        Object.assign(btn.style, {
            padding: '6px 14px',
            fontFamily: 'inherit',
            fontSize: '12px',
            fontWeight: '500',
            letterSpacing: '0.4px',
            color: '#000000',
            background: '#ffffff',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background 0.12s ease, color 0.12s ease',
        });
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#000000';
            btn.style.color = '#ffffff';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#ffffff';
            btn.style.color = '#000000';
        });
        btn.addEventListener('click', (e) => {
            if (panelMoved) return;
            e.preventDefault();
            const ansInput = findAnswerInput();
            if (!ansInput) return;
            const text = (ansInput.value || '').trim();
            if (!text) return;
            sendAnswerToChat(text);
        });

        const autoLabel = document.createElement('label');
        autoLabel.style.cssText =
            'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;';
        autoLabel.innerHTML = `<input type="checkbox" id="amq-bridge-auto-send" style="margin:0;cursor:pointer;"> Auto Send`;

        const copyLabel = document.createElement('label');
        copyLabel.style.cssText =
            'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;';
        copyLabel.innerHTML = `<input type="checkbox" id="amq-bridge-copy-all" style="margin:0;cursor:pointer;"> Copy All Messages`;

        panel.appendChild(btn);
        panel.appendChild(autoLabel);
        panel.appendChild(copyLabel);
        document.body.appendChild(panel);

        const cbAuto = document.getElementById('amq-bridge-auto-send');
        const cbCopy = document.getElementById('amq-bridge-copy-all');
        cbAuto.checked = localStorage.getItem(STORAGE_AUTO) === 'true';
        cbCopy.checked = localStorage.getItem(STORAGE_COPY) === 'true';
        cbAuto.addEventListener('change', () => localStorage.setItem(STORAGE_AUTO, cbAuto.checked));
        cbCopy.addEventListener('change', () => localStorage.setItem(STORAGE_COPY, cbCopy.checked));

        // Перетаскивание панели
        let dragging = false, offsetX = 0, offsetY = 0;

        const onMouseMove = (e) => {
            if (!dragging) return;
            if (Math.abs(e.clientX - panel._startX) > DRAG_THRESHOLD ||
                Math.abs(e.clientY - panel._startY) > DRAG_THRESHOLD) {
                panelMoved = true;
            }
            if (panelMoved) {
                let newLeft = e.clientX - offsetX;
                let newTop  = e.clientY - offsetY;
                const w = window.innerWidth, h = window.innerHeight;
                const bw = panel.offsetWidth, bh = panel.offsetHeight;
                newLeft = Math.max(0, Math.min(newLeft, w - bw));
                newTop  = Math.max(0, Math.min(newTop,  h - bh));
                panel.style.left = newLeft + 'px';
                panel.style.top  = newTop  + 'px';
            }
        };

        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            panel.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (panelMoved) {
                try {
                    localStorage.setItem(STORAGE_POS, JSON.stringify({
                        x: parseInt(panel.style.left, 10) || 0,
                        y: parseInt(panel.style.top,  10) || 0,
                    }));
                } catch (_) {}
            }
        };

        panel.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            panelMoved = false;
            if (e.target.closest('button, label, input')) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            panel._startX = e.clientX;
            panel._startY = e.clientY;
            panel.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        panel.addEventListener('click', () => {
            if (panelMoved) setTimeout(() => { panelMoved = false; }, 0);
        }, true);
    }

    createPanel();

    /* ============ Auto Send: перехват Enter в поле ответа ============ */

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        if (!isAutoSendEnabled()) return;

        const input = findAnswerInput();
        if (!input || e.target !== input) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();

        const text = (input.value || '').trim();
        if (!text) return;

        sendAnswerToChat(text);
    }, true);

    /* ============ Reader ============ */

    function findChatContainer() {
        return (
            document.querySelector('#gameChatPage') ||
            document.querySelector('#gameChatMessageContainer') ||
            document.querySelector('#gameChatPageWrapper') ||
            (document.querySelector(GC_MESSAGE) || {}).parentElement ||
            null
        );
    }

    let copyAllTimer = null;

    function setupReader() {
        const container = findChatContainer();
        if (!container) { setTimeout(setupReader, 2000); return; }

        const processed = new WeakSet();

        const processMessage = async (msgEl) => {
            if (processed.has(msgEl)) return;
            processed.add(msgEl);

            // 1. Свои сообщения пропускаем полностью
            if (isOwnMessage(msgEl)) return;

            // 2. Текст без префикса — целиком
            const text = (msgEl.textContent || '').trim();
            if (!text) return;

            // 3. Анти-эхо: если этот текст недавно сами отправили — пропускаем
            if (wasRecentlySent(text)) return;

            // 4. Reader работает только при включённом Copy All
            if (!isCopyAllEnabled()) return;

            const ansInput = findAnswerInput();
            if (!ansInput) return;

            // Показываем сразу в поле
            ansInput.value = text;
            ansInput.dispatchEvent(new Event('input', { bubbles: true }));

            // Дебаунс на отправку — если прилетит новее, заменим
            if (copyAllTimer) clearTimeout(copyAllTimer);
            copyAllTimer = setTimeout(() => {
                copyAllTimer = null;
                const latest = findAnswerInput()?.value || text;
                submitWithSingleEnter(latest);
            }, COPY_ALL_DEBOUNCE_MS);
        };

        const observer = new MutationObserver((mutations) => {
            for (const mut of mutations) {
                if (!mut.addedNodes || !mut.addedNodes.length) continue;
                for (const node of mut.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches(GC_MESSAGE)) processMessage(node);
                    if (node.querySelectorAll) {
                        const inner = node.querySelectorAll(GC_MESSAGE);
                        for (let i = 0; i < inner.length; i++) processMessage(inner[i]);
                    }
                }
            }
        });

        observer.observe(container, { childList: true, subtree: true });
    }

    setupReader();
})();
