import './styles/platform-admin.css';
import { escapeHtml } from '@/utils/sanitize';
import {
  clearStoredAdminToken,
  createUser,
  deletePreset,
  deleteSubscription,
  loginAdmin,
  fetchAdminMeta,
  fetchAdminStats,
  createIntegrationProvider,
  deleteIntegrationProvider,
  fetchIntegrationProviders,
  fetchAiModels,
  fetchLogIndex,
  fetchLogTail,
  fetchPresets,
  fetchSubscriptions,
  fetchUsers,
  fetchWorkspaceSettings,
  getStoredAdminToken,
  isPlatformAdminAvailable,
  resetUserPassword,
  runDeliverAll,
  runMatchAll,
  runSubscriptionDeliver,
  runSubscriptionMatch,
  testIntegrationProvider,
  saveIntegrationProvider,
  saveAiModel,
  testAiModel,
  saveDefaultUserPassword,
  patchWorkspaceSettings,
  savePreset,
  saveSubscription,
  setStoredAdminToken,
  updateUser,
  type IntegrationProviderRow,
  type AdminMeta,
  type AdminStats,
  type LogFileInfo,
  type LogTailResult,
  type PresetRow,
  type SubscriptionRules,
  type SubscriptionRow,
  type UserRow,
  type WorkspaceSettings,
} from '@/services/platform-admin-api';

type Section = 'overview' | 'presets' | 'users' | 'subscriptions' | 'jobs' | 'logs' | 'settings' | 'integrations' | 'ai-models';

let section: Section = 'overview';
let stats: AdminStats | null = null;
let meta: AdminMeta | null = null;
let presets: PresetRow[] = [];
let users: UserRow[] = [];
let subscriptions: SubscriptionRow[] = [];
let logFiles: LogFileInfo[] = [];
let logServices: string[] = [];
let logTail: LogTailResult | null = null;
let logService = 'platform-api';
let logDate = '';
let workspaceSettings: WorkspaceSettings | null = null;
let integrationProviders: IntegrationProviderRow[] = [];
let integrationsPage = 1;
const INTEGRATIONS_PAGE_SIZE = 10;
let aiModels: IntegrationProviderRow[] = [];
let includeDeletedUsers = false;
let subscriptionFilterUserId: string | null = null;
let loginError = '';
let loginLoading = false;
let toast = '';
let toastErr = false;
let sectionLoading = false;
let jobRunning: 'match' | 'deliver' | null = null;
let reloadGeneration = 0;
let modalOpenCount = 0;
let renderQueued = false;

const app = document.getElementById('app')!;

function closeModalBackdrop(backdrop: HTMLElement): void {
  if (!backdrop.isConnected) return;
  backdrop.remove();
  modalOpenCount = Math.max(0, modalOpenCount - 1);
  if (renderQueued) {
    renderQueued = false;
    render();
  }
}

function closeModalFromRoot(root: Element): void {
  const backdrop = root.closest('.pa-modal-backdrop') as HTMLElement | null;
  if (backdrop) closeModalBackdrop(backdrop);
}

