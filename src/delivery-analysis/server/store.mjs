import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export class SnapshotStore {
  constructor(directory, build) {
    this.directory=directory; this.build=build; this.snapshot=null; this.pending=null;
    this.status={refreshing:false,lastError:null,lastAttempt:null};
  }
  async load() {
    try {
      const value=JSON.parse(await readFile(join(this.directory,'published.json'),'utf8'));
      if(value.version===1 && Array.isArray(value.tasks) && value.tasks.length) this.snapshot=value;
    } catch(error) { if(error.code!=='ENOENT') this.status.lastError='已保存快照无法读取'; }
  }
  refresh() {
    if(this.pending) return this.pending;
    this.status.refreshing=true;this.status.lastAttempt=new Date().toISOString();
    this.pending=(async()=>{
      try {
        const next=await this.build();
        if(next.version!==1 || !next.tasks?.length || next.tasks.some(t=>!t.dates?.length)) throw new Error('incomplete snapshot');
        await mkdir(this.directory,{recursive:true,mode:0o700});
        const temp=join(this.directory,'published.next.json');
        await writeFile(temp,JSON.stringify(next),{mode:0o600});
        await rename(temp,join(this.directory,'published.json'));
        this.snapshot=next;this.status.lastError=null;
      } catch(error) {
        // 上游错误可能携带认证细节，不输出原始错误信息。
        this.status.lastError='最新数据准备失败，保留上次成功快照';
        console.error('delivery.snapshot.failed',error.code || error.name);
      } finally {this.status.refreshing=false;this.pending=null;}
    })();
    return this.pending;
  }
}
