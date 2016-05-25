_ = require 'lodash'
async = require 'async'
crypto = require 'crypto'
cookie = require 'cookie'
fs = require 'fs'
moment = require 'moment'
OS = require 'os'
request = require 'request'
debug = require 'debug'
debug = debug 'bablic:seo'

module.exports = (options) ->
  options = _.defaults options,
    site_id: null
    root_url: null
    seo:
      use_cache: true
      default_cache: null
    test: false

  console.log options.site_id, options.root_url
  unless (options.site_id and options.root_url)
    throw new Error('Middleware requires root_url and site_id')

  alt_host = options.alt_host if options.alt_host?
  if options.seo.default_cache?
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
      if response.statusCode < 200 or response.statusCode >= 300
        return cbk response.statusCode
      unless body?
        return cbk new Error('empty response')
      debug 'received translated html', response.statusCode
      cbk null, body
      fs.writeFile full_path_from_url(url), body, (error) ->
        if error
          console.error 'Error saving to cache', error

  hash = (data) -> crypto.createHash('md5').update(data).digest('hex')

  full_path_from_url = (url) -> "#{OS.tmpdir()}/#{hash(url)}"

  snippet_url = -> "#{OS.tmpdir()}/snippet"

  get_data = (cb) ->
    ops =
      url: "http://dev.bablic.com/api/v1/site/#{options.site_id}"
      method: 'GET'
    request ops, (error, response, body) ->
      if error?
        return cb error
      unless body?
        return cb new Error('empty response')
      try
        data = JSON.parse body
        console.log 'data:', data
        save_data(body)
        cb null, data
      catch e
        debug

  detect_locale_from_header = (req) ->
    langs = req.headers['accept-language'].split(',') if req.headers['accept-language']
    if langs?.length > 0
      return langs[0].replace('-','_')
    return false

  detect_locale_from_cookie = (req) ->
    return false unless req.headers['cookie']
    return false unless @meta['localeKeys']
    if req.cookies?
      bablicookie = req.cookies['bab_locale']
    else
      cookies = cookie.parse(req.headers['cookie'])
      bablicookie = cookies['bab_locale']
    return false unless bablicookie
    match_index = @meta['localeKeys'].indexOf bablicookie
    if match_index < 0
      match_index  = @meta['localeKeys'].indexOf bablicookie.substr(0, 2)
    unless match_index < 0
      return @meta['localeKeys'][match_index]
    return false

  get_current_url = (req) -> "#{req.protocol}://#{req.hostname}/#{req.path}"

  get_locale = (req) ->
    auto = @meta['autoDetect']
    default_locale = @meta['default']
    custom_urls = @meta['customUrls']
    locale_keys = @meta['localeKeys']
    locale_detection = @meta['localeDetection']
    detected = ''
    if (auto and locale_keys)
      detected_lang = detect_locale_from_header req
      if detected_lang
        match_index = locale_keys.indexOf detected_lang
        if match_index < 0
          match_index = locale_keys.indexOf detected_lang.substr(0, 2)
        unless match_index < 0
          detected = locale_keys[match_index]

    from_cookie = detect_locale_from_cookie req
    if options.sub_dir
      locale_detection = 'subdir'
    switch locale_detection
      when 'querystring'
        return req.query['locale'] or from_cookie or detected or default_locale

      when 'subdir'
        match = /^(\/(\w\w(_\w\w)?))(?:\/|$)/.exec(req.path)
        return match[2] if match
        return detected or default_locale

      when 'custom'
        create_domain_rule = (str) ->
          return RegExp((str+'').replace(/([.?+^$[\]\\(){}|-])/g, "\\$1").replace(/\*/g,'.*'),'i')

        for key, value of custom_urls
          if create_domain_rule(value).test(get_current_url())
            return key
        return default_locale

      else
        return from_cookie
    return

  save_data = (bablic_data) ->
    fs.writeFile snippet_url(), bablic_data, (error) ->
      if error
        console.error 'Error saving snippet to cache', error

  load_data = (cb) ->
    fs.readFile snippet_url(), (error, data) ->
      try
        object = JSON.parse(data)
        cb null, object
      catch e
        cb e
      get_data cb

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

  load_data (error, data) =>
    if error
      debug "Error:", error
      console.log error
      return
    @snippet = data.snippet
    @meta = data.meta
    console.log 'saved to memory: ', data
    return


  return (req, res, next) ->
    unless should_handle req
      debug 'ignored', req.url
      return next()
    locale = get_locale(req)
    req.bablic =
      locale: locale

    res.bablic =
      locale: locale
      snippet: @snippet
      snippetBottom: ''
      snippetTop: ''

    if @meta.original isnt locale
      req.bablic.snippetBottom = @snippet
      req.bablic.snippetTop = @snippet

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
        if res.statusCode < 200 or res.statusCode >= 300
          debug 'error response', res.statusCode
          is_html = false
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
          return res.end.apply res, arguments

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