function showFloatingToast(msg: string, isErr: boolean): void {
  const el = document.createElement('div');
  el.className = `pa-floating-toast pa-status ${isErr ? 'err' : 'ok'}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showToast(msg: string, isErr = false): void {
  toast = msg;
  toastErr = isErr;
  if (modalOpenCount > 0) {
    showFloatingToast(msg, isErr);
    return;
  }
  render();
  setTimeout(() => {
    toast = '';
    render();
  }, 4000);
}

function rulesSummary(rules: SubscriptionRules): string {
  const parts: string[] = [];
  if (rules.mode === 'daily_brief') parts.push('AI简报');
  else parts.push('关键词');
  if (rules.variant) parts.push(rules.variant);
  const delivery = rules.deliveryLang ?? rules.lang;
  if (delivery) parts.push(`订阅:${formatLangOption(delivery)}`);
  if (rules.contentLangs?.length) parts.push(`源:${rules.contentLangs.map(formatLangOption).join('+')}`);
  else if (rules.lang && rules.deliveryLang && rules.lang !== rules.deliveryLang) {
    parts.push(`源:${formatLangOption(rules.lang)}`);
  }
  if (rules.categories?.length) parts.push(`分类:${rules.categories.join(',')}`);
  if (rules.keywords?.length) parts.push(`词:${rules.keywords.slice(0, 3).join(',')}`);
  return parts.join(' · ') || '—';
}

const FALLBACK_LANG_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  jp: '日本語',
  kor: '한국어',
  fra: 'Français',
  de: 'Deutsch',
  spa: 'Español',
};

function langDisplayName(code: string): string | null {
  const key = code.trim().toLowerCase();
  return meta?.langLabels?.[key] ?? meta?.langLabels?.[code] ?? FALLBACK_LANG_LABELS[key] ?? null;
}

function formatLangOption(code: string): string {
  const name = langDisplayName(code);
  return name ? `${name} (${code})` : code;
}

function defaultRules(): SubscriptionRules {
  return {
    mode: 'keyword',
    variant: 'full',
    deliveryLang: 'zh',
    contentLangs: ['en', 'zh'],
    hours: 24,
    keywords: [],
  };
}

async function reloadSection(): Promise<void> {
  if (modalOpenCount > 0) return;
  const gen = ++reloadGeneration;
  sectionLoading = true;
  render();
  try {
    if (section === 'overview') {
      stats = await fetchAdminStats();
    } else if (section === 'presets') {
      presets = await fetchPresets();
    } else if (section === 'users') {
      [users, subscriptions] = await Promise.all([
        fetchUsers(includeDeletedUsers),
        fetchSubscriptions(),
      ]);
    } else if (section === 'subscriptions') {
      [subscriptions, presets, users] = await Promise.all([
        fetchSubscriptions(subscriptionFilterUserId ? { userId: subscriptionFilterUserId } : undefined),
        fetchPresets(),
        fetchUsers(),
      ]);
    } else if (section === 'logs') {
      const index = await fetchLogIndex();
      logFiles = index.files;
      logServices = index.services.length ? index.services : ['platform-api'];
      if (!logService || !logServices.includes(logService)) {
        logService = logServices[0] ?? 'platform-api';
      }
      if (!logDate) {
        const latest = logFiles.find((f) => f.service === logService);
        logDate = latest?.date ?? new Date().toISOString().slice(0, 10);
      }
      logTail = await fetchLogTail(logService, 300, logDate);
    } else if (section === 'settings') {
      workspaceSettings = await fetchWorkspaceSettings();
    } else if (section === 'integrations') {
      integrationProviders = await fetchIntegrationProviders();
      const totalPages = Math.max(1, Math.ceil(integrationProviders.length / INTEGRATIONS_PAGE_SIZE));
      if (integrationsPage > totalPages) integrationsPage = totalPages;
    } else if (section === 'ai-models') {
      aiModels = await fetchAiModels();
    }
    if (!meta) meta = await fetchAdminMeta();
  } catch (err) {
    if (gen === reloadGeneration) showToast(String(err), true);
  } finally {
    if (gen === reloadGeneration) {
      sectionLoading = false;
      render();
    }
  }
}

function renderLogin(): void {
  app.innerHTML = `
    <div class="pa-login">
      <h1>Platform 管理后台</h1>
      <p>使用管理员账号登录（每个工作区仅一名管理员）</p>
      ${!isPlatformAdminAvailable() ? '<p class="pa-status err">请配置 VITE_PLATFORM_API_URL 并启动 platform:api</p>' : ''}
      ${loginError ? `<p class="pa-status err">${escapeHtml(loginError)}</p>` : ''}
      <div class="pa-field">
        <label>管理员邮箱</label>
        <input id="adminEmailInput" type="email" placeholder="admin@example.com" autocomplete="username" />
      </div>
      <div class="pa-field">
        <label>密码</label>
        <input id="adminPasswordInput" type="password" placeholder="密码" autocomplete="current-password" />
      </div>
      <button class="pa-btn pa-btn-primary" id="adminLoginBtn" style="width:100%" ${loginLoading ? 'disabled' : ''}>
        ${loginLoading ? '登录中…' : '登录'}
      </button>
      <p class="pa-muted" style="margin-top:12px">首次使用请运行 <code>npm run platform:admin:init</code> 创建管理员</p>
    </div>`;

  const submitLogin = () => {
    if (loginLoading) return;
    const email = (document.getElementById('adminEmailInput') as HTMLInputElement).value.trim();
    const password = (document.getElementById('adminPasswordInput') as HTMLInputElement).value;
    if (!email || !password) {
      loginError = '请输入邮箱和密码';
      renderLogin();
      return;
    }
    loginError = '';
    loginLoading = true;
    renderLogin();
    void loginAdmin(email, password)
      .then(() => reloadSection())
      .then(() => {
        loginLoading = false;
        render();
      })
      .catch((err) => {
        loginLoading = false;
        loginError = String(err);
        clearStoredAdminToken();
        renderLogin();
      });
  };

  document.getElementById('adminLoginBtn')?.addEventListener('click', submitLogin);
  document.getElementById('adminPasswordInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitLogin();
  });
  document.getElementById('adminEmailInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitLogin();
  });
}

function navBtn(id: Section, label: string): string {
  return `<button class="pa-nav-btn${section === id ? ' active' : ''}" data-section="${id}">${label}</button>`;
}

function renderShell(content: string): void {
  app.innerHTML = `
    <div class="pa-shell">
      <aside class="pa-sidebar">
        <div class="pa-brand">World Monitor<small>Platform Admin</small></div>
        <nav class="pa-nav">
          ${navBtn('overview', '概览')}
          ${navBtn('presets', '可订阅项')}
          ${navBtn('users', '订阅用户')}
          ${navBtn('subscriptions', '用户订阅')}
          ${navBtn('jobs', '匹配与发信')}
          ${navBtn('logs', '系统日志')}
          ${navBtn('ai-models', 'AI 模型')}
          ${navBtn('integrations', '数据源配置')}
          ${navBtn('settings', '系统设置')}
        </nav>
        <div class="pa-sidebar-foot">
          <button class="pa-btn pa-btn-sm" id="logoutBtn" style="width:100%">退出登录</button>
        </div>
      </aside>
      <main class="pa-main">
        <header class="pa-header">
          <h1>${escapeHtml(sectionTitle(section))}</h1>
          <button class="pa-btn pa-btn-sm" id="refreshBtn" ${sectionLoading ? 'disabled' : ''}>${sectionLoading ? '加载中…' : '刷新'}</button>
        </header>
        <div class="pa-content${sectionLoading ? ' is-loading' : ''}">
          ${sectionLoading ? '<div class="pa-loading-bar" aria-hidden="true"></div>' : ''}
          ${toast ? `<div class="pa-status ${toastErr ? 'err' : 'ok'}">${escapeHtml(toast)}</div>` : ''}
          ${sectionLoading ? '<p class="pa-muted pa-loading-hint">加载中…</p>' : content}
        </div>
      </main>
    </div>`;

  app.querySelectorAll('[data-section]').forEach((el) => {
    el.addEventListener('click', () => {
      if (sectionLoading) return;
      const next = (el as HTMLElement).dataset.section as Section;
      if (next === section) {
        if (next === 'subscriptions') subscriptionFilterUserId = null;
        void reloadSection();
        return;
      }
      section = next;
      if (next === 'integrations') integrationsPage = 1;
      if (next === 'subscriptions') subscriptionFilterUserId = null;
      void reloadSection();
    });
  });
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    clearStoredAdminToken();
    loginError = '';
    renderLogin();
  });
  document.getElementById('refreshBtn')?.addEventListener('click', () => { void reloadSection(); });
  bindSectionEvents();
}

function sectionTitle(s: Section): string {
  const map: Record<Section, string> = {
    overview: '概览',
    presets: '可订阅项（预设目录）',
    users: '订阅用户',
    subscriptions: '用户订阅',
    jobs: '匹配与发信',
    logs: '系统日志',
    'ai-models': 'AI 模型',
    integrations: '数据源配置',
    settings: '系统设置',
  };
  return map[s];
}

function renderOverview(): string {
  if (!stats) return '<p class="pa-muted">加载中…</p>';
  const hxxbotHint = stats.hxxbot.configured
    ? ''
    : ' — <button type="button" class="pa-link-btn" data-goto-section="integrations">去配置</button>';
  return `
    <div class="pa-cards">
      <div class="pa-card"><div class="pa-card-label">新闻条目</div><div class="pa-card-value">${stats.newsItems}</div></div>
      <div class="pa-card"><div class="pa-card-label">用户</div><div class="pa-card-value">${stats.users}</div></div>
      <div class="pa-card"><div class="pa-card-label">订阅</div><div class="pa-card-value">${stats.subscriptions}</div></div>
      <div class="pa-card"><div class="pa-card-label">可订阅项</div><div class="pa-card-value">${stats.presetsEnabled}/${stats.presets}</div></div>
    </div>
    <p>HXXBOT：${stats.hxxbot.configured ? '已配置' : '未配置（无法发邮件）'}${hxxbotHint}</p>
    <p class="pa-muted">API：${escapeHtml(stats.hxxbot.apiBaseUrl ?? '—')}</p>
    ${stats.logging ? `<p class="pa-muted">日志目录：${escapeHtml(stats.logging.logDir)}（级别 ${escapeHtml(stats.logging.level)}）</p>` : ''}`;
}

function renderPresetsTable(): string {
  if (!presets.length) return '<p class="pa-muted">暂无预设，请点击「新建可订阅项」</p>';
  const rows = presets.map((p) => `
    <tr>
      <td><strong>${escapeHtml(p.title)}</strong><br><span class="pa-muted">${escapeHtml(p.slug)}</span></td>
      <td>${escapeHtml(p.description ?? '—')}</td>
      <td><span class="pa-badge${p.enabled ? '' : ' off'}">${p.enabled ? '启用' : '停用'}</span></td>
      <td class="pa-muted">${escapeHtml(rulesSummary(p.rules_json))}</td>
      <td class="pa-actions">
        <button class="pa-btn pa-btn-sm" data-edit-preset="${p.id}">编辑</button>
        <button class="pa-btn pa-btn-sm pa-btn-danger" data-del-preset="${p.id}">删除</button>
      </td>
    </tr>`).join('');
  return `<div class="pa-table-wrap"><table class="pa-table"><thead><tr>
    <th>名称</th><th>说明</th><th>状态</th><th>规则</th><th>操作</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function userStatusBadge(u: UserRow): string {
  const eff = u.effective_status;
  const cls = eff === 'active' ? '' : eff === 'disabled' ? ' warn' : ' off';
  const labels: Record<UserRow['effective_status'], string> = {
    active: '正常',
    disabled: '禁用',
    deleted: '已删除',
  };
  let text = labels[eff];
  if (u.disable_summary && eff === 'disabled') text += `（${u.disable_summary}）`;
  return `<span class="pa-badge${cls}">${escapeHtml(text)}</span>`;
}

function userSubscriptionSummary(userId: string): string {
  const rows = subscriptions.filter((s) => s.user_id === userId);
  if (!rows.length) return '0';
  const active = rows.filter((s) => s.enabled).length;
  return active === rows.length ? String(active) : `${active}/${rows.length}`;
}

function renderUsersTable(): string {
  const rows = users.map((u) => {
    const subSummary = userSubscriptionSummary(u.id);
    const subCell = subSummary === '0'
      ? '<span class="pa-muted">0</span>'
      : `<strong>${escapeHtml(subSummary)}</strong>`;
    return `
    <tr>
      <td class="pa-muted pa-mono-sm" title="${escapeHtml(u.id)}">${escapeHtml(u.id.slice(0, 8))}…</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.display_name ?? '—')}</td>
      <td>${escapeHtml(formatLangOption(u.preferred_lang ?? 'zh'))}</td>
      <td>${subCell}</td>
      <td>${userStatusBadge(u)}</td>
      <td class="pa-muted">${new Date(u.created_at).toLocaleString()}</td>
      <td class="pa-actions">
        <button class="pa-btn pa-btn-sm" data-view-user-subs="${u.id}" ${subSummary === '0' ? 'disabled' : ''}>订阅</button>
        <button class="pa-btn pa-btn-sm" data-edit-user="${u.id}">编辑</button>
        ${u.effective_status !== 'deleted' ? `<button class="pa-btn pa-btn-sm" data-reset-pwd="${u.id}" data-user-email="${escapeHtml(u.email)}">重置密码</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `<p class="pa-muted" style="margin-bottom:12px">「订阅」列数字为启用中的订阅数。点击「订阅」可跳转到<strong>用户订阅</strong>页查看并编辑该用户的全部订阅（含前端自助订阅）。</p>
  <div class="pa-table-wrap"><table class="pa-table"><thead><tr>
    <th>ID</th><th>邮箱</th><th>显示名</th><th>订阅语言</th><th>订阅</th><th>状态</th><th>注册时间</th><th>操作</th>
  </tr></thead><tbody>${rows || '<tr><td colspan="8" class="pa-muted">暂无用户</td></tr>'}</tbody></table></div>`;
}

function renderSettingsPanel(): string {
  const s = workspaceSettings;
  if (!s) return '<p class="pa-muted">加载中…</p>';
  const status = s.hasDefaultPassword
    ? `已配置${s.defaultPasswordUpdatedAt ? `（更新于 ${new Date(s.defaultPasswordUpdatedAt).toLocaleString()}）` : ''}`
    : '<span class="pa-status err" style="display:inline;padding:2px 8px">未配置</span>';
  const legacyHint = s.hasDefaultPassword && !s.defaultUserPassword
    ? '<p class="pa-muted">当前密码为旧版仅存哈希记录，请重新输入并保存一次以在此显示。</p>'
    : '';
  const pwdValue = s.defaultUserPassword ? escapeHtml(s.defaultUserPassword) : '';
  const selfSvcChecked = s.selfServiceSubscriptionsEnabled !== false ? 'checked' : '';
  const maxSubs = s.maxSubscriptionsPerUser ?? 0;
  return `
    <div class="pa-settings-panel">
      <h2 class="pa-settings-heading">用户自助订阅</h2>
      <p class="pa-muted">控制前端用户能否自行订阅/取消；可订阅项列表由「可订阅项」页的启用状态决定。</p>
      <div class="pa-field">
        <label class="pa-inline-check">
          <input type="checkbox" id="selfServiceSubsEnabled" ${selfSvcChecked} />
          允许用户自助订阅
        </label>
      </div>
      <div class="pa-field" style="max-width:240px">
        <label>每用户最大订阅数（0 = 不限制）</label>
        <input type="number" id="maxSubscriptionsPerUser" min="0" step="1" value="${maxSubs}" />
      </div>
      <button class="pa-btn pa-btn-primary" id="saveSubscriptionPolicyBtn">保存订阅策略</button>

      <h2 class="pa-settings-heading" style="margin-top:28px">订阅用户默认密码</h2>
      <p class="pa-muted">后台添加的订阅用户将自动使用此密码。登录校验仍使用不可逆哈希；此处保存加密副本供管理员查看。</p>
      <p>当前状态：${status}</p>
      ${legacyHint}
      <div class="pa-field" style="max-width:360px">
        <label>设置 / 更新默认密码</label>
        <input type="text" id="defaultUserPassword" autocomplete="off" minlength="8" placeholder="至少 8 位" value="${pwdValue}" />
      </div>
      <button class="pa-btn pa-btn-primary" id="saveDefaultPwdBtn">保存默认密码</button>
    </div>`;
}

const INTEGRATION_CATEGORY_LABELS: Record<string, string> = {
  platform: 'HXXBOT',
  market: '市场/宏观',
  energy: '能源',
  geo: '地缘/基础设施',
  military: '军事',
  aviation: '航空',
  cyber: '威胁情报',
  relay: 'Relay 中继',
  custom: '自定义',
};

const INTEGRATION_CATEGORY_HINTS: Record<string, string> = {
  platform: '本平台 HXXBOT 自有 API',
  market: '股票/外汇、宏观指标、国际贸易等经济数据',
  energy: '油气、电力等能源官方或行业统计',
  geo: '冲突、互联网基础设施、卫星遥感等地缘信息',
  military: '军机、防务与 ADS-B 追踪',
  aviation: '民航航班与 ICAO 航空数据',
  cyber: '恶意 URL、IP 信誉、威胁情报',
  relay: '自托管 AIS/RSS/Telegram 等 WebSocket 中继',
};

const PRESET_INTEGRATION_CATEGORIES = [
  'platform', 'market', 'energy', 'geo', 'military', 'aviation', 'cyber', 'relay',
] as const;

const CUSTOM_CATEGORY_VALUE = '__custom__';

function isPresetIntegrationCategory(category: string): boolean {
  return (PRESET_INTEGRATION_CATEGORIES as readonly string[]).includes(category);
}

function integrationCategorySelectOptions(selected: string): string {
  const presetSelected = isPresetIntegrationCategory(selected);
  const customSelected = !presetSelected;
  const presets = PRESET_INTEGRATION_CATEGORIES.map((c) =>
    `<option value="${c}"${c === selected ? ' selected' : ''}>${escapeHtml(INTEGRATION_CATEGORY_LABELS[c] ?? c)}</option>`,
  ).join('');
  return `${presets}<option value="${CUSTOM_CATEGORY_VALUE}"${customSelected ? ' selected' : ''}>自定义…</option>`;
}

function integrationCategoryCustomFieldHtml(value = '', id = 'int_category_custom'): string {
  return `<div class="pa-field" id="${id}_wrap">
    <label>自定义分组名称 *</label>
    <input id="${id}" autocomplete="off" placeholder="如 内部 API、新闻聚合" value="${escapeHtml(value)}" />
    <p class="pa-muted">仅用于后台展示与分类，2–64 个字符。</p>
  </div>`;
}

function bindIntegrationCategoryToggle(root: HTMLElement, selectId: string, wrapId: string): void {
  const select = root.querySelector(`#${selectId}`) as HTMLSelectElement | null;
  const wrap = root.querySelector(`#${wrapId}`) as HTMLElement | null;
  if (!select || !wrap) return;
  const sync = () => {
    wrap.hidden = select.value !== CUSTOM_CATEGORY_VALUE;
  };
  select.addEventListener('change', sync);
  sync();
}

function readIntegrationCategory(root: HTMLElement, selectId: string, customId: string): string {
  const select = root.querySelector(`#${selectId}`) as HTMLSelectElement;
  if (select.value !== CUSTOM_CATEGORY_VALUE) return select.value;
  const custom = (root.querySelector(`#${customId}`) as HTMLInputElement).value.trim();
  if (!custom) throw new Error('请填写自定义分组名称');
  return custom;
}

function integrationRemarksFieldHtml(value = '', id = 'int_remarks'): string {
  return `<div class="pa-field">
    <label>备注</label>
    <textarea id="${id}" rows="3" maxlength="2000" placeholder="可选，记录用途、账号说明等">${escapeHtml(value)}</textarea>
  </div>`;
}

function formatRemarksCell(remarks: string | undefined): string {
  const t = remarks?.trim() ?? '';
  if (!t) return '<span class="pa-muted">—</span>';
  return `<span class="pa-remarks-cell" data-tooltip="${escapeHtml(t)}" aria-label="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
}

let remarksTooltipEl: HTMLDivElement | null = null;

function hideRemarksTooltip(): void {
  if (remarksTooltipEl) remarksTooltipEl.hidden = true;
}

function positionRemarksTooltip(anchor: HTMLElement): void {
  const tip = remarksTooltipEl;
  if (!tip || tip.hidden) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 6;
  let left = rect.left;
  let top = rect.top - tip.offsetHeight - gap;
  if (top < margin) top = rect.bottom + gap;
  if (left + tip.offsetWidth > window.innerWidth - margin) {
    left = window.innerWidth - tip.offsetWidth - margin;
  }
  if (left < margin) left = margin;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showRemarksTooltip(anchor: HTMLElement): void {
  const text = anchor.dataset.tooltip?.trim();
  if (!text) return;
  if (!remarksTooltipEl) {
    remarksTooltipEl = document.createElement('div');
    remarksTooltipEl.className = 'pa-remarks-tooltip';
    remarksTooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(remarksTooltipEl);
  }
  remarksTooltipEl.textContent = text;
  remarksTooltipEl.hidden = false;
  remarksTooltipEl.style.visibility = 'hidden';
  positionRemarksTooltip(anchor);
  remarksTooltipEl.style.visibility = 'visible';
}

function setupRemarksTooltips(): void {
  document.addEventListener('mouseover', (e) => {
    const anchor = (e.target as HTMLElement).closest('.pa-remarks-cell[data-tooltip]') as HTMLElement | null;
    if (!anchor) return;
    showRemarksTooltip(anchor);
  });
  document.addEventListener('mouseout', (e) => {
    const anchor = (e.target as HTMLElement).closest('.pa-remarks-cell[data-tooltip]') as HTMLElement | null;
    if (!anchor) return;
    const related = e.relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    hideRemarksTooltip();
  });
  document.addEventListener('scroll', hideRemarksTooltip, true);
}

function integrationCategoryOptions(selected: string): string {
  return integrationCategorySelectOptions(selected);
}

function paginateList<T>(list: T[], page: number, pageSize: number): {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
} {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
  };
}

function renderTablePagination(
  navKey: string,
  page: number,
  totalPages: number,
  total: number,
  pageSize: number,
): string {
  if (total === 0) return '';
  const pageNums =
    totalPages <= 1
      ? ''
      : Array.from({ length: totalPages }, (_, i) => i + 1)
          .map((n) => {
            const active = n === page ? ' pa-btn-primary' : '';
            return `<button type="button" class="pa-btn pa-btn-sm${active}" data-page-nav="${escapeHtml(navKey)}" data-page="${n}" ${n === page ? 'disabled' : ''}>${n}</button>`;
          })
          .join('');
  return `
    <div class="pa-pagination">
      <span class="pa-muted">共 ${total} 条 · 每页 ${pageSize} 条${totalPages > 1 ? ` · 第 ${page}/${totalPages} 页` : ''}</span>
      ${totalPages > 1 ? `
      <div class="pa-pagination-btns">
        <button type="button" class="pa-btn pa-btn-sm" data-page-nav="${escapeHtml(navKey)}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
        ${pageNums}
        <button type="button" class="pa-btn pa-btn-sm" data-page-nav="${escapeHtml(navKey)}" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>
      </div>` : ''}
    </div>`;
}

function goIntegrationsPage(next: number): void {
  const { page } = paginateList(integrationProviders, next, INTEGRATIONS_PAGE_SIZE);
  integrationsPage = page;
  render();
}

function renderIntegrationsPanel(): string {
  if (sectionLoading && !integrationProviders.length) {
    return '<p class="pa-muted">加载中…（启动 platform:api 时会自动创建表与初始数据）</p>';
  }
  const { items, page, totalPages, total } = paginateList(
    integrationProviders,
    integrationsPage,
    INTEGRATIONS_PAGE_SIZE,
  );
  integrationsPage = page;
  const rowOffset = (page - 1) * INTEGRATIONS_PAGE_SIZE;
  const rows = items.map((p, i) => {
    const cat = INTEGRATION_CATEGORY_LABELS[p.category] ?? p.category;
    const catHint = INTEGRATION_CATEGORY_HINTS[p.category] ?? '';
    const status = p.configured
      ? `<span class="pa-badge">已配置${p.apiKeyHint ? ` ${escapeHtml(p.apiKeyHint)}` : ''}</span>`
      : '<span class="pa-badge off">未配置</span>';
    const enabled = p.enabled
      ? '<span class="pa-badge">启用</span>'
      : '<span class="pa-badge off">禁用</span>';
    const customBadge = p.custom ? ' <span class="pa-badge">自定义</span>' : '';
    return `
    <tr>
      <td class="pa-muted pa-col-index">${rowOffset + i + 1}</td>
      <td>${escapeHtml(p.displayName)}${customBadge}<div class="pa-muted pa-mono-sm">${escapeHtml(p.slug)}</div></td>
      <td title="${escapeHtml(catHint)}">${escapeHtml(cat)}</td>
      <td class="pa-muted" title="${escapeHtml(p.baseUrl)}">${escapeHtml(p.baseUrl || '—')}</td>
      <td>${formatRemarksCell(p.remarks)}</td>
      <td>${status}</td>
      <td>${enabled}</td>
      <td class="pa-actions">
        <button class="pa-btn pa-btn-sm" data-edit-integration="${escapeHtml(p.slug)}">编辑</button>
        ${p.custom ? `<button class="pa-btn pa-btn-sm pa-btn-danger" data-del-integration="${escapeHtml(p.slug)}">删除</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  return `
    <p class="pa-muted">外部数据 API 按<strong>分组</strong>排列（HXXBOT → 市场/宏观 → 能源 → …）。每项只需配置 <strong>Base URL</strong> + <strong>API Key</strong>；「备注」列说明数据来源与机构，可编辑。AI 摘要请至「AI 模型」。</p>
    <div class="pa-table-wrap"><table class="pa-table"><thead><tr>
      <th class="pa-col-index">序号</th><th>数据源</th><th>分组</th><th>Base URL</th><th>备注</th><th>密钥</th><th>状态</th><th>操作</th>
    </tr></thead><tbody>${rows || '<tr><td colspan="8" class="pa-muted">暂无数据源</td></tr>'}</tbody></table></div>
    ${renderTablePagination('integrations', page, totalPages, total, INTEGRATIONS_PAGE_SIZE)}`;
}

function renderAiModelsPanel(): string {
  if (!aiModels.length) {
    return '<p class="pa-muted">加载中…</p>';
  }
  const rows = aiModels.map((p) => {
    const status = p.configured
      ? `<span class="pa-badge">已配置${p.apiKeyHint ? ` ${escapeHtml(p.apiKeyHint)}` : ''}</span>`
      : '<span class="pa-badge off">未配置</span>';
    const enabled = p.enabled
      ? '<span class="pa-badge">启用</span>'
      : '<span class="pa-badge off">禁用</span>';
    return `
    <tr>
      <td>${escapeHtml(p.displayName)}<div class="pa-muted pa-mono-sm">${escapeHtml(p.slug)}</div></td>
      <td class="pa-muted" title="${escapeHtml(p.baseUrl)}">${escapeHtml(p.baseUrl || '—')}</td>
      <td class="pa-mono-sm">${escapeHtml(p.modelName || '—')}</td>
      <td>${formatRemarksCell(p.remarks)}</td>
      <td>${status}</td>
      <td>${enabled}</td>
      <td class="pa-actions">
        <button class="pa-btn pa-btn-sm" data-edit-ai-model="${escapeHtml(p.slug)}">编辑</button>
      </td>
    </tr>`;
  }).join('');
  return `
    <p class="pa-muted">AI 摘要使用 OpenAI 兼容接口（<code>/v1/chat/completions</code>）。每项配置 <strong>Base URL</strong>、<strong>模型名</strong> 与 <strong>API Key</strong>（本地 Ollama / LM Studio 可留空 Key）。摘要链路按 OpenAI 兼容 → Groq → OpenRouter 顺序尝试已启用且已配置的项。</p>
    <div class="pa-table-wrap"><table class="pa-table"><thead><tr>
      <th>模型提供方</th><th>Base URL</th><th>模型名</th><th>备注</th><th>密钥</th><th>状态</th><th>操作</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function deliveryLangOptions(selected = 'zh'): string {
  const langs = meta?.deliveryLangs ?? ['zh', 'en', 'jp', 'kor', 'fra', 'de', 'spa'];
  return langs.map((l) =>
    `<option value="${escapeHtml(l)}"${l === selected ? ' selected' : ''}>${escapeHtml(formatLangOption(l))}</option>`,
  ).join('');
}

function renderSubscriptionsFilterBar(): string {
  if (!subscriptionFilterUserId) return '';
  const u = users.find((x) => x.id === subscriptionFilterUserId);
  const label = u?.email ?? subscriptionFilterUserId;
  return `<p class="pa-filter-bar">正在查看用户 <strong>${escapeHtml(label)}</strong> 的订阅（${subscriptions.length} 条）
    <button type="button" class="pa-link-btn" id="clearSubFilter">显示全部用户</button></p>`;
}

function renderSubscriptionsTable(): string {
  const rows = subscriptions.map((s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.user_email)}</td>
      <td class="pa-muted">${escapeHtml(s.preset_title ?? '自定义')}</td>
      <td class="pa-muted">${escapeHtml(rulesSummary(s.rules_json))}</td>
      <td><span class="pa-badge${s.enabled ? '' : ' off'}">${s.enabled ? '启用' : '停用'}</span></td>
      <td class="pa-actions">
        <button class="pa-btn pa-btn-sm" data-edit-sub="${s.id}">编辑</button>
        <button class="pa-btn pa-btn-sm" data-match-sub="${s.id}">匹配</button>
        <button class="pa-btn pa-btn-sm" data-deliver-sub="${s.id}">发信</button>
        <button class="pa-btn pa-btn-sm pa-btn-danger" data-del-sub="${s.id}">删除</button>
      </td>
    </tr>`).join('');
  return `<div class="pa-table-wrap"><table class="pa-table"><thead><tr>
    <th>名称</th><th>用户</th><th>预设</th><th>规则</th><th>状态</th><th>操作</th>
  </tr></thead><tbody>${rows || '<tr><td colspan="6" class="pa-muted">暂无订阅</td></tr>'}</tbody></table></div>`;
}

function renderLogsPanel(): string {
  const serviceOpts = logServices.map((s) =>
    `<option value="${escapeHtml(s)}"${s === logService ? ' selected' : ''}>${escapeHtml(s)}</option>`,
  ).join('');
  const datesForService = [...new Set(logFiles.filter((f) => f.service === logService).map((f) => f.date))]
    .sort((a, b) => b.localeCompare(a));
  const dateOpts = datesForService.map((d) =>
    `<option value="${escapeHtml(d)}"${d === logDate ? ' selected' : ''}>${escapeHtml(d)}</option>`,
  ).join('');
  const lines = logTail?.lines ?? [];
  const body = lines.length
    ? lines.map((l) => escapeHtml(l)).join('\n')
    : '（该日期暂无日志，请先运行对应 Platform 服务）';
  return `
    <p class="pa-muted">日志文件位于项目 <code>logs/{服务名}/{日期}.log</code>，同时输出到控制台。</p>
    <div class="pa-toolbar pa-log-toolbar">
      <label class="pa-inline-field">服务
        <select id="logServiceSelect">${serviceOpts}</select>
      </label>
      <label class="pa-inline-field">日期
        <select id="logDateSelect">${dateOpts || `<option value="${escapeHtml(logDate)}">${escapeHtml(logDate)}</option>`}</select>
      </label>
      <button class="pa-btn pa-btn-sm" id="reloadLogsBtn">刷新</button>
    </div>
    ${logTail?.truncated ? '<p class="pa-muted">仅显示最近 300 行</p>' : ''}
    <pre class="pa-log-view" id="logView">${body}</pre>`;
}

function presetsSectionHint(): string {
  return `<p class="pa-section-hint"><strong>可订阅项</strong>是套餐模板（名称 + 默认规则）。用户在前端账户页从这里选择订阅；创建订阅时会将规则<strong>拷贝</strong>到「订阅规则」。停用后不再出现在用户列表，但不影响已有订阅。说明见 <code>docs/订阅与可订阅项说明.md</code>。</p>`;
}

function subscriptionsSectionHint(): string {
  return `<p class="pa-section-hint"><strong>用户订阅</strong>列出所有用户的邮件订阅（含前端「我的账户」自助订阅）。可<strong>编辑</strong>规则、启用/停用、<strong>删除</strong>；「匹配」「发信」用于单条试跑。说明见 <code>docs/订阅与可订阅项说明.md</code>。</p>`;
}

function jobsSectionHint(): string {
  return `<p class="pa-section-hint"><strong>全量匹配</strong>：按各订阅规则扫描新闻库，写入待推送记录（<code>daily_brief</code> 类订阅跳过）。<strong>全量发信</strong>：通过 HXXBOT 工具 <code>builtin.email_send</code> 发送邮件（需在「数据源配置」启用 HXXBOT 并填写 API Key）。日常可改用 <code>npm run platform:subscription</code> 定时任务。</p>`;
}

function sectionContent(): string {
  switch (section) {
    case 'overview':
      return renderOverview();
    case 'presets':
      return `${presetsSectionHint()}<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" id="newPresetBtn">新建可订阅项</button></div>${renderPresetsTable()}`;
    case 'users':
      return `<div class="pa-toolbar">
        <button class="pa-btn pa-btn-primary" id="newUserBtn">添加用户</button>
        <label class="pa-inline-check"><input type="checkbox" id="includeDeletedUsers" ${includeDeletedUsers ? 'checked' : ''} /> 显示已删除</label>
      </div>${renderUsersTable()}`;
    case 'subscriptions':
      return `${subscriptionsSectionHint()}${renderSubscriptionsFilterBar()}<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" id="newSubBtn">新建订阅</button></div>${renderSubscriptionsTable()}`;
    case 'jobs':
      return `
        ${jobsSectionHint()}
        <div class="pa-toolbar">
          <button class="pa-btn pa-btn-primary" id="matchAllBtn" ${jobRunning ? 'disabled' : ''}>${jobRunning === 'match' ? '匹配中…' : '全量匹配'}</button>
          <button class="pa-btn pa-btn-primary" id="deliverAllBtn" ${jobRunning ? 'disabled' : ''}>${jobRunning === 'deliver' ? '发信中…' : '全量发信'}</button>
        </div>`;
    case 'logs':
      return renderLogsPanel();
    case 'settings':
      return renderSettingsPanel();
    case 'integrations':
      return `<div class="pa-toolbar"><button class="pa-btn pa-btn-primary" id="newIntegrationBtn">新增数据源</button></div>${renderIntegrationsPanel()}`;
    case 'ai-models':
      return renderAiModelsPanel();
    default:
      return '';
  }
}

function render(): void {
  if (!getStoredAdminToken()) {
    renderLogin();
    return;
  }
  if (modalOpenCount > 0) {
    renderQueued = true;
    return;
  }
  renderShell(sectionContent());
}

function modalHeader(title: string): string {
  return `<div class="pa-modal-header">
    <h2>${escapeHtml(title)}</h2>
    <button type="button" class="pa-modal-close" data-modal-close aria-label="关闭">&times;</button>
  </div>`;
}

function modalActions(saveLabel = '保存'): string {
  return `<button type="button" class="pa-btn" data-cancel>取消</button>
    <button type="button" class="pa-btn pa-btn-primary" data-save>${escapeHtml(saveLabel)}</button>`;
}

function modalActionsWithTest(saveLabel = '保存'): string {
  return `<button type="button" class="pa-btn" data-cancel>取消</button>
    <button type="button" class="pa-btn" data-test>测试连接</button>
    <button type="button" class="pa-btn pa-btn-primary" data-save>${escapeHtml(saveLabel)}</button>`;
}

function modalShell(title: string, body: string, actions = modalActions()): string {
  return `${modalHeader(title)}
    <div class="pa-modal-body">${body}</div>
    <div class="pa-modal-actions">${actions}</div>`;
}

function bindModalActions(root: HTMLElement, onSave: () => void, opts?: { onTest?: () => void }): void {
  const close = () => closeModalFromRoot(root);
  root.querySelector('[data-cancel]')?.addEventListener('click', close);
  root.querySelector('[data-modal-close]')?.addEventListener('click', close);
  root.querySelector('[data-save]')?.addEventListener('click', onSave);
  root.querySelector('[data-test]')?.addEventListener('click', () => opts?.onTest?.());
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      e.preventDefault();
    }
  });
}

function openModal(html: string, onMount: (root: HTMLElement) => void): void {
  modalOpenCount++;
  const backdrop = document.createElement('div');
  backdrop.className = 'pa-modal-backdrop';
  backdrop.innerHTML = `<div class="pa-modal">${html}</div>`;
  const panel = backdrop.querySelector('.pa-modal') as HTMLElement;
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModalBackdrop(backdrop);
  });
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModalBackdrop(backdrop));
  onMount(panel);
}

