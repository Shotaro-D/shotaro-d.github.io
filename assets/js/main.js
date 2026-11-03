const button = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
const header = document.querySelector('.site-header');
const buttonLabel = button?.querySelector('.sr-only');
const labels = document.documentElement.lang.startsWith('en')
  ? { open: ': open navigation', close: ': close navigation' }
  : { open: 'を開く', close: 'を閉じる' };

const setMenuState = (open) => {
  nav?.classList.toggle('is-open', open);
  button?.setAttribute('aria-expanded', String(open));
  if (buttonLabel) buttonLabel.textContent = open ? labels.close : labels.open;
};

button?.addEventListener('click', () => {
  setMenuState(!nav.classList.contains('is-open'));
});

nav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenuState(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !nav?.classList.contains('is-open')) return;
  const focusWasInMenu = nav.contains(document.activeElement);
  setMenuState(false);
  // 非表示になったリンクにフォーカスが取り残されないよう，開閉ボタンへ戻す。
  if (focusWasInMenu) button?.focus();
});

// メニューの外をクリック・タップしたら閉じる。
document.addEventListener('click', (event) => {
  if (!nav?.classList.contains('is-open') || header?.contains(event.target)) return;
  setMenuState(false);
});

// フォーカスがヘッダーの外へ移ったら閉じる（開いたメニューが本文のフォーカス位置を覆わないようにする）。
document.addEventListener('focusin', (event) => {
  if (!nav?.classList.contains('is-open') || header?.contains(event.target)) return;
  setMenuState(false);
});

// 計算結果のコピー（data-copy-text / data-copy-table）。クリック委譲で拾う。
(() => {
  const isEn = document.documentElement.lang.startsWith('en');
  const messages = isEn
    ? {
        text: (value) => `Copied “${value}”.`,
        table: 'Copied the table as tab-separated text. You can paste it into a spreadsheet.',
        empty: 'There is no result to copy yet. Run the calculation first.',
        fail: 'Could not copy. Please select the result and copy it manually.',
      }
    : {
        text: (value) => `「${value}」をコピーしました。`,
        table: '表をタブ区切りでコピーしました。表計算ソフトに貼り付けられます。',
        empty: 'コピーする計算結果がありません。先に計算を実行してください。',
        fail: 'コピーできませんでした。結果を選択してコピーしてください。',
      };

  // 同じメッセージが連続してもスクリーンリーダーが読み上げるよう，要素ごとにタイマーを管理する。
  const hideTimers = new WeakMap();

  const showCopyStatus = (statusEl, message) => {
    if (!statusEl) return;
    clearTimeout(hideTimers.get(statusEl));
    statusEl.textContent = '';
    setTimeout(() => {
      statusEl.textContent = message;
    }, 50);
    hideTimers.set(
      statusEl,
      setTimeout(() => {
        statusEl.textContent = '';
      }, 4000)
    );
  };

  // subscript-superscript.html の fallbackCopy と同じ方式。
  const fallbackCopy = (text) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  };

  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // clipboard API が失敗した場合はフォールバックへ。
    }
    return fallbackCopy(text);
  };

  const isEmptyResult = (value) => value === '' || value === '—';

  const isTableEmpty = (table) => {
    const bodyRows = table.tBodies[0]?.rows;
    if (!bodyRows || bodyRows.length === 0) return true;
    return Array.from(bodyRows).every((row) =>
      Array.from(row.cells).every((cell) => cell.textContent.trim() === '—')
    );
  };

  const buildTableTsv = (table) =>
    Array.from(table.rows)
      .map((row) =>
        Array.from(row.cells)
          .map((cell) => (cell.dataset.copyLabel ?? cell.textContent).trim().replace(/\s+/g, ' '))
          .join('\t')
      )
      .join('\n');

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-copy-text], [data-copy-table]');
    if (!trigger) return;

    const statusEl = trigger.dataset.copyStatus ? document.getElementById(trigger.dataset.copyStatus) : null;

    if (trigger.dataset.copyText) {
      const target = document.getElementById(trigger.dataset.copyText);
      const value = (target?.textContent ?? '').trim();
      if (isEmptyResult(value)) {
        showCopyStatus(statusEl, messages.empty);
        return;
      }
      copyToClipboard(value).then((copied) => {
        showCopyStatus(statusEl, copied ? messages.text(value) : messages.fail);
      });
      return;
    }

    const table = document.getElementById(trigger.dataset.copyTable);
    if (!table || isTableEmpty(table)) {
      showCopyStatus(statusEl, messages.empty);
      return;
    }
    copyToClipboard(buildTableTsv(table)).then((copied) => {
      showCopyStatus(statusEl, copied ? messages.table : messages.fail);
    });
  });
})();

