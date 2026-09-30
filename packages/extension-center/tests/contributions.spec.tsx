import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureManagementContributionRegistry } from '../src/client/contributions.js'
import { ExtensionCenterSurface } from '../src/client/index.js'
afterEach(()=>cleanup())
const Panel=()=> <p>原扩展中心中的企业管理</p>
describe('optional original Extension Center UI owner, not authority or Browser E2E',()=>{
  it('has one detached provider, rejects duplicates and never falls back to direct controls after provider loss',()=>{
    const registry=new FeatureManagementContributionRegistry(),listener=vi.fn();registry.subscribe(listener)
    const remove=registry.register({id:'enterprise',Panel})
    expect(()=>registry.register({id:'other',Panel})).toThrow()
    remove();remove();expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.getSnapshot()).toEqual({required:true,contribution:null})
    registry.register({id:'enterprise',Panel});registry.dispose()
    expect(registry.getSnapshot()).toEqual({required:true,contribution:null})
    expect(()=>registry.register({id:'enterprise',Panel})).toThrow()
  })
  it('renders inside the original surface without calling ordinary owner mutations or reads, and locks on unload',()=>{
    const governance=new FeatureManagementContributionRegistry(),remove=governance.register({id:'enterprise',Panel})
    const read=vi.fn(),mutate=vi.fn()
    render(<ExtensionCenterSurface governance={governance} close={()=>{}} locale={{getLocale:()=>({active:'zh-CN'}),subscribe:()=>()=>{}}}
      getExtensions={()=>[]} subscribeExtensions={()=>()=>{}} listInventory={read} describeFeaturePacks={read} mutateFeaturePack={mutate}/>)
    expect(screen.getByRole('heading',{name:'扩展中心'})).toBeInTheDocument();expect(read).not.toHaveBeenCalled()
    act(()=>remove());expect(screen.getByRole('alert')).toHaveTextContent('未开放直接原生开关')
    expect(mutate).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled()
    act(()=>{governance.register({id:'enterprise',Panel})});expect(screen.getByText('原扩展中心中的企业管理')).toBeInTheDocument()
  })
})
