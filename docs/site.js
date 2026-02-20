function copyFromElement(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText).then(() => {
    const prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = prev; }, 1100);
  });
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      const wrap = btn.closest('.card');
      wrap.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      wrap.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(id);
      if (panel) panel.classList.add('active');
    });
  });
}

function setupModeSwitcher() {
  const btns = document.querySelectorAll('.mode-btn');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      btns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.mode-panel').forEach((p) => p.classList.remove('active'));
      const panel = document.getElementById(`mode-${mode}`);
      if (panel) panel.classList.add('active');
    });
  });
}

function animateCounters() {
  const nums = document.querySelectorAll('.stat-num[data-target]');
  nums.forEach((el) => {
    const target = Number(el.dataset.target || 0);
    const duration = 850;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      el.textContent = String(Math.round(target * p));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function setupReveal() {
  const nodes = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.08 });
  nodes.forEach((n) => io.observe(n));
}

window.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupModeSwitcher();
  setupReveal();
  animateCounters();
});
