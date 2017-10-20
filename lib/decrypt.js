const forge = require("node-forge");
const fs = require('fs')

const getPrivateKey = function getPrivateKey() {
  const keyFile = fs.readFileSync(`${__dirname}/../keys/airport_rsa`);
  const privkey = forge.pki.privateKeyFromPem(keyFile);

  return privkey;
};

const privateKey = getPrivateKey();

module.exports = function(encryptedKey, decryptionMethod) {
  return privateKey.decrypt(encryptedKey, decryptionMethod)
}
