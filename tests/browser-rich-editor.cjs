'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.POSTFORM_PLAYWRIGHT_MODULE || 'playwright');
const dir = __dirname;
const artifacts = path.join(dir, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const html = path.resolve(dir, '../dist/Postform.html');
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); }
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  await page.goto(pathToFileURL(html).href);
  const output = () => page.locator('#output').inputValue();
  async function openOptions() {
    if (!(await page.locator('#optionsPanel').evaluate(el => el.open))) await page.locator('#optionsPanel summary').click();
  }
  async function setHtml(value) {
    await page.evaluate(value => {
      const source = document.getElementById('source');
      source.innerHTML = value; source.focus(); source.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  async function selectText(text) {
    await page.evaluate(text => {
      const editor = document.getElementById('source');
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const start = node.nodeValue.indexOf(text);
        if (start !== -1) {
          const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
          editor.focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange')); return;
        }
      }
      throw new Error('Selection text missing: ' + text);
    }, text);
  }
  async function paste(text, rich = '') {
    await page.evaluate(({ text, rich }) => {
      const source = document.getElementById('source'); source.focus();
      const range = document.createRange(); range.selectNodeContents(source);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const data = new DataTransfer(); data.setData('text/plain', text); if (rich) data.setData('text/html', rich);
      source.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, { text, rich });
  }

  await check('New visitors start with an empty draft and collapsed options; generic example formats visually', async () => {
    assert.equal(await page.locator('#source').getAttribute('contenteditable'), 'true');
    assert.equal(await page.locator('#source').innerText(), '');
    assert.equal(await output(), '');
    assert.equal(await page.locator('#optionsPanel').evaluate(el => el.open), false);
    assert.ok(await page.locator('#copyPost').isDisabled());
    await page.screenshot({ path: path.join(artifacts, 'empty-desktop.png'), fullPage: true });
    await openOptions(); await page.click('#loadExample');
    const text = await page.locator('#source').innerText();
    assert.ok(!text.includes('**')); assert.ok(!text.includes(']('));
    assert.ok((await page.locator('#source strong').count()) >= 1);
    assert.ok((await page.locator('#source em').count()) >= 1);
    assert.equal(await output(), await page.evaluate(() => PostFormatter.format(PostformApp.draftMarkdown())));
    assert.ok(text.includes('35 big possibilities'));
    await page.locator('#optionsPanel summary').click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(artifacts, 'visual-editor-desktop.png'), fullPage: true });

  await check('Selecting text and clicking Bold formats letters and digits live', async () => {
    await setHtml('<p>35B and phone</p>'); await selectText('35B'); await page.click('#boldText');
    assert.equal(await output(), '𝟑𝟓𝗕 and phone');
    assert.ok(await page.locator('#source b, #source strong').count());
    assert.equal(await page.locator('#boldText').getAttribute('aria-pressed'), 'true');
  });
  await check('Bold can be removed from the selected text', async () => {
    await page.click('#boldText'); assert.equal(await output(), '35B and phone');
  });
  await check('Italic toolbar selection and keyboard shortcut toggle styling', async () => {
    await selectText('phone'); await page.click('#italicText'); assert.equal(await output(), '35B and 𝘱𝘩𝘰𝘯𝘦');
    await page.keyboard.press('Control+i'); assert.equal(await output(), '35B and phone');
  });
  await check('Bold keyboard shortcut and combined italic styling work', async () => {
    await selectText('35B'); await page.keyboard.press('Control+b'); assert.equal(await output(), '𝟑𝟓𝗕 and phone');
    await page.click('#italicText'); assert.equal(await output(), '𝟑𝟓𝘽 and phone');
  });
  await check('Clear formatting removes both styles', async () => {
    await page.click('#clearFormat'); assert.equal(await output(), '35B and phone');
  });
  await check('Typing edits the left and updates the right immediately', async () => {
    await page.locator('#source').fill('Edit me');
    await page.keyboard.press('End'); await page.keyboard.type(' 123');
    assert.equal(await output(), 'Edit me 123');
  });
  await check('Native undo restores text formatting', async () => {
    await selectText('123'); await page.click('#boldText'); assert.equal(await output(), 'Edit me 𝟏𝟐𝟑');
    await page.keyboard.press('Control+z'); assert.equal(await output(), 'Edit me 123');
  });
  await check('Markdown paste becomes visual bold, italic, links and lists', async () => {
    await paste('Intro **35B** and *phone*.\n\n- **Offline** chat\n- Second\n\n[Try](https://example.com/A_35)');
    const text = await page.locator('#source').innerText();
    assert.ok(!text.includes('**')); assert.ok(!text.includes('*phone*')); assert.ok(!text.includes(']('));
    assert.ok(await page.locator('#source ul li').count() === 2);
    assert.ok((await output()).includes('Intro 𝟑𝟓𝗕 and 𝘱𝘩𝘰𝘯𝘦.'));
    assert.ok((await output()).includes('https://example.com/A_35'));
  });
  await check('Pasting formatted HTML keeps styling without inserting active markup', async () => {
    await paste('Normal Bold 35 italic', '<b style="font-weight:normal"><p>Normal <span style="font-weight:700">Bold 35</span> <em>italic</em></p></b><script>window.PWNED=true</script><img src="https://invalid.example/track" onerror="window.PWNED=true">');
    assert.equal(await output(), 'Normal 𝗕𝗼𝗹𝗱 𝟑𝟓 𝘪𝘵𝘢𝘭𝘪𝘤');
    assert.equal(await page.evaluate(() => window.PWNED), undefined);
    assert.equal(await page.locator('#source img, #source script').count(), 0);
  });
  await check('Visual line breaks retain bold and literal code backticks', async () => {
    await paste('First\nSecond say `hi`', '<p><strong>First<br>Second</strong> <code>say `hi`</code></p>');
    assert.equal(await output(), '𝗙𝗶𝗿𝘀𝘁\n\n𝗦𝗲𝗰𝗼𝗻𝗱 say `hi`');
  });
  await check('Toolbar creates a link from selected text', async () => {
    await setHtml('<p>Visit us</p>'); await selectText('Visit'); await page.click('#editLink');
    await page.fill('#linkUrl', 'https://example.com/35'); await page.click('#linkForm button[type=submit]');
    assert.equal(await page.locator('#source a').innerText(), 'Visit');
    assert.equal(await output(), 'Visit (https://example.com/35) us');
  });
  await check('Clicking a visual link allows editing and removing it', async () => {
    await page.locator('#source a').click(); await page.fill('#linkUrl', 'https://example.com/new');
    await page.click('#linkForm button[type=submit]'); assert.ok((await output()).includes('https://example.com/new'));
    await page.locator('#source a').click(); await page.click('#removeLink');
    assert.equal(await output(), 'Visit us');
  });
  await check('Bullet toolbar makes an editable list and Unicode bullets', async () => {
    await setHtml('<p>Item 35</p>'); await selectText('Item 35'); await page.click('#bulletList');
    assert.ok(await page.locator('#source ul li').count()); assert.equal(await output(), '• Item 35');
  });
  await check('Right-side style, plain text, links and spacing controls still work', async () => {
    await openOptions();
    await paste('**Bold 35**\n\n- One\n- Two\n\n[Try](https://example.com)');
    await page.selectOption('#font', 'serif'); assert.ok((await output()).includes('𝐁𝐨𝐥𝐝 𝟑𝟓'));
    await page.selectOption('#spacing', 'roomy'); assert.ok((await output()).includes('• One\n\n• Two'), await page.evaluate(() => JSON.stringify({ html: document.getElementById('source').innerHTML, md: PostformApp.draftMarkdown(), out: document.getElementById('output').value })));
    await page.selectOption('#linkStyle', 'label'); assert.ok(!(await output()).includes('https://'));
    await page.click('#plainMode'); assert.ok((await output()).includes('Bold 35')); assert.ok(await page.locator('#font').isDisabled());
    await page.click('#unicodeMode'); await page.selectOption('#font', 'sans'); await page.selectOption('#spacing', 'social'); await page.selectOption('#linkStyle', 'inline');
  });
  await check('Draft saves and restores visual formatting after reload', async () => {
    await openOptions();
    await page.selectOption('#font', 'sans'); await page.selectOption('#spacing', 'social'); await page.selectOption('#linkStyle', 'inline');
    await setHtml('<p><strong>Saved 35</strong> <em>phone</em></p>'); await page.waitForTimeout(350); await page.reload();
    assert.ok(await page.locator('#source strong').count()); assert.ok(await page.locator('#source em').count());
    assert.equal(await output(), '𝗦𝗮𝘃𝗲𝗱 𝟑𝟓 𝘱𝘩𝘰𝘯𝘦');
  });
  await check('Old Markdown drafts migrate to the visual editor', async () => {
    const migratedContext = await browser.newContext();
    await migratedContext.addInitScript(() => {
      localStorage.removeItem('postform.draft.v2');
      localStorage.setItem('postform.draft.v1', JSON.stringify({ text: '**Old 35** and *phone*', spacing: 'social' }));
    });
    const migrated = await migratedContext.newPage(); await migrated.goto(pathToFileURL(html).href);
    assert.equal(await migrated.locator('#source').innerText(), 'Old 35 and phone');
    assert.equal(await migrated.locator('#output').inputValue(), '𝗢𝗹𝗱 𝟑𝟓 and 𝘱𝘩𝘰𝘯𝘦');
    await migratedContext.close();
  });
  await check('Editing works without local storage', async () => {
    const limitedContext = await browser.newContext();
    await limitedContext.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('denied'); }; Storage.prototype.setItem = () => { throw new Error('denied'); }; });
    const limited = await limitedContext.newPage(); await limited.goto(pathToFileURL(html).href);
    await limited.locator('#source').fill('Works 35'); await limited.waitForTimeout(350);
    assert.equal(await limited.locator('#output').inputValue(), 'Works 35');
    assert.equal(await limited.locator('#saveStatus').textContent(), 'Draft kept in this tab'); await limitedContext.close();
  });
  await check('Clipboard fallback copies the exact Unicode output', async () => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
      const original = document.execCommand.bind(document);
      document.execCommand = (command, ...args) => { if (command === 'copy') { window.copied = document.activeElement.value; return true; } return original(command, ...args); };
    });
    await page.click('#copyPost'); assert.equal(await page.evaluate(() => window.copied), await output());
  });
  await check('Exported HTML omits the edited draft and reopens with a working visual editor', async () => {
    await openOptions();
    await setHtml('<p>PRIVATE_DRAFT_725</p>');
    await page.evaluate(() => {
      const original = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.exportBlob = blob; return original(blob); };
    });
    await page.click('#saveTool'); const exported = await page.evaluate(() => window.exportBlob.text());
    assert.ok(!exported.includes('PRIVATE_DRAFT_725'));
    const target = path.join(artifacts, 'visual-editor-export.html'); fs.writeFileSync(target, exported);
    const exportedContext = await browser.newContext(); const reopened = await exportedContext.newPage();
    await reopened.goto(pathToFileURL(target).href); assert.equal(await reopened.locator('#source').getAttribute('contenteditable'), 'true');
    assert.equal(await reopened.locator('#source').innerText(), '');
    assert.equal(await reopened.locator('#output').inputValue(), '');
    await reopened.locator('#source').fill('Fresh 35');
    assert.equal(await reopened.locator('#output').inputValue(), 'Fresh 35'); await exportedContext.close();
  });
  await check('Empty draft disables copying and exports', async () => {
    await openOptions();
    await page.click('#clearDraft'); assert.equal(await output(), ''); assert.ok(await page.locator('#copyPost').isDisabled()); assert.ok(await page.locator('#downloadText').isDisabled());
  });
  await openOptions(); await page.click('#loadExample'); await page.locator('#optionsPanel summary').click(); await page.waitForTimeout(300);
  for (const width of [390, 320]) await check('Visual editor and toolbar fit ' + width + 'px width', async () => {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(size.scroll <= size.width);
    for (const id of ['boldText', 'italicText', 'editLink']) assert.ok(await page.locator('#' + id).isVisible());
    const fonts = await page.evaluate(() => ['source', 'output'].map(id => ({ id, size: parseFloat(getComputedStyle(document.getElementById(id)).fontSize) })));
    for (const font of fonts) assert.ok(font.size >= 16, JSON.stringify(font));
    await page.screenshot({ path: path.join(artifacts, 'visual-editor-mobile-' + width + '.png'), fullPage: true });
  });
  await check('Text contrast, editor sizing and focus are clear without extra visual clutter', async () => {
    await page.setViewportSize({ width: 1440, height: 1100 }); await openOptions();
    const audit = await page.evaluate(() => {
      const rgb = color => {
        const parts = color.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
        return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
      };
      const blend = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
      const background = el => {
        const layers = [];
        for (let node = el; node; node = node.parentElement) layers.push(rgb(getComputedStyle(node).backgroundColor));
        let result = [255, 255, 255];
        for (const layer of layers.reverse()) result = blend(layer, result);
        return result;
      };
      const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const entries = [];
      for (const [id, minimum] of [['source', 7], ['output', 7], ['draftLabel', 7], ['outputLabel', 7], ['copyPost', 7], ['sourceHelp', 4.5], ['outputDescription', 4.5], ['saveStatus', 4.5], ['characterCount', 4.5]]) {
        const el = document.getElementById(id);
        if (!el || !el.getClientRects().length) continue;
        const style = getComputedStyle(el), bg = background(el), fg = blend(rgb(style.color), bg);
        const a = luminance(fg), b = luminance(bg);
        entries.push({ id, minimum, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fontSize: parseFloat(style.fontSize), color: style.color, background: bg });
      }
      return { entries, editors: ['source', 'output'].map(id => ({ id, size: parseFloat(getComputedStyle(document.getElementById(id)).fontSize) })), labels: Array.from(document.querySelectorAll('label')).filter(el => el.getClientRects().length).map(el => ({ text: el.textContent.trim(), size: parseFloat(getComputedStyle(el).fontSize) })) };
    });
    fs.writeFileSync(path.join(artifacts, 'contrast-audit.json'), JSON.stringify(audit, null, 2));
    for (const item of audit.entries) assert.ok(item.ratio >= item.minimum, item.id + ' contrast ' + item.ratio.toFixed(2) + ':1 needs ' + item.minimum + ':1');
    for (const item of audit.editors) assert.ok(item.size >= 16, JSON.stringify(item));
    for (const item of audit.labels) assert.ok(item.size >= 13, JSON.stringify(item));
    const focusStyles = () => page.locator('#source').evaluate(el => [el, el.closest('.editor-card')].filter(Boolean).map(node => {
      const style = getComputedStyle(node);
      return { outline: style.outlineWidth, shadow: style.boxShadow, border: style.borderColor };
    }));
    await page.locator('#output').focus(); const unfocused = await focusStyles();
    await page.locator('#source').focus(); const focus = await focusStyles();
    assert.ok(focus.some((style, index) => parseFloat(style.outline) >= 2 || style.shadow !== unfocused[index].shadow || style.border !== unfocused[index].border), JSON.stringify({ unfocused, focus }));
    assert.equal(await page.locator('.intro, .type-specimen, .site-footer, .help').count(), 0);
  });
  await check('No uncaught browser errors or external requests', async () => { assert.deepEqual(errors, []); assert.ok(!requests.some(url => /^https?:/.test(url))); });
  await browser.close();
  fs.writeFileSync(path.join(artifacts, 'visual-editor-results.json'), JSON.stringify(results, null, 2));
  for (const result of results) console.log(result.status + ' ' + result.name + (result.error ? '\n' + result.error : ''));
  process.exitCode = results.some(result => result.status === 'FAIL') ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
