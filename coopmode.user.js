// ==UserScript==
// @name         AMQ Coop Mode
// @namespace    https://github.com/denerou/AMQ_Coop_Mode
// @version      2.3
// @description  
// @author       denero
// @license      MIT
// @match        https://animemusicquiz.com/*
// @match        https://*.animemusicquiz.com/*
// @grant        none
// @run-at       document-end
// @homepageURL  https://github.com/denerou/AMQ_Coop_Mode
// @supportURL   https://github.com/denerou/AMQ_Coop_Mode/issues
// @updateURL    https://raw.githubusercontent.com/denerou/AMQ_Coop_Mode/main/coopmode.user.js
// @downloadURL  https://raw.githubusercontent.com/denerou/AMQ_Coop_Mode/main/coopmode.user.js
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
    const STORAGE_COPY = 'amq-bridge-copy-last';

    // Формат сообщений при ОТПРАВКЕ в чат (и при ЧТЕНИИ формата)
    const CHAT_PREFIX  = 'Answer: ';

    const DRAG_THRESHOLD       = 4;
    const COPY_ALL_DEBOUNCE_MS = 250;
    const AUTOCOMPLETE_WAIT_MS = 100;
    const ECHO_WINDOW_MS       = 4000;

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

    function isCopyLastEnabled() {
        const cb = document.getElementById('amq-bridge-copy-last');
        return cb ? cb.checked : false;
    }

    // Извлечение чистого текста сообщения (без имени и времени)
    function getMessageText(msgEl) {
        const textEl = msgEl.querySelector('.gcMessageText, .chatMessageText, .gcMessageContent');
        if (textEl) return textEl.textContent.trim();
        
        const nameEl = msgEl.querySelector('.gcMessageName, .chatMessageName');
        if (nameEl && msgEl.contains(nameEl)) {
            const fullText = msgEl.textContent.trim();
            const nameText = nameEl.textContent.trim();
            let text = fullText;
            const idx = text.indexOf(nameText);
            if (idx !== -1) {
                text = text.substring(idx + nameText.length);
            }
            text = text.replace(/^\s*:\s*/, '');
            return text.trim();
        }
        
        return msgEl.textContent.trim();
    }

    /* ============ Анти-эхо ============ */

    const recentlySent = new Map();

    function markSent(text) {
        const t = (text || '').trim();
        if (!t) return;
        recentlySent.set(t, Date.now());
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

    function isOwnMessage(msgEl) {
        if (!msgEl) return false;
        const ownClasses = ['self', 'own', 'gcMessageSelf', 'selfMessage', 'myMessage'];
        if (ownClasses.some(c => msgEl.classList.contains(c))) return true;
        if (msgEl.parentElement && ownClasses.some(c => msgEl.parentElement.classList.contains(c))) return true;

        try {
            const ownName = quiz?.ownName || window.quiz?.ownName;
            if (ownName) {
                const nameEl = msgEl.querySelector('.gcMessageName, .chatMessageName, .gcMessageSender, .gcMessageAuthor');
                if (nameEl) {
                    const cleanName = nameEl.textContent.replace(/:\s*$/, '').trim();
                    if (cleanName === ownName) return true;
                }
            }
        } catch (_) {}
        return false;
    }

    /* ============ Отправка в чат ============ */

    function sendAnswerToChat(text) {
        const raw = (text || '').trim();
        if (!raw) return;
        const gcInput = document.querySelector(GC_INPUT);
        if (!gcInput) return;

        // Отправляем строго в формате: Answer: <текст>
        const payload = CHAT_PREFIX + raw;
        const prevActive = document.activeElement;

        gcInput.focus();
        gcInput.value = payload;
        gcInput.dispatchEvent(new Event('input',  { bubbles: true }));
        gcInput.dispatchEvent(new Event('change', { bubbles: true }));

        markSent(payload);
        markSent(raw); // Запоминаем и чистый текст
        
        setTimeout(() => {
            pressEnter(gcInput);
            if (prevActive && prevActive.focus) {
                setTimeout(() => prevActive.focus(), 10);
            }
        }, 30);
    }

    /* ============ Single Enter ============ */

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

            const getFirst = () => ul.querySelector('li')?.textContent.trim() || getFirstSuggestionSync();
            if (!ul.hasAttribute("hidden")) { resolve(getFirst()); return; }

            const observer = new MutationObserver(() => {
                if (!ul.hasAttribute("hidden")) finish(getFirst());
            });

            const finish = (val) => {
                clearTimeout(timeout);
                observer.disconnect();
                resolve(val);
            };

            const timeout = setTimeout(() => finish(getFirst()), maxTimeout);
            observer.observe(ul, { attributes: true, attributeFilter: ["hidden"] });
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
                highlighted = instance.$ul.children("li").filter('[aria-selected="true"]').text().trim();
            }
            let suggestion = highlighted;
            if (!suggestion) suggestion = await waitForSuggestion(AUTOCOMPLETE_WAIT_MS);
            if (suggestion) finalAnswer = suggestion;
        } catch (err) {}

        ansInput.value = finalAnswer;
        ansInput.dispatchEvent(new Event('input', { bubbles: true }));

        try {
            if (quiz?.answerInput?.submitAnswer) quiz.answerInput.submitAnswer(true);
            const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;
            if (instance?.close) instance.close();
        } catch (err) {}
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
            display: 'flex',
            flexDirection: 'column',
            gap: '0',
            padding: '8px',
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

        const header = document.createElement('div');
        header.style.cssText = 'display:flex; align-items:center; gap:6px;';

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

        const btnToggle = document.createElement('button');
        btnToggle.textContent = '▼';
        Object.assign(btnToggle.style, {
            padding: '4px 8px',
            fontFamily: 'inherit',
            fontSize: '12px',
            fontWeight: '500',
            color: '#ffffff',
            background: '#000000',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            cursor: 'pointer',
            lineHeight: '1',
            width: '28px',
            textAlign: 'center'
        });
        btnToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (settings.style.display === 'none' || settings.style.display === '') {
                settings.style.display = 'flex';
                btnToggle.textContent = '▲';
            } else {
                settings.style.display = 'none';
                btnToggle.textContent = '▼';
            }
        });

        header.appendChild(btn);
        header.appendChild(btnToggle);

        const settings = document.createElement('div');
        Object.assign(settings.style, {
            display: 'none',
            flexDirection: 'column',
            gap: '4px',
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid rgba(255,255,255,0.2)',
        });

        const autoLabel = document.createElement('label');
        autoLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;';
        autoLabel.innerHTML = `<input type="checkbox" id="amq-bridge-auto-send" style="margin:0;cursor:pointer;"> Auto Send`;

        const copyLabel = document.createElement('label');
        copyLabel.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;';
        copyLabel.innerHTML = `<input type="checkbox" id="amq-bridge-copy-last" style="margin:0;cursor:pointer;"> Copy last message`;

        settings.appendChild(autoLabel);
        settings.appendChild(copyLabel);

        panel.appendChild(header);
        panel.appendChild(settings);
        document.body.appendChild(panel);

        const cbAuto = document.getElementById('amq-bridge-auto-send');
        const cbCopy = document.getElementById('amq-bridge-copy-last');
        cbAuto.checked = localStorage.getItem(STORAGE_AUTO) === 'true';
        cbCopy.checked = localStorage.getItem(STORAGE_COPY) === 'true';
        cbAuto.addEventListener('change', () => localStorage.setItem(STORAGE_AUTO, cbAuto.checked));
        cbCopy.addEventListener('change', () => localStorage.setItem(STORAGE_COPY, cbCopy.checked));

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

    /* ============ Auto Send ============ */

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        if (!isAutoSendEnabled()) return;

        const input = findAnswerInput();
        if (!input || e.target !== input) return;

        let textToSend = '';
        try {
            const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;
            if (instance?.$ul) {
                const highlighted = instance.$ul.children("li").filter('[aria-selected="true"]').text().trim();
                if (highlighted) textToSend = highlighted;
            }
        } catch (_) {}

        if (!textToSend) {
            textToSend = (input.value || '').trim();
        }

        if (textToSend) {
            setTimeout(() => sendAnswerToChat(textToSend), 50);
        }
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

    let copyLastTimer = null;

    function setupReader() {
        const container = findChatContainer();
        if (!container) { setTimeout(setupReader, 2000); return; }

        const processed = new WeakSet();

        const processMessage = async (msgEl) => {
            try {
                if (processed.has(msgEl)) return;
                processed.add(msgEl);

                // 1. Игнорируем свои сообщения
                if (isOwnMessage(msgEl)) return;

                // 2. Извлекаем текст
                let text = getMessageText(msgEl);
                if (!text) return;

                // 3. Проверяем, есть ли формат "Answer: "
                const hasFormat = text.startsWith(CHAT_PREFIX);

                if (hasFormat) {
                    // Отрезаем префикс
                    text = text.substring(CHAT_PREFIX.length).trim();
                } else {
                    // Если префикса нет, проверяем включена ли галочка Copy last message
                    if (!isCopyLastEnabled()) return;
                }

                if (!text) return;

                // 4. Проверка на эхо
                if (wasRecentlySent(text)) return;

                const ansInput = findAnswerInput();
                if (!ansInput) return;

                // Вставляем в поле
                ansInput.value = text;
                ansInput.dispatchEvent(new Event('input', { bubbles: true }));

                // Дебаунс на отправку
                if (copyLastTimer) clearTimeout(copyLastTimer);
                copyLastTimer = setTimeout(() => {
                    copyLastTimer = null;
                    const latest = findAnswerInput()?.value || text;
                    submitWithSingleEnter(latest);
                }, COPY_ALL_DEBOUNCE_MS);

            } catch (err) {
                console.error('[AMQ Bridge] Error processing message:', err);
            }
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
