// ==UserScript==
// @name         AMQ Answer Bridge
// @namespace    https://github.com/denerou/amq-answer-bridge
// @version      1.5
// @description  
// @author       You
// @license      MIT
// @match        https://animemusicquiz.com/*
// @grant        none
// @run-at       document-end
// @homepageURL  https://github.com/denerou/amq-answer-bridge
// @supportURL   https://github.com/denerou/amq-answer-bridge/issues
// @updateURL    https://raw.githubusercontent.com/denerou/amq-answer-bridge/main/amq-answer-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/denerou/amq-answer-bridge/main/amq-answer-bridge.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* ======================= Конфигурация ======================= */

    // Селекторы поля ответа — проверяются по порядку, первый найденный используется
    const ANSWER_INPUT_SELECTORS = [
        '#answerInput',
        '#qpAnswerInput',
        '.awesomplete input',
        'input.awesomplete',
        'textarea.awesomplete',
        '.awesomplete'
    ];

    const GC_INPUT       = '#gcInput';        // поле ввода игрового чата
    const GC_MESSAGE     = '.gcMessage';      // сообщения игрового чата
    const ANSWER_PREFIX  = 'Answer:';         // префикс, по которому reader распознаёт ответы
    const BUTTON_ID      = 'amq-answer-bridge-btn';
    const STORAGE_KEY    = 'amq-bridge-btn-pos';
    const DRAG_THRESHOLD = 4;                 // px — меньше этого считаем кликом, больше — перетаскиванием

    /* ======================= Утилиты ======================= */

    function findAnswerInput() {
        for (const sel of ANSWER_INPUT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) {
                // Если нашли контейнер, а не сам input/textarea — берём вложенный
                if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                    const inner = el.querySelector('input, textarea');
                    if (inner) return inner;
                }
                return el;
            }
        }
        return null;
    }

    // Имитация нажатия Enter. AMQ проверяет keyCode/which, поэтому дублируем их.
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

    /* ======================= Плавающая кнопка ======================= */

    function createButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.textContent = 'Send Answer';
        btn.title = 'Перетащи меня • Клик = отправить ответ в чат';

        Object.assign(btn.style, {
            position: 'fixed',
            left: '20px',
            top: '20px',
            zIndex: '999999',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 14px',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            fontSize: '12px',
            fontWeight: '500',
            letterSpacing: '0.4px',
            color: '#ffffff',
            background: '#000000',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
            cursor: 'grab',
            userSelect: 'none',
            touchAction: 'none',
            transition: 'background 0.12s ease, color 0.12s ease',
        });

        // Hover: инверсия чёрное ↔ белое
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#ffffff';
            btn.style.color = '#000000';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#000000';
            btn.style.color = '#ffffff';
        });

        // ---------- Восстановление позиции из localStorage ----------
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
                btn.style.left = saved.x + 'px';
                btn.style.top  = saved.y + 'px';
            }
        } catch (_) { /* ignore */ }

        // ---------- Перетаскивание ----------
        let dragging = false;
        let moved = false;
        let offsetX = 0;
        let offsetY = 0;

        const onMouseMove = (e) => {
            if (!dragging) return;
            const dx = e.clientX - (btn._startX || 0);
            const dy = e.clientY - (btn._startY || 0);
            if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
                moved = true;
            }
            if (moved) {
                let newLeft = e.clientX - offsetX;
                let newTop  = e.clientY - offsetY;
                const w = window.innerWidth;
                const h = window.innerHeight;
                const bw = btn.offsetWidth;
                const bh = btn.offsetHeight;
                newLeft = Math.max(0, Math.min(newLeft, w - bw));
                newTop  = Math.max(0, Math.min(newTop,  h - bh));
                btn.style.left = newLeft + 'px';
                btn.style.top  = newTop  + 'px';
            }
        };

        const onMouseUp = () => {
            if (!dragging) return;
            dragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            btn.style.cursor = 'grab';

            if (moved) {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({
                        x: parseInt(btn.style.left, 10) || 0,
                        y: parseInt(btn.style.top, 10) || 0,
                    }));
                } catch (_) { /* ignore */ }
            }
        };

        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            moved = false;
            const rect = btn.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            btn._startX = e.clientX;
            btn._startY = e.clientY;
            btn.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        // ---------- Клик: собрать ответ и отправить в чат ----------
        btn.addEventListener('click', (e) => {
            if (moved) { moved = false; return; }
            e.preventDefault();

            const ansInput = findAnswerInput();
            const gcInput  = document.querySelector(GC_INPUT);
            if (!ansInput) { console.warn('[AMQ Bridge] Поле ответа не найдено'); return; }
            if (!gcInput)  { console.warn('[AMQ Bridge] #gcInput не найден'); return; }

            const text = (ansInput.value || '').trim();
            if (!text) return;

            gcInput.focus();
            gcInput.value = ANSWER_PREFIX + ' ' + text;
            gcInput.dispatchEvent(new Event('input',  { bubbles: true }));
            gcInput.dispatchEvent(new Event('change', { bubbles: true }));

            // Небольшая задержка, чтобы интерфейс AMQ успел обработать input
            setTimeout(() => pressEnter(gcInput), 30);
        });

        document.body.appendChild(btn);
        console.log('[AMQ Bridge] Кнопка добавлена');
    }

    createButton();

    /* ======================= Reader игрового чата ======================= */

    function findChatContainer() {
        return (
            document.querySelector('#gameChatPage') ||
            document.querySelector('#gameChatMessageContainer') ||
            document.querySelector('#gameChatPageWrapper') ||
            (document.querySelector(GC_MESSAGE) || {}).parentElement ||
            null
        );
    }

    function setupReader() {
        const container = findChatContainer();
        if (!container) { setTimeout(setupReader, 2000); return; }

        const processed = new WeakSet();

        const processMessage = (msgEl) => {
            if (processed.has(msgEl)) return;
            processed.add(msgEl);

            const text = msgEl.textContent || '';
            const match = text.match(/Answer:\s*([^\n]+)/i);
            if (!match) return;
            const extracted = match[1].trim();
            if (!extracted) return;

            const ansInput = findAnswerInput();
            if (!ansInput) return;
            if (ansInput.value === extracted) return; // защита от циклов

            ansInput.value = extracted;
            ansInput.dispatchEvent(new Event('input', { bubbles: true }));
        };

        // Наблюдаем ТОЛЬКО контейнер чата, а не всю страницу — иначе лаги
        const observer = new MutationObserver((mutations) => {
            for (const mut of mutations) {
                if (!mut.addedNodes || !mut.addedNodes.length) continue;
                for (const node of mut.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches(GC_MESSAGE)) {
                        processMessage(node);
                    }
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