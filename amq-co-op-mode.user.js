// ==UserScript==
// @name         AMQ Co-op Mode
// @namespace    https://github.com/denerou/amq-co-op-mode.user.js
// @version      1.0.0
// @description  
// @author       denerou
// @license      MIT
// @match        https://animemusicquiz.com/*
// @match        https://*.animemusicquiz.com/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/denerou/AMQ_Coop_Mode/main/amq-co-op-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/denerou/AMQ_Coop_Mode/main/amq-co-op-mode.user.js
// ==/UserScript==

(function () {
    'use strict';

    const ANSWER_INPUT_SELECTORS = [
        '.awesomplete > input[type="text"]',
        '.awesomplete input[type="text"]',
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
    const STORAGE_RECV = 'amq-bridge-receive';

    const CHAT_PREFIX  = 'Answer: ';

    const DRAG_THRESHOLD       = 4;
    const COPY_ALL_DEBOUNCE_MS = 250;
    const ECHO_WINDOW_MS       = 4000;

    function findAnswerInput() {
        for (const sel of ANSWER_INPUT_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) {
                if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
                    const inner = el.querySelector('input[type="text"], input, textarea');
                    if (inner) return inner;
                }
                return el;
            }
        }
        return null;
    }

    function forceFocusAnswerInput() {
        const ansInput = findAnswerInput();
        if (!ansInput) return;
        try {
            ansInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            ansInput.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            ansInput.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            ansInput.focus();
        } catch (e) {}
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

    function isReceiveEnabled() {
        const cb = document.getElementById('amq-bridge-receive');
        return cb ? cb.checked : (localStorage.getItem(STORAGE_RECV) !== 'false');
    }

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

    function sendAnswerToChat(text) {
        const raw = (text || '').trim();
        if (!raw) return;
        const gcInput = document.querySelector(GC_INPUT);
        if (!gcInput) return;

        const payload = CHAT_PREFIX + raw;
        
        const ansInput = findAnswerInput();
        const wasFocused = ansInput && (document.activeElement === ansInput || ansInput.contains(document.activeElement));
        const prevActive = document.activeElement;

        gcInput.focus();
        gcInput.value = payload;
        gcInput.dispatchEvent(new Event('input',  { bubbles: true }));
        gcInput.dispatchEvent(new Event('change', { bubbles: true }));

        markSent(payload);
        markSent(raw);
        
        setTimeout(() => {
            pressEnter(gcInput);
            
            setTimeout(() => {
                if (wasFocused && ansInput) {
                    forceFocusAnswerInput();
                } else if (prevActive && prevActive.focus && prevActive !== document.body) {
                    prevActive.focus();
                }
            }, 100);
        }, 30); 
    }

    function selectFirstSuggestionAndSubmit(fallbackText) {
        const ansInput = findAnswerInput();
        if (!ansInput) return;

        ansInput.value = fallbackText;
        ansInput.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
            try {
                const instance = quiz?.answerInput?.typingInput?.autoCompleteController?.awesomepleteInstance;
                let finalVal = fallbackText;

                if (instance && instance.$ul && !instance.$ul.hasClass('hidden') && instance.suggestions && instance.suggestions.length > 0) {
                    finalVal = instance.suggestions[0].value;
                    ansInput.value = finalVal;
                    ansInput.dispatchEvent(new Event('input', { bubbles: true }));
                }

                if (instance && typeof instance.close === 'function') {
                    instance.close();
                }

                if (quiz && quiz.answerInput && typeof quiz.answerInput.submitAnswer === 'function') {
                    quiz.answerInput.submitAnswer(true);
                }
            } catch (e) {}
        }, 50);
    }

    let panelMoved = false;

    function togglePanel() {
        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            createPanel();
            panel = document.getElementById(PANEL_ID);
        }
        
        if (panel) {
            if (panel.style.display === 'none') {
                panel.style.display = 'flex';
            } else {
                panel.style.display = 'none';
            }
        }
    }

    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        Object.assign(panel.style, {
            position: 'fixed',
            left: '20px',
            top: '20px',
            zIndex: '999999',
            display: 'none',
            flexDirection: 'column',
            gap: '0',
            padding: '8px',
            background: '#333',
            border: 'none',
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
            color: '#333',
            background: '#ffffff',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background 0.12s ease, color 0.12s ease',
        });
        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#333';
            btn.style.color = '#ffffff';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#ffffff';
            btn.style.color = '#333';
        });
        
        btn.addEventListener('mousedown', e => e.preventDefault());

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
            background: '#333',
            border: '1px solid #ffffff',
            borderRadius: '4px',
            cursor: 'pointer',
            lineHeight: '1',
            width: '28px',
            textAlign: 'center'
        });
        btnToggle.addEventListener('mousedown', e => e.preventDefault());
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
            borderTop: '1px solid rgba(255,255,255,0.15)',
        });

        const labelStyle = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;';
        const cbStyle = 'margin:0;cursor:pointer; width: 15px; height: 15px;';

        const autoLabel = document.createElement('label');
        autoLabel.style.cssText = labelStyle;
        autoLabel.innerHTML = `<input type="checkbox" id="amq-bridge-auto-send" style="${cbStyle}"> Auto Send`;

        const copyLabel = document.createElement('label');
        copyLabel.style.cssText = labelStyle;
        copyLabel.innerHTML = `<input type="checkbox" id="amq-bridge-copy-last" style="${cbStyle}"> Copy last message`;

        const receiveLabel = document.createElement('label');
        receiveLabel.style.cssText = labelStyle;
        receiveLabel.innerHTML = `<input type="checkbox" id="amq-bridge-receive" style="${cbStyle}"> Receive Answers`;

        settings.appendChild(autoLabel);
        settings.appendChild(copyLabel);
        settings.appendChild(receiveLabel);

        panel.appendChild(header);
        panel.appendChild(settings);
        document.body.appendChild(panel);

        const cbAuto = document.getElementById('amq-bridge-auto-send');
        const cbCopy = document.getElementById('amq-bridge-copy-last');
        const cbRecv = document.getElementById('amq-bridge-receive');

        cbAuto.checked = localStorage.getItem(STORAGE_AUTO) === 'true';
        cbCopy.checked = localStorage.getItem(STORAGE_COPY) === 'true';
        cbRecv.checked = localStorage.getItem(STORAGE_RECV) !== 'false';

        cbAuto.addEventListener('change', () => localStorage.setItem(STORAGE_AUTO, cbAuto.checked));
        cbCopy.addEventListener('change', () => localStorage.setItem(STORAGE_COPY, cbCopy.checked));
        cbRecv.addEventListener('change', () => localStorage.setItem(STORAGE_RECV, cbRecv.checked));

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
            
            if (e.target.closest('button')) {
                e.preventDefault();
            }

            if (e.target.closest('button, label, input')) return;
            
            panelMoved = false;
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

    function injectCoopButton() {
        if (document.getElementById("qpCoop")) return;
        const $container = $("#qpOptionContainer");
        if ($container.length === 0) return;
        
        const $settings = $("#qpSettings");
        if ($settings.length === 0) return; 

        const s = window.getComputedStyle($settings[0]);

        const svgIcon = `
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;">
                <path d="M5 8 L19 8 M15 4 L19 8 L15 12" />
                <path d="M19 16 L5 16 M9 12 L5 16 L9 20" />
            </svg>
        `;

        const $btn = $("<div>", { id: "qpCoop", class: "clickAble qpOption" })
            .css({
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: s.margin,
                padding: s.padding,
                width: s.width !== 'auto' ? s.width : '35px',
                height: s.height !== 'auto' ? s.height : '100%',
                boxSizing: "border-box"
            })
            .append(svgIcon)
            .on("click", (e) => {
                e.preventDefault();
                togglePanel();
            })
            .on("mousedown", (e) => {
                e.preventDefault(); 
            })
            .popover({
                content: "Coop Mode",
                trigger: "hover",
                placement: "bottom"
            });

        $container.width((index, w) => w + 35);
        $container.children("div").first().append($btn);
    }

    createPanel();
    setInterval(injectCoopButton, 1000);
    injectCoopButton();

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        if (!isAutoSendEnabled()) return;

        const input = findAnswerInput();
        if (!input) return;
        
        if (e.target !== input && !input.contains(e.target)) return;

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

                if (!isReceiveEnabled()) return;
                if (isOwnMessage(msgEl)) return;

                let text = getMessageText(msgEl);
                if (!text) return;

                const match = text.match(/Answer:\s*(.*)/i);
                let extracted = "";
                
                if (match) {
                    extracted = match[1].trim();
                } else {
                    if (!isCopyLastEnabled()) return;
                    extracted = text;
                }

                if (!extracted) return;
                if (wasRecentlySent(extracted)) return;

                const ansInput = findAnswerInput();
                if (!ansInput) return;
                
                const wasFocused = document.activeElement === ansInput || ansInput.contains(document.activeElement);

                ansInput.value = extracted;
                ansInput.dispatchEvent(new Event('input', { bubbles: true }));
                if (wasFocused) forceFocusAnswerInput();

                if (copyLastTimer) clearTimeout(copyLastTimer);
                copyLastTimer = setTimeout(() => {
                    copyLastTimer = null;
                    selectFirstSuggestionAndSubmit(extracted);
                }, COPY_ALL_DEBOUNCE_MS);

            } catch (err) {}
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