function bindSectionEvents(): void {
  app.querySelectorAll('[data-view-user-subs]').forEach((el) => {
    el.addEventListener('click', () => {
      subscriptionFilterUserId = (el as HTMLElement).dataset.viewUserSubs ?? null;
      section = 'subscriptions';
      void reloadSection();
    });
  });
  document.getElementById('clearSubFilter')?.addEventListener('click', () => {
    subscriptionFilterUserId = null;
    void reloadSection();
  });
  document.getElementById('newPresetBtn')?.addEventListener('click', () => openPresetModal());
  document.getElementById('newUserBtn')?.addEventListener('click', () => openUserModal());
  document.getElementById('newSubBtn')?.addEventListener('click', () => openSubModal());
  document.getElementById('matchAllBtn')?.addEventListener('click', () => {
    if (jobRunning) return;
    jobRunning = 'match';
    render();
    void runMatchAll()
      .then((r) => showToast(`匹配完成: ${JSON.stringify(r)}`))
      .catch((e) => showToast(String(e), true))
      .finally(() => { jobRunning = null; render(); });
  });
  document.getElementById('deliverAllBtn')?.addEventListener('click', () => {
    if (jobRunning) return;
    jobRunning = 'deliver';
    render();
    void runDeliverAll()
      .then((r) => showToast(`发信完成: ${JSON.stringify(r)}`))
      .catch((e) => showToast(String(e), true))
      .finally(() => { jobRunning = null; render(); });
  });

  document.getElementById('logServiceSelect')?.addEventListener('change', (e) => {
    logService = (e.target as HTMLSelectElement).value;
    const latest = logFiles.find((f) => f.service === logService);
    logDate = latest?.date ?? new Date().toISOString().slice(0, 10);
    void reloadSection();
  });
  document.getElementById('logDateSelect')?.addEventListener('change', (e) => {
    logDate = (e.target as HTMLSelectElement).value;
    void reloadSection();
  });
  document.getElementById('reloadLogsBtn')?.addEventListener('click', () => { void reloadSection(); });
  document.getElementById('saveSubscriptionPolicyBtn')?.addEventListener('click', () => {
    const enabled = (document.getElementById('selfServiceSubsEnabled') as HTMLInputElement).checked;
    const maxRaw = (document.getElementById('maxSubscriptionsPerUser') as HTMLInputElement).value;
    const max = Math.max(0, Number(maxRaw) || 0);
    void patchWorkspaceSettings({
      selfServiceSubscriptionsEnabled: enabled,
      maxSubscriptionsPerUser: max,
    })
      .then((s) => { workspaceSettings = s; return reloadSection(); })
      .then(() => showToast('订阅策略已保存'))
      .catch((e) => showToast(String(e), true));
  });
  document.getElementById('saveDefaultPwdBtn')?.addEventListener('click', () => {
    const pwd = (document.getElementById('defaultUserPassword') as HTMLInputElement | null)?.value ?? '';
    if (pwd.length < 8) {
      showToast('默认密码至少 8 位', true);
      return;
    }
    void saveDefaultUserPassword(pwd)
      .then((s) => { workspaceSettings = s; return reloadSection(); })
      .then(() => showToast('默认密码已保存'))
      .catch((e) => showToast(String(e), true));
  });
  document.getElementById('includeDeletedUsers')?.addEventListener('change', (e) => {
    includeDeletedUsers = (e.target as HTMLInputElement).checked;
    void reloadSection();
  });
  app.querySelectorAll('[data-goto-section]').forEach((el) => {
    el.addEventListener('click', () => {
      if (sectionLoading) return;
      const next = (el as HTMLElement).dataset.gotoSection as Section;
      if (!next || next === section) return;
      section = next;
      void reloadSection();
    });
  });
  document.getElementById('newIntegrationBtn')?.addEventListener('click', () => openCreateIntegrationModal());
  app.querySelectorAll('[data-page-nav="integrations"]').forEach((el) => {
    el.addEventListener('click', () => {
      const btn = el as HTMLButtonElement;
      if (btn.disabled) return;
      const next = Number(btn.dataset.page);
      if (!Number.isFinite(next)) return;
      goIntegrationsPage(next);
    });
  });
  app.querySelectorAll('[data-del-integration]').forEach((el) => {
    el.addEventListener('click', () => {
      const slug = (el as HTMLElement).dataset.delIntegration!;
      const p = integrationProviders.find((x) => x.slug === slug);
      if (!confirm(`确定删除自定义数据源「${p?.displayName ?? slug}」？`)) return;
      void deleteIntegrationProvider(slug)
        .then(() => reloadSection())
        .then(() => showToast('已删除'))
        .catch((e) => showToast(String(e), true));
    });
  });
  app.querySelectorAll('[data-edit-integration]').forEach((el) => {
    el.addEventListener('click', () => {
      openEditIntegrationModal((el as HTMLElement).dataset.editIntegration!);
    });
  });
  app.querySelectorAll('[data-edit-ai-model]').forEach((el) => {
    el.addEventListener('click', () => {
      openEditAiModelModal((el as HTMLElement).dataset.editAiModel!);
    });
  });
  app.querySelectorAll('[data-edit-user]').forEach((el) => {
    el.addEventListener('click', () => {
      openEditUserModal((el as HTMLElement).dataset.editUser!);
    });
  });
  app.querySelectorAll('[data-reset-pwd]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.resetPwd!;
      const email = (el as HTMLElement).dataset.userEmail ?? '';
      openResetPasswordModal(id, email);
    });
  });
  const logView = document.getElementById('logView');
  if (logView) logView.scrollTop = logView.scrollHeight;

  app.querySelectorAll('[data-edit-preset]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.editPreset!;
      const p = presets.find((x) => x.id === id);
      if (p) openPresetModal(p);
    });
  });
  app.querySelectorAll('[data-del-preset]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.delPreset!;
      if (!confirm('确定删除该可订阅项？')) return;
      void deletePreset(id).then(() => reloadSection()).then(() => showToast('已删除'));
    });
  });
  app.querySelectorAll('[data-edit-sub]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.editSub!;
      const s = subscriptions.find((x) => x.id === id);
      if (s) openSubModal(s);
    });
  });
  app.querySelectorAll('[data-del-sub]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.delSub!;
      if (!confirm('确定删除该订阅？')) return;
      void deleteSubscription(id).then(() => reloadSection()).then(() => showToast('已删除'));
    });
  });
  app.querySelectorAll('[data-match-sub]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.matchSub!;
      void runSubscriptionMatch(id).then((r) => showToast(`匹配: ${JSON.stringify(r)}`)).catch((e) => showToast(String(e), true));
    });
  });
  app.querySelectorAll('[data-deliver-sub]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.deliverSub!;
      void runSubscriptionDeliver(id).then((r) => showToast(`发信: ${JSON.stringify(r)}`)).catch((e) => showToast(String(e), true));
    });
  });
}

