import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { FOOD_DESCRIPTION_EVALUATION_BINDING, FOOD_DESCRIPTION_FINGERPRINT, foodDescriptionUsage } from "../src/lib/parent/food-description-runtime";
import { foodDescriptionProjectionSchema } from "../src/lib/parent/food-description";
import { readBoundedBody } from "../src/lib/parent/http";

export const FOOD_DESCRIPTION_CORPUS_SHA = "6ea3e44b253e66bc26720507c355d6b3da030bfd2d85e59b282feb9607570a19";
export const DESCRIPTION_EVAL_LIMITS = { calls: 80, counts: 80, batchCalls: 16, input: 8000, output: 1500, capNanoDollars: 5_000_000_000, reservationNanoDollars: 55_000_000 } as const;
export const DESCRIPTION_EVAL_RATE_CARD = { checkedAt: "2026-11-18", model: "gpt-6.1-sol", tier: "default", region: "global", ordinary: 2000, cached: 100, write30m: 2500, write12h: 5000, output: 10000 } as const;
const ref = z.string().trim().min(1).max(300), sha = z.string().regex(/^[a-f0-9]{64}$/);
export const descriptionEvaluationApprovalSchema = z.object({
  purpose: z.literal("optional_food_description_synthetic_evaluation_v1"), syntheticOnly: z.literal(true), approvalReference: ref,
  approvedUntil: z.iso.datetime({ offset: true }), processorReference: ref, noticeRetentionReference: ref, billingReference: ref,
  projectId: z.string().regex(/^proj_[A-Za-z0-9_-]{1,100}$/), projectMetadataReference: ref,
  approvedResponseModelId: z.string().regex(/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/), region: z.literal("global"), serviceTier: z.literal("default"),
  fingerprint: z.literal(FOOD_DESCRIPTION_FINGERPRINT), corpusSha256: z.literal(FOOD_DESCRIPTION_CORPUS_SHA), adapterSha256: sha,
  rateCardDate: z.literal("2026-11-18"), maximumCalls: z.literal(80), maximumCountRequests: z.literal(80), maximumInputTokens: z.literal(8000),
  maximumOutputTokens: z.literal(1500), maximumNanoDollars: z.literal(5_000_000_000),
  runDirectory: z.string().refine(isAbsolute),
}).strict();
export type DescriptionEvaluationApproval = z.infer<typeof descriptionEvaluationApprovalSchema>;
export type DescriptionEvaluationBudget = { fetch: (caseId: string, turn: number) => typeof fetch; attempts: () => number; halt: () => void };
export const descriptionEvaluationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeError = () => new Error("The optional-description evaluation is blocked. Reconcile this same approved run; no request is retried automatically.");
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** The existing emulator probe uses the same native exclusive/private durable-file pattern. */
export function writeDescriptionEvaluationEvidence(path: string, value: unknown) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}
const durable = writeDescriptionEvaluationEvidence;
export function readDescriptionEvaluationEvidence(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.() || info.size > 1048576) throw safeError();
    return JSON.parse(readFileSync(fd, "utf8")) as unknown;
  } finally { closeSync(fd); }
}
const intentSchema = z.object({ attempt: z.number().int().min(1).max(80), caseId: z.string().regex(/^description-[a-z0-9_-]+$/), turn: z.number().int().min(1).max(4),
  requestHash: sha, countRequestHash: sha, reservedNanoDollars: z.literal(55_000_000) }).strict();
