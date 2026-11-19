import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentSqlFixture } from "../../../scripts/parent-sql-fixture";
import { fixtureIntake, fixtureMandate, fixtureRequest } from "./test-fixtures";
const mocks=vi.hoisted(()=>({session:vi.fn(),request:vi.fn()}));
vi.mock("./auth",()=>({requireParentSession:mocks.session}));
vi.mock("./data",async original=>({...await original<typeof import("./data")>(),getSupportRequest:mocks.request}));
import { GET, POST } from "../../app/api/parent/requests/[id]/documents/route";
import { POST as confirm } from "../../app/api/parent/requests/[id]/documents/[documentId]/route";
const modulePath=process.env.CASELINK_PARENT_SQL_FIXTURE_MODULE;
describe.skipIf(!modulePath)("actual document HTTP/data/SQL recovery with synthetic Auth and byte transport",()=>{
  let fixture:Awaited<ReturnType<typeof createParentSqlFixture>>,owner:string,session:string,id:string;
  let storageMode:"normal"|"lost_ack"|"unavailable"="normal",uploads:string[]=[];
  const origin=process.env.PARENT_TEST_ORIGIN??"https://recovery.example.invalid",bytes="%PDF-SYNTHETIC-QUARANTINE";
  async function query(sql:string,args:unknown[]=[]){
    await fixture.admin.query("set role authenticated");
    try{await fixture.admin.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:owner,session_id:session,role:"authenticated",amr:[{method:"otp"}]})]);return await fixture.admin.query(sql,args);}
    finally{await fixture.admin.query("reset role");}
  }
  beforeAll(async()=>{fixture=await createParentSqlFixture(modulePath!);vi.stubEnv("NEXT_PUBLIC_SITE_URL",origin);});
  afterAll(async()=>{await fixture?.admin.end();vi.unstubAllEnvs();});
  beforeEach(async()=>{
    owner=randomUUID();session=randomUUID();storageMode="normal";uploads=[];
    await fixture.admin.query("update parent_private.processing_controls set enabled=true,approval_reference='isolated recovery HTTP fixture',approved_until=now()+interval '1 day'");
    await fixture.admin.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[owner,`${owner}@example.invalid`]);
    await fixture.admin.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval '1 day')",[session,owner]);
    await query("select public.parent_ensure_account()");
    id=(await query("select public.parent_start_request($1,$2,$3) id",[JSON.stringify(fixtureIntake({needs:["food_now"],utilityProviders:[]})),JSON.stringify(fixtureMandate({mode:"prepare_only",recipientIds:["philly-food"],allowedActions:["research","prepare"],allowedData:["household","documents"],expiresAt:new Date(Date.now()+86400000).toISOString()})),randomUUID()])).rows[0].id as string;
    mocks.request.mockImplementation(async()=>{const row=(await query("select status from public.parent_requests where id=$1",[id])).rows[0];return fixtureRequest({id,status:row.status as ReturnType<typeof fixtureRequest>["status"]});});
    mocks.session.mockResolvedValue({supabase:{
      rpc:async(name:string,args:Record<string,unknown>)=>{try{
        if(name==="parent_register_document")return{data:(await query("select public.parent_register_document($1,$2,$3,$4,$5,$6,$7,$8) value",[args.p_request_id,args.p_filename,args.p_media_type,args.p_size_bytes,args.p_page_count,args.p_consent_version,args.p_upload_key,args.p_upload_sha256])).rows[0].value,error:null};
        if(name==="parent_confirm_document_upload"){await query("select public.parent_confirm_document_upload($1,$2)",[args.p_request_id,args.p_document_id]);return{data:null,error:null};}
        throw new Error("Unexpected fixture RPC");
      }catch(error){return{data:null,error};}},
      from:(table:string)=>{expect(table).toBe("parent_documents");const filters=new Map<string,unknown>();return{select(){return this;},eq(column:string,value:unknown){filters.set(column,value);return this;},async maybeSingle(){return{data:(await query(`select to_jsonb(d) value from public.parent_documents d where request_id=$1 and ${filters.has("id")?"id":"upload_key"}=$2`,[filters.get("request_id"),filters.get(filters.has("id")?"id":"upload_key")])).rows[0]?.value??null,error:null};}};},
      storage:{from:(bucket:string)=>({upload:async(path:string,value:Uint8Array,options:{upsert:boolean;contentType:string})=>{
        expect(bucket).toBe("parent-documents");expect(options.upsert).toBe(false);uploads.push(path);
        if(storageMode==="unavailable")return{error:new Error("Synthetic Storage unavailable")};
        await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,$2)",[path,JSON.stringify({size:value.length,mimetype:options.contentType})]);
        return{error:storageMode==="lost_ack"?new Error("Synthetic lost Storage ACK"):null};
      }})},
    }});
  });
  function input(key:string,body=bytes){const form=new FormData();form.set("consent","1");form.set("file",new File([body],"synthetic.pdf",{type:"application/pdf"}));return new Request(`${origin}/api/parent/requests/${id}/documents`,{method:"POST",headers:{origin,"Idempotency-Key":key},body:form});}
  const post=(key:string,body=bytes)=>POST(input(key,body),{params:Promise.resolve({id})});
  async function state(){return(await fixture.admin.query("select (select count(*)::int from public.parent_documents where request_id=$1) documents,(select count(*)::int from storage.objects where name like '%'||$1::text||'%') objects,(select version from public.parent_requests where id=$1) version,(select count(*)::int from public.parent_events where request_id=$1 and kind='document.upload_confirmed') confirmations",[id])).rows[0];}
  it("reconciles the original committed receipt after a lost browser acknowledgement and exact retry",async()=>{
    const key=randomUUID(),first=await post(key);expect(first.status).toBe(201);const original=(await fixture.admin.query("select * from public.parent_documents where request_id=$1",[id])).rows[0];
    // The caller loses only this response; the real handler and transaction have already finished.
    const read=await GET(new Request(`${origin}/api/parent/requests/${id}/documents?uploadKey=${key}`),{params:Promise.resolve({id})});expect((await read.json()).receipt.state).toBe("confirmed");
    expect((await post(key)).status).toBe(201);expect(uploads).toHaveLength(1);expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});
    expect((await fixture.admin.query("select * from public.parent_documents where request_id=$1",[id])).rows[0]).toEqual(original);
    expect((await post(key,"%PDF-CHANGED-SAME-KEY-INPUT")).status).toBe(409);expect(uploads).toHaveLength(1);
  });
  it("confirms actual stored metadata after an unknown Storage write acknowledgement",async()=>{
    storageMode="lost_ack";const response=await post(randomUUID());expect(response.status).toBe(201);expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});
  });
  it("confirms a reachable legacy6-argument pending row by owned id without changing its original retention",async()=>{
    const original=(await query("select to_jsonb(d) value from public.parent_register_document($1,'older.pdf','application/pdf',24,null,'2026-10-25') d",[id])).rows[0].value as {id:string;object_path:string;consented_at:string;expires_at:string};
    const context={params:Promise.resolve({id,documentId:original.id})};
    const input=()=>new Request(`${origin}/api/parent/requests/${id}/documents/${original.id}`,{method:"POST",headers:{origin,"Content-Type":"application/json"},body:"{}"});
    expect((await confirm(input(),context)).status).toBe(202);
    await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,'{\"size\":24,\"mimetype\":\"application/pdf\"}')",[original.object_path]);
    const response=await confirm(input(),context);expect(response.status).toBe(200);const body=await response.json();expect(body.receipt.document.upload_key).toBe(original.id);expect(body.receipt.state).toBe("confirmed");expect(JSON.stringify(body)).not.toMatch(/object_path|upload_sha256/);
    expect((await confirm(input(),context)).status).toBe(200);
    const row=(await fixture.admin.query("select to_jsonb(d) value from public.parent_documents d where id=$1",[original.id])).rows[0].value as Record<string,unknown>;
    expect(row.consented_at).toBe(original.consented_at);expect(row.expires_at).toBe(original.expires_at);expect(row.upload_key).toBeNull();expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});
  });
  it("resumes missing legacy bytes in the original row and immutable path after its first exact HTTP binding",async()=>{
    const original=(await query("select to_jsonb(d) value from public.parent_register_document($1,'synthetic.pdf','application/pdf',$2,null,'2026-10-25') d",[id,bytes.length])).rows[0].value as {id:string;object_path:string;consented_at:string;expires_at:string;created_at:string};
    const read=await GET(new Request(`${origin}/api/parent/requests/${id}/documents?uploadKey=${original.id}`),{params:Promise.resolve({id})});expect((await read.json()).receipt).toMatchObject({state:"pending",document:{id:original.id,upload_key:original.id}});
    const response=await post(original.id);expect(response.status).toBe(201);expect((await response.json()).receipt.document.id).toBe(original.id);expect(uploads).toEqual([original.object_path]);
    const current=(await fixture.admin.query("select to_jsonb(d) value from public.parent_documents d where id=$1",[original.id])).rows[0].value as Record<string,unknown>;expect(current.upload_key).toBe(original.id);for(const field of ["created_at","consented_at","expires_at"] as const)expect(current[field]).toBe(original[field]);
    expect((await post(original.id,"%PDF-CHANGED-SAME-KEY-INPUT")).status).toBe(409);expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});expect(uploads).toHaveLength(1);
  });
  it("resumes one pending immutable path without refreshing consent or expiry",async()=>{
    storageMode="unavailable";const key=randomUUID(),first=await post(key);expect(first.status).toBe(503);const original=(await fixture.admin.query("select * from public.parent_documents where request_id=$1",[id])).rows[0];
    const pending=await confirm(new Request(`${origin}/api/parent/requests/${id}/documents/${original.id}`,{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify({uploadKey:key})}),{params:Promise.resolve({id,documentId:original.id as string})});expect(pending.status).toBe(202);expect((await pending.json()).receipt.state).toBe("pending");
    storageMode="normal";expect((await post(key)).status).toBe(201);expect(uploads).toEqual([original.object_path,original.object_path]);
    const current=(await fixture.admin.query("select * from public.parent_documents where request_id=$1",[id])).rows[0];expect(current.consented_at).toEqual(original.consented_at);expect(current.expires_at).toEqual(original.expires_at);expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});
  });
  it.skipIf(!process.env.PARENT_TEST_ORIGIN)("reconciles actual legacy completion racing the built UI resend without adopting or replacing that completed row",async()=>{
    const target=new URL(origin);expect(target.protocol).toBe("http:");expect(["127.0.0.1","localhost"]).toContain(target.hostname);
    const original=(await query("select to_jsonb(d) value from public.parent_register_document($1,'synthetic.pdf','application/pdf',$2,null,'2026-10-25') d",[id,bytes.length])).rows[0].value as {id:string;object_path:string;created_at:string;consented_at:string;expires_at:string};
    const support=async()=>{
      const request=(await fixture.admin.query("select to_jsonb(r) value from public.parent_requests r where id=$1",[id])).rows[0].value as {version:number};
      const documents=(await fixture.admin.query("select id,request_id,filename,media_type,size_bytes,status,expires_at,created_at,upload_confirmed_at,upload_key from public.parent_documents where request_id=$1",[id])).rows;
      return JSON.parse(JSON.stringify(fixtureRequest({id,version:request.version,documents:documents as ReturnType<typeof fixtureRequest>["documents"]})));
    };
    const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();let filePosts=0,ownedReads=0;
    try{
      await context.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(url.origin==="http://127.0.0.1:55321")return route.fulfill({status:401,contentType:"application/json",body:"{}"});return route.abort();});
      await page.route("**/api/parent/**",async route=>{
        const incoming=route.request(),url=new URL(incoming.url()),path=url.pathname;
        const json=(body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
        if(path===`/api/parent/requests/${id}/documents`&&incoming.method()==="POST"){
          filePosts++;expect(incoming.headers()["idempotency-key"]).toBe(original.id);
          // The original transport really completes in SQL after the viewer requested the missing file.
          await query("insert into storage.objects(bucket_id,name,metadata) values('parent-documents',$1,$2)",[original.object_path,JSON.stringify({size:bytes.length,mimetype:"application/pdf"})]);
          await query("select public.parent_confirm_document_upload($1,$2)",[id,original.id]);
          const actual=await POST(new Request(incoming.url(),{method:"POST",headers:{origin,"Content-Type":incoming.headers()["content-type"],"Idempotency-Key":incoming.headers()["idempotency-key"]},body:new Uint8Array(incoming.postDataBuffer()!).buffer}),{params:Promise.resolve({id})});
          expect(actual.status).toBe(403);return route.fulfill({status:actual.status,contentType:"application/json",body:await actual.text()});
        }
        if(path===`/api/parent/requests/${id}/documents/${original.id}`&&incoming.method()==="POST"){
          const actual=await confirm(new Request(incoming.url(),{method:"POST",headers:{origin,"Content-Type":"application/json"},body:incoming.postData()!}),{params:Promise.resolve({id,documentId:original.id})});expect(actual.status).toBe(202);return route.fulfill({status:actual.status,contentType:"application/json",body:await actual.text()});
        }
        if(path===`/api/parent/requests/${id}/documents`&&url.searchParams.has("uploadKey")){
          ownedReads++;const actual=await GET(new Request(incoming.url()),{params:Promise.resolve({id})});return route.fulfill({status:actual.status,contentType:"application/json",body:await actual.text()});
        }
        expect(incoming.method()).toBe("GET");
        if(path==="/api/parent/account")return json({account:{id:owner,email:"synthetic@example.invalid",preferences:{language:"en",contactPreference:"in_app"}}});
        if(path==="/api/parent/requests")return json({requests:[await support()],progress:{}});
        if(path===`/api/parent/requests/${id}`)return json({request:await support(),progress:{state:"waiting",summary:"Synthetic completion race fixture",updatedAt:new Date().toISOString(),nextRunAt:null,canContinueAfterClosing:false}});
        if(path.endsWith("/operations"))return json({operations:[],historyLimited:false});
        if(path==="/api/parent/food-sites")return json({sites:[],sourceUrl:"https://www.phila.gov/food/",checkedAt:new Date().toISOString(),availability:"city_listed_unconfirmed",moreSitesAvailable:false});
        return json({capabilities:[]});
      });
      await page.goto(`${origin}/support/${id}`,{waitUntil:"networkidle"});await page.getByText("Your documents",{exact:true}).click();const section=page.locator("#application-documents");
      await section.getByRole("button",{name:"Check upload synthetic.pdf",exact:true}).click();await section.getByRole("status").filter({hasText:"Choose the original file"}).waitFor();
      await section.getByLabel("Choose a bill or notice",{exact:true}).setInputFiles({name:"synthetic.pdf",mimeType:"application/pdf",buffer:Buffer.from(bytes)});await section.getByRole("button",{name:"Upload privately",exact:true}).click();
      await section.getByRole("status").filter({hasText:"The original upload was already saved. No new file was added."}).waitFor({timeout:5000});
      expect(filePosts).toBe(1);expect(ownedReads).toBeGreaterThan(0);expect(uploads).toEqual([]);expect(await state()).toEqual({documents:1,objects:1,version:2,confirmations:1});
      const current=(await fixture.admin.query("select to_jsonb(d) value from public.parent_documents d where id=$1",[original.id])).rows[0].value as Record<string,unknown>;
      expect(current.upload_key).toBeNull();expect(current.upload_sha256).toBeNull();for(const field of ["created_at","consented_at","expires_at"] as const)expect(current[field]).toBe(original[field]);
      expect(await section.locator('input[type="file"]').count()).toBe(0);mkdirSync("tmp/parent-verification/document-upload-recovery/race",{recursive:true});await section.getByRole("status").scrollIntoViewIfNeeded();await page.screenshot({path:"tmp/parent-verification/document-upload-recovery/race/legacy-completed-before-resend.png"});
    }finally{await context.close();await browser.close();}
  },20000);

});
