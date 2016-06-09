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
url_parser = require 'url'
qs_parser = require 'querystring'

module.exports = (options) ->
  options = _.defaultsDeep options,
    site_id: null
    root_url: null
    subdir: false
    seo:
      use_cache: true
      default_cache: null
    test: false

  unless (options.site_id and options.root_url)
    throw new Error('Middleware requires root_url and site_id')

  if options.seo
    if options.subdir
      options.seo.subdir = true
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

  get_current_url = (req) -> "#{req.protocol}://#{req.hostname}/#{req.originalUrl}"

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
        match = /^(\/(\w\w(_\w\w)?))(?:\/|$)/.exec(req.originalUrl)
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
        debug 'checking snippet time'
        fs.stat snippet_url(), (error, file_stats) ->
          if error
            return
          last_modified = moment file_stats.mtime.getTime()
          now = moment()
          last_modified.add 120, 'minutes'
          if now.isBefore(last_modified)
            return debug 'snippet cache is good'
          debug 'refresh snippet'
          get_data cb
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

  register_callback = () ->
    root = options.root_url
    # make sure it works if user didnt use protocol
    if root.substr(0,4) isnt 'http'
      root = 'http://' + root
    # strip to have only protocol & domain
    parsed = url_parser.parse root
    root = parsed.protocol + '//' + parsed.host
    ops =
      url: "http://www.bablic.com/api/v1/site/#{options.site_id}"
      method: 'PUT'
      json:
        callback: "#{root}/_bablicCallback"
    request ops, (error, response, body) ->
      if error?
        debug "setting callback failed"
      return

  register_callback()

  should_handle = (req) ->
    return is_bot(req) and not ignorable(req)

  get_link = (locale, url) ->
    parsed = url_parser.parse url
    protocol = if parsed.protocol then parsed.protocol + '//' else ''
    host = parsed.host or ''
    path = parsed.pathname or ''
    query = parsed.query or ''
    hash = parsed.hash or ''
    locale_detection = @meta['localeDetection']
    if options.subdir
      locale_detection = 'subdir';
    if (locale_detection is 'custom') and (!@meta['customUrls'])
      locale_detection = 'querystring';

    switch locale_detection
      when 'custom'
        custom_url = @meta['customUrls'][locale]
        if custom_url
          protocol = protocol or 'http://'
          if custom_url.indexOf('?') > -1
            [custom_url,qs] = custom_url.split '?'
            query = '?' + qs
          if custom_url.indexOf('/') > -1
            parts = custom_url.split '/'
            custom_url = parts.shift()
            path = '/' + parts.join('/')
          host = custom_url

      when 'querystring'
        query_parsed = {}
        if query
          query_parsed = qs_parser.parse(query.substr(1))
        query_parsed['locale'] = locale
        query = '?' + qs_parser.stringify(query_parsed)

      when 'subdir'
        locale_keys = @meta['localeKeys'] or []
        locale_regex = RegExp('^\\/(' + locale_keys.join('|') + ')\\b')
        path = path.replace(locale_regex,'')
        if locale isnt @meta['original']
          path = '/' + locale + path

      when 'hash'
        hash = '#locale_' + locale
    return protocol + host + path + query + hash

  alt_tags = (url, locale) ->
    locales = @meta['localeKeys'] or []
    locales = locales.slice()
    locales.unshift @meta['original']
    locales.map (l) ->
      if l is locale
        return ''
      return '<link rel="alternate" href="' + get_link(l,url) + '" hreflang="#{l}">'


  return (req, res, next) ->
    if req.originalUrl is '/_bablicCallback' and req.method is 'POST'
      debug 'Redirecting to Bablic callback'
      return handle_bablic_callback req, res

    locale = get_locale(req)

    req.bablic =
      locale: locale

    snippet = @snippet

    if options.subdir and @meta['localeKeys']
      LOCALE_REGEX = RegExp('^\\/(' + @meta['localeKeys'].join('|') + ')\\b')
      req.url = req.url.replace(LOCALE_REGEX, '')
      snippet = '<script type="text/javascript">var bablic=bablic||{};bablic.localeURL="subdir"</script>' + snippet

    top = if @meta.original isnt locale then snippet else ''
    bottom = if @meta.original is locale then snippet else ''

    res.locals.bablic =
      locale: locale
      snippet: snippet
      snippetBottom: '<!-- Bablic Footer -->' + bottom + '<!-- /Bablic Footer -->'
      snippetTop: '<!-- Bablic Head -->' + alt_tags(req.originalUrl,locale) + top + '<!-- /Bablic Head -->'


    if (locale is @meta.original) or (should_handle(req) is false)
      debug 'ignored', req.url
      return next()
    if SEO?
      return SEO req, res, next