type LedgerIdentity = Pick<DescriptionEvaluationApproval, 'runDirectory' | 'approvalReference'>;
function ledgerPrefix(approval: LedgerIdentity) {
  return join(dirname(approval.runDirectory), `.food-description-evaluation-${descriptionEvaluationHash(approval.approvalReference)}`);
}
function reservedIntents(approval: LedgerIdentity) {
  const prefix = basename(ledgerPrefix(approval));
  return readdirSync(dirname(approval.runDirectory)).filter(name => name.startsWith(`${prefix}-attempt-`) && /^attempt-\d{3}-intent\.json$/.test(name.slice(prefix.length + 1))).sort().map((name, index) => {
    const value = intentSchema.parse(readDescriptionEvaluationEvidence(join(dirname(approval.runDirectory), name)));
    if (value.attempt !== index + 1) throw safeError();
    return value;
  });
}
function completeAttemptEvidence(approval: LedgerIdentity, intent: z.infer<typeof intentSchema>) {
  const name = `attempt-${String(intent.attempt).padStart(3, '0')}`;
  for (const suffix of ['intent', 'count-dispatch', 'count', 'dispatch', 'observation']) {
    const inner = join(approval.runDirectory, `${name}-${suffix}.json`), outer = `${ledgerPrefix(approval)}-${name}-${suffix}.json`;
    if (!existsSync(inner) || !existsSync(outer) || descriptionEvaluationHash(readDescriptionEvaluationEvidence(inner)) !== descriptionEvaluationHash(readDescriptionEvaluationEvidence(outer))) return false;
  }
  const observation = z.object({ responseHash: sha }).passthrough().parse(readDescriptionEvaluationEvidence(`${ledgerPrefix(approval)}-${name}-observation.json`));
  const response = join(approval.runDirectory, `${name}-response.json`);
  return existsSync(response) && descriptionEvaluationHash(readDescriptionEvaluationEvidence(response)) === observation.responseHash;
}
const countSchema = z.object({ object: z.literal("response.input_tokens"), input_tokens: z.number().int().nonnegative().max(8000) }).strict();
export function foodDescriptionMeasuredNanoDollars(value: ReturnType<typeof foodDescriptionUsage>): number {
  if (!value.complete || !("inputTokens" in value)) throw safeError();
  const ordinary = value.inputTokens - value.cachedInputTokens - value.cacheWriteInputTokens;
  return ordinary * DESCRIPTION_EVAL_RATE_CARD.ordinary + value.cachedInputTokens * DESCRIPTION_EVAL_RATE_CARD.cached
    + value.cacheWrite30mInputTokens * DESCRIPTION_EVAL_RATE_CARD.write30m + value.cacheWrite12hInputTokens * DESCRIPTION_EVAL_RATE_CARD.write12h
    + value.outputTokens * DESCRIPTION_EVAL_RATE_CARD.output;
}

