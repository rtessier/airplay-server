const decrypt = require('./decrypt')

module.exports = class Announce {
  constructor(requestData) {
    const multi = ["a", "p", "b"];

    const lines = requestData.toString().split("\r\n");
    const output = {};
    for (let i = 0; i < lines.length; i += 1) {
      const sp = lines[i].split(/=(.+)?/);
      if (sp.length === 3) {
        // for some reason there's an empty item?
        if (multi.indexOf(sp[0]) !== -1) {
          // some attributes are multiline...
          if (!output[sp[0]]) output[sp[0]] = [];

          output[sp[0]].push(sp[1]);
        } else {
          output[sp[0]] = sp[1];
        }
      }
    }

    const sdp = output;

    for (let i = 0; i < sdp.a.length; i += 1) {
      const spIndex = sdp.a[i].indexOf(":");
      const aKey = sdp.a[i].substring(0, spIndex);
      const aValue = sdp.a[i].substring(spIndex + 1);

      if (aKey === "rsaaeskey") {
        this._audioAesKey = decrypt(new Buffer(aValue, 'base64').toString('binary'), 'RSA-OAEP');
      } else if (aKey === "aesiv") {
        this._audioAesIv = new Buffer(aValue, "base64");
      } else if (aKey === "rtpmap") {
        this._audioCodec = aValue;

        if (
          aValue.indexOf("AppleLossless") === -1
        ) {
          console.log("Codec not supported!")
          // PCM: L16/(...)
          // ALAC: 96 AppleLossless
          // rtspServer.external.emit("error", {
          //   code: 415,
          //   message: `Codec not supported (${aValue})`
          // });
          // response.status(415).send();
        }
      } else if (aKey === "fmtp") {
        this._audioOptions = aValue.split(" ");
      }
    }

    if (sdp.i) {
      this._clientName = sdp.i;
      // rtspServer.external.emit("clientNameChange", sdp.i);
    }

    if (sdp.c) {
      if (sdp.c.indexOf("IP6") !== -1) {
        this._ipv6 = true;
      }
    }
  }

  getDecoderOptions() {
  if (!this._audioOptions) return {}
  var decoderOptions = {
      frameLength: parseInt(this._audioOptions[1], 10),
      compatibleVersion: parseInt(this._audioOptions[2], 10),
      bitDepth: parseInt(this._audioOptions[3], 10),
      pb: parseInt(this._audioOptions[4], 10),
      mb: parseInt(this._audioOptions[5], 10),
      kb: parseInt(this._audioOptions[6], 10),
      channels: parseInt(this._audioOptions[7], 10),
      maxRun: parseInt(this._audioOptions[8], 10),
      maxFrameBytes: parseInt(this._audioOptions[9], 10),
      avgBitRate: parseInt(this._audioOptions[10], 10),
      sampleRate: parseInt(this._audioOptions[11], 10)
    };

  return decoderOptions;
};
}
