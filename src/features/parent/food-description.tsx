"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { z } from "zod";
import { getProgram } from "@/lib/parent/programs";
import { foodDescriptionInputSchema } from "@/lib/parent/food-description";
import { FOOD_DESCRIPTION_NOTICE_VERSION, foodDescriptionArchiveSchema, foodDescriptionMutationSchema, type FoodDescriptionArchive, type FoodDescriptionRoutingAnswers } from "@/lib/parent/food-description-draft";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { foodDescriptionCopy } from "@/lib/parent/food-description-copy";
import { foodDescriptionAttemptConfirmed, foodDescriptionViewSchema, readyFoodDescriptionNeeds, type FoodDescriptionProposal } from "@/lib/parent/food-description-view";
import { boundedParentApi, displayDate, ParentApiError } from "./api";
import { foodAssessmentSchema } from "@/lib/parent/food-assessment";
import { FoodAssessmentQuestions, FoodAssessmentSummary, type FoodQuestion, type FoodQuestionValues } from "./food-assessment-questions";
import { useParentLocale } from "./parent-locale";
import { ParentSignIn } from "./sign-in";
import { permissionWindowCurrent, usePermissionWindow } from "./use-permission-window";
import { useParentResource } from "./use-parent-resource";
import styles from "./parent.module.css";

type Draft = FoodDescriptionArchive["drafts"][number];
type Issue = "changed" | "invalid" | "service" | "ownerChanged" | "pendingAuth" | "cancelUnknown";
const createReply = z.object({ draftId: z.uuid(), revision: z.number().int().nonnegative() });
const chargedTerminalStates = ["result", "unknown"];
function requestDescription(path: string, init: RequestInit, signal: AbortSignal) {
  return boundedParentApi(path, init, signal, new Date(Date.now() + 30_000).toISOString());
}

export type SupportStartAnswers = { zip: string; urgent: boolean };
type SimpleStart = (answers: SupportStartAnswers) => void;

