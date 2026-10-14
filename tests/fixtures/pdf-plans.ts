import type { PlanStepActionItemRow, PlanStepRow, PlanWithSteps } from "../../src/types/family";
import { encodeActionNotes } from "../../src/lib/domain/plan/action-state";

const stamp = "2026-10-13T12:00:00Z";
function action(index: number): PlanStepActionItemRow {
  return {id:`action-${index}`,plan_step_id:"step",title:`Action ${index}: confirm the next intake option`,description:`Action details ${index}: discuss the agreed materials.`,week_index:1,
    target_date:"2026-10-20",status:"pending",sort_order:index,outcome:null,notes:null,follow_up_date:null,created_at:stamp,updated_at:stamp};
}
function step(index: number): PlanStepRow {
  return {id:`step-${index}`,plan_id:"plan",phase:"30",title:`Goal task ${index}: prepare agreed materials`,description:`Summary ${index}: discuss the family's priorities.`,
    status:"pending",priority:"high",due_date:null,assigned_to_id:null,sort_order:index,created_at:stamp,updated_at:stamp,
    details:{stage_goal:`Goal ${index}: prepare for intake`,owner:"shared",expected_outcome:`Expected result ${index}: the agreed checklist is ready.`,required_documents:[`Document ${index}: agreed checklist`]},action_items:[action(index)]};
}
function plan(steps: PlanStepRow[]): PlanWithSteps {
  return {id:"10000000-0000-4000-8000-000000000001",family_id:"20000000-0000-4000-8000-000000000002",version:7,summary:"Preserve the family's priorities and agreed next steps.",generation_source:"manual",ai_model:null,
    created_at:stamp,review_revision:"a".repeat(64),material_revision:"b".repeat(64),resource_contacts_current:true,
    client_display:{reviewedAt:stamp,reviewedById:"30000000-0000-4000-8000-000000000003",reviewedRevision:"b".repeat(64)},presentation:{sourceKind:"manual"},steps};
}
export function pdfPlanFixtures(): Array<{name:string;plan:PlanWithSteps;barriers:string[];minimumPages:number;expectedText?:string[]}> {
  const dated=step(1);
  dated.details!.contacts=[{source_resource_id:"40000000-0000-4000-8000-000000000004",source_updated_at:stamp,name:"Directory intake program",phone:"215-555-0148",email:"intake@example.test",notes:"Confirm current availability and eligibility before referring."}];
  dated.action_items=[
    {...action(1),title:"Pending dated action"},
    {...action(2),title:"Started dated action",status:"in_progress"},
    {...action(3),title:"Waiting for a callback",status:"blocked",target_date:"2020-01-01",follow_up_date:"2026-11-01",notes:"Waiting for the program's response."},
    {...action(4),title:"Completed intake preparation",status:"completed",target_date:null,outcome:"The preparation is complete."},
    {...action(5),title:"Withdrawn duplicate request",status:"completed",target_date:null,notes:encodeActionNotes("Family chose another option.",true)},
    {...action(6),title:"Future leap-day review",target_date:"2028-02-29"},
  ];
  const many=Array.from({length:8},(_,index)=>{
    const s=step(index+10); s.details!.owner=(["case_manager","family","shared","school_program"] as const)[index%4];
    s.description=Array.from({length:8},(_,part)=>`Narrative${index}part${part} confirms an agreed priority and preserves the family's preferences.`).join(" ");
    s.action_items=Array.from({length:5},(_,a)=>({...action(index*10+a+20),plan_step_id:s.id,notes:`Progress${index}part${a}: waiting for the agreed review.`,outcome:`Outcome${index}part${a}: options discussed.`}));
    return s;
  });
  const maximum=step(90);
  maximum.title=`Maximum title ${"clear action wording ".repeat(24)}`.slice(0,500);
  maximum.details!.stage_goal=`Maximum goal ${"agreed outcome ".repeat(40)}`.slice(0,500);
  maximum.description=Array.from({length:45},(_,i)=>`MaximumNarrative${i}: preserve this agreed context and discuss the next step with the family.`).join(" ").slice(0,4000);
  maximum.details!.required_documents=["DocumentFilename"+"x".repeat(470)];
  maximum.details!.expected_outcome="ExpectedResultMaximum: the family and case manager agree on the next step.";
  maximum.action_items![0].title="MaximumActionTitle "+"detailed task wording ".repeat(21);
  maximum.action_items![0].description=Array.from({length:100},(_,i)=>`MaximumActionDescription${i}: confirm the next step.`).join(" ").slice(0,4000);
  maximum.action_items![0].notes=Array.from({length:24},(_,i)=>`MaximumProgress${i}: preserve this note about the agreed options for the upcoming review.`).join(" ").slice(0,2000);
  maximum.action_items![0].outcome=Array.from({length:60},(_,i)=>`MaximumOutcome${i}: the option was discussed.`).join(" ").slice(0,2000);
  const accented=step(99);
  accented.description="Información: cafe\u0301, re\u0301sume\u0301, naïve, façade, coöperate, piñata. Préparer l’entretien. Cost example £25 / €30. Quote: “confirm options” - then follow up.";
  accented.details!.expected_outcome="The café’s résumé checklist is ready & the follow-up is agreed.";
  return [
    {name:"dated-states",plan:plan([dated]),barriers:["Housing","Transportation"],minimumPages:1,expectedText:["1 of 6 actions complete"]},
    {name:"many-goals",plan:plan(many),barriers:["Housing","Food access","Childcare"],minimumPages:3},
    {name:"maximum-fields",plan:plan([maximum]),barriers:["Housing"],minimumPages:3},
    {name:"latin-characters",plan:plan([accented]),barriers:["Educación & formación"],minimumPages:1},
  ];
}
