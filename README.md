# Postform

A small offline formatter for LinkedIn and X. Paste a draft, keep its bold and italics, and copy the whole post with its spacing intact. Bold letters and numbers convert together.

![Postform visual editor with a live Unicode preview](docs/preview.png)

## Use it

Download [Postform.html](https://github.com/draconian-delight/postform/releases/latest/download/Postform.html) and open it in your browser. You can also download the [ZIP with a quick start guide](https://github.com/draconian-delight/postform/releases/latest/download/Postform.zip). The app is one HTML file: no installation, account, or server required.

1. Paste Markdown or a formatted draft into the editor.
2. Edit visually. Select text to add bold, italics, lists, or links.
3. Click **Copy post**, then paste into LinkedIn or X.

Choose **Unicode**, **Plain**, or **Rough** above the editor. **Options** is beside the modes and starts collapsed. Open it for spacing, font, and link settings, **Try an example**, **Save post as .txt**, and **Download app**. Ctrl/⌘B and Ctrl/⌘I format selected text; Ctrl/⌘Enter copies the post.

Every opening starts with an empty editor. Click **Restore draft** to recover your last saved draft, including its formatting and CAPS annotations. Drafts and settings are saved separately: changing settings or closing an untouched empty editor leaves your saved draft intact. **Clear** removes both the current draft and its backup; deleting all editor text also clears the backup. Drafts from earlier versions migrate to a manually recoverable backup.

Storage stays in your browser when available and can depend on the browser and file location. There are no uploads, analytics, external scripts, or remote fonts.

## Formatting

- Bold, italic, combined bold italic, and bold numbers.
- Markdown headings, links, lists, inline code, and fenced code.
- Bold, italic, links, and lists pasted from common document editors.
- Social spacing, spaced lists, or your original line breaks.
- Visible link destinations: **Label: URL** by default, or **URL on a new line**.

Styled alphabets cover basic Latin letters. Accented letters, other scripts, and emojis stay as typed. Italic-only numbers stay normal because Unicode has no italic digit alphabet. URLs, email addresses, @mentions, hashtags, footnote markers, and code keep their original characters. The character counter measures Unicode code points; platform limits can differ. Unicode styled letters can be read differently by screen readers; **Plain** provides an unstyled alternative.

## Rough mode

Rough changes only the right-hand output. It lowercases ordinary English prose, puts each sentence in its own paragraph, and separates list items with blank lines. It retains all original bold, italics, and combined formatting.

A fixed set of technical abbreviations and units, mixed-case names, and identifiers with digits preserve terms such as `AI`, `MLX`, `GiB`, `Edge0`, `35B`, and `iPhone`. Ordinary all-caps words are lowercased. Sentence spacing protects URLs, code, decimals, versions, and common English abbreviations. This uses local rules, without AI rewriting or network requests.

Select text and click **CAPS** to toggle uppercase emphasis. The source letters stay unchanged; a dotted underline shows the annotation while Rough is active. CAPS supports native undo and draft restoration. Unicode and Plain ignore these annotations. URLs, email addresses, handles, hashtags, and code remain unchanged even inside a CAPS selection.

Rough has fixed sentence spacing. Switching back restores your ordinary spacing setting.

## Develop

Requires Node.js 20 or later. The app and formatter tests need no installed packages.

```sh
npm run build
npm test
```

The build creates identical standalone files at `dist/Postform.html` and `dist/index.html`. Edit the files in `src/`, then rebuild.

The conversion API defaults to `linkStyle: 'colon'`. Explicit legacy `inline` and `label` values remain supported for callers; the visual editor keeps its own label-only link parsing.

For browser checks:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium or Chrome executable instead. Browser screenshots and reports are written to `tests/artifacts/` and excluded from Git.

## GitHub Pages

The included deployment workflow publishes `dist/`. In repository **Settings → Pages**, choose **GitHub Actions** as the source. Then run **Deploy to GitHub Pages** from the **Actions** tab. Deployment runs only when manually requested. See [GitHub’s Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
