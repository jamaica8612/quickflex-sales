import {
  ROUTE_NOTE_BUCKET, ROUTE_NOTE_SIGNED_URL_SECONDS, isRouteNoteUuid, normalizeRouteNoteTip,
  normalizeRouteNoteZone, normalizeRouteNotePolygon, validateRouteNoteImage,
} from "../lib/route-notes.js?v=2";
import { isPointInRouteNoteZone } from "../lib/route-note-rules.js";

const ROLES = new Set(["admin", "editor", "member"]);
const MUTATING_ROLES = new Set(["admin", "editor"]);
const ZONE_PHOTO_BUCKET = "quickflex-route-note-zone-photos";
const TABLES = Object.freeze({
  companies: "quickflex_note_companies", memberships: "quickflex_note_memberships",
  zones: "quickflex_note_zones", tips: "quickflex_note_tips",
  favorites: "quickflex_note_favorites", photos: "quickflex_note_photos", zonePhotos: "quickflex_note_zone_photos",
});

function message(error, fallback) { return error?.message || fallback; }
function conflict(kind) {
  const error = new Error(`${kind} changed on another device. Refresh and compare before saving again.`);
  error.code = "CONFLICT";
  return error;
}
function resultOrThrow(result, fallback) {
  if (result?.error) { const error = new Error(message(result.error, fallback)); error.code = result.error.code; throw error; }
  return result?.data;
}
function one(value, label) {
  if (!value) throw new Error(`${label} was not found or is no longer available`);
  return value;
}

