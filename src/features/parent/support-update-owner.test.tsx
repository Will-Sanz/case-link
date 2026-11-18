// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureRequest } from '@/lib/parent/test-fixtures';
import { NecessaryAnswer } from './necessary-answer';
import { NecessaryAnswers } from './necessary-answers';
import { PermissionEditor } from './permission-editor';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const owner='11111111-1111-4111-8111-111111111111';
const reply=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body});
function renderPaused(readStatus:number) {
  const request=fixtureRequest({status:'paused'}), changed=vi.fn(); let posted=false;
  vi.stubGlobal('fetch', vi.fn(async (_url:string, init?:RequestInit)=>{
    if(init?.method==='POST') {
      posted=true;
      return reply({update:{ownerId:owner,receipt:{id:'22222222-2222-4222-8222-222222222222',key:(init.headers as Record<string,string>)['Idempotency-Key'],requestId:request.id,action:'answer_fact',baseVersion:1,resultVersion:2,recordedAt:'2026-11-18T12:00:00Z'}}});
    }
    if(posted) return reply({error:'Synthetic current owned read unavailable.'},readStatus);
    return reply({request,update:{ownerId:owner,receipt:null,issuedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-12-18T12:00:00Z'}});
  }));
  render(<NecessaryAnswer request={request} action={{id:'private-amount',need:'electricity',reason:'missing_fact',field:'amountDue',title:'Synthetic account amount',explanation:'Synthetic value only.'}} correction onChange={changed}/>);
  fireEvent.change(screen.getByLabelText('Synthetic account amount'),{target:{value:'867.53'}});
  fireEvent.click(screen.getByRole('button',{name:'Save account answer'}));
  return {changed};
}
it.each([401,403,404])('redacts paused private draft after confirmed owned GET%s following accepted POST',async status=>{
  const {changed}=renderPaused(status);
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('Synthetic account amount')).toBeNull();
  expect(changed).toHaveBeenCalled();
});
it('retains a paused accepted private draft on a transient owned GET500',async()=>{
  const {changed}=renderPaused(500);
  await screen.findByRole('alert');
  expect(changed).not.toHaveBeenCalled();
  const input=screen.getByLabelText('Synthetic account amount') as HTMLInputElement;
  expect(input.value).toBe('867.53');expect(input.disabled).toBe(true);
});
it('reseeds only fresh owned current facts after access is restored, without retrying the discarded private packet',async()=>{
 const request=fixtureRequest({status:'paused'}), changed=vi.fn(); let posted=false, restored=false, posts=0;
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){posted=true;posts++;return reply({update:{ownerId:owner,receipt:{id:'22222222-2222-4222-8222-222222222222',key:(init.headers as Record<string,string>)['Idempotency-Key'],requestId:request.id,action:'answer_fact',baseVersion:1,resultVersion:2,recordedAt:'2026-11-18T12:00:00Z'}}});}
  if(posted&&!restored)return reply({error:'Owned read denied'},403);
  return reply({request:restored?{...request,version:2,facts:[{need:'electricity',field:'amountDue',value:0,source:'parent',confirmedAt:'2026-11-18T12:00:00Z'}]}:request,update:{ownerId:owner,receipt:null,issuedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-12-18T12:00:00Z'}});
 }));
 render(<NecessaryAnswer request={request} action={{id:'restored-amount',need:'electricity',reason:'missing_fact',field:'amountDue',title:'Synthetic account amount',explanation:'Synthetic only.'}} correction onChange={changed}/>);
 fireEvent.change(screen.getByLabelText('Synthetic account amount'),{target:{value:'867.53'}});fireEvent.click(screen.getByRole('button',{name:'Save account answer'}));
 await screen.findByRole('alert');expect(screen.queryByLabelText('Synthetic account amount')).toBeNull();
 restored=true;fireEvent.click(screen.getByRole('button',{name:'Review current saved information'}));
 const input=await screen.findByLabelText('Synthetic account amount') as HTMLInputElement;expect(input.value).toBe('0');expect(posts).toBe(1);expect(document.activeElement).toBe(input);
});
it.each(['group','permission'])('redacts the %s controls and reloads the parent after confirmed owned read loss',async kind=>{
 const request=fixtureRequest({required_actions:[{id:'owned-amount',need:'electricity',reason:'missing_fact',field:'amountDue',title:'Synthetic account amount',explanation:'Synthetic only.'}]}),changed=vi.fn();let posted=false;
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
  if(init?.method==='POST'){posted=true;const body=JSON.parse(String(init.body));return reply({update:{ownerId:owner,receipt:{id:'22222222-2222-4222-8222-222222222222',key:(init.headers as Record<string,string>)['Idempotency-Key'],requestId:request.id,action:body.action,baseVersion:1,resultVersion:2,recordedAt:'2026-11-18T12:00:00Z'}}});}
  if(posted)return reply({error:'Owned read denied'},404);
  return reply({request,update:{ownerId:owner,receipt:null,issuedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-12-18T12:00:00Z'}});
 }));
 render(kind==='group'?<NecessaryAnswers request={request} onChange={changed}/>:<PermissionEditor request={request} onChange={changed}/>);
 if(kind==='permission'){fireEvent.click(screen.getByRole('button',{name:'Change or renew permission'}));fireEvent.click(screen.getByLabelText(/I authorize these programs/));fireEvent.click(screen.getByRole('button',{name:'Save updated permission'}));}
 else {fireEvent.change(screen.getByLabelText('Your answer'),{target:{value:'867.53'}});fireEvent.click(screen.getByRole('button',{name:'Save all answers and continue'}));}
 await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();expect(changed).toHaveBeenCalledOnce();
});
it('retains the private draft when only a POST policy denial occurs and owned read access has not been lost',async()=>{
 const request=fixtureRequest({status:'paused'}),changed=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='POST'?reply({error:'Permission denied'},403):reply({request,update:{ownerId:owner,receipt:null,issuedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-12-18T12:00:00Z'}})));
 render(<NecessaryAnswer request={request} action={{id:'policy-amount',need:'electricity',reason:'missing_fact',field:'amountDue',title:'Synthetic account amount',explanation:'Synthetic only.'}} correction onChange={changed}/>);
 fireEvent.change(screen.getByLabelText('Synthetic account amount'),{target:{value:'867.53'}});fireEvent.click(screen.getByRole('button',{name:'Save account answer'}));await screen.findByRole('alert');
 expect((screen.getByLabelText('Synthetic account amount') as HTMLInputElement).value).toBe('867.53');expect(changed).not.toHaveBeenCalled();
});
