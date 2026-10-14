import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { renderToBuffer } from "@react-pdf/renderer";
import { PlanPdfDocument } from "../src/features/families/plan-pdf-document";
import { finalizePlanPdf } from "../src/lib/domain/plan/finalize-plan-pdf";
import { actionTargetDate, actionUiStatus, actionUserNotes } from "../src/lib/domain/plan/action-state";
import { formatDateOnly } from "../src/lib/dates";
import { pdfPlanFixtures } from "../tests/fixtures/pdf-plans";

// Synthetic fixtures only. No database, environment file, browser session, or provider access.
async function main() {
  const directory=resolve(process.env.CASELINK_PDF_EVIDENCE_DIR ?? "tmp/pdfs/export-regressions");
  mkdirSync(directory,{recursive:true});
  const manifest=[];
  for(const fixture of pdfPlanFixtures()) {
    const file=resolve(directory,`${fixture.name}.pdf`);
    const bytes=await finalizePlanPdf(await renderToBuffer(PlanPdfDocument({plan:fixture.plan,familyName:"Family 014",generatedDate:"Oct 13, 2026",barrierLabels:fixture.barriers})));
    writeFileSync(file,bytes);
    const requiredText=["Family Support Intervention Plan","Family 014","Oct 13, 2026","Plan version: 7","Plan status: Reviewed",fixture.plan.summary!,...fixture.barriers,...(fixture.expectedText??[])];
    for(const step of fixture.plan.steps) {
      requiredText.push(step.title,step.description,step.details?.stage_goal??"",step.details?.expected_outcome??"",...(step.details?.required_documents??[]));
      for(const contact of step.details?.contacts??[])requiredText.push(...[contact.name,contact.phone,contact.email,contact.notes].filter((text):text is string=>Boolean(text)));
      for(const action of step.action_items??[])requiredText.push(action.title,action.description??"",actionUserNotes(action.notes),action.outcome??"",actionUiStatus(action).replaceAll("_"," "),formatDateOnly(actionTargetDate(action))??"Not required");
    }
    const goalStarts=fixture.plan.steps.map(step=>({title:step.details!.stage_goal,followingText:step.title.slice(0,32)}));
    manifest.push({...fixture,plan:undefined,file,goalStarts,requiredText:requiredText.filter(Boolean),forbiddenText:["[[caselink:","2020","undefined","null"]});
  }
  const manifestFile=resolve(directory,"manifest.json");
  writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
  execFileSync(process.env.CASELINK_PYTHON_BIN??"python3",[resolve("scripts/verify-plan-pdfs.py"),manifestFile],{stdio:"inherit"});
}
main().catch(error=>{console.error(error instanceof Error?error.message:"PDF verification failed");process.exitCode=1;});