export function createRouteNotesService({ getContext, getClient, getUser, getProfile, cryptoImpl = globalThis.crypto } = {}) {
  if (typeof getContext !== "function" && (typeof getClient !== "function" || typeof getUser !== "function" || typeof getProfile !== "function")) {
    throw new Error("Route-notes context provider is unavailable");
  }
  let epoch = 0;
  let accountId = null;

  async function identity() {
    const supplied = typeof getContext === "function";
    const provided = supplied ? await getContext() : null;
    const client = supplied ? provided?.client : await getClient();
    const userResult = supplied ? provided?.user : await getUser();
    const profileResult = supplied ? provided?.profile : await getProfile();
    const user = userResult?.data?.user || userResult?.user || userResult;
    const profile = profileResult?.data || profileResult;
    if (!client?.from || !client?.storage || !isRouteNoteUuid(user?.id) || !isRouteNoteUuid(profile?.id) || user.id.toLowerCase() !== profile.id.toLowerCase() || profile.status !== "approved") {
      throw new Error("A matching signed-in account and profile are required");
    }
    return { client, userId: user.id.toLowerCase(), sourceEpoch: provided?.epoch };
  }

  async function context() {
    const current = await identity();
    if (accountId !== current.userId) { accountId = current.userId; epoch += 1; }
    const captured = { ...current, epoch };
    const memberships = resultOrThrow(await current.client.from(TABLES.memberships).select("company_id,user_id,role")
      .eq("user_id", current.userId), "Company membership could not be loaded") || [];
    const valid = memberships.filter((membership) => isRouteNoteUuid(membership.company_id) &&
      String(membership.user_id || "").toLowerCase() === current.userId && ROLES.has(membership.role));
    if (valid.length !== 1) throw new Error(valid.length ? "Choose one company before opening route notes" : "Company membership is required");
    const membership = valid[0];
    await stillCurrent(captured);
    const company = one(resultOrThrow(await current.client.from(TABLES.companies).select("id,name")
      .eq("id", membership.company_id).maybeSingle(), "Company could not be loaded"), "Company");
    await stillCurrent(captured);
    return { ...captured, company, membership: { ...membership, user_id: current.userId } };
  }

  async function stillCurrent(captured) {
    const current = await identity();
    if (current.userId !== captured.userId || current.client !== captured.client || current.sourceEpoch !== captured.sourceEpoch || epoch !== captured.epoch) throw new Error("Account changed while route notes were loading");
    return current.client;
  }
  function zoneAuthor(captured, zone) {
    if (String(zone?.created_by || "").toLowerCase() !== captured.userId) {
      throw new Error("구역을 만든 본인만 삭제할 수 있습니다.");
    }
  }
  function zoneEditor(captured, zone) {
    if (!MUTATING_ROLES.has(captured.membership.role) && String(zone?.created_by || "").toLowerCase() !== captured.userId) {
      throw new Error("구역 작성자 또는 관리자만 수정할 수 있습니다.");
    }
  }
  function zoneResult(result) {
    if (result?.error?.code === "23505") {
      const detailCode = /detail_code|detail code/i.test(`${result.error.message || ""} ${result.error.details || ""}`);
      const error = new Error(detailCode ? "이 상세 코드는 다른 구역에서 이미 사용 중입니다." : "같은 이름의 구역이 이미 있습니다. 기존 구역을 선택해 주세요.");
      error.code = "DUPLICATE_ZONE"; throw error;
    }
    return resultOrThrow(result, "Zone could not be saved");
  }
  function tipAuthor(captured, tip) {
    if (String(tip?.created_by || "").toLowerCase() !== captured.userId) {
      throw new Error("작성자 본인만 이 팁과 사진을 수정하거나 삭제할 수 있습니다.");
    }
  }
  async function signedPhoto(captured, photo) {
    if (!isRouteNoteUuid(photo?.tip_id) || typeof photo.path !== "string" ||
        !photo.path.startsWith(`${captured.company.id}/${photo.tip_id}/`)) {
      throw new Error("Photo path is outside the current company");
    }
    const data = resultOrThrow(await captured.client.storage.from(ROUTE_NOTE_BUCKET)
      .createSignedUrl(photo.path, ROUTE_NOTE_SIGNED_URL_SECONDS), "Private photo URL could not be created");
    if (!data?.signedUrl) throw new Error("Private photo URL could not be created");
    return { ...photo, url: data.signedUrl };
  }
  async function signedZonePhoto(captured, photo) {
    if (!isRouteNoteUuid(photo?.zone_id) || typeof photo.path !== "string" ||
        !photo.path.startsWith(`zones/${captured.company.id}/${photo.zone_id}/`)) {
      throw new Error("Zone photo path is outside the current company");
    }
    const data = resultOrThrow(await captured.client.storage.from(ZONE_PHOTO_BUCKET)
      .createSignedUrl(photo.path, ROUTE_NOTE_SIGNED_URL_SECONDS), "Private zone photo URL could not be created");
    if (!data?.signedUrl) throw new Error("Private zone photo URL could not be created");
    return { ...photo, url: data.signedUrl };
  }
  async function scopedZone(captured, id) {
    if (!isRouteNoteUuid(id)) throw new RangeError("Invalid zone ID");
    return one(resultOrThrow(await captured.client.from(TABLES.zones).select("*").eq("id", id)
      .eq("company_id", captured.company.id).maybeSingle(), "Zone could not be loaded"), "Zone");
  }
  async function scopedTip(captured, id) {
    if (!isRouteNoteUuid(id)) throw new RangeError("Invalid tip ID");
    return one(resultOrThrow(await captured.client.from(TABLES.tips).select("*").eq("id", id)
      .eq("company_id", captured.company.id).maybeSingle(), "Tip could not be loaded"), "Tip");
  }

  return {
    reset() { epoch += 1; accountId = null; },
    async load() {
      const captured = await context();
      const [zonesResult, favoritesResult] = await Promise.all([
        captured.client.from(TABLES.zones).select("*").eq("company_id", captured.company.id).order("name"),
        captured.client.from(TABLES.favorites).select("zone_id").eq("company_id", captured.company.id).eq("user_id", captured.userId),
      ]);
      const zones = resultOrThrow(zonesResult, "Zones could not be loaded") || [];
      const favorites = (resultOrThrow(favoritesResult, "Favorites could not be loaded") || []).map((row) => row.zone_id).filter(isRouteNoteUuid);
      await stillCurrent(captured);
      return { company: captured.company, membership: captured.membership, zones, favorites };
    },

    async loadZone(zoneId) {
      const captured = await context();
      const zone = await scopedZone(captured, zoneId);
      const [tipsResult, zonePhotosResult] = await Promise.all([
        captured.client.from(TABLES.tips).select("*").eq("company_id", captured.company.id)
          .eq("zone_id", zone.id).order("created_at"),
        captured.client.from(TABLES.zonePhotos).select("*").eq("company_id", captured.company.id)
          .eq("zone_id", zone.id).order("created_at"),
      ]);
      const tips = resultOrThrow(tipsResult, "Route tips could not be loaded") || [];
      const zonePhotos = resultOrThrow(zonePhotosResult, "Zone photos could not be loaded") || [];
      const tipIds = tips.map((tip) => tip.id).filter(isRouteNoteUuid);
      const photos = tipIds.length ? (resultOrThrow(await captured.client.from(TABLES.photos).select("*")
        .eq("company_id", captured.company.id).in("tip_id", tipIds).order("created_at"), "Tip photos could not be loaded") || []) : [];
      const [signed, signedZonePhotos] = await Promise.all([
        Promise.all(photos.map((photo) => signedPhoto(captured, photo))),
        Promise.all(zonePhotos.map((photo) => signedZonePhoto(captured, photo))),
      ]);
      const photosByTip = new Map();
      signed.forEach((photo) => photosByTip.set(photo.tip_id, [...(photosByTip.get(photo.tip_id) || []), photo]));
      await stillCurrent(captured);
      return { zone, tips: tips.map((tip) => ({ ...tip, photos: photosByTip.get(tip.id) || [] })), zonePhotos: signedZonePhotos };
    },

    async saveZone(input) {
      const zone = normalizeRouteNoteZone(input);
      const captured = await context();
      await stillCurrent(captured);
      const values = { name: zone.name, memo: zone.memo, polygon: zone.polygon, updated_by: captured.userId };
      if (zone.color !== undefined) values.color = zone.color;
      let data;
      if (zone.id) {
        if (!zone.expectedUpdatedAt) throw new RangeError("Zone revision is required to update");
        zoneEditor(captured, await scopedZone(captured, zone.id));
        await stillCurrent(captured);
        data = zoneResult(await captured.client.from(TABLES.zones).update(values).eq("id", zone.id)
          .eq("company_id", captured.company.id).eq("updated_at", zone.expectedUpdatedAt).select("*").maybeSingle());
        if (!data) throw conflict("Zone");
      } else {
        data = zoneResult(await captured.client.from(TABLES.zones).insert({ ...values, company_id: captured.company.id,
          created_by: captured.userId }).select("*").single());
      }
      await stillCurrent(captured); return data;
    },

    async deleteZone(id, expectedUpdatedAt) {
      if (!isRouteNoteUuid(id) || !String(expectedUpdatedAt || "").trim()) throw new RangeError("Zone revision is required to delete");
      const captured = await context(); zoneAuthor(captured, await scopedZone(captured, id));
      const childResults = await Promise.all([TABLES.tips, TABLES.zonePhotos].map((table) => captured.client.from(table)
        .select("id").eq("company_id", captured.company.id).eq("zone_id", id).limit(1)));
      const contents = childResults.map((result) => resultOrThrow(result, "Zone contents could not be checked") || []);
      const occupied = contents.some((rows) => rows.length);
      const occupiedMessage = "팁이나 참고 사진이 남아 있는 구역은 삭제할 수 없습니다. 먼저 각 작성자가 내용을 정리해 주세요.";
      if (occupied) throw new Error(occupiedMessage);
      await stillCurrent(captured);
      const result = await captured.client.from(TABLES.zones).delete().eq("id", id).eq("company_id", captured.company.id)
        .eq("created_by", captured.userId).eq("updated_at", expectedUpdatedAt).select("id").maybeSingle();
      if (["23001", "23503"].includes(result?.error?.code)) throw new Error(occupiedMessage);
      if (!resultOrThrow(result, "Zone could not be deleted")) throw conflict("Zone");
      await stillCurrent(captured); return true;
    },

    async saveTip(input) {
      const tip = normalizeRouteNoteTip(input);
      const captured = await context();
      const zone = await scopedZone(captured, tip.zone_id);
      await stillCurrent(captured);
      const values = { zone_id: tip.zone_id, title: tip.title, marker_type: tip.marker_type, memo: tip.memo,
        lat: tip.lat, lng: tip.lng, updated_by: captured.userId };
      let data;
      if (tip.id) {
        if (!tip.expectedUpdatedAt) throw new RangeError("Tip revision is required to update");
        const previous = await scopedTip(captured, tip.id);
        tipAuthor(captured, previous);
        if (tip.lat != null && (tip.lat !== previous.lat || tip.lng !== previous.lng || tip.zone_id !== previous.zone_id) &&
            !isPointInRouteNoteZone({ lat: tip.lat, lng: tip.lng }, zone.polygon)) {
          throw new RangeError("지도 위치를 선택한 구역의 경계 안에 놓아 주세요.");
        }
        await stillCurrent(captured);
        data = resultOrThrow(await captured.client.from(TABLES.tips).update(values).eq("id", tip.id)
          .eq("company_id", captured.company.id).eq("updated_at", tip.expectedUpdatedAt).select("*").maybeSingle(), "Tip could not be saved");
        if (!data) throw conflict("Tip");
      } else {
        if (tip.lat != null && !isPointInRouteNoteZone({ lat: tip.lat, lng: tip.lng }, zone.polygon)) {
          throw new RangeError("지도 위치를 선택한 구역의 경계 안에 놓아 주세요.");
        }
        await stillCurrent(captured);
        data = resultOrThrow(await captured.client.from(TABLES.tips).insert({ ...values, company_id: captured.company.id,
          created_by: captured.userId }).select("*").single(), "Tip could not be saved");
      }
      await stillCurrent(captured); return data;
    },

    async lookupPostcode(postcode) {
      const value = String(postcode ?? "").trim();
      if (!/^\d{5}$/.test(value)) throw new RangeError("우편번호 5자리를 입력해 주세요.");
      const captured = await context();
      if (typeof captured.client.functions?.invoke !== "function") throw new Error("우편번호 조회를 사용할 수 없습니다.");
      const result = await captured.client.functions.invoke("route-note-postcode", { body: { postcode: value } });
      const data = resultOrThrow(result, "우편번호 경계를 조회하지 못했습니다.");
      if (data?.postcode !== value || typeof data.cityName !== "string" || typeof data.districtName !== "string") {
        throw new Error("우편번호 경계 응답이 올바르지 않습니다.");
      }
      const geometry = normalizeRouteNotePolygon(data.geometry);
      if (!geometry) throw new Error("우편번호 경계 응답이 올바르지 않습니다.");
      await stillCurrent(captured);
      return { postcode: value, cityName: data.cityName, districtName: data.districtName, geometry };
    },

    async deleteTip(id, expectedUpdatedAt) {
      if (!isRouteNoteUuid(id) || !String(expectedUpdatedAt || "").trim()) throw new RangeError("Tip revision is required to delete");
      const captured = await context(); tipAuthor(captured, await scopedTip(captured, id));
      const photos = resultOrThrow(await captured.client.from(TABLES.photos).select("id").eq("company_id", captured.company.id)
        .eq("tip_id", id), "Tip photos could not be loaded") || [];
      if (photos.length) throw new Error("Remove this tip's photos before deleting the tip");
      await stillCurrent(captured);
      const data = resultOrThrow(await captured.client.from(TABLES.tips).delete().eq("id", id).eq("company_id", captured.company.id)
        .eq("updated_at", expectedUpdatedAt).select("id").maybeSingle(), "Tip could not be deleted");
      if (!data) throw conflict("Tip");
      await stillCurrent(captured); return true;
    },

    async setFavorite(zoneId, favorite) {
      if (!isRouteNoteUuid(zoneId) || typeof favorite !== "boolean") throw new RangeError("Invalid favorite");
      const captured = await context(); await scopedZone(captured, zoneId);
      await stillCurrent(captured);
      if (favorite) {
        resultOrThrow(await captured.client.from(TABLES.favorites).upsert({ company_id: captured.company.id,
          user_id: captured.userId, zone_id: zoneId }, { onConflict: "user_id,zone_id", ignoreDuplicates: true }), "Favorite could not be saved");
      } else {
        resultOrThrow(await captured.client.from(TABLES.favorites).delete().eq("company_id", captured.company.id)
          .eq("user_id", captured.userId).eq("zone_id", zoneId), "Favorite could not be changed");
      }
      await stillCurrent(captured); return favorite;
    },

    async uploadTipPhoto(tipId, file) {
      if (!isRouteNoteUuid(tipId)) throw new RangeError("Invalid tip ID");
      const extension = validateRouteNoteImage(file);
      const captured = await context(); tipAuthor(captured, await scopedTip(captured, tipId));
      const photoId = cryptoImpl?.randomUUID?.();
      if (!isRouteNoteUuid(photoId)) throw new Error("Secure photo ID generation is unavailable");
      const path = `${captured.company.id}/${tipId}/${photoId.toLowerCase()}.${extension}`;
      const bucket = captured.client.storage.from(ROUTE_NOTE_BUCKET);
      await stillCurrent(captured);
      resultOrThrow(await bucket.upload(path, file, { contentType: file.type, upsert: false }), "Tip photo upload failed");
      let photo;
      try {
        await stillCurrent(captured);
        photo = resultOrThrow(await captured.client.from(TABLES.photos).insert({ id: photoId, company_id: captured.company.id,
          tip_id: tipId, path, created_by: captured.userId }).select("*").single(), "Tip photo metadata could not be saved");
      } catch (error) {
        await stillCurrent(captured);
        const cleanup = await bucket.remove([path]);
        if (cleanup?.error) {
          const incomplete = new Error(`Photo upload did not finish and private cleanup failed: ${message(cleanup.error, "storage rejected cleanup")}`);
          incomplete.cleanupPath = path;
          throw incomplete;
        }
        throw error;
      }
      // Once metadata exists, keep the saved photo even if URL signing fails.
      await stillCurrent(captured);
      const signed = await signedPhoto(captured, photo);
      await stillCurrent(captured);
      return signed;
    },

    async deleteTipPhoto(photoId) {
      if (!isRouteNoteUuid(photoId)) throw new RangeError("Invalid photo ID");
      const captured = await context();
      const photo = one(resultOrThrow(await captured.client.from(TABLES.photos).select("*").eq("id", photoId)
        .eq("company_id", captured.company.id).maybeSingle(), "Tip photo could not be loaded"), "Tip photo");
      const prefix = `${captured.company.id}/${photo.tip_id}/`;
      if (typeof photo.path !== "string" || !photo.path.startsWith(prefix)) throw new Error("Photo path is outside the current company");
      tipAuthor(captured, await scopedTip(captured, photo.tip_id));
      const bucket = captured.client.storage.from(ROUTE_NOTE_BUCKET);
      await stillCurrent(captured);
      resultOrThrow(await bucket.remove([photo.path]), "Tip photo could not be deleted");
      await stillCurrent(captured);
      resultOrThrow(await captured.client.from(TABLES.photos).delete().eq("id", photoId).eq("company_id", captured.company.id)
        .eq("path", photo.path), "Tip photo metadata could not be deleted");
      await stillCurrent(captured); return true;
    },
  };
}
