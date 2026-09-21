import { createRouteNotesController } from '../../src/ui/route-notes.js?fixture=apk-usability';
import { ROUTE_NOTES_CONFIG } from '../../src/config.js';
if (new URLSearchParams(location.search).has('phone')) document.body.dataset.phone = 'true';
const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const company = {id:uuid('1'),name:'우리 회사 · 예시'};
const user = {id:uuid('2')};
let profile = {...user,status:'approved',role:'driver',driver_type:'fixed',fixed_routes:['303A302B']}, role='member', mode='ready';
let zones = ['303D','304C','303A'].map((name,i)=>({id:uuid(String(i+4)),company_id:company.id,name,memo:i ? '구역 공통 안내' : '동문 진입 · 배송 팁을 확인해 주세요.',polygon:{type:'Polygon',coordinates:[[[129.05+i*.016,35.16],[129.06+i*.016,35.16],[129.06+i*.016,35.17],[129.05+i*.016,35.16]]]},created_by:user.id,updated_at:'2026-09-21T10:00:00Z'}));
let tips=[{id:uuid('8'),company_id:company.id,zone_id:zones[0].id,created_by:user.id,author_name:'김기사',updated_at:'2026-09-21T10:00:00Z',title:'동문 주차 위치',memo:'동문 안쪽 배송 공간에 잠시 주차하세요.',marker_type:'parking',lat:35.165,lng:129.055,photos:[]},{id:uuid('9'),company_id:company.id,zone_id:zones[0].id,created_by:uuid('3'),author_name:'박기사',updated_at:'2026-09-21T10:00:00Z',title:'야간 진입 안내',memo:'경비실 확인 후 오른쪽 입구로 이동하세요.',marker_type:'entrance',lat:35.166,lng:129.056,photos:[]}];
let favorites=[];
const copy = (value)=>structuredClone(value);
const service={
  async load(){ if(mode==='failed') throw new Error('연결을 확인한 뒤 다시 시도해 주세요.'); return copy({company,membership:{company_id:company.id,user_id:user.id,role},zones:mode==='empty'?[]:zones,favorites}); },
  async loadZone(id){return copy({zone:zones.find(z=>z.id===id),tips:tips.filter(t=>t.zone_id===id)});},
  async setFavorite(id,value){favorites=value?[...new Set([...favorites,id])]:favorites.filter(z=>z!==id);return value;},
  async saveZone(input){const saved={...input,id:input.id||crypto.randomUUID(),company_id:company.id,created_by:user.id,updated_at:new Date().toISOString()};zones=zones.filter(z=>z.id!==saved.id).concat(saved);return copy(saved);},
  async saveTip(input){await new Promise(resolve=>setTimeout(resolve,100));const saved={...input,id:input.id||crypto.randomUUID(),company_id:company.id,created_by:user.id,author_name:'김기사',photos:[],updated_at:new Date().toISOString()}; tips=tips.filter(t=>t.id!==saved.id).concat(saved);return copy(saved);},
  async deleteTip(id){tips=tips.filter(t=>t.id!==id);},
  async uploadTipPhoto(){throw new Error('사진 업로드 실패 검증: 메모는 이미 저장되었습니다.');},
  async deleteTipPhoto(){},
};
const controller=createRouteNotesController({root:document.querySelector('#fixture'),service,getUser:()=>user,getProfile:()=>profile,notify:(message)=>{document.querySelector('#result').textContent=message;},mapClientId:new URLSearchParams(location.search).has('live-map')?ROUTE_NOTES_CONFIG.mapClientId:''});
document.querySelector('#member').onclick=()=>{role='member';mode='ready';controller.open();};
document.querySelector('#admin').onclick=()=>{role='admin';mode='ready';controller.open();};
document.querySelector('#fixed').onclick=()=>{profile={...user,status:'approved',role:'driver',driver_type:'fixed',fixed_routes:['303A302B']};mode='ready';controller.open();};
document.querySelector('#theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';};
document.querySelector('#empty').onclick=()=>{mode='empty';controller.open();};
document.querySelector('#failed').onclick=()=>{mode='failed';controller.open();};
document.querySelector('#logout').onclick=()=>{profile=null;controller.reset();};
controller.open();
