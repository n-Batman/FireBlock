import {afterEach,describe,expect,it,vi} from "vitest";
import {ParcelSessionCache,fetchParcelResponse,clearParcelCache,preloadNearbyParcels} from "./parcelCache";

const caches:ParcelSessionCache[]=[];
const body=(truncated=false)=>({type:"FeatureCollection",features:[{
  type:"Feature",geometry:{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]},
  properties:{parcelId:"A",source:"county",fetchedAt:"now",owner:"must-not-retain",scan:{secret:"must-not-retain"}},
}],metadata:{truncated,source:"county",fetchedAt:"now",limit:200,note:"GIS"},secret:"must-not-retain"});
const query=(box="0,0,3,3")=>new URLSearchParams({bbox:box});
const cache=(fetcher:typeof fetch)=>{const c=new ParcelSessionCache(fetcher);caches.push(c);return c;};
const reply=(value=body(),status=200)=>new Response(JSON.stringify(value),{status});
afterEach(()=>{for(const c of caches)c.clear();caches.length=0;clearParcelCache();vi.unstubAllGlobals();vi.useRealTimers();});

describe("bounded parcel session cache",()=>{
  it("caches a full 500-parcel response but declines oversized feature counts",async()=>{
    for(const count of [500,501]){
      const value=body();value.features=Array.from({length:count},(_,i)=>({...value.features[0],properties:{...value.features[0].properties,parcelId:String(i)}}));
      value.metadata.limit=500;
      const fetcher=vi.fn().mockImplementation(async()=>reply(value));const c=cache(fetcher);
      expect((await (await c.request(query())).json()).features).toHaveLength(count);
      await c.request(query());
      expect(fetcher).toHaveBeenCalledTimes(count===500?1:2);
    }
  });
  it("calls browser-native fetch with the global receiver",async()=>{
    const fetcher=vi.fn(function(this:unknown){
      if(this!==globalThis)throw new TypeError("Illegal invocation");
      return Promise.resolve(reply());
    });
    const c=cache(fetcher);
    expect((await (await c.request(query())).json()).features).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('clears browser-session results on pagehide without writing persistent storage',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>reply());vi.stubGlobal('fetch',fetcher);
    const storage={setItem:vi.fn()};vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);
    await fetchParcelResponse(query());await fetchParcelResponse(query());expect(fetcher).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    await fetchParcelResponse(query());expect(fetcher).toHaveBeenCalledTimes(2);expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('preloads just the surrounding envelope and respects data-saving and large-view limits',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>reply());vi.stubGlobal('fetch',fetcher);
    vi.stubGlobal('navigator',{connection:{saveData:true}});
    await preloadNearbyParcels([0,0,.01,.01],new AbortController().signal);expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal('navigator',{connection:{saveData:false}});
    await preloadNearbyParcels([0,0,1,1],new AbortController().signal);expect(fetcher).not.toHaveBeenCalled();
    await preloadNearbyParcels([0,0,.01,.01],new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(1);
    const bounds=new URL(fetcher.mock.calls[0][0],'https://local.test').searchParams.get('bbox')!.split(',').map(Number);
    expect(bounds).toEqual([-.0025,-.0025,.0125,.0125]);
  });
  it("shares requests and reuses independent responses without retaining private fields",async()=>{
    const fetcher=vi.fn().mockResolvedValue(reply());const c=cache(fetcher);
    const [a,b]=await Promise.all([c.request(query()),c.request(query())]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const first=await a.json();first.features[0].properties.parcelId="changed";
    expect((await b.json()).features[0].properties.parcelId).toBe("A");
    expect(await (await c.request(query())).text()).not.toContain("must-not-retain");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({cache:"no-store",credentials:"same-origin"});
  });
  it("reuses complete surrounding coverage but filters out non-intersecting parcels",async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>reply());const c=cache(fetcher);
    await c.request(query());
    expect((await (await c.request(query("1,1,1.5,1.5"))).json()).features).toHaveLength(1);
    expect((await (await c.request(query("2.5,2.5,3,3"))).json()).features).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves hole semantics and exact point results when reusing a wider query",async()=>{
    const value=body();value.features[0].geometry.coordinates.push([[.5,.5],[.5,1.5],[1.5,1.5],[1.5,.5],[.5,.5]]);
    const fetcher=vi.fn().mockImplementation(async()=>reply(value));const c=cache(fetcher);
    await c.request(query());
    expect((await (await c.request(query('.7,.7,1.3,1.3'))).json()).features).toHaveLength(0);
    expect((await (await c.request(new URLSearchParams({lat:'1',lon:'1'}))).json()).features).toHaveLength(0);
    expect((await (await c.request(new URLSearchParams({lat:'.2',lon:'.2'}))).json()).features).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("never treats a truncated response as complete coverage",async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>reply(body(true)));const c=cache(fetcher);
    await c.request(query());await c.request(query('1,1,1.5,1.5'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("evicts old entries and removes expired data even without more requests",async()=>{
    vi.useFakeTimers();const fetcher=vi.fn().mockImplementation(async()=>reply());const c=cache(fetcher);
    for(let i=0;i<20;i++)await c.request(query(`${i*4},0,${i*4+3},3`));
    expect(c.stats.entries).toBe(16);expect(c.stats.bytes).toBeLessThanOrEqual(8*1024*1024);
    await vi.advanceTimersByTimeAsync(5*60_000+1);
    expect(c.stats).toEqual({entries:0,bytes:0,inFlight:0});expect(vi.getTimerCount()).toBe(0);
  });
  it("caps total bytes and declines oversized cache entries",async()=>{
    const large=body();large.metadata.note='x'.repeat(900_000);
    const fetcher=vi.fn().mockImplementation(async()=>reply(large));const c=cache(fetcher);
    for(let i=0;i<16;i++)await c.request(query(`${i*4},0,${i*4+3},3`));
    expect(c.stats.bytes).toBeLessThanOrEqual(8*1024*1024);expect(c.stats.entries).toBeLessThan(16);
    c.clear();large.metadata.note='x'.repeat(3*1024*1024);await c.request(query());expect(c.stats.entries).toBe(0);
  });
  it("aborting one subscriber keeps the other alive and releases all listeners",async()=>{
    let resolve!:(r:Response)=>void;
    const fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));const c=cache(fetcher);
    const a=new AbortController(),b=new AbortController();
    const removeA=vi.spyOn(a.signal,'removeEventListener'),removeB=vi.spyOn(b.signal,'removeEventListener');
    const first=c.request(query(),a.signal),second=c.request(query(),b.signal);
    const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});
    a.abort();await rejected;expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    resolve(reply());expect((await (await second).json()).features).toHaveLength(1);
    expect(removeA).toHaveBeenCalled();expect(removeB).toHaveBeenCalled();expect(c.stats.inFlight).toBe(0);
  });
  it("cancels the transport when its final subscriber leaves and ignores late results",async()=>{
    let resolve!:(r:Response)=>void;
    const fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));const c=cache(fetcher);
    const controller=new AbortController();const pending=c.request(query(),controller.signal);
    const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(reply());await new Promise(r=>setTimeout(r,0));
    expect(c.stats).toEqual({entries:0,bytes:0,inFlight:0});
  });
  it("times out hung requests, limits concurrent work and clears timers on teardown",async()=>{
    vi.useFakeTimers();const fetcher=vi.fn().mockImplementation(()=>new Promise<Response>(()=>{}));const c=cache(fetcher);
    const pending=Array.from({length:4},(_,i)=>c.request(query(`${i},0,${i+1},1`)));
    const handled=pending.map(p=>expect(p).rejects.toMatchObject({name:'AbortError'}));
    await expect(c.request(query('10,0,11,1'))).rejects.toThrow('limit');
    await vi.advanceTimersByTimeAsync(20_001);await Promise.all(handled);
    expect(c.stats.inFlight).toBe(0);expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retain failures and clearing a session cannot be undone by a late request",async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>reply(body(),502));const c=cache(fetcher);
    await c.request(query());await c.request(query());expect(fetcher).toHaveBeenCalledTimes(2);expect(c.stats.entries).toBe(0);
    let resolve!:(r:Response)=>void;
    fetcher.mockImplementation(()=>new Promise<Response>(r=>{resolve=r;}));
    const pending=c.request(query());const rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
    c.clear();await rejected;resolve(reply());await new Promise(r=>setTimeout(r,0));
    expect(c.stats).toEqual({entries:0,bytes:0,inFlight:0});
  });
});
