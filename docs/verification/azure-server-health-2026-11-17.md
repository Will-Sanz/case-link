# Azure server health — November 17, 2026

The VM is healthy at its current load. The deployed parent service is **not ready for a complete live demo or a family launch**: its backend services are stopped, their operating profiles have expired, and their existing database credentials fail authentication. The public website being available does not establish that background work is available.

This was a read-only check of the existing `caselink-dev-01` VM in `caselink-dev-rg`, its public site, and its current Azure configuration. The guest snapshot is timestamped **12:17:34 p.m. EST / 17:17:34 UTC**. Later checks in this audit verified private database authentication, alert configuration and VM backup configuration. Another chat is handling login/deployment; this audit did not change code, credentials, profiles, database permissions, services, timers, DNS, firewall rules or billing. No provider submission, model call, household-record query or document processing was performed.

## Host and public-site results

| Check | Observed result |
| --- | --- |
| Azure VM | Running; guest agent Ready; Ubuntu 24.04; Standard B2als v2, 2 vCPU / 4 GiB |
| Azure platform, last 24 hours | No health events; no Azure outage issues; minimum VM availability metric 1 |
| CPU | Azure 24-hour average 3.1565%; guest load averages 0.137 / 0.186 / 0.177 |
| Uptime | 206.8 hours |
| Memory | 3,856 MiB total; 2,632 MiB available; no swap in use |
| Root disk | 28.02 GiB total; 14.02 GiB free; 49.9% used |
| Memory failures | No OOM matches in the bounded kernel log check, last 24 hours / at most 2,000 entries |
| Public site | Homepage, Get support, privacy and terms returned 200 |
| Repeated public checks | 18/18 successful, up to 3 concurrent requests; median 69 ms, p95 / maximum 224 ms |
| Static assets | Four linked JavaScript/CSS files returned 200 with matching content types |
| HTTPS | Certificate validation passed; TLS 1.3; certificate expires February 7, 2027 |
| Redirects | HTTP redirects to HTTPS with 308; apex redirects to canonical www with 301 |
| Anonymous private-data requests | Account and request APIs returned 401 with no private contents |
| Public security headers | HSTS, CSP, frame denial, MIME sniffing protection, referrer policy and private/no-store present |
| Private service ports | Public TCP attempts to 3100 / 3200 / 3310 / 3400 / 3500 timed out; active web/frontdoor guest listeners bind to loopback |
| Subscription | Active; portal current cost $9.62, forecast $23.05 for its displayed period; no billing change made |
| Auto-shutdown | Not enabled |

The response-time check is a light public-page smoke test, **not** an authenticated workflow, PDF/model workload, endurance test or production-capacity test. Present resource headroom does not justify a VM upgrade on its own.

## Must fix before the full demo

| Component | Current state | Exact blocker |
| --- | --- | --- |
| Web | Active, 0 automatic restarts | Profile deadline November 8, 2027; public pages available |
| Frontdoor | Active, 0 automatic restarts | Profile deadline November 8, 2027 |
| Caddy | Active, 0 automatic restarts | Public TLS/proxy checks pass |
| Worker | Inactive / dead, previous exit successful | Enabled profile expired November 11, 2026 at 05:00 UTC; database connection rejected with SQLSTATE `28P01` |
| Document broker | Inactive / dead, previous exit successful | Same expired profile deadline; database connection rejected with `28P01` |
| Review service | Inactive / dead, previous exit successful | Same expired profile deadline; database connection rejected with `28P01` |
| Protected retention | Failed, exit 78; timer still scheduled every minute | Same expired profile deadline; database connection rejected with `28P01` |
| Ordinary retention | Failed, exit 78; timer still scheduled every minute | Same expired profile deadline; database connection rejected with `28P01` |
| Sender | Inactive and explicitly disabled | Sending approval false; left closed. This audit supplies no authority to enable a transport. |

The five database checks ran separately under each service's own existing OS identity, using only its own installed connection configuration. Each attempted a read-only timestamp query; all were rejected at authentication. `28P01` establishes rejected password authentication, not independently the precise reason for rejection. Earlier provisioning records give these logins a November 11 expiry; current role metadata was not readable through the rejected connections.

The bounded application journal sample (last 24 hours, at most 3,000 entries) contained 500 disabled/expired/not-configured matches and 500 priority-error entries. These are sample counts, not complete daily totals. The cleanup timers continue attempting work but their failed units do not establish successful cleanup.

The live release symlink resolved to:

`/opt/caselink/releases/5900b9404b0ac8f20e8fe71c6d18327fc979f9ca-www-20261110-r3`

Local work includes a November 17 ongoing-access change. Its presence in the working tree does not establish live installation. Coordinate its existing rollout with the login chat rather than changing the running release independently.

## Before launch

1. Complete the already-authorized ongoing-access rollout across the database processing control, each required service profile and each matching restricted database login. Preserve the existing cohort, per-service credential isolation and separate provider/collection/sending controls. Verify each connection before starting its dependent service.
2. Restore the required backend units and independently authorized cleanup services through the existing deployment procedure. Verify fresh worker health, one synthetic durable job and PDF lifecycle, successful scheduled cleanup runs, cancellation and return-use behavior on the exact deployed release. Do not disable failing cleanup timers merely to clear the error state.
3. Add and verify operational alert delivery. Azure's VM-scoped Alert rules page currently reports **No alert rules found**, and guest/application health monitoring is not enabled. A stopped worker and failing cleanup can coexist with a 200 from `/api/health`; the checked health route only reports that the web process answered.
4. Establish recovery evidence. The VM Backup page currently presents initial setup and **Enable backup**; Azure VM backup is not configured. This does not establish the state of Supabase database/Storage backups or other recovery copies. Verify a rebuild/credential-recovery path and database/object restore separately before family launch. No paid backup service was activated in this audit.

## Review and limits

Normal review covered live availability, resource pressure, service exits/restarts, private listener exposure, anonymous denial, TLS, operational deadlines, service database authentication, cleanup scheduling, alerts and VM backup configuration. The separate simplicity/deletion review found no reason to replace the host, add a fleet, change the app architecture or introduce another scheduler: repair and verify the existing isolated services first.

Not checked: successful parent login (assigned to the other chat), authenticated end-to-end service completion, current model-budget availability, provider receipts, full application security/accessibility, a hosted restore, or realistic concurrent model/document workloads. No launch certification is implied.
