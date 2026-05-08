/**
 * Reduce a BCP 47 language tag to its primary language subtag and lowercase it.
 * Used internally by {@link WasmBackend} for manifest lookup so callers can
 * pass tags like `'en-US'`, `'zh-Hans'`, or `'pt_BR'` and still resolve a
 * model.
 *
 * Strategy:
 *  1. If `Intl.Locale` is available (all evergreen browsers + recent Node),
 *     trust it — it handles every BCP 47 quirk correctly.
 *  2. Otherwise fall back to a `-` / `_` split. Underscores are accepted as
 *     a courtesy because Java/Android stacks routinely emit them.
 *
 * Returns the empty string for empty/whitespace inputs so callers can short
 * circuit cleanly.
 */
export function normalizeBaseTag(tag: string): string {
  const trimmed = tag.trim();
  if (trimmed.length === 0) return "";

  if (typeof Intl !== "undefined" && typeof Intl.Locale === "function") {
    try {
      return new Intl.Locale(trimmed.replace(/_/g, "-")).language.toLowerCase();
    } catch {
      // Invalid tag (e.g. privateuse `x-...`) — fall through.
    }
  }

  const sep = /[-_]/.exec(trimmed);
  const base = sep ? trimmed.slice(0, sep.index) : trimmed;
  return base.toLowerCase();
}
