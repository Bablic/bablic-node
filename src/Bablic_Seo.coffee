request = require 'request'
crypto = require 'crypto'
OS = require 'os'
fs = require 'fs'
async = require 'async'
moment = require 'moment'

module.exports = (options) ->
  if options.default_cache?
    console.log 'setting timeout'
    setTimeout ->
      console.log 'starting preloads'
      preload()
    , 1500

  preload = ->
    preloads = []
    for url in options.default_cache
      preloads.push ->
        get_html url, null, (error, data) ->
          if error? or data is undefined
            console.error "[Bablic SDK] Error: url #{url} failed preloading"
            console.error error
          else
            console.log "[Bablic SDK] - Preload #{url} complete, size: #{data.length}"

    async.series preloads
    return

  get_html = (url, html, cbk) ->
    ops =
      url: "http://dev.bablic.com/api/engine/seo?site=#{options.site_id}&url=#{encodeURIComponent(url)}"
      method: 'POST'
      json: true
      body:
        html: html
    request ops, (error, response, body) ->
      if error?
        return cbk error
      fs.writeFile full_path_from_url(url), body, (error) ->
        if error
          return cbk error
        cbk null, body
      return

  hash = (data) -> crypto.createHash('md5').update(data).digest('hex')

  full_path_from_url = (url) -> OS.tmpdir()+'/'+ hash(url)

  cache_valid = (file_stats) ->
    last_modified = moment file_stats.mtime.getTime()
    now = moment()
    last_modified.add 30, 'minutes'
    return now.isBefore(last_modified)

  get_from_cache = (url, callback) ->
    file_path = full_path_from_url(url)
    fs.stat file_path, (error, file_stats) ->
      if error?
        return callback {
          errno: 1
          msg: 'does not exist in cache'
        }
      fs.readFile file_path, (error, data) ->
        if error?
          error =
            errno: 2
            msg: 'error reading from FS'
        else unless cache_valid(file_stats)
          error = {
            errno: 3
            msg: 'cache not valid'
          }
        callback error, data
    return null

  ignorable = (req) ->
    filename_tester = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|xml|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/
    return filename_tester.test req.url

  is_bot = (req) ->
    google_tester = new RegExp /bot|crawler|baiduspider|80legs|mediapartners-google|adsbot-google/i
    return google_tester.test req.headers['user-agent']

  should_handle = (req, res) ->
    return is_bot(req) and not ignorable(req)

  return (req, res, next) ->
    if should_handle(req, res)
      my_url = "http://#{req.headers.host}#{req.url}"
      get_from_cache my_url, (error, data) ->
        cache_only = false
        if data?
          res.write(data)
          res.end()
          cache_only = true
          return unless error?
        _end = res.end
        _write = res.write
        stream = new Buffer(0)
        res.write = (chunk, encoding='utf8') ->
          if typeof(chunk) isnt 'object'
            chunk = new Buffer(chunk, encoding)
          stream = Buffer.concat [stream, chunk], (stream.toString().length + chunk.toString().length)

        res.end = (chunk, encoding='utf8') ->
          if chunk? and encoding?
            res.write chunk, encoding
          is_html = false
          if res.get('content-type') isnt undefined
            is_html = (res.get('content-type').indexOf('text/html') < 0)
          if is_html is false
            res.write = _write
            res.end = _end
            return res.end(stream)
          get_html my_url, stream.toString(), (error, data) ->
            res.write = _write
            res.end = _end
            return res.end() if cache_only
            if error?
              console.error '[Bablic SDK] Error:', error
              res.write stream.toString()
              res.end()
              return
            res.write data
            res.end()
            return
          return
        return next()
      return
    return next()

#TODO:
# 1. zip/unzip the cache files?
# 2. packaging

