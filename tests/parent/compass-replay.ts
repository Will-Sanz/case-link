import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

export type CompassReplay = {
  requests: number;
  screenshots: string[];
  protectedScreenshots: number;
  publicNext: number;
  challengeClicks: number;
  challengeKeys: number;
  captchaNext: number;
  householdInputs: number;
  forbiddenRequests: number;
};

/** Explicit in-memory DOM replay. Every request is fulfilled or aborted; nothing reaches DHS or Google. */
export async function installCompassReplay(
  page: Page,
  pending: "challenge" | "ending" | "provider_error" | null = null,
): Promise<CompassReplay> {
  const stats: CompassReplay = {
    requests: 0,
    screenshots: [],
    protectedScreenshots: 0,
    publicNext: 0,
    challengeClicks: 0,
    challengeKeys: 0,
    captchaNext: 0,
    householdInputs: 0,
    forbiddenRequests: 0,
  };
  await page.exposeFunction("recordReplayEvent", (kind: string) => {
    if (kind === "public_next") stats.publicNext++;
    else if (kind === "challenge_click") stats.challengeClicks++;
    else if (kind === "challenge_key") stats.challengeKeys++;
    else if (kind === "captcha_next") stats.captchaNext++;
    else if (kind === "household_input") stats.householdInputs++;
  });
  const screenshot = page.screenshot.bind(page);
  page.screenshot = async (options) => {
    const url = page.url();
    stats.screenshots.push(url);
    if (/\/household(?:\/|$)|gettingstartedending/.test(url)) {
      stats.protectedScreenshots++;
      throw new Error("replay_protected_screenshot");
    }
    return screenshot(options);
  };
  await page.route("**/*", async (route) => {
    stats.requests++;
    const url = new URL(route.request().url());
    if (
      url.origin === "https://www.compass.dhs.pa.gov" &&
      url.pathname === "/intake/"
    ) {
      await route.fulfill({
        contentType: "text/html",
        body: publicIntroduction(pending),
      });
    } else if (
      url.origin === "https://www.google.com" &&
      url.pathname === "/recaptcha/api2/bframe"
    ) {
      await route.fulfill({ contentType: "text/html", body: challenge });
    } else {
      stats.forbiddenRequests++;
      await route.abort();
    }
  });
  return stats;
}

export function assertCompassReplay(stats: CompassReplay) {
  assert.equal(
    stats.protectedScreenshots,
    0,
    "The replay must never capture the divider, its draft reference, or household fields.",
  );
  assert.equal(
    stats.householdInputs,
    0,
    "No applicant field is entered in this milestone.",
  );
  assert.equal(
    stats.forbiddenRequests,
    0,
    "All replay requests use the explicitly fulfilled public fixture routes.",
  );
}