/** This component never starts a support request. Closed purpose => manual guide, with retained rights still accessible. */
export function FoodDescription({ onProposed, onManual, onReset, signInOptions, routingAnswers, onActive, onRoutingAnswer, onStart, onOtherSupport, onResumePrevious, archiveOwner }: {
  onStart?: SimpleStart;
  onOtherSupport?: (need?: string) => void;
  onResumePrevious?: () => void;
  onProposed?: (proposal: FoodDescriptionProposal) => void;
  onManual?: () => void;
  onReset?: (ownerChanged?: boolean) => void;
  archiveOwner?: string;
  onRoutingAnswer?: (field: FoodQuestion, value: string, confirmedAt: string) => void;
  routingAnswers?: FoodDescriptionRoutingAnswers;
  onActive?: (active: boolean) => void;
  signInOptions?: Pick<ComponentProps<typeof ParentSignIn>, "existingAccountRecovery" | "recoveryHref" | "emailCodeAvailable">;
}) {
  const archiveOnly = !!archiveOwner;
  const simpleStart = !!onStart;
  const { locale, t } = useParentLocale(), c = foodDescriptionCopy[locale];
  const resource = useParentResource<{ archive: unknown }>("/food-description");
  const reloadIfIdle = resource.reloadIfIdle, clearResource = resource.clear, reload = resource.reload;
  const archive = useMemo(() => { const parsed = foodDescriptionArchiveSchema.safeParse(resource.data?.archive); return parsed.success && (!archiveOwner || archiveOwner === parsed.data.ownerId) ? parsed.data : null; }, [resource.data, archiveOwner]);
  const [zip, setZip] = useState(""), [urgent, setUrgent] = useState<"yes" | "no" | "">("");
  const [available, setAvailable] = useState(false), [opened, setOpened] = useState(false), [selectedId, setSelectedId] = useState<string | null>(null);
  const [entryText, setEntryText] = useState(""), [text, setText] = useState(""), [consented, setConsented] = useState(false), [pending, setPending] = useState(false), [signIn, setSignIn] = useState(false), [editing, setEditing] = useState(false);
  const [localExpiry, setLocalExpiry] = useState(false);
  const [createUncertain, setCreateUncertain] = useState(false), [observedTerminal, setObservedTerminal] = useState<string | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null), [uncertain, setUncertain] = useState(false), [proposal, setProposal] = useState<FoodDescriptionProposal | null>(null);
  const [clarification, setClarification] = useState<FoodQuestionValues | null>(null), [changedQuestions, setChangedQuestions] = useState<FoodQuestion[]>([]);
  const [resolveAttempt, setResolveAttempt] = useState<string | null>(null), [cancelRequestedId, setCancelRequestedId] = useState<string | null>(null);
  const firstQuestion = useRef<HTMLInputElement>(null), manualGuidance = useRef<HTMLHeadingElement>(null);
  const automaticResultKey = useRef<string | null>(null);
  const owner = useRef<string | null>(null), createAttempt = useRef<string | null>(null);
  const [queueAttempt, setQueueAttempt] = useState<{ body: string; draftId: string } | null>(null);
  const resultRead = useRef<AbortController | null>(null);
  const work = useRef<AbortController | null>(null), editor = useRef<HTMLTextAreaElement>(null);
  const descriptionHeading = useRef<HTMLHeadingElement>(null);
  const visible = available || Boolean(archive?.drafts.length);
  const selected = archive?.drafts.find(draft => draft.id === selectedId) ?? null;
  const contentCurrent = usePermissionWindow(Date.parse(selected?.contentExpiresAt ?? ""));
  const hasReadyNeeds = proposal !== null && readyFoodDescriptionNeeds(proposal).length > 0;
  const readyOptions = proposal?.state === "needs_clarification" && hasReadyNeeds;
  const manualOnly = proposal?.state === "manual" && !proposal.needIds.length && !proposal.questionIds.length && !proposal.existingRequests.length
    && (proposal.outOfScope === "wic" || proposal.outOfScope === "outside_pa");
  const wic = getProgram("wic-pa");
  const contentDeadlines = archive?.drafts.filter(draft => draft.input || draft.projection || draft.selection || draft.usage.some(call => call.modelProjection || call.selection)
    || draft.id === selectedId && !["expired", "cancelled"].includes(draft.state)).map(draft => Date.parse(draft.contentExpiresAt)) ?? [];
  const writable = Boolean((selected?.state === "empty" || editing) && archive?.available && available && selected?.id !== cancelRequestedId && contentCurrent);
  useEffect(() => { if (opened && writable) editor.current?.focus(); }, [opened, writable, selected?.id]);
  useEffect(() => {
    if ((opened || simpleStart) && (signIn || opened && (simpleStart || !selectedId))) descriptionHeading.current?.focus();
  }, [opened, signIn, selectedId, simpleStart]);
  const onActiveRef = useRef(onActive); useLayoutEffect(() => { onActiveRef.current = onActive; }, [onActive]);
  useEffect(() => { onActiveRef.current?.(visible && opened && !hasReadyNeeds); }, [visible, opened, hasReadyNeeds]);
  useEffect(() => {
    if (proposal?.state === "needs_clarification" && !hasReadyNeeds) firstQuestion.current?.focus();
  }, [proposal, hasReadyNeeds]);
  useEffect(() => { if (manualOnly) manualGuidance.current?.focus(); }, [manualOnly, proposal?.source.draftId, proposal?.source.revision]);
  const onResetRef = useRef(onReset); useLayoutEffect(() => { onResetRef.current = onReset; }, [onReset]);
  useEffect(() => {
    const controller = new AbortController(); work.current = controller;
    if (!archiveOnly) boundedParentApi("/food-description/availability", {}, controller.signal, new Date(Date.now() + 30_000).toISOString())
      .then(value => { if (!controller.signal.aborted) setAvailable(z.object({ available: z.boolean() }).parse(value).available); })
      .catch(() => {});
    return () => { controller.abort(); resultRead.current?.abort(); work.current = null; };
  }, [archiveOnly]);
  const discardResultRead = useCallback(() => {
    if (resultRead.current) { resultRead.current.abort(); resultRead.current = null; setPending(false); }
    automaticResultKey.current = null;
  }, []);
  const forgetContent = useCallback((ownerChanged = false) => {
    discardResultRead();
    if (ownerChanged) { setEntryText(""); setZip(""); setUrgent(""); }
    setText(""); setProposal(null); setClarification(null); setChangedQuestions([]); setResolveAttempt(null); setUncertain(false); setEditing(false); setQueueAttempt(null); onResetRef.current?.(ownerChanged);
  }, [discardResultRead]);
  const expireContent = useCallback(() => { setLocalExpiry(true); forgetContent(); clearResource(); reload(); }, [forgetContent, clearResource, reload]);
  usePermissionWindow(Math.min(...contentDeadlines), undefined, expireContent);
  const clearLocal = useCallback((ownerChanged = true) => {
    forgetContent(ownerChanged); setLocalExpiry(false); setSelectedId(null); setConsented(false); setCreateUncertain(false); createAttempt.current = null;
  }, [forgetContent]);
  useLayoutEffect(() => {
    if (!archive) return;
    if (owner.current && archive.ownerId !== owner.current) { clearLocal(); setIssue("ownerChanged"); }
    owner.current = archive.ownerId;
  }, [archive, clearLocal]);
  useEffect(() => {
    if (!opened || (!uncertain && !["queued", "running"].includes(selected?.state ?? ""))) return;
    const refresh = () => { if (document.visibilityState === "visible") reloadIfIdle(); };
    let ticks = 0;
    const timer = setInterval(() => { refresh(); if (uncertain && ++ticks === 6) clearInterval(timer); }, 5000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [opened, selected?.state, uncertain, reloadIfIdle]);
  if (queueAttempt && foodDescriptionAttemptConfirmed(queueAttempt, archive)) {
    setQueueAttempt(null); setUncertain(false); setEditing(false); setIssue(null);
    if (onStart) { setOpened(true); setEntryText(""); setCreateUncertain(false); }
  }
  useEffect(() => { if (simpleStart && opened) createAttempt.current = null; }, [opened, simpleStart]);
  const terminal = selected && ["expired", "cancelled"].includes(selected.state) ? `${selected.id}:${selected.state}` : null;
  if (terminal && observedTerminal !== terminal) {
    setObservedTerminal(terminal); setText(""); setProposal(null); setUncertain(false); setEditing(false); setQueueAttempt(null);
  }
  useEffect(() => {
    if (terminal) onResetRef.current?.();
  }, [terminal]);
  async function call(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const controller = work.current;
    if (!controller || controller.signal.aborted) throw new Error("description_stopped");
    return requestDescription(path, init, signal ? AbortSignal.any([controller.signal, signal]) : controller.signal);
  }
  async function currentOwner(signal?: AbortSignal) {
    const value = z.object({ archive: foodDescriptionArchiveSchema }).parse(await call("/food-description", {}, signal)).archive;
    if ((archiveOwner || owner.current) && (archiveOwner || owner.current) !== value.ownerId) {
      clearLocal(); owner.current = value.ownerId; resource.reload(); throw new Error("description_owner_changed");
    }
    owner.current = value.ownerId; return value;
  }
  function report(error: unknown, cancellation = false) {
    if (work.current?.signal.aborted) return;
    if (error instanceof Error && error.message === "description_owner_changed") { setIssue("ownerChanged"); return; }
    if (error instanceof ParentApiError && error.status === 401) { setSignIn(true); setIssue("pendingAuth"); return; }
    setIssue(cancellation ? "cancelUnknown" : error instanceof z.ZodError ? "invalid" : error instanceof ParentApiError && [403, 409, 412].includes(error.status) ? "changed" : "service");
  }
  async function create() {
    if (pending || !consented || !available) return;
    setPending(true); setIssue(null);
    try {
      const value = await currentOwner();
      createAttempt.current ??= JSON.stringify({ action: "create", expectedOwnerId: value.ownerId, idempotencyKey: crypto.randomUUID(), noticeVersion: FOOD_DESCRIPTION_NOTICE_VERSION, consentAccepted: true });
      const reply = createReply.parse(await call("/food-description", { method: "POST", body: createAttempt.current }));
      const latest = await currentOwner(); const draft = latest.drafts.find(item => item.id === reply.draftId);
      if (!draft) throw new Error("description_missing");
      setLocalExpiry(false); setSelectedId(draft.id); setText(draft.input?.description ?? entryText); createAttempt.current = null; setCreateUncertain(false); resource.reload();
    } catch (error) { setCreateUncertain(Boolean(createAttempt.current)); report(error); }
    finally { setPending(false); }
  }
  async function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onStart || pending || !/^\d{5}$/.test(zip) || !urgent) return;
    if (!entryText.trim() || !available || archive?.available === false) {
      onStart({ zip, urgent: urgent === "yes" });
      onManual?.();
      return;
    }
    if (!consented) return;
    setPending(true); setIssue(null);
    let exact = queueAttempt;
    try {
      const input = foodDescriptionInputSchema.parse({ description: entryText, screenLocale: locale });
      let value = await currentOwner();
      if (exact && foodDescriptionAttemptConfirmed(exact, value)) {
        setOpened(true); setQueueAttempt(null); setUncertain(false); setEntryText("");
        createAttempt.current = null; setCreateUncertain(false); resource.reload(); return;
      }
      if (exact) {
        const prior = foodDescriptionMutationSchema.parse(JSON.parse(exact.body));
        const saved = value.drafts.find(draft => draft.id === exact?.draftId);
        if (prior.action !== "queue" || !saved || saved.revision !== prior.expectedRevision
          || ["cancelled", "expired"].includes(saved.state) || !permissionWindowCurrent(Date.parse(saved.contentExpiresAt))) {
          setQueueAttempt(null); setUncertain(false); setCreateUncertain(false);
          createAttempt.current = null; setIssue("changed"); return;
        }
      }
      if (!value.available) throw new ParentApiError("changed", 409);
      onStart({ zip, urgent: urgent === "yes" });
      if (!exact) {
        let draft = value.drafts.find(item => !["expired", "cancelled"].includes(item.state)
          && permissionWindowCurrent(Date.parse(item.contentExpiresAt)));
        if (!draft) {
          createAttempt.current ??= JSON.stringify({
            action: "create", expectedOwnerId: value.ownerId, idempotencyKey: crypto.randomUUID(),
            noticeVersion: FOOD_DESCRIPTION_NOTICE_VERSION, consentAccepted: true,
          });
          const created = createReply.parse(await call("/food-description", { method: "POST", body: createAttempt.current }));
          value = await currentOwner();
          draft = value.drafts.find(item => item.id === created.draftId);
          if (draft?.state !== "empty" || !permissionWindowCurrent(Date.parse(draft.contentExpiresAt))) throw new ParentApiError("changed", 409);
        }
        const running = draft.state === "queued" || draft.state === "running";
        const alreadyInterpreted = draft.sameChargedContext && draft.input?.description === input.description && chargedTerminalStates.includes(draft.state);
        if ((running && draft.input?.description === input.description) || alreadyInterpreted) {
          setSelectedId(draft.id);
          setOpened(true); setCreateUncertain(false); createAttempt.current = null;
          resource.reload(); return;
        }
        setSelectedId(draft.id);
        exact = { draftId: draft.id, body: JSON.stringify({ action: "queue", expectedOwnerId: value.ownerId, draftId: draft.id,
          expectedRevision: draft.revision, idempotencyKey: crypto.randomUUID(), input }) };
        setQueueAttempt(exact);
      }
      const reply = createReply.parse(await call(`/food-description?draft=${exact.draftId}`, { method: "POST", body: exact.body }));
      if (reply.draftId !== exact.draftId || reply.revision < 1) throw new Error("description_unconfirmed");
      setOpened(true); setEntryText(""); setUncertain(false); setCreateUncertain(false);
      createAttempt.current = null; resource.reload();
    } catch (error) {
      const ownerChanged = error instanceof Error && error.message === "description_owner_changed";
      const rejected = error instanceof ParentApiError && ([400, 429].includes(error.status) || !exact && error.status === 409);
      if (rejected) { setQueueAttempt(null); createAttempt.current = null; }
      setUncertain(!ownerChanged && !rejected && !!exact);
      setCreateUncertain(!ownerChanged && !rejected && !!createAttempt.current);
      report(error); resource.reloadIfIdle();
    } finally { setPending(false); }
  }
  async function send() {
    if (pending || !selected || !archive) return;
    setPending(true); setIssue(null); let exact = queueAttempt;
    try {
      const value = await currentOwner(), draft = value.drafts.find(item => item.id === selected.id);
      if (!draft || ["cancelled", "expired"].includes(draft.state)) throw new ParentApiError("changed", 409);
      if (exact && foodDescriptionAttemptConfirmed(exact, value)) { setQueueAttempt(null); setUncertain(false); setEditing(false); resource.reload(); return; }
      if (!value.available) throw new ParentApiError("changed", 409);
      if (!exact) {
        const input = foodDescriptionInputSchema.parse({ description: text, screenLocale: locale });
        if (draft.input?.description === input.description && draft.sameChargedContext && chargedTerminalStates.includes(draft.state)) throw new ParentApiError("changed", 409);
        setText(input.description);
        exact = { draftId: draft.id, body: JSON.stringify({ action: "queue", expectedOwnerId: value.ownerId, draftId: draft.id, expectedRevision: draft.revision, idempotencyKey: crypto.randomUUID(), input, ...(routingAnswers && Object.keys(routingAnswers).length ? { routingAnswers } : {}) }) };
        setQueueAttempt(exact);
      }
      await call(`/food-description?draft=${exact.draftId}`, { method: "POST", body: exact.body });
      setEntryText(""); setUncertain(false); setEditing(false); resource.reload();
    } catch (error) {
      const rejected = error instanceof z.ZodError || error instanceof Error && error.message === "description_owner_changed"
        || error instanceof ParentApiError && error.status >= 400 && error.status < 500 && ![401, 403, 409].includes(error.status);
      if (rejected) setQueueAttempt(null);
      setUncertain(!rejected && Boolean(exact)); report(error); resource.reloadIfIdle();
    }
    finally { setPending(false); }
  }
  async function check() {
    if (pending) return;
    if (selected?.state === "result") { await readResult(); return; }
    setPending(true); setIssue(null);
    try { await currentOwner(); resource.reload(); }
    catch (error) { report(error); }
    finally { setPending(false); }
  }
  async function cancel() {
    if (pending || !selected) return; setPending(true); setIssue(null); setCancelRequestedId(selected.id); forgetContent();
    try {
      const value = await currentOwner();
      await call("/food-description", { method: "DELETE", body: JSON.stringify({ action: "cancel", expectedOwnerId: value.ownerId, draftId: selected.id }) }); clearResource(); reload();
    } catch (error) { report(error, true); }
    finally { setPending(false); }
  }
  async function readResult() {
    if (pending || !selected) return; setPending(true); setIssue(null);
    const controller = new AbortController(); resultRead.current = controller;
    try {
      const value = await currentOwner(controller.signal); controller.signal.throwIfAborted();
      const currentDraft = value.drafts.find(draft => draft.id === selected.id);
      if (!currentDraft || currentDraft.state !== "result" || !permissionWindowCurrent(Date.parse(currentDraft.contentExpiresAt)) || currentDraft.revision < selected.revision) {
        resource.reload(); throw new ParentApiError("changed", 409);
      }
      if (currentDraft.revision !== selected.revision) { resource.reload(); return; }
      const parsed = z.object({ result: foodDescriptionViewSchema }).parse(await call(`/food-description?draft=${selected.id}&revision=${selected.revision}`, {}, controller.signal));
      controller.signal.throwIfAborted();
      const next = { ...parsed.result, source: { draftId: selected.id, revision: selected.revision } }; showProposal(next);
    } catch (error) { if (!controller.signal.aborted) report(error); }
    finally { if (resultRead.current === controller) { resultRead.current = null; setPending(false); } }
  }
  const readAutomaticResult = useEffectEvent(() => { void readResult(); });
  useEffect(() => {
    if (archiveOnly || !opened || editing || pending || signIn || !contentCurrent || selected?.state !== "result" || selected.id === cancelRequestedId) return;
    const key = `${selected.id}:${selected.revision}`;
    if (automaticResultKey.current === key) return;
    automaticResultKey.current = key; readAutomaticResult();
  }, [opened, editing, pending, signIn, selected?.id, selected?.revision, selected?.state, cancelRequestedId, contentCurrent, archiveOnly]);
  function showProposal(next: FoodDescriptionProposal) {
    const deadline = archive?.drafts.find(draft => draft.id === next.source.draftId)?.contentExpiresAt;
    if (!permissionWindowCurrent(Date.parse(deadline ?? ""))) throw new ParentApiError("changed", 409);
    setProposal(next); setChangedQuestions([]); setResolveAttempt(null);
    setClarification({ ...next.proposedAnswers, ...Object.fromEntries(next.questionIds.map(id => [id, id === "existingIssue" ? null : ""])) });
    const needs = readyFoodDescriptionNeeds(next);
    if (needs.length) onProposed?.({ ...next, needIds: needs });
  }
  async function resolve() {
    if (pending || !proposal || !clarification || !archive) return;
    setPending(true); setIssue(null);
    const controller = new AbortController(); resultRead.current = controller;
    try {
      const value = await currentOwner(controller.signal); controller.signal.throwIfAborted();
      const body = resolveAttempt ?? JSON.stringify({ action: "resolve", expectedOwnerId: value.ownerId, draftId: proposal.source.draftId,
        expectedRevision: proposal.source.revision, idempotencyKey: crypto.randomUUID(), answers: foodAssessmentSchema.parse(clarification), changedQuestionIds: changedQuestions });
      setResolveAttempt(body);
      const reply = createReply.parse(await call(`/food-description?draft=${proposal.source.draftId}`, { method: "PATCH", body }, controller.signal));
      const parsed = z.object({ result: foodDescriptionViewSchema }).parse(await call(`/food-description?draft=${reply.draftId}&revision=${reply.revision}`, {}, controller.signal));
      controller.signal.throwIfAborted();
      showProposal({ ...parsed.result, source: { draftId: reply.draftId, revision: reply.revision } }); resource.reload();
    } catch (error) { if (!controller.signal.aborted) report(error); }
    finally { if (resultRead.current === controller) { resultRead.current = null; setPending(false); } }
  }
  function openDraft(draft: Draft, initialText = "") {
    discardResultRead();
    setOpened(true); setLocalExpiry(!permissionWindowCurrent(Date.parse(draft.contentExpiresAt))); setCancelRequestedId(null); setClarification(null); setResolveAttempt(null); setSelectedId(draft.id); setText(draft.input?.description ?? initialText); setIssue(null); setProposal(null); setUncertain(false); setEditing(false); setQueueAttempt(null);
  }
  function openCurrentOrNew() {
    if (pending) return;
    const current = archive?.drafts.find(draft => !["cancelled", "expired"].includes(draft.state) && permissionWindowCurrent(Date.parse(draft.contentExpiresAt)));
    if (current) {
      openDraft(current, entryText);
      if (current.input && entryText.trim() && ["result", "failed", "unknown"].includes(current.state) && archive?.available) {
        setText(entryText);
        setEditing(true);
      }
      return;
    }
    clearLocal(false); setIssue(null); setOpened(true); if (!archive) setSignIn(true);
  }
  if (archiveOnly) {
    if (resource.loading) return <p role="status">{t("Loading saved descriptions…")}</p>;
    if (!archive) return <div className={styles.stack}><p role="alert">{t("We couldn’t load your saved descriptions.")}</p>
      <button type="button" className={styles.secondary} onClick={reload}>{t("Try again")}</button></div>;
    if (!archive.drafts.length) return <p>{t("No saved descriptions.")}</p>;
    return <div lang={locale} className={styles.stack}>
        <a className={styles.textLink} href="/api/parent/food-description?download=1">{c.download}</a>
        {archive.drafts.map(draft => <p key={draft.id}>
          {displayDate(draft.createdAt, true, locale)}{" "}
          {draft.id !== selectedId && !["cancelled", "expired"].includes(draft.state) && <button className={styles.quiet} type="button" onClick={() => openDraft(draft)} disabled={pending}>{t("Review description")}</button>}
        </p>)}
        {selected && !["cancelled", "expired"].includes(selected.state) && <>
          {contentCurrent && selected.input && cancelRequestedId !== selected.id && <p lang={selected.input.screenLocale}>{selected.input.description}</p>}
          <button type="button" className={styles.secondary} onClick={() => void cancel()} disabled={pending}>{t("Clear description")}</button>
        </>}
        {issue && <p role="alert">{c[issue]}</p>}
        {selected?.state === "cancelled" && <p role="status">{c.cancelled}</p>}
    </div>;
  }
  if (onResumePrevious) {
    const canResume = (draft: Draft) => !!draft.input && !["cancelled", "expired"].includes(draft.state)
      && permissionWindowCurrent(Date.parse(draft.contentExpiresAt));
    if (!archive?.drafts.some(canResume) && !issue) return null;
    return <div className={styles.stack}>
      {issue && <p role="alert">{t("We couldn’t check your options. You can try again.")}</p>}
      {issue !== "changed" && <button className={styles.quiet} type="button" disabled={pending} onClick={async () => {
        setPending(true); setIssue(null);
        try {
          const current = (await currentOwner()).drafts.find(canResume);
          if (!current) throw new ParentApiError("changed", 409);
          const parsed = current.state === "result" ? z.object({ result: foodDescriptionViewSchema }).parse(
            await call(`/food-description?draft=${current.id}&revision=${current.revision}`)
          ) : null;
          openDraft(current);
          if (parsed) {
            automaticResultKey.current = `${current.id}:${current.revision}`;
            showProposal({ ...parsed.result, source: { draftId: current.id, revision: current.revision } });
          }
          onResumePrevious();
        } catch (error) { report(error); }
        finally { setPending(false); }
      }}>{t("Check my earlier description")}</button>}
    </div>;
  }
  if (!visible && !onStart) return null;
  const showStart = onStart && !opened && !signIn;
  if (showStart) {
    const canDescribe = available && archive?.available !== false;
    const locked = createUncertain || uncertain;
    return <div lang={locale} className={styles.simpleStart}>
      <form className={styles.form} onSubmit={submitStart}>
        <fieldset className={styles.foodChoices} disabled={pending || locked}>
          <legend>{t("Do you need help today?")}</legend>
          <div className={styles.foodChoiceOptions}>
            {(["yes", "no"] as const).map(value => <label key={value} className={styles.foodChoiceOption}>
              <input type="radio" name="start-urgency" required checked={urgent === value} onChange={() => setUrgent(value)} />
              <span>{value === "yes" ? foodAssessmentCopy[locale].yes : foodAssessmentCopy[locale].no}</span>
            </label>)}
          </div>
        </fieldset>
        <div className={styles.field}>
          <label htmlFor="start-zip">{t("ZIP code")}</label>
          <input id="start-zip" className={styles.input} autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{5}" title={t("Enter a five-digit ZIP code")} maxLength={5} value={zip} onChange={event => setZip(event.target.value)} required disabled={pending || locked} />
        </div>
        {canDescribe && <div className={styles.field}>
          <label htmlFor="food-description-entry">{t("Tell us what you need (optional)")}</label>
          <textarea id="food-description-entry" className={styles.textarea} value={entryText} onChange={event => {
            setEntryText(event.target.value); setIssue(null);
          }} maxLength={500} placeholder={c.entryExample} aria-describedby="start-description-hint" autoComplete="off" spellCheck={false} disabled={pending || locked} />
          <p id="start-description-hint" className={styles.hint}>{t("Leave out names, addresses, account numbers, and documents.")}</p>
        </div>}
        {canDescribe && !!entryText.trim() && <div>
          <label className={styles.checkbox}><input type="checkbox" required checked={consented} onChange={event => setConsented(event.target.checked)} disabled={pending || locked} /><span>{t("I agree to let CaseLink use OpenAI to suggest food or SNAP support from my description.")}</span></label>
          <details className={styles.startPrivacy}><summary>{t("How we use your description")}</summary>
            {c.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            <Link className={styles.textLink} href="/support/privacy#data-policy">{c.privacy}</Link>
          </details>
        </div>}
        {issue && <p role={issue === "pendingAuth" ? "status" : "alert"}>{t({
          pendingAuth: "You’re signed in. Select Find support to send your description.",
          ownerChanged: "Your sign-in changed. Enter your information again.",
          invalid: "Keep it under 500 characters and leave out private information.",
          changed: "We couldn’t confirm your submission. Check it again.",
          service: "We couldn’t check your options. You can try again.",
          cancelUnknown: "We couldn’t confirm that the description was cleared.",
        }[issue])}</p>}
        <button className={styles.button} disabled={pending}>{pending ? t("Finding support…") : locked ? t("Check my submission") : t("Find support")}</button>
        {!!entryText.trim() && !pending && issue && /^\d{5}$/.test(zip) && urgent &&
          <button type="button" className={styles.quiet} onClick={() => {
            setEntryText(""); setIssue(null); setQueueAttempt(null); setUncertain(false);
            setCreateUncertain(false); createAttempt.current = null;
            onStart({ zip, urgent: urgent === "yes" }); onManual?.();
          }}>{t("Continue without a description")}</button>}
      </form>
      <Link className={styles.textLink} href="/support/help#urgent">{t("Find urgent food or utility help")}</Link>
    </div>;
  }
  return <section lang={locale} aria-labelledby="food-description-title" className={onStart ? styles.startFollowUp : `${styles.surface} ${styles.foodDescription}`}>
    <h2 id="food-description-title" ref={descriptionHeading} tabIndex={-1}>{onStart ? t("Your description") : c.title}</h2>
    {!onStart && (opened || !available) && <p>{c.intro}</p>}
    {!onStart && !opened && available && archive?.available !== false && <div className={styles.form}>
      <label className="sr-only" htmlFor="food-description-entry">{c.entryLabel}</label>
      <textarea id="food-description-entry" className={styles.textarea} value={entryText}
        onChange={event => setEntryText(event.target.value)} maxLength={500}
        placeholder={c.entryExample} aria-describedby="food-description-entry-hint"
        autoComplete="off" spellCheck={false} />
      <p id="food-description-entry-hint" className={styles.hint}>{c.entryHint}</p>
      <button type="button" className={styles.secondary} disabled={pending} onClick={openCurrentOrNew}>{archive ? c.create : c.signIn}</button>
    </div>}
    {(opened || onStart) && signIn ? <><p role="status">{c.pendingAuth}</p><ParentSignIn {...signInOptions} onSignedIn={async () => {
      try { await currentOwner(); }
      catch (error) { if (!(error instanceof Error) || error.message !== "description_owner_changed") throw error; setIssue("ownerChanged"); }
      automaticResultKey.current = null; setSignIn(false); resource.reload();
    }}/></> : opened && <>
      {localExpiry && <p role="status">{c.expired}</p>}
      {issue && <p role="alert">{c[issue]}</p>}
      {!onStart && !selected && available && <><details><summary>{c.notice}</summary>{c.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}<p><Link href="/support/privacy#data-policy">{c.privacy}</Link>{" · "}<Link href="/support/help">{c.help}</Link></p></details>
        <label className={styles.checkbox}><input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)} disabled={pending}/><span>{c.consent}</span></label>
        <p className={styles.hint}>{c.limit}</p><button type="button" className={styles.button} disabled={pending || !consented || !archive?.available} onClick={() => void create()}>{createUncertain ? c.createRetry : c.create}</button></>}
      {selected && <>{!onStart && <p>{c.contentDeadline}: {displayDate(selected.contentExpiresAt, true, locale)}<br/>{c.metadataDeadline}: {displayDate(selected.metadataExpiresAt, true, locale)}</p>}
        {!onStart && writable && <><label className={styles.label} htmlFor="food-description-text">{c.label}</label><textarea id="food-description-text" ref={editor} className={styles.textarea} maxLength={500} value={text} onChange={event => setText(event.target.value)} disabled={pending || uncertain} aria-describedby="food-description-hint"/><p id="food-description-hint" className={styles.hint}>{c.hint}</p>
          <button type="button" className={styles.button} disabled={pending || !text.trim()} onClick={() => void send()}>{pending ? c.sending : uncertain ? c.retry : c.send}</button></>}
        {!writable && contentCurrent && text && !selected.input && cancelRequestedId !== selected.id && <p>{text}</p>}
        {!onStart && !editing && contentCurrent && selected.input && cancelRequestedId !== selected.id && <p lang={selected.input.screenLocale}>{selected.input.description}</p>}
        {!onStart && !editing && contentCurrent && cancelRequestedId !== selected.id && archive?.available && ["result", "failed", "unknown"].includes(selected.state) && <button type="button" className={styles.secondary} disabled={pending} onClick={() => { setText(selected.input?.description ?? ""); setEditing(true); setProposal(null); setQueueAttempt(null); setUncertain(false); onResetRef.current?.(); }}>{c.edit}</button>}
        <p role="status">{uncertain ? c.unknown : selected.state === "empty" ? c.empty : ["queued", "running"].includes(selected.state) ? onStart ? t("We’re checking your options.") : c.waiting : selected.state === "expired" ? c.expired : selected.state === "cancelled" ? c.cancelled : selected.state === "result" ? "" : c.failed}</p>
        {!onStart && ["expired", "cancelled"].includes(selected.state) && available && archive?.available && <button type="button" className={styles.button} onClick={openCurrentOrNew} disabled={pending}>{c.newDraft}</button>}
        {contentCurrent && (proposal?.state === "proposal" || readyOptions) && <button type="button" className={styles.secondary} disabled={pending} onClick={() => {
          setClarification(proposal.proposedAnswers); setChangedQuestions([]); setResolveAttempt(null); setProposal({ ...proposal, state: "needs_clarification", questionIds: ["foodForTwoDays", "benefitHistory", ...(proposal.proposedAnswers.benefitHistory === "receiving" ? ["existingIssue" as const] : [])] }); onResetRef.current?.();
        }}>{c.changeAnswers}</button>}
        {contentCurrent && !!proposal?.conflicts.length && <p role="status">{c.conflict}</p>}
        {contentCurrent && proposal?.state === "manual" && !manualOnly && <p>{c.manualResult}</p>}
        {contentCurrent && proposal?.outOfScope === "wic" && <section className={styles.space} aria-labelledby="food-description-wic-title">
          <h3 id="food-description-wic-title" ref={manualGuidance} tabIndex={-1}>{c.wicTitle}</h3><p>{c.wicIntro}</p><p className={styles.hint}>{c.wicLimit}</p>
          <div className={styles.serviceLinks}>
            {onOtherSupport ? <>
              <button className={styles.quiet} type="button" onClick={() => onOtherSupport("wic_new")}>{t("Apply for WIC")}</button>
              <button className={styles.quiet} type="button" onClick={() => onOtherSupport("wic_continuing")}>{t("Continue WIC support")}</button>
            </> : <>
              <Link className={styles.textLink} href="/get-support?need=wic_new">{t("Apply for WIC")}</Link>
              <Link className={styles.textLink} href="/get-support?need=wic_continuing">{t("Continue WIC support")}</Link>
            </>}
            {wic && <a className={styles.textLink} href={wic.officialUrl}>{c.wicOfficial}</a>}
          </div>
        </section>}
        {contentCurrent && proposal?.outOfScope === "outside_pa" && <section className={styles.space} aria-labelledby="food-description-outside-title">
          <h3 id="food-description-outside-title" ref={manualGuidance} tabIndex={-1}>{c.outsideTitle}</h3><p>{c.outsideIntro}</p>
          <a className={styles.textLink} href="https://www.feedingamerica.org/need-help-find-food">{t("Find a food bank outside this area")}</a>
        </section>}
        {contentCurrent && readyOptions && <p className={styles.hint}>{c.readyOptions}</p>}
        {!onStart && contentCurrent && proposal && !manualOnly && <FoodAssessmentSummary answers={proposal.proposedAnswers}/>}
        {contentCurrent && proposal?.state === "needs_clarification" && clarification && <form className={styles.form} onSubmit={event => { event.preventDefault(); void resolve(); }}>
          <p>{onStart ? t("A few details will help us narrow down your options.") : c.clarify}</p><fieldset disabled={pending || !!resolveAttempt} className={styles.fieldset}>
            <FoodAssessmentQuestions answers={clarification} questionIds={proposal.questionIds} firstAnswer={firstQuestion} onChange={(field, value) => {
              onRoutingAnswer?.(field, value, new Date().toISOString());
              setClarification(current => current && ({ ...current, [field]: value, ...(field === "benefitHistory" ? { existingIssue: null } : {}) }));
              setChangedQuestions(current => [...new Set([...current, field])]);
            }}/>
          </fieldset><button className={styles.button} disabled={pending}>{resolveAttempt ? c.resolveRetry : c.resolve}</button>
        </form>}
        {contentCurrent && !!proposal?.existingRequests.length && <div><h3>{c.openExisting}</h3><p>{c.existingScope}</p>{proposal.existingRequests.map(request => <p key={request.requestId}><Link className={styles.textLink} href={`/support/${request.requestId}`}>{c.viewExisting}</Link>{" · "}{request.needIds.map(need => foodAssessmentCopy[locale].titles[need]).join(" / ")}</p>)}</div>}
        {onOtherSupport && proposal?.outOfScope === "utilities" && <button className={styles.secondary} type="button" onClick={() => onOtherSupport()}>{t("See utility assistance options")}</button>}
        <div className={onStart ? styles.inline : styles.form}>{(!onStart || !proposal) && <button type="button" className={styles.secondary} onClick={() => void check()} disabled={pending}>{onStart ? t("Check for an update") : c.check}</button>}{!["cancelled", "expired"].includes(selected.state) && <button type="button" className={onStart ? styles.quiet : styles.secondary} onClick={() => void cancel()} disabled={pending}>{onStart ? t("Clear description") : c.cancel}</button>}</div>
      </>}

    </>}
    {opened && <button type="button" className={styles.secondary} disabled={!!onStart && pending} onClick={() => { discardResultRead();
      if (!pending && selected?.state === "empty" && contentCurrent && !cancelRequestedId) setEntryText(text);
      setOpened(false); setProposal(null); setClarification(null); setResolveAttempt(null); onResetRef.current?.(); onManual?.(); }}>{onStart ? t("See other support options") : c.manual}</button>}
    {!onStart && !!archive?.drafts.length && <details className={styles.space}><summary>{c.history}</summary><a className={styles.textLink} href="/api/parent/food-description?download=1">{c.download}</a>{archive.drafts.map(draft => <p key={draft.id}><button type="button" className={styles.secondary} onClick={() => openDraft(draft)} disabled={pending}>{c.resume} · {displayDate(draft.createdAt, true, locale)}</button></p>)}</details>}
  </section>;
}
