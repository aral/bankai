var http = require('http')
var pump = require('pump')
var net = require('net')

var getPort = require('get-port')

var httpsServer = require('@ind.ie/https-server')

exports.createServer = createDevServer

function createDevServer (connectionHandler) {
  var httpPort, httpsPort
  var createSecureServer

  try {
    createSecureServer = httpsServer.createSecureServer
  } catch (e) {
    createSecureServer = httpsServer.createServer
  }

  return {
    listen: listen
  }

  function listen (port, onlisten) {
    net.createServer(tcpConnection).listen(port, onNetListen)

    function onNetListen () {
      getPort({port: 8080}).then(function (port) {
        httpPort = port
        var httpServer = http.createServer(httpConnection)
          .listen(port, onHttpListen)

        httpServer.keepAliveTimeout = 0
        httpServer.timeout = 0
      })
        .catch(function (err) {
          throw err
        })
    }

    function onHttpListen () {
      getPort({port: 4443}).then(function (port) {
        httpsPort = port
        var serverOpts = { allowHTTP1: true }
        var http2Server = createSecureServer(serverOpts, connectionHandler)
        http2Server.keepAliveTimeout = 0
        http2Server.timeout = 0
        http2Server.listen(httpsPort, function () {
          if (onlisten) onlisten()
        })
      })
        .catch(function (err) {
          throw err
        })
    }
  }

  function tcpConnection (conn) {
    conn.once('data', function (buf) {
      // A TLS handshake record starts with byte 22.
      var address = buf[0] === 22 ? httpsPort : httpPort
      var proxy = net.createConnection(address, function () {
        proxy.write(buf)
        pump(conn, proxy, conn, function (err) {
          if (err) return false // TODO: log error to the logger part
        })
      })
    })
  }

  function httpConnection (req, res) {
    var host = req.headers['host']
    var location = 'https://' + host + req.url
    var agent = req.headers['user-agent']

    // We don't want to force an HTTPS connection if we are already
    // encrypted or we are being forwarded through a proxy that may be
    // taking care of it.
    var encrypted = req.headers['x-forwarded-proto'] || req.connection.encrypted

    // We want to force HTTPS connections, but using curl(1) or wget(1) from
    // the command line can be convenient to quickly check output.
    if (/^(curl|wget)/i.test(agent) || encrypted) {
      return connectionHandler(req, res)
    } else {
      res.writeHead(301, { location: location })
      res.end(`Redirecting to ${location}`)
    }
  }
}
