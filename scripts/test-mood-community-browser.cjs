// list 43 (COMMUNITY-MOODS-SPEC-2026-10-01) — the community MOODS in the real MOODS fold: ⇣ community
// lists them with their makers; install / installed ✓ / update (asks first) / name taken; ↻ reads
// again and says when the repo is not up; right-click → share to the community is greyed with the
// reason when the MOOD isn't his to share, and asks before it hands one over. Offscreen Electron, the
// app's API mocked: nothing is fetched, nothing is shared.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-mood-community-ui-'))
  const ui = path.resolve(__dirname, '../../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  const code = require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {MoodFold} from '${ui}/ui/MoodFold';
    import {useStore} from '${ui}/store';
    import {setVidancerApi} from '${ui}/api';
    const tick=(ms=80)=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m)};
    const mood=(slug,name,author,version='1.0',extra={})=>({slug,name,author,version,description:'',triggers:[],notFor:[],tags:[],suffix:'',file:slug+'.vmd',tokens:1000,shipped:false,...extra});
    export async function run(){
      const errors=[];window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const installs=[],shares=[];let community={ok:true,moods:[
        {slug:'quiet-noir',name:'QUIET NOIR',author:'mira',description:'rain and neon',tags:['noir'],version:'1.3',bytes:8000},
        {slug:'arcade-dreams',name:'ARCADE DREAMS',author:'kai',description:'',tags:[],version:'1.0',bytes:4000},
        {slug:'neon-city',name:'NEON CITY',author:'lu',description:'city at night',tags:['night'],version:'1.0',bytes:12000},
        {slug:'noir-two',name:'NOIR TWO',author:'Koan',description:'',tags:[],version:'1.0',bytes:4000}]};
      const lib=[mood('quiet-noir','QUIET NOIR','mira','1.2'),mood('arcade-dreams','ARCADE DREAMS',''),mood('hardcore-anime','HARDCORE ANIME','','1.0',{shipped:true,foreign:true}),mood('noir-two','NOIR TWO','koan')];
      let author='Koan';const saved=[];
      const api={moodList:async()=>lib,getSettings:async()=>({moodAuthor:author}),setSettings:async p=>{saved.push(p);if('moodAuthor' in p)author=p.moodAuthor;return {}},moodCommunity:async()=>community,
        moodCommunityInstall:async(slug,replace)=>{installs.push([slug,!!replace]);return {ok:true,info:mood(slug,slug,'x'),replaced:!!replace}},
        moodCommunityShare:async slug=>{shares.push(slug);return {ok:true,file:'C:/share/'+slug+'.vmd'}}};
      setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
      useStore.setState({project:{dir:'synthetic',images:[],codir:{log:[],moodsPinned:[]}},refreshSpend:async()=>{},codirQueue:[],moodsFoldOpen:true});
      createRoot(document.getElementById('root')).render(<MoodFold/>);await tick(300);
      const btn=t=>[...document.querySelectorAll('.btn')].filter(e=>e.textContent.trim()===t).pop(); // the last: a dialog's button sits after the fold's
      const state=slug=>document.querySelector('[data-community-mood="'+slug+'"] [data-community-state]');

      // ---- the list: each MOOD with its maker, and what one click does ----
      btn('⇣ community').click();await tick(200);
      check(document.querySelector('[data-community]').textContent.includes('koan-shdw/vidancer-moods'),'the repo is named');
      const row=document.querySelector('[data-community-mood="neon-city"]');
      check(row&&row.textContent.includes('NEON CITY')&&row.textContent.includes('by lu · v1.0 · ~3k tokens'),'a row: name, maker, version, size: '+(row&&row.textContent));
      check(row.title.includes('city at night')&&row.title.includes('tags: night'),'its description and tags on hover');
      check(state('neon-city').dataset.communityState==='install','not in the library: install');
      check(state('quiet-noir').dataset.communityState==='update','another version in the library: update');
      check(state('arcade-dreams').dataset.communityState==='clash'&&state('arcade-dreams').textContent==='name taken','his own MOOD of that name: name taken');
      check(state('noir-two').dataset.communityState==='installed'&&state('noir-two').textContent==='installed ✓','same maker, same version: installed ✓');
      state('neon-city').click();await tick(150);
      check(JSON.stringify(installs)==='[["neon-city",false]]','install = one click: '+JSON.stringify(installs));
      state('arcade-dreams').click();state('noir-two').click();await tick(150);
      check(installs.length===1,'name taken and installed do nothing');
      state('quiet-noir').click();await tick(150);
      check(installs.length===1&&document.body.textContent.includes('Your edits to it are lost'),'update asks first');
      btn('update').click();await tick(150);
      check(JSON.stringify(installs.at(-1))==='["quiet-noir",true]','… then replaces');
      community={ok:false,error:'the community repo is not up yet'};
      btn('↻').click();await tick(150);
      check(document.querySelector('[data-community]').textContent.includes('the community repo is not up yet'),'↻ reads again and says what is wrong');

      // ---- share to the community: greyed with the reason, or asked and handed over ----
      const menuFor=async name=>{[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===name).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:40,clientY:40}));await tick();return [...document.querySelectorAll('div')].filter(d=>d.textContent.trim()==='⇡ share to the community').pop()};
      const close=async()=>{[...document.querySelectorAll('div')].filter(d=>d.style.zIndex==='2500').forEach(d=>d.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));await tick()};
      let e=await menuFor('QUIET NOIR');
      check(e&&e.title==='QUIET NOIR is by mira: only its maker shares it'&&e.style.cursor==='default','someone else’s MOOD: greyed, says why');await close();
      e=await menuFor('HARDCORE ANIME');
      check(e&&e.title==="HARDCORE ANIME was made from someone else's skill: it is not yours to share",'made from someone else’s skill: greyed');await close();
      e=await menuFor('ARCADE DREAMS');
      check(e&&e.title==='a pull request to koan-shdw/vidancer-moods, credited to Koan','his own: live, credited to him');
      e.click();await tick(150);
      check(document.body.textContent.includes('Only share MOODS you made')&&shares.length===0,'it asks first');
      btn('share').click();await tick(150);
      check(JSON.stringify(shares)==='["arcade-dreams"]','… then hands it over');
      // his test 10-02 ("broken fix it"): no name on MOODS greyed every share. Now it asks for the name once
      author='';useStore.setState(s=>({settingsRev:s.settingsRev+1}));await tick(200);
      e=await menuFor('ARCADE DREAMS');
      check(e&&e.style.cursor!=='default'&&/it asks your name first/.test(e.title),'no name yet: share is live and says it will ask: '+(e&&e.title));
      e.click();await tick(150);
      const input=[...document.querySelectorAll('input')].pop();
      check(input&&document.body.textContent.includes('Your name on MOODS'),'it asks for the name');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Koan');input.dispatchEvent(new Event('input',{bubbles:true}));await tick();
      [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='OK').click();await tick(200);
      check(JSON.stringify(saved.at(-1))==='{"moodAuthor":"Koan"}','the name is saved, as the Settings field: '+JSON.stringify(saved));
      check(document.body.textContent.includes('Only share MOODS you made'),'then it asks before sharing');
      btn('share').click();await tick(150);
      check(JSON.stringify(shares)==='["arcade-dreams","arcade-dreams"]','… and hands it over: '+JSON.stringify(shares));
      // his call 10-02: "outlines unless clicked and then yelow" — the MOOD names, apart from + new / add / share / community
      const chip=name=>[...document.querySelectorAll('.btn')].find(e=>e.textContent.trim()===name);
      const look=e=>{const c=getComputedStyle(e);return {bg:c.backgroundColor,border:c.borderTopWidth+' '+c.borderTopStyle,w:Math.round(e.getBoundingClientRect().width)}};
      const amber=look(btn('+ new')).bg;
      check(amber!=='rgba(0, 0, 0, 0)'&&['⇪ add','⇩ share','⇣ community'].every(t=>look(btn(t)).bg===amber),'the four buttons are filled: '+amber);
      check(document.querySelector('[data-community]')&&getComputedStyle(btn('⇣ community')).color!==amber,'with the community list open, ⇣ community still reads (no amber words on amber)');
      const off=look(chip('ARCADE DREAMS'));
      check(off.bg==='rgba(0, 0, 0, 0)'&&off.border==='1px solid','a MOOD that is off is an outline: '+JSON.stringify(off));
      chip('ARCADE DREAMS').click();await tick(150);
      const on=look(chip('ARCADE DREAMS'));
      check(on.bg===amber,'clicked on, it is yellow: '+JSON.stringify(on));
      check(on.w===off.w,'on or off the same width, nothing beside it moves: '+off.w+' / '+on.w);
      check(!errors.length,'no errors: '+errors.join(' | '));
      return 'the MOOD names are outlines until clicked on, then yellow, the same width; + new, add, share and community stay filled; the community list with makers, sizes and hover; install, update (asked), name taken, installed ✓; ↻ says the repo is not up; share greyed for someone else’s MOOD or one made from someone else’s skill, asked and handed over for his own';
    }
  `, resolveDir: path.resolve(__dirname, '..'), loader: 'tsx' }, alias: { react: path.resolve(__dirname, '../node_modules/react'), 'react-dom': path.resolve(__dirname, '../node_modules/react-dom') }, bundle: true, format: 'iife', globalName: 'checks', write: false, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined' } }).outputFiles[0].text
  fs.writeFileSync(path.join(tmp, 'checks.js'), code)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const r = require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY || require('electron'), [__filename, tmp], { env, encoding: 'utf8', timeout: 60000, windowsHide: true })
  process.stdout.write((r.stdout || '').split('\n').filter((l) => /^(PASS|Error)/.test(l)).join('\n') + '\n'); if (r.status !== 0) process.stderr.write((r.stderr || '').slice(-2000)); process.exitCode = r.status === 0 ? 0 : 1
} else {
  const { app, BrowserWindow } = require('electron'), tmp = process.argv[2]
  app.setPath('userData', path.join(tmp, 'profile'))
  app.whenReady().then(async () => { try {
    const win = new BrowserWindow({ show: false, width: 700, height: 700, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: true } })
    await win.loadURL('data:text/html,<div id="root"></div>')
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/vidancer-ui/src/styles.css'), 'utf8'))
    await win.webContents.insertCSS(fs.readFileSync(path.resolve(__dirname, '../../koan-shared/styles/koan.css'), 'utf8')) // the house buttons
    console.log('PASS ' + await win.webContents.executeJavaScript(fs.readFileSync(path.join(tmp, 'checks.js'), 'utf8') + '\nchecks.run()'))
    app.exit(0)
  } catch (e) { console.log('Error ' + (e && e.message)); app.exit(1) } })
}
