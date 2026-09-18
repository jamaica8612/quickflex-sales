export const MEASUREMENT_APP_PACKAGE = "com.jamai.coupangflexaccessibilitytester";
export const MEASUREMENT_APP_INSTALL_URL = new URL("../../install.html", import.meta.url).href;

export function isMeasurementAppInstalled(apps) {
  return Array.isArray(apps) && apps.some((app) =>
    app?.platform === "play" && app?.id === MEASUREMENT_APP_PACKAGE,
  );
}

export function measurementAppIntentUrl({ installUrl = MEASUREMENT_APP_INSTALL_URL, workDate, shift }) {
  const query = `date=${encodeURIComponent(workDate)}&shift=${encodeURIComponent(shift)}`;
  const fallback = new URL(installUrl, globalThis.location?.href || "https://example.invalid/").href;
  return `intent://measure?${query.toString()}#Intent;scheme=quickflexpace;package=${MEASUREMENT_APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

export async function detectMeasurementApp({ navigator = globalThis.navigator, timeoutMs = 1500 } = {}) {
  if (typeof navigator?.getInstalledRelatedApps !== "function") return "unknown";
  let timer;
  try {
    const apps = await Promise.race([
      navigator.getInstalledRelatedApps(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (apps === null) return "unknown";
    return isMeasurementAppInstalled(apps) ? "installed" : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
