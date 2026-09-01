const TRACEABLE_PRESENTATION_META = 'name="paimind:presentation-schema"'
const EXCLUSIVE_MODE_MARKER = 'data-paimind-mode-contract="exclusive-selection-v1"'
const COMPAT_MARKER = 'data-paimind-mode-compat="exclusive-selection-v1"'

const COMPAT_STYLE = `<style ${COMPAT_MARKER}>body:not([data-mode="trace"]) .trace-status{display:none!important}body:not([data-mode="trace"]) .trace-pending{animation:none!important}</style>`

const COMPAT_SCRIPT = `<script ${COMPAT_MARKER}>
(()=>{let mode=document.body.dataset.mode||'preview';
const slides=[...document.querySelectorAll('[data-slide-id]')];
const selectorFor=el=>{const kind=el.dataset.selectorKind;if(kind==='chart-point')return{kind,seriesKey:el.dataset.seriesKey,categoryKey:el.dataset.categoryKey};if(kind==='table-cell')return{kind,rowKey:el.dataset.rowKey,columnKey:el.dataset.columnKey};return{kind:'object'}};
const preservePendingSelection=()=>{document.body.dataset.traceStatus='';document.querySelectorAll('.trace-pending').forEach(node=>{node.classList.remove('trace-pending');node.classList.add('selected')})};
const clearPreviewSelection=()=>{document.body.dataset.traceStatus='';document.querySelectorAll('.selected,.trace-pending').forEach(node=>node.classList.remove('selected','trace-pending'))};
const activeSlideIndex=()=>Math.max(0,slides.findIndex(slide=>slide.classList.contains('active')));
const emitManifest=()=>{const active=activeSlideIndex();parent.postMessage({type:'paimind:bento-manifest',mode,slide:active+1,slideId:slides[active]?.dataset.slideId,slides:slides.map((slide,index)=>({slideId:slide.dataset.slideId,title:slide.querySelector('h1')?.textContent?.trim()||'Slide '+(index+1)}))},'*')};
const emitSelection=el=>{const object=el.closest('[data-object-id]');const slide=el.closest('[data-slide-id]');const slideIndex=slides.indexOf(slide);if(!object?.dataset.objectId||!slide?.dataset.slideId||!el.dataset.factId||slideIndex<0)return;document.querySelectorAll('.selected,.trace-pending').forEach(node=>node.classList.remove('selected','trace-pending'));el.classList.add('selected');document.body.dataset.traceStatus='';parent.postMessage({type:'paimind:bento-select',mode,slide:slideIndex+1,slideId:slide.dataset.slideId,objectId:object.dataset.objectId,factId:el.dataset.factId,selector:selectorFor(el)},'*')};
const previewHint=document.querySelector('.hint-preview');if(previewHint)previewHint.textContent='← / → · Navigate slides';
addEventListener('message',event=>{if(event.source!==parent)return;const data=event.data;if(!data||data.type!=='paimind:bento-mode'||!['preview','edit','trace'].includes(data.mode))return;mode=data.mode;if(mode==='preview')clearPreviewSelection();else if(mode==='edit')preservePendingSelection();emitManifest()},true);
addEventListener('click',event=>{const target=event.target instanceof Element?event.target:null;if(target===null)return;const selection=target.closest('[data-selector-kind]');if(selection===null)return;if(mode==='preview'){event.stopImmediatePropagation();return}if(mode==='trace'||(mode==='edit'&&target.closest('[data-editable="true"]')))return;event.stopImmediatePropagation();emitSelection(selection)},true)
emitManifest()
})()
</script>`

function injectBeforeClosingTag(html: string, tag: 'head' | 'body', addition: string): string {
  const pattern = new RegExp(`</${tag}\\s*>`, 'i')
  return pattern.test(html) ? html.replace(pattern, `${addition}</${tag}>`) : `${html}${addition}`
}

/** Give already-generated traceable Bento documents the current mutually-exclusive mode contract at render time. */
export function applyLegacyBentoModeCompatibility(html: string): string {
  const normalized = html.toLowerCase()
  if (!normalized.includes(TRACEABLE_PRESENTATION_META) || normalized.includes(EXCLUSIVE_MODE_MARKER) || normalized.includes(COMPAT_MARKER)) return html
  return injectBeforeClosingTag(injectBeforeClosingTag(html, 'head', COMPAT_STYLE), 'body', COMPAT_SCRIPT)
}
