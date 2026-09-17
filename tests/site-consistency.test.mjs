import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// #56/#58/#59/#60 の整合性テスト。正規表現のみで検査し，依存は追加しない。

const PAGES = [
  'index.html', 'profile.html', 'publications.html', 'presentations.html',
  'award.html', 'resources.html', 'post.html', 'light-energy-calculation.html',
  'pdf-q-range-calculation.html', 'subscript-superscript.html',
  'en/index.html', 'en/profile.html', 'en/publications.html', 'en/presentations.html',
  'en/award.html', 'en/resources.html', 'en/post.html', 'en/light-energy-calculation.html',
  'en/pdf-q-range-calculation.html', 'en/subscript-superscript.html'
];

const read = (relPath) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

// ホスト＋パスで比較するため，フラグメント（# 以降）と末尾スラッシュを無視して正規化する。
const normalizeUrl = (href) => {
  try {
    const url = new URL(href);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${url.host}${path}`;
  } catch (error) {
    return href;
  }
};

// <li>...</li> 単位に切り出し，各要素から <time datetime> と外部リンクを拾う。
const extractTimeAndLinks = (liHtml, label) => {
  const timeMatch = liHtml.match(/<time\b([^>]*)>([^<]*)<\/time>/);
  assert.ok(timeMatch, `${label}: <time> タグが見つかりません`);
  const datetimeMatch = timeMatch[1].match(/datetime="([^"]*)"/);
  assert.ok(datetimeMatch, `${label}: <time> に datetime 属性がありません（表示: "${timeMatch[2].trim()}"）`);
  const links = [...liHtml.matchAll(/<a\b[^>]*href="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((href) => href.startsWith('http'));
  return { datetime: datetimeMatch[1], displayText: timeMatch[2].trim(), links };
};

const extractListItems = (html, listRegex, label) => {
  const listMatch = html.match(listRegex);
  assert.ok(listMatch, `${label}: 対象のリストが見つかりません`);
  const liMatches = [...listMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];
  assert.ok(liMatches.length > 0, `${label}: <li> 要素が見つかりません`);
  return liMatches.map((match, index) => extractTimeAndLinks(match[1], `${label} #${index + 1}`));
};

// 1. 20ページ共通: skip-link, <main>, OGPメタタグ
let ogImageUrl = null;

for (const page of PAGES) {
  const html = read(page);
  const isEn = page.startsWith('en/');

  const bodyMatch = html.match(/<body>\s*\n\s*(<a class="skip-link"[^>]*>[^<]*<\/a>)/);
  assert.ok(bodyMatch, `${page}: <body> 直後の最初の要素が skip-link ではありません`);
  const skipLinkTag = bodyMatch[1];
  assert.ok(skipLinkTag.includes('href="#main"'), `${page}: skip-link の href が #main ではありません: ${skipLinkTag}`);
  const expectedSkipText = isEn ? 'Skip to main content' : '本文へ移動';
  assert.ok(skipLinkTag.includes(`>${expectedSkipText}<`), `${page}: skip-link のテキストが不正です: ${skipLinkTag}`);

  const mainMatches = html.match(/<main id="main" tabindex="-1">/g) || [];
  assert.equal(mainMatches.length, 1, `${page}: <main id="main" tabindex="-1"> が ${mainMatches.length} 個です（1個であるべき）`);

  const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)">/);
  assert.ok(ogImageMatch, `${page}: og:image が見つかりません`);
  if (ogImageUrl === null) {
    ogImageUrl = ogImageMatch[1];
  } else {
    assert.equal(ogImageMatch[1], ogImageUrl, `${page}: og:image のURLが他ページと異なります: ${ogImageMatch[1]}`);
  }

  const widthMatch = html.match(/<meta property="og:image:width" content="([^"]+)">/);
  assert.ok(widthMatch, `${page}: og:image:width が見つかりません`);
  assert.equal(widthMatch[1], '1200', `${page}: og:image:width が1200ではありません: ${widthMatch[1]}`);

  const heightMatch = html.match(/<meta property="og:image:height" content="([^"]+)">/);
  assert.ok(heightMatch, `${page}: og:image:height が見つかりません`);
  assert.equal(heightMatch[1], '630', `${page}: og:image:height が630ではありません: ${heightMatch[1]}`);

  const altMatch = html.match(/<meta property="og:image:alt" content="([^"]*)">/);
  assert.ok(altMatch, `${page}: og:image:alt が見つかりません`);
  assert.ok(altMatch[1].trim().length > 0, `${page}: og:image:alt が空です`);

  const twitterMatch = html.match(/<meta name="twitter:card" content="([^"]+)">/);
  assert.ok(twitterMatch, `${page}: twitter:card が見つかりません`);
  assert.equal(twitterMatch[1], 'summary_large_image', `${page}: twitter:card が summary_large_image ではありません: ${twitterMatch[1]}`);
}

console.log(`PASS: skip link, <main>, and OGP tags verified on ${PAGES.length} pages.`);

// 2. OGP画像ファイルの実在確認（PNGならIHDRから1200x630を確認）
{
  const prefix = 'https://shotaro-d.github.io/';
  assert.ok(ogImageUrl.startsWith(prefix), `og:image のURLが想定外の形式です: ${ogImageUrl}`);
  const relativePath = ogImageUrl.slice(prefix.length);

  let buffer;
  try {
    buffer = readFileSync(new URL(`../${relativePath}`, import.meta.url));
  } catch (error) {
    assert.fail(`OGP画像ファイルが見つかりません: ${relativePath}`);
  }

  if (relativePath.toLowerCase().endsWith('.png')) {
    assert.equal(buffer.readUInt32BE(0), 0x89504e47, `PNGシグネチャが不正です: ${relativePath}`);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    assert.equal(width, 1200, `OGP画像の幅が1200pxではありません: ${width}`);
    assert.equal(height, 630, `OGP画像の高さが630pxではありません: ${height}`);
    console.log(`PASS: OGP image (${relativePath}) exists and its IHDR reports 1200x630.`);
  } else {
    console.log(`PASS: OGP image (${relativePath}) exists (non-PNG, size check skipped).`);
  }
}

