(() => {
  // ---------- Theme toggle ----------
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');

  function applyTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  function currentTheme() {
    const explicit = root.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        localStorage.setItem('theme', next);
      } catch (_) {}
    });
  }

  // ---------- Mobile nav ----------
  const navToggle = document.getElementById('navToggle');
  const primaryNav = document.getElementById('primaryNav');
  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', () => {
      const open = primaryNav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    primaryNav.addEventListener('click', (e) => {
      if (e.target instanceof HTMLAnchorElement) {
        primaryNav.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---------- Install tabs ----------
  document.querySelectorAll('[data-tabs]').forEach((tabs) => {
    const buttons = tabs.querySelectorAll('.tab-btn');
    const panels = tabs.querySelectorAll('.tab-panel');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        buttons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panels.forEach((p) => {
          const active = p.getAttribute('data-panel') === target;
          p.classList.toggle('is-active', active);
          p.hidden = !active;
        });
      });
    });
  });

  // ---------- Copy buttons ----------
  function flashCopied(btn, label) {
    const previous = label.textContent;
    label.textContent = 'Copied!';
    btn.classList.add('is-copied');
    setTimeout(() => {
      label.textContent = previous;
      btn.classList.remove('is-copied');
    }, 1500);
  }

  // Hero install button
  document.querySelectorAll('.copy-btn[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sel = btn.getAttribute('data-copy');
      const target = sel ? document.querySelector(sel) : null;
      if (!target) return;
      const text = target.textContent || '';
      try {
        await navigator.clipboard.writeText(text.trim());
        const label = btn.querySelector('.copy-label') || btn;
        flashCopied(btn, label);
      } catch (_) {}
    });
  });

  // Inject copy buttons into every <pre> block
  document.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-pre-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-pre-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const text = code ? code.textContent || '' : pre.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
          btn.textContent = original;
        }, 1500);
      } catch (_) {}
    });
    pre.appendChild(btn);
  });

  // ---------- Active section highlight in nav ----------
  const navLinks = Array.from(
    document.querySelectorAll('.nav-links a[href^="#"]'),
  );
  const sectionMap = new Map();
  navLinks.forEach((a) => {
    const id = a.getAttribute('href')?.slice(1);
    if (!id) return;
    const sec = document.getElementById(id);
    if (sec) sectionMap.set(sec, a);
  });

  if ('IntersectionObserver' in window && sectionMap.size > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const link = sectionMap.get(entry.target);
          if (!link) return;
          if (entry.isIntersecting) {
            navLinks.forEach((a) => a.classList.remove('is-active'));
            link.classList.add('is-active');
          }
        });
      },
      {
        rootMargin: '-40% 0px -55% 0px',
        threshold: 0,
      },
    );
    sectionMap.forEach((_link, sec) => observer.observe(sec));
  }

  // ---------- Footer year ----------
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();
