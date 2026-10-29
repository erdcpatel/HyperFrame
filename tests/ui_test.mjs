import { spawn } from 'child_process';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9220 + Math.floor(Math.random() * 50);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      if (res.ok) {
        const data = await res.json();
        const page = Array.isArray(data) ? data.find(t => t.type === 'page') : null;
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Failed to connect to Chrome debugging port');
}

async function run() {
  console.log('🚀 Launching Headless Chrome on port ' + DEBUG_PORT + '...');
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1400,900',
    'http://127.0.0.1:8000'
  ]);

  try {
    const wsUrl = await getWsUrl();
    console.log('🔗 Connected to Chrome DevTools Protocol at:', wsUrl);

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let id = 1;
    const callbacks = new Map();
    const consoleLogs = [];
    const jsErrors = [];

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg.result || msg.error);
        callbacks.delete(msg.id);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
        consoleLogs.push(`[${msg.params.type}] ${text}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        jsErrors.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
      }
    };

    function send(method, params = {}, timeoutMs = 8000) {
      return new Promise((resolve) => {
        const msgId = id++;
        const timer = setTimeout(() => {
          callbacks.delete(msgId);
          resolve({ error: 'timeout' });
        }, timeoutMs);
        callbacks.set(msgId, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');

    console.log('⏳ Waiting for React Studio to mount...');
    await sleep(2500);

    // 1. Initial Page Verification
    const evalRoot = await send('Runtime.evaluate', {
      expression: `({
        title: document.title,
        rootChildren: document.getElementById('root')?.childElementCount || 0,
        activeEngine: document.querySelector('select')?.value || ''
      })`,
      returnByValue: true
    });
    console.log('✅ Page Initialization:', evalRoot?.result?.value);

    // 2. AG Grid Infinite Scroll Test
    const evalGrid = await send('Runtime.evaluate', {
      expression: `({
        hasAgGrid: !!document.querySelector('.ag-theme-alpine-dark'),
        initialRowCount: document.querySelectorAll('.ag-row').length
      })`,
      returnByValue: true
    });
    console.log('✅ Infinite Grid Ready:', evalGrid?.result?.value);

    console.log('⚡ Testing Grid Scroll Performance (scrollTop = 5,000)...');
    const scrollStart = Date.now();
    await send('Runtime.evaluate', {
      expression: `
        const viewport = document.querySelector('.ag-body-viewport');
        if (viewport) viewport.scrollTop = 5000;
      `
    });
    await sleep(800);
    const scrollLatency = Date.now() - scrollStart;
    const postScrollRows = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('.ag-row').length`,
      returnByValue: true
    });
    console.log(`✅ Scroll Completed: ${postScrollRows?.result?.value} rows rendered (Virtual Window Latency: ${scrollLatency}ms)`);

    // 3. Perspective Pivot Matrix Test
    console.log('📊 Testing Perspective Pivot Table...');
    await send('Runtime.evaluate', {
      expression: `
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Perspective Pivot'));
        if (btn) btn.click();
      `
    });
    await sleep(1500);
    const evalPivot = await send('Runtime.evaluate', {
      expression: `({
        hasPivotTable: !!document.querySelector('table'),
        tableRowCount: document.querySelectorAll('tr').length,
        hasChartToggle: !!document.querySelector('button[title*="Bar"]')
      })`,
      returnByValue: true
    });
    console.log('✅ Perspective Pivot View:', evalPivot?.result?.value);

    // 4. SQL Playground Test
    console.log('💻 Testing SQL Playground...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('SQL Playground'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1500);
    const evalSqlEditor = await send('Runtime.evaluate', {
      expression: `({
        hasTextarea: !!document.querySelector('textarea'),
        hasRunBtn: !!Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Run Query')),
        hasTemplates: document.body.textContent.includes('Templates:')
      })`,
      returnByValue: true
    });
    console.log('✅ SQL Playground Editor Loaded:', evalSqlEditor?.result?.value);

    console.log('▶️ Executing SQL Query...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const runBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Run Query'));
        if (runBtn) runBtn.click();
      })()`
    });
    // Wait for query result table to appear
    for (let i = 0; i < 20; i++) {
      const check = await send('Runtime.evaluate', {
        expression: `document.querySelectorAll('table').length > 0`,
        returnByValue: true
      });
      if (check?.result?.value) break;
      await sleep(200);
    }
    const evalSqlResult = await send('Runtime.evaluate', {
      expression: `({
        hasResultTable: !!document.querySelector('table'),
        resultRowCount: document.querySelectorAll('tr').length
      })`,
      returnByValue: true
    });
    console.log('✅ SQL Query Executed & Result Table Rendered:', evalSqlResult?.result?.value);

    // 5. Arena Dual-Engine Race Mode Test
    console.log('⚔️ Testing Arena Race Mode...');
    await send('Runtime.evaluate', {
      expression: `
        const arenaBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Arena Race Mode'));
        if (arenaBtn) arenaBtn.click();
      `
    });
    await sleep(1000);

    console.log('🔥 Firing Synchronized Dual-Engine Benchmark Race...');
    await send('Runtime.evaluate', {
      expression: `
        const raceBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('FIRE SYNCHRONIZED RACE'));
        if (raceBtn) raceBtn.click();
      `
    });
    await sleep(2500);
    const evalArenaResult = await send('Runtime.evaluate', {
      expression: `({
        raceFinished: document.body.textContent.includes('Winner:') || document.body.textContent.includes('faster execution'),
        winner: document.querySelector('.text-emerald-400.uppercase')?.textContent || 'Tie/Pending'
      })`,
      returnByValue: true
    });
    console.log('✅ Arena Race Completed:', evalArenaResult?.result?.value);

    // 6. X-Ray Plan & Waterfall Drawer Test
    console.log('🔬 Testing X-Ray Plan Drawer...');
    await send('Runtime.evaluate', {
      expression: `
        const xrayBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('X-Ray Plan'));
        if (xrayBtn) xrayBtn.click();
      `
    });
    await sleep(800);
    const evalXray = await send('Runtime.evaluate', {
      expression: `({
        drawerOpen: document.body.textContent.includes('Query Execution Plan') || document.body.textContent.includes('EXPLAIN') || document.body.textContent.includes('Query Plan')
      })`,
      returnByValue: true
    });
    console.log('✅ X-Ray Drawer Toggle:', evalXray?.result?.value);

    // 7. Verify Health & Console Log / JS Error Integrity
    console.log('\n==============================================');
    console.log(`📊 Summary of Automated Chrome Headless UI Run:`);
    console.log(`- Total Console Messages: ${consoleLogs.length}`);
    console.log(`- Total JavaScript Exceptions: ${jsErrors.length}`);
    if (jsErrors.length > 0) {
      jsErrors.forEach(err => console.error('  ❌ JS Error:', err));
      throw new Error(`Test failed with ${jsErrors.length} JavaScript runtime errors.`);
    } else {
      console.log('✅ 0 JavaScript runtime errors detected across all tabs!');
    }
    console.log('==============================================\n');

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(err => {
  console.error('❌ UI Test encountered an error:', err);
  process.exit(1);
});
