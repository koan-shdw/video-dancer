// Real Settings, Co-Director and setup wizard in hidden Electron. Provider calls are stand-ins;
// no browser sign-in, credentials, paid requests or real projects are touched.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
if (!process.versions.electron) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-settings-connections-'))
  const ui = path.resolve(__dirname, '../koan-shared/vidancer-ui/src').replaceAll('\\', '/')
  require('esbuild').buildSync({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import '${ui}/styles.css';
    import '@koan/shared/koan.css';
    import {SettingsModal} from '${ui}/panels/SettingsModal';
    import {CoDirectorPanel} from '${ui}/panels/CoDirector';
    import {SetupWizard} from '${ui}/panels/SetupWizard';
    import {useConnections,refreshConnections,saveConnectionSettings,connectionReady} from '${ui}/lib/connections';
    import {useStore} from '${ui}/store'; import {setVidancerApi} from '${ui}/api';
    import {setSettingsOpener} from '${ui}/panelBus';
    const tick=(ms=30)=>new Promise(r=>setTimeout(r,ms)),check=(ok,msg)=>{if(!ok)throw Error(msg)};
    const q=(s,root=document)=>root.querySelector(s),qa=(s,root=document)=>[...root.querySelectorAll(s)];
    const btn=(text,root=document)=>qa('button',root).find(e=>e.textContent.trim()===text);
    const click=async(text,root=document)=>{const el=btn(text,root);check(el,'button missing: '+text);check(!el.disabled,'button disabled: '+text);el.click();await tick(80)};
    const set=async(el,value)=>{check(el,'field exists');Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));await tick()};
    let settings={codirEngine:'codex',codirCodexModel:'gpt-6.1-sol',codirEffort:'high',openaiKey:'••••abcd',anthropicKey:'••••efgh',arkKey:'••••ijkl',googleKey:'••••mnop',moodAuthor:'Existing author',tileTitleSize:14};
    const initialKeys={...settings}; let failLogin=false, failSave=false, cleanupBusy=false, cleanupCalls=[];
    const accounts={claude:{found:true,loggedIn:true,account:'Claude test account',detail:'Claude Code 2.1.300',version:'2.1.300'},codex:{found:true,loggedIn:true,detail:'Codex test account',version:'0.160.0'},gemini:{found:false,loggedIn:false,detail:'Gemini CLI not installed'}};
    const calls=[],errors=[],savedPatches=[]; const clone=x=>JSON.parse(JSON.stringify(x));
    const keySettings=new Set(['openaiKey','anthropicKey','googleKey','arkKey','falKey','byteplusAccessKeyId','byteplusSecretKey']);
    const api={
      getSettings:async()=>clone(settings),setSettings:async p=>{if(failSave)throw Error('Disk write failed');savedPatches.push(clone(p));for(const [k,v] of Object.entries(p))settings[k]=keySettings.has(k)&&v?'••••'+String(v).slice(-4):v;return clone(settings)},
      codirBridgeStatus:async()=>clone(accounts.claude),codirCliStatus:async cli=>clone(accounts[cli]),
      codirBridgeLogin:async()=>login('claude'),codirCliLogin:async cli=>login(cli),
      codirCliLogout:async cli=>{calls.push(['logout',cli]);accounts[cli].loggedIn=false;return {...accounts[cli],ok:true,out:''}},
      codirCancelLogin:async cli=>calls.push(['cancel',cli]),
      codirModels:async()=>[{id:'claude-sonnet-5',label:'Sonnet 5'},{id:'claude-haiku-4-5',label:'Haiku 4.5'}],
      codirBridgeModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5',minCli:'2.1.200'}],
      codirCliModels:async cli=>cli==='codex'?[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol',efforts:['low','medium','high','xhigh','max']},{id:'gpt-5.5',label:'GPT-5.5',efforts:['low','medium','high','xhigh']}]:[{id:'auto',label:'Auto'}],
      codirVeniceModels:async()=>[{id:'claude-sonnet-5-5',label:'Sonnet 5.5 on Venice'}],codirDeepseekModels:async()=>[{id:'deepseek-v4-pro',label:'DeepSeek V4 Pro'}],codirOpenaiModels:async()=>[{id:'gpt-6.1-sol',label:'GPT-6.1 Sol'}],
      llmValidateKey:async(provider,key)=>{calls.push(['keyCheck',provider,key]);return key.startsWith('bad')?{ok:false,error:'Key refused'}:{ok:true}},
      arkSpendCheck:async(id,secret)=>{calls.push(['arkCheck',id,secret]);return secret==='good-secret'?{ok:true}:{ok:false,error:'Credentials refused'}},
      codirGuides:async()=>['codirector','master','director','prompter','chatgpt'].map(id=>({id,label:id,loaded:settings.codirGuideLoad?.[id]!==false,custom:false})),
      bridgeList:async()=>[{id:'higgsfield',key:'higgsfield',slot:'default',label:'Higgsfield account',service:'Higgsfield',loggedIn:true,balance:100,creditUnit:'credits',auth:'oauth'}],
      onBridgeChanged:()=>()=>{},settingsPickExportDir:async()=>{settings.exportDir='C:/Exports';return clone(settings)},
      projectCleanup:async remove=>{cleanupCalls.push(remove);return {busy:cleanupBusy,files:2,bytes:1048576}}
    };
    async function login(cli){calls.push(['login',cli]);await tick(40);accounts[cli].loggedIn=!failLogin;return {...accounts[cli],ok:!failLogin,out:failLogin?'Sign-in cancelled.':''}}
    setVidancerApi(new Proxy(api,{get:(t,k)=>k in t?t[k]:typeof k==='string'&&/^on[A-Z]/.test(k)?()=>()=>{}:async()=>null}));
    const root=createRoot(document.getElementById('root'));
    const project={dir:'synthetic',codir:{brief:'',log:[]},images:[],clips:[],timelines:[],styles:[]};
    useStore.setState({project,refreshCredit:async()=>{},refreshMoods:async()=>{},codirSendText:async text=>{calls.push(['send',text])}});
    window.addEventListener('error',e=>errors.push(String(e.message)));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
    const panel=()=>q('#panel'); const dialog=()=>q('[role=dialog]');
    function render(view='settings'){
      root.render(<><div id="panel" style={{width:570,height:730,background:'var(--bg2)',display:'flex'}}><CoDirectorPanel/></div>{view==='settings'?<SettingsModal onClose={()=>render('panel')}/>:view==='wizard'?<SetupWizard onClose={()=>render('panel')} onOpenSettings={()=>render('settings')} onOpenBridge={()=>{}} onOpenModels={()=>{}}/>:null}</>);
    }
    setSettingsOpener(()=>render('settings'));
    export async function run(){
      render();await refreshConnections();await tick(100);
      check(qa('.vd-settings-nav button').map(e=>e.textContent).join('|')==='Connections|Co-Director|Watch|Appearance|General','approved settings pages: '+document.body.textContent.slice(0,800)+'; errors: '+errors.join('|'));
      await click('Manage ▾',q('[data-provider=openai]'));
      check(q('[data-provider=openai]').textContent.includes('Logged in'),'account state in Settings');
      await click('Log out',q('[data-provider=openai]'));
      check(settings.codirEngine==='codex'&&settings.openaiKey===initialKeys.openaiKey,'logout preserves active choice and saved API key');
      check(!connectionReady(),'logged-out account is unavailable');
      await set(q('textarea',panel()),'keep my draft');
      check(btn('send',panel()).disabled,'send disabled after logout');
      q('textarea',panel()).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await tick();
      check(!calls.some(c=>c[0]==='send')&&q('textarea',panel()).value==='keep my draft','Enter preserves draft and sends nothing');
      failLogin=true;await click('Log in with ChatGPT',q('[data-provider=openai]'));
      check(q('[role=alert]',dialog()).textContent.includes('cancelled'),'failed login is shown');
      failLogin=false;await click('Log in with ChatGPT',q('[data-provider=openai]'));
      check(connectionReady()&&!btn('send',panel()).disabled,'login refreshes both surfaces');
      await click('Switch account',q('[data-provider=openai]'));
      check(calls.slice(-2).map(c=>c[0]).join(',')==='logout,login','switch logs out before opening login');
      const key=()=>q('[data-key-connection=openai]');
      await click('Check',key());check(key().textContent.includes('Verified'),'saved key can be checked');
      await click('Replace',key());await set(q('input',key()),'bad-key');await click('Check and save',key());
      check(settings.openaiKey===initialKeys.openaiKey&&useConnections.getState().checks.openaiKey.state==='verified','rejected draft preserves saved key and status');
      failSave=true;await set(q('input',key()),'new-valid-key');await click('Check and save',key());
      check(q('input',key()).value==='new-valid-key'&&key().textContent.includes('Disk write failed'),'save failure preserves draft');failSave=false;
      await click('Check and save',key());check(!q('input',key())&&settings.openaiKey==='••••-key','saved secret cleared from input');
      await click('Use API key for Co-Director',q('[data-provider=openai]'));
      check(settings.codirEngine==='openai'&&connectionReady(),'explicit API selection');
      await click('Remove',key());await click('Remove',qa('[role=dialog]').at(-1));
      check(!settings.openaiKey&&settings.codirEngine==='openai'&&!connectionReady(),'removing active key never selects an account silently');
      await click('Use for Co-Director',q('[data-account-connection=codex]',dialog()));
      await click('Co-Director',q('.vd-settings-nav'));
      await set(q('[aria-label="Co-Director thinking"]',dialog()),'max');await set(q('[aria-label="Co-Director model"]',dialog()),'gpt-5.5');check(settings.codirEffort==='','unsupported effort resets on model switch');await set(q('[aria-label="Co-Director thinking"]',dialog()),'xhigh');
      check(settings.codirCodexModel==='gpt-5.5'&&settings.codirEffort==='xhigh','model and thinking save instantly');
      check(q('.vd-llm-summary',panel()).textContent.includes('GPT-5.5'),'header mirrors Settings');
      await saveConnectionSettings({veniceKey:'test-venice',deepseekKey:'test-deepseek'});
      const other=q('[aria-label="Other Co-Director connection"]');other.closest('details').open=true;
      check(q('option[value=gemini]',other).disabled,'missing CLI is unavailable');
      for(const engine of ['venice','deepseek']){await set(other,engine);check(settings.codirEngine===engine&&q('[aria-label="Co-Director model"]').value===(engine==='venice'?'claude-sonnet-5-5':'deepseek-v4-pro'),'existing provider model list follows selection')}
      await saveConnectionSettings({codirEngine:'codex'});await tick(80);
      await click('Instructions & context',dialog());
      check(qa('.vd-settings-guide input',dialog()).length===5&&qa('.vd-settings-guide input',dialog())[0].disabled,'guide controls preserved');
      qa('.vd-settings-guide input',dialog())[1].click();await tick(80);check(settings.codirGuideLoad.master===false,'guide choice saved');
      await click('Watch',q('.vd-settings-nav'));await set(q('[aria-label="Watch model"]'),'models/gemini-test');await click('Apply model',dialog());check(settings.googleWatchModel==='gemini-test','watch model normalised and saved');
      await click('Manage connection',dialog());check(q('[data-provider=google] input')===null&&q('[data-key-connection=google]'),'watch opens Google connection details');
      await set(q('[aria-label="Connection provider"]'),'ark');await click('Add credentials',q('[data-provider=ark]'));
      const balance=q('[data-provider=ark]');await set(q('[aria-label="BytePlus Access Key ID"]',balance),'test-id');
      check(btn('Check and save',balance).disabled,'half a balance credential pair cannot save');
      const secret=qa('input',balance).at(-1);await set(secret,'bad-secret');await click('Check and save',balance);check(!settings.byteplusSecretKey,'refused balance credentials not saved');
      await set(secret,'good-secret');await click('Check and save',balance);check(settings.byteplusAccessKeyId&&settings.byteplusSecretKey,'valid pair saved together');
      await click('Appearance',q('.vd-settings-nav'));await set(q('[aria-label="Tile titles"]'),'12');check(settings.tileTitleSize===12,'tile title choice preserved');
      await click('Customize colors',dialog());const color=q('input[type=color]');const variable=color.getAttribute('aria-label');await set(color,'#123456');
      await click('General',q('.vd-settings-nav'));check(!document.documentElement.style.cssText.includes('#123456'),'leaving Appearance reverts unsaved preview');
      check(q('input',dialog()).value==='Existing author','saved author loaded');await set(q('input',dialog()),'New author');await click('Apply name',dialog());check(settings.moodAuthor==='New author','author saved');
      await click('Choose folder…',dialog());check(dialog().textContent.includes('C:/Exports'),'chosen export folder displayed');await click('Ask each time',dialog());check(settings.exportDir==='','export default reset');
      render('wizard');await tick(80);q('[data-setup-pill="0"]').click();await tick(100);
      check(q('[data-service=codex] [data-account-connection=codex]').textContent.includes('Logged in'),'wizard shares account controls');
      await click('Log out',q('[data-service=codex]'));check(!connectionReady()&&settings.codirEngine==='codex','wizard logout updates header and preserves selection');
      render('settings');await tick(80);await click('General',q('.vd-settings-nav'));await click('Review unused files',dialog());await click('Cancel',qa('[role=dialog]').at(-1));check(cleanupCalls.join(',')==='false','cleanup cancellation performs only dry run');
      cleanupBusy=true;await click('Review unused files',dialog());check(cleanupCalls.every(v=>v===false),'busy cleanup cannot delete');render('panel');await tick(80);
      render('settings');await tick(80);await click('Manage ▾',q('[data-provider=openai]'));
      check(!errors.length,'no runtime errors: '+errors.join('|'));
      return 'Settings + header + wizard: explicit connection selection, login/logout/switch, draft protection, API key validation/removal, models, guides, Watch, themes, export, balance credentials and cleanup safeguards';
    }
    export async function show(view){render(view);await tick(100);if(view==='panel'){q('.vd-llm-summary').click();await tick()}return true}
    export function layout(){const d=dialog();return !d||d.scrollWidth<=d.clientWidth+1}
  `, resolveDir: path.resolve(__dirname,'..'), loader:'tsx' }, outfile:path.join(tmp,'checks.js'), bundle:true, format:'iife', globalName:'checks', jsx:'automatic', alias:{react:path.resolve(__dirname,'../node_modules/react'),'react-dom':path.resolve(__dirname,'../node_modules/react-dom'),dockview:path.resolve(__dirname,'../node_modules/dockview')}, loader:{'.png':'dataurl'}, define:{'process.env.NODE_ENV':'"production"','import.meta.hot':'undefined'}, logLevel:'silent' })
  fs.writeFileSync(path.join(tmp,'index.html'),'<html><head><link rel="stylesheet" href="checks.css"></head><body><div id="root"></div><script src="checks.js"></script></body></html>')
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
  const e=require('node:child_process').spawnSync(process.env.VD_ELECTRON_BINARY||require('electron'),[__filename,tmp],{env,encoding:'utf8',timeout:90000,windowsHide:true})
  process.stdout.write((e.stdout||'').split('\n').filter(l=>/^(PASS|Error|ARTIFACT)/.test(l)).join('\n')+'\n')
  if(e.status!==0)process.stderr.write((e.stderr||'').slice(-2200));process.exitCode=e.status===0?0:1
} else {
  const {app,BrowserWindow}=require('electron'),tmp=process.argv[2]
  app.setPath('userData',path.join(tmp,'profile'))
  app.whenReady().then(async()=>{try{
    const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,backgroundThrottling:false,offscreen:true}})
    await win.loadFile(path.join(tmp,'index.html'))
    console.log('PASS '+await win.webContents.executeJavaScript('checks.run()'))
    await win.webContents.executeJavaScript('checks.show("settings")');await new Promise(r=>setTimeout(r,150))
    fs.writeFileSync(path.join(tmp,'settings-desktop.png'),(await win.webContents.capturePage()).toPNG())
    win.setSize(600,850);await new Promise(r=>setTimeout(r,150))
    if(!await win.webContents.executeJavaScript('checks.layout()'))throw Error('Settings overflows narrow viewport')
    fs.writeFileSync(path.join(tmp,'settings-narrow.png'),(await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript('checks.show("panel")');await new Promise(r=>setTimeout(r,150))
    fs.writeFileSync(path.join(tmp,'llm-header.png'),(await win.webContents.capturePage()).toPNG())
    console.log('ARTIFACT '+tmp);app.exit(0)
  }catch(e){console.log('Error '+(e.stack||e));app.exit(1)}})
}
