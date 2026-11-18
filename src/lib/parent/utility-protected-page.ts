import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { utilityProtectedWorkspaceSchema, type UtilityProtectedWorkspace } from "./utility-protected-input-contract";

const tokens = readFileSync(resolve("tokens.css"), "utf8");
const routeSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive().max(2147483647), nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).strict();
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** This script runs only in the standalone protected listener's nonce document. No framework bundle or browser persistence. */
function startProtectedPage() {
  type Reference = UtilityProtectedWorkspace["references"][number];
  type Target = UtilityProtectedWorkspace["targets"][number];
  type Attempt = { inputId: string; purpose: string; body?: string; bytes?: Uint8Array; file?: File; reuseId?: string };
  const data = JSON.parse(document.getElementById("protected-data")!.textContent!) as { workspace: UtilityProtectedWorkspace; route: { requestId: string; expectedVersion: number }; labels: Record<string, string> };
  const { workspace: workspace, route: route, labels } = data;
  const base = `/protected/utilities/requests/${encodeURIComponent(route.requestId)}`, query = `?expectedVersion=${encodeURIComponent(route.expectedVersion)}`;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const form = element<HTMLFormElement>("protected-form"), consent = element<HTMLInputElement>("protected-consent"), purpose = element<HTMLSelectElement>("protected-purpose"), target = element<HTMLSelectElement>("protected-target");
  let references = [...workspace.references], attempt: Attempt | null = null, busy = false, disposed = false;
  const open = () => !disposed && workspace.collectionEnabled && !!workspace.scope && !!workspace.expiresAt && Date.now() < Date.parse(workspace.expiresAt);
  const status = (text: string) => { element("protected-status")!.textContent = text; };
  const error = (text = "") => { const node = element("protected-error")!; node.hidden = !text; node.textContent = text; };
  const input = (id: string) => element<HTMLInputElement>(id)!;
  const descriptor = () => target && target.value !== "" ? workspace.targets[Number(target.value)] : undefined;
  const inputUrl = (id: string, operation = "") => `${base}/inputs/${encodeURIComponent(id)}${operation}${query}`;
  const refresh = (version = workspace.requestVersion) => location.replace(`${base}/workspace?expectedVersion=${encodeURIComponent(version)}`);
  const sameTarget = (a: Reference["targets"][number], b: Reference["targets"][number]) => a.subjectId === b.subjectId && a.sourceId === b.sourceId && a.field === b.field;
  const fieldsChecked = (reference: Reference) => !!reference.validation && Date.parse(reference.validation.validatedAt) <= Date.now() && Date.now() < Date.parse(reference.validation.expiresAt);
  const current = (reference: Reference) => !!workspace.scope && reference.requestVersion === workspace.scope.expectedVersion && reference.snapshotId === workspace.scope.snapshotId && reference.snapshotRevision === workspace.scope.snapshotRevision && reference.snapshotHash === workspace.scope.snapshotHash;
  const storedForTarget = (selected?: Target) => selected ? references.filter(reference => current(reference) && reference.state === "stored" && Date.parse(reference.expiresAt) > Date.now() && reference.purpose === selected.purpose && reference.targets.some(subject => sameTarget(subject, selected.target))) : [];
  function clearSecrets() {
    for (const id of ["protected-file", "protected-identifier-value", "protected-identifier-other", "protected-water-code", "protected-water-zip", "protected-recovery-id"]) { const node = element<HTMLInputElement>(id); if (node) node.value = ""; }
  }
  function wipe() { attempt?.bytes?.fill(0); if (attempt) { attempt.bytes = undefined; attempt.file = undefined; } clearSecrets(); }
  function controls() {
    const permitted = open(), selected = descriptor(), stored = storedForTarget(selected);
    const identifier = workspace.programId === "pgw-crp" && selected?.purpose === "required_identifier", ambiguous = identifier && stored.length > 1;
    const acknowledged = consent?.checked && permitted && !attempt && !ambiguous;
    if (purpose) purpose.disabled = busy || !!attempt || !permitted;
    if (target) target.disabled = busy || !!attempt || !permitted;
    if (consent) consent.disabled = busy || !!attempt || !selected || !permitted || ambiguous;
    const raw = element<HTMLFieldSetElement>("protected-raw"); if (raw) { raw.disabled = busy || !acknowledged; raw.hidden = !selected || !permitted; }
    for (const kind of ["file", "identifier", "water", "recovery"]) {
      const panel = element(`protected-${kind}-group`); if (panel) panel.hidden = !selected || (kind === "file" ? !["income_proof", "residency_proof"].includes(selected.purpose) : kind === "identifier" ? selected.purpose !== "required_identifier" : kind === "water" ? selected.purpose !== "account_access" : selected.purpose !== "application_recovery");
    }
    const other = element("protected-identifier-other-group"); if (other) other.hidden = input("protected-identifier-type")?.value !== "other";
    const existing = element("protected-target-status"); if (existing) existing.textContent = ambiguous ? "More than one saved identifier needs a service check. Keep the existing values while CaseLink resolves the selected person’s record."
      : identifier && stored.length === 1 ? `Saving this replaces the saved identifier for ${selected!.displayName} once the new value is safely saved. The previous identifier and its reused copies stop being used only after that save.`
      : stored.length ? "An item is already stored for this person and source. Add another only if you need to correct or supplement it; a pending source check is service work." : "";
    const save = element<HTMLButtonElement>("protected-save"); if (save) { save.disabled = busy || !attempt && !acknowledged; save.textContent = busy ? "Checking private item…" : attempt ? "Check and retry same item" : "Save private item"; }
  }
  async function request(path: string, init: RequestInit = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(path, { ...init, signal: controller.signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
      const value: unknown = await response.json().catch(() => null);
      return { ok: response.ok, status: response.status, value };
    } finally { clearTimeout(timer); }
  }
  function checked(value: unknown, id: string): Reference {
    const reference = value as Reference;
    if (!reference || reference.inputId !== id || reference.requestId !== route.requestId || !workspace.scope || reference.programId !== workspace.scope.programId || !current(reference) || !["authorized", "stored"].includes(reference.state)) throw new Error();
    return reference;
  }
  function remember(reference: Reference) { references = [...references.filter(old => old.inputId !== reference.inputId), reference]; history(); }
  function history() {
    const list = element("protected-history")!; list.replaceChildren();
    if (!references.length) { const empty = document.createElement("li"); empty.textContent = "No protected items are saved for this request."; list.append(empty); }
    for (const reference of references) {
      const item = document.createElement("li"); item.dataset.inputId = reference.inputId;
      const title = document.createElement("h3"), matched = workspace.targets.find(candidate => candidate.purpose === reference.purpose && reference.targets.some(subject => sameTarget(subject, candidate.target)));
      title.textContent = `${labels[reference.purpose] ?? "Private item"}${matched ? ` · ${matched.displayName}${matched.sourceLabel ? ` · ${matched.sourceLabel}` : ""}` : ""}`;
      const description = document.createElement("p"), expired = Date.now() >= Date.parse(reference.expiresAt);
      description.textContent = expired ? "Use permission expired. This does not prove the original has been erased." : reference.state === "stored" ? fieldsChecked(reference) ? "Stored privately · source fields checked. Proof completeness and provider acceptance remain unconfirmed." : "Stored privately · source checks are not confirmed. This is not accepted proof." : reference.state === "authorized" ? "Permission recorded; storage has not been confirmed." : `Use status: ${reference.state}.`;
      const date = document.createElement("p"); date.className = "muted"; date.textContent = `Original consent: ${new Date(reference.consentedAt).toLocaleString()}. Use ends: ${new Date(reference.expiresAt).toLocaleString()}.`;
      const buttons = document.createElement("div"); buttons.className = "actions";
      if (open() && current(reference) && reference.state === "stored" && !expired) { const download = document.createElement("button"); download.type = "button"; download.dataset.action = "download"; download.textContent = "Download private original"; download.addEventListener("click", () => { if (open()) location.assign(inputUrl(reference.inputId, "/original")); }); buttons.append(download); }
      if (!["revoked", "expired"].includes(reference.state)) {
        const remove = document.createElement("button"); remove.type = "button"; remove.dataset.action = "remove"; remove.textContent = "Stop using this item";
        remove.addEventListener("click", async () => {
          remove.disabled = true; error();
          try { const result = await request(inputUrl(reference.inputId), { method: "DELETE", body: "" });
            const value = result.value as { state?: string; requestVersion?: number };
            if (!result.ok || value?.state !== "revoked" || !Number.isInteger(value.requestVersion) || value.requestVersion! <= 0) throw new Error();
            wipe(); status("Future use of this item and its reused copies has stopped. Refreshing your request…"); refresh(value.requestVersion);
          } catch { error("CaseLink could not confirm that use stopped. Your saved history remains; check this request and try again."); remove.disabled = false; }
        }); buttons.append(remove);
      }
      item.append(title, description, date, buttons); list.append(item);
    }
  }
  function choose() {
    if (!target || !purpose || !consent || attempt) return;
    target.replaceChildren(new Option("Choose the person and item", ""));
    workspace.targets.forEach((candidate, index) => { if (candidate.available && candidate.purpose === purpose.value) target.append(new Option(`${candidate.displayName}${candidate.sourceLabel ? ` · ${candidate.sourceLabel}` : ""}`, String(index))); });
    if (target.options.length === 2) target.selectedIndex = 1;
    consent.checked = false; clearSecrets(); controls();
  }
  function capture(selected: Target): Attempt {
    if (!open() || !consent?.checked || !workspace.scope || !selected.available) throw new Error();
    const id = crypto.randomUUID(); let bytes: Uint8Array | undefined, file: File | undefined, mediaType: string;
    const identifiers = workspace.programId === "pgw-crp" && selected.purpose === "required_identifier" ? storedForTarget(selected) : [];
    if (identifiers.length > 1) throw new Error();
    if (["income_proof", "residency_proof"].includes(selected.purpose)) {
      file = input("protected-file").files?.[0]; if (!file || !selected.mediaTypes.includes(file.type as "application/pdf") || file.size < 12 || file.size > selected.maxBytes) throw new Error(); mediaType = file.type;
    } else {
      let scalar: Record<string, string>;
      if (selected.purpose === "required_identifier") {
        const type = input("protected-identifier-type").value, value = input("protected-identifier-value").value.trim(), otherType = input("protected-identifier-other").value.trim();
        if (!["ssn", "drivers_license", "student_id", "passport", "visa", "itin", "other"].includes(type) || !value || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(value) || type === "other" && (!otherType || otherType.length > 80)) throw new Error();
        scalar = { purpose: selected.purpose, type, value, ...(type === "other" ? { otherType } : {}) };
      } else if (selected.purpose === "account_access") {
        const accessCode = input("protected-water-code").value, zip = input("protected-water-zip").value; if (!/^[0-9]{9}$/.test(accessCode) || !/^[0-9]{5}$/.test(zip)) throw new Error(); scalar = { purpose: selected.purpose, accessCode, zip };
      } else { const applicationId = input("protected-recovery-id").value; if (!/^[0-9]{1,9}$/.test(applicationId)) throw new Error(); scalar = { purpose: selected.purpose, applicationId }; }
      bytes = new TextEncoder().encode(JSON.stringify(scalar)); mediaType = "application/octet-stream"; if (bytes.length > selected.maxBytes) { bytes.fill(0); throw new Error(); }
    }
    const body = JSON.stringify({ ...workspace.scope, inputId: id, purpose: selected.purpose, targets: [selected.target], mediaType, byteLength: file?.size ?? bytes!.length,
      noticeVersion: workspace.noticeVersion, consentAccepted: true, subjectAuthorityDeclared: true, accountAuthorityDeclared: true,
      ...(identifiers.length === 1 ? { replacesInputId: identifiers[0].inputId } : {}) });
    return { inputId: id, purpose: selected.purpose, body, bytes, file };
  }
  async function finish(reference: Reference) {
    if (disposed) return;
    const replacement = reference.purpose === "required_identifier" && attempt?.body && JSON.parse(attempt.body).replacesInputId;
    remember(reference);
    if (reference.state !== "stored") throw new Error();
    if (reference.purpose === "income_proof" && !fieldsChecked(reference) && open()) {
      try { const validation = await request(inputUrl(reference.inputId, "/validate"), { method: "POST", body: "" }); if (validation.ok) { reference = checked(validation.value, reference.inputId); remember(reference); } } catch { /* Storage is known; an unconfirmed source check never becomes accepted proof. */ }
    }
    wipe(); attempt = null; if (consent) consent.checked = false;
    status(fieldsChecked(reference) ? "Your item is stored privately and source fields were checked. Completeness, submission and provider acceptance remain unconfirmed." : "Your item is stored privately. Source checks, completeness and provider acceptance are not confirmed.");
    if (reference.purpose === "account_access" || replacement) refresh();
  }
  async function perform(reconcile: boolean) {
    if (!attempt || disposed) return;
    const exact = attempt;
    if (reconcile) {
      const observed = await request(inputUrl(exact.inputId));
      if (disposed) return;
      if (observed.ok) { const reference = checked(observed.value, exact.inputId); if (reference.state === "stored") { await finish(reference); return; } }
    }
    if (!open()) throw new Error();
    if (exact.reuseId) {
      const reused = await request(inputUrl(exact.reuseId, "/rebind"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newInputId: exact.inputId, scope: workspace.scope }) });
      if (disposed) return; if (reused.status === 202 || !reused.ok) throw new Error(); await finish(checked(reused.value, exact.inputId)); return;
    }
    const authorized = await request(`${base}/inputs${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: exact.body });
    if (disposed) return; if (!authorized.ok) throw new Error(); const reference = checked(authorized.value, exact.inputId); remember(reference);
    if (reference.state === "stored") { await finish(reference); return; }
    if (!open() || disposed) throw new Error();
    if (!exact.bytes && exact.file) { exact.bytes = new Uint8Array(await exact.file.arrayBuffer()); if (!open() || disposed) { exact.bytes.fill(0); throw new Error(); } }
    if (!exact.bytes) throw new Error();
    const metadata = JSON.parse(exact.body!), sending = Uint8Array.from(exact.bytes);
    try { const stored = await request(inputUrl(exact.inputId), { method: "PUT", headers: { "Content-Type": metadata.mediaType }, body: sending });
      if (disposed) return; if (stored.status === 202 || !stored.ok) throw new Error(); await finish(checked(stored.value, exact.inputId));
    } finally { sending.fill(0); }
  }
  async function save() {
    if (busy || disposed) return; error();
    try { if (!attempt) { const selected = descriptor(); if (!selected) throw new Error(); attempt = capture(selected); } }
    catch { error("Choose the exact person and item, give its processing permission, and check the requested fields or supported file. Unknown answers can stay in your request draft."); return; }
    busy = true; controls(); status("Saving this exact private item…");
    try { await perform(true); }
    catch { error("The save result is unconfirmed. Check and retry this same item before adding another. Your exact attempt is kept on this page."); }
    finally { busy = false; controls(); }
  }
  async function reuse() {
    if (!open() || disposed) return;
    const candidates = references.filter(reference => ["stored", "superseded"].includes(reference.state) && Date.parse(reference.expiresAt) > Date.now() && !current(reference))
      .sort((a, b) => Number(b.purpose === "account_access") - Number(a.purpose === "account_access"));
    for (const reference of candidates) {
      if (!open() || disposed || attempt) return;
      const compatible = reference.programId === workspace.scope?.programId && reference.targets.every(subject => workspace.targets.some(candidate => candidate.available && candidate.purpose === reference.purpose && sameTarget(subject, candidate.target)));
      const covered = references.some(value => current(value) && value.state === "stored" && Date.parse(value.expiresAt) > Date.now() && value.purpose === reference.purpose && reference.targets.every(subject => value.targets.some(other => sameTarget(subject, other))));
      if (!compatible || covered) continue;
      attempt = { inputId: crypto.randomUUID(), purpose: reference.purpose, reuseId: reference.inputId }; busy = true; controls(); status("Checking a previously saved item so you do not have to provide it again…");
      try { await perform(true); } catch { error("Reuse could not be confirmed. Check and retry the same saved item; do not provide it again."); return; } finally { busy = false; controls(); }
    }
  }
  purpose?.addEventListener("change", choose);
  target?.addEventListener("change", () => { if (consent) consent.checked = false; clearSecrets(); controls(); });
  consent?.addEventListener("change", () => { if (!consent.checked) clearSecrets(); controls(); });
  element("protected-identifier-type")?.addEventListener("change", controls);
  form?.addEventListener("submit", event => { event.preventDefault(); void save(); });
  const expire = () => { if (!open()) { wipe(); controls(); history(); if (form) status("New private entry is closed. Any uncertain attempt reference stays on this page; saved history and stop-use controls remain available."); } };
  const timer = setInterval(expire, 1000);
  window.addEventListener("focus", expire); document.addEventListener("visibilitychange", expire);
  window.addEventListener("pagehide", () => { disposed = true; clearInterval(timer); wipe(); controls(); });
  window.addEventListener("pageshow", event => { if (event.persisted || disposed) refresh(); });
  history();
  if (purpose?.options.length === 2) purpose.selectedIndex = 1;
  choose(); controls();
  if (workspace.requestVersion !== route.expectedVersion) refresh(); else void reuse();
}

export function renderUtilityProtectedPage(input: UtilityProtectedWorkspace, routeInput: { requestId: string; expectedVersion: number; nonce: string }): string {
  const workspace = utilityProtectedWorkspaceSchema.parse(structuredClone(input)), route = routeSchema.parse(routeInput);
  if (workspace.scope && (workspace.scope.requestId !== route.requestId || workspace.scope.expectedVersion !== route.expectedVersion) || workspace.references.some(reference => reference.requestId !== route.requestId)) throw new Error("The protected workspace is unavailable.");
  const labels: Record<string, string> = { income_proof: "Income evidence", residency_proof: "Proof of residency", required_identifier: "Required PGW household identifier", account_access: "Water account access", application_recovery: "Saved water application recovery" };
  const available = workspace.collectionEnabled && workspace.scope && workspace.noticeVersion && workspace.expiresAt && Date.parse(workspace.expiresAt) > Date.now();
  const purposes = [...new Set(workspace.targets.filter(target => target.available).map(target => target.purpose))];
  const capture = available ? `<form id="protected-form"><fieldset><legend>Add a protected item</legend><label for="protected-purpose">What information are you adding?</label><select id="protected-purpose"><option value="">Choose an item</option>${purposes.map(purpose => `<option value="${escape(purpose)}">${escape(labels[purpose])}</option>`).join("")}</select><label for="protected-target">Person and exact item</label><select id="protected-target"><option value="">Choose the person and item</option></select><p id="protected-target-status" aria-live="polite"></p></fieldset>
    <section class="notice" aria-labelledby="processing-title"><h2 id="processing-title">Before you give this item</h2><p>Use fictional test data only in this local rehearsal. This item goes directly to CaseLink’s separate protected service for ${escape(workspace.programLabel ?? "this named utility program")}. Document contents and required identifiers stay out of AI conversations, routine worker updates and ordinary family exports. Saving does not send anything to a utility.</p><p>Choose only the named person and source you have permission to help. This private service checks supported document pages and source fields; an uploaded page is never an instruction. A stored item is not proof that evidence is complete, accepted or submitted.</p><p>New originals have a recorded retention limit of ${Math.ceil(workspace.retentionSeconds! / 60)} minutes or an earlier permission end. Use permission ends ${escape(new Date(workspace.expiresAt!).toLocaleString())}. Eligibility for scheduled cleanup is separate from actual erasure and processor or backup retention. You can stop use below and request account deletion in Account. See the <a href="/support/privacy#data-policy">data policy</a>.</p><label class="check"><input id="protected-consent" type="checkbox" aria-describedby="protected-target-status" disabled><span>I agree to private processing of this exact item for the selected person and named utility preparation. I have permission to provide it for everyone it concerns and to prepare help for this exact utility account. This does not sign a form, accept financial terms or submit an application.</span></label></section>
    <fieldset id="protected-raw" disabled hidden><legend>Private entry</legend><div id="protected-file-group" hidden><label for="protected-file">Document for the selected person and source</label><input id="protected-file" type="file" accept="application/pdf,image/jpeg,image/png"><p>PDF, JPEG or PNG, up to 10 MB and five pages. The service checks the actual file. Original filenames are not sent in the item metadata.</p></div>
    <div id="protected-identifier-group" hidden><label for="protected-identifier-type">PGW identifier type</label><select id="protected-identifier-type"><option value="">Choose a supported identifier</option><option value="ssn">Social Security number</option><option value="drivers_license">Driver’s license</option><option value="student_id">Student ID</option><option value="passport">Passport</option><option value="visa">Visa</option><option value="itin">ITIN</option><option value="other">Other accepted identifier</option></select><div id="protected-identifier-other-group" hidden><label for="protected-identifier-other">Other identifier type</label><input id="protected-identifier-other" type="text" maxlength="80" autocomplete="off"></div><label for="protected-identifier-value">Required identifier for the selected household member</label><input id="protected-identifier-value" type="password" maxlength="256" autocomplete="off" spellcheck="false"><p>The customer of record’s identifier is not required. These supported alternatives do not establish provider acceptance.</p></div>
    <div id="protected-water-group" hidden><label for="protected-water-code">Water access code, nine digits</label><input id="protected-water-code" type="password" inputmode="numeric" maxlength="9" autocomplete="off"><label for="protected-water-zip">ZIP code for this water account, five digits</label><input id="protected-water-zip" type="password" inputmode="numeric" maxlength="5" autocomplete="off"><p>Use the actual account information. Saving it does not request an issued City application or confirm account access.</p></div>
    <div id="protected-recovery-group" hidden><label for="protected-recovery-id">Saved City Application ID</label><input id="protected-recovery-id" type="password" inputmode="numeric" maxlength="9" autocomplete="off"><p>One to nine digits from your actual saved application. Saving does not verify its City status.</p></div></fieldset><button id="protected-save" type="submit" disabled>Save private item</button></form>` : `<section class="notice"><h2>Private entry is closed</h2><p>New protected information cannot be added for this request. Saved references remain below where account access permits. An unavailable service is not a request to put identifiers or documents into chat or an ordinary upload.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Private utility preparation | CaseLink</title><link rel="icon" href="/favicon.svg?v=4"><style nonce="${route.nonce}">${tokens}
    @font-face{font-family:Geist;src:url('/fonts/utility-protected/Geist-Regular.woff2') format('woff2');font-display:swap}@font-face{font-family:'Newsreader Variable';src:url('/fonts/utility-protected/newsreader-latin-wght-normal.woff2') format('woff2');font-weight:200 800;font-display:swap}
    *{box-sizing:border-box}body{margin:0;background:var(--color-paper);color:var(--color-ink);font:1rem/1.6 Geist,system-ui,sans-serif}a{color:var(--color-accent)}h1,h2,h3{font-family:var(--font-display);line-height:1.2}h1{font-size:clamp(2rem,5vw,3rem)}h2{font-size:1.6rem}h3{font-size:1.2rem}p{max-width:72ch}header,main,footer{max-width:960px;margin:auto;padding:24px}header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;align-items:center}.brand{display:flex;align-items:center;gap:12px;color:var(--color-ink);text-decoration:none;font:2rem var(--font-display)}.brand img{width:36px;height:36px}.recognition{display:block;padding:10px;text-align:center;background:var(--color-ink);color:var(--color-surface);min-height:44px}.skip{position:absolute;top:-100px}.skip:focus{top:0;background:var(--color-surface);padding:12px}section,form{margin-block:24px}section{padding-block:16px;border-top:1px solid var(--color-rule)}fieldset{border:0;padding:0;margin:20px 0}legend{font-size:1.25rem;font-weight:600;margin-bottom:12px}label{display:block;font-weight:600;margin:18px 0 8px}input,select,button{font:inherit;max-width:100%;min-height:44px;border:1px solid var(--color-rule-strong);border-radius:var(--radius-control);padding:10px 12px;background:var(--color-surface);color:var(--color-ink)}input:not([type=checkbox]),select{width:100%}button{cursor:pointer}button[type=submit]{background:var(--color-accent);color:var(--color-accent-ink);border-color:var(--color-accent);font-weight:600}button:disabled,fieldset:disabled{opacity:.65}button:disabled{cursor:default}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--color-focus);outline-offset:3px}.check{display:flex;gap:12px;align-items:start;font-weight:400}.check input{flex:0 0 24px;width:24px;min-height:24px;margin-top:3px}.notice{padding:20px;background:var(--color-paper-2);border:1px solid var(--color-rule);border-radius:var(--radius-card)}.muted{color:var(--color-ink-muted)}#protected-error{color:var(--color-error);font-weight:600}#protected-status{font-weight:600}#protected-history{list-style:none;padding:0}#protected-history li{padding:20px 0;border-bottom:1px solid var(--color-rule)}.actions,footer nav{display:flex;gap:12px;flex-wrap:wrap}footer nav a,header>a{display:inline-flex;align-items:center;min-height:44px}p,li,label,select{overflow-wrap:anywhere}[hidden]{display:none!important}@media(max-width:480px){header,main,footer{padding:16px}.notice{padding:16px}.actions button{width:100%}}
    </style></head><body><a class="skip" href="#main-content">Skip to content</a><a class="recognition" href="https://openai.com/index/introducing-chatgpt-futures-class-of-2026/" rel="noreferrer">Selected for OpenAI’s inaugural ChatGPT Futures Class of 2026</a><header><a class="brand" href="/"><img src="/favicon.svg?v=4" alt="">CaseLink</a><a href="/support/${route.requestId}">Return to your request</a></header><main id="main-content" tabindex="-1"><h1>Private utility preparation</h1><p>Keep documents and required identifiers in this protected step. Your ordinary request and chat never need these raw values.</p><p class="muted">Local test data only. No utility application, approval, financial agreement or shutoff protection is confirmed.</p><p id="protected-status" role="status">Choose an exact item below, or read its saved use status.</p><p id="protected-error" role="alert" hidden></p>${capture}<section aria-labelledby="history-title"><h2 id="history-title">Your protected items</h2><p>Stored, source fields checked, complete evidence, submitted and accepted are different stages. Stopping use also stops compatible reused copies; scheduled deletion and backups have separate timing.</p><ul id="protected-history"></ul></section><noscript><p>Private capture needs JavaScript. Your saved request and official help remain available. Do not place documents or identifiers into chat.</p></noscript></main><footer><p>Support for your family, with you in control. Built in Philadelphia.</p><nav aria-label="Footer"><a href="/support/privacy#data-policy">Data policy</a><a href="/support/privacy">Privacy policy</a><a href="/support/terms">Terms of service</a><a href="/support/help">Get help</a><a href="mailto:willsanz23@gmail.com">Contact CaseLink</a></nav></footer><script id="protected-data" type="application/json" nonce="${route.nonce}">${json({ workspace, route: { requestId: route.requestId, expectedVersion: route.expectedVersion }, labels })}</script><script nonce="${route.nonce}">const __name=(fn,name)=>Object.defineProperty(fn,"name",{value:name,configurable:true});(${startProtectedPage.toString()})();</script></body></html>`;
}
