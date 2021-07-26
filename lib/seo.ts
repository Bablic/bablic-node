

import * as crypto from 'crypto';
import * as fs from 'fs';
import {emptyDir, ensureDir, rmdir, writeFile, unlink, pathExists} from "fs-extra";
import * as moment from 'moment';
import * as request from 'request';
import * as Debug from 'debug';
import * as UrlParser from 'url';

const debug = Debug('bablic:seo');
const zlib = require('zlib');

import {
    ExtendedRequest, ExtendedResponse, Middleware, getLink, KeywordMapper, SiteMeta, LastModifiedByLocale,
    BablicLinkOptions
} from "./common";
import {OutgoingMessage, ServerResponse} from "http";
import {Stats} from "fs";
import {RequestResponse} from "request";
import _ = require("lodash");

export interface SeoOptions {
    useCache?:boolean;
    defaultCache?:string[];
    cacheDir?: string;
    test?:boolean;
    altHost?: string;
    cacheDays?: number;
}

export interface SeoSubDirOptions {
    subDir: boolean;
    subDirBase: string;
    subDirOptional: boolean;
}

export class SeoMiddleware{
    private subDirOptions: BablicLinkOptions;
    constructor(private siteId: string, private options: SeoOptions, subDirOptions: SeoSubDirOptions){
        this.subDirOptions = Object.assign({returnFull: true}, subDirOptions);
    }
    async writeToCache(url: string, locale: string, translated: string): Promise<void> {
        let cachePath = fullPathFromUrl(url, locale, this.options.cacheDir);
        try {

            await writeFile(cachePath, translated);
        } catch (e) {
            const cacheDir = getCacheDir(locale, this.options.cacheDir);
            debug("create cache dir", cacheDir);
            await ensureDir(cacheDir);
            debug("created");
            await writeFile(cachePath, translated);
        }
    }
    getHtml(url: string, cacheKey: string, locale: string, html?: string): Promise<string> {
        if (!isRenderHealthy) {
            return Promise.reject(new Error("Render is not health"));
        }
        debug('getting from bablic', url, 'html:', !!html );
        let ld = '';
        if(this.subDirOptions.subDir) {
            ld = '&ld=subdir';
            if(this.subDirOptions.subDirBase)
                ld += '&sdb=' + encodeURIComponent(this.subDirOptions.subDirBase);
            if(this.subDirOptions.subDirOptional)
                ld += '&sdo=true';
        }
        return new Promise<string>((resolve, reject) => {
            request({
                url: SEO_ROOT + "?site=" + this.siteId + "&el=" + locale  + "&url=" + (encodeURIComponent(url)) + ld,
                headers:{
                    "Accept-Encoding": "gzip,deflate"
                },
                method: 'POST',
                json: {
                    html: html
                },
                timeout: 20000,
                encoding:null,
            }, (error:any, response:RequestResponse, body: any) => {
                if (error)
                    return reject(error);

                if (response.statusCode < 200 || response.statusCode >= 300)
                    return reject(new Error("Status-" + response.statusCode));

                if (body == null)
                    return reject(new Error('empty response'));

                debug('received translated html', response.statusCode);
                resolve(body);

                this.writeToCache(cacheKey, locale, body).catch((e) => {
                    debug("error writing to cache", e);
                });
            });
        });
    }
    getFromCache(url: string, locale: string, skip: boolean, callback:(e?:Error, html?: Buffer | string, isValid?: boolean) => void) {
        if (!this.options.useCache || skip)
            return callback();

        let file_path = fullPathFromUrl(url, locale, this.options.cacheDir);
        fs.stat(file_path, (error:NodeJS.ErrnoException, file_stats: Stats) => {
            if (error)
                return callback(error);

            fs.readFile(file_path, (error:NodeJS.ErrnoException, data: Buffer) => {
                if (error)
                    return callback(error);

                callback(error, data, cacheValid(file_stats, this.options.cacheDays || 1));
            });
        });
    };
    isEncoded(buffer) {
        try {
            // every gzip content start with 0x1f8b 2 bytes
            let firstByte = buffer[0];
            let secondByte = buffer[1];
            return (firstByte == 0x1f) && (secondByte == 0x8b)
        } catch (err) {
            return false;
        }
    }
    readHeaderAsString(res: ExtendedResponse, headerName: string): string {
        let value = res.getHeader(headerName);
        if (!value)
            return "";
        if (Array.isArray(value)) {
            value = value[0];
        }
        if (typeof(value) !== "string") {
            return value + "";
        } else {
            return value;
        }

    }
    async purgeCache(): Promise<void> {
        debug("purge cache", this.options.cacheDir);
        try {
            await rmdir(this.options.cacheDir);
            debug("purge done");
        } catch (e) {
            debug('purge error', e);
        }
    }
    async purgeByUrl(url: string, locale: string): Promise<void> {
        debug("purge cache URL", this.options.cacheDir, url);
        let cachePath = fullPathFromUrl(url, locale, this.options.cacheDir);
        try {
            if (await pathExists(cachePath)) {
                debug('delete', cachePath);
                await unlink(cachePath);
                debug("purge url done");
            } else {
                debug("url not cached", cachePath);
            }
        } catch (e) {
            debug('purge error', e);
        }
    }
    middleware(){
        return (meta:SiteMeta,lastModified:LastModifiedByLocale, keywordsByLocale: KeywordMapper, reverseKeywordByLocale: KeywordMapper, req: ExtendedRequest, res: ExtendedResponse, next: () => void) => {

            let replaceUrls = shouldReplaceUrls(req);
            if (!shouldHandle(req) && !replaceUrls) {
                debug('ignored', req.url);
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
                    }else{
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
                    Object.defineProperty(res,"headersSent",{
                        get:()=>{
                            return false;
                        },
                        configurable:true,
                        enumerable:true,
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
                        const getter = Object.getOwnPropertyDescriptor(OutgoingMessage.prototype,"headersSent");
                        Object.defineProperty(res,"headersSent",getter );
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
                    } else if (res.statusCode < 200 || res.statusCode >= 300) {
                        debug('error response', res.statusCode);
                        shouldProcess = false;
                        restore_override();
                    }
                    head_checked = true;
                };


                let justAnObject: any = <any>res;
                res.write = function(chunk?: any, encoding?: any, cb?: any) {
                    check_head();
                    if (!shouldProcess) {
                        if (cache_only)
                            return;

                        debug('write original');
                        return res.write.apply(res, arguments);
                    }
                    if (chunk instanceof Buffer)
                        chunk = (<Buffer>chunk).toString(encoding);
                    chunks.push(<string>chunk);
                    if(typeof(encoding) == 'function')
                        cb = <Function>encoding;
                    if(cb)
                        cb();
                };


                const self = this;
                let alt_host = this.options.altHost;
                justAnObject.end = function(chunk?: any, encoding?: any, cb?: any) {
                    if(typeof(encoding) == 'function'){
                        cb = <Function>encoding;
                        encoding = void(0);
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
                            self.readHeaderAsString(res, 'content-type').indexOf('xml') > -1){

                            const bablicDate = new Date(lastModified[req.bablic.locale]);
                            original_html = original_html.replace(new RegExp("<lastmod>(.*?)</lastmod>", "g"), (captureAll, dateCapture) => {
                                let siteMapDate = new Date(dateCapture);
                                if (siteMapDate < bablicDate) {
                                    return "<lastmod>" + bablicDate.toISOString() + "</lastmod>";
                                } else {
                                    return captureAll;
                                }
                            });
                        }

                        const locale = req.bablic.locale;
                        const currentHost = req.headers.host as string;
                        let originalDomains: string[] = [currentHost];
                        if(alt_host)
                            originalDomains.push(alt_host);
                        if (meta.localeDetection === "custom" && meta.customUrls && meta.customUrls[locale]) {
                            if(currentHost === meta.customUrls[locale]) {
                                let supposeOriginDomain = meta.customUrls[meta.original];
                                if (supposeOriginDomain) {
                                    originalDomains.push(supposeOriginDomain);
                                }
                            }
                        }

                        html = original_html.replace(detect_url, url => {
                            if (ignore_not_html_or_xml.test(url))
                                return url;
                            if (_.every(originalDomains, (domain) => !url.includes(domain))) {
                                return url;
                            }

                            let parsed = UrlParser.parse(url);
                            // translate URLs in sitemaps and such
                            if(keywordsByLocale && keywordsByLocale[req.bablic.locale]){
                                let keywords = keywordsByLocale[req.bablic.locale];
                                parsed.pathname = parsed.pathname.split('/').map(part => keywords[part] || part).join('/');
                            }
                            return getLink(req.bablic.locale, parsed, meta, self.subDirOptions);
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
                        // if browser doesnt support gzip encoding
                        if (!acceptGZIP) {
                            // if the content is gzipped
                            if (isEncoded) {
                                data = zlib.gunzipSync(data);
                            }
                        } else if (isEncoded) {
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


const ignore_not_html_or_xml = /\.(js|css|jpg|jpeg|png|ico|mp4|wmv|ogg|mp3|avi|mpeg|bmp|wav|pdf|doc|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;

const detect_url = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

let SEO_ROOT = 'http://seo.bablic.com/api/engine/seo';

export function setRenderServer(url: string) {
    if (!url) {
        throw new Error("Must be a valid URL");
    }
    SEO_ROOT = url;
}

function hash(data){
    return crypto.createHash('md5').update(data).digest('hex');
}
function fullPathFromUrl(url: string, locale: string, cacheDir: string) {
    return cacheDir + "/" + locale + "/" + hash(url);
}
function getCacheDir(locale: string, cacheDir: string) {
    return cacheDir + "/" + locale;
}
function cacheValid(file_stats: Stats, cacheDays: number) {
    let last_modified = moment(file_stats.mtime.getTime());
    let now = moment();
    last_modified.add(cacheDays, 'days');
    return now.isBefore(last_modified);
}

const filename_tester = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|xml|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;
function ignorable(req) {
    return filename_tester.test(req.url);
}
const google_tester = /bot|crawler|yandex|bing|baidu|spider|facebook|twitter|80legs|google|seo/i;
function isBot(req) {
    return google_tester.test(req.headers['user-agent']);
}

function shouldHandle(req) {
    return isBot(req) && !ignorable(req);
}

function shouldReplaceUrls(req) {
    return /sitemap|robots/i.test(req.url);
}


function renderHealthCheck(): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        debug('render health check');
        request({
            url: SEO_ROOT,
            headers:{
                "Accept-Encoding": "gzip,deflate"
            },
            method: 'GET',
            timeout: 10000,
        }, (error:any) => {
            if (error) {
                debug('render is not healthy', error);
                return resolve(false);
            }
            debug('render is healthy');
            resolve(true);
        });
    });
}

let isRenderHealthy = true;

setInterval(() => {
    renderHealthCheck().then((health) => {
        isRenderHealthy = health;
    });
}, 1000*60);