function rulesFormFields(rules: SubscriptionRules, prefix: string): string {
  const cats = meta?.categories ?? [];
  const deliveryLangs = meta?.deliveryLangs ?? ['zh', 'en', 'jp', 'kor', 'fra', 'de', 'spa'];
  const ingestLangs = meta?.langs?.length ? meta.langs : ['en', 'zh'];
  const catChips = cats.map((c) => {
    const on = rules.categories?.includes(c.id) ? ' on' : '';
    return `<span class="pa-chip${on}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.id)} (${c.count})</span>`;
  }).join('');
  const delivery = rules.deliveryLang ?? rules.lang ?? 'zh';
  const contentSelected = rules.contentLangs?.length
    ? rules.contentLangs
    : (rules.lang ? [rules.lang] : []);
  const contentChips = ingestLangs.map((l) => {
    const on = contentSelected.includes(l) ? ' on' : '';
    return `<span class="pa-chip${on}" data-content-lang="${escapeHtml(l)}">${escapeHtml(formatLangOption(l))}</span>`;
  }).join('');

  return `
    <div class="pa-field">
      <label>模式</label>
      <select id="${prefix}mode">
        <option value="keyword" ${rules.mode !== 'daily_brief' ? 'selected' : ''}>关键词/分类匹配</option>
        <option value="daily_brief" ${rules.mode === 'daily_brief' ? 'selected' : ''}>每日 AI 简报</option>
      </select>
    </div>
    <div class="pa-grid-2">
      <div class="pa-field"><label>variant</label>
        <select id="${prefix}variant">${(meta?.variants ?? ['full']).map((v) =>
          `<option value="${v}" ${rules.variant === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <div class="pa-field"><label>订阅语言（邮件内容）</label>
        <select id="${prefix}deliveryLang">${deliveryLangs.map((l) =>
          `<option value="${l}" ${delivery === l ? 'selected' : ''}>${escapeHtml(formatLangOption(l))}</option>`).join('')}
        </select></div>
    </div>
    <div class="pa-field"><label>数据源语言（点击选择，不选=全部；入库时 RSS 已标记 lang）</label>
      <p class="pa-muted" style="margin:0 0 8px;font-size:12px">决定从 news_items 匹配哪些语言的 RSS；与下方「订阅语言」可不同（如源=en、投递=zh 时标题会翻译）。</p>
      <div class="pa-chips" id="${prefix}contentLangChips">${contentChips || '<span class="pa-muted">暂无</span>'}</div>
    </div>
    <div class="pa-field"><label>关键词（逗号分隔）</label>
      <input id="${prefix}keywords" value="${escapeHtml((rules.keywords ?? []).join(', '))}" /></div>
    <div class="pa-field"><label>分类（点击选择）</label><div class="pa-chips" id="${prefix}catChips">${catChips || '<span class="pa-muted">暂无分类数据</span>'}</div></div>
    <div class="pa-grid-2">
      <div class="pa-field"><label>回溯小时</label><input id="${prefix}hours" type="number" value="${rules.hours ?? 24}" /></div>
      <div class="pa-field"><label>排序</label><input id="${prefix}sort" type="number" value="0" /></div>
    </div>
    <div class="pa-field"><label><input type="checkbox" id="${prefix}aiBrief" ${rules.includeAiBrief ? 'checked' : ''} /> 邮件附带 AI 简报</label></div>
    <p class="pa-muted">若订阅语言与新闻源语言不一致，发信前将自动翻译并缓存到 OSS（按分类目录）与数据库。</p>`;
}

function wireCatChips(prefix: string): void {
  document.querySelectorAll(`#${prefix}catChips .pa-chip`).forEach((el) => {
    el.addEventListener('click', () => el.classList.toggle('on'));
  });
  document.querySelectorAll(`#${prefix}contentLangChips .pa-chip`).forEach((el) => {
    el.addEventListener('click', () => el.classList.toggle('on'));
  });
}

