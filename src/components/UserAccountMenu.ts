import '../styles/user-account.css';
import { escapeHtml } from '@/utils/sanitize';
import {
  bindApiKeyExpiryToggle,
  defaultApiKeyExpiryLocal,
  readApiKeyExpiryOptions,
  toDatetimeLocalValue,
} from '@/utils/api-key-expiry';
import { t } from '@/services/i18n';
import {
  fetchAuthStatus,
  fetchCurrentUser,
  fetchSubscriptionCatalog,
  subscribeToPreset,
  unsubscribeFromPreset,
  isUserAuthAvailable,
  loginUser,
  logoutUser,
  mapAuthError,
  registerUser,
  resetPasswordWithCode,
  sendPasswordResetCode,
  updateUserProfile,
  fetchUserApiKey,
  createUserApiKey,
  rotateUserApiKey,
  updateUserApiKeyExpiry,
  deleteUserApiKey,
  revealUserApiKey,
  EMPTY_USER_API_KEY,
  type PlatformUserProfile,
  type SubscriptionCatalog,
  type UserApiKeyInfo,
} from '@/services/platform-user-auth';

type AuthView = 'login' | 'register' | 'forgot';

const LANG_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  jp: '日本語',
  kor: '한국어',
  fra: 'Français',
  de: 'Deutsch',
  spa: 'Español',
};

const DELIVERY_LANG_OPTIONS = ['zh', 'en', 'jp', 'kor', 'fra', 'de', 'spa'] as const;

function langLabel(code: string): string {
  const name = LANG_LABELS[code];
  return name ? `${name} (${code})` : code;
}

function deliveryLangOptions(selected: string): string {
  return DELIVERY_LANG_OPTIONS.map((l) =>
    `<option value="${escapeHtml(l)}"${l === selected ? ' selected' : ''}>${escapeHtml(langLabel(l))}</option>`,
  ).join('');
}

export class UserAccountMenu {
  private root: HTMLElement;
  private menuOpen = false;
  private user: PlatformUserProfile | null = null;
  private enabled = false;
  private loginOverlay: HTMLElement | null = null;
  private profileOverlay: HTMLElement | null = null;
  private docClickHandler: ((e: MouseEvent) => void) | null = null;
  private authView: AuthView = 'login';
  private codeCooldownUntil = 0;
  private codeCooldownTimer: ReturnType<typeof setInterval> | null = null;
  private focusApiKeyOnOpen = false;
  private apiKeyRevealed = false;
  private apiKeyFullText: string | null = null;
  private apiKeyCreating = false;

  constructor(mount: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'wm-user-account';
    this.root.id = 'userAccountRoot';
    mount.appendChild(this.root);
    void this.bootstrap();
  }

  destroy(): void {
    this.closeMenu();
    this.closeAuthModal();
    this.closeProfileModal();
    this.clearCodeCooldown();
    this.root.remove();
  }

  private async bootstrap(): Promise<void> {
    if (!isUserAuthAvailable()) {
      this.root.style.display = 'none';
      return;
    }
    const status = await fetchAuthStatus();
    this.enabled = status.enabled;
    if (!this.enabled) {
      this.root.style.display = 'none';
      return;
    }
    this.user = await fetchCurrentUser();
    this.render();
    if (this.user && this.shouldOpenApiKeyFromUrl()) {
      this.focusApiKeyOnOpen = true;
      void this.openProfileModal();
    }
  }

