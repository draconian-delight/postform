'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const formatter = require('../src/formatter.js');
const { format, stylize, stripStyles, countCodePoints } = formatter;

test('visual editor import renders regular bold and italic markup without Unicode conversion', () => {
  assert.equal(formatter.toEditorHtml('**35B** and *phone*'), '<p><strong>35B</strong> and <em>phone</em></p>');
  assert.ok(!formatter.toEditorHtml('**35B**').includes('𝟑'));
});

test('visual editor import keeps mixed-style link labels in one safe hyperlink', () => {
  const html = formatter.toEditorHtml('[**Try** now](https://example.com/a?x=1&y=2)');
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.ok(html.includes('href="https://example.com/a?x=1&amp;y=2"'));
  assert.ok(html.includes('<strong>Try</strong> now'));
  assert.ok(!formatter.toEditorHtml('[Bad](javascript:alert(1))').includes('<a '));
});

test('visual editor import escapes HTML and preserves literal code', () => {
  assert.ok(formatter.toEditorHtml('<img src=x onerror=alert(1)>').includes('&lt;img'));
  assert.ok(!formatter.toEditorHtml('<script>alert(1)</script>').includes('<script>'));
  assert.equal(formatter.toEditorHtml('``say `hi` ``'), '<p><code>say `hi` </code></p>');
  assert.equal(formatter.toEditorHtml('```\n**literal**\n```'), '<pre>**literal**</pre>');
});

test('visual editor import renders headings and semantic lists', () => {
  assert.equal(formatter.toEditorHtml('# Heading\n\n- First\n- Second'), '<p><strong>Heading</strong></p><ul><li>First</li><li>Second</li></ul>');
  assert.equal(formatter.toEditorHtml('3. Third\n8. Eighth'), '<ol start="3"><li value="3">Third</li><li value="8">Eighth</li></ol>');
});

test('matches the requested sans letters and serif bold digit alphabet', () => {
  assert.equal(format('**35 billion parameters. An iPhone 16 Pro. 6.4 tokens/second**'),
    '𝟑𝟓 𝗯𝗶𝗹𝗹𝗶𝗼𝗻 𝗽𝗮𝗿𝗮𝗺𝗲𝘁𝗲𝗿𝘀. 𝗔𝗻 𝗶𝗣𝗵𝗼𝗻𝗲 𝟏𝟔 𝗣𝗿𝗼. 𝟔.𝟒 𝘁𝗼𝗸𝗲𝗻𝘀/𝘀𝗲𝗰𝗼𝗻𝗱');
  assert.equal(format('Normal 35 and **bold 35**'), 'Normal 35 and 𝗯𝗼𝗹𝗱 𝟑𝟓');
});

test('supports italic, both styles, and nested emphasis closing on the same run', () => {
  assert.equal(format('*hi 35*'), '𝘩𝘪 35');
  assert.equal(format('***hi 35***'), '𝙝𝙞 𝟑𝟓');
  assert.equal(format('**bold *italic* okay**'), '𝗯𝗼𝗹𝗱 𝙞𝙩𝙖𝙡𝙞𝙘 𝗼𝗸𝗮𝘆');
  assert.equal(format('**bold *italic***'), '𝗯𝗼𝗹𝗱 𝙞𝙩𝙖𝙡𝙞𝙘');
  assert.equal(format('*italic **bold** okay*'), '𝘪𝘵𝘢𝘭𝘪𝘤 𝙗𝙤𝙡𝙙 𝘰𝘬𝘢𝘺');
  assert.equal(format('__bold__ and _italic_'), '𝗯𝗼𝗹𝗱 and 𝘪𝘵𝘢𝘭𝘪𝘤');
  assert.equal(format('📱_italic_'), '📱𝘪𝘵𝘢𝘭𝘪𝘤');
});

test('keeps underscores in identifiers and unmatched delimiters readable', () => {
  assert.equal(format('foo_bar_baz snake_case __not closed'), 'foo_bar_baz snake_case __not closed');
  assert.equal(format('**No closing'), '**No closing');
  assert.equal(format('* asterisk bullet'), '• asterisk bullet');
  assert.equal(format('a * b and x ** y'), 'a * b and x ** y');
});

test('preserves escaped Markdown markers and literal backslashes', () => {
  assert.equal(format(String.raw`\*not italic\* and \_plain\_`), '*not italic* and _plain_');
  assert.equal(format(String.raw`\[x\]\(y\) C:\Work`), String.raw`[x](y) C:\Work`);
});

