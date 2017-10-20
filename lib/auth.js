const forge = require("node-forge");
const fs = require('fs')

var ipaddr = require('ipaddr.js')

var rsa = require('./rsa')

const getPrivateKey = function getPrivateKey() {
  const keyFile = fs.readFileSync(`${__dirname}/../keys/airport_rsa`);
  const privkey = forge.pki.privateKeyFromPem(keyFile);

  return privkey;
};

const privateKey = getPrivateKey();

module.exports = function (challengeBuf,ipAddr,macAddr) {

  let fullChallenge = Buffer.concat([challengeBuf, ipAddr, macAddr]);

  // im sure there's an easier way to pad this buffer
  const padding = [];
  for (let i = fullChallenge.length; i < 32; i += 1) {
    padding.push(0);
  }

  fullChallenge = Buffer.concat([fullChallenge, new Buffer(padding)]).toString(
    "binary"
  );
  const response = forge.pki.rsa.encrypt(fullChallenge, privateKey, 0x01);

  return forge.util.encode64(response);
};