function readRulesFromForm(prefix: string): SubscriptionRules {
  const selectedCats: string[] = [];
  document.querySelectorAll(`#${prefix}catChips .pa-chip.on`).forEach((el) => {
    const c = (el as HTMLElement).dataset.cat;
    if (c) selectedCats.push(c);
  });
  const contentLangs: string[] = [];
  document.querySelectorAll(`#${prefix}contentLangChips .pa-chip.on`).forEach((el) => {
    const l = (el as HTMLElement).dataset.contentLang;
    if (l) contentLangs.push(l);
  });
  const kw = (document.getElementById(`${prefix}keywords`) as HTMLInputElement).value;
  return {
    mode: (document.getElementById(`${prefix}mode`) as HTMLSelectElement).value as SubscriptionRules['mode'],
    variant: (document.getElementById(`${prefix}variant`) as HTMLSelectElement).value,
    deliveryLang: (document.getElementById(`${prefix}deliveryLang`) as HTMLSelectElement).value,
    contentLangs: contentLangs.length ? contentLangs : undefined,
    keywords: kw.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    categories: selectedCats.length ? selectedCats : undefined,
    hours: Number((document.getElementById(`${prefix}hours`) as HTMLInputElement).value) || 24,
    includeAiBrief: (document.getElementById(`${prefix}aiBrief`) as HTMLInputElement).checked,
  };
}

