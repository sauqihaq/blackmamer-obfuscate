'use strict';
// Full real-browser UI test against the user's deployed Netlify site.
// This test does not alter production data and sends only tiny harmless scripts.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const errors=[];
  try{
    const context=await browser.newContext({acceptDownloads:true,viewport:{width:1365,height:900}});
    const page=await context.newPage();
    page.on('pageerror', e=>errors.push(String(e)));
    const started=Date.now();
    const res=await page.goto('https://blackmamerstudioobfuscated.netlify.app/',{
      waitUntil:'domcontentloaded',timeout:50000
    });
    assert.equal(res.status(),200);
    await page.locator('#source').waitFor({timeout:15000});
    assert.equal(await page.locator('#preset option[value="NativeV3"]').count(),1);
    assert.equal(await page.locator('#obfuscate').count(),1);
    console.log(JSON.stringify({test:'Browser loads real Netlify page',pass:true,http:res.status(),
      title:await page.title(),ms:Date.now()-started}));

    await page.locator('#preset').selectOption('NativeV3');
    assert.equal(await page.locator('#v3Options').isVisible(),true);
    await page.locator('#antiTamper').check();
    await page.locator('#antiDebug').check();
    await page.locator('#source').fill('print("Hello World")');
    const clickStart=Date.now();
    await page.locator('#obfuscate').click();
    await page.waitForFunction(()=>{
      const value=document.querySelector('#result')?.value||'';
      const busy=document.querySelector('#obfuscate')?.disabled;
      return value.includes('BLACKMAMER VM V3.4')&&!busy;
    },null,{timeout:130000});
    const out=await page.locator('#result').inputValue();
    assert.ok(out.length>1000);
    const status=await page.locator('#taskStatus').innerText();
    assert.ok(/selesai/i.test(status),'Expected UI success message: '+status);
    assert.equal(await page.locator('#download').isEnabled(),true);
    console.log(JSON.stringify({test:'Browser NativeV3 click -> Render -> output',pass:true,
      outputChars:out.length,ms:Date.now()-clickStart,status,antiTamper:true,antiDebug:true}));

    const downloadEvent=page.waitForEvent('download',{timeout:12000});
    await page.locator('#download').click();
    const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),'BLACKMAMER_STUDIO_obfuscated.luau');
    console.log(JSON.stringify({test:'Browser Download .luau works',pass:true,
      filename:download.suggestedFilename()}));

    // Verify upload control and file reading use actual browser File APIs.
    await page.locator('#file').setInputFiles({
      name:'test.luau',mimeType:'text/plain',buffer:Buffer.from('print("Upload works")')
    });
    await page.waitForFunction(()=>document.querySelector('#source').value==='print("Upload works")',
      null,{timeout:12000});
    console.log(JSON.stringify({test:'Browser upload .luau works',pass:true}));

    assert.deepEqual(errors,[],'JavaScript page errors: '+JSON.stringify(errors));
    console.log(JSON.stringify({test:'No uncaught JavaScript page errors',pass:true}));
    console.log('RESULT 5/5 BROWSER TESTS PASSED');
  }finally{
    await browser.close();
  }
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
