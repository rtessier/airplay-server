var randomMac = require('random-mac')
var net = require('net')
var bonjour = require('bonjour')()
var httplike = require('httplike')
var util = require('util')
var auth = require('./lib/auth')
var ipaddr = require('ipaddr.js')
var sdp = require('sdp-transform')
var sessions = require('./lib/sessions')
var AlacDecoderStream = require('alac2pcm');
var OutputStream = require('./lib/streams/output');
var RtpServer = require('./lib/rtp-socket')
var Nicercast = require('nicercast')
const crypto = require('crypto');
const ip = require('ip')
const sonos = require('node-sonos')

var announce = require('./lib/announce')

var serverAgent = 'AirTunes/105.1'

global._socket = null;
global._raopMacAddr = randomMac()
global._outputStream = null
global._audioAesKey = null
global._audioAesIv = null

global._device = null

function handleClientConnected() {
  console.log("\nClient connected!")
  var audiocast = new Nicercast(global._outputStream, {})
  audiocast.start(6007, (port) => {
    global._device.play({
      uri: `x-rincon-mp3radio://${ ip.address() }:${ port }/listen.m3u`,
      metadata: generateSonosMetadata("DeviceName")
    })
  })
}

function generateSonosMetadata(clientName) {
  return `<?xml version="1.0"?>
  <DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">
  <item id="R:0/0/49" parentID="R:0/0" restricted="true">
  <dc:title>${ clientName }</dc:title>
  <upnp:class>object.item.audioItem.audioBroadcast</upnp:class>
  <desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc>
  </item>
  </DIDL-Lite>`;
}

function decryptAudioData(data) {
  const tmp = new Buffer(16);
  let headerSize = 12;

  const remainder = (data.length - 12) % 16;
  const endOfEncodedData = data.length - remainder;

  const audioAesKeyBuffer = new Buffer(this._audioAesKey, "binary");
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    audioAesKeyBuffer,
    this._audioAesIv
  );
  decipher.setAutoPadding(false);

  for (let i = headerSize, l = endOfEncodedData - 16; i <= l; i += 16) {
    data.copy(tmp, 0, i, i + 16);
    decipher.update(tmp).copy(data, i, 0, 16);
  }

  return data.slice(headerSize);
}

