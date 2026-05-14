const tls = require('tls');

// --- LOGIKA ASLI KAMU ---
exports.handler = async (event, context) => {
  const ipParam = (event.queryStringParameters && event.queryStringParameters.ip) || '';
  if (!ipParam) {
    return jsonResponse(400, { error: 'mana proxynya? pakai ?ip=ip:port,ip:port' });
  }

  const proxyList = ipParam.split(',').map((s) => s.trim()).filter(Boolean);
  const limitedProxies = proxyList.slice(0, 10);
  let srvip = {};

  const sendRequest = (proxy, port, host, path, useProxy = true) => {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: useProxy ? proxy : host,
        port: useProxy ? port : 443,
        servername: host,
        rejectUnauthorized: false
      }, () => {
        const request = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nReferer: https://speed.cloudflare.com/\r\nConnection: close\r\n\r\n`;
        socket.write(request);
      });

      let responseBody = '';
      socket.on('data', (data) => { responseBody += data.toString(); });
      socket.on('end', () => {
        const body = responseBody.split('\r\n\r\n')[1] || '';
        socket.end();
        resolve(body);
      });
      socket.on('error', (error) => { socket.end(); reject(error); });
      socket.setTimeout(5000, () => { socket.end(); reject(new Error('Request timeout')); });
    });
  };

  const checkProxy = async (proxyString) => {
    const [proxy, port = '443'] = proxyString.split(':');
    if (!proxy) return { error: 'mana proxynya?', proxyip: false };
    try {
      const t0 = Date.now();
      const ipinfo = await sendRequest(proxy, port, 'speed.cloudflare.com', '/meta', true);
      const delay = Date.now() - t0;
      const myips = await sendRequest(proxy, port, 'speed.cloudflare.com', '/meta', false);
      const ipingfo = JSON.parse(ipinfo);
      const { clientIp, ...ipinfoh } = ipingfo;
      srvip = JSON.parse(myips);
      if (clientIp && clientIp !== srvip.clientIp) {
        return { proxy, port, proxyip: true, ip: clientIp, delay: `${delay} ms`, ...ipinfoh };
      } else {
        return { proxy, port, proxyip: false, delay: `${delay} ms` };
      }
    } catch (error) {
      return { proxy, port, error: error.message, proxyip: false };
    }
  };

  try {
    let result = (limitedProxies.length === 1) ? await checkProxy(limitedProxies[0]) : await Promise.all(limitedProxies.map(checkProxy));
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, { error: error.message || 'internal error' });
  }
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data, null, 2),
  };
}

// --- BRIDGE VERCEL ---
module.exports = async (req, res) => {
  const event = { queryStringParameters: req.query };
  const result = await exports.handler(event, {});
  Object.keys(result.headers).forEach(key => res.setHeader(key, result.headers[key]));
  res.status(result.statusCode).send(result.body);
};