/** One reviewed purpose/run directory forever. Counts and generations are separate, bounded HTTP attempts. */
export async function withFoodDescriptionEvaluationBudget<T>(input: {
  approval: unknown; apiKey: string; now?: () => Date; fetcher?: typeof fetch;
}, work: (budget: DescriptionEvaluationBudget) => Promise<T>): Promise<T> {
  const approval = descriptionEvaluationApprovalSchema.parse(input.approval), now = input.now ?? (() => new Date());
  let permitted = true;
  const current = () => {
    const time = now().getTime();
    if (!permitted || !Number.isFinite(time) || time >= Date.parse(approval.approvedUntil) || now().toISOString().slice(0, 10) !== approval.rateCardDate || !input.apiKey) throw safeError();
  };
  current();
  const dir = approval.runDirectory, parent = lstatSync(dirname(dir));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid?.()) throw safeError();
  // Outside the payload directory: deleting transcripts/the run directory cannot recreate a fresh budget.
  const ledger = ledgerPrefix(approval), anchor = `${ledger}.json`;
  let first = false;
  if (!existsSync(anchor)) {
    try { durable(anchor, approval); first = true; }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw safeError(); }
  }
  if (descriptionEvaluationHash(readDescriptionEvaluationEvidence(anchor)) !== descriptionEvaluationHash(approval) || !first && !existsSync(dir)) throw safeError();
  try { mkdirSync(dir, { mode: 0o700 }); syncDirectory(dirname(dir)); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw safeError(); }
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.()) throw safeError();
  const lockPath = join(dir, "run.lock"); let lock: number;
  try { lock = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw safeError(); }
  try {
    const manifestPath = join(dir, "approval.json");
    if (existsSync(manifestPath)) { if (descriptionEvaluationHash(readDescriptionEvaluationEvidence(manifestPath)) !== descriptionEvaluationHash(approval)) throw safeError(); }
    else durable(manifestPath, approval);
    const haltPath = join(dir, "halted.json"), outsideHalt = `${ledger}-halted.json`;
    const intents = reservedIntents(approval);
    // Any unobserved prior reservation is unknown, including a crash before its dispatch marker.
    if (existsSync(haltPath) || existsSync(outsideHalt) || readdirSync(dir).filter(name => /^attempt-\d{3}-intent\.json$/.test(name)).length !== intents.length
      || intents.some(item => !completeAttemptEvidence(approval, item))) throw safeError();
    let batchCalls = 0, active = false;
    const halt = () => {
      const evidence = { state: "unknown_or_incomplete", reservedCalls: reservedIntents(approval).length };
      if (!existsSync(outsideHalt)) durable(outsideHalt, evidence);
      if (!existsSync(haltPath)) durable(haltPath, evidence);
    };
    return await work({ attempts: () => intents.length, halt, fetch: (caseId, turn) => async (url, init) => {
      current();
      if (active || existsSync(haltPath) || batchCalls >= DESCRIPTION_EVAL_LIMITS.batchCalls || intents.length >= DESCRIPTION_EVAL_LIMITS.calls
        || (intents.length + 1) * DESCRIPTION_EVAL_LIMITS.reservationNanoDollars > approval.maximumNanoDollars) throw safeError();
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>, { input: variableInput, ...fixed } = body;
      if (String(url) !== FOOD_DESCRIPTION_EVALUATION_BINDING.transport.endpoint || init?.method !== "POST" || init.redirect !== "error"
        || descriptionEvaluationHash(fixed) !== descriptionEvaluationHash(FOOD_DESCRIPTION_EVALUATION_BINDING.request)) throw safeError();
      const messages = z.array(z.object({ role: z.literal("user"), content: z.string() }).strict()).length(1).parse(variableInput);
      foodDescriptionProjectionSchema.parse(JSON.parse(messages[0].content));
      const headers = new Headers(init.headers);
      if (headers.get("openai-project") !== approval.projectId || headers.get("authorization") !== `Bearer ${input.apiKey}` || headers.get("content-type") !== "application/json"
        || [...headers.keys()].some(key => !["openai-project", "authorization", "content-type"].includes(key))) throw safeError();
      const countBody = { model: body.model, input: variableInput, instructions: body.instructions, reasoning: body.reasoning, text: body.text };
      const intent = intentSchema.parse({ attempt: intents.length + 1, caseId, turn, requestHash: descriptionEvaluationHash(body), countRequestHash: descriptionEvaluationHash(countBody), reservedNanoDollars: DESCRIPTION_EVAL_LIMITS.reservationNanoDollars });
      if (intents.some(item => item.caseId === caseId && item.turn === turn)) throw safeError();
      const prefix = join(dir, `attempt-${String(intent.attempt).padStart(3, "0")}`);
      const record = (suffix: string, value: unknown) => {
        durable(`${ledger}-attempt-${String(intent.attempt).padStart(3, "0")}-${suffix}.json`, value);
        durable(`${prefix}-${suffix}.json`, value);
      };
      // This immutable maximum reservation is flushed before either HTTP endpoint; no settlement refunds it.
      record('intent', intent); intents.push(intent); batchCalls++; active = true;
      try {
        const fetcher = input.fetcher ?? fetch;
        record('count-dispatch', { maximumInputTokens: 8000 });
        const countStarted=performance.now();
        const countResponse = await fetcher("https://api.openai.com/v1/responses/input_tokens", { method: "POST", redirect: "error", headers, signal: init.signal, body: JSON.stringify(countBody) });
        if (!countResponse.ok) throw safeError();
        const counted = countSchema.parse(JSON.parse(new TextDecoder().decode(await readBoundedBody(countResponse, 1024))));
        record('count', { ...counted, requestId: countResponse.headers.get("x-request-id"), elapsedMs:performance.now()-countStarted });
        current(); record('dispatch', { countedInput: counted.input_tokens, maximumOutput: 1500 });
        const responseStarted=performance.now();const response = await fetcher(url, init);
        let data: unknown;
        try { data = JSON.parse(new TextDecoder().decode(await readBoundedBody(response.clone(), 32768))); } catch { data = null; }
        const usage = foodDescriptionUsage(data, response.headers.get("x-request-id"));
        const actual = z.object({ model: z.literal(approval.approvedResponseModelId), service_tier: z.literal("default"), status: z.literal("completed") }).safeParse(data);
        if (!response.ok || !actual.success || !usage.complete || !("inputTokens" in usage) || usage.inputTokens > counted.input_tokens || usage.outputTokens > 1500) throw safeError();
        const nanoDollars = foodDescriptionMeasuredNanoDollars(usage);
        if (!Number.isSafeInteger(nanoDollars) || nanoDollars < 0 || nanoDollars > intent.reservedNanoDollars) throw safeError();
        durable(`${prefix}-response.json`, data);
        record('observation', { usage, measuredNanoDollars: nanoDollars, model: actual.data.model, serviceTier: actual.data.service_tier, elapsedMs:performance.now()-responseStarted, responseHash: descriptionEvaluationHash(data) });
        return response;
      } catch { halt(); throw safeError(); }
      finally { active = false; }
    } });
  } finally { permitted = false; closeSync(lock); unlinkSync(lockPath); syncDirectory(dir); }
}

