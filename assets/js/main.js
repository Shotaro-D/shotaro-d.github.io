const button = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');

const setMenuState = (open) => {
  nav?.classList.toggle('is-open', open);
  button?.setAttribute('aria-expanded', String(open));
};

button?.addEventListener('click', () => {
  setMenuState(!nav.classList.contains('is-open'));
});

nav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) setMenuState(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuState(false);
});
