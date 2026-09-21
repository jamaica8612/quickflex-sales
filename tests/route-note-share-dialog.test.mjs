import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildRouteNoteShareUrl, normalizeRouteNoteShareDays } from '../src/services/route-note-share.js';
const source=readFileSync(new URL('../src/ui/route-note-share.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createRouteNoteShareDialog','function createRouteNoteShareDialog');
function dom(){
 const document={listeners:{},activeElement:null,addEventListener(name,fn){this.listeners[name]=fn;},removeEventListener(name){delete this.listeners[name];}};
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.listeners={};this.text='';this.disabled=false;this.hidden=false;}
  append(child){child.parent=this;this.children.push(child);}
  replaceChildren(...children){this.children=[];for(const child of children)this.append(child);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  setAttribute(name,value){this.attrs[name]=String(value);if(name==='hidden')this.hidden=true;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
  set textContent(text){this.text=String(text);this.children=[];}
  set value(value){this._value=String(value);}
  get value(){return this._value??(this.tag==='select'?(this.children.find(x=>x.selected)||this.children[0])?.attrs.value:this.attrs.value)??'';}
  focus(){document.activeElement=this;}
  select(){this.wasSelected=true;}
  all(){return this.children.flatMap(c=>[c,...c.all()]);}
  querySelector(selector){return this.all().find(e=>selector[0]==='.'?String(e.className||'').split(' ').includes(selector.slice(1)):selector[0]==='['?Object.hasOwn(e.attrs,selector.slice(1,-1)):e.tag===selector);}
  querySelectorAll(){return this.all().filter(e=>['button','input','select'].includes(e.tag)&&!e.disabled&&!e.hidden);}
 }
 document.body=new Element('body');document.createElement=tag=>new Element(tag);return document;
}
const zone={id:'20000000-0000-4000-8000-000000000001',name:'예시 구역'};
const share={id:'30000000-0000-4000-8000-000000000001',token:'a'.repeat(64),expires_at:'2026-10-01T00:00:00Z'};
function dialog({create=async()=>share,clipboard}={}){
 const document=dom(),context={document,navigator:clipboard?{clipboard}: {},window:{confirm:()=>true},URL,Intl,buildRouteNoteShareUrl,normalizeRouteNoteShareDays};
 runInNewContext(source,context);
 const controller=context.createRouteNoteShareDialog({service:{create,list:async()=>[],update:async()=>share},getShareBaseUrl:()=> 'https://example.invalid/app/index.html'});
 controller.open({zone});return {document,controller,button:text=>document.body.all().find(e=>e.tag==='button'&&e.textContent===text)};
}
async function click(button){const event={currentTarget:button};const promise=button.listeners.click(event);event.currentTarget=null;await promise;}
test('share dialog defaults to seven days, allows retry after failure and exposes an explicit copy action',async()=>{
 let count=0,days;const d=dialog({create:async(id,value)=>{days=value;if(++count===1)throw new Error('일시 실패');return share;}});
 await Promise.resolve();const button=d.button('링크 만들기');
 await click(button);assert.equal(button.disabled,false);assert.match(d.document.body.textContent,/일시 실패/);
 await click(button);assert.equal(days,7);assert.equal(button.disabled,false);
 const copy=d.button('링크 복사');assert.ok(copy);assert.equal(copy.hidden,false);
 await click(copy);assert.doesNotMatch(d.document.body.textContent,/복사했습니다/);
 assert.match(d.document.body.textContent,/복사/);
});
test('closing an in-flight share dialog prevents its result from leaking into the next zone dialog',async()=>{
 let finish;const d=dialog({create:()=>new Promise(resolve=>{finish=resolve;})});await Promise.resolve();
 const pending=click(d.button('링크 만들기'));d.controller.reset();d.controller.open({zone:{...zone,name:'다음 구역'}});finish(share);await pending;
 assert.match(d.document.body.textContent,/다음 구역/);assert.ok(!d.document.body.all().some(e=>e.value?.includes(share.token)));
 assert.equal(d.button('링크 만들기').disabled,false);assert.equal(d.controller.isOpen(),true);assert.equal(d.controller.handleBack(),true);assert.equal(d.controller.isOpen(),false);
});