/** Read-only retained accounting remains inspectable after approval expiry, without a key or another request. */
export function descriptionEvaluationAccounting(dir: string) {
  const approval = descriptionEvaluationApprovalSchema.extend({ fingerprint: sha, adapterSha256: sha }).parse(readDescriptionEvaluationEvidence(join(dir, 'approval.json')));
  if (approval.runDirectory !== dir || descriptionEvaluationHash(readDescriptionEvaluationEvidence(`${ledgerPrefix(approval)}.json`)) !== descriptionEvaluationHash(approval)) throw safeError();
  const prefix = ledgerPrefix(approval), filename = basename(prefix);
  const files = readdirSync(dirname(dir)).filter(name => name.startsWith(`${filename}-attempt-`)).map(name => name.slice(filename.length + 1));
  const intents = reservedIntents(approval);
  if(readdirSync(dir).filter(name=>/^attempt-\d{3}-intent\.json$/.test(name)).length>intents.length)throw safeError();
  const known = files.filter(name => /^attempt-\d{3}-observation\.json$/.test(name)).map(name => z.object({ measuredNanoDollars: z.number().int().nonnegative().max(55_000_000) }).passthrough().parse(readDescriptionEvaluationEvidence(`${prefix}-${name}`)));
  const countAttempts = files.filter(name => /^attempt-\d{3}-count-dispatch\.json$/.test(name)).length, countReceipts = files.filter(name => /^attempt-\d{3}-count\.json$/.test(name)).length;
  const generationAttempts = files.filter(name => /^attempt-\d{3}-dispatch\.json$/.test(name)).length;
  return { reservedPairs: intents.length, reservedCaseIds: [...new Set(intents.map(intent=>intent.caseId))], countHttpAttemptMarkers: countAttempts, completedCountReceipts: countReceipts, generationHttpAttemptMarkers: generationAttempts, completeUsageReceipts: known.length,
    reservedNanoDollars: intents.reduce((n,value)=>n+value.reservedNanoDollars,0), knownMeasuredNanoDollars: known.reduce((n,value)=>n+value.measuredNanoDollars,0),
    costComplete: intents.length===countReceipts&&generationAttempts===known.length&&intents.every(intent=>completeAttemptEvidence(approval,intent)), halted: existsSync(join(dir,"halted.json")) || existsSync(`${prefix}-halted.json`) };
}
