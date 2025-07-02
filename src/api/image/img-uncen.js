const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const https = require('https');
const HttpsProxyAgent = require('https-proxy-agent');

module.exports = (app) => {
  const proxyFilePath = path.join(process.cwd(), 'proxies.txt');
  let proxyList = [];

  if (fs.existsSync(proxyFilePath)) {
    proxyList = fs.readFileSync(proxyFilePath, 'utf-8').split(/\r?\n/).filter(p => p.trim() !== '');
    console.log(chalk.green(`[SUCCESS] Loaded ${proxyList.length} proxies.`));
  } else {
    console.log(chalk.red(`[X] proxies.txt not found.`));
  }

  app.get('/api/image/uncen', async (req, res) => {
    const { prompt, negative_prompt, style, width, height, guidance_scale, inference_steps } = req.query;

    if (!prompt) {
      return res.status(400).json({ status: 400, message: "Parameter 'prompt' is required." });
    }

    if (proxyList.length === 0) {
      return res.status(500).json({ status: 500, message: "No proxies loaded." });
    }

    try {
      const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
      console.log(chalk.yellow(`Using proxy: ${randomProxy}`));

      const agent = new HttpsProxyAgent(randomProxy);

      const _style = ['anime', 'real', 'photo'];
      const _styleValue = _style.includes(style) ? style : 'anime';

      const targetHost = `heartsync-nsfw-uncensored${_styleValue !== 'anime' ? `-${_styleValue}` : ''}.hf.space`;

      const session_hash = Math.random().toString(36).substring(2);

      const postData = JSON.stringify({
        data: [
          prompt,
          negative_prompt || 'lowres, bad anatomy, bad hands, text, error, extra digits, cropped, worst quality',
          0, true,
          parseInt(width) || 1024,
          parseInt(height) || 1024,
          parseFloat(guidance_scale) || 7,
          parseInt(inference_steps) || 28
        ],
        event_data: null,
        fn_index: 2,
        trigger_id: 16,
        session_hash: session_hash
      });

      const options = {
        hostname: targetHost,
        port: 443,
        path: '/gradio_api/queue/join?',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        agent
      };

      const reqHttps = https.request(options, (resp) => {
        let body = '';
        resp.on('data', (chunk) => body += chunk);
        resp.on('end', () => {
          console.log(chalk.green(`Response: ${body.substring(0, 300)}...`));
          return res.json({
            status: 200,
            result: {
              info: "Request sent successfully. Please check logs or adjust your frontend polling for /data endpoint."
            }
          });
        });
      });

      reqHttps.on('error', (err) => {
        console.error(chalk.red(`Request Error: ${err.message}`));
        return res.status(500).json({ status: 500, message: err.message });
      });

      reqHttps.write(postData);
      reqHttps.end();

    } catch (e) {
      console.error(chalk.red(`Failed: ${e.message}`));
      return res.status(500).json({ status: 500, message: e.message });
    }
  });
};