const challenge = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{font:18px sans-serif;margin:12px;background:#fff}button{font:inherit;padding:16px}p{font-size:13px}</style></head>
<body><p>REPLAY ONLY — this is not a CAPTCHA or a DHS connection.</p><button id="replay-button">Replay interaction</button>
<script>
let clicked=false,arrow=false;
function notify(kind){parent.postMessage({replay:true,kind},'https://www.compass.dhs.pa.gov')}
document.querySelector('button').addEventListener('click',()=>{clicked=true;notify('challenge_click');finish()});
document.addEventListener('keydown',event=>{notify('challenge_key');if(event.key==='ArrowRight')arrow=true;finish()});
function finish(){if(clicked&&arrow)notify('complete')}
</script></body></html>`;

function publicIntroduction(
  pending: "challenge" | "ending" | "provider_error" | null,
) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>body{font:18px sans-serif;margin:32px;color:#15255b}main{max-width:900px}button{padding:12px 20px;font:inherit}iframe{display:block;margin-top:20px;border:1px solid #ccc}label{display:block;margin:12px 0}.fixture{font-size:14px;background:#fff4d0;padding:10px}</style></head>
<body><p class="fixture">EXPLICIT LOCAL REPLAY — no real DHS connection, CAPTCHA, applicant data or filing.</p><main></main>
<script>
const pendingReplayResult=${JSON.stringify(pending)};
let pendingFinished=false,providerError=false;
const scenes={
'getstarted':['How would you like to get started?','Apply Now','applynow/gettingstarted'],
'applynow/gettingstarted':['Ready to begin?','Get Started Button','applynow/gettingstarted/tutorial'],
'applynow/gettingstarted/tutorial':["Let's review some terms",'Next Button','applynow/gettingstarted/importantinformation'],
'applynow/gettingstarted/importantinformation':['We keep your information private','Next Button','applynow/gettingstarted/submitreferral'],
'applynow/gettingstarted/submitreferral':['Early Intervention','Next Button','applynow/gettingstarted/WICpreapplication'],
'applynow/gettingstarted/WICpreapplication':['Women, Infants, and Children','Next Button','applynow/gettingstarted/gatepost'],
'applynow/gettingstarted/gatepost':['Who are you applying for?','Next Button','applynow/gettingstarted/existingaccount'],
'applynow/gettingstarted/existingaccount':['Do you already have a My COMPASS account?','Next Button','applynow/gettingstarted/familysafety'],
'applynow/gettingstarted/familysafety':['Family Safety','Next Button','applynow/gettingstarted/captcha'],
'applynow/gettingstarted/gettingstartedending':['Great job!','Next Section Button','applynow/household'],
'applynow/household':['Household','Next Button','applynow/household/householdDetails']
};
function go(path){location.hash='#/'+path}
function render(){
 const path=location.hash.slice(2),main=document.querySelector('main');
 if(path==='applynow/gettingstarted/captcha'){
  if(pendingReplayResult&&!pendingFinished){
   main.innerHTML='<compass-ui-getting-started-captcha><p>Explicit local replay: waiting for a synthetic provider result.</p></compass-ui-getting-started-captcha>';
   setTimeout(()=>{pendingFinished=true;if(pendingReplayResult==='ending')go('applynow/gettingstarted/gettingstartedending');else if(pendingReplayResult==='provider_error'){providerError=true;go('applynow/gettingstarted/familysafety')}else render()},6000);return
  }
  main.innerHTML='<compass-ui-getting-started-captcha><h1>Since you&#39;re applying without an account, we need to confirm that you&#39;re a human.</h1><p>This local fixture tests human controls, not verification success.</p><iframe title="reCAPTCHA replay" src="https://www.google.com/recaptcha/api2/bframe?fixture=local-only" width="360" height="220"></iframe><button id="nextButtonID" aria-label="Next Button" disabled>Next</button></compass-ui-getting-started-captcha>';
  main.querySelector('#nextButtonID').onclick=()=>{window.recordReplayEvent('captcha_next');go('applynow/gettingstarted/gettingstartedending')};return
 }
 if(path==='applynow/household/householdDetails'){
  main.innerHTML='<h1>Let&#39;s start by filling out details for the first person in the household.</h1><label>First Name<input id="firstName" type="text" required maxlength="11"></label><label>Last Name<input id="lastName" type="text" required maxlength="14"></label><label>Date of Birth<input id="dob-datepicker-date" type="text" required></label><input id="gender_male" type="radio" required><input id="gender_female" type="radio" required><input id="provider-session" type="hidden">';
  main.addEventListener('input',()=>window.recordReplayEvent('household_input'));return
 }
 const scene=scenes[path];if(!scene){main.innerHTML='<h1>Unsupported replay route</h1>';return}
 main.innerHTML='<h1>'+scene[0]+'</h1>';
 if(path==='applynow/gettingstarted/familysafety'&&providerError)main.insertAdjacentHTML('beforeend','<p>We were unable to verify your information at this time. You can try again.</p>');
 if(path.endsWith('submitreferral')||path.endsWith('existingaccount'))main.insertAdjacentHTML('beforeend','<label for="N"><input id="N" type="radio">No</label>');
 if(path.endsWith('gatepost'))main.insertAdjacentHTML('beforeend','<label for="FamMem"><input id="FamMem" type="radio">My family</label>');
 if(path.endsWith('gettingstartedending'))main.insertAdjacentHTML('beforeend','<p>Section 1 of 8 Completed</p><p>You finished the first step.</p><p>Next, you’ll answer some questions about your household.</p>');
 if(path==='applynow/household')main.insertAdjacentHTML('beforeend',"<p>Now, let's enter information about the people in your household. A household is all the people who live in a housing unit together even if they are not related.</p><p>REPLAY-DRAFT-NOT-A-FILING</p>");
 const button=document.createElement('button');button.id='nextButtonID';button.setAttribute('aria-label',scene[1]);button.textContent=scene[1];button.onclick=()=>{window.recordReplayEvent('public_next');go(scene[2])};main.append(button)
}
window.addEventListener('message',event=>{if(event.origin!=='https://www.google.com'||!event.data?.replay)return;if(event.data.kind==='complete'){if(location.hash==='#/applynow/gettingstarted/captcha')document.querySelector('compass-ui-getting-started-captcha #nextButtonID').disabled=false}else window.recordReplayEvent(event.data.kind)});
window.addEventListener('hashchange',render);render();
</script></body></html>`;
}
