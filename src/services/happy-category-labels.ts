import { t } from '@/services/i18n';
import type { HappyContentCategory } from '@/services/positive-classifier';

/** Client-only localized labels for happy news categories. */
export function getHappyCategoryLabel(category: HappyContentCategory): string {
  return t(`happy.categories.${category}`);
}
