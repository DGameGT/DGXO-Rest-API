const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const http = require('http');
const https = require('https');

function connectProxy(proxyConfig, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const proxyAuth = 'Basic ' + Buffer.from(`${proxyConfig.username}:${proxyConfig.password}`).toString('base64');

    const connectReq = http.request({
      host: proxyConfig.host,
      port: proxyConfig.port,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      headers: {
        'Proxy-Authorization': proxyAuth
      }
    });

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Proxy rejected with status ${res.statusCode}`));
      }
      resolve(socket);
    });

    connectReq.on('error', reject);
    connectReq.end();
  });
}

function sendPost(socket, targetHost, targetPort, data) {
  return new Promise((resolve, reject) => {
    const postReq = https.request({
      host: targetHost,
      port: targetPort,
      path: '/gradio_api/queue/join?',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      socket: socket,
      agent: false
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });

    postReq.on('error', reject);
    postReq.write(data);
    postReq.end();
  });
}

function sendGet(socket, targetHost, targetPort, session_hash) {
  return new Promise((resolve, reject) => {
    const getReq = https.request({
      host: targetHost,
      port: targetPort,
      path: `/gradio_api/queue/data?session_hash=${session_hash}`,
      method: 'GET',
      socket: socket,
      agent: false
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });

    getReq.on('error', reject);
    getReq.end();
  });
}

function generateImageManually(prompt, proxyConfig, options = {}) {
  return new Promise(async (resolve, reject) => {
    const {
      negative_prompt = 'lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, cropped, worst quality, watermark, blurry',
      style = 'anime',
      width = 1024,
      height = 1024,
      guidance_scale = 7,
      inference_steps = 28
    } = options;

    const session_hash = Math.random().toString(36).substring(2);
    const targetHost = `heartsync-nsfw-uncensored${style !== 'anime' ? `-${style}` : ''}.hf.space`;
    const targetPort = 443;

    const postData = JSON.stringify({
      data: [prompt, negative_prompt, 0, true, width, height, guidance_scale, inference_steps],
      event_data: null, fn_index: 2, trigger_id: 16, session_hash: session_hash
    });

    try {
      const postSocket = await connectProxy(proxyConfig, targetHost, targetPort);
      await sendPost(postSocket, targetHost, targetPort, postData);
      postSocket.destroy();

      const getSocket = await connectProxy(proxyConfig, targetHost, targetPort);
      const getData = await sendGet(getSocket, targetHost, targetPort, session_hash);
      getSocket.destroy();

      const lines = getData.split('\n\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const d = JSON.parse(line.substring(6));
          if (d.msg === 'process_completed') {
            return resolve(d.output.data[0].url);
          }
        }
      }

      reject(new Error('Failed to get image URL.'));
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = (app) => {
  const proxyFilePath = path.join(process.cwd(), 'proxies.txt');
  let proxyList = [];

  if (fs.existsSync(proxyFilePath)) {
    const proxyFileContent = fs.readFileSync(proxyFilePath, 'utf-8');
    proxyList = proxyFileContent.split(/\r?\n/).filter(p => p.trim() !== '');
  }

  app.get('/api/image/uncen', async (req, res) => {
    const { prompt, negative_prompt, style, width, height, guidance_scale, inference_steps } = req.query;
    if (!prompt) {
      return res.status(400).json({ status: 400, message: "Parameter 'prompt' is required." });
    }

    const maxRetries = 5;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const proxyUrl = new URL(proxyList[Math.floor(Math.random() * proxyList.length)]);
        const proxyConfig = {
          host: proxyUrl.hostname,
          port: proxyUrl.port,
          username: proxyUrl.username,
          password: proxyUrl.password
        };

        const options = { negative_prompt, style, width: parseInt(width), height: parseInt(height), guidance_scale: parseFloat(guidance_scale), inference_steps: parseInt(inference_steps) };
        const filteredOptions = Object.fromEntries(Object.entries(options).filter(([_, v]) => v !== undefined));

        const imageUrl = await generateImageManually(prompt, proxyConfig, filteredOptions);
        return res.json({ status: 200, result: { url: imageUrl } });

      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) {
          return res.status(500).json({ status: 500, message: lastError.message });
        }
      }
    }
  });
};
