// list 52 (2026-10-01) — the ENHANCE window and its doors, the real panels in offscreen Electron with
// real test clips: the before/after monitor (both play on one clock, a slow-motion copy at its own
// rate, the slide bar, replay speed, zoom), the two cards with their engines, models and settings,
// every blocker said before the click, the free preview, the job it queues, the Optical Flow ask; the
// outlines on Clip Gen takes and Library videos, the right-click entries, and Optical Flow in the
// speed dialog. The app's API is a stand-in and the queue is caught: nothing renders, nothing is spent.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-enhance-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const FF = require('ffmpeg-static')
  const mk = (name, src) => {
    const r = spawnSync(FF, ['-v', 'error', '-f', 'lavfi', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(tmp, name)])
    if (r.status !== 0) throw Error(String(r.stderr))
    return path.join(tmp, name).replaceAll('\\', '/')
  }
  const M = { before: mk('before.mp4', 'testsrc2=s=64x64:r=24:d=2'), copy: mk('copy.mp4', 'testsrc2=s=512x512:r=48:d=2'), slow: mk('slow.mp4', 'testsrc2=s=64x64:r=24:d=4') }
  const bootstrap = path.join(tmp, 'bootstrap.ts').replaceAll('\\', '/')
  fs.writeFileSync(bootstrap, `import {setVidancerApi} from '${ui}/api';setVidancerApi({projectRecents:async()=>[]});`)
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import '${bootstrap}';
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {EnhancePanel} from '${ui}/panels/EnhancePanel'; import {RenderPanel} from '${ui}/panels/RenderPanel';
    import {LibraryPanel} from '${ui}/panels/Library'; import {TimelinePanel} from '${ui}/panels/Timeline';
    import {setVidancerApi} from '${ui}/api'; import {useStore} from '${ui}/store'; import {setMediaBase} from '${ui}/media';
    import {setEnhanceOpener} from '${ui}/panelBus'; import {MIME_VIDEO} from '${ui}/lib/dragDrop';
    const M=${JSON.stringify(M)};
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const until=async(fn,ms,what)=>{const t0=Date.now();while(Date.now()-t0<ms){if(fn())return;await tick(50)}throw Error('timed out: '+what)};
    const has=s=>document.body.textContent.includes(s);
    const lab=e=>e.textContent.replace('✓','').trim();
    const rows=()=>[...document.querySelectorAll('div')].filter(e=>e.style.padding==='6px 10px'&&e.style.borderRadius==='4px');
    const cur=t=>[...t.querySelectorAll('span')].find(s=>s.style.gridArea&&s.style.visibility!=='hidden')?.textContent;
    const pick=async(trigger,label)=>{trigger.click();await tick();const r=rows().find(x=>lab(x)===label);check(r,'no option '+label+' in '+rows().map(lab).join('|'));r.click();await tick(120)};
    const closeDd=async()=>{[...document.querySelectorAll('div')].find(d=>d.style.zIndex==='2400')?.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await tick()};
    const after=()=>document.querySelector('[data-after]'),before=()=>document.querySelector('[data-before]');
    const sec=n=>document.querySelector('[data-section="'+n+'"]');
    const pills=n=>[...sec(n).querySelectorAll('[data-pill]')];
    const trigs=n=>[...sec(n).querySelectorAll('div[tabindex="0"]')];
    const trigAfter=text=>[...document.querySelectorAll('span')].find(s=>s.textContent.trim()===text).nextElementSibling;
    const runBtn=()=>document.querySelector('[data-run]'),plan=()=>document.querySelector('[data-plan]').textContent;
    const ctrlR=()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'r',ctrlKey:true,bubbles:true,cancelable:true}));
    const setVal=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      setMediaBase(f=>'file:///'+f);
      let settings={falKey:'masked'};const patches=[],previews=[],jobs=[],writes=[];let raised=0;
      const tools={topaz:{found:true,detail:'Topaz Video — 1 frame models, 1 enhance models',interp:[{id:'apo-8',name:'Apollo',desc:'slow motion',sliders:[]}],upscale:[{id:'prob-4',name:'Proteus',sliders:[{key:'noise',label:'reduce noise',min:-1,max:1,def:0.1}]}]},rife:false,esrgan:true};
      const api={projectRecents:async()=>[],getSettings:async()=>({...settings}),setSettings:async p=>{patches.push(p);settings={...settings,...p};return {...settings}},
        enhanceTools:async()=>tools,enhanceFacts:async()=>({w:1280,h:720,fps:24,sec:5}),enhancePreview:async a=>{previews.push(a);return {ok:true,file:M.slow}},
        modelsList:async()=>({rows:[]}),modelsDiskFree:async()=>null,localStatus:async()=>({}),ltxStatus:async()=>({}),imageGenLoras:async()=>[],imageGenFolders:async()=>[],moodList:async()=>[],mediaReverse:async()=>({ok:true})};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      setEnhanceOpener(()=>raised++);
      const pd={engine:'seedance2',mode:'t2v',freeform:'',scene:{title:'',referenceHandling:'',style:'',visualFeel:''},characters:[],beats:[],production:{audioDesign:'',lighting:'',subtext:'',criticalConstraint:'',avoid:''},imageIds:[],duration:'2',resolution:'720p',aspectRatio:'16:9',generateAudio:true};
      const I2={engine:'rife-local',times:2,slowmo:1},S2={engine:'rife-local',times:1,slowmo:2},U2={engine:'realesrgan-local',scale:2};
      const tk=(id,file,sec,enhanced)=>({id,file,createdAt:1,engine:'seedance2',durationSec:sec,snapshot:pd,...(enhanced?{enhanced}:{})});
      const clipA={id:'a',name:'Turn',promptData:pd,takes:[tk('t1',M.before,2),tk('t2',M.copy,2,{of:'t1',interp:I2,upscale:U2}),tk('t3',M.slow,4,{of:'t1',interp:S2})],keeperTakeId:'t1',keeperIds:['t1']};
      const clipB={id:'b',name:'Spin',promptData:pd,takes:[tk('b1',M.before,2),tk('b2',M.copy,2,{of:'b1',interp:I2})],keeperTakeId:'b1',keeperIds:['b1']};
      const videos=[{id:'v1',title:'Walk',file:M.before,durationSec:2},{id:'v2',title:'Walk · upscaled ×2',file:M.copy,durationSec:2,enhanced:{of:'v1',upscale:U2}}];
      const tl={id:'tl',name:'Main',aspectRatio:'16:9',items:[{id:'A',clipId:'b',startSec:0,track:0},{id:'B',clipId:'b',takeId:'b1',startSec:2,track:0},{id:'C',clipId:'a',startSec:4,track:0}],audioItems:[],scoreItems:[]};
      const project={dir:'synthetic',name:'Test',clips:[clipA,clipB],images:[],audio:[],videos,charSheets:[],scoreClips:[],voiceClips:[],styles:[],imageGens:[],timelines:[tl],activeTimelineId:'tl',folders:[],editSessions:[],videoEditSessions:[]};
      useStore.setState({project,enhanceSource:null,renderNow:j=>jobs.push(['now',j]),enqueueRender:j=>jobs.push(['queue',j]),setTimelineBoth:async(items,audio,id)=>{writes.push({items,audio,id})}});
      const el=document.getElementById('root');

      // ================= the ENHANCE window =================
      let root=createRoot(el);root.render(<div style={{width:720,height:1600}}><EnhancePanel/></div>);await tick(300);
      check(has('nothing open')&&has('enhance…'),'the empty window says where it opens from');
      useStore.getState().openEnhance({kind:'take',clipId:'a',takeId:'t1'});await tick(500);
      check(raised===1,'opening a source raises the window');
      check(has('Turn · T1')&&has('1280×720 · 24 fps · 5 s'),'the take and what it is');
      // the monitor: the newest copy on the right, both on one clock
      check(after()&&after().src.endsWith('slow.mp4')&&has('after · T3'),'the newest copy is the after: '+(after()&&after().src));
      await until(()=>!before().paused&&!after().paused&&before().currentTime>0.3,6000,'both play');
      await tick(300);
      check(Math.abs(after().playbackRate-2)<0.01,'a slow-motion copy runs at twice the rate to stay on the before’s clock: '+after().playbackRate);
      check(Math.abs(after().currentTime-before().currentTime*2)<0.4,'…at the same moment: '+[before().currentTime,after().currentTime]);
      document.querySelector('[data-copy="t2"]').click();await tick(300);
      check(after().src.endsWith('copy.mp4')&&has('after · T2'),'a copy clicked is compared');
      await until(()=>Math.abs(after().playbackRate-1)<0.01&&!after().paused&&after().videoWidth===512,6000,'the same-length copy plays at the same rate');
      // the slide bar: on the monitor's viewport; the after is cut where it stands
      await tick(200);
      const vp=()=>document.querySelector('[data-viewport]'),stage=()=>document.querySelector('[data-stage]'),handle=()=>document.querySelector('[data-split]');
      const clipPx=()=>Number(/inset\\(0(?:px)? 0(?:px)? 0(?:px)? ([\\d.]+)px\\)/.exec(after().style.clipPath)?.[1]);
      const onMonitor=()=>{const m=document.querySelector('[data-monitor]').getBoundingClientRect(),h=handle().getBoundingClientRect(),x=h.left+h.width/2;return x>=m.left&&x<=m.right&&h.height>50};
      const vr=vp().getBoundingClientRect();
      handle().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:vr.left+vp().clientWidth/2,clientY:vr.top+20}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:vr.left+vp().clientWidth*0.6,clientY:vr.top+20}));
      window.dispatchEvent(new MouseEvent('mouseup',{}));await tick();
      check(Math.abs(clipPx()-(vp().clientWidth*0.6-stage().offsetLeft))<1.5,'the slide bar moves the cut: '+after().style.clipPath);
      check(onMonitor(),'the slide bar is on the monitor');
      // replay speed: both slow down together
      await pick(trigAfter('replay'),'25 %');await tick(200);
      check(before().playbackRate===0.25&&Math.abs(after().playbackRate-0.25)<0.01,'replay 25 %: both at a quarter: '+[before().playbackRate,after().playbackRate]);
      await pick(trigAfter('replay'),'100 %');
      // zoom: the copy's own pixels; his cleanup 10-01: the slide bar stays on the monitor at any zoom,
      // the picture drags with the hand (the scroll bars stay), the wheel zooms at the pointer
      await pick(trigAfter('zoom'),'200 %');await tick(150);
      check(stage().style.width==='1024px'&&after().parentElement===stage(),'200 %: twice the copy’s own 512 px: '+stage().style.width);
      check(vp().scrollWidth>vp().clientWidth&&getComputedStyle(vp()).overflow==='auto'&&getComputedStyle(vp()).cursor==='grab','zoomed in: scroll bars, and the hand');
      check(onMonitor(),'200 %: the slide bar is still on the monitor');
      vp().scrollLeft=vp().scrollWidth;await tick(150);
      check(onMonitor()&&Math.abs(clipPx()-(vp().scrollLeft+vp().clientWidth*0.6-stage().offsetLeft))<1.5,'scrolled to the far right: the slide bar stays on the monitor and the cut follows it: '+after().style.clipPath);
      const sl=vp().scrollLeft,vr2=vp().getBoundingClientRect(),cx=vr2.left+100,cy=vr2.top+100;
      vp().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:cx,clientY:cy}));
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:cx+40,clientY:cy}));await tick();
      check(getComputedStyle(vp()).cursor==='grabbing','dragging: the closed hand');
      window.dispatchEvent(new MouseEvent('mousemove',{clientX:cx+80,clientY:cy}));
      window.dispatchEvent(new MouseEvent('mouseup',{}));await tick();
      check(Math.abs(vp().scrollLeft-(sl-80))<1,'a drag moves the picture with the hand: '+[sl,vp().scrollLeft]);
      check(!before().paused,'a drag does not pause');
      vp().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:cx,clientY:cy}));window.dispatchEvent(new MouseEvent('mouseup',{}));await tick();
      check(before().paused,'a click pauses');
      vp().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:cx,clientY:cy}));window.dispatchEvent(new MouseEvent('mouseup',{}));await tick();
      check(!before().paused,'…and plays again');
      await pick(trigAfter('zoom'),'fit');await tick(150);
      check(cur(trigAfter('zoom'))==='fit'&&getComputedStyle(vp()).overflow==='hidden'&&vp().scrollWidth<=vp().clientWidth,'fit again: the whole picture, no scroll bars');
      const fitW=parseFloat(stage().style.width),vr3=vp().getBoundingClientRect();
      const wx=vr3.left+stage().offsetLeft+stage().offsetWidth*0.75,wy=vr3.top+vp().clientHeight/2;
      const under=()=>(vp().scrollLeft+(wx-vr3.left)-stage().offsetLeft)/parseFloat(stage().style.width); // where across the picture the pointer is
      const u0=under();
      vp().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:-800,clientX:wx,clientY:wy}));await tick(150);
      check(parseFloat(stage().style.width)>fitW*3&&/^\\d+ %$/.test(cur(trigAfter('zoom'))),'the wheel zooms in, and the box says how far: '+cur(trigAfter('zoom')));
      check(Math.abs(under()-u0)<0.01,'…at the pointer: the same spot stays under it: '+[u0,under()]);
      check(onMonitor(),'wheel-zoomed: the slide bar is on the monitor');
      for(let i=0;i<6;i++){vp().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:400,clientX:wx,clientY:wy}));await tick(60)}
      check(cur(trigAfter('zoom'))==='fit'&&parseFloat(stage().style.width)===fitW,'and out again, down to fit');
      // his ask 10-01, "dbl click gores back to 100%": the spot double-clicked comes to the middle at 100 %; again = fit
      const wasPaused=before().paused,dr=vp().getBoundingClientRect(),dx=dr.left+stage().offsetLeft+stage().offsetWidth*0.5,dy=dr.top+stage().offsetTop+stage().offsetHeight*0.6;
      const click=()=>{vp().dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,clientX:dx,clientY:dy}));window.dispatchEvent(new MouseEvent('mouseup',{}))};
      click();click();vp().dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0,clientX:dx,clientY:dy}));await tick(200);
      check(cur(trigAfter('zoom'))==='100 %'&&stage().style.width==='512px','a double-click goes to 100 %: '+cur(trigAfter('zoom')));
      check(Math.abs((vp().scrollTop+vp().clientHeight/2-stage().offsetTop)/512-0.6)<0.01,'…with the spot double-clicked in the middle: '+(vp().scrollTop+vp().clientHeight/2-stage().offsetTop)/512);
      check(before().paused===wasPaused,'a double-click leaves play / pause as it was');
      const dr2=vp().getBoundingClientRect();
      vp().dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,button:0,clientX:dr2.left+50,clientY:dr2.top+50}));await tick(200);
      check(cur(trigAfter('zoom'))==='fit','at 100 %, a double-click goes back to fit');

      // ---- the two cards ----
      check(pills('interp').map(p=>p.textContent).join('|')==='RIFE · this PC|RIFE · fal|Topaz · fal|Topaz · this PC','INTERPOLATE: its engines as pills');
      check(pills('upscale').map(p=>p.textContent).join('|')==='Real-ESRGAN · this PC|SeedVR2 · fal|Topaz · fal|Topaz · this PC','UPSCALE: its engines as pills');
      check(!pills('interp')[0].classList.contains('ghost')&&pills('interp').slice(1).every(p=>p.classList.contains('ghost')),'the picked engine is lit, the rest quiet');
      check(document.querySelector('[data-switch="interp"] input').checked&&!document.querySelector('[data-switch="upscale"] input').checked,'interpolate on, upscale off to start');
      check(sec('interp').textContent.includes('spatial TTA')&&sec('interp').textContent.includes('UHD mode'),'RIFE’s own settings');
      check(sec('interp').textContent.includes('RIFE is not on this PC yet')&&runBtn().getAttribute('aria-disabled')==='true'&&has('✕ RIFE is not on this PC yet'),'RIFE not downloaded: said on the card, the run waits with the reason');
      const dl=[...sec('interp').querySelectorAll('.btn')].find(b=>b.textContent.startsWith('download'));
      check(dl&&dl.textContent==='download · ~412 MB','the size on the download button: '+(dl&&dl.textContent));
      dl.click();await tick(300);
      check(has('RIFE (rife-ncnn-vulkan)')&&has('~412 MB · once'),'the download goes through the Models card’s one wizard');
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel').click();await tick();
      // Topaz on this PC: its own models and settings
      pills('interp')[3].click();await tick(200);
      check(cur(trigs('interp')[0])==='Apollo · apo-8','Topaz on this PC: the models its install has');
      check(sec('interp').textContent.includes('replace duplicate frames')&&sec('interp').textContent.includes('max GPU memory'),'…and its settings');
      check(runBtn().getAttribute('aria-disabled')==='false'&&plan().includes('1280×720 · 48 fps · 5 s'),'it can run: the copy has 48 fps and the same 5 s: '+plan());
      check(runBtn().textContent==='▶ Enhance now · Topaz · this PC · free','free on this PC, said on the button: '+runBtn().textContent);
      document.querySelector('[data-switch="upscale"] input').click();await tick();
      pills('upscale')[3].click();await tick(200);
      check(cur(trigs('upscale')[0])==='Proteus · prob-4'&&sec('upscale').textContent.includes('reduce noise'),'Topaz upscale: its models, and the picked model’s own sliders');
      await pick(trigs('upscale')[1],'2160p (4K)');
      check(plan().includes('3840×2160 · 48 fps · 5 s · interpolate first, then upscale'),'both: the order is said: '+plan());
      await window.saveScreenshot();
      runBtn().click();await tick();
      let [lane,job]=jobs.at(-1);
      check(lane==='now'&&job.kind==='enhance'&&job.label==='Turn · T1 · enhance'&&job.engineLabel==='Topaz · this PC → Topaz · this PC'&&job.estCost===0,'▶ Enhance now starts the job: '+JSON.stringify([lane,job.label,job.engineLabel,job.estCost]));
      check(JSON.stringify(job.payload.source)==='{"kind":"take","clipId":"a","takeId":"t1"}'&&job.payload.interp.engine==='topaz-local'&&job.payload.interp.model==='apo-8'&&job.payload.interp.times===2&&job.payload.upscale.model==='prob-4'&&job.payload.upscale.height===2160&&!('adoptItemIds' in job.payload),'with both asks: '+JSON.stringify(job.payload));
      // the free preview: the same asks on 2 s at the playhead
      document.querySelector('[data-preview]').click();await tick(400);
      check(previews.length===1&&previews[0].preview.sec===2&&previews[0].interp.model==='apo-8'&&previews[0].upscale.height===2160,'the preview runs the same asks on 2 s: '+JSON.stringify(previews[0]));
      check(has('after · preview (2 s)')&&after().src.endsWith('slow.mp4'),'…and lands on the right');
      // online: no free preview, the price line
      pills('interp')[1].click();await tick(200);
      check(document.querySelector('[data-preview]').title.startsWith('online engines cost money'),'online engines: no free preview, and why');
      document.querySelector('[data-preview]').click();await tick();
      check(previews.length===1,'…nothing runs');
      check(runBtn().textContent.includes('RIFE on fal: $0.0013 per compute second'),'no number ahead for RIFE on fal: its price instead: '+runBtn().textContent);
      settings={...settings,falKey:undefined};useStore.setState(s=>({settingsRev:s.settingsRev+1}));await tick(250);
      check(sec('interp').textContent.includes('No fal key saved')&&runBtn().getAttribute('aria-disabled')==='true'&&[...sec('interp').querySelectorAll('.btn')].some(b=>b.textContent==='add the fal key'),'no fal key: said before the click, with the door to add it');
      settings={...settings,falKey:'masked'};useStore.setState(s=>({settingsRev:s.settingsRev+1}));await tick(250);
      // slow motion, and the engines that can't
      pills('interp')[0].click();await tick();
      await pick(trigs('interp')[1],'slow motion — longer');
      await pick(trigs('interp')[2],'×4');
      check(plan().includes('· 24 fps · 20 s'),'slow motion ×4: the same rate, four times as long: '+plan());
      pills('interp')[2].click();await tick();
      check(has('Topaz · fal makes no slow motion'),'an engine without slow motion says so');
      await pick(trigs('interp')[0],'smoother — same length');
      trigs('interp')[1].click();await tick();
      const x4=rows().find(r=>lab(r)==='×4');
      check(x4&&x4.title==='Topaz · fal makes at most 60 fps','×4 would pass their 60 fps: greyed with the reason');
      await closeDd();
      await pick(trigs('interp')[1],'to a frame rate');
      const fpsIn=sec('interp').querySelector('input[type=number]');
      check(fpsIn&&fpsIn.min==='16'&&fpsIn.max==='60'&&fpsIn.value==='48','a frame rate, inside their range');
      await tick(700);
      const last=patches.filter(p=>p.enhanceLast).at(-1);
      check(last&&last.enhanceLast.ia.engine==='topaz-fal'&&last.enhanceLast.ia.fps===48&&last.enhanceLast.upscaleOn===true,'the window remembers its picks: '+JSON.stringify(last&&last.enhanceLast));
      // Optical Flow's ask
      useStore.getState().openEnhance({kind:'take',clipId:'a',takeId:'t1'},{times:4,itemIds:['A','B']});await tick(400);
      check(document.querySelector('[data-flow]').textContent.includes('×4 the frames and the same length — 2 timeline blocks play it when it lands'),'Optical Flow says what it asks for');
      check(!document.querySelector('[data-switch="upscale"] input').checked,'…frames only');
      check(has('makes at most 60 fps — this would be 96'),'Topaz on fal can’t give ×4 at 24 fps: said');
      pills('interp')[3].click();await tick(200);
      document.querySelector('[data-queue]').click();await tick();
      [lane,job]=jobs.at(-1);
      check(lane==='queue'&&JSON.stringify(job.payload.adoptItemIds)==='["A","B"]'&&job.payload.interp.times===4&&job.payload.interp.slowmo===1&&!job.payload.upscale,'queued for the two blocks: '+JSON.stringify(job.payload));
      // a Library video dropped on the window
      const dt=new DataTransfer();dt.setData(MIME_VIDEO,'v1');
      document.querySelector('.vd-panel').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));await tick(400);
      check(JSON.stringify(useStore.getState().enhanceSource)==='{"kind":"video","videoId":"v1"}'&&has('Walk')&&document.querySelector('[data-copy="v2"]'),'a Library video dropped on it opens there, its copy listed');
      root.unmount();

      // ================= Clip Gen: his outlines, the entry =================
      useStore.setState({selectedClipId:'a'});
      root=createRoot(el);root.render(<div style={{width:760,height:1600}}><RenderPanel/></div>);await tick(700);
      const card=id=>document.querySelector('[data-nav="'+id+'"]');
      const ring=id=>getComputedStyle(card(id)).boxShadow;
      check(ring('t1')==='none','a take that is no copy: no outline');
      check(ring('t2').startsWith('rgb(164, 107, 255)'),'interpolated and upscaled = purple: '+ring('t2'));
      check(ring('t3').startsWith('rgb(79, 141, 255)'),'interpolated = blue: '+ring('t3'));
      useStore.setState({project:{...useStore.getState().project,clips:[{...clipA,takes:[...clipA.takes,tk('t4',M.copy,2,{of:'t1',upscale:U2})]},clipB]}});await tick(300);
      check(ring('t4').startsWith('rgb(63, 207, 107)'),'upscaled = green: '+ring('t4'));
      check(card('t3').title.includes('interpolated slow motion ×2 — an enhanced copy of T1'),'the tooltip says what was done, and to which take');
      card('t1').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:300}));await tick();
      let entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='enhance T1…').pop();
      check(entry,'a take’s right-click has enhance T1…');
      entry.click();await tick();
      check(JSON.stringify(useStore.getState().enhanceSource)==='{"kind":"take","clipId":"a","takeId":"t1"}','…and opens ENHANCE on it');
      root.unmount();

      // ================= the Library: the outline, the entry =================
      root=createRoot(el);root.render(<div style={{width:640,height:1200}}><LibraryPanel/></div>);await tick(700);
      const tile=id=>document.querySelector('[data-nav="'+id+'"] > div');
      check(tile('v1')&&tile('v2'),'the videos are listed');
      check(getComputedStyle(tile('v2')).boxShadow.startsWith('rgb(63, 207, 107)')&&getComputedStyle(tile('v1')).boxShadow==='none','the upscaled copy wears green, the original nothing');
      check(tile('v2').title.includes('upscaled ×2 — an enhanced copy'),'its tooltip says so');
      tile('v1').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:150,clientY:150}));await tick();
      entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='enhance…').pop();
      check(entry,'a Library video’s right-click has enhance…');
      entry.click();await tick();
      check(JSON.stringify(useStore.getState().enhanceSource)==='{"kind":"video","videoId":"v1"}','…and opens ENHANCE on it');
      root.unmount();

      // ================= the timeline: the entry, and Optical Flow in the speed dialog =================
      useStore.setState({selectedTlItemId:'A',enhanceSource:null});
      root=createRoot(el);root.render(<div style={{width:1100,height:700}}><TimelinePanel/></div>);await tick(500);
      const field=l=>document.querySelector('[aria-label="'+l+'"]');
      const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
      const interpDd=()=>trigAfter('Time Interpolation:');
      ctrlR();await tick();
      check(has('Clip Speed / Duration'),'Ctrl+R opens the speed dialog');
      interpDd().click();await tick();
      check(rows().find(r=>lab(r)==='Optical Flow')?.style.cursor==='pointer','Optical Flow can be picked now');
      await closeDd();
      setVal(field('Speed percent'),'50');await tick();
      await pick(interpDd(),'Optical Flow');
      button('OK').click();await tick(300);
      let A=writes.at(-1).items.find(x=>x.id==='A');
      check(A.speed===0.5&&A.takeId==='b2'&&!A.interp,'50 %: a copy with twice the frames exists, the block plays it: '+JSON.stringify(A));
      check(useStore.getState().enhanceSource===null,'nothing to make: ENHANCE stays shut');
      // a slower block needs more frames than any copy has: ENHANCE opens with the ask
      useStore.setState({selectedTlItemId:'B'});await tick();
      ctrlR();await tick();
      setVal(field('Speed percent'),'25');await tick();
      await pick(interpDd(),'Optical Flow');
      button('OK').click();await tick(300);
      const B=writes.at(-1).items.find(x=>x.id==='B');
      check(B.speed===0.25&&B.takeId==='b1','the block keeps its take until the copy lands');
      check(JSON.stringify(useStore.getState().enhanceSource)==='{"kind":"take","clipId":"b","takeId":"b1","flow":{"times":4,"itemIds":["B"]}}','25 % needs ×4: ENHANCE opens on the take with the ask: '+JSON.stringify(useStore.getState().enhanceSource));
      // the dialog on a block playing such a copy shows Optical Flow; Frame Sampling sends it back to its take
      useStore.setState({project:{...useStore.getState().project,timelines:[{...tl,items:writes[0].items}]},selectedTlItemId:'A'});await tick(200);
      ctrlR();await tick();
      check(cur(interpDd())==='Optical Flow','a block on a copy with more frames reads Optical Flow');
      await pick(interpDd(),'Frame Sampling');
      button('OK').click();await tick(300);
      A=writes.at(-1).items.find(x=>x.id==='A');
      check(A.takeId==='b1','Frame Sampling: back to its own take: '+JSON.stringify(A));
      // the block's right-click
      const block=document.querySelectorAll('.vd-clip')[2];
      check(block,'the block is on the timeline');
      block.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:120}));await tick();
      entry=[...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='enhance…').pop();
      check(entry,'a block’s right-click has enhance…');
      entry.click();await tick();
      check(JSON.stringify(useStore.getState().enhanceSource)==='{"kind":"take","clipId":"a","takeId":"t1"}','…on the take the block plays: '+JSON.stringify(useStore.getState().enhanceSource));
      root.unmount();
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'the ENHANCE window: both videos on one clock (a slow-motion copy at twice the rate), the slide bar on the monitor at any zoom, replay speed, zoom at the copy’s own pixels, the wheel zooming at the pointer, the hand dragging the picture, a double-click to 100 % and back to fit; two cards of engines with their own models and settings; every blocker said before the click; the free preview on this PC only; the job it queues; Optical Flow’s ask; a dropped Library video. Clip Gen and the Library wear his colours with a tooltip, and every right-click opens ENHANCE; the speed dialog’s Optical Flow switches to a dense copy, asks ENHANCE for a missing one, and Frame Sampling goes back to the take';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root" style="height:100vh"></div>')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 120000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l) || (r.status !== 0 && /^PAGE/.test(l))).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow, ipcMain } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  const preload = path.join(tmp, 'preload.js'); fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('saveScreenshot',()=>require('electron').ipcRenderer.invoke('capture'))")
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 1200, height: 1700, webPreferences: { preload, sandbox: true, backgroundThrottling: false, offscreen: true, autoplayPolicy: 'no-user-gesture-required' } })
    ipcMain.handle('capture', async () => fs.writeFileSync(path.join(tmp, 'enhance.png'), (await win.webContents.capturePage()).toPNG()))
    win.webContents.on('console-message', (_e, ...a) => console.log('PAGE', ...a))
    await win.loadFile(path.join(tmp, 'index.html'))
    for (const css of ['../../koan-shared/styles/koan.css', '../../koan-shared/vidancer-ui/src/styles.css']) await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, css), 'utf8'))
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    console.log('PASS screenshot: ' + path.join(tmp, 'enhance.png'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
