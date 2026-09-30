import { describe, expect, it } from 'vitest'
import { createHarnessInstructionRead, decodeHarnessInstructionConfiguration, normalizeHarnessInstructions,
  prepareHarnessInstructionChange } from '../src/instruction-configuration.js'
const ns='paimind-enterprise-instructions',rpcId='instructions-test'
const reply=(value:unknown,id=rpcId)=>JSON.stringify({type:'server-response',rpcId:id,result:{ok:true,value}})
const row=(extra={})=>({ns,schema:{private:'DO_NOT_RETURN'},value:{enabled:true,instructions:'Original'},base:{private:'DO_NOT_RETURN'},
  user:{private:'DO_NOT_RETURN'},secrets:[],applies:'live',revision:3,...extra})
const described=(namespaces=[row()],extra={})=>reply({writable:true,hasDocument:true,namespaces,...extra})
const state=()=>decodeHarnessInstructionConfiguration(described(),rpcId)
const failure=(code:string,details:object)=>JSON.stringify({type:'server-response',rpcId,result:{ok:false,error:{code,details,message:'PRIVATE_FAILURE'}}})
describe('fixed native instruction carrier, not an authority grant',()=>{
  it('projects only original enterprise values and refuses missing, duplicate or wrong-correlation reads',()=>{
    expect(createHarnessInstructionRead(rpcId)).toEqual({path:'/api/settings.describe',body:JSON.stringify({type:'client-request',rpcId,method:'settings.describe',payload:{}})})
    expect(state()).toEqual({enabled:true,instructions:'Original',revision:3,writable:true,applies:'live'})
    expect(JSON.stringify(state())).not.toContain('DO_NOT_RETURN')
    for(const wire of [described([]),described([row(),row()]),reply({writable:true,hasDocument:true,namespaces:[row()]},'wrong'),
      described([row({secrets:[{path:['instructions'],set:true}]})]),described([row({applies:'restart'})]),'broken']){
      expect(()=>decodeHarnessInstructionConfiguration(wire,rpcId)).toThrow('Native enterprise instructions unavailable')
    }
  })
  it('prepares only the fixed namespace, exact desired fields and mandatory native revision',()=>{
    const desired={enabled:false,instructions:' Preserve {{literal}}\n中文 '}
    const wire=prepareHarnessInstructionChange(state(),desired,rpcId)
    expect(wire.path).toBe('/api/settings.update')
    expect(JSON.parse(wire.body)).toEqual({type:'client-request',rpcId,method:'settings.update',payload:{ns,patch:desired,expectedRevision:3}})
    expect(wire.decode(reply(row({value:desired,revision:4})))).toEqual({status:'applied',value:{...desired,revision:4,writable:true,applies:'live'}})
  })
  it('rejects unsupported fields, types, length and non-writable or invalid revisions',()=>{
    for(const input of [null,[],{enabled:'yes',instructions:''},{enabled:true,instructions:1},{enabled:true,instructions:'x'.repeat(8001)},
      {enabled:true,instructions:'',namespace:'other'}])expect(()=>normalizeHarnessInstructions(input)).toThrow()
    for(const revision of [-1,1.5,Number.MAX_SAFE_INTEGER,NaN])expect(()=>prepareHarnessInstructionChange({...state(),revision},{enabled:true,instructions:''},rpcId)).toThrow()
    expect(()=>prepareHarnessInstructionChange({...state(),writable:false},{enabled:true,instructions:''},rpcId)).toThrow()
  })
  it('requires exact ack value/revision/correlation and never treats post-persistence errors as no effect',()=>{
    const desired={enabled:true,instructions:'New'},wire=prepareHarnessInstructionChange(state(),desired,rpcId)
    for(const response of [reply(row({value:desired}),'wrong'),reply(row({value:desired,ns:'other'})),reply(row({value:desired,revision:2})),
      reply(row({value:{...desired,instructions:'different'}})),failure('settings-rejected',{ns}),failure('settings-conflict',{ns:'other',expected:3}),
      failure('settings-conflict',{ns,expected:2}),reply(row({value:desired,applies:'restart'}))]){
      expect(wire.decode(response)).toEqual({status:'unconfirmed'})
    }
    expect(wire.decode(failure('settings-conflict',{ns,expected:3,actual:4}))).toEqual({status:'conflict'})
  })
})
