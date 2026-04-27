export const appStateShape = {
  session: "Supabase auth session",
  profile: "quickflex_profiles row for the signed-in user",
  rates: "signed-in user's route rates",
  entries: "signed-in user's day records keyed by date",
};

export function createPendingState() {
  return {
    pendingDates: new Set(),
    pendingRates: false,
    saveTimer: null,
    flushing: false,
    flushAgain: false,
  };
}
