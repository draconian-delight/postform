(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PostFormatter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STYLES = {
    sans: {
      bold: [0x1D5D4, 0x1D5EE],
      italic: [0x1D608, 0x1D622],
      both: [0x1D63C, 0x1D656]
    },
    serif: {
      bold: [0x1D400, 0x1D41A],
      italic: [0x1D434, 0x1D44E],
      both: [0x1D468, 0x1D482]
    }
  };
  var REVERSE = Object.create(null);
  Object.keys(STYLES).forEach(function (font) {
    Object.keys(STYLES[font]).forEach(function (style) {
      var bases = STYLES[font][style];
      for (var i = 0; i < 26; i++) {
        REVERSE[String.fromCodePoint(bases[0] + i)] = String.fromCharCode(65 + i);
        REVERSE[String.fromCodePoint(bases[1] + i)] = String.fromCharCode(97 + i);
      }
    });
  });
  delete REVERSE[String.fromCodePoint(0x1D455)]; // The serif italic h is a Unicode gap.
  REVERSE['ℎ'] = 'h';
  // Recognize the other mathematical digit alphabets when cleaning copied text.
  [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6].forEach(function (base) {
    for (var i = 0; i < 10; i++) REVERSE[String.fromCodePoint(base + i)] = String(i);
  });

  function stripStyles(value) {
    return Array.from(String(value == null ? '' : value), function (ch) {
      return REVERSE[ch] || ch;
    }).join('');
  }

  function mapLetters(value, style) {
    if (!style.bold && !style.italic) return value;
    var font = style.font === 'serif' ? 'serif' : 'sans';
    var key = style.bold && style.italic ? 'both' : style.bold ? 'bold' : 'italic';
    var bases = STYLES[font][key];
    return Array.from(value, function (ch) {
      var c = ch.codePointAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(bases[0] + c - 65);
      if (c >= 97 && c <= 122) {
        if (font === 'serif' && key === 'italic' && ch === 'h') return 'ℎ';
        return String.fromCodePoint(bases[1] + c - 97);
      }
      if (style.bold && c >= 48 && c <= 57) return String.fromCodePoint(0x1D7CE + c - 48);
      return ch;
    }).join('');
  }

  function isWord(ch) { return !!ch && /[\p{L}\p{M}\p{N}_]/u.test(ch); }
  function isSpace(ch) { return !ch || /\s/u.test(ch); }
  function isPunctuation(ch) { return !!ch && /[\p{P}\p{S}]/u.test(ch); }
  function previousCharacter(text, pos) {
    if (!pos) return '';
    var code = text.charCodeAt(pos - 1);
    return code >= 0xDC00 && code <= 0xDFFF && pos > 1 ? text.slice(pos - 2, pos) : text[pos - 1];
  }
  // Returning the UTF-16 end offset lets the parser keep punctuation outside URLs.
  function protectedSpan(text, start) {
    var rest = text.slice(start);
    var before = previousCharacter(text, start);
    var found;
    if (text[start] === '[') {
      found = /^\[(?:\d+|\^[^\]\s]+)\](?!\()/.exec(rest);
      if (found) return start + found[0].length;
    }
    if ((!before || !isWord(before)) && /^(?:https?:\/\/|mailto:|www\.)/i.test(rest)) {
      found = /^[^\s<>`]+/.exec(rest);
      if (found) {
        var url = found[0].replace(/[.,!?:;*_]+$/g, '');
        [['(', ')'], ['[', ']'], ['{', '}']].forEach(function (pair) {
          var opens = url.split(pair[0]).length - 1;
          var closes = url.split(pair[1]).length - 1;
          while (closes > opens && url.endsWith(pair[1])) {
            url = url.slice(0, -1); closes--;
          }
        });
        if (url) return start + url.length;
      }
    }
    if (text[start] === '@' && (!before || (!isWord(before) && before !== '@'))) {
      found = /^@[A-Za-z0-9_]+/.exec(rest);
      if (found) return start + found[0].replace(/_+$/, '').length;
    }
    if (text[start] === '#' && (!before || !isWord(before))) {
      found = /^#[\p{L}\p{N}_]+/u.exec(rest);
      if (found) return start + found[0].replace(/_+$/, '').length;
    }
    // Email addresses also need their Latin characters intact when copied.
    if ((!before || !isWord(before)) && /[A-Za-z0-9]/.test(text[start] || '')) {
      found = /^[A-Za-z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/.exec(rest);
      if (found) return start + found[0].length;
    }
    return start;
  }

  function stylize(value, style) {
    var text = String(value == null ? '' : value);
    style = style || {};
    var out = '', plain = '';
    for (var i = 0; i < text.length;) {
      var end = protectedSpan(text, i);
      if (end > i) {
        out += mapLetters(plain, style) + text.slice(i, end);
        plain = ''; i = end;
      } else {
        var ch = String.fromCodePoint(text.codePointAt(i));
        plain += ch; i += ch.length;
      }
    }
    return out + mapLetters(plain, style);
  }

  function findClosingBracket(text, start, open, close) {
    var nesting = 1;
    for (var i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === open) nesting++;
      else if (text[i] === close && --nesting === 0) return i;
    }
    return -1;
  }

  function destination(raw) {
    raw = raw.trim();
    var m = /^<([^<>]*)>(?:\s+["'][\s\S]*["'])?$/.exec(raw);
    if (m) raw = m[1];
    else {
      // Markdown titles follow whitespace; parentheses inside URLs remain intact.
      var title = /\s+["'][\s\S]*["']\s*$/.exec(raw);
      if (title) raw = raw.slice(0, title.index);
    }
    return raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
  }

  function addText(tokens, value, literal) {
    if (!value) return;
    var last = tokens[tokens.length - 1];
    if (last && last.type === 'text' && !!last.literal === !!literal) last.text += value;
    else tokens.push({ type: 'text', text: value, literal: !!literal });
  }

  function parseInline(text, options, depth) {
    if (depth > 24) return [{ text: text, literal: true }];
    var tokens = [];
    for (var i = 0; i < text.length;) {
      var ch = text[i];
      if (ch === '\\' && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(text[i + 1] || '')) {
        addText(tokens, text[i + 1], true); i += 2; continue;
      }
      if (ch === '`') {
        var tickEnd = i;
        while (text[tickEnd] === '`') tickEnd++;
        var ticks = text.slice(i, tickEnd), match = text.indexOf(ticks, tickEnd);
        while (match >= 0 && (text[match - 1] === '`' || text[match + ticks.length] === '`')) {
          match = text.indexOf(ticks, match + ticks.length);
        }
        if (match >= 0) {
          var code = text.slice(tickEnd, match).replace(/\n/g, ' ');
          if (/^ .* $/.test(code) && /[^ ]/.test(code)) code = code.slice(1, -1);
          tokens.push({ type: 'text', text: code, literal: true, code: true }); i = match + ticks.length; continue;
        }
        addText(tokens, ticks, true); i = tickEnd; continue;
      }
      var image = ch === '!' && text[i + 1] === '[';
      if (ch === '[' || image) {
        var labelStart = image ? i + 1 : i;
        var labelEnd = findClosingBracket(text, labelStart, '[', ']');
        if (labelEnd >= 0 && text[labelEnd + 1] === '(') {
          var urlEnd = findClosingBracket(text, labelEnd + 1, '(', ')');
          if (urlEnd >= 0) {
            var label = text.slice(labelStart + 1, labelEnd);
            var url = destination(text.slice(labelEnd + 2, urlEnd));
            var children = parseInline(label, options, depth + 1);
            var readableLabel = children.map(function (part) { return part.text; }).join('');
            var suffix = '';
            if (url && options.linkStyle !== 'label') {
              if (!readableLabel.trim() || stripStyles(readableLabel.trim()) === url) {
                children = [{ text: url, literal: true }];
              } else suffix = options.linkStyle === 'newline' ? '\n' + url : ' (' + url + ')';
            }
            tokens.push({ type: 'node', children: children, suffix: suffix, href: url });
            i = urlEnd + 1; continue;
          }
        }
      }
      if (ch === '<') {
        var auto = /^<((?:https?:\/\/|mailto:)[^<>\s]+)>/i.exec(text.slice(i));
        if (auto) { addText(tokens, auto[1], true); i += auto[0].length; continue; }
      }
      var protectedEnd = protectedSpan(text, i);
      if (protectedEnd > i) {
        addText(tokens, text.slice(i, protectedEnd), true); i = protectedEnd; continue;
      }
      if (ch === '*' || ch === '_') {
        var runEnd = i + 1;
        while (text[runEnd] === ch) runEnd++;
        var before = previousCharacter(text, i);
        var after = runEnd < text.length ? String.fromCodePoint(text.codePointAt(runEnd)) : '';
        var left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
        var right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
        tokens.push({ type: 'delimiter', char: ch, length: runEnd - i, remaining: runEnd - i,
          canOpen: ch === '_' ? left && (!right || isPunctuation(before)) : left,
          canClose: ch === '_' ? right && (!left || isPunctuation(after)) : right,
          openBold: 0, closeBold: 0, openItalic: 0, closeItalic: 0 });
        i = runEnd; continue;
      }
      var char = String.fromCodePoint(text.codePointAt(i));
      addText(tokens, char, false); i += char.length;
    }

    var stack = [];
    tokens.forEach(function (token, index) {
      if (token.type !== 'delimiter') return;
      if (token.canClose) {
        while (token.remaining > 0) {
          var found = -1;
          for (var s = stack.length - 1; s >= 0; s--) {
            var candidate = tokens[stack[s]];
            if (candidate.char !== token.char || !candidate.remaining) continue;
            if ((candidate.canClose || token.canOpen) && (candidate.remaining + token.remaining) % 3 === 0 &&
                (candidate.remaining % 3 !== 0 || token.remaining % 3 !== 0)) continue;
            found = s; break;
          }
          if (found < 0) break;
          var opener = tokens[stack[found]];
          var use = opener.remaining >= 2 && token.remaining >= 2 ? 2 : 1;
          opener.remaining -= use; token.remaining -= use;
          if (use === 2) { opener.openBold++; token.closeBold++; }
          else { opener.openItalic++; token.closeItalic++; }
          // Unmatched delimiters inside a matched span cannot cross its boundary.
          stack.splice(found + 1);
          if (!opener.remaining) stack.splice(found, 1);
        }
      }
      if (token.canOpen && token.remaining) stack.push(index);
    });

    var result = [], bold = 0, italic = 0;
    function emit(part) {
      result.push({ text: part.text, literal: !!part.literal, code: !!part.code, href: part.href,
        bold: bold > 0 || !!part.bold, italic: italic > 0 || !!part.italic });
    }
    tokens.forEach(function (token) {
      if (token.type === 'delimiter') {
        bold -= token.closeBold; italic -= token.closeItalic;
        if (token.remaining) emit({ text: token.char.repeat(token.remaining) });
        bold += token.openBold; italic += token.openItalic;
      } else if (token.type === 'node') {
        token.children.forEach(function (child) { emit(Object.assign({}, child, { href: token.href || child.href })); });
        if (token.suffix) emit({ text: token.suffix, literal: true });
      } else emit(token);
    });
    return result;
  }

  function inline(text, options, bold) {
    return parseInline(text, options, 0).map(function (part) {
      if (part.literal || options.plain) return options.plain ? stripStyles(part.text) : part.text;
      return stylize(part.text, {
        font: options.font, bold: options.bold !== false && (!!bold || part.bold),
        italic: options.italic !== false && part.italic
      });
    }).join('');
  }

  function normalizeOptions(options) {
    options = options || {};
    return {
      spacing: ['preserve', 'social', 'roomy'].indexOf(options.spacing) >= 0 ? options.spacing : 'social',
      linkStyle: ['inline', 'newline', 'label'].indexOf(options.linkStyle) >= 0 ? options.linkStyle : 'inline',
      font: options.font === 'serif' ? 'serif' : 'sans',
      plain: !!options.plain, bold: options.bold !== false, italic: options.italic !== false
    };
  }

  function format(value, settings) {
    var options = normalizeOptions(settings);
    var input = String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    var lines = input.split('\n'), rows = [], fence = null, codeGroup = 0;
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n];
      if (fence) {
        var close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
          fence = null; continue;
        }
        rows.push({ text: line, kind: 'code', group: codeGroup }); continue;
      }
      var opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (opening && (opening[1][0] !== '`' || opening[2].indexOf('`') < 0)) {
        fence = { char: opening[1][0], length: opening[1].length }; codeGroup++; continue;
      }
      if (!line.trim()) { rows.push({ text: '', kind: 'blank' }); continue; }
      var heading = /^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/.exec(line);
      if (heading) {
        var title = heading[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
        rows.push({ text: inline(title, options, true), kind: 'heading' }); continue;
      }
      if (n + 1 < lines.length && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[n + 1]) && !/^\s*[-*+]\s/.test(line)) {
        rows.push({ text: inline(line.trim(), options, true), kind: 'heading' }); n++; continue;
      }
      if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
        rows.push({ text: '', kind: 'blank' }); continue;
      }
      var bullet = /^(\s*)[-*+][ \t]+(.*)$/.exec(line);
      if (bullet) {
        rows.push({ text: bullet[1] + '• ' + inline(bullet[2], options), kind: 'list' }); continue;
      }
      var ordered = /^(\s*)(\d{1,9}[.)])[ \t]+(.*)$/.exec(line);
      if (ordered) {
        rows.push({ text: ordered[1] + ordered[2] + ' ' + inline(ordered[3], options), kind: 'list' }); continue;
      }
      var previous = rows[rows.length - 1];
      if (/^ {2,}\S/.test(line) && previous && previous.kind === 'list' && options.spacing !== 'preserve') {
        previous.text += ' ' + inline(line.trim(), options); continue;
      }
      var quote = /^ {0,3}(?:>[ \t]?)+/.exec(line);
      if (quote) line = line.slice(quote[0].length);
      var kind = /^\[\d+\](?::|\s)/.test(line) ? 'footnote' : 'paragraph';
      rows.push({ text: inline(line, options), kind: kind });
    }
    if (options.spacing === 'preserve') return rows.map(function (row) { return row.text; }).join('\n');

    var output = '', prev = null, blank = false;
    rows.forEach(function (row) {
      if (row.kind === 'blank') { blank = true; return; }
      var separator = '';
      if (prev) {
        if (row.kind === 'code' && prev.kind === 'code' && row.group === prev.group) separator = '\n';
        else if (blank) separator = '\n\n';
        else if (row.kind === 'list' && prev.kind === 'list') separator = options.spacing === 'roomy' ? '\n\n' : '\n';
        else if (row.kind === 'list' && (prev.kind === 'heading' || /:\s*$/.test(prev.text))) separator = '\n';
        else separator = '\n\n';
      }
      output += separator + row.text; prev = row; blank = false;
    });
    return output;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Reuse the emphasis parser for the visual editor; imported HTML is escaped
  // here rather than trusting markup supplied by the clipboard or local storage.
  function toEditorHtml(value) {
    var options = normalizeOptions({ linkStyle: 'label' });
    function richLine(line, heading) {
      var result = '', link = '', linkContent = '';
      function flushLink() {
        if (link) { result += '<a href="' + escapeHtml(link) + '">' + linkContent + '</a>'; link = ''; linkContent = ''; }
      }
      parseInline(line, options, 0).forEach(function (part) {
        var html = escapeHtml(part.text);
        if (part.code) html = '<code>' + html + '</code>';
        else {
          if (part.italic) html = '<em>' + html + '</em>';
          if (part.bold || heading) html = '<strong>' + html + '</strong>';
        }
        var href = part.href && /^(?:https?:\/\/|mailto:)/i.test(part.href) ? part.href : '';
        if (href !== link) flushLink();
        if (href) { link = href; linkContent += html; }
        else result += html;
      });
      flushLink(); return result;
    }
    var lines = String(value == null ? '' : value).replace(/\r\n?/g, '\n').split('\n');
    var output = [], paragraph = [], list = null, fence = null, code = [];
    function flushParagraph() {
      if (paragraph.length) { output.push('<p>' + paragraph.join('<br>') + '</p>'); paragraph = []; }
    }
    function closeList() { if (list) { output.push('</' + list + '>'); list = null; } }
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n], match;
      if (fence) {
        match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
        if (match && match[1][0] === fence[0] && match[1].length >= fence.length) {
          output.push('<pre>' + escapeHtml(code.join('\n')) + '</pre>'); fence = null; code = [];
        } else code.push(line);
        continue;
      }
      match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (match && (match[1][0] !== '`' || match[2].indexOf('`') < 0)) {
        flushParagraph(); closeList(); fence = match[1]; continue;
      }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }
      match = /^ {0,3}#{1,6}(?:[ \t]+|$)(.*)$/.exec(line);
      if (match) {
        flushParagraph(); closeList(); output.push('<p>' + richLine(match[1].replace(/[ \t]+#+[ \t]*$/, '').trim(), true) + '</p>'); continue;
      }
      if (n + 1 < lines.length && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[n + 1]) && !/^\s*[-*+]\s/.test(line)) {
        flushParagraph(); closeList(); output.push('<p>' + richLine(line.trim(), true) + '</p>'); n++; continue;
      }
      if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) { flushParagraph(); closeList(); continue; }
      var bullet = /^\s*[-*+][ \t]+(.*)$/.exec(line);
      var ordered = /^\s*(\d{1,9})[.)][ \t]+(.*)$/.exec(line);
      if (bullet || ordered) {
        flushParagraph(); var type = ordered ? 'ol' : 'ul';
        if (list !== type) { closeList(); output.push(ordered ? '<ol start="' + Number(ordered[1]) + '">' : '<ul>'); list = type; }
        output.push('<li' + (ordered ? ' value="' + Number(ordered[1]) + '"' : '') + '>' + richLine(ordered ? ordered[2] : bullet[1]) + '</li>'); continue;
      }
      closeList(); line = line.replace(/^ {0,3}(?:>[ \t]?)+/, ''); paragraph.push(richLine(line));
    }
    if (fence) output.push('<pre>' + escapeHtml(code.join('\n')) + '</pre>');
    flushParagraph(); closeList();
    return output.join('');
  }

  return Object.freeze({ format: format, stylize: stylize, stripStyles: stripStyles, toEditorHtml: toEditorHtml,
    countCodePoints: function (value) { return Array.from(String(value == null ? '' : value)).length; } });
});