function openPresetModal(existing?: PresetRow): void {
  const rules = existing?.rules_json ?? defaultRules();
  const prefix = 'pf_';
  const title = existing ? '编辑可订阅项' : '新建可订阅项';
  openModal(modalShell(title, `
    <div class="pa-field"><label>标题 *</label><input id="pf_title" value="${escapeHtml(existing?.title ?? '')}" /></div>
    <div class="pa-field"><label>slug</label><input id="pf_slug" value="${escapeHtml(existing?.slug ?? '')}" placeholder="留空自动生成" /></div>
    <div class="pa-field"><label>说明</label><textarea id="pf_desc">${escapeHtml(existing?.description ?? '')}</textarea></div>
    <div class="pa-field"><label><input type="checkbox" id="pf_enabled" ${existing?.enabled !== false ? 'checked' : ''} /> 启用</label></div>
    <details open><summary class="pa-muted" style="cursor:pointer;margin-bottom:12px">默认规则</summary>
      ${rulesFormFields(rules, prefix)}
    </details>`), (root) => {
    wireCatChips(prefix);
    const sortEl = document.getElementById(`${prefix}sort`) as HTMLInputElement;
    if (sortEl && existing) sortEl.value = String(existing.sort_order);

    bindModalActions(root, () => {
      const titleVal = (document.getElementById('pf_title') as HTMLInputElement).value.trim();
      if (!titleVal) return;
      void savePreset({
        title: titleVal,
        slug: (document.getElementById('pf_slug') as HTMLInputElement).value.trim() || undefined,
        description: (document.getElementById('pf_desc') as HTMLTextAreaElement).value,
        rules_json: readRulesFromForm(prefix),
        enabled: (document.getElementById('pf_enabled') as HTMLInputElement).checked,
        sort_order: Number(sortEl?.value) || 0,
      }, existing?.id)
        .then(() => { closeModalFromRoot(root); return reloadSection(); })
        .then(() => showToast('已保存'))
        .catch((e) => showToast(String(e), true));
    });
  });
}

function openUserModal(): void {
  void (async () => {
    if (!meta) meta = await fetchAdminMeta();
    openModal(modalShell('添加订阅用户', `
      <div class="pa-field"><label>邮箱 *</label><input id="u_email" type="email" autocomplete="email" /></div>
      <div class="pa-field"><label>显示名</label><input id="u_name" autocomplete="name" /></div>
      <div class="pa-field"><label>订阅语言（默认）</label>
        <select id="u_preferred_lang">${deliveryLangOptions('zh')}</select>
      </div>
      <p class="pa-muted">新建用户将使用「系统设置」中的默认密码。若未配置默认密码，请先到系统设置中保存。</p>`, modalActions('添加')), (root) => {
      bindModalActions(root, () => {
        const email = (document.getElementById('u_email') as HTMLInputElement).value.trim();
        if (!email) return;
        const preferredLang = (document.getElementById('u_preferred_lang') as HTMLSelectElement).value;
        void createUser(
          email,
          (document.getElementById('u_name') as HTMLInputElement).value.trim() || undefined,
          preferredLang,
        )
          .then(() => { closeModalFromRoot(root); return reloadSection(); })
          .then(() => showToast('用户已添加'))
          .catch((e) => showToast(String(e), true));
      });
    });
  })();
}

function openEditUserModal(userId: string): void {
  const user = users.find((u) => u.id === userId);
  if (!user) return;

  void (async () => {
    if (!meta) meta = await fetchAdminMeta();
    const statusVal = user.account_status;
    const disablePermanent = user.disable_permanent
      || (user.account_status === 'disabled' && !user.disabled_until);
    const disabledUntilLocal = toDatetimeLocalValue(user.disabled_until);

    openModal(modalShell(`编辑用户 — ${escapeHtml(user.email)}`, `
      <div class="pa-field"><label>用户 ID</label>
        <input id="eu_id" readonly value="${escapeHtml(user.id)}" /></div>
      <div class="pa-field"><label>邮箱</label>
        <input id="eu_email" readonly value="${escapeHtml(user.email)}" /></div>
      <div class="pa-field"><label>显示名</label>
        <input id="eu_name" autocomplete="name" value="${escapeHtml(user.display_name ?? '')}" /></div>
      <div class="pa-field"><label>订阅语言</label>
        <select id="eu_preferred_lang">${deliveryLangOptions(user.preferred_lang ?? 'zh')}</select>
      </div>
      <div class="pa-field"><label>账号状态</label>
        <select id="eu_status">
          <option value="active" ${statusVal === 'active' ? 'selected' : ''}>正常</option>
          <option value="disabled" ${statusVal === 'disabled' ? 'selected' : ''}>禁用</option>
          <option value="deleted" ${statusVal === 'deleted' ? 'selected' : ''}>已删除（逻辑删除）</option>
        </select>
      </div>
      <div id="eu_disable_opts" class="pa-disable-panel" hidden>
        <label class="pa-muted" style="display:block;margin-bottom:8px">禁用方式</label>
        <label class="pa-radio-label">
          <input type="radio" name="eu_disableMode" value="permanent" ${disablePermanent ? 'checked' : ''} /> 永久禁用
        </label>
        <label class="pa-radio-label">
          <input type="radio" name="eu_disableMode" value="until" ${!disablePermanent ? 'checked' : ''} /> 禁用至指定时间
        </label>
        <input type="datetime-local" id="eu_disabled_until" value="${disabledUntilLocal}" />
      </div>
      ${user.effective_status === 'deleted' ? '<p class="pa-muted">该账号已逻辑删除。将状态改回「正常」可恢复登录与推送。</p>' : ''}
      <p class="pa-muted">邮箱与用户 ID 不可修改。删除为逻辑删除，不会物理移除数据。</p>`), (root) => {
      const statusSel = root.querySelector('#eu_status') as HTMLSelectElement;
      const disableOpts = root.querySelector('#eu_disable_opts') as HTMLElement;
      const untilInput = root.querySelector('#eu_disabled_until') as HTMLInputElement;

      function syncDisableOpts(): void {
        const show = statusSel.value === 'disabled';
        disableOpts.hidden = !show;
        const mode = (root.querySelector('input[name="eu_disableMode"]:checked') as HTMLInputElement)?.value;
        untilInput.disabled = mode !== 'until';
      }

      statusSel.addEventListener('change', () => {
        if (statusSel.value === 'disabled') {
          const permanent = root.querySelector('input[name="eu_disableMode"][value="permanent"]') as HTMLInputElement;
          if (permanent && !root.querySelector('input[name="eu_disableMode"]:checked')) {
            permanent.checked = true;
          }
        }
        syncDisableOpts();
      });
      root.querySelectorAll('input[name="eu_disableMode"]').forEach((el) => {
        el.addEventListener('change', syncDisableOpts);
      });
      syncDisableOpts();

      bindModalActions(root, () => {
        const accountStatus = statusSel.value as UserRow['account_status'];
        if (accountStatus === 'deleted' && user.effective_status !== 'deleted') {
          if (!confirm('确定逻辑删除该用户？删除后无法登录，邮件推送将跳过。')) return;
        }

        const payload: Parameters<typeof updateUser>[1] = {
          displayName: (root.querySelector('#eu_name') as HTMLInputElement).value.trim() || null,
          preferredLang: (root.querySelector('#eu_preferred_lang') as HTMLSelectElement).value,
          accountStatus,
        };

        if (accountStatus === 'disabled') {
          const mode = (root.querySelector('input[name="eu_disableMode"]:checked') as HTMLInputElement).value;
          if (mode === 'permanent') {
            payload.disablePermanent = true;
          } else {
            const raw = untilInput.value;
            if (!raw) {
              showToast('请设置禁用结束时间', true);
              return;
            }
            const until = new Date(raw);
            if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
              showToast('禁用结束时间须晚于当前时间', true);
              return;
            }
            payload.disablePermanent = false;
            payload.disabledUntil = until.toISOString();
          }
        }

        void updateUser(userId, payload)
          .then(() => { closeModalFromRoot(root); return reloadSection(); })
          .then(() => showToast('用户已更新'))
          .catch((e) => showToast(String(e), true));
      });
    });
  })();
}

