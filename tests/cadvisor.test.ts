import { test } from 'node:test';
import assert from 'node:assert/strict';
import {getContainerObservations} from '../app/lib/adapters/cadvisor';
import {getPrometheusStatus} from '../app/lib/adapters/prometheus';
import {isInfrastructureResponse} from '../app/lib/infrastructure/contract';
test('cAdvisor preserves identity, resource availability and projection privacy', async () => {
const name='worker',now=Date.now()/1000;
const labels={job:'cadvisor',instance:'private-marker',id:'container-id',name,secret:'private-marker'};
const vector=(value:string,metric=labels)=>({status:'success',data:{resultType:'vector',result:[{metric,value:[now,value]}]}});
let mode='success';
const transport=async (_base:string,path:string)=>{
 if(path==='/-/healthy')return 'healthy';
 if(path==='/api/v1/targets')return {status:'success',data:{activeTargets:[]}};
 if(path==='/api/v1/alerts')return {status:'success',data:{alerts:[]}};
 const q=new URL('http://local'+path).searchParams.get('query')!;
 if(q.startsWith('container_last_seen'))return vector(String(mode==='stale'?now-300:now));
 assert.ok(q.includes('timestamp('));
 if(q.startsWith('rate(')){
  assert.ok(q.includes('cpu="total"'));assert.ok(q.includes('[5m]'));
  if(mode==='failed')throw Error('private-marker');
  if(mode==='empty')return {status:'success',data:{resultType:'vector',result:[]}};
  if(mode==='mismatch')return vector('2.5',{...labels,id:'different-container'});
  if(mode==='duplicate'){const v=vector('2.5');v.data.result.push(v.data.result[0]);return v;}
  return vector(mode==='invalid'?'NaN':mode==='zero'?'0':'2.5');
 }
 assert.ok(q.startsWith('container_memory_working_set_bytes'));return vector('1048576');
};
for(mode of ['success','zero','failed','empty','mismatch','duplicate','invalid','stale']){
 const result=await getContainerObservations('http://local','container_last_seen{job="cadvisor",name!=""}',{},transport);
 assert.equal(result.state,'available');assert.equal(result.data?.[0].name,name);
 assert.equal(result.data?.[0].cpuCores?.state,['success','zero'].includes(mode)?'available':'unavailable');
 assert.equal(result.data?.[0].memoryWorkingSetBytes?.state,mode==='stale'?'unavailable':'available');
 if(mode==='zero')assert.equal(result.data?.[0].cpuCores?.data?.value,0);
 assert.ok(!JSON.stringify(result).includes('private-marker'));
}
mode='success';process.env.PROMETHEUS_URL='http://local';process.env.PROMETHEUS_CONTAINER_QUERY='container_last_seen{job="cadvisor",name!=""}';
const adapter=await getPrometheusStatus({id:'athena',name:'Athena',type:'vm',description:'',adapters:['prometheus'],network:{}},transport);
assert.equal(adapter.data?.containers?.data?.[0].cpuCores?.data?.value,2.5);
const response={ok:true,schemaVersion:1,timestamp:new Date().toISOString(),hosts:[{host:{id:'athena',name:'Athena'},status:'online',statusSource:'Prometheus',timestamp:new Date().toISOString(),adapters:{prometheus:adapter}}]};
assert.ok(isInfrastructureResponse(response));
adapter.data!.containers!.data![0].cpuCores!.data!.value={} as any;
assert.equal(isInfrastructureResponse(response),false);
console.log('Focused Athena checks passed: real zero, multi-core CPU, independent failure, missing/mismatched/duplicate/invalid/stale samples, adapter integration, contract validation and label redaction.');

});
