(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const source = $('source');
  const output = $('output');
  const draftKey = 'postform.draft.v3';
  const preferencesKey = 'postform.preferences.v1';
  const example = `A small update with **35 big possibilities**.

Keep your **bold text and numbers**, add a little *emphasis*, and give each idea some room.

- Write something useful.
- Make it easy to read.
- Share it with your people.`;
  let mode = 'unicode';
  let saveTimer;
  let noticeTimer;
  let copyTimer;
  let revision = 0;
  let editorRange = null;
  let draftDirty = false;
  let applyingCaps = false;
  let storageAvailable = true;
  function readSaved(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { storageAvailable = false; return null; }
  }
  const legacyDraft = readSaved('postform.draft.v2') || readSaved('postform.draft.v1');
  function cleanSavedDraft(value) {
    if (!value || (typeof value.html !== 'string' && typeof value.text !== 'string')) return null;
    const html = sanitizeEditorHtml(typeof value.html === 'string' ? value.html : PostFormatter.toEditorHtml(value.text));
    const container = document.createElement('div'); container.innerHTML = html;
    return container.textContent.trim() ? { version: 3, html, text: richTextToMarkdown(html).markdown } : null;
  }
  let savedDraft = cleanSavedDraft(readSaved(draftKey));
  const migratedDraft = savedDraft ? null : cleanSavedDraft(legacyDraft);
  if (migratedDraft) {
    savedDraft = migratedDraft;
    try { localStorage.setItem(draftKey, JSON.stringify(savedDraft)); } catch (_) { storageAvailable = false; }
  }
  const preferences = readSaved(preferencesKey) || legacyDraft || {};
  for (const key of ['spacing', 'font']) {
    if (Array.from($(key).options).some(option => option.value === preferences[key])) $(key).value = preferences[key];
  }
  $('linkStyle').value = preferences.linkStyle === 'newline' ? 'newline' : 'colon';
  mode = ['unicode', 'plain', 'rough'].includes(preferences.mode) ? preferences.mode : preferences.plain === true ? 'plain' : 'unicode';
  $('richPaste').checked = preferences.richPaste !== false;
  source.innerHTML = '';

  function roughDraftHtml() {
    const clone = source.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => node.nodeType === Node.TEXT_NODE || node.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });
    const groups = [];
    let node;
    while ((node = walker.nextNode())) {
      const block = node.parentElement.closest('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6') || clone;
      let group = groups[groups.length - 1];
      if (!group || group.block !== block) { group = { block, nodes: [] }; groups.push(group); }
      group.nodes.push(node);
    }
    for (const group of groups) {
      const runs = group.nodes.map(textNode => ({
        text: textNode.nodeType === Node.TEXT_NODE ? textNode.nodeValue : '\n',
        caps: textNode.parentElement.closest('[data-postform-caps="true"]') !== null,
        literal: textNode.parentElement.closest('code,pre') !== null,
        atomic: textNode.parentElement.closest('a') !== null
      }));
      const transformed = PostFormatter.transformRoughRuns(runs, { sentenceSpacing: !group.block.closest('li,pre') });
      transformed.forEach((run, index) => {
        if (group.nodes[index].nodeType === Node.TEXT_NODE) group.nodes[index].nodeValue = run.text;
      });
    }
    return clone.innerHTML;
  }
  function draftMarkdown(rough = false) { return richTextToMarkdown(rough ? roughDraftHtml() : source.innerHTML).markdown; }
  function snapshot() { return { version: 3, html: sanitizeEditorHtml(source.innerHTML), text: draftMarkdown() }; }

  function options() {
    return { spacing: $('spacing').value, font: $('font').value, linkStyle: $('linkStyle').value, mode, plain: mode === 'plain' };
  }
  function notice(message, isError = false, persistent = false) {
    clearTimeout(noticeTimer);
    $('notice').textContent = message;
    $('notice').classList.toggle('error', isError);
    if (!persistent) noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 6500);
  }
  function updateRestore() {
    $('restoreDraft').hidden = !savedDraft || !!source.textContent.trim();
  }
  function savePreferences() {
    try { localStorage.setItem(preferencesKey, JSON.stringify({ ...options(), richPaste: $('richPaste').checked })); }
    catch (_) { storageAvailable = false; }
    if (!storageAvailable) $('saveStatus').textContent = 'Draft kept in this tab';
  }
  function flushDraft() {
    clearTimeout(saveTimer);
    if (!draftDirty) return;
    const current = source.textContent.trim() ? snapshot() : null;
    savedDraft = current;
    try {
      if (current) localStorage.setItem(draftKey, JSON.stringify(current));
      else {
        localStorage.removeItem(draftKey);
        localStorage.removeItem('postform.draft.v2');
        localStorage.removeItem('postform.draft.v1');
      }
      $('saveStatus').textContent = current ? 'Draft saved on this device' : 'Draft cleared';
    } catch (_) { storageAvailable = false; $('saveStatus').textContent = 'Draft kept in this tab'; }
    updateRestore();
  }
  function saveDraft() {
    draftDirty = true;
    clearTimeout(saveTimer);
    $('saveStatus').textContent = 'Saving…';
    saveTimer = setTimeout(flushDraft, 250);
  }
  function render(persist = true, draftChanged = false) {
    revision++;
    if (persist) { clearTimeout(noticeTimer); $('notice').textContent = ''; }
    clearTimeout(copyTimer);
    $('copyLabel').textContent = 'Copy post';
    output.value = PostFormatter.format(draftMarkdown(mode === 'rough'), { ...options(), spacing: mode === 'rough' ? 'roomy' : $('spacing').value });
    source.classList.toggle('is-empty', !source.textContent.trim());
    source.classList.toggle('rough-active', mode === 'rough');
    const count = PostFormatter.countCodePoints(output.value);
    $('characterCount').textContent = count.toLocaleString() + ' character' + (count === 1 ? '' : 's');
    $('copyPost').disabled = !output.value.trim();
    $('downloadText').disabled = !output.value.trim();
    $('selectOutput').disabled = !output.value;
    for (const name of ['unicode', 'plain', 'rough']) {
      $(name + 'Mode').classList.toggle('active', mode === name);
      $(name + 'Mode').setAttribute('aria-pressed', String(mode === name));
    }
    $('font').disabled = mode === 'plain';
    $('spacing').disabled = mode === 'rough';
    $('roughSpacingNote').hidden = mode !== 'rough';
    $('capsText').hidden = mode !== 'rough';
    $('outputDescription').textContent = mode === 'plain' ? 'Plain text preview' : mode === 'rough' ? 'Rough preview · sentence spacing' : 'Unicode preview';
    updateRestore();
    updateToolbar();
    if (persist) savePreferences();
    if (draftChanged) saveDraft();
  }
  source.addEventListener('input', () => { if (!applyingCaps) render(true, true); });
  for (const key of ['spacing', 'font', 'linkStyle']) $(key).addEventListener('change', () => {
    render();
  });
  $('richPaste').addEventListener('change', savePreferences);
  for (const name of ['unicode', 'plain', 'rough']) $(name + 'Mode').addEventListener('click', () => { mode = name; render(); });
  // Preserve the native undo stack for paste, formatting, and replacing a draft.
  function rememberSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount && source.contains(selection.anchorNode) && source.contains(selection.focusNode)) editorRange = selection.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    source.focus();
    const selection = window.getSelection();
    if (editorRange && source.contains(editorRange.commonAncestorContainer)) {
      selection.removeAllRanges(); selection.addRange(editorRange);
    } else {
      const range = document.createRange(); range.selectNodeContents(source); range.collapse(false);
      selection.removeAllRanges(); selection.addRange(range);
    }
  }
  function insertEditorHtml(html) {
    restoreSelection();
    const selection = window.getSelection();
    const selected = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (selected && !selected.collapsed && selected.toString() === source.textContent) {
      // Browsers retain the old list around insertHTML when every item is
      // selected. Delete that selection first and leave the list before pasting.
      document.execCommand('delete', false, null);
      for (const command of ['insertUnorderedList', 'insertOrderedList', 'bold', 'italic']) {
        if (document.queryCommandState(command)) document.execCommand(command, false, null);
      }
    }
    let applied = false;
    try { applied = document.execCommand('insertHTML', false, html); } catch (_) { /* Range fallback below. */ }
    if (!applied) {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0); range.deleteContents();
      const fragment = range.createContextualFragment(html);
      const last = fragment.lastChild;
      range.insertNode(fragment);
      if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
    }
    rememberSelection(); render(true, true);
  }
  function replaceDraft(text) {
    const range = document.createRange(); range.selectNodeContents(source); editorRange = range;
    insertEditorHtml(PostFormatter.toEditorHtml(text));
    if (!text) { source.innerHTML = ''; editorRange = null; render(true, true); }
  }
  $('clearDraft').addEventListener('click', () => { replaceDraft(''); flushDraft(); notice('Draft and saved backup cleared.'); });
  $('restoreDraft').addEventListener('click', () => {
    if (!savedDraft || source.textContent.trim()) return;
    const range = document.createRange(); range.selectNodeContents(source); editorRange = range;
    insertEditorHtml(sanitizeEditorHtml(savedDraft.html)); flushDraft(); notice('Previous draft restored.');
  });
  $('loadExample').addEventListener('click', () => { replaceDraft(example); });
  $('selectOutput').addEventListener('click', () => { output.focus(); output.select(); });

  function selectedTextNodes(range) {
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !range.intersectsNode(node)) continue;
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (end > start && node.nodeValue.slice(start, end).trim()) nodes.push(node);
    }
    return nodes;
  }
  function restoreTextSelection(start, end) {
    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0, started = false, node;
    while ((node = walker.nextNode())) {
      if (!started && start <= offset + node.length) { range.setStart(node, Math.max(0, start - offset)); started = true; }
      if (started && end <= offset + node.length) {
        range.setEnd(node, Math.max(0, end - offset));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); rememberSelection(); return;
      }
      offset += node.length;
    }
  }
  function selectionBlock(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return element?.closest('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6');
  }
  $('capsText').addEventListener('click', () => {
    if (mode !== 'rough') return;
    restoreSelection();
    const selected = getSelection().getRangeAt(0).cloneRange();
    const nodes = selectedTextNodes(selected);
    if (!nodes.length) return;
    const mark = !nodes.every(node => node.parentElement.closest('[data-postform-caps="true"]'));
    const sourcePrefix = document.createRange(); sourcePrefix.selectNodeContents(source);
    sourcePrefix.setEnd(selected.startContainer, selected.startOffset);
    const globalStart = sourcePrefix.toString().length;
    const globalEnd = globalStart + selected.toString().length;
    const expanded = selected.cloneRange();
    const first = selectionBlock(selected.startContainer), last = selectionBlock(selected.endContainer);
    // Include surrounding inline content so insertHTML cannot inherit a CAPS
    // wrapper we are removing, and retain inherited bold/italic ancestors.
    if (first && first !== source) expanded.setStart(first, 0);
    if (last && last !== source) expanded.setEnd(last, last.childNodes.length);
    const prefix = expanded.cloneRange(); prefix.setEnd(selected.startContainer, selected.startOffset);
    const selectedStart = prefix.toString().length;
    const selectedEnd = selectedStart + selected.toString().length;
    const fragment = expanded.cloneContents();
    const oldMarkers = Array.from(fragment.querySelectorAll('[data-postform-caps]'));
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const leaves = [];
    let node, offset = 0;
    while ((node = walker.nextNode())) {
      leaves.push({ node, start: offset, end: offset + node.length, caps: !!node.parentElement?.closest('[data-postform-caps="true"]') });
      offset += node.length;
    }
    for (const leaf of leaves) {
      const text = leaf.node.nodeValue;
      const cuts = [0, Math.max(0, Math.min(text.length, selectedStart - leaf.start)), Math.max(0, Math.min(text.length, selectedEnd - leaf.start)), text.length].sort((a, b) => a - b);
      const replacement = document.createDocumentFragment();
      for (let index = 1; index < cuts.length; index++) {
        const from = cuts[index - 1], to = cuts[index];
        if (to <= from) continue;
        const inSelection = leaf.start + from >= selectedStart && leaf.start + to <= selectedEnd;
        const caps = inSelection ? mark : leaf.caps;
        const part = document.createTextNode(text.slice(from, to));
        if (caps) {
          const span = document.createElement('span'); span.dataset.postformCaps = 'true'; span.appendChild(part); replacement.appendChild(span);
        } else replacement.appendChild(part);
      }
      leaf.node.replaceWith(replacement);
    }
    // Only unwrap the old markers; new per-leaf markers preserve the selection
    // without wrapping paragraphs or changing bold/italic ancestors.
    for (const marker of oldMarkers) marker.replaceWith(...marker.childNodes);
    const container = document.createElement('div'); container.appendChild(fragment);
    editorRange = expanded;
    // Chrome serializes a live text decoration into inline styles during
    // insertHTML. Hide the annotation cue until the native undoable edit ends.
    applyingCaps = true;
    source.classList.remove('rough-active');
    try {
      restoreSelection();
      document.execCommand('insertHTML', false, container.innerHTML);
    } finally {
      applyingCaps = false;
      source.classList.toggle('rough-active', mode === 'rough');
    }
    restoreTextSelection(globalStart, globalEnd); render(true, true);
  });

  function sanitizeEditorHtml(html) {
    const template = document.createElement('template'); template.innerHTML = html;
    const rejected = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'HEAD', 'META', 'LINK', 'TEMPLATE']);
    const allowed = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'A', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'BLOCKQUOTE']);
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue);
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return document.createDocumentFragment();
      if (rejected.has(node.tagName) || node.hasAttribute?.('hidden')) return document.createDocumentFragment();
      if (node.tagName === 'IMG') return document.createTextNode(node.getAttribute('alt') || '');
      const heading = /^H[1-6]$/.test(node.tagName || '');
      const element = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : heading ? document.createElement('p') : document.createDocumentFragment();
      if (element.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          if (/^(https?:\/\/|mailto:)/i.test(href)) element.setAttribute('href', href);
        }
        if (node.tagName === 'OL' || node.tagName === 'LI') {
          const attr = node.tagName === 'OL' ? 'start' : 'value';
          if (/^-?\d{1,9}$/.test(node.getAttribute(attr) || '')) element.setAttribute(attr, node.getAttribute(attr));
        }
        if (node.tagName === 'SPAN' && node.getAttribute('data-postform-caps') === 'true') element.setAttribute('data-postform-caps', 'true');
        if (heading) element.style.fontWeight = 'bold';
        if (/^(normal|bold|bolder|[1-9]00)$/.test(node.style.fontWeight)) element.style.fontWeight = node.style.fontWeight;
        if (/^(normal|italic|oblique)$/.test(node.style.fontStyle)) element.style.fontStyle = node.style.fontStyle;
      }
      for (const child of node.childNodes) element.appendChild(clean(child));
      return element;
    }
    const container = document.createElement('div'); container.appendChild(clean(template.content));
    return container.innerHTML;
  }

  function updateToolbar() {
    const selection = window.getSelection();
    const inside = selection.rangeCount && source.contains(selection.anchorNode);
    for (const [id, command] of [['boldText', 'bold'], ['italicText', 'italic'], ['bulletList', 'insertUnorderedList']]) {
      let active = false;
      try { active = !!inside && document.queryCommandState(command); } catch (_) { /* Browser may not report state. */ }
      $(id).setAttribute('aria-pressed', String(active));
    }
    const capsNodes = inside && !selection.isCollapsed ? selectedTextNodes(selection.getRangeAt(0)) : [];
    $('capsText').disabled = !capsNodes.length;
    $('capsText').setAttribute('aria-pressed', String(capsNodes.length > 0 && capsNodes.every(node => node.parentElement.closest('[data-postform-caps="true"]'))));
  }
  document.addEventListener('selectionchange', () => { rememberSelection(); updateToolbar(); });
  for (const button of document.querySelectorAll('.format-button')) {
    button.addEventListener('mousedown', event => event.preventDefault());
    if (button.dataset.command) button.addEventListener('click', () => {
      restoreSelection(); document.execCommand(button.dataset.command, false, null); rememberSelection(); render(true, true);
    });
  }
  source.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
      event.preventDefault(); document.execCommand(event.key.toLowerCase() === 'b' ? 'bold' : 'italic', false, null); rememberSelection(); render(true, true);
    }
  });
  const linkDialog = $('linkDialog');
  function openLinkDialog(anchor) {
    rememberSelection();
    if (anchor) {
      const range = document.createRange(); range.selectNodeContents(anchor); editorRange = range;
    }
    const selected = editorRange ? editorRange.toString() : '';
    $('linkText').value = selected;
    $('linkUrl').value = anchor?.getAttribute('href') || '';
    $('removeLink').hidden = !anchor;
    $('linkError').textContent = '';
    linkDialog.showModal();
    (selected ? $('linkUrl') : $('linkText')).focus();
  }
  $('editLink').addEventListener('click', () => {
    const node = editorRange?.startContainer;
    openLinkDialog((node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('a'));
  });
  source.addEventListener('click', event => {
    const anchor = event.target.closest('a');
    if (anchor) { event.preventDefault(); openLinkDialog(anchor); }
  });
  $('cancelLink').addEventListener('click', () => { linkDialog.close(); restoreSelection(); });
  $('removeLink').addEventListener('click', () => {
    linkDialog.close(); restoreSelection(); document.execCommand('unlink', false, null); rememberSelection(); render(true, true);
  });
  $('linkForm').addEventListener('submit', event => {
    event.preventDefault();
    let url = $('linkUrl').value.trim();
    if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = 'https://' + url;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) { $('linkError').textContent = 'Use an https://, http://, or mailto: link.'; return; }
    try { const parsed = new URL(url); if (parsed.protocol !== 'mailto:' && !parsed.hostname) throw new Error(); } catch (_) { $('linkError').textContent = 'Enter a valid URL.'; return; }
    const label = $('linkText').value;
    linkDialog.close(); restoreSelection();
    if (editorRange && !editorRange.collapsed && editorRange.toString() === label) {
      document.execCommand('createLink', false, url); rememberSelection(); render(true, true);
    } else {
      const anchor = document.createElement('a'); anchor.setAttribute('href', url); anchor.textContent = label;
      insertEditorHtml(anchor.outerHTML);
    }
  });

  async function copyPost() {
    if (!output.value.trim()) return;
    const copiedRevision = revision;
    const text = output.value;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); copied = true; }
    } catch (_) { /* A file:// browser may need the selection fallback. */ }
    if (!copied) {
      // Never silently copy a newer render while an earlier clipboard request was pending.
      const fallback = document.createElement('textarea');
      fallback.value = text; fallback.setAttribute('aria-label', 'Post to copy');
      fallback.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;';
      document.body.appendChild(fallback); fallback.focus(); fallback.select();
      try { copied = document.execCommand('copy'); } catch (_) { /* Select visible output below. */ }
      fallback.remove();
    }
    if (copied) {
      if (revision === copiedRevision) $('copyLabel').textContent = 'Copied!';
      notice('Copied. Paste the whole post into LinkedIn or X.');
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { $('copyLabel').textContent = 'Copy post'; }, 2400);
      $('copyPost').focus();
    } else {
      output.focus(); output.select();
      notice('Your browser blocked clipboard access. The post is selected — press Ctrl+C (⌘C on Mac).', true, true);
    }
  }
  $('copyPost').addEventListener('click', copyPost);
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); copyPost(); }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelector('.keyboard-hint').textContent = '⌘ ↵';

  function download(data, filename, type) {
    const blob = new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $('downloadText').addEventListener('click', () => download(output.value, 'formatted-post.txt', 'text/plain;charset=utf-8'));
  $('saveTool').addEventListener('click', () => {
    // Build a fresh copy from the document without carrying the current draft or saved state.
    const clean = document.documentElement.cloneNode(true);
    clean.querySelector('#source').textContent = '';
    clean.querySelector('#output').textContent = '';
    clean.querySelector('#notice').textContent = '';
    clean.querySelector('#optionsPanel').removeAttribute('open');
    for (const select of clean.querySelectorAll('select')) for (const option of select.options) option.removeAttribute('selected');
    download('<!doctype html>\n' + clean.outerHTML, 'Postform.html', 'text/html;charset=utf-8');
    notice('App downloaded. Open Postform.html to use it offline.');
  });

  function richTextToMarkdown(html) {
    // Inert template: pasted markup is never added to the live document or executed.
    const template = document.createElement('template');
    template.innerHTML = html;
    const root = template.content;
    let meaningful = false;
    const ignored = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'HEAD', 'META', 'LINK']);
    const escapeMarkdown = text => text.replace(/([\\`*_\[\]])/g, '\\$1');
    const raw = text => ({ text, raw: true });
    function trimFragments(fragments) {
      const result = fragments.map(part => ({ ...part }));
      while (result.length && !result[0].text.trimStart()) result.shift();
      while (result.length && !result[result.length - 1].text.trimEnd()) result.pop();
      if (result.length) {
        result[0].text = result[0].text.trimStart();
        result[result.length - 1].text = result[result.length - 1].text.trimEnd();
      }
      return result;
    }
    function codeDelimiter(text, minimum = 1) {
      const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
      return '`'.repeat(Math.max(minimum, longest + 1));
    }
    function walk(node, context = {}) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (context.bold || context.italic) meaningful = true;
        return [{ text: escapeMarkdown(node.nodeValue.replace(/\u00a0/g, ' ')), bold: !!context.bold, italic: !!context.italic }];
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return [];
      const tag = node.tagName;
      if (ignored.has(tag) || node.hasAttribute?.('hidden')) return [];
      if (tag === 'BR') return [raw('\n')];
      if (tag === 'IMG') return [{ text: escapeMarkdown(node.getAttribute('alt') || ''), bold: !!context.bold, italic: !!context.italic }];
      if (tag === 'PRE') {
        meaningful = true;
        const text = node.textContent.replace(/\n$/, '');
        const fence = codeDelimiter(text, 3);
        return [raw('\n\n' + fence + '\n' + text + '\n' + fence + '\n\n')];
      }
      if (tag === 'CODE') {
        meaningful = true;
        const text = node.textContent;
        const marker = codeDelimiter(text);
        const padding = /^`|`$/.test(text) || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
        return [raw(marker + padding + text + padding + marker)];
      }
      const style = node.getAttribute?.('style') || '';
      const weight = /(?:^|;)\s*font-weight\s*:\s*(bold(?:er)?|[6-9]00)\b/i.test(style);
      const normalWeight = /(?:^|;)\s*font-weight\s*:\s*(normal|[1-5]00)\b/i.test(style);
      const normalItalic = /(?:^|;)\s*font-style\s*:\s*normal\b/i.test(style);
      // Google Docs wraps clipboard HTML in <b style="font-weight: normal">.
      const isBold = (!normalWeight && (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag || ''))) || weight;
      const isItalic = (!normalItalic && (tag === 'I' || tag === 'EM')) || /(?:^|;)\s*font-style\s*:\s*(italic|oblique)\b/i.test(style);
      const nextContext = {
        bold: normalWeight ? false : isBold || !!context.bold,
        italic: normalItalic ? false : isItalic || !!context.italic
      };
      let value = Array.from(node.childNodes).flatMap(child => walk(child, nextContext));
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^(https?:\/\/|mailto:)/i.test(href)) {
          meaningful = true;
          value = [raw('['), ...trimFragments(value), raw('](' + href.replace(/\s/g, char => encodeURIComponent(char)) + ')')];
        }
      }
      if (tag === 'LI') {
        const parent = node.parentElement;
        let marker = '- ';
        if (parent?.tagName === 'OL') {
          const siblings = Array.from(parent.children).filter(child => child.tagName === 'LI');
          const start = Number.parseInt(parent.getAttribute('start') || '1', 10);
          const explicit = Number.parseInt(node.getAttribute('value'), 10);
          marker = (Number.isFinite(explicit) ? explicit : (Number.isFinite(start) ? start : 1) + siblings.indexOf(node)) + '. ';
        }
        meaningful = true;
        return [raw(marker), ...trimFragments(value), raw('\n')];
      }
      if (tag === 'UL' || tag === 'OL') return [raw('\n\n'), ...trimFragments(value), raw('\n\n')];
      if (['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE'].includes(tag) || /^H[1-6]$/.test(tag || '')) return [raw('\n\n'), ...trimFragments(value), raw('\n\n')];
      return value;
    }
    // Keep shared styles open across adjacent text nodes, and close them before
    // whitespace boundaries or raw Markdown. This preserves child style resets
    // and prevents emphasis delimiters from straddling separate source lines.
    const fragments = [];
    for (const part of walk(root)) {
      const previous = fragments[fragments.length - 1];
      if (previous && !part.raw && !previous.raw && part.bold === previous.bold && part.italic === previous.italic) previous.text += part.text;
      else fragments.push({ ...part });
    }
    let markdown = '';
    const active = [];
    const marker = style => style === 'bold' ? '**' : '*';
    function transition(desired) {
      let keep = 0;
      while (keep < active.length && desired[active[keep]]) keep++;
      while (active.length > keep) markdown += marker(active.pop());
      for (const style of desired.styleOrder || ['bold', 'italic']) if (desired[style] && !active.includes(style)) {
        active.push(style); markdown += marker(style);
      }
    }
    for (const [fragmentIndex, part] of fragments.entries()) {
      if (part.raw) { transition({}); markdown += part.text; continue; }
      if (part.bold && part.italic) {
        // When both styles begin together, keep the next surviving style outside
        // so a child reset can close only the inner delimiter.
        for (let next = fragmentIndex + 1; next < fragments.length; next++) {
          const upcoming = fragments[next];
          if (upcoming.raw || (!upcoming.bold && !upcoming.italic)) break;
          if (upcoming.bold !== upcoming.italic) {
            part.styleOrder = upcoming.italic ? ['italic', 'bold'] : ['bold', 'italic'];
            break;
          }
        }
      }
      const lines = part.text.split('\n');
      lines.forEach((line, index) => {
        if (index) { transition({}); markdown += '\n'; }
        const [, before, center, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(line);
        if (before) { transition({}); markdown += before; }
        if (center) { transition(part); markdown += center; }
        if (after) { transition({}); markdown += after; }
      });
    }
    transition({});
    markdown = markdown.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { markdown, meaningful };
  }
  source.addEventListener('paste', (event) => {
    if (!event.clipboardData) return;
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    const isMarkdown = /(?:\*\*\S|__\S|\[[^\]\n]+\]\(https?:\/\/|^\s*#{1,6}\s)/m.test(text);
    const converted = html && $('richPaste').checked && !isMarkdown ? richTextToMarkdown(html) : null;
    const markdown = converted?.markdown || text;
    event.preventDefault();
    rememberSelection(); insertEditorHtml(PostFormatter.toEditorHtml(markdown));
  });

  // Exposed for deterministic browser checks; no draft is sent anywhere.
  window.PostformApp = { richTextToMarkdown, draftMarkdown, sanitizeEditorHtml };
  $('saveStatus').textContent = storageAvailable ? savedDraft ? 'Previous draft available' : 'Drafts saved on this device' : 'Draft kept in this tab';
  render(false);
  window.addEventListener('pagehide', () => {
    savePreferences(); flushDraft();
  });
}());
