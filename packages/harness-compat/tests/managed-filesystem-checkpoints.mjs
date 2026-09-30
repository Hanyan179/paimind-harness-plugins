// Diagnostic-only injection through the published native filesystem's test
// internals. No upstream file is changed. The actual atomic publication, guard,
// cancellation and cleanup implementations still execute in a real process.
export function filesystemCheckpointProgram(phase, originalProgram) {
  if (phase === 'result' || phase === 'spawn') return originalProgram
  if (!['staged', 'published', 'published-lost-result'].includes(phase)) throw Error('Unknown filesystem checkpoint')
  return `await(async()=>{
    const {createRequire}=await import('node:module');const {pathToFileURL}=await import('node:url');
    const {rm,realpath}=await import('node:fs/promises');
    const r=createRequire(await realpath(process.argv[1]));const {SandboxedFileSystem}=await import(pathToFileURL(r.resolve('@deepseek-ai/dsh-fs-sandbox')).href);
    const checkpoint=()=>new Promise((resolve,reject)=>{
      let input='';const timeout=setTimeout(()=>{process.stdin.off('data',listen);reject(Error('Checkpoint cancellation missing'))},5000);
      const listen=chunk=>{input+=chunk.toString();if(!input.includes('"type":"abort"'))return;
        clearTimeout(timeout);process.stdin.off('data',listen);resolve()};
      process.stdin.on('data',listen);process.stderr.write('NATIVE_FILE_CHECKPOINT\\n');
    });
    for(const operation of ['writeText','editText']){
      const original=SandboxedFileSystem.prototype[operation];
      SandboxedFileSystem.prototype[operation]=async function(...args){
        this.internals={...this.internals,...${JSON.stringify(phase)}==='staged'?{inspectTemp:checkpoint}:{
          removeStagingDir:async path=>{await rm(path,{recursive:true,force:true});await checkpoint();
            if(${JSON.stringify(phase)}==='published-lost-result')process.exit(23)}
        }};
        return original.apply(this,args);
      };
    }
  })();\n${originalProgram}`
}
