"use client";
import { useParentLocale } from "./parent-locale";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import type { SupportRequest } from "@/lib/parent/domain";
import { familyProfileBindingsSchema, familyProfileReadSchema, type FamilyProfileSource, type FamilyProfileRead } from "@/lib/parent/family-profile";
import { familyProfileApplicationValue, matchingFamilyProfileFields, projectFamilyProfileApplication, replaceFamilyProfileApplicationValue, sameFamilyProfileApplicationValue, type FamilyProfileApplicationDetails } from "@/lib/parent/family-profile-application";
import type { WicApplicationFields } from "@/lib/parent/wic-application-fields";
import { boundedParentApi, ParentApiError } from "./api";
import styles from "./parent.module.css";

type Program = "snap-pa" | "wic-pa";
type Projection = ReturnType<typeof projectFamilyProfileApplication>;
type Entry = { scope: string; read: FamilyProfileRead; fields: FamilyProfileSource["fields"]; options: FamilyProfileSource["options"]; base: FamilyProfileApplicationDetails; projection: Projection };
const accountSchema = z.object({ account: z.object({ id: z.uuid().transform(value => value.toLowerCase()) }) });
const withoutOk = (value: unknown) => { const object = value && typeof value === "object" ? { ...value } : {}; delete (object as Record<string, unknown>).ok; return object; };
const sameField = (left: FamilyProfileSource["fields"][number], right: FamilyProfileSource["fields"][number]) => left.applicationPath === right.applicationPath && JSON.stringify([...left.profilePaths].sort()) === JSON.stringify([...right.profilePaths].sort());
const canReuse = (read: FamilyProfileRead) => read.collection.collectionEnabled && Date.parse(read.collection.expiresAt ?? "") > Date.now() && !!read.profile;


