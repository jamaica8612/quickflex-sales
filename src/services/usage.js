export const USAGE_EVENT_NAMES = Object.freeze([
  "app_session_started",
  "screen_viewed",
  "stats_control_used",
]);

export const USAGE_SCREEN_NAMES = Object.freeze([
  "home",
  "inspection",
  "record",
  "measurement",
  "stats",
  "settings",
  "admin",
]);

export const STATS_USAGE_CONTROLS = Object.freeze([
  "range_changed",
  "custom_range_applied",
  "chart_metric_changed",
  "chart_point_viewed",
  "section_viewed",
]);

export const USAGE_RPC = Object.freeze({
  track: "quickflex_track_usage_event",
  summary: "quickflex_usage_summary",
});

export const USAGE_SESSION_STORAGE_KEY = "quickflex-usage-session-v1";

const EVENT_NAMES = new Set(USAGE_EVENT_NAMES);
const SCREEN_NAMES = new Set(USAGE_SCREEN_NAMES);
const CONTROL_NAMES = new Set(STATS_USAGE_CONTROLS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const volatileSessionIds = new Map();

function browserSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function browserCrypto() {
  try {
    return globalThis.crypto || null;
  } catch {
    return null;
  }
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function usageSessionStorageKey(userId) {
  if (!isUuid(userId)) throw new Error("A valid usage user ID is required");
  return `${USAGE_SESSION_STORAGE_KEY}:${userId.toLowerCase()}`;
}

export function createUsageUuid(cryptoImpl = browserCrypto()) {
  if (typeof cryptoImpl?.randomUUID === "function") {
    const id = cryptoImpl.randomUUID();
    if (isUuid(id)) return id.toLowerCase();
  }
  if (typeof cryptoImpl?.getRandomValues !== "function") {
    throw new Error("Secure random UUID generation is unavailable");
  }

  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function getUsageSessionId(options = {}) {
  const storage = Object.hasOwn(options, "storage") ? options.storage : browserSessionStorage();
  const uuidFactory = options.uuidFactory || (() => createUsageUuid(options.cryptoImpl));
  const userId = String(options.userId || options.expectedUserId || "").toLowerCase();
  const storageKey = usageSessionStorageKey(userId);

  try {
    const stored = storage?.getItem?.(storageKey);
    if (isUuid(stored)) {
      const sessionId = stored.toLowerCase();
      volatileSessionIds.set(userId, sessionId);
      return sessionId;
    }
  } catch {
    // Storage is optional; an in-memory session still keeps events groupable.
  }

  const volatileSessionId = volatileSessionIds.get(userId) || "";
  if (isUuid(volatileSessionId)) return volatileSessionId;
  const created = uuidFactory();
  if (!isUuid(created)) throw new Error("Usage UUID factory returned an invalid UUID");
  const sessionId = created.toLowerCase();
  volatileSessionIds.set(userId, sessionId);
  try {
    storage?.setItem?.(storageKey, sessionId);
  } catch {
    // Tracking remains fail-open when browser storage is disabled or full.
  }
  return sessionId;
}

export function sanitizeUsageProperties(eventName, properties = {}) {
  if (!EVENT_NAMES.has(eventName) || !properties || Array.isArray(properties)
      || typeof properties !== "object") return null;

  const keys = Object.keys(properties);
  if (eventName === "app_session_started") return keys.length === 0 ? {} : null;
  if (eventName === "screen_viewed") {
    return keys.length === 1 && keys[0] === "screen" && SCREEN_NAMES.has(properties.screen)
      ? { screen: properties.screen }
      : null;
  }
  if (eventName === "stats_control_used") {
    return keys.length === 1 && keys[0] === "control" && CONTROL_NAMES.has(properties.control)
      ? { control: properties.control }
      : null;
  }
  return null;
}

export async function trackUsageEvent(db, eventName, properties = {}, options = {}) {
  try {
    if (typeof db?.rpc !== "function") return false;
    const safeProperties = sanitizeUsageProperties(eventName, properties);
    if (!safeProperties) return false;

    const expectedUserId = String(options.expectedUserId || "").toLowerCase();
    if (!isUuid(expectedUserId)) return false;
    const sessionId = options.sessionId || getUsageSessionId({ ...options, userId: expectedUserId });
    const uuidFactory = options.uuidFactory || (() => createUsageUuid(options.cryptoImpl));
    const clientEventId = options.clientEventId || uuidFactory();
    if (!isUuid(sessionId) || !isUuid(clientEventId)) return false;

    const { error } = await db.rpc(USAGE_RPC.track, {
      p_client_event_id: clientEventId.toLowerCase(),
      p_session_id: sessionId.toLowerCase(),
      p_expected_user_id: expectedUserId,
      p_event_name: eventName,
      p_properties: safeProperties,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function fetchUsageSummary(db, options = {}) {
  if (typeof db?.rpc !== "function") throw new Error("Supabase client is unavailable");
  const windowDays = Number(options.windowDays ?? 30);
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 90) {
    throw new RangeError("Usage summary window must be an integer from 1 to 90");
  }
  const { data, error } = await db.rpc(USAGE_RPC.summary, { p_window_days: windowDays });
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}