// 3/4. award-list と news-list の <time datetime> を ja/en で比較
const awardListRegex = /<ol class="award-list">([\s\S]*?)<\/ol>/;
const newsListRegex = /<ul class="simple-list news-list">([\s\S]*?)<\/ul>/;

const jaAwardHtml = read('award.html');
const enAwardHtml = read('en/award.html');
const jaIndexHtml = read('index.html');
const enIndexHtml = read('en/index.html');

const jaAwardItems = extractListItems(jaAwardHtml, awardListRegex, 'award.html');
const enAwardItems = extractListItems(enAwardHtml, awardListRegex, 'en/award.html');
const jaNewsItems = extractListItems(jaIndexHtml, newsListRegex, 'index.html');
const enNewsItems = extractListItems(enIndexHtml, newsListRegex, 'en/index.html');

assert.equal(jaAwardItems.length, enAwardItems.length, 'award.html と en/award.html の受賞件数が一致しません');
assert.deepEqual(
  jaAwardItems.map((item) => item.datetime),
  enAwardItems.map((item) => item.datetime),
  'award.html と en/award.html の datetime の並びが一致しません'
);
console.log(`PASS: award.html and en/award.html datetime order matches (${jaAwardItems.length} entries).`);

assert.equal(jaNewsItems.length, enNewsItems.length, 'index.html と en/index.html のニュース件数が一致しません');
assert.deepEqual(
  jaNewsItems.map((item) => item.datetime),
  enNewsItems.map((item) => item.datetime),
  'index.html と en/index.html の datetime の並びが一致しません'
);
console.log(`PASS: index.html and en/index.html datetime order matches (${jaNewsItems.length} entries).`);

// 5. 表示文字列と datetime の一致
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const parseJaDate = (text, label) => {
  const full = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const monthOnly = text.match(/^(\d{4})年(\d{1,2})月$/);
  if (monthOnly) return `${monthOnly[1]}-${monthOnly[2].padStart(2, '0')}`;
  assert.fail(`${label}: 日本語の日付表記を解析できません: "${text}"`);
  return undefined;
};

const parseEnDate = (text, label) => {
  const monthPattern = MONTH_NAMES.join('|');
  const full = text.match(new RegExp(`^(\\d{1,2}) (${monthPattern}) (\\d{4})$`));
  if (full) {
    const month = MONTH_NAMES.indexOf(full[2]) + 1;
    return `${full[3]}-${String(month).padStart(2, '0')}-${full[1].padStart(2, '0')}`;
  }
  const monthOnly = text.match(new RegExp(`^(${monthPattern}) (\\d{4})$`));
  if (monthOnly) {
    const month = MONTH_NAMES.indexOf(monthOnly[1]) + 1;
    return `${monthOnly[2]}-${String(month).padStart(2, '0')}`;
  }
  assert.fail(`${label}: 英語の日付表記を解析できません: "${text}"`);
  return undefined;
};

const verifyDisplayMatchesDatetime = (items, parseFn, label) => {
  for (const [index, item] of items.entries()) {
    const parsed = parseFn(item.displayText, `${label} #${index + 1}`);
    assert.equal(
      parsed,
      item.datetime,
      `${label} #${index + 1}: 表示文字列 "${item.displayText}" が datetime "${item.datetime}" と一致しません`
    );
  }
};

verifyDisplayMatchesDatetime(jaAwardItems, parseJaDate, 'award.html');
verifyDisplayMatchesDatetime(enAwardItems, parseEnDate, 'en/award.html');
verifyDisplayMatchesDatetime(jaNewsItems, parseJaDate, 'index.html');
verifyDisplayMatchesDatetime(enNewsItems, parseEnDate, 'en/index.html');

console.log('PASS: displayed dates match their datetime attributes on award and news lists (ja/en).');

// 6. トップの受賞ニュースと受賞ページの一致（ホスト＋パスでリンクを対応づけ，datetimeを比較）
const matchNewsToAward = (newsItems, awardItems, label) => {
  const awardByUrl = new Map();
  for (const item of awardItems) {
    for (const link of item.links) {
      awardByUrl.set(normalizeUrl(link), item.datetime);
    }
  }

  let matchCount = 0;
  for (const item of newsItems) {
    for (const link of item.links) {
      const key = normalizeUrl(link);
      if (!awardByUrl.has(key)) continue;
      matchCount += 1;
      assert.equal(
        item.datetime,
        awardByUrl.get(key),
        `${label}: news の datetime (${item.datetime}) と award の datetime (${awardByUrl.get(key)}) が一致しません（リンク: ${link}）`
      );
    }
  }

  assert.ok(matchCount >= 1, `${label}: トップページのニュースと受賞ページで一致する外部リンクが見つかりません`);
  return matchCount;
};

const jaMatchCount = matchNewsToAward(jaNewsItems, jaAwardItems, 'ja (index.html / award.html)');
const enMatchCount = matchNewsToAward(enNewsItems, enAwardItems, 'en (en/index.html / en/award.html)');

// 現状は「吹田大会2025」と「第75回コロイド討論会」の2件ずつが一致するはず。
console.log(`PASS: news/award link matches verified — ja: ${jaMatchCount}, en: ${enMatchCount} entries.`);

console.log('PASS: all site consistency checks passed.');
