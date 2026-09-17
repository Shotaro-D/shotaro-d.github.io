const button = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
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
