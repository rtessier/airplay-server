module.exports = class Session {
  constructor(encryptionKey, initVector, codec) {


    this._encryptionKey = encryptionKey
    this._initVector = initVector
    this._codec = codec
    
  }
}
