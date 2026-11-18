"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { z } from "zod";
import { foodDescriptionInputSchema } from "@/lib/parent/food-description";
import { FOOD_DESCRIPTION_NOTICE_VERSION, foodDescriptionArchiveSchema, type FoodDescriptionArchive, type FoodDescriptionRoutingAnswers } from "@/lib/parent/food-description-draft";
import { foodAssessmentCopy } from "@/lib/parent/food-assessment-copy";
import { foodDescriptionCopy } from "@/lib/parent/food-description-copy";
import { foodDescriptionAttemptConfirmed, foodDescriptionViewSchema, type FoodDescriptionProposal } from "@/lib/parent/food-description-view";
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

/** This component never starts a support request. Closed purpose => manual guide, with retained rights still accessible. */
export function FoodDescription({ onProposed, onManual, onReset, signInOptions, routingAnswers, onActive, onRoutingAnswer }: {
  onProposed: (proposal: FoodDescriptionProposal) => void;
  onManual: () => void;
  onReset: (ownerChanged?: boolean) => void;
  onRoutingAnswer?: (field: FoodQuestion, value: string, confirmedAt: string) => void;
  routingAnswers?: FoodDescriptionRoutingAnswers;
  onActive?: (active: boolean) => void;
  signInOptions?: Pick<ComponentProps<typeof ParentSignIn>, "existingAccountRecovery" | "recoveryHref" | "emailCodeAvailable">;
}) {
  const { locale } = useParentLocale(), c = foodDescriptionCopy[locale];
  const resource = useParentResource<{ archive: unknown }>("/food-description");
  const reloadIfIdle = resource.reloadIfIdle, clearResource = resource.clear, reload = resource.reload;
  const archive = useMemo(() => { const parsed = foodDescriptionArchiveSchema.safeParse(resource.data?.archive); return parsed.success ? parsed.data : null; }, [resource.data]);
  const [available, setAvailable] = useState(false), [opened, setOpened] = useState(false), [selectedId, setSelectedId] = useState<string | null>(null);
  const [text, setText] = useState(""), [consented, setConsented] = useState(false), [pending, setPending] = useState(false), [signIn, setSignIn] = useState(false), [editing, setEditing] = useState(false);
  const [localExpiry, setLocalExpiry] = useState(false);
  const [createUncertain, setCreateUncertain] = useState(false), [observedTerminal, setObservedTerminal] = useState<string | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null), [uncertain, setUncertain] = useState(false), [proposal, setProposal] = useState<FoodDescriptionProposal | null>(null);
  const [clarification, setClarification] = useState<FoodQuestionValues | null>(null), [changedQuestions, setChangedQuestions] = useState<FoodQuestion[]>([]);
  const [resolveAttempt, setResolveAttempt] = useState<string | null>(null), [cancelRequestedId, setCancelRequestedId] = useState<string | null>(null);
  const firstQuestion = useRef<HTMLSelectElement>(null);
  const automaticResultKey = useRef<string | null>(null);
  const owner = useRef<string | null>(null), createAttempt = useRef<string | null>(null);
  const [queueAttempt, setQueueAttempt] = useState<{ body: string; draftId: string } | null>(null);
  const resultRead = useRef<AbortController | null>(null);
  const work = useRef<AbortController | null>(null), editor = useRef<HTMLTextAreaElement>(null);
  const visible = available || Boolean(archive?.drafts.length);
  const selected = archive?.drafts.find(draft => draft.id === selectedId) ?? null;
  const contentCurrent = usePermissionWindow(Date.parse(selected?.contentExpiresAt ?? ""));
  const contentDeadlines = archive?.drafts.filter(draft => draft.input || draft.projection || draft.selection || draft.usage.some(call => call.modelProjection || call.selection)
    || draft.id === selectedId && !["expired", "cancelled"].includes(draft.state)).map(draft => Date.parse(draft.contentExpiresAt)) ?? [];
  const writable = Boolean((selected?.state === "empty" || editing) && archive?.available && available && selected?.id !== cancelRequestedId && contentCurrent);
  useEffect(() => { if (opened && writable) editor.current?.focus(); }, [opened, writable, selected?.id]);
  const onActiveRef = useRef(onActive); useLayoutEffect(() => { onActiveRef.current = onActive; }, [onActive]);
  useEffect(() => { onActiveRef.current?.(visible && opened && proposal?.state !== "proposal"); }, [visible, opened, proposal?.state]);
  useEffect(() => { if (proposal?.state === "needs_clarification") firstQuestion.current?.focus(); }, [proposal]);
  const onResetRef = useRef(onReset); useLayoutEffect(() => { onResetRef.current = onReset; }, [onReset]);
  useEffect(() => {
    const controller = new AbortController(); work.current = controller;
    boundedParentApi("/food-description/availability", {}, controller.signal, new Date(Date.now() + 30_000).toISOString())
      .then(value => { if (!controller.signal.aborted) setAvailable(z.object({ available: z.boolean() }).parse(value).available); })
      .catch(() => {});
    return () => { controller.abort(); resultRead.current?.abort(); work.current = null; };
  }, []);
  const discardResultRead = useCallback(() => {
    if (resultRead.current) { resultRead.current.abort(); resultRead.current = null; setPending(false); }
    automaticResultKey.current = null;
  }, []);
  const forgetContent = useCallback((ownerChanged = false) => {
    discardResultRead();
    setText(""); setProposal(null); setClarification(null); setChangedQuestions([]); setResolveAttempt(null); setUncertain(false); setEditing(false); setQueueAttempt(null); onResetRef.current(ownerChanged);
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
  }
  const terminal = selected && ["expired", "cancelled"].includes(selected.state) ? `${selected.id}:${selected.state}` : null;
  if (terminal && observedTerminal !== terminal) {
    setObservedTerminal(terminal); setText(""); setProposal(null); setUncertain(false); setEditing(false); setQueueAttempt(null);
  }
  useEffect(() => {
    if (terminal) onResetRef.current();
  }, [terminal]);
  async function call(path: string, init: RequestInit = {}, signal?: AbortSignal) {
    const controller = work.current;
    if (!controller || controller.signal.aborted) throw new Error("description_stopped");
    return requestDescription(path, init, signal ? AbortSignal.any([controller.signal, signal]) : controller.signal);
  }
  async function currentOwner(signal?: AbortSignal) {
    const value = z.object({ archive: foodDescriptionArchiveSchema }).parse(await call("/food-description", {}, signal)).archive;
    if (owner.current && owner.current !== value.ownerId) {
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
      setLocalExpiry(false); setSelectedId(draft.id); setText(draft.input?.description ?? ""); createAttempt.current = null; setCreateUncertain(false); resource.reload();
    } catch (error) { setCreateUncertain(Boolean(createAttempt.current)); report(error); }
    finally { setPending(false); }
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
      setUncertain(false); setEditing(false); resource.reload();
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
    if (!opened || editing || pending || signIn || !contentCurrent || selected?.state !== "result" || selected.id === cancelRequestedId) return;
    const key = `${selected.id}:${selected.revision}`;
    if (automaticResultKey.current === key) return;
    automaticResultKey.current = key; readAutomaticResult();
  }, [opened, editing, pending, signIn, selected?.id, selected?.revision, selected?.state, cancelRequestedId, contentCurrent]);
  function showProposal(next: FoodDescriptionProposal) {
    const deadline = archive?.drafts.find(draft => draft.id === next.source.draftId)?.contentExpiresAt;
    if (!permissionWindowCurrent(Date.parse(deadline ?? ""))) throw new ParentApiError("changed", 409);
    setProposal(next); setChangedQuestions([]); setResolveAttempt(null);
    setClarification({ ...next.proposedAnswers, ...Object.fromEntries(next.questionIds.map(id => [id, id === "existingIssue" ? null : ""])) });
    if (next.state === "proposal") onProposed(next);
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
  function openDraft(draft: Draft) {
    discardResultRead();
    setOpened(true); setLocalExpiry(!permissionWindowCurrent(Date.parse(draft.contentExpiresAt))); setCancelRequestedId(null); setClarification(null); setResolveAttempt(null); setSelectedId(draft.id); setText(draft.input?.description ?? ""); setIssue(null); setProposal(null); setUncertain(false); setEditing(false); setQueueAttempt(null);
  }
  function openCurrentOrNew() {
    const current = archive?.drafts.find(draft => !["cancelled", "expired"].includes(draft.state) && permissionWindowCurrent(Date.parse(draft.contentExpiresAt)));
    if (current) { openDraft(current); return; }
    clearLocal(false); setIssue(null); setOpened(true); if (!archive) setSignIn(true);
  }
  if (!visible) return null;
  return <section lang={locale} aria-labelledby="food-description-title" className={`${styles.surface} ${styles.foodDescription}`}>
    <h2 id="food-description-title">{c.title}</h2><p>{c.intro}</p>
    {!opened && available && <button type="button" className={styles.secondary} onClick={openCurrentOrNew}>{archive ? c.create : c.signIn}</button>}
    {opened && signIn ? <><p role="status">{c.pendingAuth}</p><ParentSignIn {...signInOptions} onSignedIn={async () => {
      try { await currentOwner(); }
      catch (error) { if (!(error instanceof Error) || error.message !== "description_owner_changed") throw error; setIssue("ownerChanged"); }
      automaticResultKey.current = null; setSignIn(false); resource.reload();
    }}/></> : opened && <>
      {localExpiry && <p role="status">{c.expired}</p>}
      {issue && <p role="alert">{c[issue]}</p>}
      {!selected && available && <><details><summary>{c.notice}</summary>{c.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}<p><Link href="/support/privacy#data-policy">{c.privacy}</Link>{" · "}<Link href="/support/help">{c.help}</Link></p></details>
        <label className={styles.checkbox}><input type="checkbox" checked={consented} onChange={event => setConsented(event.target.checked)} disabled={pending}/><span>{c.consent}</span></label>
        <p className={styles.hint}>{c.limit}</p><button type="button" className={styles.button} disabled={pending || !consented || !archive?.available} onClick={() => void create()}>{createUncertain ? c.createRetry : c.create}</button></>}
      {selected && <><p>{c.contentDeadline}: {displayDate(selected.contentExpiresAt, true, locale)}<br/>{c.metadataDeadline}: {displayDate(selected.metadataExpiresAt, true, locale)}</p>
        {writable && <><label className={styles.label} htmlFor="food-description-text">{c.label}</label><textarea id="food-description-text" ref={editor} className={styles.textarea} maxLength={500} value={text} onChange={event => setText(event.target.value)} disabled={pending || uncertain} aria-describedby="food-description-hint"/><p id="food-description-hint" className={styles.hint}>{c.hint}</p>
          <button type="button" className={styles.button} disabled={pending || !text.trim()} onClick={() => void send()}>{pending ? c.sending : uncertain ? c.retry : c.send}</button></>}
        {!writable && contentCurrent && text && !selected.input && cancelRequestedId !== selected.id && <p>{text}</p>}
        {!editing && contentCurrent && selected.input && cancelRequestedId !== selected.id && <p lang={selected.input.screenLocale}>{selected.input.description}</p>}
        {!editing && contentCurrent && cancelRequestedId !== selected.id && archive?.available && ["result", "failed", "unknown"].includes(selected.state) && <button type="button" className={styles.secondary} disabled={pending} onClick={() => { setText(selected.input?.description ?? ""); setEditing(true); setProposal(null); setQueueAttempt(null); setUncertain(false); onResetRef.current(); }}>{c.edit}</button>}
        <p role="status">{uncertain ? c.unknown : selected.state === "empty" ? c.empty : ["queued", "running"].includes(selected.state) ? c.waiting : selected.state === "expired" ? c.expired : selected.state === "cancelled" ? c.cancelled : selected.state === "result" ? "" : c.failed}</p>
        {["expired", "cancelled"].includes(selected.state) && available && archive?.available && <button type="button" className={styles.button} onClick={openCurrentOrNew} disabled={pending}>{c.newDraft}</button>}
        {contentCurrent && proposal?.state === "proposal" && <button type="button" className={styles.secondary} disabled={pending} onClick={() => {
          setClarification(proposal.proposedAnswers); setChangedQuestions([]); setResolveAttempt(null); setProposal({ ...proposal, state: "needs_clarification", questionIds: ["foodForTwoDays", "benefitHistory", ...(proposal.proposedAnswers.benefitHistory === "receiving" ? ["existingIssue" as const] : [])] }); onResetRef.current();
        }}>{c.changeAnswers}</button>}
        {contentCurrent && !!proposal?.conflicts.length && <p role="status">{c.conflict}</p>}
        {contentCurrent && proposal?.state === "manual" && <p>{c.manualResult}</p>}
        {contentCurrent && proposal && <FoodAssessmentSummary answers={proposal.proposedAnswers}/>}
        {contentCurrent && proposal?.state === "needs_clarification" && clarification && <form className={styles.form} onSubmit={event => { event.preventDefault(); void resolve(); }}>
          <p>{c.clarify}</p><fieldset disabled={pending || !!resolveAttempt} className={styles.fieldset}>
            <FoodAssessmentQuestions answers={clarification} questionIds={proposal.questionIds} firstAnswer={firstQuestion} onChange={(field, value) => {
              onRoutingAnswer?.(field, value, new Date().toISOString());
              setClarification(current => current && ({ ...current, [field]: value, ...(field === "benefitHistory" ? { existingIssue: null } : {}) }));
              setChangedQuestions(current => [...new Set([...current, field])]);
            }}/>
          </fieldset><button className={styles.button} disabled={pending}>{resolveAttempt ? c.resolveRetry : c.resolve}</button>
        </form>}
        {contentCurrent && !!proposal?.existingRequests.length && <div><h3>{c.openExisting}</h3><p>{c.existingScope}</p>{proposal.existingRequests.map(request => <p key={request.requestId}><Link className={styles.textLink} href={`/support/${request.requestId}`}>{c.viewExisting}</Link>{" · "}{request.needIds.map(need => foodAssessmentCopy[locale].titles[need]).join(" / ")}</p>)}</div>}
        <div className={styles.form}><button type="button" className={styles.secondary} onClick={() => void check()} disabled={pending}>{c.check}</button>{!["cancelled", "expired"].includes(selected.state) && <button type="button" className={styles.secondary} onClick={() => void cancel()} disabled={pending}>{c.cancel}</button>}</div>
      </>}

    </>}
    {opened && <button type="button" className={styles.secondary} onClick={() => { discardResultRead(); setOpened(false); setProposal(null); setClarification(null); setResolveAttempt(null); onResetRef.current(); onManual(); }}>{c.manual}</button>}
    {!!archive?.drafts.length && <details className={styles.space}><summary>{c.history}</summary><a className={styles.textLink} href="/api/parent/food-description?download=1">{c.download}</a>{archive.drafts.map(draft => <p key={draft.id}><button type="button" className={styles.secondary} onClick={() => openDraft(draft)} disabled={pending}>{c.resume} · {displayDate(draft.createdAt, true, locale)}</button></p>)}</details>}
  </section>;
}
