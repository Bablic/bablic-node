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
  options = _.defaultsDeep options,
    site_id: null
    root_url: null
    seo:
      use_cache: true
      default_cache: null
    test: false

  unless (options.site_id and options.root_url)
    throw new Error('Middleware requires root_url and site_id')

  unless options.seo is null or options.seo is false
    SEO = require('./seo')(options.seo)

  snippet_url = -> "#{OS.tmpdir()}/snippet"

  get_data = (cb) ->
    ops =
      url: "https://www.bablic.com/api/v1/site/#{options.site_id}"
      method: 'GET'
    request ops, (error, response, body) ->
      if error?
        return cb error
      unless body?
        return cb new Error('empty response')
      try
        data = JSON.parse body
        debug 'data:', data
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

  get_locale = (req) =>
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

  ignorable = (req) ->
    filename_tester = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|xml|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/
    return filename_tester.test req.url

  is_bot = (req) ->
    google_tester = new RegExp /bot|crawler|baiduspider|facebookexternalhit|Twitterbot|80legs|mediapartners-google|adsbot-google/i
    return google_tester.test req.headers['user-agent']

  load_data (error, data) =>
    if error
      debug "Error:", error
      debug error
      return
    @snippet = data.snippet
    @meta = data.meta
    debug 'saved to memory: ', data
    return

  handle_bablic_callback = (req, res) =>
    if req.body.event is 'snippet'
      @snippet = req.body.data.snippet
      @meta = req.body.data.meta
    res.send 'OK'
    return

  register_callback = (req) ->
    ops =
      url: "http://www.bablic.com/api/v1/site/#{options.site_id}"
      method: 'PUT'
      json:
        callback: "#{options.root_url}/_bablicCallback"
    request ops, (error, response, body) ->
      if error?
        debug "setting callback failed"
      return

  register_callback()

  should_handle = (req) ->
    return is_bot(req) and not ignorable(req)

  return (req, res, next) ->
    if req.path is '/_bablicCallback' and req.method is 'POST'
      debug 'Redirecting to Bablic callback'
      return handle_bablic_callback req, res

    locale = get_locale(req)

    req.bablic =
      locale: locale

    res.locals.bablic =
      locale: locale
      snippet: @snippet
      snippetBottom: ''
      snippetTop: ''

    if @meta.original isnt locale
      res.locals.bablic.snippetTop = @snippet
    else
      res.locals.bablic.snippetBottom = @snippet

    if (should_handle(req) is false) or (locale is @meta.original)
      debug 'ignored', req.url
      return next()
    if SEO?
      return SEO req, res, next
