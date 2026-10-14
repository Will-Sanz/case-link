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
  // Reproduce the live synthetic plan whose second goal's last task overlapped the footer.
  const boundary = [
    {
      ...step(101),
      title: "Agree practical food and transport priorities",
      description: "Ask which food and transportation needs matter most, preferred supports, safe contact preferences, language needs, and consent for follow-up.",
      details: {
        owner: "case_manager" as const,
        stage_goal: "Clarify immediate food and transportation priorities",
        detailed_instructions: "Eligibility, availability, and service status are not recorded; verify them before discussing specific programs or appointments.",
        expected_outcome: "The family’s priorities, preferences, consent, and safe contact limits are documented for the next planning phase.",
      },
      action_items: [
        {...action(101), title: "Confirm the agreed transport and food-access next step", description: "Review current food and transportation barriers with the family and record only their stated priorities and preferences.", status: "blocked" as const, follow_up_date: "2026-10-21", notes: "Waiting for the family to confirm a preferred review time."},
        {...action(102), title: "Document agreed next steps", description: "Record consent, safe contact restrictions, and any requested follow-up for human review.", target_date: "2026-10-23"},
      ],
    },
    {
      ...step(102), priority: "medium" as const,
      title: "Review prior plan progress",
      description: "Check whether the family-priorities conversation and agreed actions occurred; record outcomes, barriers, and any status not recorded.",
      details: {
        owner: "case_manager" as const,
        stage_goal: "Follow through on food and transportation priorities",
        detailed_instructions: "Do not infer service status from missing records; record it as not recorded.",
        expected_outcome: "Current progress and any unresolved food or transportation needs are documented for the next planning decision.",
      },
      action_items: [
        {...action(103), title: "Review documented follow-through", description: "Confirm whether the earlier conversation and agreed next steps occurred, without treating proposals as completed.", target_date: "2026-11-18"},
        {...action(104), title: "Update the family support plan", description: "If needs remain unresolved, document the family’s preferred next steps and safe contact preferences for human review.", target_date: "2026-12-09"},
      ],
    },
    {
      ...step(103), priority: "medium" as const,
      title: "Complete the 90-day family progress review",
      description: "Review documented outcomes, discuss remaining food or transportation needs, and record the family's preferred next step.",
      details: {
        owner: "case_manager" as const,
        stage_goal: "Review food and transportation progress and confirm the family's next choice",
        detailed_instructions: "If the record shows an immediate safety concern, seek responsible human assessment through the school's approved safeguarding or emergency pathway immediately.",
        expected_outcome: "The family's progress and preferred next step are documented for human review.",
      },
      action_items: [
        {...action(105), title: "Review documented progress and barriers", description: "Check recorded outcomes from the prior plan and identify any unresolved food or transportation needs.", target_date: "2027-01-07"},
        {...action(106), title: "Confirm the family's next choice", description: "Ask whether the family wants to continue, revise, or conclude support and document their decision.", target_date: "2027-01-09"},
      ],
    },
  ];
  return [
    {name:"dated-states",plan:plan([dated]),barriers:["Housing","Transportation"],minimumPages:1,expectedText:["1 of 6 actions complete"]},
    {name:"many-goals",plan:plan(many),barriers:["Housing","Food access","Childcare"],minimumPages:3},
    {name:"maximum-fields",plan:plan([maximum]),barriers:["Housing"],minimumPages:3},
    {name:"latin-characters",plan:plan([accented]),barriers:["Educación & formación"],minimumPages:1},
    {name:"hosted-page-boundary",plan:{...plan(boundary),summary:null},barriers:["No transportation","Food insecurity"],minimumPages:2},
  ];
}