  private shouldOpenApiKeyFromUrl(): boolean {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('account') === 'apiKey') return true;
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === 'account=apiKey' || hash.startsWith('account=apiKey&')) return true;
    } catch { /* ignore */ }
    return false;
  }

  private clearApiKeyDeepLink(): void {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('account') === 'apiKey') {
        url.searchParams.delete('account');
        window.history.replaceState({}, '', url.pathname + url.search + url.hash);
      }
      if (url.hash === '#account=apiKey' || url.hash.startsWith('#account=apiKey')) {
        window.history.replaceState({}, '', url.pathname + url.search);
      }
    } catch { /* ignore */ }
  }

  private render(): void {
    this.closeMenu();
    if (!this.user) {
      this.root.innerHTML = `
        <button type="button" class="wm-user-login-btn" id="userLoginBtn">${escapeHtml(t('account.login'))}</button>`;
      this.root.querySelector('#userLoginBtn')?.addEventListener('click', () => this.openAuthModal('login'));
      return;
    }

    const label = this.user.display_name?.trim() || this.user.email;
    this.root.innerHTML = `
      <div class="wm-user-menu-wrap">
        <button type="button" class="wm-user-menu-btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
          <span class="wm-user-avatar" aria-hidden="true">${escapeHtml(label.charAt(0).toUpperCase())}</span>
          <span class="wm-user-label">${escapeHtml(label)}</span>
          <svg class="wm-user-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="wm-user-dropdown" id="userDropdown" hidden>
          <button type="button" class="wm-user-dropdown-item" data-action="profile">${escapeHtml(t('account.mySubscriptions'))}</button>
          <button type="button" class="wm-user-dropdown-item wm-user-dropdown-danger" data-action="logout">${escapeHtml(t('account.logout'))}</button>
        </div>
      </div>`;

    const btn = this.root.querySelector('#userMenuBtn');
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.root.querySelector('[data-action="profile"]')?.addEventListener('click', () => {
      this.closeMenu();
      void this.openProfileModal();
    });
    this.root.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
      logoutUser();
      this.user = null;
      this.closeMenu();
      this.render();
    });
  }

  private toggleMenu(): void {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  }

  private openMenu(): void {
    const dropdown = this.root.querySelector('#userDropdown') as HTMLElement | null;
    const btn = this.root.querySelector('#userMenuBtn') as HTMLButtonElement | null;
    if (!dropdown || !btn) return;
    dropdown.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    this.menuOpen = true;
    this.docClickHandler = (e: MouseEvent) => {
      if (!this.root.contains(e.target as Node)) this.closeMenu();
    };
    document.addEventListener('click', this.docClickHandler);
  }

  private closeMenu(): void {
    const dropdown = this.root.querySelector('#userDropdown') as HTMLElement | null;
    const btn = this.root.querySelector('#userMenuBtn') as HTMLButtonElement | null;
    if (dropdown) dropdown.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    this.menuOpen = false;
    if (this.docClickHandler) {
      document.removeEventListener('click', this.docClickHandler);
      this.docClickHandler = null;
    }
  }

  private authModalTitle(): string {
    if (this.authView === 'register') return t('account.registerTitle');
    if (this.authView === 'forgot') return t('account.forgotTitle');
    return t('account.loginTitle');
  }

  private openAuthModal(view: AuthView = 'login'): void {
    this.authView = view;
    this.closeAuthModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active wm-user-modal-overlay';
    overlay.id = 'userLoginModal';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `
      <div class="modal wm-user-modal">
        <div class="modal-header">
          <span class="modal-title" id="userAuthModalTitle">${escapeHtml(this.authModalTitle())}</span>
          <button type="button" class="modal-close wm-user-modal-close" aria-label="${escapeHtml(t('common.close'))}">×</button>
        </div>
        <div class="wm-user-modal-body" id="userAuthModalBody"></div>
        <div class="wm-user-modal-footer" id="userAuthModalFooter"></div>
      </div>`;

    document.body.appendChild(overlay);
    this.loginOverlay = overlay;

    const close = () => this.closeAuthModal();
    overlay.querySelectorAll('.wm-user-modal-close').forEach((el) => {
      el.addEventListener('click', close);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    this.renderAuthModalContent();
  }

  private renderAuthModalContent(): void {
    const overlay = this.loginOverlay;
    if (!overlay) return;

    const titleEl = overlay.querySelector('#userAuthModalTitle');
    const bodyEl = overlay.querySelector('#userAuthModalBody') as HTMLElement | null;
    const footerEl = overlay.querySelector('#userAuthModalFooter') as HTMLElement | null;
    if (!bodyEl || !footerEl) return;
    if (titleEl) titleEl.textContent = this.authModalTitle();

    const savedEmail = (overlay.querySelector('#userAuthEmail') as HTMLInputElement | null)?.value ?? '';

    if (this.authView === 'login') {
      bodyEl.innerHTML = `
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.email'))}</span>
          <input type="email" id="userAuthEmail" autocomplete="email" value="${escapeHtml(savedEmail)}" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.password'))}</span>
          <input type="password" id="userAuthPassword" autocomplete="current-password" />
        </label>
        <p class="wm-user-error" id="userAuthError" hidden></p>
        <p class="wm-user-success" id="userAuthSuccess" hidden></p>
        <div class="wm-user-auth-links">
          <button type="button" class="wm-user-link-btn" data-auth-view="register">${escapeHtml(t('account.registerLink'))}</button>
          <span class="wm-user-link-sep">·</span>
          <button type="button" class="wm-user-link-btn" data-auth-view="forgot">${escapeHtml(t('account.forgotLink'))}</button>
        </div>`;
      footerEl.innerHTML = `
        <button type="button" class="wm-user-btn-secondary wm-user-modal-close">${escapeHtml(t('account.cancel'))}</button>
        <button type="button" class="wm-user-btn-primary" id="userAuthPrimary">${escapeHtml(t('account.login'))}</button>`;
      footerEl.querySelector('#userAuthPrimary')?.addEventListener('click', () => { void this.submitLogin(); });
      bodyEl.querySelector('#userAuthPassword')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') void this.submitLogin();
      });
    } else if (this.authView === 'register') {
      bodyEl.innerHTML = `
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.email'))}</span>
          <input type="email" id="userAuthEmail" autocomplete="email" value="${escapeHtml(savedEmail)}" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.password'))}</span>
          <input type="password" id="userAuthPassword" autocomplete="new-password" minlength="8" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.confirmPassword'))}</span>
          <input type="password" id="userAuthConfirmPassword" autocomplete="new-password" minlength="8" />
        </label>
        <p class="wm-user-error" id="userAuthError" hidden></p>
        <div class="wm-user-auth-links">
          <button type="button" class="wm-user-link-btn" data-auth-view="login">${escapeHtml(t('account.backToLogin'))}</button>
        </div>`;
      footerEl.innerHTML = `
        <button type="button" class="wm-user-btn-secondary" data-auth-view="login">${escapeHtml(t('account.cancel'))}</button>
        <button type="button" class="wm-user-btn-primary" id="userAuthPrimary">${escapeHtml(t('account.register'))}</button>`;
      footerEl.querySelector('#userAuthPrimary')?.addEventListener('click', () => { void this.submitRegister(); });
      bodyEl.querySelector('#userAuthConfirmPassword')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') void this.submitRegister();
      });
    } else {
      bodyEl.innerHTML = `
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.email'))}</span>
          <input type="email" id="userAuthEmail" autocomplete="email" value="${escapeHtml(savedEmail)}" />
        </label>
        <label class="wm-user-field wm-user-field-row">
          <span>${escapeHtml(t('account.verificationCode'))}</span>
          <div class="wm-user-code-row">
            <input type="text" id="userAuthCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
            <button type="button" class="wm-user-btn-secondary" id="userSendCodeBtn">${escapeHtml(t('account.sendCode'))}</button>
          </div>
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.newPassword'))}</span>
          <input type="password" id="userAuthPassword" autocomplete="new-password" minlength="8" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.confirmPassword'))}</span>
          <input type="password" id="userAuthConfirmPassword" autocomplete="new-password" minlength="8" />
        </label>
        <p class="wm-user-error" id="userAuthError" hidden></p>
        <p class="wm-user-success" id="userAuthSuccess" hidden></p>
        <div class="wm-user-auth-links">
          <button type="button" class="wm-user-link-btn" data-auth-view="login">${escapeHtml(t('account.backToLogin'))}</button>
        </div>`;
      footerEl.innerHTML = `
        <button type="button" class="wm-user-btn-secondary" data-auth-view="login">${escapeHtml(t('account.cancel'))}</button>
        <button type="button" class="wm-user-btn-primary" id="userAuthPrimary">${escapeHtml(t('account.resetPassword'))}</button>`;
      footerEl.querySelector('#userAuthPrimary')?.addEventListener('click', () => { void this.submitResetPassword(); });
      bodyEl.querySelector('#userSendCodeBtn')?.addEventListener('click', () => { void this.sendResetCode(); });
      this.updateSendCodeButton();
    }

    overlay.querySelectorAll('[data-auth-view]').forEach((el) => {
      el.addEventListener('click', () => {
        const view = (el as HTMLElement).dataset.authView as AuthView;
        this.authView = view;
        this.renderAuthModalContent();
      });
    });
    overlay.querySelectorAll('.wm-user-modal-close').forEach((el) => {
      el.addEventListener('click', () => this.closeAuthModal());
    });
  }

  private showAuthError(message: string): void {
    const errEl = this.loginOverlay?.querySelector('#userAuthError') as HTMLElement | null;
    const okEl = this.loginOverlay?.querySelector('#userAuthSuccess') as HTMLElement | null;
    if (okEl) okEl.hidden = true;
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  }

  private showAuthSuccess(message: string): void {
    const errEl = this.loginOverlay?.querySelector('#userAuthError') as HTMLElement | null;
    const okEl = this.loginOverlay?.querySelector('#userAuthSuccess') as HTMLElement | null;
    if (errEl) errEl.hidden = true;
    if (okEl) {
      okEl.textContent = message;
      okEl.hidden = false;
    }
  }

  private async submitLogin(): Promise<void> {
    const overlay = this.loginOverlay;
    if (!overlay) return;
    const email = (overlay.querySelector('#userAuthEmail') as HTMLInputElement).value.trim();
    const password = (overlay.querySelector('#userAuthPassword') as HTMLInputElement).value;
    if (!email || !password) {
      this.showAuthError(t('account.loginRequired'));
      return;
    }
    const btn = overlay.querySelector('#userAuthPrimary') as HTMLButtonElement;
    btn.disabled = true;
    try {
      this.user = await loginUser(email, password);
      this.closeAuthModal();
      this.render();
      if (this.shouldOpenApiKeyFromUrl()) {
        this.focusApiKeyOnOpen = true;
        void this.openProfileModal();
      }
    } catch (err) {
      this.showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false;
    }
  }

  private async submitRegister(): Promise<void> {
    const overlay = this.loginOverlay;
    if (!overlay) return;
    const email = (overlay.querySelector('#userAuthEmail') as HTMLInputElement).value.trim();
    const password = (overlay.querySelector('#userAuthPassword') as HTMLInputElement).value;
    const confirmPassword = (overlay.querySelector('#userAuthConfirmPassword') as HTMLInputElement).value;
    if (!email || !password || !confirmPassword || password.length < 8) {
      this.showAuthError(t('account.registerRequired'));
      return;
    }
    if (password !== confirmPassword) {
      this.showAuthError(t('account.passwordMismatch'));
      return;
    }
    const btn = overlay.querySelector('#userAuthPrimary') as HTMLButtonElement;
    btn.disabled = true;
    try {
      this.user = await registerUser(email, password);
      this.closeAuthModal();
      this.render();
      if (this.shouldOpenApiKeyFromUrl()) {
        this.focusApiKeyOnOpen = true;
        void this.openProfileModal();
      }
    } catch (err) {
      this.showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false;
    }
  }

  private clearCodeCooldown(): void {
    if (this.codeCooldownTimer) {
      clearInterval(this.codeCooldownTimer);
      this.codeCooldownTimer = null;
    }
    this.codeCooldownUntil = 0;
  }

  private updateSendCodeButton(): void {
    const btn = this.loginOverlay?.querySelector('#userSendCodeBtn') as HTMLButtonElement | null;
    if (!btn) return;
    const remain = Math.ceil((this.codeCooldownUntil - Date.now()) / 1000);
    if (remain > 0) {
      btn.disabled = true;
      btn.textContent = `${t('account.resendCode')} (${remain}s)`;
      if (!this.codeCooldownTimer) {
        this.codeCooldownTimer = setInterval(() => {
          if (Date.now() >= this.codeCooldownUntil) {
            this.clearCodeCooldown();
            btn.disabled = false;
            btn.textContent = t('account.resendCode');
          } else {
            btn.textContent = `${t('account.resendCode')} (${Math.ceil((this.codeCooldownUntil - Date.now()) / 1000)}s)`;
          }
        }, 1000);
      }
    } else {
      btn.disabled = false;
      btn.textContent = t('account.sendCode');
    }
  }

  private async sendResetCode(): Promise<void> {
    const overlay = this.loginOverlay;
    if (!overlay) return;
    const email = (overlay.querySelector('#userAuthEmail') as HTMLInputElement).value.trim();
    if (!email) {
      this.showAuthError(t('account.errors.email_required'));
      return;
    }
    const btn = overlay.querySelector('#userSendCodeBtn') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await sendPasswordResetCode(email);
      this.showAuthSuccess(t('account.codeSent'));
      this.codeCooldownUntil = Date.now() + 60_000;
      this.updateSendCodeButton();
    } catch (err) {
      this.showAuthError(mapAuthError(err));
      btn.disabled = false;
    }
  }

  private async submitResetPassword(): Promise<void> {
    const overlay = this.loginOverlay;
    if (!overlay) return;
    const email = (overlay.querySelector('#userAuthEmail') as HTMLInputElement).value.trim();
    const code = (overlay.querySelector('#userAuthCode') as HTMLInputElement).value.trim();
    const password = (overlay.querySelector('#userAuthPassword') as HTMLInputElement).value;
    const confirmPassword = (overlay.querySelector('#userAuthConfirmPassword') as HTMLInputElement).value;
    if (!email || !code || !password || !confirmPassword || password.length < 8) {
      this.showAuthError(t('account.forgotRequired'));
      return;
    }
    if (password !== confirmPassword) {
      this.showAuthError(t('account.passwordMismatch'));
      return;
    }
    const btn = overlay.querySelector('#userAuthPrimary') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await resetPasswordWithCode(email, code, password);
      this.authView = 'login';
      this.renderAuthModalContent();
      this.showAuthSuccess(t('account.resetSuccess'));
    } catch (err) {
      this.showAuthError(mapAuthError(err));
    } finally {
      btn.disabled = false;
    }
  }

  private closeAuthModal(): void {
    this.clearCodeCooldown();
    this.loginOverlay?.remove();
    this.loginOverlay = null;
  }

  private async openProfileModal(): Promise<void> {
    this.closeProfileModal();
    if (!this.user) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active wm-user-modal-overlay';
    overlay.id = 'userProfileModal';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `
      <div class="modal wm-user-modal wm-user-profile-modal">
        <div class="modal-header">
          <span class="modal-title">${escapeHtml(t('account.profileTitle'))}</span>
          <button type="button" class="modal-close wm-user-modal-close" aria-label="${escapeHtml(t('common.close'))}">×</button>
        </div>
        <div class="wm-user-modal-body">
          <div class="wm-user-profile-loading">${escapeHtml(t('common.loading'))}</div>
        </div>
        <div class="wm-user-modal-footer" id="userProfileFooter" hidden></div>
      </div>`;

    document.body.appendChild(overlay);
    this.profileOverlay = overlay;

    const close = () => this.closeProfileModal();
    overlay.querySelectorAll('.wm-user-modal-close').forEach((el) => {
      el.addEventListener('click', close);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    let catalog: SubscriptionCatalog | null = null;
    let apiKeyInfo: UserApiKeyInfo = { ...EMPTY_USER_API_KEY };
    let apiKeyLoadError = '';
    try {
      catalog = await fetchSubscriptionCatalog();
    } catch {
      catalog = null;
    }
    try {
      apiKeyInfo = await fetchUserApiKey();
    } catch (err) {
      apiKeyLoadError = mapAuthError(err);
    }

    const body = overlay.querySelector('.wm-user-modal-body');
    if (!body || !this.user) return;

    this.apiKeyRevealed = false;
    this.apiKeyFullText = null;
    this.renderProfileBody(body, catalog, apiKeyInfo, apiKeyLoadError);

    if (this.focusApiKeyOnOpen) {
      this.focusApiKeyOnOpen = false;
      this.clearApiKeyDeepLink();
      requestAnimationFrame(() => {
        overlay.querySelector('#userApiKeySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    const footer = overlay.querySelector('#userProfileFooter') as HTMLElement | null;
    if (footer) {
      footer.hidden = false;
      footer.innerHTML = `
        <button type="button" class="wm-user-btn-secondary wm-user-modal-close">${escapeHtml(t('account.cancel'))}</button>
        <button type="button" class="wm-user-btn-primary" id="userProfileSaveBtn">${escapeHtml(t('account.saveProfile'))}</button>`;
      footer.querySelector('#userProfileSaveBtn')?.addEventListener('click', () => { void this.submitProfileUpdate(); });
      footer.querySelectorAll('.wm-user-modal-close').forEach((el) => {
        el.addEventListener('click', () => this.closeProfileModal());
      });
    }
  }

  private formatApiKeyExpiryLabel(apiKey: UserApiKeyInfo): string {
    if (apiKey.expiresAt) {
      const when = new Date(apiKey.expiresAt).toLocaleString();
      if (apiKey.expired) {
        return `${escapeHtml(t('account.apiKeyExpired'))} (${escapeHtml(when)})`;
      }
      return `${escapeHtml(t('account.apiKeyExpires'))}: ${escapeHtml(when)}`;
    }
    return escapeHtml(t('account.apiKeyPermanent'));
  }

  private renderApiKeyExpiryFields(showForExistingKey = false, existing?: UserApiKeyInfo): string {
    const useUntil = Boolean(existing?.expiresAt && !existing.expired);
    const defaultUntil = useUntil && existing?.expiresAt
      ? toDatetimeLocalValue(existing.expiresAt)
      : defaultApiKeyExpiryLocal();
    const saveBtn = showForExistingKey
      ? `<button type="button" class="wm-user-btn-secondary" id="userApiKeySaveExpiryBtn">${escapeHtml(t('account.apiKeySaveExpiry'))}</button>`
      : '';
    const hint = showForExistingKey
      ? t('account.apiKeyExpirySaveHint')
      : '';
    return `
      <div class="wm-user-api-key-expiry">
        <label class="wm-user-muted wm-user-api-key-expiry-label">${escapeHtml(t('account.apiKeyExpiryLabel'))}</label>
        <label class="wm-user-radio-label">
          <input type="radio" name="userApiKeyExpiryMode" value="permanent"${useUntil ? '' : ' checked'} />
          ${escapeHtml(t('account.apiKeyPermanent'))}
        </label>
        <label class="wm-user-radio-label">
          <input type="radio" name="userApiKeyExpiryMode" value="until"${useUntil ? ' checked' : ''} />
          ${escapeHtml(t('account.apiKeyExpiryUntil'))}
        </label>
        <div id="userApiKeyExpiresAtWrap"${useUntil ? '' : ' hidden'}>
          <input type="datetime-local" id="userApiKeyExpiresAt" value="${defaultUntil}" />
        </div>
        ${hint ? `<p class="wm-user-muted wm-user-field-hint">${escapeHtml(hint)}</p>` : ''}
        ${saveBtn}
      </div>`;
  }

  private readApiKeyExpiryFromOverlay(): { permanent: boolean; expiresAt: string | null } {
    const root = this.profileOverlay ?? document;
    return readApiKeyExpiryOptions(root, 'userApiKeyExpiryMode', 'userApiKeyExpiresAt', {
      required: t('account.apiKeyExpiryRequired'),
      invalid: t('account.apiKeyExpiryInvalid'),
    });
  }

  private renderApiKeySection(apiKey: UserApiKeyInfo, loadError = ''): string {
    const expiry = this.formatApiKeyExpiryLabel(apiKey);

    const statusBadge = apiKey.expired
      ? `<span class="wm-user-badge off">${escapeHtml(t('account.apiKeyExpired'))}</span>`
      : apiKey.hasKey
        ? `<span class="wm-user-badge">${escapeHtml(t('account.enabled'))}</span>`
        : '';

    const errorBlock = loadError
      ? `<p class="wm-user-error" id="userApiKeyError">${escapeHtml(loadError)}</p>`
      : `<p class="wm-user-error" id="userApiKeyError" hidden></p>`;
    const successBlock = `<p class="wm-user-success" id="userApiKeySuccess" hidden></p>`;

    if (!apiKey.hasKey) {
      const creating = this.apiKeyCreating;
      return `
      <section class="wm-user-profile-section" id="userApiKeySection">
        <h3>${escapeHtml(t('account.apiKeySection'))}</h3>
        <p class="wm-user-muted">${escapeHtml(t('account.apiKeyHint'))}</p>
        <p class="wm-user-muted">${escapeHtml(t('account.apiKeyNone'))}</p>
        ${errorBlock}
        ${successBlock}
        ${this.renderApiKeyExpiryFields()}
        <button type="button" class="wm-user-btn-primary" id="userApiKeyCreateBtn"${creating ? ' disabled' : ''}>${escapeHtml(creating ? t('common.loading') : t('account.apiKeyCreate'))}</button>
      </section>`;
    }

    const masked = apiKey.keyPrefix ?? 'wmuk_****';
    const displayKey = this.apiKeyRevealed && this.apiKeyFullText
      ? this.apiKeyFullText
      : masked;
    const viewBtn = this.apiKeyRevealed
      ? `<button type="button" class="wm-user-btn-secondary" id="userApiKeyHideBtn">${escapeHtml(t('account.apiKeyHide'))}</button>`
      : `<button type="button" class="wm-user-btn-secondary" id="userApiKeyViewBtn">${escapeHtml(t('account.apiKeyView'))}</button>`;

    return `
      <section class="wm-user-profile-section" id="userApiKeySection">
        <h3>${escapeHtml(t('account.apiKeySection'))} ${statusBadge}</h3>
        <p class="wm-user-muted">${escapeHtml(t('account.apiKeyHint'))}</p>
        <div class="wm-user-api-key-box">
          <code class="wm-user-api-key-value${this.apiKeyRevealed ? ' is-revealed' : ' is-masked'}" id="userApiKeyValue">${escapeHtml(displayKey)}</code>
          <p class="wm-user-muted wm-user-field-hint">${escapeHtml(this.apiKeyRevealed ? t('account.apiKeyRevealHint') : t('account.apiKeyMaskedHint'))}</p>
          <p class="wm-user-muted">${expiry}</p>
        </div>
        ${errorBlock}
        ${successBlock}
        ${this.renderApiKeyExpiryFields(true, apiKey)}
        <div class="wm-user-api-key-actions">
          ${viewBtn}
          <button type="button" class="wm-user-btn-secondary" id="userApiKeyCopyBtn">${escapeHtml(t('account.apiKeyCopy'))}</button>
          <button type="button" class="wm-user-btn-secondary" id="userApiKeyRotateBtn">${escapeHtml(t('account.apiKeyRotate'))}</button>
          <button type="button" class="wm-user-btn-secondary wm-user-btn-danger-text" id="userApiKeyDeleteBtn">${escapeHtml(t('account.apiKeyDelete'))}</button>
        </div>
      </section>`;
  }

  private wireApiKeyHandlers(_apiKey: UserApiKeyInfo): void {
    const root = this.profileOverlay ?? document;
    bindApiKeyExpiryToggle(root, 'userApiKeyExpiryMode', 'userApiKeyExpiresAt', 'userApiKeyExpiresAtWrap');
    this.profileOverlay?.querySelector('#userApiKeySaveExpiryBtn')?.addEventListener('click', () => {
      void this.handleSaveApiKeyExpiry();
    });
    this.profileOverlay?.querySelector('#userApiKeyCreateBtn')?.addEventListener('click', () => {
      void this.handleCreateApiKey();
    });
    this.profileOverlay?.querySelector('#userApiKeyViewBtn')?.addEventListener('click', () => {
      void this.handleViewApiKey();
    });
    this.profileOverlay?.querySelector('#userApiKeyHideBtn')?.addEventListener('click', () => {
      this.apiKeyRevealed = false;
      this.apiKeyFullText = null;
      void this.refreshApiKeySectionOnly();
    });
    this.profileOverlay?.querySelector('#userApiKeyCopyBtn')?.addEventListener('click', () => {
      void this.handleCopyApiKey();
    });
    this.profileOverlay?.querySelector('#userApiKeyRotateBtn')?.addEventListener('click', () => {
      void this.handleRotateApiKey();
    });
    this.profileOverlay?.querySelector('#userApiKeyDeleteBtn')?.addEventListener('click', () => {
      void this.handleDeleteApiKey();
    });
  }

  private showApiKeyError(message: string): void {
    const errEl = this.profileOverlay?.querySelector('#userApiKeyError') as HTMLElement | null;
    const okEl = this.profileOverlay?.querySelector('#userApiKeySuccess') as HTMLElement | null;
    if (okEl) okEl.hidden = true;
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
    errEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private showApiKeySuccess(message: string): void {
    const errEl = this.profileOverlay?.querySelector('#userApiKeyError') as HTMLElement | null;
    const okEl = this.profileOverlay?.querySelector('#userApiKeySuccess') as HTMLElement | null;
    if (errEl) errEl.hidden = true;
    if (okEl) {
      okEl.textContent = message;
      okEl.hidden = false;
    }
    okEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private async refreshApiKeySectionOnly(): Promise<void> {
    const section = this.profileOverlay?.querySelector('#userApiKeySection');
    if (!section?.parentElement) return;
    try {
      const apiKeyInfo = await fetchUserApiKey();
      const html = this.renderApiKeySection(apiKeyInfo);
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      const newSection = wrap.firstElementChild;
      if (newSection) {
        section.replaceWith(newSection);
        this.wireApiKeyHandlers(apiKeyInfo);
      }
    } catch (err) {
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleCreateApiKey(): Promise<void> {
    if (this.apiKeyCreating) return;
    let expiry: { permanent: boolean; expiresAt: string | null };
    try {
      expiry = this.readApiKeyExpiryFromOverlay();
    } catch (err) {
      this.showApiKeyError(String(err));
      return;
    }
    this.apiKeyCreating = true;
    await this.refreshApiKeySectionOnly();
    try {
      const created = await createUserApiKey(expiry);
      this.apiKeyRevealed = true;
      this.apiKeyFullText = created.apiKey ?? null;
      this.apiKeyCreating = false;
      await this.refreshProfileSections();
      this.showApiKeySuccess(t('account.apiKeyCreated'));
    } catch (err) {
      this.apiKeyCreating = false;
      await this.refreshApiKeySectionOnly();
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleViewApiKey(): Promise<void> {
    try {
      const revealed = await revealUserApiKey();
      this.apiKeyRevealed = true;
      this.apiKeyFullText = revealed.apiKey;
      await this.refreshApiKeySectionOnly();
    } catch (err) {
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleSaveApiKeyExpiry(): Promise<void> {
    let expiry: { permanent: boolean; expiresAt: string | null };
    try {
      expiry = this.readApiKeyExpiryFromOverlay();
    } catch (err) {
      this.showApiKeyError(String(err));
      return;
    }
    try {
      await updateUserApiKeyExpiry(expiry);
      await this.refreshProfileSections();
      this.showApiKeySuccess(t('account.apiKeyExpirySaved'));
    } catch (err) {
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleRotateApiKey(): Promise<void> {
    if (!window.confirm(t('account.apiKeyRotateConfirm'))) return;
    let expiry: { permanent: boolean; expiresAt: string | null };
    try {
      expiry = this.readApiKeyExpiryFromOverlay();
    } catch (err) {
      this.showApiKeyError(String(err));
      return;
    }
    try {
      const rotated = await rotateUserApiKey(expiry);
      this.apiKeyRevealed = true;
      this.apiKeyFullText = rotated.apiKey ?? null;
      await this.refreshProfileSections();
      this.showApiKeySuccess(t('account.apiKeyRotated'));
    } catch (err) {
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleDeleteApiKey(): Promise<void> {
    if (!window.confirm(t('account.apiKeyDeleteConfirm'))) return;
    try {
      await deleteUserApiKey();
      this.apiKeyRevealed = false;
      this.apiKeyFullText = null;
      await this.refreshProfileSections();
      this.showApiKeySuccess(t('account.apiKeyDeleted'));
    } catch (err) {
      this.showApiKeyError(mapAuthError(err));
    }
  }

  private async handleCopyApiKey(): Promise<void> {
    let text = this.apiKeyFullText?.trim() ?? '';
    if (!text) {
      try {
        const revealed = await revealUserApiKey();
        text = revealed.apiKey?.trim() ?? '';
      } catch (err) {
        this.showApiKeyError(mapAuthError(err));
        return;
      }
    }
    if (!text) {
      this.showApiKeyError(t('account.apiKeyNone'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.showApiKeySuccess(t('account.apiKeyCopied'));
    } catch {
      this.showApiKeyError(t('account.apiKeyCopyFailed'));
    }
  }

  private async refreshProfileSections(): Promise<void> {
    const overlay = this.profileOverlay;
    if (!overlay || !this.user) return;
    const body = overlay.querySelector('.wm-user-modal-body') as HTMLElement | null;
    if (!body) return;
    const displayName = (body.querySelector('#userProfileDisplayName') as HTMLInputElement | null)?.value;
    const preferredLang = (body.querySelector('#userProfilePreferredLang') as HTMLSelectElement | null)?.value;
    let apiKeyLoadError = '';
    try {
      const [catalog, apiKeyInfo] = await Promise.all([
        fetchSubscriptionCatalog(),
        fetchUserApiKey(),
      ]);
      this.renderProfileBody(body, catalog, apiKeyInfo, apiKeyLoadError);
      if (displayName !== undefined) {
        const nameEl = body.querySelector('#userProfileDisplayName') as HTMLInputElement | null;
        if (nameEl) nameEl.value = displayName;
      }
      if (preferredLang) {
        const langEl = body.querySelector('#userProfilePreferredLang') as HTMLSelectElement | null;
        if (langEl) langEl.value = preferredLang;
      }
    } catch (err) {
      apiKeyLoadError = mapAuthError(err);
      try {
        const catalog = await fetchSubscriptionCatalog();
        this.renderProfileBody(body, catalog, { ...EMPTY_USER_API_KEY }, apiKeyLoadError);
      } catch {
        this.showApiKeyError(apiKeyLoadError);
      }
    }
  }

  private renderProfileBody(
    body: HTMLElement,
    catalog: SubscriptionCatalog | null,
    apiKeyInfo: UserApiKeyInfo = EMPTY_USER_API_KEY,
    apiKeyLoadError = '',
  ): void {
    if (!this.user) return;

    const limitHint = catalog && catalog.maxSubscriptionsPerUser > 0
      ? `<p class="wm-user-muted">${escapeHtml(t('account.subscriptionLimitHint', {
        count: String(catalog.activeSubscriptionCount),
        max: String(catalog.maxSubscriptionsPerUser),
      }))}</p>`
      : '';

    const selfServiceOff = catalog && !catalog.selfServiceEnabled
      ? `<p class="wm-user-muted">${escapeHtml(t('account.selfServiceDisabled'))}</p>`
      : '';

    const catalogRows = catalog?.presets.length
      ? catalog.presets.map((p) => {
        let action = '';
        if (p.subscribed && p.subscription_id) {
          action = catalog.selfServiceEnabled
            ? `<button type="button" class="wm-user-btn-secondary wm-user-sub-action" data-unsub="${escapeHtml(p.subscription_id)}">${escapeHtml(t('account.unsubscribe'))}</button>`
            : '';
        } else if (catalog.selfServiceEnabled) {
          const disabled = !catalog.canSubscribe ? ' disabled' : '';
          action = `<button type="button" class="wm-user-btn-primary wm-user-sub-action"${disabled} data-sub-preset="${escapeHtml(p.id)}">${escapeHtml(t('account.subscribe'))}</button>`;
        }
        const status = p.subscribed
          ? `<span class="wm-user-badge">${escapeHtml(t('account.subscribed'))}</span>`
          : `<span class="wm-user-badge off">${escapeHtml(t('account.notSubscribed'))}</span>`;
        return `
        <tr>
          <td>${escapeHtml(p.title)}</td>
          <td class="wm-user-muted">${escapeHtml(p.rules_summary)}</td>
          <td>${status}</td>
          <td class="wm-user-sub-action-cell">${action}</td>
        </tr>`;
      }).join('')
      : `<tr><td colspan="4" class="wm-user-muted">${escapeHtml(t('account.noCatalogItems'))}</td></tr>`;

    body.innerHTML = `
      <section class="wm-user-profile-section">
        <h3>${escapeHtml(t('account.userInfo'))}</h3>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.email'))}</span>
          <input type="email" id="userProfileEmail" readonly value="${escapeHtml(this.user.email)}" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.displayName'))}</span>
          <input type="text" id="userProfileDisplayName" autocomplete="name" value="${escapeHtml(this.user.display_name ?? '')}" />
        </label>
        <label class="wm-user-field">
          <span>${escapeHtml(t('account.preferredLang'))}</span>
          <select id="userProfilePreferredLang">${deliveryLangOptions(this.user.preferred_lang || 'zh')}</select>
        </label>
        <p class="wm-user-muted wm-user-field-hint">${escapeHtml(t('account.preferredLangHint'))}</p>
        <p class="wm-user-error" id="userProfileError" hidden></p>
        <p class="wm-user-success" id="userProfileSuccess" hidden></p>
      </section>
      ${this.renderApiKeySection(apiKeyInfo, apiKeyLoadError)}
      <section class="wm-user-profile-section">
        <h3>${escapeHtml(t('account.mySubscriptions'))}</h3>
        ${selfServiceOff}
        ${limitHint}
        <div class="wm-user-table-wrap">
          <table class="wm-user-table">
            <thead>
              <tr>
                <th>${escapeHtml(t('account.subName'))}</th>
                <th>${escapeHtml(t('account.subRules'))}</th>
                <th>${escapeHtml(t('account.subStatus'))}</th>
                <th>${escapeHtml(t('account.subAction'))}</th>
              </tr>
            </thead>
            <tbody id="userCatalogBody">${catalogRows}</tbody>
          </table>
        </div>
      </section>`;

    body.querySelectorAll('[data-sub-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const presetId = (el as HTMLElement).dataset.subPreset!;
        void this.handleSubscribe(presetId);
      });
    });
    body.querySelectorAll('[data-unsub]').forEach((el) => {
      el.addEventListener('click', () => {
        const subId = (el as HTMLElement).dataset.unsub!;
        void this.handleUnsubscribe(subId);
      });
    });
    this.wireApiKeyHandlers(apiKeyInfo);
  }

  private async refreshCatalogSection(): Promise<void> {
    await this.refreshProfileSections();
  }

  private async handleSubscribe(presetId: string): Promise<void> {
    try {
      await subscribeToPreset(presetId);
      await this.refreshCatalogSection();
      this.showProfileSuccess(t('account.subscribeSuccess'));
    } catch (err) {
      this.showProfileError(mapAuthError(err));
    }
  }

  private async handleUnsubscribe(subscriptionId: string): Promise<void> {
    try {
      await unsubscribeFromPreset(subscriptionId);
      await this.refreshCatalogSection();
      this.showProfileSuccess(t('account.unsubscribeSuccess'));
    } catch (err) {
      this.showProfileError(mapAuthError(err));
    }
  }

  private showProfileError(message: string): void {
    const errEl = this.profileOverlay?.querySelector('#userProfileError') as HTMLElement | null;
    const okEl = this.profileOverlay?.querySelector('#userProfileSuccess') as HTMLElement | null;
    if (okEl) okEl.hidden = true;
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  }

  private showProfileSuccess(message: string): void {
    const errEl = this.profileOverlay?.querySelector('#userProfileError') as HTMLElement | null;
    const okEl = this.profileOverlay?.querySelector('#userProfileSuccess') as HTMLElement | null;
    if (errEl) errEl.hidden = true;
    if (okEl) {
      okEl.textContent = message;
      okEl.hidden = false;
    }
  }

  private async submitProfileUpdate(): Promise<void> {
    const overlay = this.profileOverlay;
    if (!overlay || !this.user) return;
    const displayName = (overlay.querySelector('#userProfileDisplayName') as HTMLInputElement).value.trim();
    const preferredLang = (overlay.querySelector('#userProfilePreferredLang') as HTMLSelectElement).value;
    const btn = overlay.querySelector('#userProfileSaveBtn') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      this.user = await updateUserProfile({
        displayName: displayName || null,
        preferredLang,
      });
      this.closeProfileModal();
      this.render();
    } catch (err) {
      this.showProfileError(mapAuthError(err));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private closeProfileModal(): void {
    this.apiKeyRevealed = false;
    this.apiKeyFullText = null;
    this.apiKeyCreating = false;
    this.profileOverlay?.remove();
    this.profileOverlay = null;
  }
}
