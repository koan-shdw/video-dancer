// Built app + real preload/IPC and OS encryption, in an empty temporary installation profile.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict')
if(!process.versions.electron){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vd-settings-storage-'))
  const env={...process.env,VIDEO_DANCER_DATA_DIR:tmp,VIDEO_DANCER_DEV_INSTALL:'1'}
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  fs.writeFileSync(path.join(tmp,'settings.json'),JSON.stringify({welcomeSeen:true,tourDone:true,lastSeenVersion:'0.25.0'}))
  const r=require('node:child_process').spawnSync(require('electron'),[__filename,tmp],{env,encoding:'utf8',windowsHide:true,timeout:60000})
  process.stdout.write((r.stdout||'').split('\n').filter(l=>/^(PASS|FAIL)/.test(l)).join('\n')+'\n')
  if(r.status!==0)process.stderr.write((r.stderr||'').slice(-1500));process.exitCode=r.status===0?0:1
}else{
  const {app,safeStorage}=require('electron'),tmp=process.argv[2]
  app.on('browser-window-created',(_event,win)=>{
    win.show=()=>{} // the production window stays hidden throughout this check
    win.webContents.once('did-finish-load',async()=>{try{
      const result=await win.webContents.executeJavaScript(`(async()=>{
        const api=window.vidancer;
        const saved=await api.setSettings({openaiKey:'test-openai-only',anthropicKey:'test-anthropic-only',codirEngine:'codex'});
        await api.setSettings({openaiKey:saved.openaiKey,codirEffort:'high'});
        const read=await api.getSettings();
        const account=await api.codirCliStatus('codex',true);
        const methods=['codirCliLogout','codirCancelLogin','llmValidateKey','codirOpenaiModels'].every(k=>typeof api[k]==='function');
        return {saved,read,methods,loggedIn:account.loggedIn,models:await api.codirOpenaiModels()};
      })()`)
      assert.equal(result.methods,true);assert.equal(result.loggedIn,false)
      assert.equal(result.read.openaiKey,result.saved.openaiKey)
      assert.notEqual(result.read.openaiKey,'test-openai-only')
      assert.equal(result.read.codirEngine,'codex');assert.equal(result.models[0].id,'gpt-6.1-sol')
      assert.equal(safeStorage.isEncryptionAvailable(),true)
      let raw=JSON.parse(fs.readFileSync(path.join(tmp,'settings.json'),'utf8'))
      for(const [key,value] of [['openaiKey','test-openai-only'],['anthropicKey','test-anthropic-only']]){
        assert.ok(raw[key].startsWith('enc:'));assert.equal(safeStorage.decryptString(Buffer.from(raw[key].slice(4),'base64')),value)
      }
      assert.ok(fs.existsSync(path.join(tmp,'llm-accounts','codex')))
      await win.webContents.executeJavaScript("window.vidancer.setSettings({openaiKey:''})")
      raw=JSON.parse(fs.readFileSync(path.join(tmp,'settings.json'),'utf8'))
      assert.equal(raw.openaiKey,'');assert.ok(raw.anthropicKey.startsWith('enc:'))
      await new Promise(r=>setTimeout(r,900))
      const ui=await win.webContents.executeJavaScript(`(async()=>{
        for(const close of document.querySelectorAll('[aria-label="Close dialog"]'))close.click();
        const button=[...document.querySelectorAll('.btn,button')].find(b=>b.textContent.trim()==='Settings');
        if(!button)return 'Settings button missing';button.click();
        for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,100));if(document.querySelector('[data-provider=openai]'))return [...document.querySelectorAll('.vd-settings-nav button')].map(b=>b.textContent).join('|')}
        return document.body.textContent.slice(-1000);
      })()`)
      assert.equal(ui,'Connections|Co-Director|Watch|Appearance|General')
      console.log('PASS built app startup, Settings pages, real preload/IPC, isolated account profile, OS-encrypted OpenAI/Anthropic keys, masked round-trip and removal isolation')
      app.exit(0)
    }catch(e){console.log('FAIL '+e.message);app.exit(1)}})
  })
  require('../out/main/index.js')
}