/** Refresh only facts already linked to this owned application; programme answers stay with its editor. */
export function useSavedFamilyProfile({ request, program, snapshotId, permitted, onOwnerChanged }: { request: SupportRequest; program: Program; snapshotId?: string; permitted: boolean; onOwnerChanged: () => void }) {
  const scope = JSON.stringify([request.id, request.version, snapshotId, permitted, request.status, request.mandate]), controller = useRef<AbortController | null>(null);
  const owner = useRef<string | null>(null), entry = useRef<Entry | null>(null), running = useRef(false), ownerChanged = useRef(onOwnerChanged);
  const [unavailable, setUnavailable] = useState<{ scope: string; paths: string[] }>({ scope: "", paths: [] });
  const [loadingScope, setLoadingScope] = useState<string | null>(null), [closed, setClosed] = useState<"owner" | "access" | null>(null), [notice, setNotice] = useState("");
  useLayoutEffect(() => { ownerChanged.current = onOwnerChanged; });
  useLayoutEffect(() => { const work = new AbortController(); controller.current = work; running.current = false; return () => work.abort(); }, [scope]);
  const checkOwner = useCallback((current: string) => {
    if (owner.current && current !== owner.current) {
      entry.current = null; setClosed("owner"); setNotice("The signed-in account changed. Reopen this request from My support before entering more answers."); ownerChanged.current();
      throw new ParentApiError("The signed-in account changed. Your previous household draft was cleared.", 412);
    }
  }, []);
  function closeAccess() {
    entry.current = null; setClosed("access"); setNotice("Private editing access could not be verified. Recheck owned access before reopening these answers."); ownerChanged.current();
  }
  useEffect(() => {
    const check = () => {
      const work = controller.current;
      if (!owner.current || !work || work.signal.aborted || running.current) return;
      void boundedParentApi("/account", {}, work.signal, new Date(Date.now() + 30_000).toISOString()).then(value => {
        if (!work.signal.aborted) checkOwner(accountSchema.parse(value).account.id);
      }).catch(() => { /* A failed identity read cannot authorize reuse; save rechecks it before any POST. */ });
    };
    const returned = (event: PageTransitionEvent) => { if (event.persisted) check(); };
    window.addEventListener("focus", check); window.addEventListener("online", check); window.addEventListener("pageshow", returned);
    return () => { window.removeEventListener("focus", check); window.removeEventListener("online", check); window.removeEventListener("pageshow", returned); };
  }, [checkOwner]);
  async function load<T extends FamilyProfileApplicationDetails>(value: T): Promise<T | null> {
    const work = controller.current;
    if (!work || work.signal.aborted || running.current || closed === "owner" || !permitted) return null;
    running.current = true; setLoadingScope(scope);
    try {
      const deadline = new Date(Date.now() + 30_000).toISOString();
      const bindings = familyProfileBindingsSchema.parse(withoutOk(await boundedParentApi(`/requests/${request.id}/family-profile-source?expectedVersion=${request.version}`, {}, work.signal, deadline)));
      work.signal.throwIfAborted();
      const fields = bindings.fields.filter(field => field.applicationPath !== "intake.zip");
      if (!fields.length) {
        const next = structuredClone(value), previous = entry.current?.scope === scope ? entry.current : null;
        for (const field of previous?.projection.fields ?? []) if (sameFamilyProfileApplicationValue(familyProfileApplicationValue(value, field.applicationPath), familyProfileApplicationValue(previous!.projection.details, field.applicationPath), field.applicationPath))
          replaceFamilyProfileApplicationValue(next, field.applicationPath, familyProfileApplicationValue(previous!.base, field.applicationPath));
        entry.current = null; setClosed(null); setUnavailable({ scope, paths: [] }); setNotice(""); return next;
      }
      const [account, response] = await Promise.all([boundedParentApi("/account", {}, work.signal, deadline), boundedParentApi("/family-profile", {}, work.signal, deadline)]);
      work.signal.throwIfAborted();
      const accountId = accountSchema.parse(account).account.id, read = familyProfileReadSchema.parse(withoutOk(response));
      checkOwner(accountId);
      owner.current ??= accountId; checkOwner(read.ownerId);
      const previous = entry.current?.scope === scope ? entry.current : null, base = previous?.base ?? structuredClone(value);
      const childIds = program === "wic-pa" ? (value as WicApplicationFields).children?.filter(child => fields.some(field => field.applicationPath.startsWith(`children.${child.id}.`))).map(child => child.id) : undefined;
      const options = childIds?.length ? { wicChildIds: childIds } : undefined;
      const projected = canReuse(read) ? projectFamilyProfileApplication(read.profile!, program, { now: new Date(), wicBeneficiaries: (value as WicApplicationFields).beneficiaries, ...options }) : { details: {}, fields: [] };
      const projection: Projection = { details: projected.details, fields: projected.fields.filter(field => fields.some(binding => sameField(field, binding))) };
      const next = structuredClone(value);
      for (const field of fields) {
        const old = previous?.projection.fields.find(candidate => sameField(field, candidate));
        const priorValue = familyProfileApplicationValue(old ? previous!.projection.details : base, field.applicationPath);
        if (previous && !sameFamilyProfileApplicationValue(familyProfileApplicationValue(value, field.applicationPath), priorValue, field.applicationPath)) continue;
        const current = projection.fields.find(candidate => sameField(field, candidate));
        replaceFamilyProfileApplicationValue(next, field.applicationPath, familyProfileApplicationValue(current ? projection.details : base, field.applicationPath));
      }
      entry.current = { scope, read, fields, options, base, projection }; setClosed(null);
      setUnavailable({ scope, paths: fields.filter(field => !projection.fields.some(current => sameField(field, current)) &&
        (canReuse(read) || !read.profile || field.profilePaths.some(path => !Object.hasOwn(read.profile!.provenance, path)))).map(field => field.applicationPath) });
      setNotice(projection.fields.length < fields.length ? "Some linked family answers are expired, cleared or unavailable. Their earlier saved values keep their original dates. Correct only affected answers; unchanged old answers cannot restart queued work." : "Current linked answers were filled from your saved family information. Your programme-specific answers stay unchanged, and reuse keeps its original dates.");
      return next;
    } catch (failure) {
      if (work.signal.aborted) return null;
      if (failure instanceof ParentApiError && [401, 403].includes(failure.status)) {
        closeAccess(); return null;
      }
      if (failure instanceof ParentApiError && failure.status === 412) return null;
      setNotice("Saved family sources could not be checked. Your existing application answers remain available with their original dates.");
      return entry.current?.scope === scope ? null : structuredClone(value);
    } finally { if (!work.signal.aborted) { running.current = false; setLoadingScope(null); } }
  }
  async function source(value: FamilyProfileApplicationDetails, signal: AbortSignal): Promise<FamilyProfileSource | undefined> {
    const saved = entry.current?.scope === scope ? entry.current : null;
    if (closed) throw new ParentApiError("Reopen this request from My support before saving.", 412);
    if (!saved) return;
    try {
      const deadline = new Date(Date.now() + 30_000).toISOString();
      const [account, response] = await Promise.all([boundedParentApi("/account", {}, signal, deadline), boundedParentApi("/family-profile", {}, signal, deadline)]);
      signal.throwIfAborted();
      const current = familyProfileReadSchema.parse(withoutOk(response));
      checkOwner(accountSchema.parse(account).account.id); checkOwner(current.ownerId);
      if (current.revision !== saved.read.revision || canReuse(current) !== canReuse(saved.read)) {
        throw new Error("changed");
      }
      if (!canReuse(current)) { if (saved.projection.fields.length) throw new Error("changed"); return; }
      const projection = projectFamilyProfileApplication(current.profile!, program, { now: new Date(), wicBeneficiaries: (value as WicApplicationFields).beneficiaries, ...saved.options });
      const fields = matchingFamilyProfileFields(value, projection).filter(field => saved.fields.some(binding => sameField(field, binding)));
      if (saved.projection.fields.some(field => sameFamilyProfileApplicationValue(familyProfileApplicationValue(value, field.applicationPath), familyProfileApplicationValue(saved.projection.details, field.applicationPath), field.applicationPath) && !fields.some(current => sameField(field, current)))) throw new Error("changed");
      return fields.length ? { expectedOwnerId: current.ownerId, revision: current.revision, fields, ...(saved.options ? { options: saved.options } : {}) } : undefined;
    } catch (failure) {
      if (failure instanceof ParentApiError && [401, 403].includes(failure.status)) closeAccess();
      if (failure instanceof ParentApiError && failure.status === 412 && closed) throw failure;
      throw new ParentApiError("Saved family information needs a fresh check. Your manual changes remain on this page; refresh linked family answers before saving.", 412);
    }
  }
  const unavailablePaths = !closed && unavailable.scope === scope ? unavailable.paths : [];
  return { loading: loadingScope === scope, blocked: !!closed, canReload: closed === "access", notice, unavailablePaths, load, source };
}

export function SavedFamilyProfileNotice({ reuse, refresh, disabled }: { reuse: Pick<ReturnType<typeof useSavedFamilyProfile>, "notice" | "loading" | "blocked" | "canReload">; refresh: () => void; disabled: boolean }) {
  const { t, locale } = useParentLocale();
  return reuse.notice ? <div lang={locale} className={styles.notice}><div><p>{t(reuse.notice)} <Link className={styles.textLink} href="/family-profile">{t("Update family information")}</Link>.</p>
    {(!reuse.blocked || reuse.canReload) && <button type="button" className={styles.secondary} disabled={disabled || reuse.loading} onClick={refresh}>{t(reuse.loading ? "Checking family answers…" : (reuse.canReload ? "Recheck private editing access" : "Refresh linked family answers"))}</button>}
  </div></div> : null;
}
