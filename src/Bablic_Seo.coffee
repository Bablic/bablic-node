request = require 'request'
crypto = require 'crypto'
OS = require 'os'
fs = require 'fs'
async = require 'async'
moment = require 'moment'
debug = require 'debug'
debug = debug 'bablic:seo'
_ = require 'lodash'

module.exports = (options) ->
  options = _.defaults options,
    use_cache:true
    site_id:null
    default_cache:null
    test:false
  unless options.site_id
    throw new Error('Must use site id for middleware')

  alt_host = options.alt_host if options.alt_host?
  if options.default_cache?
    setTimeout ->
      debug 'starting preloads'
      preload()
    , 15000

  preload = ->
    async.eachSeries options.default_cache, (url, cbk) ->
      debug 'check cache for ', url
      get_html url, null, (error, data) ->
        if error? or data is undefined
          console.error "[Bablic SDK] Error: url #{url} failed preloading", error
        else
          debug "[Bablic SDK] - Preload #{url} complete, size: #{data.length}"
        cbk()

  get_html = (url, html, cbk) ->
    debug 'getting from bablic', url, 'html:', html?
    ops =
      url: "http://seo.bablic.com/api/engine/seo?site=#{options.site_id}&url=#{encodeURIComponent(url)}"
      method: 'POST'
      json:
        html: html
    request ops, (error, response, body) ->
      if error?
        return cbk error
      unless body?
        return cbk new Error('empty response')
      debug 'received translated html', response.statusCode
      cbk null, body
      fs.writeFile full_path_from_url(url), body, (error) ->
        if error
          console.error 'Error saving to cache', error

  hash = (data) -> crypto.createHash('md5').update(data).digest('hex')

  full_path_from_url = (url) -> OS.tmpdir()+'/'+ hash(url)

  cache_valid = (file_stats) ->
    last_modified = moment file_stats.mtime.getTime()
    now = moment()
    last_modified.add 30, 'minutes'
    return now.isBefore(last_modified)

  get_from_cache = (url, callback) ->
    return callback() unless options.use_cache
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
    google_tester = new RegExp /bot|crawler|baiduspider|facebookexternalhit|Twitterbot|80legs|mediapartners-google|adsbot-google/i
    return google_tester.test req.headers['user-agent']

  should_handle = (req) ->
    return is_bot(req) and not ignorable(req)

  return (req, res, next) ->
    unless should_handle req
      debug 'ignored', req.url
      return next()

    my_url = "http://#{req.headers.host}#{req.url}"
    my_url = "http://#{alt_host}#{req.url}" if alt_host?
    get_from_cache my_url, (error, data) ->
      cache_only = false
      if data?
        debug 'flushing from cache'
        res.set('Content-Type','text/html; charset=utf-8');
        res.write(data)
        res.end()
        cache_only = true
        return unless error?

      debug 'overriding response'
      _end = res.end
      _write = res.write
      _writeHead = res.writeHead
      res.writeHead = (status,_headers) ->
        res.statusCode = status
        if _headers
          for key in _headers
            res.setHeader key, _headers[key]
      headers = {}

      if cache_only
        _getHeader = res.getHeader
        res.setHeader = (name, value) ->
          headers[name.toLowerCase().trim()] = value
        res.removeHeader = (name) ->
          headers[name.toLowerCase().trim()] = null
        res.getHeader = (name) ->
          local = headers[name.toLowerCase().trim()]
          if local
            return local
          if local is null
            return
          return _getHeader.call(res,name)

      restore_override = () ->
        return unless _write and _end and _writeHead
        debug 'undo override'
        res.write = _write
        res.end = _end
        res.writeHead = _writeHead
        if cache_only
          _getHeader = null
        _write = _end = _writeHead = null
      head_checked = false
      is_html = null
      chunks = []

      check_head = () ->
        return if head_checked
        is_html = false
        if res.get('content-type') isnt undefined
          is_html = (res.get('content-type').indexOf('text/html') > -1)
        unless is_html
          debug 'not html', res.get('content-type')
          restore_override()
        head_checked = true

      res.write = (chunk, encoding='utf8') ->
        check_head()
        unless is_html
          return if cache_only
          # if not html, restore original functionality
          debug 'write original'
          return res.write.apply res, arguments
        if typeof(chunk) is 'object'
          chunk = chunk.toString(encoding)
        chunks.push chunk

      res.end = (chunk, encoding='utf8') ->
        check_head()
        unless is_html
          return if cache_only
          # if not html, restore original functionality
          debug 'flush original'
          return res.end res, arguments

        if chunk?
          res.write chunk, encoding

        original_html = chunks.join ''
        get_html my_url, original_html, (error, data) ->
          return if cache_only
          restore_override()
          if error?
            console.error '[Bablic SDK] Error:', error
            debug 'flushing original'
            res.write original_html
            res.end()
            return
          debug 'flushing translated'
          res.set 'Content-Length', Buffer.byteLength(data)
          res.write data
          res.end()
          return
        return
      return next()

#TODO:
# 1. zip/unzip the cache files?