test('keeps working URLs, handles, hashtags, and emails ASCII inside styled text', () => {
  assert.equal(format('**Ask @alex about https://example.com/a_b?q=35 and #Tools via hi+help@example.com**'),
    '𝗔𝘀𝗸 @alex 𝗮𝗯𝗼𝘂𝘁 https://example.com/a_b?q=35 𝗮𝗻𝗱 #Tools 𝘃𝗶𝗮 hi+help@example.com');
  assert.equal(format('__@someone__ **#AI35**'), '@someone #AI35');
  assert.equal(format('**Visit https://example.com/a_(b).**'), '𝗩𝗶𝘀𝗶𝘁 https://example.com/a_(b).');
  assert.equal(stylize('@user #AI https://example.com hi@example.com 35', { bold: true }),
    '@user #AI https://example.com hi@example.com 𝟑𝟓');
});

test('expands Markdown links while formatting their labels', () => {
  assert.equal(format('[**Try Tool0 on GitHub.**](https://example.com/Tool0)'),
    '𝗧𝗿𝘆 𝗧𝗼𝗼𝗹𝟎 𝗼𝗻 𝗚𝗶𝘁𝗛𝘂𝗯. (https://example.com/Tool0)');
  assert.equal(format('[Try](https://example.com/a_(b) "optional title")'), 'Try (https://example.com/a_(b))');
  assert.equal(format('[Try](<https://example.com>)'), 'Try (https://example.com)');
  assert.equal(format('[Try](https://example.com)', { linkStyle: 'newline' }), 'Try\nhttps://example.com');
  assert.equal(format('[**Try**](https://example.com)', { linkStyle: 'label' }), '𝗧𝗿𝘆');
});

test('does not duplicate labels already containing the URL; images retain alt and URL', () => {
  assert.equal(format('[https://example.com](https://example.com)'), 'https://example.com');
  assert.equal(format('[**https://example.com**](https://example.com)'), 'https://example.com');
  assert.equal(format('![Model chart](https://example.com/chart.png)'), 'Model chart (https://example.com/chart.png)');
  assert.equal(format('![](https://example.com/chart.png)'), 'https://example.com/chart.png');
  assert.equal(format('<https://example.com>'), 'https://example.com');
});

test('footnote references and benchmark note numbers stay plain', () => {
  assert.equal(format('**1 GiB** of peak memory,[1]\n\n[1] *Benchmark note:* Mac mini M4 Pro.'),
    '𝟏 𝗚𝗶𝗕 of peak memory,[1]\n\n[1] 𝘉𝘦𝘯𝘤𝘩𝘮𝘢𝘳𝘬 𝘯𝘰𝘵𝘦: Mac mini M4 Pro.');
  assert.equal(format('[1]: https://example.com'), '[1]: https://example.com');
  assert.equal(format('**Memory [1] and [^note]**'), '𝗠𝗲𝗺𝗼𝗿𝘆 [1] 𝗮𝗻𝗱 [^note]');
});

test('uses bold headings and readable unordered and numbered lists', () => {
  assert.equal(format('# Model 35\n- **Chat**\n+ *Code*\n2. Run 35\n3) Done'),
    '𝗠𝗼𝗱𝗲𝗹 𝟑𝟓\n• 𝗖𝗵𝗮𝘁\n• 𝘊𝘰𝘥𝘦\n2. Run 35\n3) Done');
  assert.equal(format('Setext 35\n==='), '𝗦𝗲𝘁𝗲𝘅𝘁 𝟑𝟓');
  assert.equal(format('# C#'), '𝗖#');
  assert.equal(format('# C# ###'), '𝗖#');
});

test('social spacing separates pasted lines, keeps lists together, and collapses excess blanks', () => {
  assert.equal(format('First line\r\nSecond line\r\n\r\n\r\nUse these:\n- Chat\n- Code\nClosing'),
    'First line\n\nSecond line\n\nUse these:\n• Chat\n• Code\n\nClosing');
  assert.equal(format('- One\n  continuation\n- Two'), '• One continuation\n• Two');
});

test('preserve mode retains soft wraps and roomy mode separates list items', () => {
  assert.equal(format('A wrapped\nparagraph\n\n\n- First\n- Second', { spacing: 'preserve' }),
    'A wrapped\nparagraph\n\n\n• First\n• Second');
  assert.equal(format('- First\n- Second', { spacing: 'roomy' }), '• First\n\n• Second');
});

test('inline and fenced code stay plain, including Markdown and line breaks', () => {
  assert.equal(format('**Bold `35 *code*` text**'), '𝗕𝗼𝗹𝗱 35 *code* 𝘁𝗲𝘅𝘁');
  assert.equal(format('``a ` b``'), 'a ` b');
  assert.equal(format('Intro\n```js\nconst n = 35;\n\n**literal**\n```\nEnd'),
    'Intro\n\nconst n = 35;\n\n**literal**\n\nEnd');
  assert.equal(format('~~~\n**literal**\n~~~'), '**literal**');
  assert.equal(format('```\nunclosed **code**'), 'unclosed **code**');
});

