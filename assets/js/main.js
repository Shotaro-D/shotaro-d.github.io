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
