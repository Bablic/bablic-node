"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
const fs = require("fs");
const fs_extra_1 = require("fs-extra");
const moment = require("moment");
const request = require("request");
const Debug = require("debug");
const UrlParser = require("url");
const debug = Debug('bablic:seo');
const zlib = require('zlib');
const common_1 = require("./common");
const http_1 = require("http");
const _ = require("lodash");
class SeoMiddleware {
    constructor(siteId, options, subDirOptions) {
        this.siteId = siteId;
        this.options = options;
        this.subDirOptions = Object.assign({ returnFull: true }, subDirOptions);
    }
    async writeToCache(url, locale, translated) {
        let cachePath = fullPathFromUrl(url, locale, this.options.cacheDir);
        try {
            await fs_extra_1.writeFile(cachePath, translated);
        }
        catch (e) {
            const cacheDir = getCacheDir(locale, this.options.cacheDir);
            debug("create cache dir", cacheDir);
            await fs_extra_1.ensureDir(cacheDir);
            debug("created");
            await fs_extra_1.writeFile(cachePath, translated);
        }
    }
    async getHtml(url, cacheKey, locale, html) {
        if (!isRenderHealthy) {
            return Promise.reject(new Error("Render is not health"));
        }
        debug('getting from bablic', url, 'html:', !!html);
        const translatedHtml = await renderServer.render(this.siteId, url, locale, html, this.subDirOptions);
        this.writeToCache(cacheKey, locale, translatedHtml).catch((e) => {
            debug("error writing to cache", e);
        });
        return translatedHtml;
    }
    getFromCache(url, locale, skip, callback) {
        if (!this.options.useCache || skip)
            return callback();
        let file_path = fullPathFromUrl(url, locale, this.options.cacheDir);
        fs.stat(file_path, (error, file_stats) => {
            if (error)
                return callback(error);
            fs.readFile(file_path, (error, data) => {
                if (error)
                    return callback(error);
                callback(error, data, cacheValid(file_stats, this.options.cacheDays || 1));
            });
        });
    }
    ;
    isEncoded(buffer) {
        try {
            // every gzip content start with 0x1f8b 2 bytes
            let firstByte = buffer[0];
            let secondByte = buffer[1];
            return (firstByte == 0x1f) && (secondByte == 0x8b);
        }
        catch (err) {
            return false;
        }
    }
    readHeaderAsString(res, headerName) {
        let value = res.getHeader(headerName);
        if (!value)
            return "";
        if (Array.isArray(value)) {
            value = value[0];
        }
        if (typeof (value) !== "string") {
            return value + "";
        }
        else {
            return value;
        }
    }
    async purgeCache() {
        debug("purge cache", this.options.cacheDir);
        try {
            await fs_extra_1.remove(this.options.cacheDir);
            debug("purge done");
        }
        catch (e) {
            debug('purge error', e);
        }
    }
    async purgeByUrl(url, locale) {
        debug("purge cache URL", this.options.cacheDir, url);
        let cachePath = fullPathFromUrl(url, locale, this.options.cacheDir);
        try {
            if (await fs_extra_1.pathExists(cachePath)) {
                debug('delete', cachePath);
                await fs_extra_1.unlink(cachePath);
                debug("purge url done");
            }
            else {
                debug("url not cached", cachePath);
            }
        }
        catch (e) {
            debug('purge error', e);
        }
    }
    middleware() {
        return (meta, lastModified, keywordsByLocale, reverseKeywordByLocale, req, res, next) => {
            let replaceUrls = shouldReplaceUrls(req);
            if (!shouldHandle(req) && !replaceUrls) {
                debug('ignored', req.url);
                return next();
            }
            if (this.options.ignoreSeo && this.options.ignoreSeo(req)) {
                return next();
            }
            let acceptGZIP = (req.headers['accept-encoding'] || '').indexOf('gzip') > -1;
            delete req.headers['accept-encoding'];
            req.bablic.proxied = true;
            let protocol = req.headers['x-forwarded-proto'] || 'http';
            const cacheKey = req.originalUrl;
            let my_url = protocol + "://" + req.headers.host + req.originalUrl;
            if (this.options.altHost)
                my_url = "http://" + this.options.altHost + req.originalUrl;
            this.getFromCache(cacheKey, req.bablic.locale, replaceUrls, (e, html, isValid) => {
                let cache_only = false;
                if (html) {
                    debug('flushing from cache');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.setHeader('Content-Language', req.bablic.locale);
                    const encoded = this.isEncoded(html);
                    // if browser support gzip encoding
                    if (acceptGZIP) {
                        // adding gzip flag
                        if (encoded) {
                            res.setHeader('Content-Encoding', 'gzip');
                        }
                    }
                    else {
                        // if the content from cache is gzipped
                        if (encoded) {
                            html = zlib.gunzipSync(html);
                        }
                    }
                    res.write(html);
                    res.end();
                    if (isValid)
                        return;
                    cache_only = true;
                }
                if (!isRenderHealthy && !replaceUrls) {
                    debug('render not healthy, skipping');
                    return next();
                }
                debug('overriding response');
                let _end = res.end;
                let _write = res.write;
                let _writeHead = res.writeHead;
                res.writeHead = (status, _headers) => {
                    res.statusCode = status;
                    if (_headers && typeof _headers === 'object') {
                        let results = [];
                        for (let key in _headers)
                            results.push(res.setHeader(key, _headers[key]));
                        return results;
                    }
                };
                let headers = {};
                let _getHeader;
                if (cache_only) {
                    _getHeader = res.getHeader;
                    res.finished = false;
                    Object.defineProperty(res, "headersSent", {
                        get: () => {
                            return false;
                        },
                        configurable: true,
                        enumerable: true,
                    });
                    res.setHeader = (name, value) => headers[name.toLowerCase().trim()] = value;
                    res.removeHeader = name => headers[name.toLowerCase().trim()] = null;
                    res.getHeader = name => {
                        let local = headers[name.toLowerCase().trim()];
                        if (local)
                            return local;
                        if (local === null)
                            return;
                        return _getHeader.call(res, name);
                    };
                }
                let restore_override = () => {
                    if (!_write || !_end || !_writeHead)
                        return;
                    debug('undo override');
                    res.write = _write;
                    res.end = _end;
                    res.writeHead = _writeHead;
                    if (cache_only) {
                        _getHeader = null;
                        const getter = Object.getOwnPropertyDescriptor(http_1.OutgoingMessage.prototype, "headersSent");
                        Object.defineProperty(res, "headersSent", getter);
                    }
                    _write = _end = _writeHead = null;
                };
                let head_checked = false;
                // should we process the response, or simply proxy it
                // if replaceUrls is on, we need to process the response
                let shouldProcess = replaceUrls;
                let chunks = [];
                let check_head = () => {
                    if (head_checked)
                        return;
                    const ct = this.readHeaderAsString(res, 'content-type');
                    const isHtml = ct.indexOf('text/html') > -1;
                    // if response is HTML
                    if (isHtml) {
                        // we should process it, and turn off replaceUrls (render will take care of URLs)
                        replaceUrls = false;
                        shouldProcess = true;
                    }
                    if (!shouldProcess) {
                        debug('not html', ct);
                        restore_override();
                    }
                    else if (res.statusCode < 200 || res.statusCode >= 300) {
                        debug('error response', res.statusCode);
                        shouldProcess = false;
                        restore_override();
                    }
                    head_checked = true;
                };
                let justAnObject = res;
                res.write = function (chunk, encoding, cb) {
                    check_head();
                    if (!shouldProcess) {
                        if (cache_only)
                            return;
                        debug('write original');
                        return res.write.apply(res, arguments);
                    }
                    if (chunk instanceof Buffer)
                        chunk = chunk.toString(encoding);
                    chunks.push(chunk);
                    if (typeof (encoding) == 'function')
                        cb = encoding;
                    if (cb)
                        cb();
                };
                const self = this;
                let alt_host = this.options.altHost;
                justAnObject.end = function (chunk, encoding, cb) {
                    if (typeof (encoding) == 'function') {
                        cb = encoding;
                    }
                    check_head();
                    if (!shouldProcess) {
                        if (cache_only)
                            return;
                        debug('flush original');
                        restore_override();
                        return res.end.apply(res, arguments);
                    }
                    if (chunk != null)
                        res.write.apply(res, arguments);
                    let original_html = chunks.join('');
                    res.setHeader('Content-Language', req.bablic.locale);
                    if (replaceUrls) {
                        restore_override();
                        // detect that URL is of sitemap and is XML (res content type).If XML, then try to parse XML. And go over all
                        if (lastModified && lastModified[req.bablic.locale] && /sitemap/i.test(req.url) &&
                            self.readHeaderAsString(res, 'content-type').indexOf('xml') > -1) {
                            const bablicDate = new Date(lastModified[req.bablic.locale]);
                            original_html = original_html.replace(new RegExp("<lastmod>(.*?)</lastmod>", "g"), (captureAll, dateCapture) => {
                                let siteMapDate = new Date(dateCapture);
                                if (siteMapDate < bablicDate) {
                                    return "<lastmod>" + bablicDate.toISOString() + "</lastmod>";
                                }
                                else {
                                    return captureAll;
                                }
                            });
                        }
                        const locale = req.bablic.locale;
                        const currentHost = req.headers.host;
                        let originalDomains = [currentHost];
                        if (alt_host)
                            originalDomains.push(alt_host);
                        if (meta.localeDetection === "custom" && meta.customUrls && meta.customUrls[locale]) {
                            if (currentHost === meta.customUrls[locale]) {
                                let supposeOriginDomain = meta.customUrls[meta.original];
                                if (supposeOriginDomain) {
                                    originalDomains.push(supposeOriginDomain);
                                }
                            }
                        }
                        html = original_html.replace(detect_url, url => {
                            if (ignore_not_html_or_xml.test(url))
                                return url;
                            if (!meta.rewriteUrlHandler && _.every(originalDomains, (domain) => !url.includes(domain))) {
                                return url;
                            }
                            let parsed = UrlParser.parse(url);
                            // translate URLs in sitemaps and such
                            if (keywordsByLocale && keywordsByLocale[req.bablic.locale]) {
                                let keywords = keywordsByLocale[req.bablic.locale];
                                parsed.pathname = parsed.pathname.split('/').map(part => keywords[part] || part).join('/');
                            }
                            return common_1.getLink(req.bablic.locale, parsed, meta, self.subDirOptions, meta.original) || url;
                        });
                        if (res.getHeader('Transfer-Encoding') !== 'chunked') {
                            res.setHeader('Content-Length', Buffer.byteLength(html));
                        }
                        res.write(html, cb);
                        return res.end();
                    }
                    // handle empty html string
                    if (!original_html) {
                        restore_override();
                        debug('empty html');
                        res.end(cb);
                        return;
                    }
                    self.getHtml(my_url, cacheKey, req.bablic.locale, original_html).then((data) => {
                        if (cache_only)
                            return;
                        const isEncoded = self.isEncoded(data);
                        // if browser doesn't support gzip encoding
                        if (!acceptGZIP) {
                            // if the content is gzipped
                            if (isEncoded) {
                                data = zlib.gunzipSync(data);
                            }
                        }
                        else if (isEncoded) {
                            res.setHeader('Content-Encoding', 'gzip');
                        }
                        restore_override();
                        debug('flushing translated');
                        if (res.getHeader('Transfer-Encoding') !== 'chunked') {
                            res.setHeader('Content-Length', Buffer.byteLength(data));
                        }
                        res.write(data, cb);
                        res.end();
                    }, (error) => {
                        if (cache_only)
                            return;
                        restore_override();
                        console.error('[Bablic SDK] Error:', my_url, error);
                        debug('flushing original');
                        res.write(original_html, cb);
                        res.end();
                    });
                };
                return next();
            });
        };
    }
}
exports.SeoMiddleware = SeoMiddleware;
const ignore_not_html_or_xml = /\.(js|css|jpg|jpeg|png|ico|mp4|wmv|ogg|mp3|avi|mpeg|bmp|wav|pdf|doc|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;
const detect_url = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
let SEO_ROOT = 'http://seo.bablic.com/api/engine/seo';
let renderServer = {
    health() {
        return new Promise((resolve, reject) => {
            request({
                url: SEO_ROOT,
                headers: {
                    "Accept-Encoding": "gzip,deflate"
                },
                method: 'GET',
                timeout: 10000,
            }, (error) => {
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        });
    },
    render(site, url, locale, html, subDirOptions) {
        let ld = '';
        if (subDirOptions && subDirOptions.subDir) {
            ld = '&ld=subdir';
            if (subDirOptions.subDirBase)
                ld += '&sdb=' + encodeURIComponent(subDirOptions.subDirBase);
            if (subDirOptions.subDirOptional)
                ld += '&sdo=true';
        }
        return new Promise((resolve, reject) => {
            request({
                url: SEO_ROOT + "?site=" + site + "&el=" + locale + "&url=" + (encodeURIComponent(url)) + ld,
                headers: {
                    "Accept-Encoding": "gzip,deflate"
                },
                method: 'POST',
                json: {
                    html: html
                },
                timeout: 40000,
                encoding: null,
            }, (error, response, body) => {
                if (error)
                    return reject(error);
                if (response.statusCode < 200 || response.statusCode >= 300)
                    return reject(new Error("Status-" + response.statusCode));
                if (body == null)
                    return reject(new Error('empty response'));
                debug('received translated html', response.statusCode);
                resolve(body);
            });
        });
    }
};
function setRenderServer(url) {
    if (!url) {
        throw new Error("Must be a valid URL");
    }
    if (typeof (url) === "string")
        SEO_ROOT = url;
    else
        renderServer = url;
}
exports.setRenderServer = setRenderServer;
function hash(data) {
    return crypto.createHash('md5').update(data).digest('hex');
}
function fullPathFromUrl(url, locale, cacheDir) {
    return cacheDir + "/" + locale + "/" + hash(url);
}
function getCacheDir(locale, cacheDir) {
    return cacheDir + "/" + locale;
}
function cacheValid(file_stats, cacheDays) {
    let last_modified = moment(file_stats.mtime.getTime());
    let now = moment();
    last_modified.add(cacheDays, 'days');
    return now.isBefore(last_modified);
}
const filename_tester = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|xml|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;
function ignorable(req) {
    return filename_tester.test(req.url);
}
const google_tester = /bot|crawler|yandex|bing|baidu|spider|facebook|twitter|80legs|google|seo|search/i;
function isBot(req) {
    return google_tester.test(req.headers['user-agent']);
}
function shouldHandle(req) {
    return isBot(req) && !ignorable(req);
}
function shouldReplaceUrls(req) {
    return /sitemap|robots/i.test(req.url);
}
async function renderHealthCheck() {
    debug('render health check');
    try {
        await renderServer.health();
        return true;
    }
    catch (e) {
        debug('render is not healthy', e);
        return false;
    }
}
let isRenderHealthy = true;
setInterval(() => {
    renderHealthCheck().then((health) => {
        isRenderHealthy = health;
    });
}, 1000 * 60);
