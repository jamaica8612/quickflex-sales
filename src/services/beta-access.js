// This is a navigation guard; native measurement and log ingestion verify access again.
export async function checkBetaMeasurementAccess({ session, db, profilesTable, isCurrent }) {
  const userId = session?.user?.id;
  if (!userId || !isCurrent()) return "signed_out";
  // Preserve the existing developer account's measurement workflow.
  if (String(session.user.email || "").trim().toLowerCase() === "jamaica8612@gmail.com") return "allowed";
  if (!db) return "unavailable";
  try {
    const { data, error } = await db.from(profilesTable)
      .select("id,status").eq("id", userId).single();
    if (!isCurrent()) return "account_changed";
    if (error || !data || data.id !== userId) return "unavailable";
    return data.status === "approved" ? "allowed" : "not_enrolled";
  } catch {
    return isCurrent() ? "unavailable" : "account_changed";
  }
}
