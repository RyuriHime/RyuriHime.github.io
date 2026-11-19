/* RyuriHime · small, dependency-free theme effects */
(function () {
  'use strict';

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function setupReveal() {
    const items = Array.from(document.querySelectorAll('.recent-post-item, #aside-content .card-widget'));
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    document.documentElement.classList.add('vtuber-js');
    items.forEach((el, index) => {
      el.style.setProperty('--reveal-delay', `${Math.min(index, 8) * 45}ms`);
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    items.forEach((el) => io.observe(el));
    window.setTimeout(() => {
      items.forEach((el) => el.classList.add('is-visible'));
    }, 1000);
  }

  function setupGlow() {
    if (reduceMotion || !window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;

    const glow = document.createElement('div');
    glow.id = 'vtuber-glow';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);

    let x = -400;
    let y = -400;
    let tx = x;
    let ty = y;
    let visible = false;
    let raf = 0;

    function tick() {
      x += (tx - x) * 0.16;
      y += (ty - y) * 0.16;
      glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.abs(tx - x) < 0.5 && Math.abs(ty - y) < 0.5) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    document.addEventListener('pointermove', (event) => {
      tx = event.clientX;
      ty = event.clientY;
      if (!visible) {
        visible = true;
        glow.style.opacity = '0.32';
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }, { passive: true });

    document.addEventListener('pointerleave', () => {
      visible = false;
      glow.style.opacity = '0';
    }, { passive: true });
  }

  function setupExternalLinks() {
    document.querySelectorAll('#article-container a[href^="http"]').forEach((a) => {
      if (a.hostname && a.hostname !== window.location.hostname) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function setupAdminEntry() {
    const local = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
    if (!local || document.querySelector('.vtuber-admin-entry')) return;
    const link = document.createElement('a');
    link.className = 'vtuber-admin-entry';
    link.href = 'http://127.0.0.1:4010';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '写作后台';
    document.body.appendChild(link);
  }

  const OPACITY_KEY = 'ryuri.pageOpacity';
  const OPACITY_DEFAULT = 90;

  function applyPageOpacity(value) {
    const pct = Math.min(100, Math.max(40, Math.round(Number(value) || OPACITY_DEFAULT)));
    document.documentElement.style.setProperty('--ui-page-alpha', (pct / 100).toFixed(2));
    document.querySelectorAll('.vtuber-opacity-value').forEach((el) => {
      el.textContent = pct + '%';
    });
    document.querySelectorAll('.vtuber-opacity-input').forEach((el) => {
      if (Number(el.value) !== pct) el.value = String(pct);
    });
    return pct;
  }

  function setupPageOpacity() {
    if (document.querySelector('.vtuber-opacity')) return;

    let saved = OPACITY_DEFAULT;
    try {
      const raw = window.localStorage.getItem(OPACITY_KEY);
      if (raw !== null) saved = Number(raw);
    } catch (e) { /* storage may be unavailable */ }

    const wrap = document.createElement('div');
    wrap.className = 'vtuber-opacity';
    wrap.innerHTML = [
      '<button class="vtuber-opacity-toggle" type="button" aria-expanded="false">',
      '<i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i>',
      '<span>卡片</span><b class="vtuber-opacity-value"></b>',
      '</button>',
      '<div class="vtuber-opacity-panel" role="group" aria-label="卡片不透明度">',
      '<div class="vtuber-opacity-head"><span>卡片不透明度</span><b class="vtuber-opacity-value"></b></div>',
      '<input class="vtuber-opacity-input" type="range" min="40" max="100" step="1">',
      '<div class="vtuber-opacity-foot"><span>透</span><span>实</span></div>',
      '</div>',
    ].join('');

    const toggle = wrap.querySelector('.vtuber-opacity-toggle');
    const input = wrap.querySelector('.vtuber-opacity-input');

    toggle.addEventListener('click', () => {
      const open = wrap.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    input.addEventListener('input', () => {
      const pct = applyPageOpacity(input.value);
      try { window.localStorage.setItem(OPACITY_KEY, String(pct)); } catch (e) { /* ignore */ }
    });

    document.body.appendChild(wrap);
    applyPageOpacity(saved);
  }

  let profileMenusReady = false;

  function setupProfileMenus() {
    if (profileMenusReady) return;
    profileMenusReady = true;

    const hover = window.matchMedia('(hover: hover)');
    const closeAll = (except) => {
      document.querySelectorAll('.profile-link-wrap.open').forEach((wrap) => {
        if (wrap === except) return;
        wrap.classList.remove('open');
        const main = wrap.querySelector('.profile-link-main');
        if (main) main.setAttribute('aria-expanded', 'false');
      });
    };

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest('.profile-submenu')) return;
      const main = target.closest('.profile-link-main');
      if (main && !hover.matches) {
        const wrap = main.parentElement;
        if (!wrap.classList.contains('open')) {
          event.preventDefault();
          closeAll(wrap);
          wrap.classList.add('open');
          main.setAttribute('aria-expanded', 'true');
        }
        return;
      }
      closeAll(null);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAll(null);
    });
  }

  function boot() {
    setupReveal();
    setupExternalLinks();
    setupPageOpacity();
    setupProfileMenus();
    setupAdminEntry();
  }

  ready(boot);
  document.addEventListener('pjax:complete', boot);

  console.log('%c RyuriHime ', 'background:#c9a4ff;color:#160c24;font-weight:700;border-radius:6px;padding:3px 6px');
})();
