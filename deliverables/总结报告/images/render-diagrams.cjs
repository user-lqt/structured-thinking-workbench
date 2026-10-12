const { chromium } = require('C:/Users/lenovo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const page = await browser.newPage({viewport:{width:880,height:820}, deviceScaleFactor:3});
    const names = process.argv.slice(2);
    for (const name of (names.length ? names : ['system-architecture','material-workflow','activity-tree','pdca-cycle','lifecycle-controls','align-inputs','risk-matrix','workbench-main-flow','task-delivery-flow','weather-response','validation-evidence'])) {
      await page.goto(pathToFileURL(path.join(__dirname,name+'.html')).href);
      await page.evaluate(() => document.fonts.ready);
      const checks = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        const nodes = [...svg.querySelectorAll('g[data-node]')];
        const problems = [];
        for (const node of nodes) {
          const box = node.querySelector('rect').getBBox();
          for(const text of node.querySelectorAll('text')) {
            const r = text.getBBox();
            if (r.x < box.x+5 || r.x+r.width > box.x+box.width-5 || r.y < box.y || r.y+r.height > box.y+box.height-4) problems.push(text.textContent);
          }
        }
        return {nodes:nodes.length, labelOverflow:problems, font:getComputedStyle(svg.querySelector('text')).fontFamily};
      });
      if(checks.labelOverflow.length) throw new Error(JSON.stringify(checks));
      await page.locator('svg').screenshot({path:path.join(__dirname,name+'.png'),omitBackground:true});
      console.log(name, JSON.stringify(checks));
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
