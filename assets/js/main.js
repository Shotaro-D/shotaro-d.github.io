const button = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
button?.addEventListener('click', () => {
  const open = nav.classList.toggle('is-open');
  button.setAttribute('aria-expanded', String(open));
});