// 論文一覧の絞り込み（著者区分・出版年）。data-publication-filters の枠にフォームを生成する。
// JavaScript が無効なら枠は hidden のままで，全件をそのまま表示する。
(() => {
  const mount = document.querySelector('[data-publication-filters]');
  const content = mount?.closest('.content');
  if (!content) return;

  const isEn = document.documentElement.lang.startsWith('en');
  const text = isEn
    ? {
        group: 'Filter publications',
        author: 'Author role',
        year: 'Publication year',
        modes: {
          all: 'All',
          first: 'First author',
          'first-or-corresponding': 'First or corresponding author',
          coauthor: 'Co-author',
        },
        allYears: 'All years',
        yearLabel: (year) => year,
        empty: 'No publications match the selected filters.',
        statusAll: (total) => `Showing all ${total} publications.`,
        status: (count, total, conditions) => `Showing ${count} of ${total} publications (${conditions}).`,
        separator: ', ',
      }
    : {
        group: '論文の絞り込み',
        author: '著者区分',
        year: '出版年',
        modes: {
          all: 'すべて',
          first: '筆頭著者',
          'first-or-corresponding': '筆頭著者または責任著者',
          coauthor: '共著者',
        },
        allYears: 'すべての年',
        yearLabel: (year) => `${year}年`,
        empty: '該当する論文はありません。',
        statusAll: (total) => `全${total}件を表示しています。`,
        status: (count, total, conditions) => `${conditions}：${count}件を表示しています（全${total}件）。`,
        separator: '・',
      };

  // h2（査読論文・その他）ごとに，年ラベルとその下の論文をまとめる。出版年は年ラベルから読む。
  const sections = [];
  for (const element of content.children) {
    if (element.tagName === 'H2') {
      sections.push({ heading: element, groups: [] });
    } else if (element.classList.contains('publication-year')) {
      sections.at(-1)?.groups.push({ label: element, year: element.textContent.trim(), records: [] });
    } else if (element.classList.contains('publication')) {
      const group = sections.at(-1)?.groups.at(-1);
      if (!group) continue;
      // 著者行が下線（本人）から始まれば筆頭著者，本人名に * が付いていれば責任著者。
      const authors = element.querySelector('p');
      const self = authors?.querySelector('u');
      const first = Boolean(self) && authors.textContent.trimStart().startsWith(self.textContent.trim());
      const corresponding = Boolean(self) && (self.textContent.includes('*') || /^\s*\*/.test(self.nextSibling?.textContent ?? ''));
      group.records.push({ element, year: group.year, first, corresponding });
    }
  }
  const records = sections.flatMap((section) => section.groups.flatMap((group) => group.records));
  if (records.length === 0) return;

  // 該当なしの区分や，結果が前の区分と同じになる区分（例: 責任著者の論文がまだない）は選択肢に出さない。
  const seenResults = new Set();
  const modes = [
    { value: 'all', matches: () => true },
    { value: 'first', matches: (record) => record.first },
    { value: 'first-or-corresponding', matches: (record) => record.first || record.corresponding },
    { value: 'coauthor', matches: (record) => !record.first },
  ].filter((mode) => {
    const result = records.map((record) => (mode.matches(record) ? '1' : '0')).join('');
    if (!result.includes('1') || seenResults.has(result)) return false;
    seenResults.add(result);
    return true;
  });
  const years = [...new Set(records.map((record) => record.year))].sort((a, b) => Number(b) - Number(a));

  const createSelect = (id, labelText, options) => {
    const field = document.createElement('div');
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = labelText;
    const select = document.createElement('select');
    select.id = id;
    for (const [value, optionText] of options) select.add(new Option(optionText, value));
    field.append(label, select);
    return { field, select };
  };

  const author = createSelect(
    'publication-author-filter',
    text.author,
    modes.map((mode) => [mode.value, text.modes[mode.value]])
  );
  const year = createSelect(
    'publication-year-filter',
    text.year,
    [['all', text.allYears], ...years.map((value) => [value, text.yearLabel(value)])]
  );

  const fields = document.createElement('div');
  fields.className = 'publication-filters-fields';
  fields.setAttribute('role', 'group');
  fields.setAttribute('aria-label', text.group);
  fields.append(author.field, year.field);

  const status = document.createElement('p');
  status.className = 'publication-filters-status';
  status.setAttribute('role', 'status');

  for (const section of sections) {
    section.empty = document.createElement('p');
    section.empty.className = 'publication-filters-empty';
    section.empty.textContent = text.empty;
    section.empty.hidden = true;
    section.heading.after(section.empty);
  }

  const apply = () => {
    const mode = modes.find((entry) => entry.value === author.select.value) ?? modes[0];
    const selectedYear = year.select.value;
    let count = 0;
    let lastVisible = null;

    for (const section of sections) {
      let leading = null;
      for (const group of section.groups) {
        let groupCount = 0;
        for (const record of group.records) {
          const show = mode.matches(record) && (selectedYear === 'all' || record.year === selectedYear);
          record.element.hidden = !show;
          record.element.classList.remove('is-last-visible');
          if (show) {
            groupCount += 1;
            lastVisible = record.element;
          }
        }
        group.label.hidden = groupCount === 0;
        group.label.classList.remove('is-leading');
        if (groupCount > 0 && !leading) leading = group.label;
        count += groupCount;
      }
      leading?.classList.add('is-leading');
      section.empty.hidden = Boolean(leading);
    }
    lastVisible?.classList.add('is-last-visible');

    const conditions = [
      mode.value !== 'all' && text.modes[mode.value],
      selectedYear !== 'all' && text.yearLabel(selectedYear),
    ].filter(Boolean);
    status.textContent = conditions.length === 0
      ? text.statusAll(records.length)
      : text.status(count, records.length, conditions.join(text.separator));
  };

  author.select.addEventListener('change', apply);
  year.select.addEventListener('change', apply);
  // 初期表示の件数は，読み上げ領域を DOM に入れる前に書いておく（読み込み時に読み上げさせない）。
  apply();
  mount.append(fields, status);
  mount.hidden = false;
})();
