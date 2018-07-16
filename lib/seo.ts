

import * as async from 'async';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as moment from 'moment';
import * as OS from 'os';
import * as request from 'request';
import * as Debug from 'debug';
import * as UrlParser from 'url';

const debug = Debug('bablic:seo');

import {ExtendedRequest, ExtendedResponse, Middleware, getLink, KeywordMapper, SiteMeta} from "./common";
import {ServerResponse} from "http";
import {Stats} from "fs";
import {RequestResponse} from "request";

export interface SeoOptions {
    useCache?:boolean;
    defaultCache?:string[];
    test?:boolean;
    altHost?: string;
}

export interface SeoSubDirOptions {
    subDir: boolean;
    subDirBase: string;
    subDirOptional: boolean;
}

export class SeoMiddleware{
    constructor(private siteId: string, private options: SeoOptions, private subDirOptions: SeoSubDirOptions){
        if (options.defaultCache) {
            setTimeout(() => {
                debug('starting preloads');
                return this.preload();
            }, 15000);
        }

    }
    preload(): void {
        async.eachSeries(this.options.defaultCache, (url, cbk) => {
            debug('check cache for ', url);
            this.getHtml(url, null, (error:Error, data) => {
                if ((error != null) || data === void 0) {
                    console.error("[Bablic SDK] Error: url " + url + " failed preloading", error);
                } else {
                    debug("[Bablic SDK] - Preload " + url + " complete, size: " + data.length);
                }
                return cbk();
            });
        });
    }
    getHtml(url: string, html: string, cbk:(e:Error, html?: string)=> void): void {
        debug('getting from bablic', url, 'html:', !!html );
        let ld = '';
        if(this.subDirOptions.subDir) {
            ld = '&ld=subdir';
            if(this.subDirOptions.subDirBase)
                ld += '&sdb=' + encodeURIComponent(this.subDirOptions.subDirBase);
            if(this.subDirOptions.subDirOptional)
                ld += '&sdo=true';
        }
        request({
            url: SEO_ROOT + "/api/engine/seo?site=" + this.siteId + "&url=" + (encodeURIComponent(url)) + ld,
            method: 'POST',
            json: {
                html: html
            }
        }, (error:any, response:RequestResponse, body: any) => {
            if (error)
                return cbk(error);

            if (response.statusCode < 200 || response.statusCode >= 300)
                return cbk(new Error("Status-" + response.statusCode));

            if (body == null)
                return cbk(new Error('empty response'));

            debug('received translated html', response.statusCode);
            cbk(null, body);
            fs.writeFile(fullPathFromUrl(url), body, error => error && console.error('Error saving to cache', error));
        });
    }
    getFromCache(url: string, skip: boolean, callback:(e?:Error, html?: string, isValid?: boolean) => void) {
        if (!this.options.useCache || skip)
            return callback();

        let file_path = fullPathFromUrl(url);
        fs.stat(file_path, (error:NodeJS.ErrnoException, file_stats: Stats) => {
            if (error)
                return callback(error);

            fs.readFile(file_path, (error:NodeJS.ErrnoException, data: Buffer) => {
                if (error)
                    return callback(error);
                callback(error, data.toString('utf8'), cacheValid(file_stats));
            });
        });
    };

    middleware(){
        return (meta:SiteMeta, keywordsByLocale: KeywordMapper, reverseKeywordByLocale: KeywordMapper, req: ExtendedRequest, res: ExtendedResponse, next: () => void) => {

            let replaceUrls = shouldReplaceUrls(req);
            if (!shouldHandle(req) && !replaceUrls) {
                debug('ignored', req.url);
                return next();
            }

            delete req.headers['accept-encoding'];
            req.bablic.proxied = true;

            let protocol = req.headers['x-forwarded-proto'] || 'http';
            let my_url = protocol + "://" + req.headers.host + req.originalUrl;
            if (this.options.altHost)
                my_url = "http://" + this.options.altHost + req.originalUrl;


            this.getFromCache(my_url, replaceUrls, (e, html, isValid) => {
                let cache_only = false;
                if (html) {
                    debug('flushing from cache');
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.setHeader('Content-Language', req.bablic.locale);
                    res.write(html);
                    res.end();
                    if (isValid)
                        return;
                    cache_only = true;
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
                    if (cache_only)
                        _getHeader = null;

                    _write = _end = _writeHead = null;
                };


                let head_checked = false;
                let is_html = null;
                let chunks = [];
                let check_head = () => {
                    if (head_checked)
                        return;

                    is_html = false;
                    if (typeof(res.getHeader('content-type')) !== 'undefined')
                        is_html = ((<string>res.getHeader('content-type')).indexOf('text/html') > -1) || replaceUrls;

                    if (!is_html) {
                        debug('not html', res.getHeader('content-type'));
                        restore_override();
                    }
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        debug('error response', res.statusCode);
                        is_html = false;
                        restore_override();
                    }
                    head_checked = true;
                };


                let justAnObject: any = <any>res;
                res.write = function(chunk?: any, encoding?: any, cb?: any) {
                    check_head();
                    if (!is_html) {
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
                    if (!is_html) {
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
                        html = original_html.replace(detect_url, url => {
                            if (ignore_not_html_or_xml.test(url))
                                return url;
                            if (url.indexOf(<string>req.headers.host) === -1 && (!alt_host || url.indexOf(alt_host) === -1))
                                return url;

                            let parsed = UrlParser.parse(url);
                            // translate URLs in sitemaps and such
                            if(keywordsByLocale && keywordsByLocale[req.bablic.locale]){
                                let keywords = keywordsByLocale[req.bablic.locale];
                                parsed.pathname = parsed.pathname.split('/').map(part => keywords[part] || part).join('/');
                            }
                            return getLink(req.bablic.locale, parsed, meta);
                        });
                        res.setHeader('Content-Length', Buffer.byteLength(html));
                        res.write(html, cb);
                        return res.end();
                    }
                    self.getHtml(my_url, original_html, (error:Error, data:string) => {
                        if (cache_only)
                            return;

                        restore_override();
                        if (error) {
                            console.error('[Bablic SDK] Error:', error);
                            debug('flushing original');
                            res.write(original_html, cb);
                            res.end();
                            return;
                        }
                        debug('flushing translated');
                        res.setHeader('Content-Length', Buffer.byteLength(data));
                        res.write(data, cb);
                        res.end();
                    });
                };
                return next();
            });
        };
    }
}


const ignore_not_html_or_xml = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;

const detect_url = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;

const SEO_ROOT = 'http://seo.bablic.com';

function hash(data){
    return crypto.createHash('md5').update(data).digest('hex');
}

function fullPathFromUrl(url) {
    return OS.tmpdir() + "/" + hash(url);
}
function cacheValid(file_stats) {
    let last_modified = moment(file_stats.mtime.getTime());
    let now = moment();
    last_modified.add(30, 'minutes');
    return now.isBefore(last_modified);
}

const filename_tester = /\.(js|css|jpg|jpeg|png|mp3|avi|mpeg|bmp|wav|pdf|doc|xml|docx|xlsx|xls|json|kml|svg|eot|woff|woff2)/i;
function ignorable(req) {
    return filename_tester.test(req.url);
}
const google_tester = /bot|crawler|baiduspider|facebook|twitter|80legs|google|seo/i;
function isBot(req) {
    return google_tester.test(req.headers['user-agent']);
}

function shouldHandle(req) {
    return isBot(req) && !ignorable(req);
}

function shouldReplaceUrls(req) {
    return /sitemap|robots/i.test(req.url);
}