test('horizontal rules become paragraph separation, and quotes lose Markdown quote markers', () => {
  assert.equal(format('First\n\n---\n\nSecond'), 'First\n\nSecond');
  assert.equal(format('> **Quoted**\n> words'), '𝗤𝘂𝗼𝘁𝗲𝗱\n\nwords');
});

test('preserves emoji sequences, accented characters, and non-Latin scripts', () => {
  const source = '👩🏽‍💻 🇨🇳 **café 35 中文 العربية**';
  assert.equal(format(source), '👩🏽‍💻 🇨🇳 𝗰𝗮𝗳é 𝟑𝟓 中文 العربية');
  assert.equal(stripStyles(format(source)), '👩🏽‍💻 🇨🇳 café 35 中文 العربية');
});

test('serif mode handles the italic h Unicode exception and combined styles', () => {
  assert.equal(format('**Hi 35** *hi* ***Hi***', { font: 'serif' }), '𝐇𝐢 𝟑𝟓 ℎ𝑖 𝑯𝒊');
  assert.equal(stripStyles('𝐇𝐢 𝟑𝟓 ℎ𝑖 𝑯𝒊'), 'Hi 35 hi Hi');
});

test('plain mode removes Markdown and known styles without compatibility normalization', () => {
  assert.equal(format('**Bold 35** *italic* 𝗮 K ① ㎏', { plain: true }), 'Bold 35 italic a K ① ㎏');
  assert.equal(stripStyles('𝗯 𝟑 𝘩 𝙗 𝟯 K ① ㎏ 中文'), 'b 3 h b 3 K ① ㎏ 中文');
});

test('individual style switches remove syntax but leave disabled styles plain', () => {
  assert.equal(format('**bold** *italic* ***both***', { bold: false }), 'bold 𝘪𝘵𝘢𝘭𝘪𝘤 𝘣𝘰𝘵𝘩');
  assert.equal(format('**bold** *italic* ***both***', { italic: false }), '𝗯𝗼𝗹𝗱 italic 𝗯𝗼𝘁𝗵');
});

test('empty input and actual Unicode code-point counts are well defined', () => {
  assert.equal(format(null), '');
  assert.equal(format(''), '');
  assert.equal(countCodePoints('𝗯𝟑📱'), 3);
  assert.equal(countCodePoints('👩🏽‍💻'), 4); // Code points, not graphemes or platform-weighted counts.
  assert.equal(countCodePoints(null), 0);
});

test('complete sample post retains content, destinations, footnotes, and requested formatting', () => {
  const input = 'As @alex notes, clear documentation makes tools easier to use.\n\n' +
    '📱 Our goal is **useful tools close at hand**. It starts when people can **try a project on their own devices, including their phones.**\n\n' +
    'In this fictional example, **we’ve released Tool0’s 35B and 8B models and inference engines.** The 8B model used just **1 GiB of peak active memory** in a sample benchmark,[1] and **we’ve tested both models locally on a Phone 16 Pro.**\n\n' +
    'Use them for:\n\n- 💬 **Multilingual chat and reasoning.**\n- 🛠️ **Offline assistants** for drafting text and helping with code.\n\n' +
    '🔗 [**Explore the project.**](https://example.com/project)\n\n' +
    '🤝 [**Join the discussion**](https://example.com/community) to get help with setup and share what you’re building.\n\n' +
    '[1] *Benchmark note:* 1 GiB is sample allocator memory for this fictional 8B model, measured on a test computer with 24 GB of memory.';
  const out = format(input);
  assert.ok(out.includes('𝗧𝗼𝗼𝗹𝟎’𝘀 𝟑𝟓𝗕 𝗮𝗻𝗱 𝟖𝗕'));
  assert.ok(out.includes('𝗣𝗵𝗼𝗻𝗲 𝟏𝟔 𝗣𝗿𝗼.'));
  assert.ok(out.includes('• 💬 𝗠𝘂𝗹𝘁𝗶𝗹𝗶𝗻𝗴𝘂𝗮𝗹'));
  assert.ok(out.includes('https://example.com/project'));
  assert.ok(out.includes('https://example.com/community'));
  assert.ok(out.includes('benchmark,[1]'));
  assert.ok(out.includes('[1] 𝘉𝘦𝘯𝘤𝘩𝘮𝘢𝘳𝘬 𝘯𝘰𝘵𝘦: 1 GiB'));
  assert.ok(out.startsWith('As @alex notes,'));
  assert.ok(!out.includes('**'));
});
