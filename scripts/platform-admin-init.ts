import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import {
  createAdminUser,
  getAdminUser,
  hasAdminUser,
  updateAdminPassword,
} from '../server/platform/auth-repository.js';
import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-admin-init');
installProcessLogHandlers(log);

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
  const reset = process.argv.includes('--reset-password');

  if (!email || !password) {
    log.error('Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env.local');
    process.exit(1);
  }

  if (await hasAdminUser()) {
    const admin = await getAdminUser();
    if (reset && admin) {
      await updateAdminPassword(admin.id, password);
      log.info('administrator password updated', { email: admin.email });
    } else {
      log.info('administrator already exists', {
        email: admin?.email,
        hint: 'use --reset-password to change password',
      });
    }
    return;
  }

  const user = await createAdminUser({
    email,
    password,
    displayName: process.env.PLATFORM_ADMIN_NAME?.trim() || 'Administrator',
  });
  log.info('administrator created', { email: user.email, id: user.id });
}

main()
  .catch((err) => {
    log.error('failed', err);
    process.exit(1);
  })
  .finally(() => closePool());
