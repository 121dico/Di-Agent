import { beforeEach, expect, it, vi } from 'vitest';
import { useAgentStore } from './agentStore';
import * as api from '@/api/agent';
vi.mock('@/api/agent', () => ({getDaemonMachines:vi.fn(),getAgentCandidates:vi.fn()}));
beforeEach(()=> {vi.resetAllMocks();useAgentStore.setState({machines:[],candidates:[],machinesLoaded:false,candidatesLoaded:false,machineLoading:false});});
it('候选请求完成不得提前结束电脑列表加载', async()=>{
 let finish!: (value: [])=>void;
 vi.mocked(api.getDaemonMachines).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 vi.mocked(api.getAgentCandidates).mockResolvedValue([]);
 const loading=useAgentStore.getState().fetchDaemonMachines(true);
 await useAgentStore.getState().fetchAgentCandidates(true);
 expect(useAgentStore.getState().machineLoading).toBe(true);
 finish([]);await loading;
 expect(useAgentStore.getState().machineLoading).toBe(false);
});
it('并发电脑列表加载复用同一个请求',async()=>{
 let finish!: (value: [])=>void;
 vi.mocked(api.getDaemonMachines).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const a=useAgentStore.getState().fetchDaemonMachines(true),b=useAgentStore.getState().fetchDaemonMachines(true);
 expect(api.getDaemonMachines).toHaveBeenCalledTimes(1);
 finish([]);await Promise.all([a,b]);
});