function openCreateIntegrationModal(): void {
  openModal(modalShell('新增数据源', `
    <div class="pa-field"><label>标识 (slug) *</label>
      <input id="int_new_slug" autocomplete="off" placeholder="如 my_market_api（小写，创建后不可改）" /></div>
    <div class="pa-field"><label>显示名称 *</label>
      <input id="int_new_name" autocomplete="off" placeholder="如 我的行情 API" /></div>
    <div class="pa-field"><label>分组</label>
      <select id="int_new_category">${integrationCategorySelectOptions(CUSTOM_CATEGORY_VALUE)}</select></div>
    ${integrationCategoryCustomFieldHtml('', 'int_new_category_custom')}
    <div class="pa-field"><label>Base URL *</label>
      <input id="int_new_base_url" type="text" inputmode="url" spellcheck="false" autocomplete="off"
        placeholder="https://api.example.com" /></div>
    <div class="pa-field"><label>API Key</label>
      <input id="int_new_api_key" type="password" autocomplete="new-password" placeholder="可选" /></div>
    ${integrationRemarksFieldHtml('', 'int_new_remarks')}
    <div class="pa-field pa-field-checkbox">
      <label class="pa-checkbox-label">
        <input type="checkbox" id="int_new_enabled" checked /> 启用
      </label>
    </div>
    <p class="pa-muted">自定义数据源仅保存凭证；业务代码需另行接入该 slug。内置数据源由系统自动 seed，无需重复添加。</p>`), (root) => {
    bindIntegrationCategoryToggle(root, 'int_new_category', 'int_new_category_custom_wrap');
    bindModalActions(root, () => {
      const slug = (root.querySelector('#int_new_slug') as HTMLInputElement).value.trim().toLowerCase();
      const displayName = (root.querySelector('#int_new_name') as HTMLInputElement).value.trim();
      let category: string;
      try {
        category = readIntegrationCategory(root, 'int_new_category', 'int_new_category_custom');
      } catch (e) {
        showToast(String(e), true);
        return;
      }
      const baseUrl = (root.querySelector('#int_new_base_url') as HTMLInputElement).value.trim();
      const apiKey = (root.querySelector('#int_new_api_key') as HTMLInputElement).value;
      const remarks = (root.querySelector('#int_new_remarks') as HTMLTextAreaElement).value;
      const enabled = (root.querySelector('#int_new_enabled') as HTMLInputElement).checked;

      void createIntegrationProvider({
        slug,
        displayName,
        category,
        baseUrl,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        remarks,
        enabled,
      })
        .then(() => {
          closeModalFromRoot(root);
          integrationsPage = 1;
          return reloadSection();
        })
        .then(() => showToast('数据源已添加'))
        .catch((e) => showToast(String(e), true));
    });
  });
}

function setIntegrationTestResult(root: HTMLElement, kind: 'pending' | 'ok' | 'err', message: string): void {
  const el = root.querySelector('#int_test_result') as HTMLElement | null;
  if (!el) return;
  el.hidden = false;
  el.className = `pa-test-result pa-test-${kind}`;
  el.textContent = message;
}

function openEditIntegrationModal(slug: string): void {
  const provider = integrationProviders.find((p) => p.slug === slug);
  if (!provider) return;

  const isHxxbot = slug === 'hxxbot';
  const hxxbotNote = isHxxbot
    ? '<p class="pa-muted">HXXBOT 用于订阅邮件（<code>builtin.email_send</code>）、翻译、QA。Base URL 示例：<code>https://www.hxxbot.com/api</code>（与 hxxnote 桌面版 AI邮件 一致）。凭证保存在数据库。</p>'
    : '<p class="pa-muted">具体 API 路径在代码中写死；此处只配根 URL 与密钥。</p>';
  const testResult = isHxxbot
    ? '<div id="int_test_result" class="pa-test-result" hidden></div>'
    : '';

  const nameField = provider.custom
    ? `<div class="pa-field"><label>显示名称</label>
      <input id="int_display_name" value="${escapeHtml(provider.displayName)}" /></div>`
    : `<div class="pa-field"><label>显示名称</label>
      <input id="int_display_name" value="${escapeHtml(provider.displayName)}" />
      <p class="pa-muted">仅影响后台展示；内置 slug 不变。</p></div>`;

  const categoryField = provider.custom
    ? (() => {
        const preset = isPresetIntegrationCategory(provider.category);
        const selectValue = preset ? provider.category : CUSTOM_CATEGORY_VALUE;
        const customValue = preset ? '' : (provider.category === 'custom' ? '' : provider.category);
        return `<div class="pa-field"><label>分组</label>
      <select id="int_category">${integrationCategorySelectOptions(selectValue)}</select></div>
      ${integrationCategoryCustomFieldHtml(customValue, 'int_category_custom')}`;
      })()
    : `<div class="pa-field"><label>分组</label>
      <input readonly value="${escapeHtml(INTEGRATION_CATEGORY_LABELS[provider.category] ?? provider.category)}" /></div>`;

  openModal(modalShell(`数据源 — ${escapeHtml(provider.displayName)}`, `
    <div class="pa-field"><label>标识</label>
      <input readonly value="${escapeHtml(provider.slug)}" /></div>
    ${nameField}
    ${categoryField}
    <div class="pa-field"><label>Base URL</label>
      <input id="int_base_url" type="text" inputmode="url" spellcheck="false" autocomplete="off"
        placeholder="https://api.example.com"
        value="${escapeHtml(provider.baseUrl)}" /></div>
    <div class="pa-field"><label>API Key</label>
      <input id="int_api_key" type="password" autocomplete="new-password"
        placeholder="${provider.hasApiKey ? '留空则保留已存 Key' : '输入 API Key'}" />
      ${provider.apiKeyHint ? `<p class="pa-muted">当前：${escapeHtml(provider.apiKeyHint)}</p>` : ''}
      <label class="pa-checkbox-label pa-checkbox-label-spaced">
        <input type="checkbox" id="int_clear_key" /> 清除已保存的 Key
      </label>
    </div>
    <div class="pa-field pa-field-checkbox">
      <label class="pa-checkbox-label">
        <input type="checkbox" id="int_enabled" ${provider.enabled ? 'checked' : ''} /> 启用
      </label>
    </div>
    ${integrationRemarksFieldHtml(provider.remarks ?? '', 'int_remarks')}
    ${testResult}
    ${hxxbotNote}`, isHxxbot ? modalActionsWithTest() : modalActions()), (root) => {
    if (provider.custom) {
      bindIntegrationCategoryToggle(root, 'int_category', 'int_category_custom_wrap');
    }
    bindModalActions(root, () => {
      const displayName = (root.querySelector('#int_display_name') as HTMLInputElement).value.trim();
      const categoryEl = root.querySelector('#int_category') as HTMLSelectElement | null;
      const baseUrl = (root.querySelector('#int_base_url') as HTMLInputElement).value.trim();
      const apiKey = (root.querySelector('#int_api_key') as HTMLInputElement).value;
      const remarks = (root.querySelector('#int_remarks') as HTMLTextAreaElement).value;
      const clearApiKey = (root.querySelector('#int_clear_key') as HTMLInputElement).checked;
      const enabled = (root.querySelector('#int_enabled') as HTMLInputElement).checked;

      let categoryPatch: string | undefined;
      if (categoryEl) {
        try {
          categoryPatch = readIntegrationCategory(root, 'int_category', 'int_category_custom');
        } catch (e) {
          showToast(String(e), true);
          return;
        }
      }

      void saveIntegrationProvider(slug, {
        displayName,
        ...(categoryPatch !== undefined ? { category: categoryPatch } : {}),
        baseUrl,
        remarks,
        ...(apiKey ? { apiKey } : {}),
        enabled,
        ...(clearApiKey ? { clearApiKey: true } : {}),
      })
        .then((updated) => {
          const idx = integrationProviders.findIndex((p) => p.slug === slug);
          if (idx >= 0) integrationProviders[idx] = updated;
          closeModalFromRoot(root);
          return reloadSection();
        })
        .then(() => showToast('数据源已保存'))
        .catch((e) => showToast(String(e), true));
    }, isHxxbot ? {
      onTest: () => {
        const baseUrl = (root.querySelector('#int_base_url') as HTMLInputElement).value.trim();
        const apiKey = (root.querySelector('#int_api_key') as HTMLInputElement).value;
        setIntegrationTestResult(root, 'pending', '测试中…');
        void testIntegrationProvider('hxxbot', { baseUrl, ...(apiKey ? { apiKey } : {}) })
          .then((r) => {
            setIntegrationTestResult(
              root,
              r.ok ? 'ok' : 'err',
              r.ok ? `连接成功（${r.latencyMs} ms）` : (r.error ?? '连接失败'),
            );
          })
          .catch((e) => setIntegrationTestResult(root, 'err', String(e)));
      },
    } : undefined);
  });
}

