var dgram = require('dgram')

module.exports = class RtpServer {
  constructor (port, callback) {
    this._port = port
    this._callback = callback
    this._socket = dgram.createSocket('udp4')
    this._socket.bind(port)

    this._socket.on('message', (message) => {
      this._callback(message)
    })
  }
}
