// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {fixtureRequest} from '@/lib/parent/test-fixtures';
import {NecessaryAnswer} from './necessary-answer';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('returns keyboard focus to the single current answer after reviewing a conflict',async()=>{
 const request=fixtureRequest({status:'paused'}), changed=vi.fn();
 vi.stubGlobal('fetch',vi.fn(async (_url:string,init?:RequestInit)=>init?.method==='POST'?{ok:false,status:409,json:async()=>({error:'This request changed.'})}:{ok:true,status:200,json:async()=>({request:{...request,version:2},update:{ownerId:'11111111-1111-4111-8111-111111111111',receipt:null,issuedAt:'2026-11-18T12:00:00Z',expiresAt:'2026-12-18T12:00:00Z'}})}));
 render(<NecessaryAnswer request={request} action={{id:'focus-amount',need:'electricity',reason:'missing_fact',field:'amountDue',title:'Synthetic account amount',explanation:'Synthetic only.'}} correction onChange={changed}/>);
 fireEvent.change(screen.getByLabelText('Synthetic account amount'),{target:{value:'867.53'}});
 fireEvent.click(screen.getByRole('button',{name:'Save account answer'}));
 const review=await screen.findByRole('button',{name:'Review latest question'});review.focus();fireEvent.click(review);
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
 expect(document.activeElement).toBe(screen.getByLabelText('Synthetic account amount'));
});
