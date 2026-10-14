import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire=createRequire(import.meta.url);
/** Each loader has isolated files, modules and environment; tests never read real credentials. */
export function createLoader(mocks:Record<string,unknown>={},globals:Record<string,unknown>={}) {
  const files=new Map<string,string>();const cache=new Map<string,{exports:Record<string,unknown>}>();
  const localFs={existsSync:(file:string)=>files.has(file),readFileSync:(file:string)=>files.get(file),writeFileSync:(file:string,value:string)=>files.set(file,value)};
  const load=<T>(file:string):T=>{
    const resolved=path.resolve(file);
    if(cache.has(resolved))return cache.get(resolved)!.exports as T;
    const sandboxModule={exports:{} as Record<string,unknown>};cache.set(resolved,sandboxModule);
    const source=ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    const requireModule=(id:string):unknown=>{
      if(id in mocks)return mocks[id];
      if(id==='fs'||id==='node:fs')return localFs;
      if(id.startsWith('.')||id.startsWith('@/')) {
        const target=id.startsWith('@/')?path.resolve(id.slice(2)):path.resolve(path.dirname(resolved),id);
        const normalized=target.replaceAll('\\','/');
        if(normalized in mocks)return mocks[normalized];
        if(`@/${path.relative(process.cwd(),target).replaceAll('\\','/')}` in mocks)return mocks[`@/${path.relative(process.cwd(),target).replaceAll('\\','/')}`];
        return load(fs.existsSync(`${target}.ts`)?`${target}.ts`:target);
      }
      return nativeRequire(id);
    };
    vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,require:requireModule,Buffer,URL,URLSearchParams,Error,AbortSignal,TextEncoder,TextDecoder,
      Uint8Array,Response,Request,Headers,console,setTimeout,clearTimeout,setInterval,clearInterval,structuredClone,
      process:{env:{},cwd:()=>'/isolated'},...globals},{filename:resolved});
    return sandboxModule.exports as T;
  };
  return {load,files};
}
