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
let activeBrowser;
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.stack }); console.log('FAIL ' + name + '\n' + error.stack); }
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  activeBrowser = browser;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  context.setDefaultTimeout(7000);
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  await page.goto(pathToFileURL(html).href);
  const output = () => page.locator('#output').inputValue();
  const draftKey = 'postform.draft.v3';
  const preferencesKey = 'postform.preferences.v1';
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
      const start = editor.textContent.indexOf(text);
      if (start < 0) throw new Error('Selection text missing: ' + text);
      const end = start + text.length, nodes = [];
      let node, offset = 0;
      while ((node = walker.nextNode())) { nodes.push({ node, start: offset, end: offset + node.nodeValue.length }); offset += node.nodeValue.length; }
      const first = nodes.find(part => start >= part.start && start < part.end);
      const last = nodes.find(part => end > part.start && end <= part.end);
      if (!first || !last) throw new Error('Selection boundary missing: ' + text);
      const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      editor.focus(); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }, text);
  }
  async function restore(target = page) {
    const button = target.locator('#restoreDraft');
    if (!(await button.isVisible()) && !(await target.locator('#optionsPanel').evaluate(el => el.open))) await target.locator('#optionsPanel summary').click();
    await button.click();
  }
  async function offered(target = page) { return target.locator('#restoreDraft').evaluate(el => !el.hidden); }
  async function plainOutput(target = page) { return target.evaluate(() => PostFormatter.stripStyles(document.getElementById('output').value)); }
  async function seededPage(seed) {
    const isolatedContext = await browser.newContext();
    isolatedContext.setDefaultTimeout(7000);
    await isolatedContext.addInitScript(seed => {
      if (!sessionStorage.getItem('postform-qa-seeded')) {
        for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('postform-qa-seeded', 'true');
      }
    }, seed);
    const isolated = await isolatedContext.newPage(); await isolated.goto(pathToFileURL(html).href);
    return { isolatedContext, isolated };
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
    assert.equal(await page.locator('#linkStyle').inputValue(), 'colon');
    assert.deepEqual(await page.locator('#linkStyle option').evaluateAll(options => options.map(option => option.value)), ['colon', 'newline']);
    assert.equal(await offered(), false);
    for (const id of ['unicodeMode', 'plainMode', 'roughMode']) assert.ok(await page.locator('#' + id).isVisible());
    assert.equal(await page.locator('#githubLink').getAttribute('href'), 'https://github.com/draconian-delight/postform');
    assert.ok(await page.evaluate(() => !!(document.getElementById('optionsPanel').compareDocumentPosition(document.querySelector('.editors')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    assert.ok(await page.locator('#copyPost').isDisabled());
    await page.screenshot({ path: path.join(artifacts, 'empty-desktop.png'), fullPage: true });
    await openOptions(); await page.click('#loadExample');
    const text = await page.locator('#source').innerText();
    assert.ok(!text.includes('**')); assert.ok(!text.includes(']('));
    assert.ok((await page.locator('#source strong').count()) >= 1);
    assert.ok((await page.locator('#source em').count()) >= 1);
    assert.equal(await output(), await page.evaluate(() => PostFormatter.format(PostformApp.draftMarkdown())));
    assert.ok(text.trim().length > 0);
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
    assert.equal(await output(), 'Visit: https://example.com/35 us');
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
    await page.selectOption('#linkStyle', 'newline'); assert.ok((await output()).includes('Try\nhttps://example.com'));
    await page.click('#plainMode'); assert.ok((await output()).includes('Bold 35')); assert.ok(await page.locator('#font').isDisabled());
    await page.click('#unicodeMode'); await page.selectOption('#font', 'sans'); await page.selectOption('#spacing', 'social'); await page.selectOption('#linkStyle', 'colon');
  });
  await check('Colon links retain the destination and do not duplicate an existing label colon', async () => {
    await paste('[Docs:](https://example.com/Path?Version=2.1)\n\n[https://example.com](https://example.com)');
    assert.equal(await output(), 'Docs: https://example.com/Path?Version=2.1\n\nhttps://example.com');
  });
  await check('Rough mode keeps bold, italic, combined style and the original editor unchanged', async () => {
    await setHtml('<p>Hello <strong>World</strong>. This <em>Works</em> with <strong><em>AI</em></strong>.</p>');
    const original = await page.locator('#source').innerHTML(); await page.click('#roughMode');
    assert.equal(await output(), 'hello 𝘄𝗼𝗿𝗹𝗱.\n\nthis 𝘸𝘰𝘳𝘬𝘴 with 𝘼𝙄.');
    assert.equal(await page.locator('#source').innerHTML(), original);
    assert.ok(await page.locator('#capsText').isVisible());
    await page.click('#unicodeMode'); assert.equal(await output(), 'Hello 𝗪𝗼𝗿𝗹𝗱. This 𝘞𝘰𝘳𝘬𝘴 with 𝘼𝙄.');
    assert.equal(await page.locator('#source').innerHTML(), original);
  });
  await check('Rough casing preserves technical terms across styled nodes and safely splits sentences', async () => {
    await setHtml('<p>RUN MODELS LOCALLY. Use AI, MLX, GPU, 35B, Edge0 and i<b>Phone</b>. It needs 1.5 GiB in v2.1. Dr. Lee agrees.</p>');
    await page.click('#roughMode');
    assert.equal(await plainOutput(), 'run models locally.\n\nuse AI, MLX, GPU, 35B, Edge0 and iPhone.\n\nit needs 1.5 GiB in v2.1.\n\ndr. lee agrees.');
  });
  await check('Rough leaves URL queries, email, handles, hashtags, footnotes and code exact', async () => {
    await setHtml('<p>Visit https://example.com/A_B?q=U.S. and Email+Tag@example.com. Ask @Some_User about #AI35 [1]. Use <code>RunCase("MiX")</code>.</p>');
    const actual = await output();
    for (const exact of ['https://example.com/A_B?q=U.S.', 'Email+Tag@example.com', '@Some_User', '#AI35', '[1]', 'RunCase("MiX")']) assert.ok(actual.includes(exact), exact + '\n' + actual);
    assert.ok(!actual.includes('https://example.com/A_B?q=U.\n'));
  });
  await check('Hard line breaks separate technical casing tokens and preserve styles', async () => {
    await setHtml('<p>Hello<br>World.</p><p><strong>First<br>Second</strong></p>');
    assert.equal(await output(), 'hello\n\nworld.\n\n𝗳𝗶𝗿𝘀𝘁\n\n𝘀𝗲𝗰𝗼𝗻𝗱');
  });
  await check('Rough preserves list numbering and puts an empty line between list items', async () => {
    await setHtml('<ol start="3"><li value="3">FIRST item. Same item.</li><li value="8">Second item.</li></ol>');
    assert.equal(await output(), '3. first item. same item.\n\n8. second item.');
  });
  await check('Rough sentence spacing is fixed and ordinary spacing is restored on switching back', async () => {
    await page.click('#unicodeMode'); await openOptions(); await page.selectOption('#spacing', 'preserve');
    await setHtml('<p>First sentence. Second sentence.</p>'); await page.click('#roughMode');
    assert.ok(await page.locator('#spacing').isDisabled()); assert.ok(await page.locator('#roughSpacingNote').isVisible());
    assert.equal(await output(), 'first sentence.\n\nsecond sentence.');
    await page.click('#unicodeMode'); assert.equal(await page.locator('#spacing').inputValue(), 'preserve');
    assert.ok(!(await page.locator('#spacing').isDisabled())); assert.equal(await output(), 'First sentence. Second sentence.');
    await page.selectOption('#spacing', 'social');
  });
  await check('Manual CAPS toggles selected text only without changing source letters', async () => {
    await setHtml('<p>A tiny update today.</p>'); await page.click('#roughMode'); await selectText('update'); await page.click('#capsText');
    assert.equal(await page.locator('#source').innerText(), 'A tiny update today.');
    assert.equal(await page.locator('#source [data-postform-caps="true"]').innerText(), 'update');
    assert.equal(await output(), 'a tiny UPDATE today.');
    await selectText('update'); await page.click('#capsText');
    assert.equal(await page.locator('#source [data-postform-caps="true"]').count(), 0); assert.equal(await output(), 'a tiny update today.');
  });
  await check('CAPS selections can cross bold and italic nodes without damaging their formatting', async () => {
    await setHtml('<p>Keep <strong>bold</strong> and <em>italic</em> intact.</p>');
    await selectText('bold and italic'); await page.click('#capsText');
    assert.equal(await page.locator('#source').innerText(), 'Keep bold and italic intact.');
    assert.equal(await output(), 'keep 𝗕𝗢𝗟𝗗 AND 𝘐𝘛𝘈𝘓𝘐𝘊 intact.');
    assert.ok(await page.locator('#source strong, #source b').count()); assert.ok(await page.locator('#source em, #source i').count());
    await page.click('#unicodeMode'); assert.equal(await output(), 'Keep 𝗯𝗼𝗹𝗱 and 𝘪𝘵𝘢𝘭𝘪𝘤 intact.');
    await page.click('#plainMode'); assert.equal(await output(), 'Keep bold and italic intact.'); await page.click('#roughMode');
  });
  await check('Native undo removes a manual CAPS action', async () => {
    await setHtml('<p>One important phrase.</p>'); await selectText('important'); await page.click('#capsText');
    assert.equal(await output(), 'one IMPORTANT phrase.'); await page.keyboard.press('Control+z');
    assert.equal(await output(), 'one important phrase.'); assert.equal(await page.locator('#source [data-postform-caps="true"]').count(), 0);
  });
  await check('CAPS preserves inherited styles and toggles off inside bold italic content', async () => {
    await setHtml('<p><strong>bold <em>both</em> end</strong></p>');
    await selectText('both'); await page.click('#capsText');
    assert.equal(await output(), '𝗯𝗼𝗹𝗱 𝘽𝙊𝙏𝙃 𝗲𝗻𝗱');
    await selectText('both'); await page.click('#capsText');
    assert.equal(await output(), '𝗯𝗼𝗹𝗱 𝙗𝙤𝙩𝙝 𝗲𝗻𝗱');
    assert.equal(await page.locator('#source [data-postform-caps="true"]').count(), 0);
    await page.keyboard.press('Control+z'); assert.equal(await output(), '𝗯𝗼𝗹𝗱 𝘽𝙊𝙏𝙃 𝗲𝗻𝗱');
  });
  await check('CAPS crosses paragraphs and complete lists without changing their structure', async () => {
    for (const html of ['<p>First <strong>idea</strong>.</p><p>Second <em>idea</em>.</p>', '<ol start="3"><li>First <strong>idea</strong>.</li><li>Second idea.</li></ol>']) {
      await setHtml(html);
      const original = await page.locator('#source').innerText();
      await page.locator('#source').focus(); await page.keyboard.press('Control+a'); await page.click('#capsText');
      assert.equal(await page.locator('#source').innerText(), original);
      assert.ok((await plainOutput()).includes('FIRST IDEA.'));
      assert.equal(await page.locator('#source li').count(), html.startsWith('<ol') ? 2 : 0);
      await page.keyboard.press('Control+z');
      assert.equal(await page.locator('#source [data-postform-caps="true"]').count(), 0);
      assert.equal(await page.locator('#source').innerText(), original);
    }
  });
  await check('CAPS never changes protected destinations, account names or code', async () => {
    await setHtml('<p>Keep <span data-postform-caps="true">https://example.com/Case?x=A.B @Case_User #KeepCase Case+User@example.com <code>RunCase()</code> useful</span>.</p>');
    const actual = await output();
    for (const exact of ['https://example.com/Case?x=A.B', '@Case_User', '#KeepCase', 'Case+User@example.com', 'RunCase()', 'USEFUL']) assert.ok(actual.includes(exact), exact + '\n' + actual);
  });
  await check('CAPS annotations survive save, blank reload and explicit draft restoration', async () => {
    await setHtml('<p>A <strong><em>small</em></strong> update.</p>'); await selectText('small'); await page.click('#capsText');
    await page.waitForTimeout(350); await page.reload(); assert.equal(await output(), ''); assert.ok(await offered());
    await restore(); assert.ok(await page.locator('#source [data-postform-caps="true"]').count());
    assert.equal(await output(), 'a 𝙎𝙈𝘼𝙇𝙇 update.');
    await page.click('#unicodeMode'); assert.equal(await output(), 'A 𝙨𝙢𝙖𝙡𝙡 update.');
  });
  await check('Untouched startup, preference edits and another reload never overwrite the saved backup', async () => {
    const backup = { version: 3, html: '<p><strong>BACKUP_KEEP_35</strong></p>', text: '**BACKUP_KEEP_35**' };
    const { isolatedContext, isolated } = await seededPage({ [draftKey]: backup });
    const original = await isolated.evaluate(key => localStorage.getItem(key), draftKey);
    assert.equal(await isolated.locator('#source').innerText(), '');
    await isolated.locator('#optionsPanel summary').click(); await isolated.selectOption('#font', 'serif'); await isolated.selectOption('#linkStyle', 'newline');
    await isolated.waitForTimeout(350); assert.equal(await isolated.evaluate(key => localStorage.getItem(key), draftKey), original);
    assert.ok(await isolated.evaluate(key => !!localStorage.getItem(key), preferencesKey));
    await isolated.reload(); await isolated.waitForTimeout(350);
    assert.equal(await isolated.locator('#source').innerText(), ''); assert.equal(await isolated.evaluate(key => localStorage.getItem(key), draftKey), original);
    assert.equal(await isolated.locator('#font').inputValue(), 'serif'); assert.equal(await isolated.locator('#linkStyle').inputValue(), 'newline');
    await restore(isolated); assert.ok((await plainOutput(isolated)).includes('BACKUP_KEEP_35')); await isolatedContext.close();
  });
  await check('Legacy rich drafts and label-only preferences migrate without losing the link', async () => {
    const { isolatedContext, isolated } = await seededPage({ 'postform.draft.v2': { version: 2, html: '<p><strong>Old 35</strong> <a href="https://example.com/KeepCase">Docs</a></p>', linkStyle: 'label', plain: false } });
    assert.equal(await isolated.locator('#source').innerText(), ''); assert.equal(await isolated.locator('#linkStyle').inputValue(), 'colon');
    await restore(isolated); assert.equal(await isolated.locator('#output').inputValue(), '𝗢𝗹𝗱 𝟑𝟓 Docs: https://example.com/KeepCase');
    await isolatedContext.close();
  });
  await check('Restoring stored HTML keeps only safe formatting and CAPS annotations', async () => {
    const { isolatedContext, isolated } = await seededPage({ [draftKey]: { version: 3, html: '<p onclick="window.PWNED=true"><strong>safe35</strong> <span data-postform-caps="true" data-private="discard" onmouseover="window.PWNED=true">caps</span><img src="https://invalid.example/track" onerror="window.PWNED=true"></p><script>window.PWNED=true</script><iframe src="https://invalid.example/frame"></iframe>' } });
    await restore(isolated); await isolated.click('#roughMode');
    assert.equal(await isolated.locator('#output').inputValue(), '𝘀𝗮𝗳𝗲𝟑𝟓 CAPS');
    assert.equal(await isolated.evaluate(() => window.PWNED), undefined);
    assert.equal(await isolated.locator('#source img, #source script, #source iframe, #source [onclick], #source [onmouseover], #source [data-private]').count(), 0);
    assert.equal(await isolated.locator('#source [data-postform-caps="true"]').count(), 1); await isolatedContext.close();
  });
  await page.click('#unicodeMode');
  await check('Reload starts blank and offers manual restore without losing visual formatting', async () => {
    await openOptions();
    await page.selectOption('#font', 'sans'); await page.selectOption('#spacing', 'social'); await page.selectOption('#linkStyle', 'colon');
    await setHtml('<p><strong>Saved 35</strong> <em>phone</em></p>'); await page.waitForTimeout(350); await page.reload();
    assert.equal(await page.locator('#source').innerText(), ''); assert.equal(await output(), ''); assert.ok(await offered());
    await restore();
    assert.ok(await page.locator('#source strong').count()); assert.ok(await page.locator('#source em').count());
    assert.equal(await output(), '𝗦𝗮𝘃𝗲𝗱 𝟑𝟓 𝘱𝘩𝘰𝘯𝘦');
  });
  await check('Old Markdown drafts migrate to a recoverable backup without autofilling', async () => {
    const { isolatedContext: migratedContext, isolated: migrated } = await seededPage({ 'postform.draft.v1': { text: '**Old 35** and *phone*', spacing: 'social', linkStyle: 'inline' } });
    assert.equal(await migrated.locator('#source').innerText(), ''); assert.ok(await offered(migrated));
    assert.equal(await migrated.locator('#linkStyle').inputValue(), 'colon'); await restore(migrated);
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
    assert.equal(await reopened.locator('#optionsPanel').evaluate(el => el.open), false);
    await reopened.locator('#source').fill('Fresh 35');
    assert.equal(await reopened.locator('#output').inputValue(), 'Fresh 35'); await exportedContext.close();
  });
  await check('Empty draft disables copying and exports', async () => {
    await openOptions();
    await page.click('#clearDraft'); assert.equal(await output(), ''); assert.ok(await page.locator('#copyPost').isDisabled()); assert.ok(await page.locator('#downloadText').isDisabled());
    await page.waitForTimeout(350); assert.equal(await page.evaluate(key => localStorage.getItem(key), draftKey), null);
    await page.reload(); assert.equal(await output(), ''); assert.equal(await offered(), false);
  });
  await check('Deleting all editor text also clears the recoverable backup', async () => {
    await setHtml('<p>Delete this saved draft</p>'); await page.waitForTimeout(350);
    assert.ok(await page.evaluate(key => !!localStorage.getItem(key), draftKey));
    await page.locator('#source').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
    await page.waitForTimeout(350); assert.equal(await page.evaluate(key => localStorage.getItem(key), draftKey), null);
    await page.reload(); assert.equal(await offered(), false); assert.equal(await output(), '');
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
    await page.click('#roughMode');
    const roughSize = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(roughSize.scroll <= roughSize.width); assert.ok(await page.locator('#capsText').isVisible());
    for (const id of ['unicodeMode', 'plainMode', 'roughMode']) assert.ok(await page.locator('#' + id).isVisible());
    await page.screenshot({ path: path.join(artifacts, 'rough-editor-mobile-' + width + '.png'), fullPage: true });
    await page.click('#unicodeMode');
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
  await page.locator('#optionsPanel summary').click(); await page.click('#roughMode'); await setHtml('<p>A small update for AI and MLX. Keep <strong>bold 35B</strong>, <em>italics</em>, and <strong><em>both</em></strong>.</p><p><span data-postform-caps="true">Just the important part.</span></p><p><a href="https://github.com/draconian-delight/postform">GitHub</a></p>');
  await page.screenshot({ path: path.join(artifacts, 'rough-editor-desktop.png'), fullPage: true });
  await check('No uncaught browser errors or external requests', async () => { assert.deepEqual(errors, []); assert.ok(!requests.some(url => /^https?:/.test(url))); });
  await browser.close();
  fs.writeFileSync(path.join(artifacts, 'visual-editor-results.json'), JSON.stringify(results, null, 2));
  console.log(results.filter(result => result.status === 'PASS').length + '/' + results.length + ' browser checks passed.');
  process.exitCode = results.some(result => result.status === 'FAIL') ? 1 : 0;
})().catch(async error => {
  console.error(error);
  fs.writeFileSync(path.join(artifacts, 'visual-editor-results.json'), JSON.stringify(results, null, 2));
  if (activeBrowser) await activeBrowser.close();
  process.exitCode = 1;
});
