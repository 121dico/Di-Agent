const variants = [
  { key: 'A', label: 'Balanced Workbench' },
  { key: 'B', label: 'Calm Canvas' },
  { key: 'C', label: 'Operations Focus' },
];

const iconPaths = {
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6M23 11h-6"></path>',
  bot: '<rect x="4" y="7" width="16" height="12" rx="3"></rect><path d="M9 3h6M12 3v4M8 12h.01M16 12h.01M9 16h6"></path>',
  sparkles: '<path d="m12 3-1.2 3.2L8 7.5l2.8 1.3L12 12l1.2-3.2L16 7.5l-2.8-1.3zM5 14l-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8zM19 13l-.7 1.8-1.8.7 1.8.7L19 18l.7-1.8 1.8-.7-1.8-.7z"></path>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"></path><path d="M4 6.5v13"></path>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="3"></rect><path d="m8 12 2.5 2.5L16 9"></path>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>',
  settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.08A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.08A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.38.32.73.6 1 .28.27.63.48 1 .6h.08v4H21a1.7 1.7 0 0 0-1 .4 1.7 1.7 0 0 0-.6 1z"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  'chevron-down': '<path d="m6 9 6 6 6-6"></path>',
  'chevron-up': '<path d="m6 15 6-6 6 6"></path>',
  'chevron-right': '<path d="m9 18 6-6-6-6"></path>',
  more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
  paperclip: '<path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"></path>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M15 4v16"></path>',
  terminal: '<path d="m4 17 6-5-6-5M12 19h8"></path>',
  check: '<path d="m5 12 4 4L19 6"></path>',
  'file-code': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2"></path>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"></path><path d="M5.5 9A8 8 0 0 1 19 7l1 5M18.5 15A8 8 0 0 1 5 17l-1-5"></path>',
  folder: '<path d="M3 5h6l2 2h10v12H3z"></path>',
  'at-sign': '<circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>',
  'arrow-up': '<path d="m5 12 7-7 7 7M12 19V5"></path>',
  x: '<path d="M18 6 6 18M6 6l12 12"></path>',
  minus: '<path d="M5 12h14"></path>',
  'check-circle': '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>',
  'arrow-left': '<path d="m15 18-6-6 6-6"></path>',
  'arrow-right': '<path d="m9 18 6-6-6-6"></path>',
};

function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    const path = iconPaths[node.dataset.icon];
    if (!path || node.dataset.mounted) return;
    node.dataset.mounted = 'true';
    node.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  });
}

function currentVariantIndex() {
  const key = new URLSearchParams(location.search).get('variant')?.toUpperCase() || 'A';
  const index = variants.findIndex((item) => item.key === key);
  return index < 0 ? 0 : index;
}

let variantIndex = currentVariantIndex();

function applyVariant(index, updateUrl = true) {
  variantIndex = (index + variants.length) % variants.length;
  const variant = variants[variantIndex];
  document.body.dataset.variant = variant.key;
  document.querySelector('#variant-label').textContent = `${variant.key} — ${variant.label}`;
  const grid = document.querySelector('#workspace-grid');
  if (variant.key === 'C') grid.classList.remove('inspector-closed');
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set('variant', variant.key);
    history.replaceState({}, '', url);
  }
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 1800);
}

mountIcons();
applyVariant(variantIndex, false);

document.querySelector('#variant-prev').addEventListener('click', () => applyVariant(variantIndex - 1));
document.querySelector('#variant-next').addEventListener('click', () => applyVariant(variantIndex + 1));

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
  if (!editing && event.key === 'ArrowLeft') applyVariant(variantIndex - 1);
  if (!editing && event.key === 'ArrowRight') applyVariant(variantIndex + 1);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
  }
  if (event.key === 'Escape') {
    const command = document.querySelector('#command-layer');
    if (!command.hidden) closeCommand();
    else if (!document.querySelector('#task-window').hidden) closeTaskWindow();
  }
});

document.querySelectorAll('.group-title').forEach((button) => {
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    button.nextElementSibling.hidden = expanded;
  });
});

document.querySelector('#conversation-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('.conversation-row').forEach((row) => {
    row.hidden = query && !row.textContent.toLowerCase().includes(query);
  });
});

document.querySelectorAll('.conversation-row').forEach((row) => {
  row.addEventListener('click', () => {
    document.querySelectorAll('.conversation-row').forEach((item) => item.classList.remove('active'));
    row.classList.add('active');
    document.querySelector('#chat-title').textContent = row.dataset.title;
    document.querySelector('#chat-subtitle').textContent = row.dataset.subtitle;
    showToast(`已切换到「${row.dataset.title}」`);
  });
});

const grid = document.querySelector('#workspace-grid');
function openInspector() {
  grid.classList.remove('inspector-closed');
  grid.classList.add('inspector-open');
}
function closeInspector() {
  grid.classList.remove('inspector-open');
  if (document.body.dataset.variant === 'C') grid.classList.add('inspector-closed');
}
document.querySelectorAll('.inspector-trigger, .task-detail-trigger').forEach((button) => button.addEventListener('click', openInspector));
document.querySelector('.inspector-close').addEventListener('click', closeInspector);

document.querySelectorAll('.inspector-tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.inspector-tabs button').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
  });
});

const composerInput = document.querySelector('#composer-input');
composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto';
  composerInput.style.height = `${Math.min(composerInput.scrollHeight, 150)}px`;
});

