(() => {
  const body = document.body;
  const composer = document.querySelector('.report-composer');
  const handle = document.querySelector('.resize-handle');
  const provenance = document.querySelector('.provenance-panel');
  const stateSelect = document.querySelector('[data-state-select]');
  const variantLabel = document.querySelector('[data-variant-label]');
  const toast = document.querySelector('.toast');
  const variants = ['A', 'B', 'C'];
  const variantNames = {
    A: 'A — 均衡工作台',
    B: 'B — 分析驾驶舱',
    C: 'C — 叙事工作室',
  };
  const states = ['ready', 'loading', 'empty', 'partial', 'error'];
  let toastTimer;
  let saveTimer;

  const params = new URLSearchParams(window.location.search);
  const initialVariant = (params.get('variant') || 'A').toUpperCase();
  const initialState = params.get('state') || 'ready';
  body.dataset.variant = variants.includes(initialVariant) ? initialVariant : 'A';
  body.dataset.state = states.includes(initialState) ? initialState : 'ready';
  body.dataset.reportStyle = 'business';
  stateSelect.value = body.dataset.state;

  const updateURL = () => {
    const next = new URL(window.location.href);
    next.searchParams.set('variant', body.dataset.variant);
    next.searchParams.set('state', body.dataset.state);
    window.history.replaceState({}, '', next);
  };

  const updateVariant = (variant) => {
    body.dataset.variant = variant;
    variantLabel.textContent = variantNames[variant];
    composer.classList.remove('is-closed', 'is-fullscreen');
    updateURL();
  };

  const cycleVariant = (direction) => {
    const index = variants.indexOf(body.dataset.variant);
    updateVariant(variants[(index + direction + variants.length) % variants.length]);
  };

  const showToast = (message) => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2100);
  };

  const setSaving = (message = '保存中') => {
    const saveState = document.querySelector('[data-save-state]');
    if (!saveState) return;
    window.clearTimeout(saveTimer);
    saveState.querySelector('span').textContent = message;
    saveState.querySelector('i').style.background = '#9a5700';
    saveTimer = window.setTimeout(() => {
      saveState.querySelector('span').textContent = '已保存';
      saveState.querySelector('i').style.background = '#167c46';
    }, 850);
  };

  document.querySelector('[data-prev]').addEventListener('click', () => cycleVariant(-1));
  document.querySelector('[data-next]').addEventListener('click', () => cycleVariant(1));
  stateSelect.addEventListener('change', () => {
    body.dataset.state = stateSelect.value;
    updateURL();
  });

  document.addEventListener('keydown', (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    const editing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable;
    if (editing) return;
    if (event.key === 'ArrowLeft') cycleVariant(-1);
    if (event.key === 'ArrowRight') cycleVariant(1);
    if (event.key === 'Escape') {
      if (!provenance.hidden) {
        provenance.hidden = true;
      } else if (composer.classList.contains('is-fullscreen')) {
        composer.classList.remove('is-fullscreen');
      }
    }
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((candidate) => {
        candidate.classList.toggle('active', candidate.dataset.mode === button.dataset.mode);
      });
      setSaving();
      showToast(button.dataset.mode === 'refine' ? '已切换到精细模式' : '已切换到快速生成');
    });
  });

  document.querySelectorAll('[data-style]').forEach((button) => {
    button.addEventListener('click', () => {
      body.dataset.reportStyle = button.dataset.style;
      document.querySelectorAll('[data-style]').forEach((candidate) => {
        candidate.classList.toggle('active', candidate.dataset.style === button.dataset.style);
      });
      setSaving('应用风格');
    });
  });

  document.querySelectorAll('[data-provenance]').forEach((button) => {
    button.addEventListener('click', () => {
      provenance.hidden = !provenance.hidden;
    });
  });

  document.querySelectorAll('[data-fullscreen]').forEach((button) => {
    button.addEventListener('click', () => {
      composer.classList.toggle('is-fullscreen');
      showToast(composer.classList.contains('is-fullscreen') ? '已进入全屏编辑' : '已恢复并排编辑');
    });
  });

  document.querySelector('[data-close-report]').addEventListener('click', () => {
    composer.classList.add('is-closed');
  });
  document.querySelector('[data-open-report]').addEventListener('click', () => {
    composer.classList.remove('is-closed');
  });

  document.querySelector('[data-version]').addEventListener('click', () => {
    setSaving('创建版本');
    showToast('已保存版本：经营分析 · 15:48');
  });

  document.querySelectorAll('[data-series]').forEach((button) => {
    button.addEventListener('click', () => {
      const series = button.dataset.series;
      button.classList.toggle('muted');
      const variant = button.closest('.variant');
      variant?.querySelectorAll('.line-chart').forEach((chart) => {
        chart.classList.toggle('hide-' + series, button.classList.contains('muted'));
      });
    });
  });

  const promptFields = [...document.querySelectorAll('.shared-prompt')];
  promptFields.forEach((field) => {
    field.addEventListener('input', () => {
      promptFields.forEach((candidate) => {
        if (candidate !== field) candidate.value = field.value;
      });
    });
  });
  document.querySelectorAll('.shared-prompt-form').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = form.querySelector('.shared-prompt')?.value.trim();
      if (!value) {
        showToast('先输入一条报表修改指令');
        return;
      }
      setSaving('Agent 修改中');
      showToast('Agent 正在修改同一份个人报表');
      window.setTimeout(() => {
        promptFields.forEach((field) => { field.value = ''; });
        setSaving();
        showToast('修改完成，已自动保存草稿');
      }, 1200);
    });
  });

  document.querySelectorAll('.report-module').forEach((module) => {
    module.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      document.querySelectorAll('.report-module').forEach((candidate) => candidate.classList.remove('selected-module'));
      module.classList.add('selected-module');
      showToast('已选中图表 · Agent 指令将作用于此模块');
    });
  });

  const beginResize = (event) => {
    if (window.innerWidth <= 900 || body.dataset.variant !== 'A') return;
    event.preventDefault();
    body.classList.add('is-resizing');
    const onMove = (moveEvent) => {
      const min = Math.max(480, window.innerWidth * .35);
      const max = window.innerWidth * .75;
      const width = Math.min(max, Math.max(min, window.innerWidth - moveEvent.clientX));
      document.documentElement.style.setProperty('--composer-width', width + 'px');
    };
    const onUp = () => {
      body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      showToast('生成器宽度已调整');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  handle.addEventListener('pointerdown', beginResize);
  handle.addEventListener('dblclick', () => {
    document.documentElement.style.setProperty('--composer-width', '46vw');
    showToast('已恢复默认宽度');
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = composer.getBoundingClientRect().width;
    const delta = event.key === 'ArrowLeft' ? 16 : -16;
    document.documentElement.style.setProperty('--composer-width', Math.max(480, current + delta) + 'px');
  });

  document.querySelectorAll('.state-card button, .partial-banner button').forEach((button) => {
    button.addEventListener('click', () => {
      body.dataset.state = 'ready';
      stateSelect.value = 'ready';
      updateURL();
      showToast(button.textContent.includes('修改') ? '已返回查询条件' : '已重新执行真实查询');
    });
  });

  document.querySelector('.studio-generate').addEventListener('click', () => {
    setSaving('生成中');
    showToast('正在应用风格并生成报表');
  });

  updateVariant(body.dataset.variant);
})();