var server = net.createServer((socket) => {
  console.log("\nClient handshake...")
  global._socket = socket;

  socket.on("end", () => {
    console.log("\nClient disconnected.");
  })

  var parser = new httplike(socket, {
    protocol: "RTSP/1.0"
  });

  parser.on("message", (request, response) => {
    response.set('CSeq', request.getHeader('cseq'));
    response.set('Server', 'AirTunes/105.1');

    console.log("\n[CLIENT => SERVER]\n%s: %s\n%s",
    request.getHeader("cseq"),
    request.method,
    util.inspect(request)
  );

  if (request.method.toUpperCase() === "OPTIONS") {
    response.set('Public', 'ANNOUNCE, SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER, POST, GET');

    var challenge = request.headers['apple-challenge']
    if (challenge) {

      // challenge response consists of challenge + ip address + mac address + padding to 32 bytes,
      // encrypted with the ApEx private key (private encryption mode w/ PKCS1 padding)

      var challengeBuf = new Buffer(challenge, 'base64');

      // Parse IP
      // is it IP V6? and is IP V4 mapped address
      var ipAddrRepr = ipaddr.parse(global._socket.address().address);
      if (ipAddrRepr.kind() === 'ipv6' && ipAddrRepr.isIPv4MappedAddress()) {
        ipAddrRepr = ipAddrRepr.toIPv4Address();
      }

      var ipAddr = new Buffer(ipAddrRepr.toByteArray());

      var macAddr = new Buffer(global._raopMacAddr.replace(/:/g, ''), 'hex');
      response.set('Apple-Response', auth(challengeBuf, ipAddr, macAddr));
    }

    console.log("\n[SERVER => CLIENT]\n%s\n%s",
    response.statusCode,
    util.inspect(response.headers)
  );

  response.send();

} else if (request.method.toUpperCase() === "ANNOUNCE") {
  var announceRequest = new announce(request.content)
  global._audioAesKey = announceRequest._audioAesKey;
  global._audioAesIv = announceRequest._audioAesIv;

  const decoderOptions = announceRequest.getDecoderOptions()
  const decoderStream = new AlacDecoderStream(decoderOptions);

  // rtspServer.clientConnected = res.socket;
  global._outputStream = new OutputStream();
  global._outputStream.setDecoder(decoderStream);
  handleClientConnected()

  console.log("\n[SERVER => CLIENT]\n%s\n%s",
  response.statusCode,
  util.inspect(response.headers)
);

response.send();
} else if (request.method.toUpperCase() === "SETUP") {
  var audioSocket = new RtpServer(6001, (data) => {
    var seq = data.readUInt16BE(2);
    var audio = decryptAudioData(data);
    global._outputStream.add(audio, seq);
  })
  var controlSocket = new RtpServer(6002, () => {

  })
  var timingSocket = new RtpServer(6003, () => {})

  response.set('Transport', 'RTP/AVP/UDP;unicast;mode=record;server_port=' + 6001 + ';control_port=' + 6002 + ';timing_port=' + 6003);
  response.set('Session', '1');
  response.set('Audio-Jack-Status', 'connected');

  console.log("\n[SERVER => CLIENT]\n%s\n%s",
  response.statusCode,
  util.inspect(response.headers)
);

response.send();
} else if (request.method.toUpperCase() === "RECORD") {
  if (!request.getHeader('RTP-Info')) {
    // jscs:disable
    // it seems like iOS airplay does something else
  } else {
    var rtpInfo = request.getHeader('RTP-Info').split(';');
    var initSeq = rtpInfo[0].split('=')[1];
    var initRtpTime = rtpInfo[1].split('=')[1];
    if (!initSeq || !initRtpTime) {
      response.send(400);
    } else {
      response.set('Audio-Latency', '0'); // FIXME
    }
  }

  response.send();
} else if (request.method.toUpperCase() === "SET_PARAMETER") {
  var data = request.content.toString().split(': ')

  if (data[0] == 'volume') {
    let targetVol = 100 - Math.floor(-1 * (Math.max(parseFloat(data[1]), -30) / 30) * 100);
    console.log('volumeChange %s', parseFloat(data[1]));
    console.log('volumeChange %s', targetVol);
    // global._device.setVolume()
  } else if (data[0] == 'progress') {
    console.log('progressChange %s', parseFloat(data[1]));
  } else {
    console.log('uncaptured SET_PARAMETER method: %s', request.content.toString().trim());
  }
  response.send();
} else if (request.method.toUpperCase() === "FLUSH") {
  response.send();
} else {

}
})
})

server.listen(5000, () => {
  var txtRecord = {
    txtvers: '1',
    ch: '2',
    cn: '0,1',
    ek: '1',
    et: '0,1',
    sv: 'false',
    da: 'true',
    sr: '44100',
    ss: '16',
    pw: 'false',
    vn: '65537',
    tp: 'TCP,UDP',
    vs: '105.1',
    am: 'AirPort4,107',
    fv: '76400.10',
    sf: '0x0'
  }

  var search = sonos.search()

  search.on('DeviceAvailable', (device, model) => {
    global._device = device

    var zoneName = "AirSonos"
    device.getZoneAttrs((err, info) => {
      zoneName = info.CurrentZoneName

      var service = bonjour.publish({
        name: global._raopMacAddr + "@" + zoneName,
        port: server.address().port,
        type: "raop",
        txt: txtRecord
      })

      service.start()

      console.log("The AirPlay device %s is being broadcast...", zoneName)
    })
  })
})