let generationTimer;
document.querySelector('#composer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = composerInput.value.trim();
  if (!text) return;
  const transcript = document.querySelector('.transcript-measure');
  const user = document.createElement('article');
  user.className = 'message-group user-message';
  user.innerHTML = `<div class="user-bubble"></div><div class="message-meta">你 · 刚刚</div>`;
  user.querySelector('.user-bubble').textContent = text;
  transcript.append(user);
  composerInput.value = '';
  composerInput.style.height = '';
  const button = document.querySelector('#send-button');
  button.innerHTML = '<span class="spinner light"></span>';
  button.setAttribute('aria-label', '停止生成');
  document.querySelector('.transcript').scrollTop = document.querySelector('.transcript').scrollHeight;
  clearTimeout(generationTimer);
  generationTimer = setTimeout(() => {
    button.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths['arrow-up']}</svg>`;
    button.setAttribute('aria-label', '发送消息');
    showToast('原型已模拟 Agent 接收消息');
  }, 1500);
});

const taskCapsule = document.querySelector('#task-capsule');
const taskWindow = document.querySelector('#task-window');
function openTaskWindow() { taskWindow.hidden = false; taskCapsule.hidden = true; taskCapsule.setAttribute('aria-expanded', 'true'); }
function closeTaskWindow() { taskWindow.hidden = true; taskCapsule.hidden = false; taskCapsule.setAttribute('aria-expanded', 'false'); taskCapsule.focus(); }
taskCapsule.addEventListener('click', openTaskWindow);
document.querySelector('.task-window-close').addEventListener('click', closeTaskWindow);

const dragHandle = document.querySelector('#task-drag-handle');
let dragState;
dragHandle.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  const rect = taskWindow.getBoundingClientRect();
  taskWindow.style.right = 'auto';
  taskWindow.style.bottom = 'auto';
  taskWindow.style.left = `${rect.left}px`;
  taskWindow.style.top = `${rect.top}px`;
  dragState = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
  dragHandle.setPointerCapture(event.pointerId);
  taskWindow.classList.add('dragging');
});
dragHandle.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.id !== event.pointerId) return;
  const rect = taskWindow.getBoundingClientRect();
  const maxLeft = Math.max(8, innerWidth - rect.width - 8);
  const maxTop = Math.max(8, innerHeight - rect.height - 8);
  const left = Math.min(maxLeft, Math.max(8, dragState.left + event.clientX - dragState.x));
  const top = Math.min(maxTop, Math.max(8, dragState.top + event.clientY - dragState.y));
  taskWindow.style.left = `${left}px`;
  taskWindow.style.top = `${top}px`;
});
function finishDrag(event) {
  if (!dragState || dragState.id !== event.pointerId) return;
  const rect = taskWindow.getBoundingClientRect();
  const snap = 20;
  if (rect.left < snap) taskWindow.style.left = '8px';
  if (innerWidth - rect.right < snap) taskWindow.style.left = `${innerWidth - rect.width - 8}px`;
  if (rect.top < snap) taskWindow.style.top = '8px';
  if (innerHeight - rect.bottom < snap) taskWindow.style.top = `${innerHeight - rect.height - 8}px`;
  dragState = null;
  taskWindow.classList.remove('dragging');
}
dragHandle.addEventListener('pointerup', finishDrag);
dragHandle.addEventListener('pointercancel', finishDrag);

const resizeCorner = document.querySelector('.resize-corner');
let resizeState;
resizeCorner.addEventListener('pointerdown', (event) => {
  const rect = taskWindow.getBoundingClientRect();
  resizeState = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
  resizeCorner.setPointerCapture(event.pointerId);
  event.stopPropagation();
});
resizeCorner.addEventListener('pointermove', (event) => {
  if (!resizeState || resizeState.id !== event.pointerId) return;
  const rect = taskWindow.getBoundingClientRect();
  const width = Math.min(560, Math.max(280, resizeState.width + event.clientX - resizeState.x));
  const height = Math.min(760, Math.max(360, resizeState.height + event.clientY - resizeState.y));
  taskWindow.style.width = `${Math.min(width, innerWidth - rect.left - 8)}px`;
  taskWindow.style.height = `${Math.min(height, innerHeight - rect.top - 8)}px`;
});
resizeCorner.addEventListener('pointerup', (event) => { if (resizeState?.id === event.pointerId) resizeState = null; });
resizeCorner.addEventListener('pointercancel', () => { resizeState = null; });

const commandLayer = document.querySelector('#command-layer');
function openCommand() { commandLayer.hidden = false; requestAnimationFrame(() => commandLayer.querySelector('input').focus()); }
function closeCommand() { commandLayer.hidden = true; document.querySelector('[data-command-trigger]').focus(); }
document.querySelectorAll('[data-command-trigger]').forEach((button) => button.addEventListener('click', openCommand));
document.querySelector('.command-scrim').addEventListener('click', closeCommand);

window.addEventListener('resize', () => {
  if (taskWindow.hidden || !taskWindow.style.left) return;
  const rect = taskWindow.getBoundingClientRect();
  taskWindow.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, innerWidth - rect.width - 8))}px`;
  taskWindow.style.top = `${Math.min(Math.max(8, rect.top), Math.max(8, innerHeight - rect.height - 8))}px`;
});