function readAiModelForm(root: HTMLElement): {
  baseUrl: string;
  modelName: string;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
  remarks: string;
} {
  return {
    baseUrl: (root.querySelector('#ai_base_url') as HTMLInputElement).value.trim(),
    modelName: (root.querySelector('#ai_model_name') as HTMLInputElement).value.trim(),
    apiKey: (root.querySelector('#ai_api_key') as HTMLInputElement).value,
    clearApiKey: (root.querySelector('#ai_clear_key') as HTMLInputElement).checked,
    enabled: (root.querySelector('#ai_enabled') as HTMLInputElement).checked,
    remarks: (root.querySelector('#ai_remarks') as HTMLTextAreaElement).value,
  };
}

function setAiTestResult(root: HTMLElement, kind: 'pending' | 'ok' | 'err', message: string): void {
  const el = root.querySelector('#ai_test_result') as HTMLElement | null;
  if (!el) return;
  el.hidden = false;
  el.className = `pa-test-result pa-test-${kind}`;
  el.textContent = message;
}

function openEditAiModelModal(slug: string): void {
  const provider = aiModels.find((p) => p.slug === slug);
  if (!provider) return;

  openModal(modalShell(`AI 模型 — ${escapeHtml(provider.displayName)}`, `
    <div class="pa-field"><label>标识</label>
      <input readonly value="${escapeHtml(provider.slug)}" /></div>
    <div class="pa-field"><label>Base URL</label>
      <input id="ai_base_url" type="text" inputmode="url" spellcheck="false" autocomplete="off"
        placeholder="https://api.example.com/v1 或 http://127.0.0.1:11434/v1"
        value="${escapeHtml(provider.baseUrl)}" /></div>
    <div class="pa-field"><label>模型名 (model)</label>
      <input id="ai_model_name" autocomplete="off"
        placeholder="如 llama3.1:8b、deepseek-chat、openrouter/free"
        value="${escapeHtml(provider.modelName ?? '')}" />
      <p class="pa-muted">OpenAI 兼容接口必填。</p></div>
    <div class="pa-field"><label>API Key</label>
      <input id="ai_api_key" type="password" autocomplete="new-password"
        placeholder="${provider.hasApiKey ? '留空则测试/保存时使用已存 Key' : '可选（本地服务）'}" />
      ${provider.apiKeyHint ? `<p class="pa-muted">当前：${escapeHtml(provider.apiKeyHint)}</p>` : ''}
      <label class="pa-checkbox-label pa-checkbox-label-spaced">
        <input type="checkbox" id="ai_clear_key" /> 清除已保存的 Key
      </label>
    </div>
    <div class="pa-field pa-field-checkbox">
      <label class="pa-checkbox-label">
        <input type="checkbox" id="ai_enabled" ${provider.enabled ? 'checked' : ''} /> 启用
      </label>
    </div>
    ${integrationRemarksFieldHtml(provider.remarks ?? '', 'ai_remarks')}
    <div id="ai_test_result" class="pa-test-result" hidden></div>
    <p class="pa-muted">请求路径固定为 <code>/v1/chat/completions</code>。可先「测试连接」验证配置，无需保存。</p>`,
  modalActionsWithTest()), (root) => {
    const runTest = (): void => {
      const form = readAiModelForm(root);
      const testBtn = root.querySelector('[data-test]') as HTMLButtonElement | null;
      if (testBtn) testBtn.disabled = true;
      setAiTestResult(root, 'pending', '正在连接模型…（最多 3 分钟）');

      const draft: { baseUrl: string; modelName: string; apiKey?: string } = {
        baseUrl: form.baseUrl,
        modelName: form.modelName,
      };
      if (form.apiKey.trim()) draft.apiKey = form.apiKey.trim();

      void testAiModel(slug, draft)
        .then((r) => {
          if (r.ok) {
            const sample = r.reply ? `回复：${r.reply}` : '';
            setAiTestResult(
              root,
              'ok',
              `连接成功 · ${r.latencyMs}ms · 模型 ${r.model ?? form.modelName}${sample ? ` · ${sample}` : ''}`,
            );
          } else {
            const status = r.httpStatus ? `HTTP ${r.httpStatus} · ` : '';
            setAiTestResult(root, 'err', `${status}${r.error ?? '测试失败'}`);
          }
        })
        .catch((e) => setAiTestResult(root, 'err', String(e)))
        .finally(() => {
          if (testBtn) testBtn.disabled = false;
        });
    };

    bindModalActions(root, () => {
      const form = readAiModelForm(root);

      void saveAiModel(slug, {
        baseUrl: form.baseUrl,
        modelName: form.modelName,
        remarks: form.remarks,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        enabled: form.enabled,
        ...(form.clearApiKey ? { clearApiKey: true } : {}),
      })
        .then((updated) => {
          const idx = aiModels.findIndex((p) => p.slug === slug);
          if (idx >= 0) aiModels[idx] = updated;
          closeModalFromRoot(root);
          return reloadSection();
        })
        .then(() => showToast('AI 模型已保存'))
        .catch((e) => showToast(String(e), true));
    }, { onTest: runTest });
  });
}

function openResetPasswordModal(userId: string, email: string): void {
  openModal(modalShell(`重置密码 — ${escapeHtml(email)}`, `
    <div class="pa-field">
      <label class="pa-radio-label">
        <input type="radio" name="pwdMode" value="default" checked />
        重置为系统默认密码
      </label>
    </div>
    <div class="pa-field">
      <label class="pa-radio-label">
        <input type="radio" name="pwdMode" value="custom" />
        指定新密码
      </label>
      <input type="password" id="resetCustomPwd" autocomplete="new-password" minlength="8" placeholder="至少 8 位" disabled />
    </div>
    <p class="pa-muted">默认密码在「系统设置」中配置；修改默认密码不会自动更新已有用户，需在此单独重置。</p>`,
  modalActions('确认重置')), (root) => {
    const customInput = root.querySelector('#resetCustomPwd') as HTMLInputElement;
    root.querySelectorAll('input[name="pwdMode"]').forEach((el) => {
      el.addEventListener('change', () => {
        const mode = (root.querySelector('input[name="pwdMode"]:checked') as HTMLInputElement).value;
        customInput.disabled = mode !== 'custom';
        if (mode !== 'custom') customInput.value = '';
      });
    });
    bindModalActions(root, () => {
      const mode = (root.querySelector('input[name="pwdMode"]:checked') as HTMLInputElement).value;
      const run = mode === 'default'
        ? resetUserPassword(userId, { useDefault: true })
        : (() => {
          const pwd = customInput.value;
          if (pwd.length < 8) {
            showToast('新密码至少 8 位', true);
            return Promise.reject(new Error('skip'));
          }
          return resetUserPassword(userId, { password: pwd });
        })();
      void run
        .then(() => { closeModalFromRoot(root); })
        .then(() => showToast('密码已重置'))
        .catch((e) => { if (String(e) !== 'Error: skip') showToast(String(e), true); });
    });
  });
}

function openSubModal(existing?: SubscriptionRow): void {
  const rules = existing?.rules_json ?? defaultRules();
  const prefix = 'sf_';
  const presetOpts = presets.map((p) =>
    `<option value="${p.id}" ${existing?.preset_id === p.id ? 'selected' : ''}>${escapeHtml(p.title)}</option>`).join('');
  const userOpts = users.map((u) =>
    `<option value="${u.id}" ${existing?.user_id === u.id ? 'selected' : ''}>${escapeHtml(u.email)}</option>`).join('');

  openModal(modalShell(existing ? '编辑订阅' : '新建订阅', `
    <div class="pa-field"><label>订阅名称 *</label><input id="sf_name" value="${escapeHtml(existing?.name ?? '')}" /></div>
    ${existing ? '' : `<div class="pa-field"><label>用户邮箱（新用户自动创建）</label><input id="sf_email" type="email" placeholder="或下方选择已有用户" /></div>`}
    <div class="pa-field"><label>已有用户</label>
      <select id="sf_userId"><option value="">—</option>${userOpts}</select></div>
    <div class="pa-field"><label>基于可订阅项（可选）</label>
      <select id="sf_presetId"><option value="">自定义规则</option>${presetOpts}</select></div>
    <div class="pa-field"><label><input type="checkbox" id="sf_enabled" ${existing?.enabled !== false ? 'checked' : ''} /> 启用</label></div>
    <details open><summary class="pa-muted" style="cursor:pointer;margin-bottom:12px">规则详情（可覆盖预设）</summary>
      ${rulesFormFields(rules, prefix)}
    </details>`), (root) => {
    wireCatChips(prefix);
    const userSelect = document.getElementById('sf_userId') as HTMLSelectElement | null;
    const deliverySelect = document.getElementById(`${prefix}deliveryLang`) as HTMLSelectElement | null;
    userSelect?.addEventListener('change', () => {
      const u = users.find((x) => x.id === userSelect.value);
      if (u?.preferred_lang && deliverySelect) deliverySelect.value = u.preferred_lang;
    });
    bindModalActions(root, () => {
      const name = (document.getElementById('sf_name') as HTMLInputElement).value.trim();
      if (!name) return;
      const presetId = (document.getElementById('sf_presetId') as HTMLSelectElement).value || undefined;
      void saveSubscription({
        name,
        email: existing ? undefined : (document.getElementById('sf_email') as HTMLInputElement | null)?.value.trim() || undefined,
        userId: existing?.user_id ?? ((document.getElementById('sf_userId') as HTMLSelectElement).value || undefined),
        presetId,
        rulesJson: readRulesFromForm(prefix),
        enabled: (document.getElementById('sf_enabled') as HTMLInputElement).checked,
      }, existing?.id)
        .then(() => { closeModalFromRoot(root); return reloadSection(); })
        .then(() => showToast('订阅已保存'))
        .catch((e) => showToast(String(e), true));
    });
  });
}

setupRemarksTooltips();

void (async () => {
  render();
  if (getStoredAdminToken()) await reloadSection();
})();
